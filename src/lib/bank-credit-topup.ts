export type BankTopUpStatus = "pending" | "approved" | "cancelled";
export type CreditBankCurrency = "BAM" | "EUR";
export type CreditBankReceiver = {
  recipient: string;
  id: string;
  label: string;
  name: string;
  currency: CreditBankCurrency;
  accountNumber?: string | null;
  iban?: string | null;
  bic?: string | null;
  address?: string | null;
  note?: string | null;
  purpose: "Dopuna Ahi kredita";
};
export type CreditBankOffer = {
  quantity: number;
  base: number;
  bonus: number;
  amountMinor: number;
  originalBamMinor: number;
};
export type BankTopUpRequest = {
  id: string;
  orderId: string;
  quantity: number;
  amountMinor: number;
  originalBamMinor: number;
  currency: CreditBankCurrency;
  paymentReference: string;
  status: BankTopUpStatus;
  version: number;
  createdAt: string;
  approvedAt: string | null;
  bank: CreditBankReceiver;
  instructionsAvailable: boolean;
  accountId?: string;
  customer?: string;
  email?: string;
};
export type BankTopUpData = {
  requests: BankTopUpRequest[];
  page: number;
  limit: 20;
  hasMore: boolean;
  available: boolean;
  bank: CreditBankReceiver | null;
  offers: CreditBankOffer[];
};
export type BankTopUpCreate = {
  id: string;
  quantity: number;
  expectedAmountMinor: number;
  currency: CreditBankCurrency;
};
export type BankTopUpApprove = {
  expectedVersion: number;
  bankTransactionReference: string;
  amountMinor: number;
  currency: CreditBankCurrency;
  paymentReference: string;
};
export type BankTopUpCancel = { expectedVersion: number };
