"use client";
import {
  type DesignProperty,
  type DesignVariant,
  designProperties,
  homeCoverId,
  homeCoverPhotos,
  homeSections,
  type VisualDesign,
} from "../../lib/visual-design";
import styles from "./visual-designer.module.css";

const groups = [
  {
    label: "Boje i površina",
    matches: (s: string) =>
      [
        "color",
        "background-color",
        "border-color",
        "border-width",
        "border-radius",
        "box-shadow",
        "backdrop-filter",
      ].includes(s),
  },
  { label: "Tipografija", matches: (s: string) => s.startsWith("font-") || s === "text-align" },
  {
    label: "Razmaci",
    matches: (s: string) => s.startsWith("margin-") || s.startsWith("padding-") || s === "gap",
  },
  { label: "Fotografija", matches: (s: string) => s.startsWith("object-") },
];
function toHex(value: string | undefined) {
  if (!value) return null;
  if (/^#[a-f\d]{6}(?:[a-f\d]{2})?$/i.test(value)) return value;
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d*\.?\d+))?\s*\)$/.exec(value);
  if (!rgba) return null;
  const channels = rgba.slice(1, 4).map((x) => Number(x).toString(16).padStart(2, "0"));
  if (rgba[4] !== undefined)
    channels.push(
      Math.round(Number(rgba[4]) * 255)
        .toString(16)
        .padStart(2, "0"),
    );
  return `#${channels.join("")}`;
}
const friendlyOptions: Record<string, string> = {
  none: "Bez efekta",
  start: "Lijevo",
  center: "Centar",
  end: "Desno",
  top: "Vrh",
  bottom: "Dno",
  left: "Lijevo",
  right: "Desno",
  "top left": "Gore lijevo",
  "top right": "Gore desno",
  "bottom left": "Dolje lijevo",
  "bottom right": "Dolje desno",
  "system-ui, sans-serif": "Sistemski",
  "Arial, sans-serif": "Arial",
  "Georgia, serif": "Georgia",
  "ui-monospace, monospace": "Jednake širine",
  cover: "Popuni okvir",
  contain: "Cijela fotografija",
};
function optionLabel(property: DesignProperty, value: string, index: number) {
  if (friendlyOptions[value]) return friendlyOptions[value];
  if (property.name === "box-shadow") return ["Bez sjene", "Blaga", "Srednja", "Duboka"][index];
  if (property.name === "backdrop-filter") return value.replace("blur(", "").replace(")", "");
  return value;
}
export function StyleInspector({
  target,
  variant,
  design,
  computed,
  change,
}: {
  target: string;
  variant: DesignVariant;
  design: VisualDesign;
  computed: Record<string, string>;
  change: (next: VisualDesign) => void;
}) {
  const values = design.rules[target]?.[variant] ?? {};
  function set(name: string, value: string | undefined) {
    const rules = { ...design.rules },
      scopes = { ...rules[target] },
      next = { ...scopes[variant] };
    if (value === undefined) delete next[name];
    else next[name] = value;
    if (Object.keys(next).length) scopes[variant] = next;
    else delete scopes[variant];
    if (Object.keys(scopes).length) rules[target] = scopes;
    else delete rules[target];
    change({ ...design, rules });
  }
  return (
    <>
      {groups
        .filter((g) => g.label !== "Fotografija" || target.endsWith("photo"))
        .map((group, index) => (
          <details key={group.label} className={styles.group} open={index === 0 || undefined}>
            <summary>{group.label}</summary>
            <div className={styles.fieldList}>
              {designProperties
                .filter((prop) => group.matches(prop.name))
                .map((prop) => {
                  const value = values[prop.name],
                    current = computed[prop.name],
                    id = `style-${prop.name}`;
                  const hex = toHex(value ?? current) ?? "#23364a",
                    alpha = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) : 255;
                  return (
                    <div key={prop.name} className={styles.field}>
                      <label htmlFor={id}>{prop.label}</label>
                      <div className={styles.propertyValue}>
                        {prop.kind === "color" ? (
                          <input
                            id={id}
                            type="color"
                            value={hex.slice(0, 7)}
                            onChange={(e) =>
                              set(
                                prop.name,
                                e.target.value +
                                  (prop.name === "background-color" && alpha < 255
                                    ? alpha.toString(16).padStart(2, "0")
                                    : ""),
                              )
                            }
                          />
                        ) : prop.kind === "length" ? (
                          <input
                            id={id}
                            type="number"
                            min={prop.min}
                            max={prop.max}
                            step={1}
                            placeholder={current?.split(" ")[0]?.replace("px", "") || "–"}
                            value={value?.slice(0, -2) ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "") {
                                set(prop.name, undefined);
                                return;
                              }
                              const n = Number(v);
                              if (
                                Number.isInteger(n) &&
                                n >= (prop.min ?? 0) &&
                                n <= (prop.max ?? 99)
                              )
                                set(prop.name, `${n}px`);
                            }}
                          />
                        ) : (
                          <select
                            id={id}
                            value={value ?? ""}
                            onChange={(e) => set(prop.name, e.target.value || undefined)}
                          >
                            <option value="">Iz teme</option>
                            {prop.options?.map((option, i) => (
                              <option key={option} value={option}>
                                {optionLabel(prop, option, i)}
                              </option>
                            ))}
                          </select>
                        )}
                        {value !== undefined && (
                          <button
                            type="button"
                            className={styles.clear}
                            aria-label={`Vrati iz teme — ${prop.label}`}
                            title="Vrati iz teme"
                            onClick={() => set(prop.name, undefined)}
                          >
                            ↺
                          </button>
                        )}
                      </div>
                      {prop.name === "background-color" && (
                        <div className={styles.alpha}>
                          <label htmlFor="surface-alpha">Neprozirnost</label>
                          <input
                            id="surface-alpha"
                            type="range"
                            min="0"
                            max="100"
                            value={Math.round((alpha / 255) * 100)}
                            onChange={(e) => {
                              const a = Math.round((Number(e.target.value) / 100) * 255);
                              set(
                                prop.name,
                                hex.slice(0, 7) +
                                  (a === 255 ? "" : a.toString(16).padStart(2, "0")),
                              );
                            }}
                          />
                          <output>{Math.round((alpha / 255) * 100)}%</output>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </details>
        ))}
    </>
  );
}
export function HomeEditor({
  design,
  change,
}: {
  design: VisualDesign;
  change: (next: VisualDesign) => void;
}) {
  function move(index: number, direction: number) {
    const order = [...design.homeOrder],
      item = order.splice(index, 1)[0];
    if (!item) return;
    order.splice(index + direction, 0, item);
    change({ ...design, homeOrder: order });
  }
  return (
    <details className={styles.group}>
      <summary>Sadržaj početne</summary>
      <div className={styles.fieldList}>
        <label className={styles.textField}>
          Naslovna fotografija
          <select
            value={homeCoverId(design.heroImage)}
            onChange={(event) => change({ ...design, heroImage: homeCoverId(event.target.value) })}
          >
            {Object.entries(homeCoverPhotos).map(([id, photo]) => (
              <option key={id} value={id}>
                {photo.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.textField}>
          Glavni naslov
          <textarea
            aria-label="Glavni naslov"
            maxLength={100}
            rows={2}
            value={design.heroTitle}
            onChange={(e) => change({ ...design, heroTitle: e.target.value })}
          />
        </label>
        <label className={styles.textField}>
          Podnaslov
          <textarea
            aria-label="Podnaslov"
            maxLength={160}
            rows={2}
            value={design.heroSubtitle ?? ""}
            onChange={(e) => change({ ...design, heroSubtitle: e.target.value })}
          />
        </label>
        <h3>Redoslijed sekcija</h3>
        <ol className={styles.orderList}>
          {design.homeOrder.map((id, i) => {
            const label = homeSections.find((s) => s.id === id)?.label ?? id;
            return (
              <li key={id}>
                <label>
                  <span>{label}</span>
                  <input
                    aria-label={`Naslov sekcije — ${label}`}
                    placeholder={label}
                    maxLength={75}
                    value={design.sectionTitles?.[id] ?? ""}
                    onChange={(e) =>
                      change({
                        ...design,
                        sectionTitles: { ...design.sectionTitles, [id]: e.target.value },
                      })
                    }
                  />
                </label>
                <div>
                  <button
                    type="button"
                    disabled={i === 0}
                    aria-label={`Pomjeri gore — ${label}`}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={i === design.homeOrder.length - 1}
                    aria-label={`Pomjeri dolje — ${label}`}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </details>
  );
}
