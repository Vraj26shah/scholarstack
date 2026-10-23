import type { DeviceDto, MeDto } from '@ss/contracts';
import { type Device, DeviceLimitReached, type Principal } from '../domain/entities';
import type { DeviceRepository, ProfileRepository, SessionRegistry } from '../domain/ports';
import type { AppConfig } from './config';
import { fail } from './errors';

function toDeviceDto(d: Device, currentId: string | null): DeviceDto {
  return { id: d.id, label: d.label, lastSeenAt: d.lastSeenAt.toISOString(), current: d.id === currentId };
}

/**
 * Accounts and per-device sessions.
 * Rules: one live sign-in per registered device and at most `maxDevices` registered devices.
 * Revoked device/session associations stay recorded so an old JWT can never look like a fresh sign-in.
 */
export class AccountService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly devices: DeviceRepository,
    private readonly sessions: SessionRegistry,
    private readonly config: AppConfig,
  ) {}

  isAdmin(principal: Principal): boolean {
    return this.config.adminEmails.includes(principal.email.toLowerCase());
  }

  /** Called after sign-in. Refreshes this device's session without displacing other devices. */
  async claimDevice(principal: Principal, label: string, cookieDeviceId: string | null): Promise<Device> {
    await this.profiles.ensure(principal);
    const active = await this.devices.listActive(principal.userId);
    const sessions = await this.sessions.list(principal.userId);

    let device: Device | null = null;
    if (cookieDeviceId) {
      const known = await this.devices.find(cookieDeviceId);
      if (known && known.userId === principal.userId && !known.revokedAt) device = known;
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
        throw fail.deviceLimit(active.map((d) => toDeviceDto(d, null)));
      }
      try {
        device = await this.devices.create(principal.userId, label);
      } catch (error) {
        if (!(error instanceof DeviceLimitReached)) throw error;
        throw fail.deviceLimit(
          (await this.devices.listActive(principal.userId)).map((d) => toDeviceDto(d, null)),
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
    const sessions = await this.sessions.list(principal.userId);
    const matching = sessions.find((session) => session.sessionId === principal.sessionId);
    if (matching && matching.deviceId !== cookieDeviceId) throw fail.sessionReplaced('device-check');
    if (!cookieDeviceId) throw fail.deviceUnclaimed();
    const device = await this.devices.find(cookieDeviceId);
    if (!device || device.userId !== principal.userId) throw fail.deviceUnclaimed();
    if (device.revokedAt) throw fail.sessionReplaced('device-check');
    const current = sessions.find((session) => session.deviceId === cookieDeviceId);
    if (!current || current.sessionId !== principal.sessionId) throw fail.deviceUnclaimed();
    return cookieDeviceId;
  }

  /** A fresh authenticated session may manage its own devices before it claims a slot. */
  async assertCanManageDevices(principal: Principal, cookieDeviceId: string | null): Promise<void> {
    const sessions = await this.sessions.list(principal.userId);
    const registered = sessions.find((session) => session.sessionId === principal.sessionId);
    if (registered) {
      if (!cookieDeviceId || registered.deviceId !== cookieDeviceId) {
        throw fail.sessionReplaced('device-check');
      }
      const device = await this.devices.find(registered.deviceId);
      if (!device || device.userId !== principal.userId || device.revokedAt) {
        throw fail.sessionReplaced('device-check');
      }
    }
  }

  async me(principal: Principal, currentDeviceId: string | null): Promise<MeDto> {
    const profile = await this.profiles.ensure(principal);
    const devices = await this.devices.listActive(principal.userId);
    return {
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      isAdmin: this.isAdmin(principal),
      emailOptIn: profile.emailOptIn,
      devices: devices.map((d) => toDeviceDto(d, currentDeviceId)),
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
    const device = await this.devices.find(deviceId);
    if (!device || device.userId !== principal.userId || device.revokedAt) throw fail.notFound('That device');
    await this.devices.revoke(deviceId);
  }
}
