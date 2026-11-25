import type { PrelaunchResetFullPlan } from "./prelaunch-reset-core.mjs";

export function describePlan(plan: PrelaunchResetFullPlan): {
  stays: string[];
  accounts: number;
  businesses: number;
  rows: { name: string; rows: number }[];
  emptyTables: number;
  blockers: string[];
  digest: string;
};
export function readArguments(
  argv: readonly string[],
): { command: "plan" } | { command: "apply"; digest: string };
