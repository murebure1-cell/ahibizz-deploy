"use client";

import Link from "next/link";
import { type FormEvent, useActionState, useRef, useState } from "react";
import { searchInput } from "../../lib/content-hub";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import {
  type HelpTicketTopic,
  type HelpTopicId,
  helpTopic,
  helpTopicContent,
  helpTopicIds,
  matchHelpTopic,
} from "../../lib/help-center";
import { supportEmail } from "../../lib/support-requests";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import { submitSupportRequest } from "../support/request-actions";
import styles from "./help.module.css";

/**
 * The help centre as drawn ("Centar za pomoć", "Česta pitanja", "Kontakt"): a question with its
 * short answer, the topics, the common questions opening one by one, and a way to write to
 * support. What it finds and what it sends are as before.
 */
export function HelpDesk({
  actor,
  requestId,
  initialTopic,
}: {
  actor?: string;
  requestId?: string;
  initialTopic: HelpTopicId | null;
}) {
  const t = useT();
  const [question, setQuestion] = useState("");
  const [previous, setPrevious] = useState(
    initialTopic ? t(helpTopicContent(initialTopic, IS_PLAY_EDITION).question) : "",
  );
  const [matched, setMatched] = useState<HelpTopicId | null>(initialTopic);
  const [topic, setTopic] = useState<HelpTicketTopic>(initialTopic ?? "ostalo");
  const [detail, setDetail] = useState("");
  const detailsField = useRef<HTMLTextAreaElement>(null);
  const [result, action, pending] = useActionState(submitSupportRequest, {
    sent: false,
    message: "",
  });
  const answer = matched ? helpTopicContent(matched, IS_PLAY_EDITION) : null;

  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = searchInput(question);
    if (!text) return;
    setPrevious(text);
    setMatched(matchHelpTopic(text));
  }

  return (
    <>
      <section className={styles.hero} aria-labelledby="help-title">
        <h1 id="help-title">{t("Kako ti možemo pomoći?")}</h1>
        <p>{t("Kratak odgovor ili uputstvo korak po korak, na jednom mjestu.")}</p>
        <search>
          <form className={styles.search} onSubmit={ask}>
            <input
              type="search"
              aria-label={t("Šta želiš saznati?")}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              required
              maxLength={100}
              placeholder={t("Npr. lozinka, termin, paket")}
            />
            <button type="submit">{t("Traži")}</button>
          </form>
        </search>
      </section>

      {previous && (
        <div className={styles.answer} aria-live="polite">
          <span>{previous}</span>
          {answer ? (
            <>
              <strong>{t(answer.label)}</strong>
              <p>{t(answer.answer)}</p>
              <ul className={styles.links}>
                {answer.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{t(link.label)}</Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>{t("Probaj kraće pitanje, odaberi temu iznad ili piši podršci.")}</p>
          )}
          {actor && !result.sent && (
            <button
              className={styles.quiet}
              type="button"
              onClick={() => {
                setDetail(previous);
                setTopic(matched ?? "ostalo");
                detailsField.current?.focus();
              }}
            >
              {t("Prenesi pitanje u zahtjev")}
            </button>
          )}
        </div>
      )}

      <section className={styles.group} aria-labelledby="help-topics">
        <h2 id="help-topics">{t("Teme")}</h2>
        <fieldset className={styles.topics} aria-labelledby="help-topics">
          {helpTopicIds.map((id) => {
            const content = helpTopicContent(id, IS_PLAY_EDITION);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={matched === id}
                onClick={() => {
                  setPrevious(t(content.question));
                  setMatched(id);
                }}
              >
                <Icon name={content.icon} aria-hidden="true" />
                {t(content.label)}
              </button>
            );
          })}
        </fieldset>
      </section>

      <section className={styles.group} id="pitanja" aria-labelledby="help-faq">
        <h2 id="help-faq">{t("Česta pitanja")}</h2>
        <div className={styles.faq}>
          {helpTopicIds.map((id) => {
            const content = helpTopicContent(id, IS_PLAY_EDITION);
            return (
              <details key={id}>
                <summary>
                  <span>{t(content.question)}</span>
                  <Icon name="chevron" aria-hidden="true" />
                </summary>
                <div>
                  <p>{t(content.answer)}</p>
                  <ul className={styles.links}>
                    {content.links.map((link) => (
                      <li key={link.href}>
                        <Link href={link.href}>{t(link.label)}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section className={styles.card} id="kontakt" aria-labelledby="help-contact">
        <h2 id="help-contact">{t("Kontakt")}</h2>
        <p>{t("Piši nam. Odgovor stiže na email naloga.")}</p>
        {actor && requestId ? (
          result.sent ? (
            <p role="status">{t(result.message)}</p>
          ) : (
            <form action={action} className={styles.form}>
              <input type="hidden" name="actor" value={actor} />
              <input type="hidden" name="subject" value="help" />
              <input type="hidden" name="reference" value={`${topic}--${requestId}`} />
              <label>
                {t("Tema")}
                <select
                  value={topic}
                  onChange={(event) => setTopic(helpTopic(event.target.value) ?? "ostalo")}
                >
                  <option value="ostalo">{t("Ostalo")}</option>
                  {helpTopicIds.map((id) => (
                    <option key={id} value={id}>
                      {t(helpTopicContent(id, IS_PLAY_EDITION).label)}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="support-details">
                {t("Poruka")}
                <textarea
                  ref={detailsField}
                  id="support-details"
                  name="details"
                  required
                  rows={5}
                  maxLength={800}
                  value={detail}
                  onChange={(event) => setDetail(event.target.value)}
                  placeholder={t("Kada se desilo i na kojoj stranici?")}
                />
              </label>
              <p>{t("Izostavi lozinke, kodove za prijavu i podatke kartice.")}</p>
              {result.message && <p role="alert">{t(result.message)}</p>}
              <button className={styles.main} type="submit" disabled={pending}>
                {pending ? t("Šaljem…") : t("Pošalji")}
              </button>
            </form>
          )
        ) : (
          <Link href="/prijava?nastavi=%2Fpomoc" className={styles.main}>
            {t("Prijavi se za slanje zahtjeva")}
          </Link>
        )}
        <a className={styles.email} href={`mailto:${supportEmail}?subject=AhiBizz%20podr%C5%A1ka`}>
          <Icon name="mail" aria-hidden="true" />
          <span>
            {supportEmail}
            <small>{t("Email podrške")}</small>
          </span>
        </a>
      </section>
    </>
  );
}
