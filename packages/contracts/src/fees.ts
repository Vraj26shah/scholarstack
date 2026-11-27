import { z } from 'zod';

/**
 * What restaurants pay Scholars Stack, and how it's settled.
 *
 * - A **fee rule** per restaurant says what an order costs it: nothing, a fee per accepted order
 *   (a fixed ₹ amount and/or a % of what the student pays, with its own amount for tiffin plans), or
 *   a flat monthly plan. Rules are never edited: a new rule starts on a day (today or later), so
 *   every past order keeps the price it was accepted at. A free period ("free until") comes first.
 * - Every money event is a **ledger entry**, added and never changed or deleted: an order's fee
 *   (written once, the moment the restaurant accepts it), a waiver or its undoing, a monthly
 *   charge, an adjustment, a payment received. A mistake is fixed with another entry.
 * - A month is **closed** into a settlement: opening balance, charges, credits, payments and the
 *   closing balance carried into the next month. Nothing can be added to a closed month.
 *
 * Amounts are in paise (₹1 = 100), so a percentage never loses a rupee to rounding.
 */
export const FEE_MODES = ['none', 'per_order', 'monthly'] as const;
export type FeeMode = (typeof FEE_MODES)[number];

/** A restaurant that cancels an order this soon after accepting it (ran out, closed) isn't charged. */
export const FEE_CANCEL_GRACE_MINUTES = 15;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-12');

export const FeeRuleBody = z
  .object({
    mode: z.enum(FEE_MODES),
    /** ₹ per accepted order (per_order). */
    perOrder: z.number().int().min(0).max(1000).default(0),
    /** % of what the student pays (per_order), in steps of 0.01 %. */
    percent: z.number().min(0).max(30).multipleOf(0.01).default(0),
    /** ₹ per accepted tiffin plan instead of `perOrder` (the % applies to plans too). */
    tiffinFee: z.number().int().min(0).max(10000).default(0),
    /** ₹ a month (monthly). Part months are charged by the day. */
    monthly: z.number().int().min(0).max(200000).default(0),
    /** No fees for orders accepted up to and including this day ('' = none). */
    freeUntil: z.union([day, z.literal('')]).default(''),
    /** The first day this rule applies ('' = today). Never a day already past. */
    startsOn: z.union([day, z.literal('')]).default(''),
    note: z.string().trim().max(300).default(''),
  })
  .refine((r) => r.mode !== 'monthly' || r.monthly > 0, { message: 'Set the monthly amount.' })
  .refine((r) => r.mode !== 'per_order' || r.perOrder > 0 || r.percent > 0 || r.tiffinFee > 0, {
    message: 'Set a fee per order, a percentage, or a tiffin fee.',
  });
export type FeeRuleInput = z.infer<typeof FeeRuleBody>;

/** An adjustment (+ charges more, − credits) or a payment received from the restaurant. */
export const FeeEntryBody = z.object({
  kind: z.enum(['adjust', 'payment']),
  /** Paise. A payment is positive (money received); an adjustment is signed. */
  amount: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Enter an amount.')
    .refine((n) => Math.abs(n) <= 10_000_000, 'That amount is too big.'),
  /** The day it happened ('' = today): never in the future or in a closed month. */
  day: z.union([day, z.literal('')]).default(''),
  /** Payments: how it was paid (UPI, cash…). */
  method: z.string().trim().max(40).default(''),
  note: z.string().trim().min(3, 'Say what this is for.').max(300),
});
export type FeeEntryInput = z.infer<typeof FeeEntryBody>;

export const FeeWaiveBody = z.object({
  waive: z.boolean(),
  note: z.string().trim().min(3, 'Say why.').max(300),
});
export const FeeCloseBody = z.object({ period: month, note: z.string().trim().max(300).default('') });

export const LEDGER_KINDS = ['order', 'waive', 'unwaive', 'monthly', 'adjust', 'payment'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export interface FeeRuleDto {
  id: string;
  startsOn: string;
  mode: FeeMode;
  perOrder: number;
  percent: number;
  tiffinFee: number;
  monthly: number;
  freeUntil: string;
  note: string;
  createdAt: string;
  /** Who set it (admin only; '' for owners). */
  createdBy: string;
}

export interface LedgerEntryDto {
  id: string;
  day: string;
  kind: LedgerKind;
  /** Paise: + owed to Scholars Stack, − credited or paid. */
  amount: number;
  note: string;
  method: string;
  createdAt: string;
  createdBy: string;
  /** For order entries (and their waivers): which order. */
  order: { id: string; code: string; name: string; total: number; status: string; tiffin: boolean } | null;
  /** An order fee that is currently waived (a waiver entry follows it). */
  waived: boolean;
}

export interface SettlementDto {
  period: string;
  opening: number;
  charges: number;
  credits: number;
  payments: number;
  closing: number;
  orders: number;
  sales: number;
  note: string;
  closedAt: string;
  closedBy: string;
}

/** One restaurant's account for a month (or the month so far). */
export interface FeeStatementDto {
  slug: string;
  messName: string;
  period: string;
  /** The rule in force today, and every rule there has been (newest first). */
  rule: FeeRuleDto | null;
  rules: FeeRuleDto[];
  opening: number;
  charges: number;
  credits: number;
  payments: number;
  /** Opening + everything in the month (the balance at its end, or now for the current month). */
  closing: number;
  /** What the restaurant owes now, across all months. */
  balanceNow: number;
  /** Orders accepted on the site this month, what students paid for them, fees waived. */
  orders: number;
  sales: number;
  waived: number;
  /** Monthly plan: what this month comes to so far (charged when the month ends). */
  monthlySoFar: number;
  entries: LedgerEntryDto[];
  /** Set once the month is closed. */
  settlement: SettlementDto | null;
  settlements: SettlementDto[];
  /** Months with entries that are over but not closed yet (oldest first). */
  unclosed: string[];
  /** This month can be closed now (it's over, and every month before it is closed). */
  canClose: boolean;
}

/** Admin › Restaurant fees: one row per restaurant. */
export interface AdminFeeRowDto {
  slug: string;
  name: string;
  rule: FeeRuleDto | null;
  balanceNow: number;
  thisMonth: { orders: number; sales: number; fees: number };
  lastClosed: string;
  unclosed: string[];
}
