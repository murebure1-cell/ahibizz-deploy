import { Fragment, type ReactNode } from "react";

/**
 * Places links or other elements inside a translated sentence, so each language keeps its own
 * word order: rich(translatedText, { rules: <Link …/> }), where the text holds {rules}. Line breaks become <br />.
 */
export function rich(text: string, parts: Record<string, ReactNode> = {}) {
  return text.split(/(\{\w+\}|\n)/).map((piece, index) => {
    const key = `${index}-${piece}`;
    if (piece === "\n") return <br key={key} />;
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return <Fragment key={key}>{name && name in parts ? parts[name] : piece}</Fragment>;
  });
}
