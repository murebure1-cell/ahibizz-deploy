import { businessUuid } from "./business-today";
import { helpTicketTopic } from "./help-center";

export const supportEmail = "podrska@ahibizz.com";
export const supportSubjects = {
  deletion: "Brisanje naloga",
  person: "Lični profil",
  business: "Djelatnost",
  review: "Recenzija",
  conversation: "Razgovor",
  reel: "Reel",
  help: "Korisnička podrška",
} as const;
export type SupportSubject = keyof typeof supportSubjects;
export type SupportTarget = { subject: SupportSubject; reference: string };

export function supportTarget(subject: unknown, reference: unknown): SupportTarget | null {
  if (subject === "deletion") return reference === "" ? { subject, reference } : null;
  if (typeof subject !== "string" || !Object.hasOwn(supportSubjects, subject)) return null;
  if (typeof reference !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(reference)) return null;
  if (subject === "reel" && (reference.length !== 36 || !businessUuid(reference))) return null;
  if (subject === "help" && !helpTicketTopic(reference)) return null;
  return { subject: subject as SupportSubject, reference };
}

export function reportUrl(
  subject: Exclude<SupportSubject, "deletion" | "help">,
  reference: string,
) {
  return `/prijavi-sadrzaj?${new URLSearchParams({ vrsta: subject, oznaka: reference })}`;
}
