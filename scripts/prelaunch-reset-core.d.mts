import type { PoolClient } from "pg";

export const prelaunchResetClosesAt: number;
export type PrelaunchResetPlan = {
  owners: { id: string; email: string }[];
  accounts: number;
  businesses: number;
  tables: { name: string; rows: number }[];
  blockers: string[];
};
export type PrelaunchResetFullPlan = PrelaunchResetPlan & { kept: string[]; digest: string };
export function readPrelaunchResetPlan(client: PoolClient): Promise<PrelaunchResetFullPlan>;
export function applyPrelaunchResetPlan(
  client: PoolClient,
  plan: PrelaunchResetFullPlan,
  operatorId: string,
  now?: number,
): Promise<{ accounts: number; businesses: number }>;
