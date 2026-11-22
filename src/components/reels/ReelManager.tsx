"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { creditTopUpPath } from "../../lib/account-return";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import {
  type ManagedReel,
  type ReelStatus,
  reelBusinessLimit,
  reelDuration,
  reelMaxBytes,
  reelMaxDuration,
  reelMedia,
  reelPartBytes,
  reelResubmissionNotice,
} from "../../lib/reels";
import { formatAhiCredits } from "../../lib/wallet";
import { previewFrame } from "./poster";
import styles from "./reels.module.css";

type Upload = {
  id: string;
  businessId: string;
  title: string;
  caption: string;
  priceCredits: number;
  source: File;
  posterFile: File | null;
  poster: Blob | null;
};

const statuses: Record<ReelStatus, string> = {
  uploading: "Prijenos nije završen",
  pending: "Na pregledu",
  published: "Objavljeno",
  rejected: "Vraćeno",
  withdrawn: "Povučeno",
};

const problems: Record<string, string> = {
  REEL_INPUT: "Provjeri naziv, opis i odabrane datoteke.",
  REEL_CHANGED: "Stanje reela se promijenilo. Osvježi stranicu.",
  REEL_PRICE_CHANGED: "Cijena objave se promijenila. Provjeri novi iznos i pošalji ponovo.",
  REEL_PRICE_UNAVAILABLE: "Objava reelova trenutno nije dostupna.",
  REEL_PRICE_REQUIRED: "Za objavu vlasnik treba ponovo poslati reel uz potvrdu cijene.",
  WALLET_PAYMENT_CHANGED: "Naplata za ovaj reel se promijenila. Provjeri stanje objave.",
  REEL_LIMIT: `Jedna djelatnost može imati najviše ${reelBusinessLimit} aktivna reela ili reela na pregledu.`,
  REEL_DAILY_LIMIT: "Dostignut je dnevni limit objava. Pokušaj ponovo sutra.",
  REEL_POSTER_INVALID: "Odaberi statičnu JPG, PNG ili WebP naslovnicu do 768 KB.",
  REEL_VIDEO_INVALID: `Odaberi MP4 (H.264) snimak od 1 do ${reelMaxDuration} sekundi, do 1920 piksela po stranici.`,
  REEL_INCOMPLETE: "Nedostaje dio snimka. Pokušaj poslati ponovo.",
  REEL_NOT_FOUND: "Reel ili djelatnost više nije dostupna.",
  REEL_PART_SIZE: "Veličina datoteke premašuje dozvoljenu granicu.",
  REEL_BUSINESS_HIDDEN: "Djelatnost mora biti javno objavljena prije odobravanja reela.",
  REEL_BUSY: "Pregled snimka je trenutno zauzet. Pokušaj ponovo.",
  AUTHENTICATION_REQUIRED: "Prijavi se ponovo i pošalji reel.",
  COMMUNITY_RULES_REQUIRED: "Prihvati pravila zajednice za objavu reela.",
  ACCOUNT_IDENTITY_CHANGED: "Nalog je promijenjen. Osvježi stranicu.",
};
function describe(code: string, admin: boolean) {
  if (code === "INSUFFICIENT_CREDITS")
    return admin
      ? "Vlasnik nema dovoljno Ahi kredita. Reel ostaje na pregledu do dopune."
      : "Nemaš dovoljno Ahi kredita za objavu.";
  return problems[code] ?? "Prijenos nije završen. Pokušaj ponovo.";
}

function formatCredits(amount: number) {
  return formatAhiCredits(Math.round(amount * 100));
}

export function ReelManager({
  accountId,
  reels,
  businesses,
  businessId,
  admin,
  priceCredits,
  balance,
}: {
  accountId: string;
  reels: ManagedReel[];
  businesses: { id: string; title: string }[];
  businessId?: string;
  admin: boolean;
  priceCredits: number | null;
  balance: number | null;
}) {
  const router = useRouter();
  const active = useRef(false);
  const attempt = useRef<Upload | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [preview, setPreview] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);
  const insufficient = priceCredits !== null && balance !== null && balance < priceCredits;
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
      if (priceCredits === null || balance === null) throw new Error("REEL_PRICE_UNAVAILABLE");
      if (insufficient) throw new Error("INSUFFICIENT_CREDITS");
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
        before.businessId === businessId &&
        before.priceCredits === priceCredits;
      const upload = same
        ? before
        : {
            id: crypto.randomUUID(),
            businessId,
            title,
            caption,
            priceCredits,
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
        priceCredits: upload.priceCredits,
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
      setFeedback("Reel je poslan na pregled.");
      router.refresh();
    } catch (error) {
      setFeedback(describe(error instanceof Error ? error.message : "", admin));
      router.refresh();
    } finally {
      end();
    }
  }
  async function decide(
    reel: ManagedReel,
    action: "approve" | "reject" | "withdraw",
    reason?: string,
  ) {
    if (!start()) return;
    try {
      const data: Record<string, string | number | boolean> =
        action === "withdraw"
          ? { action, expected: reel.status }
          : action === "reject"
            ? { action, reason: reason?.trim() ?? "" }
            : { action };
      await command(admin ? "moderation" : "mine", reel.id, data);
      setRemoved((items) => [...items, reel.id]);
      if (preview === reel.id) setPreview("");
      setFeedback(
        action === "approve"
          ? "Reel je objavljen."
          : action === "reject"
            ? "Reel je vraćen."
            : "Reel je povučen.",
      );
      router.refresh();
    } catch (error) {
      setFeedback(describe(error instanceof Error ? error.message : "", admin));
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
      {!admin && IS_PLAY_EDITION && (
        <p className={styles.empty}>Objava Reelsa trenutno nije dostupna u ovom izdanju.</p>
      )}
      {!admin &&
        !IS_PLAY_EDITION &&
        (businesses.length ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void upload(event.currentTarget);
            }}
          >
            <fieldset disabled={busy}>
              <legend>Novi reel</legend>
              <div className={styles.payment}>
                <div className={styles.paymentSummary}>
                  {priceCredits !== null && <strong>Objava · {formatCredits(priceCredits)}</strong>}
                  {balance !== null && <span>Stanje · {formatCredits(balance)}</span>}
                </div>
                <p id="reel-payment-terms">
                  {priceCredits === null || balance === null
                    ? "Objava reelova trenutno nije dostupna."
                    : "Krediti se skidaju jednom, nakon odobrenja. Odbijeni reel se ne naplaćuje."}
                </p>
                {insufficient && (
                  <p className={styles.paymentWarning}>
                    Nemaš dovoljno Ahi kredita.{" "}
                    <Link
                      href={creditTopUpPath(
                        selected ? `/nalog/reels?djelatnost=${selected}` : "/nalog/reels",
                      )}
                    >
                      Dopuni kredite
                    </Link>
                  </p>
                )}
              </div>
              <label>
                Djelatnost
                <select name="business" defaultValue={selected} required>
                  {businesses.map((business) => (
                    <option value={business.id} key={business.id}>
                      {business.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Naziv snimka
                <input name="title" maxLength={100} required />
              </label>
              <label>
                Opis <span>(opcionalno)</span>
                <textarea name="caption" maxLength={600} rows={3} />
              </label>
              <label>
                Video
                <input name="video" type="file" accept="video/mp4,.mp4" required />
                <small>MP4 (H.264), 1–90 sekundi, do 24 MB.</small>
              </label>
              <label>
                Naslovnica <span>(opcionalno)</span>
                <input name="poster" type="file" accept="image/png,image/jpeg,image/webp" />
                <small>JPG, PNG ili WebP do 768 KB. Može se izdvojiti i kadar iz snimka.</small>
              </label>
              <button
                type="submit"
                className={styles.primary}
                aria-describedby="reel-payment-terms"
                disabled={priceCredits === null || balance === null || insufficient}
              >
                {busy ? "Obrađuje se…" : "Potvrdi cijenu i pošalji"}
              </button>
            </fieldset>
          </form>
        ) : (
          <p className={styles.empty}>
            Objavi djelatnost prije dodavanja reela.{" "}
            <Link href="/nalog?odjeljak=djelatnosti">Moje djelatnosti</Link>
          </p>
        ))}
      {progress !== null && (
        <progress value={progress} max={100} aria-label="Napredak prijenosa">
          {progress}%
        </progress>
      )}
      {feedback && (
        <p className={styles.feedback} role="status">
          {feedback}
        </p>
      )}
      <section className={styles.manageList} aria-label={admin ? "Reels za pregled" : "Moji reels"}>
        <h2>{admin ? "Čekaju pregled" : "Moje objave"}</h2>
        {!visible.length && (
          <p className={styles.empty}>
            {admin ? "Trenutno nema novih zahtjeva." : "Još nema reelova."}
          </p>
        )}
        {visible.map((reel) => (
          <article key={reel.id} id={`reel-${reel.id}`} className={styles.managed}>
            <div className={styles.entry}>
              <div>
                <h3>{reel.title}</h3>
                <p>
                  {reel.businessTitle}
                  {reel.durationMs !== null ? ` · ${reelDuration(reel.durationMs)}` : ""}
                </p>
              </div>
              <span className={styles.status} data-status={reel.status}>
                {statuses[reel.status]}
              </span>
            </div>
            {reel.priceCredits !== null && (
              <p className={styles.paymentHistory}>
                {formatCredits(reel.priceCredits)} ·{" "}
                {reel.paid
                  ? "Plaćeno"
                  : reel.status === "rejected"
                    ? "Bez naplate"
                    : "Po odobrenju"}
              </p>
            )}
            {reel.status === "pending" && reel.priceCredits === null && (
              <p className={styles.paymentWarning}>
                {reelResubmissionNotice(admin, IS_PLAY_EDITION)}
              </p>
            )}
            {reel.caption && <p className={styles.caption}>{reel.caption}</p>}
            {reel.reviewReason && (
              <p className={styles.caption}>Razlog vraćanja · {reel.reviewReason}</p>
            )}
            {(reel.status === "pending" || reel.status === "published") && reel.id !== preview && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setPreview(reel.id)}
              >
                Pregledaj snimak
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
                  Zatvori pregled
                </button>
              </div>
            )}
            {admin ? (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || preview !== reel.id || reel.priceCredits === null}
                  onClick={() => void decide(reel, "approve")}
                >
                  Odobri i objavi
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
                    Razlog vraćanja
                    <input name="reason" maxLength={600} required disabled={busy} />
                  </label>
                  <button type="submit" className={styles.secondary} disabled={busy}>
                    Vrati vlasniku
                  </button>
                </form>
              </div>
            ) : (
              <div className={styles.actions}>
                {reel.status === "published" && (
                  <Link href={`/reels/${reel.id}`}>Javna objava</Link>
                )}
                <button
                  type="button"
                  disabled={busy}
                  className={styles.secondary}
                  onClick={() => {
                    if (window.confirm("Povući ovaj reel? Snimak i naslovnica će se ukloniti."))
                      void decide(reel, "withdraw");
                  }}
                >
                  Povuci reel
                </button>
              </div>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
