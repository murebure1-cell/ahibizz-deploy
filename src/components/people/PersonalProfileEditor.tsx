"use client";

import Image from "next/image";
import { type ChangeEvent, type FormEvent, useEffect, useId, useRef, useState } from "react";
import {
  countryLabel,
  type PersonalProfile,
  type PersonalProfileFields,
  profileCountries,
  profileImageUrl,
  type WorkStatus,
  workStatusLabels,
} from "../../lib/people";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { personalProfileImage, profileInitials } from "./PersonalProfileCard";
import styles from "./profile.module.css";

type Props = {
  profile: PersonalProfile;
  busy: boolean;
  onSave: (fields: PersonalProfileFields) => Promise<void> | void;
  onCancel: () => void;
  onUploadPhoto?: (file: File) => Promise<void>;
  onUploadCover?: (file: File) => Promise<void>;
  onRemovePhoto?: () => Promise<void> | void;
  onRemoveCover?: () => Promise<void> | void;
  photoUrl?: string | null;
  coverUrl?: string | null;
};
type Operation = "save" | "photo" | "cover" | "remove-photo" | "remove-cover";
const skillKey = (value: string) => value.normalize("NFKC").toLowerCase();

export function PersonalProfileEditor(props: Props) {
  return <ProfileEditor key={props.profile.id} {...props} />;
}

function ProfileEditor({
  profile,
  busy,
  onSave,
  onCancel,
  onUploadPhoto,
  onUploadCover,
  onRemovePhoto,
  onRemoveCover,
  photoUrl,
  coverUrl,
}: Props) {
  const { t, locale } = useI18n();
  const prefix = useId();
  const [fields, setFields] = useState<PersonalProfileFields>(() => ({
    name: profile.name,
    birthDate: profile.birthDate,
    city: profile.city,
    countryCode: profile.countryCode,
    bio: profile.bio,
    skills: [...profile.skills],
    workStatus: profile.workStatus,
  }));
  const [skillInput, setSkillInput] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState<Operation | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const live = useRef(false);
  const pending = useRef(false);
  const objectUrls = useRef<{ photo: string | null; cover: string | null }>({
    photo: null,
    cover: null,
  });
  const locked = busy || working !== null;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (objectUrls.current.photo) URL.revokeObjectURL(objectUrls.current.photo);
      if (objectUrls.current.cover) URL.revokeObjectURL(objectUrls.current.cover);
      objectUrls.current = { photo: null, cover: null };
    };
  }, []);
  const photo = personalProfileImage(
    photoPreview ?? (photoUrl === undefined ? profileImageUrl(profile, "photo") : photoUrl),
  );
  const cover = profile.canCustomizeCover
    ? personalProfileImage(
        coverPreview ?? (coverUrl === undefined ? profileImageUrl(profile, "cover") : coverUrl),
      )
    : null;
  const countryKnown = profileCountries.some(([code]) => code === fields.countryCode);

  function addSkill() {
    if (locked) return;
    const skill = skillInput.trim();
    if (!skill) return;
    if (skill.length > 40) {
      setError(t("Naziv vještine može imati najviše 40 znakova."));
      return;
    }
    if (fields.skills.some((item) => skillKey(item) === skillKey(skill))) {
      setError(t("Ta vještina je već dodana."));
      return;
    }
    if (fields.skills.length >= 15) {
      setError(t("Možeš dodati najviše 15 vještina."));
      return;
    }
    setFields({ ...fields, skills: [...fields.skills, skill] });
    setSkillInput("");
    setError("");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || pending.current) return;
    const skills = [...fields.skills];
    const pendingSkill = skillInput.trim();
    if (pendingSkill && !skills.some((item) => skillKey(item) === skillKey(pendingSkill)))
      skills.push(pendingSkill);
    if (
      !fields.name.trim() ||
      fields.name.trim().length > 100 ||
      (fields.city?.trim().length ?? 0) > 100 ||
      (fields.bio?.trim().length ?? 0) > 1200 ||
      skills.length > 15 ||
      skills.some((item) => !item.trim() || item.length > 40)
    ) {
      setError(t("Provjeri ime, opis i vještine prije spremanja."));
      return;
    }
    const value: PersonalProfileFields = {
      name: fields.name.trim(),
      birthDate: fields.birthDate || null,
      city: fields.city?.trim() || null,
      countryCode: fields.countryCode || null,
      bio: fields.bio?.trim() || null,
      skills,
      workStatus: fields.workStatus,
    };
    pending.current = true;
    setWorking("save");
    setError("");
    setStatus("");
    setFields(value);
    setSkillInput("");
    try {
      await onSave(value);
      if (live.current) setStatus(t("Profil je sačuvan."));
    } catch {
      if (live.current) setError(t("Promjene nisu sačuvane. Tvoj unos je ostao u obrascu."));
    } finally {
      pending.current = false;
      if (live.current) setWorking(null);
    }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>, kind: "photo" | "cover") {
    const file = event.target.files?.[0];
    event.target.value = "";
    const callback =
      kind === "photo" ? onUploadPhoto : profile.canCustomizeCover ? onUploadCover : undefined;
    if (!file || !callback || busy || pending.current) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size === 0) {
      setError(t("Izaberi JPG, PNG ili WEBP fotografiju."));
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError(t("Fotografija može imati najviše 4 MB."));
      return;
    }
    pending.current = true;
    setWorking(kind);
    setError("");
    setStatus("");
    const setPreview = kind === "photo" ? setPhotoPreview : setCoverPreview;
    try {
      const url = URL.createObjectURL(file);
      if (objectUrls.current[kind]) URL.revokeObjectURL(objectUrls.current[kind]);
      objectUrls.current[kind] = url;
      setPreview(url);
      await callback(file);
      if (live.current)
        setStatus(
          kind === "photo" ? t("Profilna fotografija je sačuvana.") : t("Naslovnica je sačuvana."),
        );
    } catch {
      if (live.current) setError(t("Fotografija nije sačuvana. Pokušaj ponovo."));
    } finally {
      pending.current = false;
      if (objectUrls.current[kind]) URL.revokeObjectURL(objectUrls.current[kind]);
      objectUrls.current[kind] = null;
      if (live.current) {
        setPreview(null);
        setWorking(null);
      }
    }
  }
  async function remove(kind: "photo" | "cover") {
    const callback =
      kind === "photo" ? onRemovePhoto : profile.canCustomizeCover ? onRemoveCover : undefined;
    if (!callback || busy || pending.current) return;
    pending.current = true;
    setWorking(kind === "photo" ? "remove-photo" : "remove-cover");
    setError("");
    setStatus("");
    try {
      await callback();
      if (live.current)
        setStatus(
          kind === "photo"
            ? t("Profilna fotografija je uklonjena.")
            : t("Vraćena je AhiBizz naslovnica."),
        );
    } catch {
      if (live.current) setError(t("Fotografija nije uklonjena. Pokušaj ponovo."));
    } finally {
      pending.current = false;
      if (live.current) setWorking(null);
    }
  }
  return (
    <form
      className={styles.editor}
      onSubmit={save}
      aria-label={t("Uredi lični profil")}
      aria-busy={locked}
    >
      <div className={styles.editorHeading}>
        <div>
          <h2>{t("Uredi profil")}</h2>
          <p>{t("Tvoje ime, iskustvo i vještine.")}</p>
        </div>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className={styles.status} role="status">
          {status}
        </p>
      )}
      <fieldset disabled={locked}>
        <div className={styles.mediaSettings}>
          <section className={styles.mediaChoice} aria-label={t("Profilna fotografija")}>
            <h3>{t("Profilna fotografija")}</h3>
            <div className={styles.mediaAvatar}>
              {photo ? (
                <Image
                  className={styles.avatarImage}
                  src={photo}
                  alt={t("Profilna fotografija")}
                  width={160}
                  height={160}
                  unoptimized
                />
              ) : (
                <span className={styles.initials} aria-hidden="true">
                  {profileInitials(fields.name)}
                </span>
              )}
            </div>
            {(onUploadPhoto || (photo && onRemovePhoto)) && (
              <div className={styles.mediaActions}>
                {onUploadPhoto && (
                  <label className={styles.upload} data-disabled={locked}>
                    <Icon name="user" />
                    {working === "photo"
                      ? t("Spremanje…")
                      : photo
                        ? t("Promijeni")
                        : t("Dodaj fotografiju")}
                    <input
                      className={styles.fileInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      aria-label={t("Odaberi profilnu fotografiju")}
                      onChange={(event) => void upload(event, "photo")}
                    />
                  </label>
                )}
                {photo && onRemovePhoto && (
                  <button
                    className={styles.remove}
                    type="button"
                    onClick={() => void remove("photo")}
                  >
                    {t("Ukloni")}
                  </button>
                )}
              </div>
            )}
          </section>
          <section className={styles.mediaChoice} aria-label={t("Naslovnica")}>
            <h3>{t("Naslovnica")}</h3>
            <div className={styles.coverMini}>
              {cover ? (
                <Image
                  className={styles.coverImage}
                  src={cover}
                  alt={t("Naslovna fotografija")}
                  width={400}
                  height={150}
                  unoptimized
                />
              ) : (
                <div className={styles.defaultCover}>
                  <Image
                    className={styles.coverBrand}
                    src="/brand/ahi-logo-white.svg"
                    alt="AhiBizz"
                    width={125}
                    height={34}
                    unoptimized
                  />
                </div>
              )}
            </div>
            {profile.canCustomizeCover ? (
              <div className={styles.mediaActions}>
                {onUploadCover && (
                  <label className={styles.upload} data-disabled={locked}>
                    {working === "cover"
                      ? t("Spremanje…")
                      : cover
                        ? t("Promijeni naslovnicu")
                        : t("Dodaj naslovnicu")}
                    <input
                      className={styles.fileInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      aria-label={t("Odaberi naslovnicu")}
                      onChange={(event) => void upload(event, "cover")}
                    />
                  </label>
                )}
                {cover && onRemoveCover && (
                  <button
                    className={styles.remove}
                    type="button"
                    onClick={() => void remove("cover")}
                  >
                    {t("Ukloni")}
                  </button>
                )}
              </div>
            ) : (
              <p className={styles.fieldHint}>{t("Naslovnica trenutno nije dostupna.")}</p>
            )}
          </section>
        </div>
        <label className={styles.field} htmlFor={`${prefix}-name`}>
          {t("Ime i prezime")}
          <input
            className={styles.input}
            id={`${prefix}-name`}
            name="name"
            autoComplete="name"
            maxLength={100}
            required
            value={fields.name}
            onChange={(event) => setFields({ ...fields, name: event.target.value })}
          />
        </label>
        <div className={styles.row}>
          <label className={styles.field} htmlFor={`${prefix}-birth`}>
            {t("Datum rođenja")}{" "}
            <span className={styles.fieldHint}>{t("Privatno · ne prikazuje se na profilu")}</span>
            <input
              className={styles.input}
              id={`${prefix}-birth`}
              name="birthDate"
              type="date"
              autoComplete="bday"
              value={fields.birthDate ?? ""}
              onChange={(event) => setFields({ ...fields, birthDate: event.target.value || null })}
            />
          </label>
          <label className={styles.field} htmlFor={`${prefix}-work`}>
            {t("Trenutni status")}
            <select
              className={styles.input}
              id={`${prefix}-work`}
              name="workStatus"
              value={fields.workStatus}
              onChange={(event) =>
                setFields({ ...fields, workStatus: event.target.value as WorkStatus })
              }
            >
              {Object.entries(workStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.row}>
          <label className={styles.field} htmlFor={`${prefix}-city`}>
            {t("Grad")}
            <input
              className={styles.input}
              id={`${prefix}-city`}
              name="city"
              autoComplete="address-level2"
              maxLength={100}
              value={fields.city ?? ""}
              onChange={(event) => setFields({ ...fields, city: event.target.value || null })}
            />
          </label>
          <label className={styles.field} htmlFor={`${prefix}-country`}>
            {t("Država")}
            <select
              className={styles.input}
              id={`${prefix}-country`}
              name="countryCode"
              autoComplete="country"
              value={fields.countryCode ?? ""}
              onChange={(event) =>
                setFields({ ...fields, countryCode: event.target.value || null })
              }
            >
              <option value="">{t("Nije odabrano")}</option>
              {profileCountries.map(([code]) => (
                <option key={code} value={code}>
                  {countryLabel(code, locale)}
                </option>
              ))}
              {fields.countryCode && !countryKnown && (
                <option value={fields.countryCode}>{fields.countryCode}</option>
              )}
            </select>
          </label>
        </div>
        <label className={styles.field} htmlFor={`${prefix}-bio`}>
          {t("O meni")}
          <textarea
            className={styles.input}
            id={`${prefix}-bio`}
            name="bio"
            maxLength={1200}
            rows={4}
            value={fields.bio ?? ""}
            onChange={(event) => setFields({ ...fields, bio: event.target.value || null })}
          />
          <span className={styles.fieldHint}>{t("Do 1.200 znakova")}</span>
        </label>
        <div className={styles.skillField}>
          <label className={styles.field} htmlFor={`${prefix}-skill`}>
            Vještine
            <span className={styles.fieldHint}>{t("Do 15 vještina · Enter za dodavanje")}</span>
          </label>
          <div className={styles.skillsInput}>
            <input
              className={styles.input}
              id={`${prefix}-skill`}
              value={skillInput}
              maxLength={40}
              placeholder={t("Dodaj vještinu")}
              onChange={(event) => setSkillInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  addSkill();
                }
              }}
            />
            <button
              className={styles.secondary}
              type="button"
              disabled={!skillInput.trim() || fields.skills.length >= 15}
              onClick={addSkill}
            >
              {t("Dodaj")}
            </button>
          </div>
          {fields.skills.length > 0 && (
            <ul className={styles.chips}>
              {fields.skills.map((skill) => (
                <li className={styles.chip} key={skill}>
                  {skill}
                  <button
                    className={styles.skillRemove}
                    type="button"
                    aria-label={`Ukloni vještinu ${skill}`}
                    onClick={() =>
                      setFields({
                        ...fields,
                        skills: fields.skills.filter((item) => item !== skill),
                      })
                    }
                  >
                    <Icon name="close" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.footer}>
          <button className={styles.primary} type="submit">
            {working === "save" ? t("Spremanje…") : t("Sačuvaj profil")}
            <Icon name="check" />
          </button>
          <button className={styles.secondary} type="button" onClick={onCancel}>
            {t("Odustani")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
