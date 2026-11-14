import Form from "next/form";
import { Icon } from "./Icon";

export function SearchForm({
  query = "",
  place = "",
  compact = false,
}: {
  query?: string;
  place?: string;
  compact?: boolean;
}) {
  return (
    <search aria-label="Pretraga djelatnosti">
      <Form
        key={JSON.stringify([query, place])}
        action="/pretraga"
        className={`search-form${compact ? " search-form-compact" : ""}`}
      >
        <label className="search-field">
          <Icon name="search" />
          <span>
            <span className="field-caption">Šta tražiš?</span>
            <input
              type="search"
              name="q"
              placeholder="Usluga ili naziv djelatnosti"
              defaultValue={query}
              maxLength={120}
            />
          </span>
        </label>
        <label className="search-field place-field">
          <Icon name="pin" />
          <span>
            <span className="field-caption">Gdje?</span>
            <input
              type="text"
              name="mjesto"
              placeholder="Grad ili mjesto"
              defaultValue={place}
              maxLength={100}
            />
          </span>
        </label>
        <button className="button button-gold search-submit" type="submit">
          <span>Pretraži</span>
          <Icon name="arrow" />
        </button>
      </Form>
    </search>
  );
}
