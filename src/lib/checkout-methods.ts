export type CheckoutAvailability = { available: boolean; environment: "sandbox" | "live" | null };
export function paypalAvailabilityText(value: CheckoutAvailability | null, failed = false): string {
  if (failed) return "Status trenutno nije dostupan. Plaćanje nije potvrđeno kao dostupno.";
  if (!value) return "Provjeravam dostupnost…";
  if (!value.available)
    return "Plaćanje još nije uključeno. Možeš pregledati opciju, ali ne i platiti.";
  if (value.environment === "sandbox") return "Samo testno plaćanje, bez stvarnog novca.";
  if (value.environment === "live") return "Dostupno za plaćanje. Iznos pregledaš prije nastavka.";
  return "Plaćanje nije dostupno.";
}
