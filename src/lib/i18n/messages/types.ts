/** English, German, Arabic and Turkish text for one Bosnian source text. */
export type Row = readonly [en: string, de: string, ar: string, tr: string];
export type Messages = Record<string, Row>;
