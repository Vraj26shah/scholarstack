import { ClaimDeviceBody, EmailPrefsBody, UpdateProfileBody } from '@ss/contracts';
import { Hono } from 'hono';
import {
  type AppEnv,
  authenticate,
  cookieDeviceId,
  requireLive,
  setDeviceCookie,
  throttle,
} from '../helpers';

export const meRoutes = new Hono<AppEnv>();

/** After an explicit sign-in: register this device and take over the live session. */
meRoutes.post('/session/claim', async (c) => {
  const principal = await authenticate(c);
  const { label } = ClaimDeviceBody.parse(await c.req.json());
  const container = c.get('container');
  const device = await container.account.claimDevice(principal, label, await cookieDeviceId(c));
  await setDeviceCookie(c, device.id);
  return c.json(await container.account.me(principal, device.id));
});

meRoutes.get('/me', async (c) => {
  const { principal, deviceId } = await requireLive(c);
  return c.json(await c.get('container').account.me(principal, deviceId));
});

meRoutes.patch('/me', async (c) => {
  const { principal, deviceId } = await requireLive(c);
  await throttle(c, 'profile', principal.userId);
  const { fullName } = UpdateProfileBody.parse(await c.req.json());
  const container = c.get('container');
  await container.account.updateName(principal, fullName);
  return c.json(await container.account.me(principal, deviceId));
});

meRoutes.put('/me/email', async (c) => {
  const { principal, deviceId } = await requireLive(c);
  await throttle(c, 'profile', principal.userId);
  const { emailOptIn } = EmailPrefsBody.parse(await c.req.json());
  const container = c.get('container');
  await container.account.setEmailOptIn(principal, emailOptIn);
  return c.json(await container.account.me(principal, deviceId));
});

meRoutes.delete('/me/devices/:id', async (c) => {
  const principal = await authenticate(c);
  await throttle(c, 'devices', principal.userId);
  const container = c.get('container');
  const deviceId = await cookieDeviceId(c);
  await container.account.assertCanManageDevices(principal, deviceId);
  await container.account.removeDevice(principal, c.req.param('id'));
  return c.json(await container.account.me(principal, deviceId));
});

meRoutes.get('/me/shelf', async (c) => {
  const { principal } = await requireLive(c);
  return c.json(await c.get('container').shelf.list(principal));
});
