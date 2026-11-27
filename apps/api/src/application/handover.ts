import { type DisputeKind, HANDOVER } from '@ss/contracts';
import type { MessOrderRecord } from '../domain/campus-ports';

/**
 * Handover codes: the student's secret 4-digit code for an order (or one tiffin meal). Each code is
 * worked out from the order's secret, which never leaves the server and is never shown to the
 * restaurant, so the restaurant can only know it by being shown it by the student.
 */

/** A fresh secret for a new order (128 random bits). */
export function newHandoverSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
}

/** What a code is for: the order itself, or one tiffin meal (a make-up names the day it makes up). */
export const ORDER_SCOPE = 'order';
export const mealScope = (day: string, meal: string, makeupFor = '') => `meal|${day}|${meal}|${makeupFor}`;

/** Two rounds of a 32-bit mix (murmur3's finaliser over FNV-1a): fine for 4 digits from a secret. */
function mix(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** The 4-digit code for this scope ('' when the order has no secret: orders from before codes). */
export function handoverCode(secret: string, scope: string): string {
  if (!secret) return '';
  const n = (mix(`${secret}|${scope}`, 0x9e3779b9) ^ mix(`${scope}|${secret}`, 0x7f4a7c15)) >>> 0;
  return String(n % 10 ** HANDOVER.codeLength).padStart(HANDOVER.codeLength, '0');
}

/** Wrong codes typed today on this order (the count starts again each campus day). */
export const triesToday = (o: MessOrderRecord, today: string) =>
  o.chat.handoverTriesOn === today ? o.chat.handoverTries : 0;

const HOUR = 3600_000;
const MIN = 60_000;

/**
 * What the student may say about an order right now: "I got it" (`canConfirm`), or contest it
 * (`canDispute`: food that never came, or a "didn't collect" they say is wrong).
 */
export function studentOptions(
  o: MessOrderRecord,
  now: Date,
): { canConfirm: boolean; canDispute: DisputeKind } {
  const none = { canConfirm: false, canDispute: '' as DisputeKind };
  if (o.tiffin) return none;
  const c = o.chat;
  const t = now.getTime();
  if (c.dispute) {
    // Withdrawing "I didn't get it" by saying it came after all, while the admin hasn't decided.
    return { canConfirm: c.dispute === 'not_received' && c.disputeState === 'open', canDispute: '' };
  }
  if (o.status === 'accepted' || o.status === 'ready') {
    const since = (c.respondedAt ?? o.createdAt).getTime();
    return {
      canConfirm: true,
      canDispute: t - since >= HANDOVER.lateAfterMinutes * MIN ? 'not_received' : '',
    };
  }
  if (o.status === 'done' && c.handoverHow === 'owner' && c.handedOverAt) {
    const fresh = t - c.handedOverAt.getTime() <= HANDOVER.answerHours * HOUR;
    return { canConfirm: fresh, canDispute: fresh ? 'not_received' : '' };
  }
  if (o.status === 'cancelled' && c.noShowAt && t - c.noShowAt.getTime() <= HANDOVER.answerHours * HOUR)
    return { canConfirm: false, canDispute: 'no_show' };
  return none;
}

/** A "didn't collect" that counts: not contested, or contested and decided for the restaurant. */
export const noShowCounts = (o: MessOrderRecord) =>
  !!o.chat.noShowAt && !(o.chat.dispute === 'no_show' && ['open', 'student'].includes(o.chat.disputeState));
