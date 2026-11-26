"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { BlockState } from "../../lib/account-blocks";
import {
  type PublicPerson,
  type PublicPersonStats,
  publicPersonImageUrl,
  type Relationship,
  readPublicPerson,
  readPublicPersonStats,
  readRelationship,
} from "../../lib/connections";
import {
  ConnectionRequestError,
  connectionAccountRequest,
  connectionError,
  connectionRequest,
} from "../../lib/connections-client";
import { msg } from "../../lib/i18n/translate";
import { messageLink } from "../../lib/messaging";
import { workStatusLabels } from "../../lib/people";
import type { PersonBusinessesRequest } from "../../lib/person-businesses";
import { reportUrl } from "../../lib/support-requests";
import { ShareButton } from "../directory/ShareButton";
import { Icon, type IconName } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { personalProfileImage } from "../people/PersonalProfileCard";
import { PlatformBadges } from "../people/PlatformBadges";
import { VerificationBadge } from "../VerificationBadge";
import { ViewBeacon } from "../ViewBeacon";
import styles from "./connections.module.css";
import { PersonAvatar, type PersonMediaUrl, personLocation } from "./PeopleSearch";
import { ProfileBlockAction } from "./ProfileBlockAction";
import { PublicPersonBusinesses } from "./PublicPersonBusinesses";
import look from "./person-profile.module.css";

type Action = "request" | "accept" | "decline" | "cancel" | "remove";
type PendingWrite = {
  path: string;
  body: string;
  expectedVersion: number;
  personId: string;
  action: Action;
  actorId: string;
  uncertain: boolean;
};
function relationshipNotice(relationship: Relationship): string {
  if (relationship.status === "accepted") return msg("Sada ste prijatelji.");
  if (relationship.status === "pending")
    return relationship.direction === "incoming"
      ? msg("Imaš zahtjev za prijateljstvo.")
      : msg("Zahtjev je poslan.");
  if (relationship.status === "declined") return msg("Zahtjev je odbijen.");
  if (relationship.status === "cancelled") return msg("Zahtjev je povučen.");
  return msg("Prijateljstvo je uklonjeno.");
}

type ProfileProps = {
  personId: string;
  preview?: boolean;
  request?: typeof connectionRequest;
  ownProfileHref?: string;
  loginHref?: string;
  imageUrl?: PersonMediaUrl;
  messageHref?: string;
  businessRequest?: PersonBusinessesRequest;
};

export function PublicPersonProfile(props: ProfileProps) {
  const boundary = useMemo(
    () => ({ personId: props.personId, request: props.request, preview: props.preview }),
    [props.personId, props.request, props.preview],
  );
  const mounted = useRef({ boundary, key: 0 });
  if (mounted.current.boundary !== boundary)
    mounted.current = { boundary, key: mounted.current.key + 1 };
  return <PersonProfile key={mounted.current.key} {...props} />;
}

function PersonProfile({
  personId,
  preview = false,
  request = connectionRequest,
  ownProfileHref = "/nalog?odjeljak=profil",
  loginHref,
  imageUrl = publicPersonImageUrl,
  messageHref,
  businessRequest,
}: ProfileProps) {
  const { t, locale } = useI18n();
  const [contact, setContact] = useState<BlockState | null>(null);
  const [stats, setStats] = useState<PublicPersonStats | null>(null);
  const tabId = useId();
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
  const capturedActor = useRef<string | null | undefined>(undefined);
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
      setError(t("Pregled profila trenutno nije dostupan."));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const path = `people/${encodeURIComponent(personId)}`;
      const options = { signal: nextController.signal };
      const result = capturedActor.current
        ? await connectionAccountRequest(api.current, capturedActor.current, path, options)
        : await api.current(path, options);
      const next = readPublicPerson(result.person);
      const relation = readRelationship(result.relationship);
      if (
        next.id !== personId ||
        relation.personId !== personId ||
        !(result.viewerId === null || typeof result.viewerId === "string")
      )
        throw new Error("invalid_public_person");
      if (!live.current || nextController.signal.aborted || current !== revision.current) return;
      if (capturedActor.current && result.viewerId !== capturedActor.current)
        throw new ConnectionRequestError(401, "ACCOUNT_IDENTITY_CHANGED");
      capturedActor.current = result.viewerId;
      setPerson(next);
      setStats(readPublicPersonStats(result.stats));
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
          setConfirmRemove(false);
          setPending((intent) => (intent?.uncertain ? intent : null));
        }
        setError(
          failure instanceof ConnectionRequestError && failure.status === 404
            ? t("Ovaj profil nije javno dostupan.")
            : t(connectionError(failure)),
        );
      }
    } finally {
      if (live.current && current === revision.current) setLoading(false);
    }
  }, [personId, preview, t]);

  useEffect(() => {
    setStats(null);
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
      const result = await connectionAccountRequest(api.current, intent.actorId, intent.path, {
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
          setNotice(t(relationshipNotice(current)));
      }
    } catch (failure) {
      if (live.current && currentId.current === intent.personId) {
        setError(t(connectionError(failure)));
        const denied =
          failure instanceof ConnectionRequestError && [401, 403].includes(failure.status);
        if (denied) {
          setRelationship(null);
          setViewerId(null);
          setNotice("");
          setConfirmRemove(false);
        }
        if (
          failure instanceof ConnectionRequestError &&
          failure.status >= 400 &&
          failure.status < 500 &&
          failure.status !== 408 &&
          !(denied && intent.uncertain)
        ) {
          setPending(null);
          if (failure.status === 409) void load();
        } else intent.uncertain = true;
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
      actorId: viewerId,
      uncertain: false,
    };
    void send(intent);
  }

  const cover = person ? personalProfileImage(imageUrl(person, "cover")) : null;
  const currentPerson = person?.id === personId;
  // Earned marks, as drawn: the founder's two, then verification and keeping a business.
  const medals: { icon: IconName; label: string }[] = [];
  if (person?.platformFounder)
    medals.push(
      { icon: "crown", label: msg("Osnivač") },
      { icon: "star", label: msg("Prvi član") },
    );
  if (person?.verified) medals.push({ icon: "shield", label: msg("Verifikovan") });
  if (stats && stats.businesses > 0) medals.push({ icon: "shop", label: msg("Vlasnik") });
  const disabled = busy || loading || pending !== null;
  const signIn =
    loginHref ?? `/prijava?nastavi=${encodeURIComponent(`/ljudi/${encodeURIComponent(personId)}`)}`;

  return (
    <section className={styles.workspace} aria-label={t("Javni lični profil")}>
      {!currentPerson && error && (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy || loading}
            onClick={() => (pending ? void send(pending) : void load())}
          >
            {t("Pokušaj ponovo")}
          </button>
        </div>
      )}
      {!currentPerson && !error && (
        <section className={styles.skeleton} aria-busy="true" aria-label={t("Profil")}>
          <span />
          <span />
          <span />
        </section>
      )}
      {person && currentPerson && (
        <article
          className={`${styles.profile} ${look.page}`}
          data-founder={person.platformFounder ? "" : undefined}
        >
          {!preview && viewerId !== person.id && <ViewBeacon kind="person" id={person.id} />}
          <div className={look.cover}>
            {cover && (
              <Image
                className={look.coverPhoto}
                src={cover}
                alt={t("Naslovna fotografija profila")}
                width={1600}
                height={600}
                unoptimized
              />
            )}
            <div className={look.coverBar}>
              <Link href="/ljudi" className={look.circle} aria-label={t("Nazad")}>
                <Icon name="arrow" />
              </Link>
              {!preview && (
                <ShareButton
                  title={person.name}
                  path={`/ljudi/${encodeURIComponent(person.id)}`}
                  className={look.circle}
                  statusClassName={look.shareStatus}
                />
              )}
            </div>
          </div>
          <div className={look.identity}>
            <span className={look.portrait}>
              {person.platformFounder && <span className={look.ring} aria-hidden="true" />}
              <PersonAvatar person={person} imageUrl={imageUrl} large />
            </span>
            <h1 className={look.name}>
              <bdi>{person.name}</bdi>
              {person.verified && <VerificationBadge kind="person" />}
            </h1>
            <PlatformBadges
              platformFounder={person.platformFounder}
              platformAdministrator={person.platformAdministrator}
            />
            {person.bio && (
              <p className={look.bio} dir="auto">
                {person.bio}
              </p>
            )}
            {(personLocation(person, locale) || person.workStatus !== "not_specified") && (
              <p className={look.facts}>
                {personLocation(person, locale) && (
                  <span>
                    <Icon name="pin" />
                    {personLocation(person, locale)}
                  </span>
                )}
                {person.workStatus !== "not_specified" && (
                  <span>
                    <Icon name="shop" />
                    {t(workStatusLabels[person.workStatus])}
                  </span>
                )}
              </p>
            )}
          </div>
          {stats && (
            <dl className={look.stats}>
              <div>
                <dt>{t("djelatnosti")}</dt>
                <dd>{stats.businesses}</dd>
              </div>
              <div>
                <dt>{t("prijatelja")}</dt>
                <dd>{stats.friends}</dd>
              </div>
              <div>
                <dt>{t("član od")}</dt>
                <dd>{stats.joinedYear}.</dd>
              </div>
            </dl>
          )}
          <div className={look.actions}>
            {viewerId !== person.id &&
              contact?.canContact !== false &&
              (!preview || messageHref) && (
                <Link
                  className={styles.secondary}
                  href={messageHref ?? messageLink({ kind: "person", targetId: person.id })}
                >
                  <Icon name="message" /> {t("Poruka")}
                </Link>
              )}
            {viewerId === person.id ? (
              <Link className={styles.secondary} href={ownProfileHref}>
                <Icon name="sliders" /> Moj profil
              </Link>
            ) : viewerId === null ? (
              <Link className={styles.primary} href={signIn}>
                {t("Prijavi se za povezivanje")}
              </Link>
            ) : contact?.canContact === false ? (
              <span className={styles.relationship}>
                {contact.blockedByMe ? t("Blokiran korisnik") : t("Kontakt trenutno nije dostupan")}
              </span>
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
                  {confirmRemove ? t("Potvrdi uklanjanje") : t("Ukloni prijatelja")}
                </button>
                {confirmRemove && (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={disabled}
                    onClick={() => setConfirmRemove(false)}
                  >
                    {t("Odustani")}
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
                    {t("Odbij")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={disabled}
                  onClick={() => act("cancel")}
                >
                  {t("Povuci zahtjev")}
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
                    {pending ? t("Pokušaj ponovo") : t("Osvježi profil")}
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
          {medals.length > 0 && (
            <section className={look.section} aria-labelledby={`${tabId}-medals`}>
              <h2 id={`${tabId}-medals`}>{t("Značke")}</h2>
              <ul className={look.medals}>
                {medals.map((medal) => (
                  <li key={medal.label}>
                    <span aria-hidden="true">
                      <Icon name={medal.icon} />
                    </span>
                    {t(medal.label)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className={look.section}>
            <PublicPersonBusinesses
              key={person.id}
              personId={person.id}
              request={businessRequest}
              preview={preview}
              title={msg("Djelatnosti")}
            />
          </div>
          {person.skills.length > 0 && (
            <section className={look.section} aria-labelledby={`${tabId}-skills`}>
              <h2 id={`${tabId}-skills`}>{t("Vještine")}</h2>
              <ul className={styles.skills}>
                {person.skills.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            </section>
          )}
          {!preview && viewerId !== person.id && (
            <div className={styles.profileSafety}>
              {viewerId && request === connectionRequest && (
                <ProfileBlockAction
                  key={viewerId}
                  accountId={viewerId}
                  personId={person.id}
                  disabled={busy}
                  onContact={setContact}
                />
              )}
              <Link href={reportUrl("person", person.id)}>{t("Prijavi profil")}</Link>
            </div>
          )}
        </article>
      )}
    </section>
  );
}
