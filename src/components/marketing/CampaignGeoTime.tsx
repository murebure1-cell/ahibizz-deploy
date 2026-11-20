import { useId, useState } from "react";
import { campaignCities, campaignTimeZones, maxCampaignCities } from "../../lib/ad-geo-schedule";
import type { MarketingData } from "../../lib/marketing";
import styles from "./marketing.module.css";

const countryNames =
  typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["bs"], { type: "region" })
    : null;
export function countryLabel(code: string) {
  return countryNames?.of(code) ?? code;
}
export function CampaignGeoTime({
  locations,
  listing,
}: {
  locations: MarketingData["locations"];
  listing: boolean;
}) {
  const listId = useId(),
    [cities, setCities] = useState<string[]>([]),
    [draft, setDraft] = useState(""),
    [limited, setLimited] = useState(false);
  function addCity() {
    if (!draft.trim()) return;
    const next = campaignCities([...cities, draft]);
    if (next) {
      setCities(next);
      setDraft("");
    }
  }
  return (
    <>
      <div className={styles.cityControl}>
        <label>
          Gradovi kampanje
          <input
            list={listId}
            maxLength={80}
            name="targetCityDraft"
            placeholder="Odaberi ili upiši grad"
            value={draft}
            disabled={cities.length >= maxCampaignCities}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draft.trim()) {
                event.preventDefault();
                addCity();
              }
            }}
          />
        </label>
        <datalist id={listId}>
          {locations?.cities.map((city) => (
            <option key={city} value={city} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={addCity}
          disabled={!draft.trim() || cities.length >= maxCampaignCities}
        >
          Dodaj grad
        </button>
        {cities.length > 0 && (
          <ul aria-label="Odabrani gradovi">
            {cities.map((city) => (
              <li key={city}>
                <input type="hidden" name="targetCity" value={city} />
                <button
                  type="button"
                  aria-label={`Ukloni ${city}`}
                  onClick={() => setCities((current) => current.filter((item) => item !== city))}
                >
                  {city} ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <small>
          Prazan izbor uključuje sve gradove. Za regionalnu kampanju odaberi više gradova.
        </small>
      </div>
      {listing && (
        <label>
          Država djelatnosti
          <select name="countryCode" defaultValue="">
            <option value="">Sve države</option>
            {locations?.countries.map((code) => (
              <option key={code} value={code}>
                {countryLabel(code)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Vrijeme emitiranja
        <select
          value={limited ? "limited" : "all"}
          onChange={(e) => setLimited(e.target.value === "limited")}
        >
          <option value="all">Cijeli dan</option>
          <option value="limited">Odabrani sati svaki dan</option>
        </select>
      </label>
      {limited && (
        <>
          <label>
            Od koliko sati
            <input name="adFrom" type="time" step={60} required defaultValue="18:00" />
          </label>
          <label>
            Do koliko sati
            <input name="adUntil" type="time" step={60} required defaultValue="22:00" />
          </label>
          <label>
            Vremenska zona
            <select name="timeZone" defaultValue="Europe/Sarajevo">
              {campaignTimeZones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <small>Ako je završetak ranije od početka, prikaz traje preko ponoći.</small>
          </label>
        </>
      )}
    </>
  );
}
