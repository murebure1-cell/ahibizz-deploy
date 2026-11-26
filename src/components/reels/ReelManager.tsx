"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { msg } from "../../lib/i18n/translate";
import { packageName } from "../../lib/packages";
import { packageReels, type ReelAllowance, reelsLeft } from "../../lib/reel-allowance";
import {
  type ManagedReel,
  type ReelStatus,
  reelBusinessLimit,
  reelDuration,
  reelMaxBytes,
  reelMaxDuration,
  reelMedia,
  reelPartBytes,
  reelTimeLeft,
} from "../../lib/reels";
import { ConfirmButton } from "../ConfirmButton";
import { useT } from "../i18n/LocaleProvider";
import { previewFrame } from "./poster";
import styles from "./reels.module.css";

type Upload = {
  id: string;
  businessId: string;
  title: string;
  caption: string;
  source: File;
  posterFile: File | null;
  poster: Blob | null;
};

const statuses: Record<ReelStatus, string> = {
  uploading: msg("Prijenos nije završen"),
  pending: msg("Na pregledu"),
  published: msg("Objavljeno"),
  rejected: msg("Vraćeno"),
  withdrawn: msg("Povučeno"),
  expired: msg("Isteklo (24 h)"),
  removed: msg("Uklonio moderator"),
};

const problems: Record<string, string> = {
  REEL_INPUT: msg("Provjeri naziv, opis i odabrane datoteke."),
  REEL_CHANGED: msg("Stanje reela se promijenilo. Osvježi stranicu."),
  REEL_LIMIT: `Jedna djelatnost može imati najviše ${reelBusinessLimit} aktivna reela ili reela na pregledu.`,
  REEL_DAILY_LIMIT: msg("Dostignut je dnevni limit objava. Pokušaj ponovo sutra."),
  REEL_PACKAGE_LIMIT: msg("Iskoristio si reelse svog paketa za ovaj period."),
  REEL_POSTER_INVALID: msg("Odaberi statičnu JPG, PNG ili WebP naslovnicu do 768 KB."),
  REEL_VIDEO_INVALID: `Odaberi MP4 (H.264) snimak od 1 do ${reelMaxDuration} sekundi, do 1920 piksela po stranici.`,
  REEL_INCOMPLETE: msg("Nedostaje dio snimka. Pokušaj poslati ponovo."),
  REEL_NOT_FOUND: msg("Reel ili djelatnost više nije dostupna."),
  REEL_PART_SIZE: msg("Veličina datoteke premašuje dozvoljenu granicu."),
  REEL_BUSINESS_HIDDEN: msg("Djelatnost mora biti javno objavljena prije odobravanja reela."),
  REEL_BUSY: msg("Pregled snimka je trenutno zauzet. Pokušaj ponovo."),
  AUTHENTICATION_REQUIRED: msg("Prijavi se ponovo i pošalji reel."),
  COMMUNITY_RULES_REQUIRED: msg("Prihvati pravila zajednice za objavu reela."),
  ACCOUNT_IDENTITY_CHANGED: msg("Nalog je promijenjen. Osvježi stranicu."),
};
function describe(code: string) {
  return problems[code] ?? msg("Prijenos nije završen. Pokušaj ponovo.");
}

export function ReelManager({
  accountId,
  reels,
  businesses,
  businessId,
  admin,
  live = [],
  allowance = null,
}: {
  /** Where the account stands with its package's reels; the founder and admin have no limit. */
  allowance?: ReelAllowance | null;
  accountId: string;
  reels: ManagedReel[];
  businesses: { id: string; title: string }[];
  businessId?: string;
  admin: boolean;
  /** Moderators only: Reels that are public right now and can be taken down one by one. */
  live?: ManagedReel[];
}) {
  const t = useT();
  const router = useRouter();
  const active = useRef(false);
  const attempt = useRef<Upload | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [preview, setPreview] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);
  async function request(path: string, body: Blob, type: string, method: "PUT" | "POST") {
    const response = await fetch(`/api/reels/${path}`, {
      method,
      body,
      headers: { "Content-Type": type, "X-AhiBizz-Account-ID": accountId },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.code ?? (response.status === 413 ? "REEL_PART_SIZE" : "REEL_UNAVAILABLE"),
      );
    }
    return method === "POST" ? await response.json() : null;
  }
  function command(
    area: "mine" | "moderation",
    id: string,
    data: Record<string, string | number | boolean>,
  ) {
    return request(`${area}/${id}`, new Blob([JSON.stringify(data)]), "application/json", "POST");
  }
  function start() {
    if (active.current) return false;
    active.current = true;
    setBusy(true);
    setFeedback("");
    return true;
  }
  function end() {
    active.current = false;
    setBusy(false);
    setProgress(null);
  }
  async function upload(form: HTMLFormElement) {
    if (!start()) return;
    try {
      const fields = new FormData(form);
      const source = fields.get("video");
      const supplied = fields.get("poster");
      const title = String(fields.get("title") ?? "").trim();
      const caption = String(fields.get("caption") ?? "").trim();
      const businessId = String(fields.get("business") ?? "");
      if (!(source instanceof File) || source.size < 32 || !title || !businessId)
        throw new Error("REEL_INPUT");
      if (source.size > reelMaxBytes) throw new Error("REEL_PART_SIZE");
      const posterFile = supplied instanceof File && supplied.size ? supplied : null;
      if (posterFile && posterFile.size > reelPartBytes) throw new Error("REEL_POSTER_INVALID");
      const before = attempt.current;
      const matches = (a: File | null, b: File | null) =>
        a === b ||
        Boolean(
          a && b && a.name === b.name && a.size === b.size && a.lastModified === b.lastModified,
        );
      const same =
        before &&
        matches(before.source, source) &&
        matches(before.posterFile, posterFile) &&
        before.title === title &&
        before.caption === caption &&
        before.businessId === businessId;
      const upload = same
        ? before
        : {
            id: crypto.randomUUID(),
            businessId,
            title,
            caption,
            source,
            posterFile,
            poster: posterFile ?? (await previewFrame(source)),
          };
      attempt.current = upload;
      const first = await command("mine", upload.id, {
        action: "create",
        businessId,
        title,
        caption,
        bytes: source.size,
        poster: upload.poster !== null,
      });
      if (first.status === "uploading") {
        setProgress(0);
        if (upload.poster) {
          await request(
            `mine/${upload.id}/part/-1`,
            upload.poster,
            "application/octet-stream",
            "PUT",
          );
        }
        for (let start = 0; start < source.size; start += reelPartBytes) {
          const index = start / reelPartBytes;
          const through = Math.min(source.size, start + reelPartBytes);
          await request(
            `mine/${upload.id}/part/${index}`,
            source.slice(start, through),
            "application/octet-stream",
            "PUT",
          );
          setProgress(Math.round((through / source.size) * 100));
        }
        await command("mine", upload.id, { action: "submit" });
      }
      form.reset();
      attempt.current = null;
      setFeedback(t("Reel je poslan na pregled."));
      router.refresh();
    } catch (error) {
      setFeedback(t(describe(error instanceof Error ? error.message : "")));
      router.refresh();
    } finally {
      end();
    }
  }
  async function decide(
    reel: ManagedReel,
    action: "approve" | "reject" | "withdraw" | "remove",
    reason?: string,
  ) {
    if (!start()) return;
    try {
      const data: Record<string, string | number | boolean> =
        action === "withdraw"
          ? { action, expected: reel.status }
          : action === "reject" || action === "remove"
            ? { action, reason: reason?.trim() ?? "" }
            : { action };
      await command(admin ? "moderation" : "mine", reel.id, data);
      setRemoved((items) => [...items, reel.id]);
      if (preview === reel.id) setPreview("");
      setFeedback(
        action === "approve"
          ? t("Reel je objavljen.")
          : action === "reject"
            ? t("Reel je vraćen.")
            : action === "remove"
              ? t("Reel je uklonjen, a snimak i naslovnica obrisani.")
              : t("Reel je povučen."),
      );
      router.refresh();
    } catch (error) {
      setFeedback(t(describe(error instanceof Error ? error.message : "")));
      router.refresh();
    } finally {
      end();
    }
  }
  const selected = businesses.some((business) => business.id === businessId)
    ? businessId
    : businesses[0]?.id;
  const visible = reels.filter((reel) => !removed.includes(reel.id));
  return (
    <>
      {!admin && allowance && <AllowanceCard allowance={allowance} />}
      {!admin &&
        (businesses.length ? (
          <details className={styles.publishBox}>
            <summary className={styles.publishButton}>{t("Objavi reel")}</summary>
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void upload(event.currentTarget);
              }}
            >
              <fieldset disabled={busy}>
                <legend>{t("Novi reel")}</legend>
                <label>
                  {t("Djelatnost")}
                  <select name="business" defaultValue={selected} required>
                    {businesses.map((business) => (
                      <option value={business.id} key={business.id}>
                        <bdi>{business.title}</bdi>
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Naziv snimka")}
                  <input name="title" maxLength={100} required />
                </label>
                <label>
                  {t("Opis")} <span>(opcionalno)</span>
                  <textarea name="caption" maxLength={600} rows={3} />
                </label>
                <label>
                  {t("Video")}
                  <input name="video" type="file" accept="video/mp4,.mp4" required />
                  <small>{t("MP4 (H.264), 1–90 sekundi, do 24 MB.")}</small>
                </label>
                <label>
                  {t("Naslovnica")} <span>(opcionalno)</span>
                  <input name="poster" type="file" accept="image/png,image/jpeg,image/webp" />
                  <small>
                    {t("JPG, PNG ili WebP do 768 KB. Može se izdvojiti i kadar iz snimka.")}
                  </small>
                </label>
                <button type="submit" className={styles.primary}>
                  {busy ? t("Obrađuje se…") : t("Pošalji na pregled")}
                </button>
              </fieldset>
            </form>
          </details>
        ) : (
          <p className={styles.empty}>
            {t("Objavi djelatnost prije dodavanja reela.")}{" "}
            <Link href="/nalog?odjeljak=djelatnosti">{t("Moje djelatnosti")}</Link>
          </p>
        ))}
      {!admin && allowance && <PackageReels current={allowance.package} />}
      {progress !== null && (
        <progress value={progress} max={100} aria-label={t("Napredak prijenosa")}>
          {progress}%
        </progress>
      )}
      {feedback && (
        <p className={styles.feedback} role="status">
          {feedback}
        </p>
      )}
      <section
        className={styles.manageList}
        aria-label={admin ? t("Reels za pregled") : t("Moji reels")}
      >
        <h2>{admin ? t("Čekaju pregled") : t("Moje objave")}</h2>
        {!visible.length && (
          <p className={styles.empty}>
            {admin ? t("Trenutno nema novih zahtjeva.") : t("Još nema reelova.")}
          </p>
        )}
        {visible.map((reel) => (
          <article key={reel.id} id={`reel-${reel.id}`} className={styles.managed}>
            <div className={styles.entry}>
              <div>
                <h3 dir="auto">{reel.title}</h3>
                <p>
                  <bdi>{reel.businessTitle}</bdi>
                  {reel.durationMs !== null ? ` · ${reelDuration(reel.durationMs)}` : ""}
                </p>
              </div>
              <span className={styles.status} data-status={reel.status}>
                {t(statuses[reel.status])}
              </span>
            </div>
            {reel.caption && <p className={styles.caption}>{reel.caption}</p>}
            {reel.reviewReason && (
              <p className={styles.caption}>
                {reel.status === "removed" ? t("Razlog uklanjanja") : t("Razlog vraćanja")} ·{" "}
                {reel.reviewReason}
              </p>
            )}
            {reel.status === "published" && reel.expiresAt && (
              <p className={styles.caption}>Vidljivo {reelTimeLeft(reel.expiresAt)}</p>
            )}
            {(reel.status === "pending" || reel.status === "published") && reel.id !== preview && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setPreview(reel.id)}
              >
                {t("Pregledaj snimak")}
              </button>
            )}
            {preview === reel.id && (
              <div className={styles.clipPreview}>
                {/* biome-ignore lint/a11y/useMediaCaption: Authors can show captions in their video and provide a text alternative in its description. */}
                <video
                  controls
                  playsInline
                  preload="none"
                  src={reelMedia(reel.id, "video", true)}
                  poster={reel.hasPoster ? reelMedia(reel.id, "poster", true) : undefined}
                  aria-label={reel.title}
                />
                <button type="button" className={styles.secondary} onClick={() => setPreview("")}>
                  {t("Zatvori pregled")}
                </button>
              </div>
            )}
            {admin ? (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || preview !== reel.id}
                  onClick={() => void decide(reel, "approve")}
                >
                  {t("Odobri i objavi")}
                </button>
                <form
                  className={styles.reject}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void decide(
                      reel,
                      "reject",
                      String(new FormData(event.currentTarget).get("reason") ?? ""),
                    );
                  }}
                >
                  <label>
                    {t("Razlog vraćanja")}
                    <input name="reason" maxLength={600} required disabled={busy} />
                  </label>
                  <button type="submit" className={styles.secondary} disabled={busy}>
                    {t("Vrati vlasniku")}
                  </button>
                </form>
              </div>
            ) : (
              <div className={styles.actions}>
                {reel.status === "published" && (
                  <Link href={`/reels/${reel.id}`}>{t("Javna objava")}</Link>
                )}
                {reel.status !== "removed" && (
                  <ConfirmButton
                    disabled={busy}
                    className={styles.secondary}
                    title={reel.status === "expired" ? t("Skloniti s liste?") : t("Obrisati reel?")}
                    description={
                      reel.status === "expired"
                        ? t("Snimak je već obrisan nakon 24 sata.")
                        : t("Reel se odmah skida s prikaza, a snimak i naslovnica se brišu.")
                    }
                    confirmLabel={reel.status === "expired" ? t("Skloni") : t("Obriši reel")}
                    onConfirm={() => void decide(reel, "withdraw")}
                  >
                    {reel.status === "expired" ? t("Skloni s liste") : t("Obriši reel")}
                  </ConfirmButton>
                )}
              </div>
            )}
          </article>
        ))}
      </section>
      {admin && (
        <section className={styles.manageList} aria-label={t("Objavljeni reels")}>
          <h2>{t("Objavljeno sada")}</h2>
          {!live.filter((reel) => !removed.includes(reel.id)).length && (
            <p className={styles.empty}>{t("Trenutno nema objavljenih reelova.")}</p>
          )}
          {live
            .filter((reel) => !removed.includes(reel.id))
            .map((reel) => (
              <article key={reel.id} id={`uzivo-${reel.id}`} className={styles.managed}>
                <div className={styles.entry}>
                  <div>
                    <h3 dir="auto">{reel.title}</h3>
                    <p>
                      <bdi>{reel.businessTitle}</bdi>
                      {reel.expiresAt ? ` · ${reelTimeLeft(reel.expiresAt)}` : ""}
                    </p>
                  </div>
                  <Link href={`/reels/${reel.id}`}>{t("Otvori")}</Link>
                </div>
                <form
                  className={styles.reject}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void decide(
                      reel,
                      "remove",
                      String(new FormData(event.currentTarget).get("reason") ?? ""),
                    );
                  }}
                >
                  <label>
                    {t("Razlog uklanjanja")}
                    <input name="reason" maxLength={600} required disabled={busy} />
                  </label>
                  <button type="submit" className={styles.secondary} disabled={busy}>
                    {t("Ukloni reel")}
                  </button>
                </form>
              </article>
            ))}
        </section>
      )}
    </>
  );
}

const dayNames = ["P", "U", "S", "Č", "P", "S", "N"];

/** "Danas možeš objaviti …" with this week's days, as drawn (MojiReels). */
function AllowanceCard({ allowance }: { allowance: ReelAllowance }) {
  const t = useT();
  const left = reelsLeft(allowance);
  const heading =
    left === null
      ? t("Reelse objavljuješ bez ograničenja.")
      : left === 0
        ? allowance.period === "day"
          ? t("Danas si objavio svoj reel. Sljedeći sutra.")
          : t("Ove sedmice si objavio sve svoje reelse.")
        : allowance.period === "day"
          ? t("Danas možeš objaviti {count} reel", { count: left })
          : t("Ove sedmice možeš objaviti još {count}", { count: left });
  return (
    <section className={styles.allowance} aria-label={t("Reels ove sedmice")}>
      <div className={styles.allowanceHead}>
        <strong>{heading}</strong>
        {allowance.limit !== null && (
          <span>{t("{count} od {limit}", { count: allowance.used, limit: allowance.limit })}</span>
        )}
      </div>
      <ol className={styles.week}>
        {allowance.week.map((state, day) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the seven days of the week never move.
          <li key={day} data-state={state}>
            {dayNames[day]}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** How many reels each package gives, with the account's own package marked. */
function PackageReels({ current }: { current: ReelAllowance["package"] }) {
  const t = useT();
  const text = {
    week: (count: number) => t("{count} sedmično", { count }),
    day: (count: number) => (count === 1 ? t("1 svaki dan") : t("{count} dnevno", { count })),
  };
  return (
    <section className={styles.packages}>
      <h2>{t("Koliko reelsa po paketu")}</h2>
      <ul>
        {(Object.keys(packageReels) as (keyof typeof packageReels)[]).map((id) => {
          const rule = packageReels[id];
          return (
            <li key={id} data-current={id === current ? "" : undefined}>
              <span>{packageName(id)}</span>
              {id === current && <em>{t("Tvoj paket")}</em>}
              <span>{text[rule.period](rule.limit)}</span>
            </li>
          );
        })}
      </ul>
      <p>{t("Sedmica počinje u ponedjeljak. Neiskorišteni reels se ne prenose.")}</p>
    </section>
  );
}
