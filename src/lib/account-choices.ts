/** What others see on the public person profile, and which kinds of push the person wants. */
export type AccountChoices = {
  showCity: boolean;
  showFriendCount: boolean;
  pushMessages: boolean;
  pushBookings: boolean;
  pushReels: boolean;
};
export const accountChoiceKeys = [
  "showCity",
  "showFriendCount",
  "pushMessages",
  "pushBookings",
  "pushReels",
] as const satisfies readonly (keyof AccountChoices)[];

export function readAccountChoices(value: unknown): AccountChoices {
  const row = value as Record<string, unknown> | null;
  if (!row || typeof row !== "object" || accountChoiceKeys.some((k) => typeof row[k] !== "boolean"))
    throw new Error("invalid_account_choices");
  return {
    showCity: row.showCity as boolean,
    showFriendCount: row.showFriendCount as boolean,
    pushMessages: row.pushMessages as boolean,
    pushBookings: row.pushBookings as boolean,
    pushReels: row.pushReels as boolean,
  };
}

/** Reads or changes the signed-in account's choices; the account id guards against a switch. */
export async function accountChoicesRequest(
  accountId: string,
  change?: Partial<AccountChoices>,
  signal?: AbortSignal,
): Promise<AccountChoices> {
  const response = await fetch("/api/account/choices", {
    method: change ? "PATCH" : "GET",
    cache: "no-store",
    credentials: "same-origin",
    signal,
    headers: {
      "X-AhiBizz-Account-ID": accountId,
      ...(change ? { "Content-Type": "application/json" } : {}),
    },
    ...(change ? { body: JSON.stringify(change) } : {}),
  });
  if (!response.ok) throw new Error(`account_choices_${response.status}`);
  return readAccountChoices(await response.json());
}
