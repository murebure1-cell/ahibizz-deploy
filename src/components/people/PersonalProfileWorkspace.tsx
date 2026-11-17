"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ProfileVisibility, readProfileVisibility } from "../../lib/connections";
import {
  ConnectionRequestError,
  connectionAccountRequest,
  connectionError,
  connectionRequest,
} from "../../lib/connections-client";
import type { PersonalProfile, PersonalProfileFields, ProfileImageKind } from "../../lib/people";
import {
  ProfileRequestError,
  peopleAccountRequest,
  peopleRequest,
  profileError,
  readPersonalProfile,
} from "../../lib/people-client";
import { PersonalProfileCard } from "./PersonalProfileCard";
import { PersonalProfileEditor } from "./PersonalProfileEditor";
import styles from "./workspace.module.css";

type WorkspaceProps = {
  active?: boolean;
  preview?: boolean;
  expectedAccountId?: string;
  request?: typeof peopleRequest;
  connectionsRequest?: typeof connectionRequest;
  publicHref?: (id: string) => string;
  photoUrl?: string | null;
  coverUrl?: string | null;
  onProfileChanged?: (profile: PersonalProfile) => void;
  onAccessDenied?: () => void;
  onBusinesses?: () => void;
};

export function PersonalProfileWorkspace(props: WorkspaceProps) {
  const boundary = useMemo(
    () => ({
      expectedAccountId: props.expectedAccountId,
      request: props.request,
      connectionsRequest: props.connectionsRequest,
      preview: props.preview,
    }),
    [props.expectedAccountId, props.request, props.connectionsRequest, props.preview],
  );
  const mounted = useRef({ boundary, key: 0 });
  if (mounted.current.boundary !== boundary)
    mounted.current = { boundary, key: mounted.current.key + 1 };
  return <ProfileWorkspace key={mounted.current.key} {...props} />;
}

function accessDenied(failure: unknown): boolean {
  return (
    (failure instanceof ProfileRequestError || failure instanceof ConnectionRequestError) &&
    [401, 403].includes(failure.status)
  );
}

function ProfileWorkspace({
  active = true,
  preview = false,
  expectedAccountId,
  request = peopleRequest,
  connectionsRequest = connectionRequest,
  publicHref,
  photoUrl,
  coverUrl,
  onProfileChanged,
  onAccessDenied,
  onBusinesses,
}: WorkspaceProps) {
  const [profile, setProfile] = useState<PersonalProfile | null>(null),
    [editing, setEditing] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [visibility, setVisibility] = useState<ProfileVisibility | null>(null);
  const socialApi = useRef(connectionsRequest),
    pendingVisibility = useRef<{
      isPublic: boolean;
      expectedVersion: number;
      idempotencyKey: string;
    } | null>(null);
  socialApi.current = connectionsRequest;
  const api = useRef(request),
    changed = useRef(onProfileChanged),
    revision = useRef(0),
    authorityRevision = useRef(0),
    readController = useRef<AbortController | null>(null),
    writing = useRef(false),
    live = useRef(false);
  api.current = request;
  changed.current = onProfileChanged;
  const denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;
  const readProfile = useCallback(
    (path: string, options?: RequestInit) =>
      peopleAccountRequest(api.current, expectedAccountId, path, options),
    [expectedAccountId],
  );
  const readSocial = useCallback(
    (path: string, options?: RequestInit) =>
      connectionAccountRequest(socialApi.current, expectedAccountId, path, options),
    [expectedAccountId],
  );
  const clearPrivate = useCallback(() => {
    authorityRevision.current++;
    revision.current++;
    readController.current?.abort();
    setProfile(null);
    setVisibility(null);
    setEditing(false);
    setNotice("");
    setLoading(false);
    setBlocked(true);
    setRequiresLogin(true);
    pendingVisibility.current = null;
    denied.current?.();
  }, []);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      authorityRevision.current++;
      revision.current++;
      readController.current?.abort();
    };
  }, []);
  const load = useCallback(
    async (discard = false) => {
      if (preview && (api.current === peopleRequest || socialApi.current === connectionRequest)) {
        setError("Profil nije dostupan u ovom prikazu.");
        return;
      }
      readController.current?.abort();
      const controller = new AbortController(),
        current = ++revision.current,
        authority = authorityRevision.current;
      readController.current = controller;
      setLoading(true);
      setError("");
      try {
        const [data, social] = await Promise.all([
          readProfile("me", { signal: controller.signal }),
          readSocial("visibility", { signal: controller.signal }),
        ]);
        if (!live.current || authority !== authorityRevision.current) return;
        const next = readPersonalProfile(data.profile);
        const state = readProfileVisibility(social.visibility);
        if (next.id !== expectedAccountId)
          throw new ProfileRequestError(401, "ACCOUNT_IDENTITY_CHANGED");
        if (state.profileVersion !== next.version)
          throw new ProfileRequestError(409, "VERSION_CONFLICT");
        if (!live.current || controller.signal.aborted || current !== revision.current) return;
        setProfile(next);
        setVisibility(state);
        setRequiresLogin(false);
        changed.current?.(next);
        if (discard) {
          setEditing(false);
          setBlocked(false);
          setNotice("");
          pendingVisibility.current = null;
        }
      } catch (failure) {
        if (!live.current || authority !== authorityRevision.current) return;
        // A same-account denial remains authoritative after a newer read/write aborts this read.
        if (accessDenied(failure)) {
          clearPrivate();
          setError(profileError(failure));
        } else if (!controller.signal.aborted && current === revision.current) {
          setError(profileError(failure));
        }
      } finally {
        if (live.current && authority === authorityRevision.current && current === revision.current)
          setLoading(false);
      }
    },
    [preview, expectedAccountId, readProfile, readSocial, clearPrivate],
  );
  useEffect(() => {
    if (active && !profile && !requiresLogin) void load();
  }, [active, load, profile, requiresLogin]);

  async function mutate(
    options: RequestInit,
    intent?: { fields?: PersonalProfileFields; kind?: ProfileImageKind; remove?: boolean },
  ) {
    if (
      !active ||
      !profile ||
      writing.current ||
      blocked ||
      (preview && api.current === peopleRequest)
    )
      throw new Error("profile_not_ready");
    writing.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const before = profile,
      authority = authorityRevision.current;
    try {
      const path = intent?.kind ? `me/media/${intent.kind}` : "me";
      revision.current++;
      readController.current?.abort();
      setLoading(false);
      const result = await readProfile(path, options);
      if (!live.current || authority !== authorityRevision.current) return;
      const next = readPersonalProfile(result.profile);
      if (next.id !== before.id || next.version !== before.version + 1)
        throw new Error("unconfirmed_profile_write");
      if (
        intent?.fields &&
        Object.entries(intent.fields).some(
          ([key, value]) =>
            JSON.stringify(next[key as keyof PersonalProfileFields]) !== JSON.stringify(value),
        )
      )
        throw new Error("unconfirmed_profile_fields");
      if (intent?.kind) {
        const imageVersion = intent.kind === "photo" ? next.photoVersion : next.coverVersion;
        if (intent.remove ? imageVersion !== null : imageVersion !== next.version)
          throw new Error("unconfirmed_profile_image");
      }
      if (live.current && authority === authorityRevision.current) {
        setProfile(next);
        setVisibility((current) =>
          current ? { ...current, profileVersion: next.version } : current,
        );
        changed.current?.(next);
        if (intent?.fields) {
          setEditing(false);
          setNotice(preview ? "Profil je sačuvan u pregledu." : "Profil je sačuvan.");
        }
      }
    } catch (failure) {
      if (live.current && authority === authorityRevision.current) {
        if (accessDenied(failure)) clearPrivate();
        setError(profileError(failure));
        if (
          !(failure instanceof ProfileRequestError) ||
          failure.status === 408 ||
          failure.status === 409 ||
          failure.status >= 500
        )
          setBlocked(true);
      }
      throw failure;
    } finally {
      writing.current = false;
      if (live.current) setBusy(false);
    }
  }
  const save = (fields: PersonalProfileFields) =>
    mutate(
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, expectedVersion: profile?.version }),
      },
      { fields },
    );
  const upload = (kind: ProfileImageKind, file: File) =>
    mutate(
      {
        method: "PUT",
        headers: { "Content-Type": file.type, "If-Match": `"${profile?.version}"` },
        body: file,
      },
      { kind },
    );
  const remove = (kind: ProfileImageKind) =>
    mutate(
      { method: "DELETE", headers: { "If-Match": `"${profile?.version}"` } },
      { kind, remove: true },
    );
  async function changeVisibility() {
    if (
      !active ||
      !profile ||
      !visibility ||
      writing.current ||
      editing ||
      (preview && socialApi.current === connectionRequest)
    )
      return;
    writing.current = true;
    revision.current++;
    readController.current?.abort();
    setLoading(false);
    setBusy(true);
    setError("");
    setNotice("");
    const authority = authorityRevision.current;
    const input = pendingVisibility.current ?? {
      isPublic: !visibility.isPublic,
      expectedVersion: profile.version,
      idempotencyKey: crypto.randomUUID(),
    };
    pendingVisibility.current = input;
    try {
      const data = await readSocial("visibility", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!live.current || authority !== authorityRevision.current) return;
      const next = readProfileVisibility(data.visibility);
      if (next.isPublic !== input.isPublic || next.profileVersion !== input.expectedVersion + 1)
        throw new Error("unconfirmed_visibility");
      // A receipt confirms this command, not the current state after another tab's edit.
      const [savedProfile, savedVisibility] = await Promise.all([
        readProfile("me"),
        readSocial("visibility"),
      ]);
      if (!live.current || authority !== authorityRevision.current) return;
      const updated = readPersonalProfile(savedProfile.profile),
        current = readProfileVisibility(savedVisibility.visibility);
      if (
        updated.id !== profile.id ||
        updated.version !== current.profileVersion ||
        updated.version < next.profileVersion
      )
        throw new Error("unconfirmed_current_visibility");
      if (live.current && authority === authorityRevision.current) {
        setVisibility(current);
        setProfile(updated);
        changed.current?.(updated);
        setBlocked(false);
        setNotice(current.isPublic ? "Profil je sada javno dostupan." : "Profil je sada privatan.");
      }
      pendingVisibility.current = null;
    } catch (failure) {
      if (!live.current || authority !== authorityRevision.current) return;
      if (
        failure instanceof ConnectionRequestError &&
        failure.status < 500 &&
        failure.status !== 408
      )
        pendingVisibility.current = null;
      if (live.current) {
        if (accessDenied(failure)) clearPrivate();
        setError(connectionError(failure));
        setBlocked(true);
      }
    } finally {
      writing.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <section className={styles.workspace} aria-label="Moj profil">
      {error && (
        <div role="alert" className={styles.error}>
          <p>{error}</p>
          <button type="button" disabled={busy || loading} onClick={() => void load(true)}>
            Učitaj sačuvani profil
          </button>
        </div>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {loading && !profile && (
        <p role="status" className={styles.loading}>
          Otvaram profil…
        </p>
      )}
      {profile &&
        (editing ? (
          <PersonalProfileEditor
            profile={profile}
            busy={busy || blocked}
            onSave={save}
            onCancel={() => {
              setEditing(false);
              setError("");
            }}
            onUploadPhoto={(file) => upload("photo", file)}
            onUploadCover={(file) => upload("cover", file)}
            onRemovePhoto={() => remove("photo")}
            onRemoveCover={() => remove("cover")}
            photoUrl={photoUrl}
            coverUrl={coverUrl}
          />
        ) : (
          <PersonalProfileCard
            profile={profile}
            photoUrl={photoUrl}
            coverUrl={coverUrl}
            onEdit={() => {
              if (busy || blocked) return;
              setEditing(true);
              setNotice("");
            }}
            onBusinesses={onBusinesses}
          />
        ))}
      {profile && visibility && !editing && (
        <div className={styles.visibility}>
          <div>
            <h2>Vidljivost profila</h2>
            <p>
              {visibility.isPublic
                ? "Tvoj profil se može pronaći među ljudima."
                : "Profil vidiš samo ti."}
            </p>
          </div>
          <button
            type="button"
            aria-label="Javni profil"
            aria-pressed={visibility.isPublic}
            aria-description={
              pendingVisibility.current && !busy ? "Ponovi potvrdu prethodne promjene." : undefined
            }
            disabled={busy || (blocked && !pendingVisibility.current)}
            onClick={() => void changeVisibility()}
          >
            <span className={styles.visibilitySwitch} aria-hidden="true" />
            <span>
              Javni profil{pendingVisibility.current && !busy && <small>Ponovi potvrdu</small>}
            </span>
          </button>
          {visibility.isPublic && (
            <Link href={publicHref?.(profile.id) ?? `/ljudi/${encodeURIComponent(profile.id)}`}>
              Pogledaj javni profil
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
