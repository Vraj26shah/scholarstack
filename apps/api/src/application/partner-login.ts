import {
  OWNER_PIN,
  type OwnerLoginAddInput,
  type OwnerLoginDto,
  type OwnerSetupCodeDto,
  type PartnerLoginInput,
  type PartnerSessionDto,
  type PartnerSetPinInput,
  normaliseEmail,
  ownerAddressFor,
} from '@ss/contracts';
import { ErrorCode } from '@ss/contracts';
import type {
  MessRepository,
  OwnerLoginRecord,
  OwnerLoginRepository,
  SessionMinter,
} from '../domain/campus-ports';
import type { Clock } from '../domain/ports';
import { hmacSha256Hex, safeEqual } from '../infrastructure/crypto';
import { AppError, fail } from './errors';

/**
 * Restaurant owners sign in to the Partner app with their mobile number and a 4-digit PIN: no
 * SMS, no email. The admin adds the number (after checking it in person) and reads the owner a
 * one-time 6-digit setup code; the owner types number + code and picks a PIN.
 *
 * PINs and codes are stored as HMACs with a server-only pepper, so a copy of the table alone can't
 * be turned back into PINs. Guessing is stopped by locking the number after OWNER_PIN.maxTries
 * wrong tries in a row (plus the route's per-network rate limit).
 */
export class PartnerLoginService {
  constructor(
    private readonly repo: OwnerLoginRepository,
    private readonly messes: MessRepository,
    private readonly minter: SessionMinter,
    private readonly clock: Clock,
    /** Server secret; empty means PIN sign-in isn't set up on this deployment. */
    private readonly pepper: string,
    private readonly makeCode: () => string = randomCode,
    /** Called after an owner is put on a restaurant (sign-in caches the owner list). */
    private readonly ownersChanged: () => void = () => {},
  ) {}

  get available() {
    return this.pepper.length >= 16;
  }

  private need() {
    if (!this.available) throw new AppError(ErrorCode.NotReady, 'PIN sign-in isn’t switched on yet.');
  }

  private hash(kind: 'pin' | 'code', phone: string, secret: string) {
    return hmacSha256Hex(this.pepper, `${kind}:${phone}:${secret}`);
  }

  // ── Owner (the Partner app) ──

  /**
   * The first step of signing in (like Groww): the number alone says what comes next. A PIN
   * already chosen: the PIN. Not yet: the setup code from Scholars Stack, then a new PIN.
   * Throttled per network like the other steps; restaurant numbers are public anyway.
   */
  async lookup(phone: string): Promise<{ next: 'pin' | 'setup' | 'unknown' }> {
    this.need();
    const r = await this.repo.find(phone);
    if (!r) return { next: 'unknown' };
    if (r.lockedUntil && r.lockedUntil > this.clock.now()) throw this.locked(r.lockedUntil);
    return { next: r.pinHash ? 'pin' : 'setup' };
  }

  async login(input: PartnerLoginInput): Promise<PartnerSessionDto> {
    this.need();
    const r = await this.unlocked(input.phone);
    if (!r.pinHash) throw fail.badRequest('Set your PIN first with the setup code from Scholars Stack.');
    if (!safeEqual(await this.hash('pin', r.phone, input.pin), r.pinHash)) return this.wrong(r, 'PIN');
    return this.signIn(r);
  }

  async setPin(input: PartnerSetPinInput): Promise<PartnerSessionDto> {
    this.need();
    const r = await this.unlocked(input.phone);
    const now = this.clock.now();
    if (!r.setupHash || !r.setupExpiresAt || r.setupExpiresAt <= now)
      throw fail.badRequest('This setup code has expired. Ask Scholars Stack for a new one.');
    if (!safeEqual(await this.hash('code', r.phone, input.code), r.setupHash))
      return this.wrong(r, 'setup code');
    r.pinHash = await this.hash('pin', r.phone, input.pin);
    r.setupHash = '';
    r.setupExpiresAt = null;
    return this.signIn(r);
  }

  /** The record for a number that isn't locked; the same answer for unknown numbers and bad PINs. */
  private async unlocked(phone: string): Promise<OwnerLoginRecord> {
    const r = await this.repo.find(phone);
    if (!r) throw fail.badRequest('This number isn’t registered. Ask Scholars Stack to add it.');
    const now = this.clock.now();
    if (r.lockedUntil && r.lockedUntil > now) throw this.locked(r.lockedUntil);
    if (r.lockedUntil) {
      r.lockedUntil = null;
      r.failed = 0;
    }
    return r;
  }

  private locked(until: Date) {
    const mins = Math.max(1, Math.ceil((until.getTime() - this.clock.now().getTime()) / 60_000));
    return new AppError(
      ErrorCode.RateLimited,
      `Too many wrong tries. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or call Scholars Stack.`,
    );
  }

  private async wrong(r: OwnerLoginRecord, what: string): Promise<never> {
    r.failed += 1;
    if (r.failed >= OWNER_PIN.maxTries) {
      r.lockedUntil = new Date(this.clock.now().getTime() + OWNER_PIN.lockMinutes * 60_000);
      await this.repo.save(r);
      throw this.locked(r.lockedUntil);
    }
    await this.repo.save(r);
    const left = OWNER_PIN.maxTries - r.failed;
    throw fail.badRequest(`Wrong ${what}. ${left} tr${left === 1 ? 'y' : 'ies'} left.`);
  }

  private async signIn(r: OwnerLoginRecord): Promise<PartnerSessionDto> {
    // Still an owner? (The admin may have taken the number off every restaurant.)
    const owns = (await this.messes.list()).some((m) => m.ownerEmails.includes(r.email));
    if (!owns) throw fail.forbidden();
    const session = await this.minter.mint(r.email);
    r.failed = 0;
    r.lockedUntil = null;
    r.lastLoginAt = this.clock.now();
    await this.repo.save(r);
    return { ...session, email: r.email };
  }

  // ── Admin ──

  async list(): Promise<OwnerLoginDto[]> {
    const [rows, messes] = await Promise.all([this.repo.list(), this.messes.list()]);
    const now = this.clock.now();
    return rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({
        phone: r.phone,
        name: r.name,
        email: r.email,
        messes: messes
          .filter((m) => m.ownerEmails.includes(r.email))
          .map((m) => ({ slug: m.slug, name: m.name })),
        hasPin: !!r.pinHash,
        setupUntil:
          r.setupHash && r.setupExpiresAt && r.setupExpiresAt > now ? r.setupExpiresAt.toISOString() : null,
        lockedUntil: r.lockedUntil && r.lockedUntil > now ? r.lockedUntil.toISOString() : null,
        lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
  }

  /** Adds (or updates) an owner's number, puts their account on the restaurant, and returns a setup code. */
  async add(input: OwnerLoginAddInput): Promise<OwnerSetupCodeDto> {
    this.need();
    const mess = await this.messes.find(input.messSlug);
    if (!mess) throw fail.notFound('That restaurant');
    const existing = await this.repo.find(input.phone);
    const email =
      existing?.email ?? (input.email ? normaliseEmail(input.email) : ownerAddressFor(input.phone));
    if (!mess.ownerEmails.includes(email)) {
      if (mess.ownerEmails.length >= 5) throw fail.badRequest('A restaurant can have at most 5 owners.');
      await this.messes.save({ ...mess, ownerEmails: [...mess.ownerEmails, email] });
      this.ownersChanged();
    }
    const r: OwnerLoginRecord = existing ?? {
      phone: input.phone,
      name: '',
      email,
      pinHash: '',
      setupHash: '',
      setupExpiresAt: null,
      failed: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: this.clock.now(),
    };
    if (input.name) r.name = input.name;
    return this.newCode(r);
  }

  /** A fresh setup code (first sign-in, new phone, or forgotten PIN). The old PIN keeps working until a new one is set. */
  async setupCode(phone: string): Promise<OwnerSetupCodeDto> {
    this.need();
    const r = await this.repo.find(phone);
    if (!r) throw fail.notFound('That number');
    return this.newCode(r);
  }

  private async newCode(r: OwnerLoginRecord): Promise<OwnerSetupCodeDto> {
    const code = this.makeCode();
    r.setupHash = await this.hash('code', r.phone, code);
    r.setupExpiresAt = new Date(this.clock.now().getTime() + OWNER_PIN.setupHours * 3_600_000);
    r.failed = 0;
    r.lockedUntil = null;
    await this.repo.save(r);
    return { phone: r.phone, code, expiresAt: r.setupExpiresAt.toISOString() };
  }

  async unlock(phone: string): Promise<void> {
    const r = await this.repo.find(phone);
    if (!r) throw fail.notFound('That number');
    r.failed = 0;
    r.lockedUntil = null;
    await this.repo.save(r);
  }

  /** Stops PIN sign-in for this number (the account stays on the restaurant until removed there). */
  async remove(phone: string): Promise<void> {
    await this.repo.remove(phone);
  }
}

/** Six random digits (crypto-strong, no bias worth caring about at this size). */
function randomCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return String(n).padStart(6, '0');
}
