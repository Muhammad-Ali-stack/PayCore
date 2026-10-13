import { KycTier } from '@prisma/client';

export interface LimitValues {
  perTxnMax: bigint;
  dailyMax: bigint;
  monthlyMax: bigint;
  maxBalance: bigint;
}

export interface OutflowUsage {
  daily: bigint;
  monthly: bigint;
}

export type LimitViolation = 'CURRENCY_NOT_PERMITTED' | 'PER_TRANSACTION' | 'DAILY' | 'MONTHLY' | 'MAX_BALANCE';

const TIER_RANK: Record<KycTier, number> = { TIER_0: 0, TIER_1: 1, TIER_2: 2, TIER_3: 3 };
export const tierRank = (tier: KycTier): number => TIER_RANK[tier];

/** A limit row with a zero max balance means the tier may not hold that currency at all. */
export const isCurrencyPermitted = (limit: LimitValues): boolean => limit.maxBalance > 0n && limit.perTxnMax > 0n;

/** Outflow (debit from a wallet): per-transaction, rolling UTC day and UTC month windows. */
export function checkOutflow(limit: LimitValues, usage: OutflowUsage, amount: bigint): LimitViolation | null {
  if (!isCurrencyPermitted(limit)) return 'CURRENCY_NOT_PERMITTED';
  if (amount > limit.perTxnMax) return 'PER_TRANSACTION';
  if (usage.daily + amount > limit.dailyMax) return 'DAILY';
  if (usage.monthly + amount > limit.monthlyMax) return 'MONTHLY';
  return null;
}

/** Inflow (credit to a wallet): the resulting balance may not exceed the tier's max balance. */
export function checkInflow(
  limit: LimitValues,
  currentBalance: bigint,
  amount: bigint,
  opts: { enforcePerTxn: boolean },
): LimitViolation | null {
  if (!isCurrencyPermitted(limit)) return 'CURRENCY_NOT_PERMITTED';
  if (opts.enforcePerTxn && amount > limit.perTxnMax) return 'PER_TRANSACTION';
  if (currentBalance + amount > limit.maxBalance) return 'MAX_BALANCE';
  return null;
}

// ─────────────────────────── per-card limits (phase 3) ───────────────────────────

export interface CardLimitValues {
  perTxnLimit: bigint;
  dailyLimit: bigint;
  monthlyLimit: bigint;
  /** SINGLE_USE cards: cap on the one authorization (null = no cap). */
  amountCap: bigint | null;
}

export type CardLimitViolation = 'PER_TRANSACTION' | 'DAILY' | 'MONTHLY' | 'AMOUNT_CAP';

/**
 * Per-card spend check. `usage` is the card's spend in the current UTC day / month: captured
 * amounts plus still-open holds (an authorization counts as spend from the moment it is approved).
 */
export function checkCardSpend(limit: CardLimitValues, usage: OutflowUsage, amount: bigint): CardLimitViolation | null {
  if (limit.amountCap !== null && amount > limit.amountCap) return 'AMOUNT_CAP';
  if (amount > limit.perTxnLimit) return 'PER_TRANSACTION';
  if (usage.daily + amount > limit.dailyLimit) return 'DAILY';
  if (usage.monthly + amount > limit.monthlyLimit) return 'MONTHLY';
  return null;
}

/** Updated card limits must satisfy 0 < per-transaction <= daily <= monthly. */
export function validCardLimits(perTxn: bigint, daily: bigint, monthly: bigint): boolean {
  return perTxn > 0n && perTxn <= daily && daily <= monthly;
}
