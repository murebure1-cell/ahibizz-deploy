"use client";

import Image from "next/image";
import Link from "next/link";
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  type PublicPerson,
  publicPersonImageUrl,
  type Relationship,
  readPublicPerson,
  readRelationship,
} from "../../lib/connections";
import {
  ConnectionRequestError,
  connectionError,
  connectionRequest,
} from "../../lib/connections-client";
import { messageLink } from "../../lib/messaging";
import { workStatusLabels } from "../../lib/people";
import { Icon } from "../Icon";
import { personalProfileImage } from "../people/PersonalProfileCard";
import styles from "./connections.module.css";
import { PersonAvatar, type PersonMediaUrl, personLocation } from "./PeopleSearch";

type Action = "request" | "accept" | "decline" | "cancel" | "remove";
type PendingWrite = {
  path: string;
  body: string;
  expectedVersion: number;
  personId: string;
  action: Action;
};
function relationshipNotice(relationship: Relationship): string {
  if (relationship.status === "accepted") return "Sada ste prijatelji.";
  if (relationship.status === "pending")
    return relationship.direction === "incoming"
      ? "Imaš zahtjev za prijateljstvo."
      : "Zahtjev je poslan.";
  if (relationship.status === "declined") return "Zahtjev je odbijen.";
  if (relationship.status === "cancelled") return "Zahtjev je povučen.";
  return "Prijateljstvo je uklonjeno.";
}

export function PublicPersonProfile({
  personId,
  preview = false,
  request = connectionRequest,
  ownProfileHref = "/nalog?dio=profil",
  loginHref,
  imageUrl = publicPersonImageUrl,
  messageHref,
}: {
  personId: string;
  preview?: boolean;
  request?: typeof connectionRequest;
  ownProfileHref?: string;
  loginHref?: string;
  imageUrl?: PersonMediaUrl;
  messageHref?: string;
}) {
  const [tab, setTab] = useState<"about" | "skills" | "photos">("about");
  const tabId = useId(),
    tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const tabs = ["about", "skills", "photos"] as const;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % 3
        : event.key === "ArrowLeft"
          ? (index + 2) % 3
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? 2
              : -1;
    if (next < 0) return;
    event.preventDefault();
    const item = tabs[next];
    if (item) setTab(item);
    tabButtons.current[next]?.focus();
  }
  const [person, setPerson] = useState<PublicPerson | null>(null),
    [relationship, setRelationship] = useState<Relationship | null>(null),
    [viewerId, setViewerId] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState<PendingWrite | null>(null),
    [confirmRemove, setConfirmRemove] = useState(false);
  const api = useRef(request),
    revision = useRef(0),
    controller = useRef<AbortController | null>(null),
    writing = useRef(false),
    live = useRef(false),
    currentId = useRef(personId);
  api.current = request;
  currentId.current = personId;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      revision.current++;
      controller.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    controller.current?.abort();
    const nextController = new AbortController(),
      current = ++revision.current;
    controller.current = nextController;
    if (preview && api.current === connectionRequest) {
      setError("Pregled profila trenutno nije dostupan.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api.current(`people/${encodeURIComponent(personId)}`, {
        signal: nextController.signal,
      });
      const next = readPublicPerson(result.person);
      const relation = readRelationship(result.relationship);
      if (
        next.id !== personId ||
        relation.personId !== personId ||
        !(result.viewerId === null || typeof result.viewerId === "string")
      )
        throw new Error("invalid_public_person");
      if (!live.current || nextController.signal.aborted || current !== revision.current) return;
      setPerson(next);
      setRelationship(relation);
      setViewerId(result.viewerId);
      return relation;
    } catch (failure) {
      if (live.current && !nextController.signal.aborted && current === revision.current) {
        if (failure instanceof ConnectionRequestError && [401, 403, 404].includes(failure.status)) {
          setPerson(null);
          setRelationship(null);
          setViewerId(null);
          setNotice("");
        }
        setError(
          failure instanceof ConnectionRequestError && failure.status === 404
            ? "Ovaj profil nije javno dostupan."
            : connectionError(failure),
        );
      }
    } finally {
      if (live.current && current === revision.current) setLoading(false);
    }
  }, [personId, preview]);

  useEffect(() => {
    setTab("about");
    setPerson(null);
    setRelationship(null);
    setViewerId(null);
    setPending(null);
    setNotice("");
    setConfirmRemove(false);
    void load();
    return () => {
      revision.current++;
      controller.current?.abort();
    };
  }, [load]);

  async function send(intent: PendingWrite) {
    if (writing.current || (preview && api.current === connectionRequest)) return;
    writing.current = true;
    revision.current++;
    controller.current?.abort();
    setBusy(true);
    setError("");
    setNotice("");
    setConfirmRemove(false);
    setPending(intent);
    try {
      const result = await api.current(intent.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: intent.body,
      });
      const next = readRelationship(result.relationship);
      if (next.personId !== intent.personId || next.version <= intent.expectedVersion)
        throw new Error("unconfirmed_relationship");
      if (live.current && currentId.current === intent.personId) {
        setRelationship(null);
        setPending(null);
        const current = await load();
        if (current && live.current && currentId.current === intent.personId)
          setNotice(relationshipNotice(current));
      }
    } catch (failure) {
      if (live.current && currentId.current === intent.personId) {
        setError(connectionError(failure));
        if (
          failure instanceof ConnectionRequestError &&
          failure.status >= 400 &&
          failure.status < 500
        ) {
          setPending(null);
          if (failure.status === 409) void load();
        }
      }
    } finally {
      writing.current = false;
      if (live.current && currentId.current === intent.personId) setBusy(false);
    }
  }

  function act(action: Action) {
    if (!person || person.id !== personId || !relationship || !viewerId || busy || pending) return;
    if (action === "remove" && !confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    const path =
      action === "request"
        ? `people/${encodeURIComponent(person.id)}/request`
        : relationship.id
          ? `connections/${encodeURIComponent(relationship.id)}/${action}`
          : null;
    if (!path) return;
    const intent: PendingWrite = {
      path,
      body: JSON.stringify({
        expectedVersion: relationship.version,
        idempotencyKey: crypto.randomUUID(),
      }),
      expectedVersion: relationship.version,
      personId: person.id,
      action,
    };
    void send(intent);
  }

  const photo = person ? personalProfileImage(imageUrl(person, "photo")) : null;
  const cover = person ? personalProfileImage(imageUrl(person, "cover")) : null;
  const currentPerson = person?.id === personId;
  const disabled = busy || loading || pending !== null;
  const signIn =
    loginHref ?? `/prijava?nastavi=${encodeURIComponent(`/ljudi/${encodeURIComponent(personId)}`)}`;

  return (
    <section className={styles.workspace} aria-label="Javni lični profil">
      {!currentPerson && error && (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          <button
            type="button"
            className={styles.secondary}
            disabled={loading}
            onClick={() => void load()}
          >
            Pokušaj ponovo
          </button>
        </div>
      )}
      {!currentPerson && !error && (
        <section className={styles.skeleton} aria-busy="true" aria-label="Profil">
          <span />
          <span />
          <span />
        </section>
      )}
      {person && currentPerson && (
        <article className={styles.profile}>
          <div className={styles.cover}>
            {cover ? (
              <Image
                className={styles.coverPhoto}
                src={cover}
                alt="Naslovna fotografija profila"
                width={1600}
                height={600}
                unoptimized
              />
            ) : (
              <Image
                className={styles.brand}
                src="/brand/ahi-logo-white.svg"
                alt="AhiBizz"
                width={160}
                height={43}
                unoptimized
              />
            )}
          </div>
          <div className={styles.identity}>
            <div className={styles.identityTop}>
              <PersonAvatar person={person} imageUrl={imageUrl} large />
            </div>
            <h1>{person.name}</h1>
            {person.bio && <p className={styles.intro}>{person.bio}</p>}
            {personLocation(person) && (
              <p className={styles.location}>
                <Icon name="pin" />
                {personLocation(person)}
              </p>
            )}
            {person.workStatus !== "not_specified" && (
              <p className={styles.work}>
                <span aria-hidden="true" />
                {workStatusLabels[person.workStatus]}
              </p>
            )}
            <div className={styles.actions}>
              {viewerId !== person.id && (!preview || messageHref) && (
                <Link
                  className={styles.secondary}
                  href={messageHref ?? messageLink({ kind: "person", targetId: person.id })}
                >
                  <Icon name="message" /> Pošalji poruku
                </Link>
              )}
              {viewerId === person.id ? (
                <Link className={styles.secondary} href={ownProfileHref}>
                  <Icon name="sliders" /> Moj profil
                </Link>
              ) : viewerId === null ? (
                <Link className={styles.primary} href={signIn}>
                  Prijavi se za povezivanje
                </Link>
              ) : relationship?.status === "accepted" ? (
                <>
                  <span className={styles.relationship}>
                    <Icon name="check" /> Prijatelji
                  </span>
                  <button
                    type="button"
                    className={confirmRemove ? styles.dangerButton : styles.quietButton}
                    disabled={disabled}
                    onClick={() => act("remove")}
                  >
                    {confirmRemove ? "Potvrdi uklanjanje" : "Ukloni prijatelja"}
                  </button>
                  {confirmRemove && (
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={disabled}
                      onClick={() => setConfirmRemove(false)}
                    >
                      Odustani
                    </button>
                  )}
                </>
              ) : relationship?.status === "pending" ? (
                relationship.direction === "incoming" ? (
                  <>
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={disabled}
                      onClick={() => act("accept")}
                    >
                      <Icon name="check" /> Prihvati prijateljstvo
                    </button>
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={disabled}
                      onClick={() => act("decline")}
                    >
                      Odbij
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={disabled}
                    onClick={() => act("cancel")}
                  >
                    Povuci zahtjev
                  </button>
                )
              ) : relationship ? (
                <button
                  type="button"
                  className={styles.primary}
                  disabled={disabled}
                  onClick={() => act("request")}
                >
                  <Icon name="user" /> Dodaj prijatelja
                </button>
              ) : null}
            </div>
          </div>
          {(error || notice) && (
            <div className={styles.profileStatus}>
              {error && (
                <div className={styles.error} role="alert">
                  <p>{error}</p>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy || loading}
                    onClick={() => (pending ? void send(pending) : void load())}
                  >
                    {pending ? "Pokušaj ponovo" : "Osvježi profil"}
                  </button>
                </div>
              )}
              {notice && (
                <p className={styles.notice} role="status">
                  {notice}
                </p>
              )}
            </div>
          )}
          <div className={styles.profileTabs} role="tablist" aria-label="Sadržaj profila">
            {(
              [
                ["about", "O meni"],
                ["skills", "Vještine"],
                ["photos", "Fotografije"],
              ] as const
            ).map(([id, label], index) => (
              <button
                key={id}
                ref={(element) => {
                  tabButtons.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`${tabId}-${id}-tab`}
                aria-controls={`${tabId}-${id}-panel`}
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                onKeyDown={(event) => tabKey(event, index)}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.profileContent}>
            {tab === "about" && (
              <section
                role="tabpanel"
                id={`${tabId}-about-panel`}
                aria-labelledby={`${tabId}-about-tab`}
              >
                <h2>Osnovni podaci</h2>
                {personLocation(person) && (
                  <p className={styles.detailRow}>
                    <Icon name="pin" />
                    {personLocation(person)}
                  </p>
                )}
                {person.workStatus !== "not_specified" && (
                  <p className={styles.detailRow}>
                    <Icon name="shop" />
                    {workStatusLabels[person.workStatus]}
                  </p>
                )}
                {!personLocation(person) && person.workStatus === "not_specified" && (
                  <p className={styles.bio}>Podaci još nisu dodani.</p>
                )}
              </section>
            )}
            {tab === "skills" && (
              <section
                role="tabpanel"
                id={`${tabId}-skills-panel`}
                aria-labelledby={`${tabId}-skills-tab`}
              >
                <h2>Vještine</h2>
                {person.skills.length ? (
                  <ul className={styles.skills}>
                    {person.skills.map((skill) => (
                      <li key={skill}>{skill}</li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.bio}>Vještine još nisu dodane.</p>
                )}
              </section>
            )}
            {tab === "photos" && (
              <section
                role="tabpanel"
                id={`${tabId}-photos-panel`}
                aria-labelledby={`${tabId}-photos-tab`}
              >
                <h2>Fotografije</h2>
                {photo || cover ? (
                  <div className={styles.photoGrid}>
                    {photo && (
                      <Image
                        src={photo}
                        alt={`Profilna fotografija: ${person.name}`}
                        width={512}
                        height={512}
                        unoptimized
                      />
                    )}
                    {cover && (
                      <Image
                        src={cover}
                        alt="Naslovna fotografija profila"
                        width={1600}
                        height={600}
                        unoptimized
                      />
                    )}
                  </div>
                ) : (
                  <p className={styles.bio}>Još nema fotografija.</p>
                )}
              </section>
            )}
          </div>
        </article>
      )}
    </section>
  );
}
