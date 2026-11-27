import type { DeviceDto, MeDto } from '@ss/contracts';
import { type Device, DeviceLimitReached, type Principal } from '../domain/entities';
import type { Clock, DeviceRepository, ProfileRepository, SessionRegistry } from '../domain/ports';
import type { AdminAccess } from './admin-access';
import type { AppConfig } from './config';
import { fail } from './errors';

const DEVICE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
/**
 * Admins run the site from a laptop, a phone, a lab machine…: they may use up to this many devices
 * (the database's device-limit trigger allows the same), and removing one signs it out at once.
 * Students keep `maxDevices` (two) and the three-day removal.
 */
export const ADMIN_MAX_DEVICES = 10;
/**
 * Restaurant owners take orders on several phones, a counter tablet and a laptop: in practice no
 * limit (the ceiling only stops a runaway script). Same in the database trigger.
 */
export const OWNER_MAX_DEVICES = 100;
/** The student app is signed in on one phone at a time; the website keeps `maxDevices` (two). */
export const APP_MAX_DEVICES = 1;
/** The student app's devices are named "Scholars Stack app · Android" (deviceLabel in contracts). */
const APP_LABEL = 'Scholars Stack app';
const isAppDevice = (label: string) => label.trim().toLowerCase().startsWith(APP_LABEL.toLowerCase());

/** A device of the same kind unused this long is taken to be this one, back again. */
const RETURNING_AFTER_MS = 24 * 60 * 60 * 1000;

function toDeviceDto(d: Device, currentId: string | null, now: Date): DeviceDto {
  return {
    id: d.id,
    label: d.label,
    lastSeenAt: d.lastSeenAt.toISOString(),
    current: d.id === currentId,
    removalAt: d.revokedAt && d.revokedAt.getTime() > now.getTime() ? d.revokedAt.toISOString() : null,
  };
}

/**
 * Accounts and per-device sessions.
 * Rules: one live sign-in per registered device and at most `maxDevices` registered devices
 * (ADMIN_MAX_DEVICES for admins). A future revokedAt is a scheduled sign-out; that device remains
 * live until that instant. Admins' removals take effect at once.
 */
export class AccountService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly devices: DeviceRepository,
    private readonly sessions: SessionRegistry,
    private readonly config: AppConfig,
    private readonly admins: Pick<AdminAccess, 'isAdmin'>,
    private readonly clock: Clock,
    /** Restaurant owners (their addresses are on a restaurant): many devices, removed at once. */
    private readonly owners?: { isOwner(email: string): Promise<boolean> },
  ) {}

  private isOwner(principal: Principal): Promise<boolean> {
    return this.owners ? this.owners.isOwner(principal.email).catch(() => false) : Promise.resolve(false);
  }

  /** Admins and owners: more devices, and a removal takes effect at once. */
  private async staff(principal: Principal) {
    const [admin, owner] = await Promise.all([
      this.isAdmin(principal).catch(() => false),
      this.isOwner(principal),
    ]);
    return { admin, owner, any: admin || owner };
  }

  private async deviceCooldownUntil(userId: string, now: Date): Promise<Date | null> {
    return this.devices.latestRevokedAt(userId, now);
  }

  isAdmin(principal: Principal): Promise<boolean> {
    return this.admins.isAdmin(principal.email);
  }

  /** How many devices this account may use. If the admin list can't be read, the student rule. */
  private async deviceLimit(principal: Principal): Promise<number> {
    const { admin, owner } = await this.staff(principal);
    if (owner) return Math.max(OWNER_MAX_DEVICES, this.config.maxDevices);
    return admin ? Math.max(ADMIN_MAX_DEVICES, this.config.maxDevices) : this.config.maxDevices;
  }

  /** Called after sign-in. Refreshes this device's session without displacing other devices. */
  async claimDevice(
    principal: Principal,
    label: string,
    cookieDeviceId: string | null,
    /** The Android app: a hash of the phone's own ID (it survives clearing the app's data). */
    phoneHash: string | null = null,
  ): Promise<Device> {
    await this.profiles.ensure(principal);
    const now = this.clock.now();
    const active = await this.devices.listActive(principal.userId, now);
    const sessions = await this.sessions.list(principal.userId);
    const limit = await this.deviceLimit(principal);

    let device: Device | null = null;
    if (cookieDeviceId) {
      const known = await this.devices.find(cookieDeviceId);
      if (
        known &&
        known.userId === principal.userId &&
        (!known.revokedAt || known.revokedAt.getTime() > now.getTime())
      )
        device = known;
    }
    // The student app knows its phone even after its data was cleared: the same phone is the same
    // device again (no new slot, no wait), and a phone can't hop between students' accounts.
    const studentApp = !!phoneHash && isAppDevice(label);
    if (studentApp && phoneHash) {
      const onPhone = await this.devices.activeByPhone(phoneHash, now);
      if (!device) device = onPhone.find((d) => d.userId === principal.userId) ?? null;
      const others = onPhone.filter((d) => d.userId !== principal.userId);
      if (others.length && !(await this.staff(principal)).any) throw fail.phoneInUse();
    }
    // A previously registered auth session without its matching HttpOnly device cookie
    // is a copied token. Do not silently register it as another device.
    const sessionOwner = sessions.find((session) => session.sessionId === principal.sessionId);
    if (sessionOwner && (!device || sessionOwner.deviceId !== device.id)) {
      throw fail.sessionReplaced('device-check');
    }

    if (device) {
      await this.devices.touch(device.id);
      if (studentApp && phoneHash && !device.phoneHash) await this.devices.setPhone(device.id, phoneHash);
    } else {
      // The same phone or laptop can lose its device cookie (cleared site data, a new browser
      // profile, the site's address changing). When the account is full and one of its devices is
      // the same kind as this one ("Chrome on Android") and hasn't been used for a day, this is
      // almost certainly that device back again: retire the old record and register this one,
      // instead of locking the student out for three days.
      // The app's first sign-in on this account takes priority: when the two devices are already
      // in use, the browser used least recently is signed out at once to make room. After that
      // (a new phone, the app signed in before), the usual three-day rule applies.
      if (isAppDevice(label) && active.length >= limit && !(await this.staff(principal)).any) {
        const firstApp = !(await this.devices.everHad(principal.userId, APP_LABEL));
        const browser = active
          .filter((d) => !isAppDevice(d.label))
          .sort((a, b) => a.lastSeenAt.getTime() - b.lastSeenAt.getTime())[0];
        if (firstApp && browser) {
          await this.devices.revoke(browser.id);
          active.splice(active.indexOf(browser), 1);
        }
      }
      const returning = this.returningDevice(active, label, now);
      if (active.length >= limit && returning) {
        await this.devices.revoke(returning.id);
        active.splice(active.indexOf(returning), 1);
      }
      if (active.length >= limit) {
        throw fail.deviceLimit(active.map((d) => toDeviceDto(d, null, now)));
      }
      // The app on a second phone: refused while it is on another one (students only; staff run
      // the apps on several phones). The phone it's on must be signed out first, or it comes back
      // as "returning" after a day unused (the same phone reinstalled).
      if (isAppDevice(label) && !(await this.staff(principal)).any) {
        let apps = active.filter((d) => isAppDevice(d.label));
        const back = apps.length >= APP_MAX_DEVICES ? this.returningDevice(apps, label, now) : null;
        if (back) {
          await this.devices.revoke(back.id);
          apps = apps.filter((d) => d !== back);
        }
        if (apps.length >= APP_MAX_DEVICES)
          throw fail.deviceLimit(apps.map((d) => toDeviceDto(d, null, now)));
      }
      try {
        device = await this.devices.create(principal.userId, label, studentApp ? phoneHash : null);
      } catch (error) {
        if (!(error instanceof DeviceLimitReached)) throw error;
        throw fail.deviceLimit(
          (await this.devices.listActive(principal.userId, now)).map((d) => toDeviceDto(d, null, now)),
        );
      }
    }

    await this.sessions.set({
      userId: principal.userId,
      sessionId: principal.sessionId,
      deviceId: device.id,
    });
    return device;
  }

  private returningDevice(active: Device[], label: string, now: Date): Device | null {
    const same = active
      .filter(
        (d) =>
          d.label.trim().toLowerCase() === label.trim().toLowerCase() &&
          now.getTime() - d.lastSeenAt.getTime() >= RETURNING_AFTER_MS,
      )
      .sort((a, b) => a.lastSeenAt.getTime() - b.lastSeenAt.getTime());
    return same[0] ?? null;
  }

  /** Every protected request: is this the live session, on the device that claimed it? */
  async assertLive(principal: Principal, cookieDeviceId: string | null): Promise<string> {
    const now = this.clock.now();
    const sessions = await this.sessions.list(principal.userId);
    const matching = sessions.find((session) => session.sessionId === principal.sessionId);
    if (matching && matching.deviceId !== cookieDeviceId) throw fail.sessionReplaced('device-check');
    if (!cookieDeviceId) throw fail.deviceUnclaimed();
    const device = await this.devices.find(cookieDeviceId);
    if (!device || device.userId !== principal.userId) throw fail.deviceUnclaimed();
    if (device.revokedAt && device.revokedAt.getTime() <= now.getTime())
      throw fail.sessionReplaced('device-check');
    const current = sessions.find((session) => session.deviceId === cookieDeviceId);
    if (!current || current.sessionId !== principal.sessionId) throw fail.deviceUnclaimed();
    return cookieDeviceId;
  }

  /** A fresh authenticated session may manage its own devices before it claims a slot. */
  async assertCanManageDevices(principal: Principal, cookieDeviceId: string | null): Promise<void> {
    const now = this.clock.now();
    const sessions = await this.sessions.list(principal.userId);
    const registered = sessions.find((session) => session.sessionId === principal.sessionId);
    if (registered) {
      if (!cookieDeviceId || registered.deviceId !== cookieDeviceId) {
        throw fail.sessionReplaced('device-check');
      }
      const device = await this.devices.find(registered.deviceId);
      if (
        !device ||
        device.userId !== principal.userId ||
        (device.revokedAt && device.revokedAt.getTime() <= now.getTime())
      ) {
        throw fail.sessionReplaced('device-check');
      }
    }
  }

  async me(principal: Principal, currentDeviceId: string | null): Promise<MeDto> {
    const profile = await this.profiles.ensure(principal);
    const now = this.clock.now();
    const devices = await this.devices.listActive(principal.userId, now);
    const cooldownUntil = await this.deviceCooldownUntil(principal.userId, now);
    const isAdmin = await this.isAdmin(principal);
    const staff = isAdmin || (await this.isOwner(principal));
    return {
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      isAdmin,
      emailOptIn: profile.emailOptIn,
      devices: devices.map((d) => toDeviceDto(d, currentDeviceId, now)),
      // Admins never wait on a removal, so there is no cooldown to show them.
      deviceCooldownUntil: staff ? null : (cooldownUntil?.toISOString() ?? null),
      maxDevices: await this.deviceLimit(principal),
      instantDeviceRemoval: staff,
    };
  }

  async updateName(principal: Principal, fullName: string): Promise<void> {
    await this.profiles.updateName(principal.userId, fullName);
  }

  async setEmailOptIn(principal: Principal, optIn: boolean): Promise<void> {
    await this.profiles.ensure(principal);
    await this.profiles.setEmailOptIn(principal.userId, optIn);
  }

  async removeDevice(principal: Principal, deviceId: string, currentDeviceId: string | null = null) {
    const now = this.clock.now();
    const admin = (await this.staff(principal)).any;
    // Students: one removal at a time, three days each. Admins and owners: straight away, any number.
    if (!admin) {
      const cooldownUntil = await this.deviceCooldownUntil(principal.userId, now);
      if (cooldownUntil) throw fail.deviceCooldown(cooldownUntil);
    }
    const device = await this.devices.find(deviceId);
    if (
      !device ||
      device.userId !== principal.userId ||
      (device.revokedAt && device.revokedAt.getTime() <= now.getTime())
    )
      throw fail.notFound('That device');
    if (admin) {
      if (deviceId === currentDeviceId)
        throw fail.badRequest('This is the device you are using. Sign out here instead.');
      await this.devices.revoke(deviceId);
      return;
    }
    await this.devices.scheduleRemoval(deviceId, new Date(now.getTime() + DEVICE_COOLDOWN_MS));
  }

  async cancelDeviceRemoval(principal: Principal, deviceId: string): Promise<void> {
    const device = await this.devices.find(deviceId);
    if (
      !device ||
      device.userId !== principal.userId ||
      !device.revokedAt ||
      device.revokedAt.getTime() <= this.clock.now().getTime()
    )
      throw fail.notFound('That scheduled device removal');
    await this.devices.cancelRemoval(deviceId);
  }
}
