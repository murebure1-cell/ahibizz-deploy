"use client";
import Link from "next/link";
import { useEffect } from "react";
import { authReturnLinks } from "../../lib/auth-return";
import { favoriteId } from "../../lib/favorites";
import { Icon } from "../Icon";
import { useFavorites } from "./FavoritesProvider";
import styles from "./favorites.module.css";

export function FavoriteButton({
  businessId,
  title,
  compact = false,
}: {
  businessId: string;
  title: string;
  compact?: boolean;
}) {
  const context = useFavorites(),
    register = context?.register;
  useEffect(() => {
    if (register && favoriteId(businessId)) return register(businessId);
  }, [register, businessId]);
  if (!context || !favoriteId(businessId)) return null;
  const { states, status, errors, busy, refresh, toggle, retry } = context,
    state = states.get(businessId),
    error = errors.get(businessId);
  const label = error
    ? "Provjeri sačuvani profil"
    : state?.saved
      ? "Ukloni iz sačuvanih"
      : "Sačuvaj profil";
  const icon = <Icon name="heart" fill={state?.saved ? "currentColor" : "none"} />;
  if (status === "anonymous")
    return (
      <Link
        className={styles.button}
        data-compact={compact}
        id={compact ? undefined : "sacuvaj"}
        href={authReturnLinks(`/djelatnosti/${businessId}#sacuvaj`).login}
        title="Prijavi se i sačuvaj profil"
        aria-label={`Prijavi se i sačuvaj — ${title}`}
      >
        {icon}
        {!compact && "Sačuvaj"}
      </Link>
    );
  return (
    <span className={styles.control} data-compact={compact} id={compact ? undefined : "sacuvaj"}>
      <button
        className={styles.button}
        data-compact={compact}
        data-saved={Boolean(state?.saved)}
        type="button"
        aria-label={`${label} — ${title}`}
        aria-pressed={Boolean(state?.saved)}
        title={status === "denied" ? "Sačuvani profili nisu dostupni ovom nalogu" : label}
        disabled={
          busy.has(businessId) ||
          status === "checking" ||
          status === "denied" ||
          (status === "signed" && !state)
        }
        onClick={() => (error || status === "unavailable" ? refresh() : toggle(businessId))}
      >
        {icon}
        {!compact && (error ? "Provjeri" : state?.saved ? "Sačuvano" : "Sačuvaj")}
      </button>
      {error && (
        <span className={styles.error}>
          <span role="alert">{error}</span>
          {error.startsWith("Promjena nije potvrđena.") && (
            <button
              className={styles.recovery}
              type="button"
              disabled={busy.has(businessId)}
              onClick={() => retry(businessId)}
            >
              Ponovi isti pokušaj
            </button>
          )}
        </span>
      )}
    </span>
  );
}
