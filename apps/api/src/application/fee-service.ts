import {
  type AdminFeeRowDto,
  FEE_CANCEL_GRACE_MINUTES,
  type FeeEntryInput,
  type FeeRuleDto,
  type FeeRuleInput,
  type FeeStatementDto,
  type LedgerEntryDto,
  type SettlementDto,
  campusClock,
} from '@ss/contracts';
import type {
  FeeRepository,
  FeeRuleRecord,
  LedgerRecord,
  MessOrderRecord,
  MessOrderRepository,
  MessRepository,
  SettlementRecord,
} from '../domain/campus-ports';
import type { Clock } from '../domain/ports';
import { fail } from './errors';
import { addDays } from './owner-insights';

/** Who wrote an entry the system made by itself. */
export const SYSTEM = 'system';
const DAY_MS = 24 * 3600 * 1000;

const monthOf = (day: string) => day.slice(0, 7);
const firstDay = (month: string) => `${month}-01`;
const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const daysIn = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const lastDay = (month: string) => `${month}-${String(daysIn(month)).padStart(2, '0')}`;
const rupees = (paise: number) => `₹${(paise / 100).toFixed(paise % 100 ? 2 : 0)}`;

/** The rule in force on a day: the newest one that had started by then. */
export function ruleOn(rules: FeeRuleRecord[], day: string): FeeRuleRecord | null {
  let best: FeeRuleRecord | null = null;
  for (const r of rules)
    if (
      r.startsOn <= day &&
      (!best ||
        r.startsOn > best.startsOn ||
        (r.startsOn === best.startsOn && r.createdAt.getTime() >= best.createdAt.getTime()))
    )
      best = r;
  return best;
}

/** An order's fee in paise under a rule, accepted on `day`, and the words that explain it. */
export function feeFor(
  rule: FeeRuleRecord | null,
  order: Pick<MessOrderRecord, 'total' | 'tiffin'>,
  day: string,
): { amount: number; note: string } {
  if (!rule || rule.mode === 'none') return { amount: 0, note: 'No fee set' };
  if (rule.freeUntil && day <= rule.freeUntil) return { amount: 0, note: `Free until ${rule.freeUntil}` };
  if (rule.mode === 'monthly') return { amount: 0, note: 'Monthly plan' };
  const fixed = (order.tiffin ? rule.tiffinFee : rule.perOrder) * 100;
  const share = Math.round((order.total * rule.percentBp) / 100);
  const parts = [
    fixed ? `${rupees(fixed)}${order.tiffin ? ' tiffin plan' : ''}` : '',
    rule.percentBp ? `${rule.percentBp / 100}% of ₹${order.total}` : '',
  ].filter(Boolean);
  return { amount: fixed + share, note: parts.join(' + ') || 'No fee on this order' };
}

/** What a monthly plan comes to for the days of `month` from its first day up to `upTo`. */
export function monthlyCharge(rules: FeeRuleRecord[], month: string, upTo = lastDay(month)) {
  const days = daysIn(month);
  let exact = 0;
  let charged = 0;
  for (let d = 1; d <= days; d++) {
    const day = `${month}-${String(d).padStart(2, '0')}`;
    if (day > upTo) break;
    const r = ruleOn(rules, day);
    if (!r || r.mode !== 'monthly' || (r.freeUntil && day <= r.freeUntil)) continue;
    exact += (r.monthly * 100) / days;
    charged++;
  }
  return { amount: Math.round(exact), days: charged, of: days };
}

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

/**
 * Restaurant fees and settlements. Every money event is a ledger entry that is only ever added;
 * the balance is always the sum of the entries. An order's fee is written the moment it's accepted
 * (and the five-minute cron writes any that a failed request missed), so no accepted order is lost.
 */
export class FeeService {
  constructor(
    private readonly fees: FeeRepository,
    private readonly messes: MessRepository,
    private readonly orders: MessOrderRepository,
    private readonly clock: Clock,
  ) {}

  private today() {
    return campusClock(this.clock.now()).date;
  }

  private async restaurant(slug: string) {
    const mess = await this.messes.find(slug);
    if (!mess || mess.kind !== 'restaurant') throw fail.notFound('That restaurant');
    return mess;
  }

  // ── Written by the order flow ──

  /** The restaurant accepted an order: its fee, at the rule of the day it was accepted. Once only. */
  async accepted(order: MessOrderRecord) {
    const at = order.chat.acceptedAt ?? this.clock.now();
    const day = campusClock(at).date;
    const [rules, settlements] = await Promise.all([
      this.fees.rules(order.messSlug),
      this.fees.settlements(order.messSlug),
    ]);
    const { amount, note } = feeFor(ruleOn(rules, day), order, day);
    // Written late into a month already closed: it goes into today's month instead, saying so.
    const late = settlements.some((s) => s.period === monthOf(day));
    await this.fees.add({
      messSlug: order.messSlug,
      day: late ? this.today() : day,
      kind: 'order',
      orderId: order.id,
      period: '',
      amount,
      note: late ? `${note} (accepted ${day})` : note,
      method: '',
      createdBy: SYSTEM,
    });
  }

  /** An order's fee now: the fee written at acceptance, and what's left of it after waivers. */
  private standing(entries: LedgerRecord[], orderId: string) {
    const mine = entries.filter((e) => e.orderId === orderId);
    const fee = mine.find((e) => e.kind === 'order');
    return {
      fee: fee?.amount ?? 0,
      net: sum(mine.map((e) => e.amount)),
      touched: mine.some((e) => e.kind === 'waive' || e.kind === 'unwaive'),
    };
  }

  /** Waive an order's fee, or undo a waiver. `auto` waivers happen once; the admin's choice stands. */
  async waive(orderId: string, waive: boolean, note: string, by: string, auto = false) {
    const order = await this.orders.find(orderId);
    if (!order) throw fail.notFound('That order');
    const entries = await this.fees.entries(order.messSlug);
    const s = this.standing(entries, orderId);
    if (auto && s.touched) return false;
    if (s.fee <= 0) {
      if (auto) return false;
      throw fail.badRequest('This order has no fee to waive.');
    }
    if (waive ? s.net !== s.fee : s.net !== 0) {
      if (auto) return false;
      throw fail.badRequest(waive ? 'This fee is already waived.' : "This fee isn't waived.");
    }
    await this.fees.add({
      messSlug: order.messSlug,
      day: this.today(),
      kind: waive ? 'waive' : 'unwaive',
      orderId,
      period: '',
      amount: waive ? -s.fee : s.fee,
      note,
      method: '',
      createdBy: by,
    });
    return true;
  }

  /** The restaurant cancelled an order it had accepted: no fee if it was soon after (ran out, closed). */
  async cancelledAfterAccepting(order: MessOrderRecord) {
    const at = order.chat.acceptedAt;
    if (!at || this.clock.now().getTime() - at.getTime() > FEE_CANCEL_GRACE_MINUTES * 60_000) return;
    await this.waive(
      order.id,
      true,
      `Cancelled by the restaurant within ${FEE_CANCEL_GRACE_MINUTES} min of accepting`,
      SYSTEM,
      true,
    ).catch(() => false);
  }

  /**
   * The five-minute cron (and every statement): writes the fee of any order accepted in the last
   * week that has none (a request that failed half way), and the grace waiver it should have had.
   */
  async reconcile() {
    const since = new Date(this.clock.now().getTime() - 7 * DAY_MS);
    const [orders, entries] = await Promise.all([
      this.orders.listSince(new Date(since.getTime() - 2 * DAY_MS), 10000),
      this.fees.entriesSince(addDays(campusClock(since).date, -2)),
    ]);
    const billed = new Set(entries.filter((e) => e.kind === 'order').map((e) => e.orderId));
    let added = 0;
    for (const o of orders) {
      if (!o.chat.acceptedAt || o.chat.acceptedAt < since || billed.has(o.id)) continue;
      await this.accepted(o);
      added++;
      const cancelledSoon =
        o.status === 'rejected' &&
        o.updatedAt.getTime() - o.chat.acceptedAt.getTime() <= FEE_CANCEL_GRACE_MINUTES * 60_000;
      if (cancelledSoon)
        await this.waive(
          o.id,
          true,
          `Cancelled by the restaurant within ${FEE_CANCEL_GRACE_MINUTES} min of accepting`,
          SYSTEM,
          true,
        ).catch(() => false);
    }
    return added;
  }

  // ── Monthly plans ──

  /** Writes the monthly charge of every month that's over and not closed yet (once each). */
  private async chargeMonths(
    slug: string,
    rules: FeeRuleRecord[],
    closed: Set<string>,
    entries: LedgerRecord[],
  ) {
    if (!rules.some((r) => r.mode === 'monthly')) return false;
    const current = monthOf(this.today());
    const charged = new Set(entries.filter((e) => e.kind === 'monthly').map((e) => e.period));
    let month = monthOf(rules.reduce((m, r) => (r.startsOn < m ? r.startsOn : m), rules[0]!.startsOn));
    let wrote = false;
    for (; month < current; month = nextMonth(month)) {
      if (closed.has(month) || charged.has(month)) continue;
      const c = monthlyCharge(rules, month);
      if (!c.amount) continue;
      const added = await this.fees.add({
        messSlug: slug,
        day: lastDay(month),
        kind: 'monthly',
        orderId: '',
        period: month,
        amount: c.amount,
        note:
          c.days === c.of ? `Monthly plan, ${month}` : `Monthly plan, ${c.days} of ${c.of} days of ${month}`,
        method: '',
        createdBy: SYSTEM,
      });
      wrote ||= !!added;
    }
    return wrote;
  }

  /** Everything about one restaurant's account, with monthly charges brought up to date. */
  private async load(slug: string) {
    const [rules, settlements] = await Promise.all([this.fees.rules(slug), this.fees.settlements(slug)]);
    let entries = await this.fees.entries(slug);
    const closed = new Set(settlements.map((s) => s.period));
    if (await this.chargeMonths(slug, rules, closed, entries)) entries = await this.fees.entries(slug);
    return { rules, settlements, entries, closed };
  }

  private unclosed(entries: LedgerRecord[], closed: Set<string>) {
    const current = monthOf(this.today());
    return [...new Set(entries.map((e) => monthOf(e.day)))]
      .filter((m) => m < current && !closed.has(m))
      .sort();
  }

  private totals(entries: LedgerRecord[], month: string) {
    const start = firstDay(month);
    const inMonth = entries.filter((e) => monthOf(e.day) === month);
    const opening = sum(entries.filter((e) => e.day < start).map((e) => e.amount));
    const money = inMonth.filter((e) => e.kind !== 'payment');
    return {
      inMonth,
      opening,
      charges: sum(money.filter((e) => e.amount > 0).map((e) => e.amount)),
      credits: sum(money.filter((e) => e.amount < 0).map((e) => e.amount)),
      payments: -sum(inMonth.filter((e) => e.kind === 'payment').map((e) => e.amount)),
      closing: opening + sum(inMonth.map((e) => e.amount)),
    };
  }

  // ── Statements ──

  async statement(slug: string, period: string | undefined, forOwner: boolean): Promise<FeeStatementDto> {
    const mess = await this.restaurant(slug);
    await this.reconcile().catch(() => 0);
    const today = this.today();
    const current = monthOf(today);
    const month = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) && period <= current ? period : current;
    const { rules, settlements, entries, closed } = await this.load(slug);
    const t = this.totals(entries, month);
    const ids = [...new Set(t.inMonth.map((e) => e.orderId).filter(Boolean))];
    const start = new Date(`${firstDay(month)}T00:00:00+05:30`);
    const nearby = await this.orders.listSince(new Date(start.getTime() - 45 * DAY_MS), 10000, slug);
    const byId = new Map(nearby.map((o) => [o.id, o]));
    for (const id of ids)
      if (!byId.has(id)) {
        const o = await this.orders.find(id);
        if (o) byId.set(id, o);
      }
    const orderEntries = t.inMonth.filter((e) => e.kind === 'order');
    const waivedNow = (id: string) => {
      const s = this.standing(entries, id);
      return s.fee > 0 && s.net === 0;
    };
    const unclosed = this.unclosed(entries, closed);
    const settlement = settlements.find((s) => s.period === month) ?? null;
    return {
      slug,
      messName: mess.name,
      period: month,
      rule: this.ruleDto(ruleOn(rules, today), forOwner),
      rules: [...rules].reverse().map((r) => this.ruleDto(r, forOwner)!),
      opening: t.opening,
      charges: t.charges,
      credits: t.credits,
      payments: t.payments,
      closing: t.closing,
      balanceNow: sum(entries.map((e) => e.amount)),
      orders: orderEntries.length,
      sales: sum(orderEntries.map((e) => byId.get(e.orderId)?.total ?? 0)),
      waived: orderEntries.filter((e) => waivedNow(e.orderId)).length,
      monthlySoFar: month === current ? monthlyCharge(rules, month, today).amount : 0,
      entries: [...t.inMonth]
        .sort((a, b) => b.day.localeCompare(a.day) || b.createdAt.getTime() - a.createdAt.getTime())
        .map((e) =>
          this.entryDto(e, byId.get(e.orderId), e.kind === 'order' && waivedNow(e.orderId), forOwner),
        ),
      settlement: settlement ? this.settlementDto(settlement, forOwner) : null,
      settlements: [...settlements].reverse().map((s) => this.settlementDto(s, forOwner)),
      unclosed,
      canClose: month < current && !closed.has(month) && !unclosed.some((m) => m < month),
    };
  }

  /** Admin › Restaurant fees: every restaurant's balance and this month at a glance. */
  async overview(): Promise<AdminFeeRowDto[]> {
    await this.reconcile().catch(() => 0);
    const today = this.today();
    const current = monthOf(today);
    const restaurants = (await this.messes.list()).filter((m) => m.kind === 'restaurant');
    const monthStart = new Date(`${firstDay(current)}T00:00:00+05:30`);
    const [rules, entries, settlements, orders] = await Promise.all([
      this.fees.allRules(),
      this.fees.entriesSince('2000-01-01'),
      this.fees.allSettlements(),
      this.orders.listSince(new Date(monthStart.getTime() - 2 * DAY_MS), 10000),
    ]);
    const totals = new Map(orders.map((o) => [o.id, o.total]));
    const rows: AdminFeeRowDto[] = [];
    for (const m of restaurants) {
      const mine = rules.filter((r) => r.messSlug === m.slug);
      const closed = new Set(settlements.filter((s) => s.messSlug === m.slug).map((s) => s.period));
      const ledger = entries.filter((e) => e.messSlug === m.slug);
      const ledger2 = (await this.chargeMonths(m.slug, mine, closed, ledger))
        ? await this.fees.entries(m.slug)
        : ledger;
      const month = ledger2.filter((e) => monthOf(e.day) === current && e.kind === 'order');
      rows.push({
        slug: m.slug,
        name: m.name,
        rule: this.ruleDto(ruleOn(mine, today), false),
        balanceNow: sum(ledger2.map((e) => e.amount)),
        thisMonth: {
          orders: month.length,
          sales: sum(month.map((e) => totals.get(e.orderId) ?? 0)),
          fees:
            sum(
              ledger2.filter((e) => monthOf(e.day) === current && e.kind !== 'payment').map((e) => e.amount),
            ) + monthlyCharge(mine, current, today).amount,
        },
        lastClosed: [...closed].sort().at(-1) ?? '',
        unclosed: this.unclosed(ledger2, closed),
      });
    }
    return rows.sort((a, b) => b.balanceNow - a.balanceNow || a.name.localeCompare(b.name));
  }

  // ── The admin's actions ──

  async setRule(slug: string, input: FeeRuleInput, by: string) {
    await this.restaurant(slug);
    const today = this.today();
    const startsOn = input.startsOn || today;
    if (startsOn < today)
      throw fail.badRequest('A new fee can start today or later: orders already accepted keep their fee.');
    await this.fees.addRule({
      messSlug: slug,
      startsOn,
      mode: input.mode,
      perOrder: input.mode === 'per_order' ? input.perOrder : 0,
      percentBp: input.mode === 'per_order' ? Math.round(input.percent * 100) : 0,
      tiffinFee: input.mode === 'per_order' ? input.tiffinFee : 0,
      monthly: input.mode === 'monthly' ? input.monthly : 0,
      freeUntil: input.freeUntil,
      note: input.note,
      createdBy: by,
    });
    return this.statement(slug, undefined, false);
  }

  async addEntry(slug: string, input: FeeEntryInput, by: string) {
    await this.restaurant(slug);
    const today = this.today();
    const day = input.day || today;
    if (day > today) throw fail.badRequest("That day hasn't come yet.");
    const settlements = await this.fees.settlements(slug);
    if (settlements.some((s) => s.period === monthOf(day)))
      throw fail.badRequest(`${monthOf(day)} is closed. Put it in a month that's still open.`);
    if (input.kind === 'payment' && input.amount < 0)
      throw fail.badRequest('A payment is a positive amount.');
    await this.fees.add({
      messSlug: slug,
      day,
      kind: input.kind,
      orderId: '',
      period: '',
      amount: input.kind === 'payment' ? -input.amount : input.amount,
      note: input.note,
      method: input.kind === 'payment' ? input.method : '',
      createdBy: by,
    });
    return this.statement(slug, monthOf(day), false);
  }

  async waiveOrder(slug: string, orderId: string, waive: boolean, note: string, by: string) {
    const order = await this.orders.find(orderId);
    if (!order || order.messSlug !== slug) throw fail.notFound('That order');
    await this.waive(orderId, waive, note, by);
    return this.statement(slug, undefined, false);
  }

  /**
   * Closes a month: its totals are written down for good and its closing balance carries into the
   * next. Only a month that's over, and only once every earlier month is closed.
   */
  async close(slug: string, period: string, note: string, by: string) {
    const s = await this.statement(slug, period, false);
    if (s.period !== period) throw fail.badRequest('Pick a month that has ended.');
    if (s.settlement) throw fail.badRequest(`${period} is already closed.`);
    if (!s.canClose)
      throw fail.badRequest(
        period >= monthOf(this.today())
          ? 'A month can be closed once it has ended.'
          : `Close ${s.unclosed.find((m) => m < period)} first.`,
      );
    const ok = await this.fees.close({
      messSlug: slug,
      period,
      opening: s.opening,
      charges: s.charges,
      credits: s.credits,
      payments: s.payments,
      closing: s.closing,
      orders: s.orders,
      sales: s.sales,
      note,
      closedAt: this.clock.now(),
      closedBy: by,
    });
    if (!ok) throw fail.badRequest(`${period} is already closed.`);
    return this.statement(slug, period, false);
  }

  // ── Shapes ──

  private ruleDto(r: FeeRuleRecord | null, forOwner: boolean): FeeRuleDto | null {
    if (!r) return null;
    return {
      id: r.id,
      startsOn: r.startsOn,
      mode: r.mode,
      perOrder: r.perOrder,
      percent: r.percentBp / 100,
      tiffinFee: r.tiffinFee,
      monthly: r.monthly,
      freeUntil: r.freeUntil,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      createdBy: forOwner ? '' : r.createdBy,
    };
  }

  private entryDto(
    e: LedgerRecord,
    o: MessOrderRecord | undefined,
    waived: boolean,
    forOwner: boolean,
  ): LedgerEntryDto {
    return {
      id: e.id,
      day: e.day,
      kind: e.kind,
      amount: e.amount,
      note: e.note,
      method: e.method,
      createdAt: e.createdAt.toISOString(),
      createdBy: forOwner ? (e.createdBy === SYSTEM ? SYSTEM : '') : e.createdBy,
      order: o
        ? { id: o.id, code: o.code, name: o.name, total: o.total, status: o.status, tiffin: !!o.tiffin }
        : null,
      waived,
    };
  }

  private settlementDto(s: SettlementRecord, forOwner: boolean): SettlementDto {
    return {
      period: s.period,
      opening: s.opening,
      charges: s.charges,
      credits: s.credits,
      payments: s.payments,
      closing: s.closing,
      orders: s.orders,
      sales: s.sales,
      note: s.note,
      closedAt: s.closedAt.toISOString(),
      closedBy: forOwner ? '' : s.closedBy,
    };
  }
}
