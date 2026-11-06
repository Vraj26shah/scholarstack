import type { DeviceDto, MeDto } from '@ss/contracts';
import { type Device, DeviceLimitReached, type Principal } from '../domain/entities';
import type { Clock, DeviceRepository, ProfileRepository, SessionRegistry } from '../domain/ports';
import type { AdminAccess } from './admin-access';
import type { AppConfig } from './config';
import { fail } from './errors';

const DEVICE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

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
 * Rules: one live sign-in per registered device and at most `maxDevices` registered devices.
 * A future revokedAt is a scheduled sign-out; that device remains live until that instant.
 */
export class AccountService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly devices: DeviceRepository,
    private readonly sessions: SessionRegistry,
    private readonly config: AppConfig,
    private readonly admins: Pick<AdminAccess, 'isAdmin'>,
    private readonly clock: Clock,
  ) {}

  private async deviceCooldownUntil(userId: string, now: Date): Promise<Date | null> {
    return this.devices.latestRevokedAt(userId, now);
  }

  isAdmin(principal: Principal): Promise<boolean> {
    return this.admins.isAdmin(principal.email);
  }

  /** Called after sign-in. Refreshes this device's session without displacing other devices. */
  async claimDevice(principal: Principal, label: string, cookieDeviceId: string | null): Promise<Device> {
    await this.profiles.ensure(principal);
    const now = this.clock.now();
    const active = await this.devices.listActive(principal.userId, now);
    const sessions = await this.sessions.list(principal.userId);

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
    // A previously registered auth session without its matching HttpOnly device cookie
    // is a copied token. Do not silently register it as another device.
    const sessionOwner = sessions.find((session) => session.sessionId === principal.sessionId);
    if (sessionOwner && (!device || sessionOwner.deviceId !== device.id)) {
      throw fail.sessionReplaced('device-check');
    }

    if (device) {
      await this.devices.touch(device.id);
    } else {
      if (active.length >= this.config.maxDevices) {
        throw fail.deviceLimit(active.map((d) => toDeviceDto(d, null, now)));
      }
      try {
        device = await this.devices.create(principal.userId, label);
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
    return {
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      isAdmin: await this.isAdmin(principal),
      emailOptIn: profile.emailOptIn,
      devices: devices.map((d) => toDeviceDto(d, currentDeviceId, now)),
      deviceCooldownUntil: cooldownUntil?.toISOString() ?? null,
    };
  }

  async updateName(principal: Principal, fullName: string): Promise<void> {
    await this.profiles.updateName(principal.userId, fullName);
  }

  async setEmailOptIn(principal: Principal, optIn: boolean): Promise<void> {
    await this.profiles.ensure(principal);
    await this.profiles.setEmailOptIn(principal.userId, optIn);
  }

  async removeDevice(principal: Principal, deviceId: string): Promise<void> {
    const now = this.clock.now();
    const cooldownUntil = await this.deviceCooldownUntil(principal.userId, now);
    if (cooldownUntil) throw fail.deviceCooldown(cooldownUntil);
    const device = await this.devices.find(deviceId);
    if (
      !device ||
      device.userId !== principal.userId ||
      (device.revokedAt && device.revokedAt.getTime() <= now.getTime())
    )
      throw fail.notFound('That device');
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
