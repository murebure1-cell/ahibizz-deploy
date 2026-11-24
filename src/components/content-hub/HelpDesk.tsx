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
import resources from "../support/resources.module.css";
import styles from "./content-hub.module.css";

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
    <div className={styles.helpGrid}>
      <section className={styles.chat} aria-labelledby="help-guide">
        <h2 id="help-guide">{t("Pitaj AhiBizz vodič")}</h2>
        <search>
          <form className={styles.search} onSubmit={ask}>
            <label htmlFor="help-question" className={styles.searchLabel}>
              {t("Šta želiš saznati?")}
            </label>
            <input
              id="help-question"
              type="search"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              required
              maxLength={100}
              placeholder={t("Npr. Kako da promijenim termin?")}
            />
            <button type="submit">
              <Icon name="search" /> {t("Traži")}
            </button>
          </form>
        </search>
        <fieldset className={styles.quick}>
          <legend>{t("Brza pitanja")}</legend>
          {helpTopicIds.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={matched === id}
              onClick={() => {
                setPrevious(t(helpTopicContent(id, IS_PLAY_EDITION).question));
                setMatched(id);
              }}
            >
              <Icon name={helpTopicContent(id, IS_PLAY_EDITION).icon} />
              {t(helpTopicContent(id, IS_PLAY_EDITION).label)}
            </button>
          ))}
        </fieldset>
        <div aria-live="polite">
          {previous && (
            <>
              <p className={styles.submitted}>{previous}</p>
              <div className={styles.reply}>
                {answer ? (
                  <>
                    <strong>{t(answer.label)}</strong>
                    <p>{t(answer.answer)}</p>
                    <ul>
                      {answer.links.map((link) => (
                        <li key={link.href}>
                          <Link href={link.href} className={styles.inlineLink}>
                            {t(link.label)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>{t("Probaj kraće pitanje, odaberi temu iznad ili piši podršci.")}</p>
                )}
              </div>
              {actor && !result.sent && (
                <button
                  className={styles.secondary}
                  style={{ marginTop: "0.9rem" }}
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
            </>
          )}
        </div>
      </section>
      <section className={styles.ticket} id="kontakt" aria-labelledby="help-contact">
        <h2 id="help-contact">{t("Kontaktiraj podršku")}</h2>
        <p className={styles.caption}>{t("Opiši problem. Odgovor dobivaš emailom.")}</p>
        {actor && requestId ? (
          result.sent ? (
            <p className={styles.reply} role="status">
              {t(result.message)}
            </p>
          ) : (
            <form action={action} className={resources.form}>
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
                {t("Opis problema")}
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
              <p className={styles.caption}>
                {t("Izostavi lozinke, kodove za prijavu i podatke kartice.")}
              </p>
              {result.message && <p role="alert">{t(result.message)}</p>}
              <button className={styles.accent} type="submit" disabled={pending}>
                {pending ? t("Šaljem…") : t("Pošalji zahtjev")}
              </button>
            </form>
          )
        ) : (
          <p className={styles.contact}>
            <Link href="/prijava?nastavi=%2Fpomoc" className={styles.secondary}>
              {t("Prijavi se za slanje zahtjeva")}
            </Link>
          </p>
        )}
        <p className={styles.contact}>
          <a
            href={`mailto:${supportEmail}?subject=AhiBizz%20podr%C5%A1ka`}
            className={styles.inlineLink}
          >
            {supportEmail}
          </a>
        </p>
      </section>
    </div>
  );
}
