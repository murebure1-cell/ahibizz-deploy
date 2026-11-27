"use client";

import Image from "next/image";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type ConnectionRelationship,
  type PublicPerson,
  publicPersonImageUrl,
  readPublicPerson,
  readRelationship,
} from "../../lib/connections";
import {
  ConnectionRequestError,
  connectionError,
  connectionRequest,
} from "../../lib/connections-client";
import type { Locale } from "../../lib/i18n/locales";
import { messageLink } from "../../lib/messaging";
import { countryLabel, workStatusLabels } from "../../lib/people";
import { peopleRequest } from "../../lib/people-client";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { personalProfileImage, profileInitials } from "../people/PersonalProfileCard";
import { VerificationBadge } from "../VerificationBadge";
import styles from "./connections.module.css";

export type PersonMediaUrl = (person: PublicPerson, kind: "photo" | "cover") => string | null;

export function personLocation(person: PublicPerson, locale: Locale = "bs"): string {
  return [person.city, countryLabel(person.countryCode, locale)].filter(Boolean).join(", ");
}

export function PersonAvatar({
  person,
  imageUrl = publicPersonImageUrl,
  large = false,
}: {
  person: PublicPerson;
  imageUrl?: PersonMediaUrl;
  large?: boolean;
}) {
  const photo = personalProfileImage(imageUrl(person, "photo"));
  return (
    <div className={large ? styles.largeAvatar : styles.avatar} aria-hidden="true">
      {photo ? (
        <Image
          src={photo}
          alt=""
          width={large ? 224 : 104}
          height={large ? 224 : 104}
          unoptimized
        />
      ) : (
        <span>{profileInitials(person.name)}</span>
      )}
    </div>
  );
}

type Filter = { status: "open_to_collaboration" | "business_owner" | null; city: string | null };

export function PeopleSearch({
  active = true,
  heading = true,
  preview = false,
  request = connectionRequest,
  profileRequest = peopleRequest,
  profileHref = (id: string) => `/ljudi/${encodeURIComponent(id)}`,
  imageUrl,
}: {
  active?: boolean;
  heading?: boolean;
  preview?: boolean;
  request?: typeof connectionRequest;
  /** Reads the signed-in person's own city for the first filter chip. */
  profileRequest?: typeof peopleRequest;
  profileHref?: (id: string) => string;
  imageUrl?: PersonMediaUrl;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState<Filter>({ status: null, city: null }),
    [ownCity, setOwnCity] = useState<string | null>(null),
    [items, setItems] = useState<PublicPerson[]>([]),
    [relationships, setRelationships] = useState<Record<string, ConnectionRelationship>>({}),
    [viewerId, setViewerId] = useState<string | null>(null),
    [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [sending, setSending] = useState<string | null>(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const api = useRef(request),
    revision = useRef(0),
    controller = useRef<AbortController | null>(null);
  api.current = request;

  useEffect(() => {
    if (!active || preview) return;
    let live = true;
    profileRequest("me")
      .then((result) => {
        const city = result?.profile?.city;
        if (live && typeof city === "string" && city.trim()) setOwnCity(city.trim());
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [active, preview, profileRequest]);

  const load = useCallback(async () => {
    controller.current?.abort();
    const current = ++revision.current,
      nextController = new AbortController();
    controller.current = nextController;
    if (preview && api.current === connectionRequest) {
      setError(t("Pregled ljudi trenutno nije dostupan."));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: search, page: String(page) });
      if (filter.status) params.set("status", filter.status);
      if (filter.city) params.set("city", filter.city);
      const result = await api.current(`people?${params}`, { signal: nextController.signal });
      if (
        !Array.isArray(result.items) ||
        result.page !== page ||
        typeof result.hasMore !== "boolean"
      )
        throw new Error("invalid_people_list");
      const nextItems = result.items.map(readPublicPerson);
      const known: Record<string, ConnectionRelationship> = {};
      if (result.relationships && typeof result.relationships === "object")
        for (const person of nextItems) {
          const value = (result.relationships as Record<string, unknown>)[person.id];
          if (value === undefined) continue;
          const relationship = readRelationship(value);
          if (relationship.personId === person.id) known[person.id] = relationship;
        }
      if (nextController.signal.aborted || current !== revision.current) return;
      setItems(nextItems);
      setRelationships(known);
      setViewerId(typeof result.viewerId === "string" ? result.viewerId : null);
      setHasMore(result.hasMore);
      setReady(true);
    } catch (failure) {
      if (!nextController.signal.aborted && current === revision.current)
        setError(t(connectionError(failure)));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [filter, page, preview, search, t]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh repeats the same query after a failed read.
  useEffect(() => {
    if (active) void load();
    return () => {
      revision.current++;
      controller.current?.abort();
    };
  }, [active, load, refresh]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = query.trim();
    if (next !== search || page !== 1) {
      setReady(false);
      setSearch(next);
      setPage(1);
    } else setRefresh((value) => value + 1);
  }

  function choose(next: Filter) {
    setReady(false);
    setFilter(next);
    setPage(1);
  }

  /** Sends a friend request, or accepts one that person already sent. */
  async function befriend(person: PublicPerson) {
    const before = relationships[person.id];
    if (!before || sending) return;
    const incoming = before.status === "pending" && before.direction === "incoming";
    const path = incoming
      ? before.id
        ? `connections/${encodeURIComponent(before.id)}/accept`
        : null
      : `people/${encodeURIComponent(person.id)}/request`;
    if (!path) return;
    setSending(person.id);
    setError("");
    try {
      const result = await api.current(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: before.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const next = readRelationship(result.relationship);
      if (next.personId !== person.id || next.version <= before.version)
        throw new Error("unconfirmed_connection_action");
      setRelationships((known) => ({ ...known, [person.id]: next }));
    } catch (failure) {
      setError(t(connectionError(failure)));
      if (failure instanceof ConnectionRequestError && failure.status === 409)
        setRefresh((value) => value + 1);
    } finally {
      setSending(null);
    }
  }

  function rowAction(person: PublicPerson) {
    if (!viewerId || person.id === viewerId) return null;
    const relation = relationships[person.id];
    if (!relation) return null;
    if (relation.status === "accepted")
      return (
        <Link
          className={styles.messageLink}
          href={messageLink({ kind: "person", targetId: person.id })}
          aria-label={t("Poruka")}
          prefetch={false}
        >
          <Icon name="message" />
        </Link>
      );
    if (relation.status === "pending" && relation.direction === "outgoing")
      return (
        <span className={styles.rowSent} role="status">
          {t("Poslano")}
        </span>
      );
    const accept = relation.status === "pending" && relation.direction === "incoming";
    return (
      <button
        type="button"
        className={styles.rowAdd}
        disabled={sending !== null}
        aria-label={`${accept ? t("Prihvati") : t("Dodaj")} ${person.name}`}
        onClick={() => void befriend(person)}
      >
        <Icon name={accept ? "check" : "plus"} />
        {sending === person.id ? t("Spremanje…") : accept ? t("Prihvati") : t("Dodaj")}
      </button>
    );
  }

  const chips: { key: string; label: string; next: Filter; on: boolean }[] = [
    ...(ownCity
      ? [
          {
            key: "city",
            label: ownCity,
            next: { status: null, city: filter.city ? null : ownCity },
            on: filter.city !== null,
          },
        ]
      : []),
    {
      key: "open",
      label: t("Otvoreni za saradnju"),
      next: {
        status: filter.status === "open_to_collaboration" ? null : "open_to_collaboration",
        city: null,
      },
      on: filter.status === "open_to_collaboration",
    },
    {
      key: "owners",
      label: t("Vlasnici"),
      next: { status: filter.status === "business_owner" ? null : "business_owner", city: null },
      on: filter.status === "business_owner",
    },
  ];

  return (
    <section className={styles.workspace} aria-label={t("Ljudi na AhiBizzu")}>
      {heading && (
        <div className={styles.heading}>
          <h1>{t("Ljudi")}</h1>
        </div>
      )}
      <form className={styles.search} onSubmit={submit} aria-label={t("Pretraga ljudi")}>
        <label className={styles.searchField}>
          <Icon name="search" />
          <span className={styles.visuallyHidden}>{t("Ime, grad ili vještina")}</span>
          <input
            type="search"
            name="people"
            enterKeyHint="search"
            value={query}
            maxLength={100}
            placeholder={t("Ime, grad ili vještina")}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </form>
      <fieldset className={styles.tabs}>
        <legend className={styles.visuallyHidden}>{t("Suzi pretragu")}</legend>
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-pressed={chip.on}
            disabled={loading && !ready}
            onClick={() => choose(chip.next)}
          >
            {chip.label}
          </button>
        ))}
      </fieldset>
      {error && (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          <button
            type="button"
            className={styles.secondary}
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("Pokušaj ponovo")}
          </button>
        </div>
      )}
      {!ready && !error && (
        <section className={styles.grid} aria-busy="true" aria-label={t("Pretraga ljudi")}>
          {[0, 1].map((key) => (
            <div className={styles.skeleton} key={key} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ))}
        </section>
      )}
      {ready && items.length === 0 && !loading && (
        <div className={styles.empty}>
          <Icon name="user" />
          <h3>
            {search || filter.status || filter.city
              ? t("Nema rezultata za ovu pretragu.")
              : t("Još nema javnih profila.")}
          </h3>
          {search && <p>{t("Pokušaj s drugim imenom ili gradom.")}</p>}
        </div>
      )}
      {ready && items.length > 0 && (
        <ul className={styles.grid} aria-busy={loading}>
          {items.map((person) => {
            const line = [
              person.city,
              person.skills.length > 0
                ? person.skills.slice(0, 2).join(", ")
                : person.workStatus !== "not_specified"
                  ? t(workStatusLabels[person.workStatus])
                  : countryLabel(person.countryCode, locale),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={person.id} className={styles.personCard}>
                <div className={styles.personRow}>
                  <Link className={styles.personLink} href={profileHref(person.id)}>
                    <PersonAvatar person={person} imageUrl={imageUrl} />
                    <div className={styles.personInfo}>
                      <h3>
                        <bdi>{person.name}</bdi>
                        {person.verified && <VerificationBadge kind="person" />}
                      </h3>
                      {line && <p className={styles.location}>{line}</p>}
                    </div>
                  </Link>
                  {rowAction(person)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {ready && (
        <p className={styles.publicNote}>
          {t("Vide se samo ljudi koji su svoj profil postavili kao javan.")}
        </p>
      )}
      {ready && (page > 1 || hasMore) && (
        <nav className={styles.pagination} aria-label={t("Stranice ljudi")}>
          <button
            type="button"
            className={styles.secondary}
            disabled={loading || page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            {t("Prethodna")}
          </button>
          <span>{page}</span>
          <button
            type="button"
            className={styles.secondary}
            disabled={loading || !hasMore}
            onClick={() => setPage((value) => value + 1)}
          >
            {t("Sljedeća")}
          </button>
        </nav>
      )}
    </section>
  );
}
