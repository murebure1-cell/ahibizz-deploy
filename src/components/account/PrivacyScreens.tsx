"use client";
import { useCallback, useEffect, useState } from "react";
import { type AccountChoices, accountChoicesRequest } from "../../lib/account-choices";
import { exportParts } from "../../lib/account-export";
import { type ProfileVisibility, readProfileVisibility } from "../../lib/connections";
import { connectionAccountRequest, connectionRequest } from "../../lib/connections-client";
import { Icon, type IconName } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import { DevicePush } from "../pwa/DevicePush";
import { RowGroup, rowStyles } from "../ui/Rows";
import { Switch } from "../ui/Switch";
import styles from "./privacy.module.css";

/** Reads and changes the account's choices, keeping the last confirmed answer on screen. */
function useChoices(accountId: string) {
  const [choices, setChoices] = useState<AccountChoices | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    accountChoicesRequest(accountId, undefined, controller.signal)
      .then(setChoices)
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [accountId]);
  const change = useCallback(
    async (next: Partial<AccountChoices>) => {
      if (busy) return;
      setBusy(true);
      setError(false);
      try {
        setChoices(await accountChoicesRequest(accountId, next));
      } catch {
        setError(true);
      } finally {
        setBusy(false);
      }
    },
    [accountId, busy],
  );
  return { choices, busy, error, change };
}

function SwitchRow({
  icon,
  title,
  sub,
  checked,
  disabled,
  onChange,
}: {
  icon?: IconName;
  title: string;
  sub?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className={rowStyles.row} data-two={sub ? "" : undefined}>
      {icon && <Icon name={icon} className={rowStyles.icon} />}
      <span className={rowStyles.text}>
        <span className={rowStyles.title}>{title}</span>
        {sub && <span className={rowStyles.sub}>{sub}</span>}
      </span>
      <Switch checked={checked} disabled={disabled} label={title} onChange={onChange} />
    </div>
  );
}

/** "Vidljivost profila" as drawn: public or hidden, then what others see. */
export function ProfileVisibilityScreen({ accountId }: { accountId: string }) {
  const t = useT();
  const { choices, busy, error, change } = useChoices(accountId);
  const [visibility, setVisibility] = useState<ProfileVisibility | null>(null),
    [saving, setSaving] = useState(false),
    [visibilityError, setVisibilityError] = useState(false);
  const load = useCallback(async () => {
    try {
      const data = await connectionAccountRequest(connectionRequest, accountId, "visibility");
      setVisibility(readProfileVisibility(data.visibility));
    } catch {
      setVisibilityError(true);
    }
  }, [accountId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function choose(isPublic: boolean) {
    if (!visibility || saving || visibility.isPublic === isPublic) return;
    setSaving(true);
    setVisibilityError(false);
    try {
      const data = await connectionAccountRequest(connectionRequest, accountId, "visibility", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isPublic,
          expectedVersion: visibility.profileVersion,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setVisibility(readProfileVisibility(data.visibility));
    } catch {
      setVisibilityError(true);
      await load();
    } finally {
      setSaving(false);
    }
  }
  const options = [
    {
      value: true,
      title: t("Javan"),
      sub: t("Profil se vidi u pretrazi ljudi i na djelatnostima"),
    },
    { value: false, title: t("Skriven"), sub: t("Profil vidiš samo ti.") },
  ];
  return (
    <>
      <RowGroup>
        <fieldset className={styles.choice} disabled={!visibility || saving}>
          <legend className={styles.srOnly}>{t("Vidljivost profila")}</legend>
          {options.map((option) => (
            <label key={String(option.value)} className={rowStyles.row} data-two="">
              <input
                type="radio"
                name="vidljivost"
                checked={visibility?.isPublic === option.value}
                onChange={() => void choose(option.value)}
              />
              <span className={styles.radio} aria-hidden="true" />
              <span className={rowStyles.text}>
                <span className={rowStyles.title}>{option.title}</span>
                <span className={rowStyles.sub}>{option.sub}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </RowGroup>
      <RowGroup title={t("Šta drugi vide")}>
        <SwitchRow
          icon="pin"
          title={t("Grad")}
          checked={choices?.showCity ?? true}
          disabled={!choices || busy}
          onChange={(showCity) => void change({ showCity })}
        />
        <SwitchRow
          icon="people"
          title={t("Broj prijatelja")}
          checked={choices?.showFriendCount ?? true}
          disabled={!choices || busy}
          onChange={(showFriendCount) => void change({ showFriendCount })}
        />
      </RowGroup>
      {(error || visibilityError) && (
        <p role="alert" className={styles.error}>
          {t("Promjena nije potvrđena. Pokušaj kasnije.")}
        </p>
      )}
      <p className={styles.note}>{t("Djelatnosti su uvijek javne dok su objavljene.")}</p>
    </>
  );
}

/** "Obavijesti" as drawn: this device, then each kind on the phone and by email. */
export function NotificationChoicesScreen({ accountId }: { accountId: string }) {
  const t = useT();
  const { choices, busy, error, change } = useChoices(accountId);
  const rows: {
    title: string;
    sub: string;
    phone: keyof AccountChoices | null;
    email: "always" | null;
  }[] = [
    { title: t("Poruke"), sub: t("Nova poruka"), phone: "pushMessages", email: null },
    {
      title: t("Termini i rezervacije"),
      sub: t("Zahtjevi, potvrde, otkazivanja"),
      phone: "pushBookings",
      email: null,
    },
    { title: t("Reels"), sub: t("Objava ili odbijanje reela"), phone: "pushReels", email: null },
    {
      title: t("Nalog i sigurnost"),
      sub: t("Odobrenje naloga, lozinka, potvrda emaila"),
      phone: null,
      email: "always",
    },
  ];
  return (
    <>
      <section className={styles.device} aria-label={t("Obavijesti na ovom uređaju")}>
        <DevicePush actor={accountId} />
      </section>
      <div className={styles.table}>
        <div className={styles.heads} aria-hidden="true">
          <span>{t("Telefon")}</span>
          <span>{t("Email")}</span>
        </div>
        <div className={rowStyles.card}>
          {rows.map((row) => (
            <div key={row.title} className={`${rowStyles.row} ${styles.kind}`} data-two="">
              <span className={rowStyles.text}>
                <span className={rowStyles.title}>{row.title}</span>
                <span className={rowStyles.sub}>{row.sub}</span>
              </span>
              <span className={styles.cell}>
                {row.phone ? (
                  <Switch
                    checked={choices?.[row.phone] ?? true}
                    disabled={!choices || busy}
                    label={`${row.title} · ${t("Telefon")}`}
                    onChange={(next) => {
                      const key = row.phone as keyof AccountChoices;
                      void change({ [key]: next });
                    }}
                  />
                ) : (
                  <span className={styles.none} title={t("Ne šalje se na telefon")}>
                    —
                  </span>
                )}
              </span>
              <span className={styles.cell}>
                {row.email === "always" ? (
                  <Switch
                    checked
                    disabled
                    label={`${row.title} · ${t("Email")}`}
                    onChange={() => {}}
                  />
                ) : (
                  <span className={styles.none} title={t("Ne šalje se emailom")}>
                    —
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {t("Promjena nije potvrđena. Pokušaj kasnije.")}
        </p>
      )}
      <p className={styles.note}>{t("Mailovi o nalogu i plaćanju stižu uvijek.")}</p>
    </>
  );
}

/** "Preuzmi svoje podatke" as drawn: choose the parts, then download one file. */
export function DataExportScreen() {
  const t = useT();
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(exportParts.filter((part) => part.preset).map((part) => part.query)),
  );
  const query = exportParts
    .filter((part) => chosen.has(part.query))
    .map((part) => part.query)
    .join(",");
  return (
    <>
      <p className={rowStyles.lead}>
        {t("Pripremamo arhivu sa svim što si unio na AhiBizz. Preuzima se odmah, kao jedan fajl.")}
      </p>
      <RowGroup>
        {exportParts.map((part) => (
          <label key={part.query} className={rowStyles.row}>
            <input
              type="checkbox"
              className={styles.check}
              checked={chosen.has(part.query)}
              onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) next.add(part.query);
                else next.delete(part.query);
                setChosen(next);
              }}
            />
            <span className={rowStyles.text}>
              <span className={rowStyles.title}>{t(part.label)}</span>
            </span>
          </label>
        ))}
      </RowGroup>
      <div className={styles.actions}>
        {query ? (
          <a
            className={styles.primary}
            href={`/api/account/export?dijelovi=${encodeURIComponent(query)}`}
            download
          >
            <Icon name="download" />
            {t("Pripremi arhivu")}
          </a>
        ) : (
          <span className={styles.primary} aria-disabled="true">
            <Icon name="download" />
            {t("Pripremi arhivu")}
          </span>
        )}
      </div>
    </>
  );
}
