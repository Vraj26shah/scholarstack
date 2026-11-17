import type { AdminPromoCodeDto, SavePromoCodeBody } from '@ss/contracts';
import type { PromoCode, PromoUse } from '../domain/entities';
import type { PromoCodeRepository } from '../domain/ports';
import { fail } from './errors';
import { Memo } from './memo';
import {
  type PromoItem,
  commissionPaise,
  hasEnded,
  hasStarted,
  isOpen,
  normaliseCode,
  promoCovers,
  promoPricePaise,
} from './promo-codes';

/** Creators are matched by name, ignoring case and extra spaces. */
export const creatorKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** A code checked for one student and one item, with its price. */
export interface AppliedPromo {
  promo: PromoCode;
  fullPaise: number;
  pricePaise: number;
  discountPaise: number;
}

/**
 * Promo codes: the admin makes, changes and ends them; checkout asks whether one works for a
 * student and what it takes off. Base prices are never edited.
 */
export class PromoCodeService {
  constructor(
    private readonly codes: PromoCodeRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // Course and bundle pages ask "is any code running?" to decide whether to show the box at all.
  // Each Cloudflare instance keeps its own copy and an admin's save clears only the instance that
  // served it, so the copy is short-lived (10 s) and never served stale: a code switched on (or
  // off) reaches every student within seconds. A failed read is not remembered, so one database
  // hiccup can't hide the box for everyone until the copy expires.
  private readonly listMemo = new Memo<PromoCode[]>(() => this.codes.listAll(), 10_000, 10_000);

  /** Whether students should see the "Have a promo code?" link. */
  async anyRunning(): Promise<boolean> {
    const now = this.now();
    try {
      return (await this.listMemo.get()).some((p) => isOpen(p, now));
    } catch (error) {
      // No table yet, or the database hiccuped: don't offer the box this time; the next page asks again.
      console.error('[promo] could not read codes:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  async list(): Promise<AdminPromoCodeDto[]> {
    const [codes, uses] = await Promise.all([
      this.codes.listAll(),
      // Usage counts are extra: if they can't be read, the codes still show (with zeros).
      this.codes
        .paidUses()
        .catch((error) => {
          console.error('[promo] could not read code usage:', error instanceof Error ? error.message : error);
          return [] as PromoUse[];
        }),
    ]);
    const now = this.now();
    return codes.map((p) => this.toDto(p, uses, now));
  }

  private toDto(p: PromoCode, allUses: PromoUse[], now: Date): AdminPromoCodeDto {
    const uses = allUses.filter((u) => u.promoCodeId === p.id);
    return {
      id: p.id,
      code: p.code,
      kind: p.kind,
      percentOff: p.percentOff,
      amountOffPaise: p.amountOffPaise,
      appliesTo: p.appliesTo,
      courseIds: p.courseIds,
      bundleIds: p.bundleIds,
      startsAt: p.startsAt.toISOString(),
      endsAt: p.endsAt?.toISOString() ?? null,
      status: p.status,
      maxUses: p.maxUses,
      oncePerStudent: p.oncePerStudent,
      running: isOpen(p, now) && (p.maxUses === null || uses.length < p.maxUses),
      uses: uses.length,
      discountGivenPaise: uses.reduce((s, u) => s + u.discountPaise, 0),
      creatorName: p.creatorName,
      creatorContact: p.creatorContact,
      commissionKind: p.commissionKind,
      commissionValue: p.commissionValue,
      earnedPaise: uses.reduce((s, u) => s + u.commissionPaise, 0),
    };
  }

  async save(input: SavePromoCodeBody): Promise<AdminPromoCodeDto> {
    const all = await this.codes.listAll();
    if (input.id && !all.some((p) => p.id === input.id)) throw fail.notFound('That promo code');
    const code = normaliseCode(input.code);
    if (all.some((p) => p.code === code && p.id !== input.id))
      throw fail.badRequest(`There is already a code called ${code}. Edit that one, or pick another name.`);
    const chosen = input.appliesTo === 'chosen';
    // One person, one spelling: a creator already on another code keeps that code's spelling
    // (and contact, when none was typed), so "rahul  sharma" and "Rahul Sharma" stay one creator.
    const typed = input.creatorName?.trim().replace(/\s+/g, ' ') || null;
    const known = typed
      ? all.find((p) => p.id !== input.id && p.creatorName && creatorKey(p.creatorName) === creatorKey(typed))
      : undefined;
    const creatorName = known?.creatorName ?? typed;
    const creatorContact = creatorName ? input.creatorContact || known?.creatorContact || null : null;
    const saved = await this.codes.save({
      ...(input.id ? { id: input.id } : {}),
      code,
      kind: input.kind,
      percentOff: input.kind === 'percent' ? input.percentOff : null,
      amountOffPaise: input.kind === 'flat' ? input.amountOffPaise : null,
      appliesTo: input.appliesTo,
      courseIds: chosen ? [...new Set(input.courseIds)] : [],
      bundleIds: chosen ? [...new Set(input.bundleIds)] : [],
      startsAt: new Date(input.startsAt),
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      status: input.status,
      maxUses: input.maxUses,
      oncePerStudent: input.oncePerStudent,
      creatorName,
      creatorContact,
      commissionKind: creatorName ? input.commissionKind : null,
      commissionValue: creatorName && input.commissionKind ? input.commissionValue : null,
    });
    this.listMemo.forget();
    return this.toDto(saved, await this.codes.paidUses(saved.id), this.now());
  }

  async remove(id: string) {
    if (!(await this.codes.remove(id))) throw fail.notFound('That promo code');
    this.listMemo.forget();
    return { ok: true as const };
  }

  /**
   * Does this code work for this student on this item, and what does it come to? `pricePaise` is
   * what they would pay without it. Throws a plain-language reason when it doesn't work.
   */
  async apply(userId: string, item: PromoItem, rawCode: string, pricePaise: number): Promise<AppliedPromo> {
    const code = normaliseCode(rawCode);
    const promo = code ? await this.codes.findByCode(code) : null;
    const now = this.now();
    if (!promo || promo.status !== 'live' || !hasStarted(promo, now))
      throw fail.badRequest(`${code || 'That'} isn't a valid promo code.`);
    if (hasEnded(promo, now)) throw fail.badRequest(`The code ${code} has expired.`);
    if (!promoCovers(promo, item))
      throw fail.badRequest(
        `The code ${code} doesn't work on this ${'courseId' in item ? 'course' : 'bundle'}.`,
      );
    if (promo.maxUses !== null || promo.oncePerStudent) {
      const uses = await this.codes.paidUses(promo.id);
      if (promo.oncePerStudent && uses.some((u) => u.userId === userId))
        throw fail.badRequest(`You have already used the code ${code}.`);
      if (promo.maxUses !== null && uses.length >= promo.maxUses)
        throw fail.badRequest(`The code ${code} has been fully used.`);
    }
    const next = promoPricePaise(pricePaise, promo);
    if (next >= pricePaise) throw fail.badRequest(`The code ${code} can't lower this price any further.`);
    return { promo, fullPaise: pricePaise, pricePaise: next, discountPaise: pricePaise - next };
  }

  record(orderId: string, userId: string, applied: AppliedPromo) {
    return this.codes.recordRedemption({
      orderId,
      promoCodeId: applied.promo.id,
      code: applied.promo.code,
      userId,
      fullPaise: applied.fullPaise,
      discountPaise: applied.discountPaise,
      creatorName: applied.promo.creatorName,
      // Worked out now, from what the student pays, so a later change of rate never rewrites it.
      commissionPaise: commissionPaise(applied.promo, applied.pricePaise),
    });
  }
}
