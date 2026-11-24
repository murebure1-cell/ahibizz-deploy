"use client";

import Image from "next/image";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { type PublicPerson, publicPersonImageUrl, readPublicPerson } from "../../lib/connections";
import { connectionError, connectionRequest } from "../../lib/connections-client";
import type { Locale } from "../../lib/i18n/locales";
import { countryLabel, workStatusLabels } from "../../lib/people";
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

export function PeopleSearch({
  active = true,
  heading = true,
  preview = false,
  request = connectionRequest,
  profileHref = (id: string) => `/ljudi/${encodeURIComponent(id)}`,
  imageUrl,
}: {
  active?: boolean;
  heading?: boolean;
  preview?: boolean;
  request?: typeof connectionRequest;
  profileHref?: (id: string) => string;
  imageUrl?: PersonMediaUrl;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [items, setItems] = useState<PublicPerson[]>([]),
    [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const api = useRef(request),
    revision = useRef(0),
    controller = useRef<AbortController | null>(null);
  api.current = request;

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
      const result = await api.current(`people?${params}`, { signal: nextController.signal });
      if (
        !Array.isArray(result.items) ||
        result.page !== page ||
        typeof result.hasMore !== "boolean"
      )
        throw new Error("invalid_people_list");
      const nextItems = result.items.map(readPublicPerson);
      if (nextController.signal.aborted || current !== revision.current) return;
      setItems(nextItems);
      setHasMore(result.hasMore);
      setReady(true);
    } catch (failure) {
      if (!nextController.signal.aborted && current === revision.current)
        setError(t(connectionError(failure)));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [page, preview, search, t]);

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
          <span className={styles.visuallyHidden}>{t("Ime ili grad")}</span>
          <input
            type="search"
            name="people"
            value={query}
            maxLength={100}
            placeholder={t("Ime ili grad")}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" className={styles.primary} disabled={loading}>
          {t("Pronađi")}
        </button>
      </form>
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
          <h3>{search ? t("Nema rezultata za ovu pretragu.") : t("Još nema javnih profila.")}</h3>
          {search && <p>{t("Pokušaj s drugim imenom ili gradom.")}</p>}
        </div>
      )}
      {ready && items.length > 0 && (
        <ul className={styles.grid} aria-busy={loading}>
          {items.map((person) => (
            <li key={person.id} className={styles.personCard}>
              <Link className={styles.personLink} href={profileHref(person.id)}>
                <PersonAvatar person={person} imageUrl={imageUrl} />
                <div className={styles.personInfo}>
                  <h3>
                    {person.name}
                    {person.verified && <VerificationBadge kind="person" />}
                  </h3>
                  {personLocation(person, locale) && (
                    <p className={styles.location}>
                      <Icon name="pin" />
                      {personLocation(person, locale)}
                    </p>
                  )}
                  {person.workStatus !== "not_specified" && (
                    <p className={styles.personWork}>{t(workStatusLabels[person.workStatus])}</p>
                  )}
                  {person.skills.length > 0 && (
                    <ul className={styles.skills} aria-label={t("Vještine")}>
                      {person.skills.slice(0, 3).map((skill) => (
                        <li key={skill}>{skill}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <Icon name="chevron" />
              </Link>
            </li>
          ))}
        </ul>
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
