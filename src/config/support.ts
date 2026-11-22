/** Public receiving instructions only. Never put account credentials or card data here. */
export const publicSupportSettings = {
  enabled: true,
  recipient: "Ajdin Tabakovic",
  paypalUrl: "https://paypal.me/AjdinTabakovic",
  bankAccounts: [
    {
      id: "bih",
      label: "Uplata iz BiH",
      currency: "BAM",
      name: "Raiffeisenbank",
      accountNumber: "1613000073375996",
    },
    {
      id: "eu",
      label: "Uplata iz EU",
      currency: "EUR",
      name: "Wise",
      iban: "BE95 9678 9089 6058",
      bic: "TRWIBEB1XXX",
      address: "Rue du Trône 100, 3rd floor, Brussels, 1050, Belgium",
      note: "Za uplate izvan SEPA koristite i SWIFT/BIC te adresu banke.",
    },
  ],
};
