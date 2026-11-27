import { deviceLabel } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

const PHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const APP = `${PHONE} ScholarsStackApp/student`;
const LAPTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** Signs in with the device's own User-Agent (as the app and browsers send it). */
async function signInAs(b: Browser, email: string, ua: string, phoneKey?: string) {
  const login = await b.call('POST', '/dev/login', { email });
  b.token = login.json.accessToken;
  return b.call(
    'POST',
    '/session/claim',
    { label: 'ignored', ...(phoneKey ? { phoneKey } : {}) },
    { 'user-agent': ua },
  );
}

describe('the app on one phone, the website on two devices', () => {
  it('names the app as its own kind of device', () => {
    expect(deviceLabel(APP)).toBe('Scholars Stack app · Android');
    expect(deviceLabel(`${PHONE} ScholarsStackApp/partner`)).toBe('Partner app · Android');
    expect(deviceLabel(PHONE)).toBe('Chrome on Android');
  });

  it('refuses the app on a second phone, while a browser can still be the second device', async () => {
    const { app } = setup();
    const email = 'rahul@vitbhopal.ac.in';
    expect((await signInAs(new Browser(app), email, APP)).status).toBe(200);
    // A friend's phone with the app: refused, and told which phone has it.
    const second = await signInAs(new Browser(app), email, APP);
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe('DEVICE_LIMIT');
    expect(second.json.error.details).toHaveLength(1);
    expect(second.json.error.details[0].label).toBe('Scholars Stack app · Android');
    // The website on a laptop is still fine: two devices in all.
    const laptop = await signInAs(new Browser(app), email, LAPTOP);
    expect(laptop.status).toBe(200);
    expect(laptop.json.devices).toHaveLength(2);
  });

  it('two browsers stay allowed; the app’s first sign-in takes priority over the older one', async () => {
    const { app, clock } = setup();
    const email = 'rahul@vitbhopal.ac.in';
    const old = new Browser(app);
    expect((await signInAs(old, email, PHONE)).status).toBe(200);
    clock.advance(60_000);
    const laptop = new Browser(app);
    expect((await signInAs(laptop, email, LAPTOP)).status).toBe(200);
    // The first time the app signs in, it takes the place of the browser used least recently, at once.
    const first = await signInAs(new Browser(app), email, APP);
    expect(first.status).toBe(200);
    expect(first.json.devices.map((d: { label: string }) => d.label).sort()).toEqual([
      'Chrome on Windows',
      'Scholars Stack app · Android',
    ]);
    expect((await old.call('GET', '/me')).json.error.code).toBe('SESSION_REPLACED');
    expect((await laptop.call('GET', '/me')).status).toBe(200);
  });

  it('after the first time, the app follows the three-day rule', async () => {
    const { app, clock } = setup();
    const email = 'rahul@vitbhopal.ac.in';
    const phoneApp = new Browser(app);
    await signInAs(phoneApp, email, APP);
    // The student signs the app out (removed), then fills both slots with browsers.
    const appId = (await phoneApp.call('GET', '/me')).json.devices[0].id;
    const b1 = new Browser(app);
    await signInAs(b1, email, PHONE);
    await b1.call('DELETE', `/me/devices/${appId}`);
    clock.advance(3 * 24 * 60 * 60 * 1000 + 1);
    await signInAs(new Browser(app), email, LAPTOP);
    // The app again on a phone: no priority this time; it waits like any third device.
    const again = await signInAs(new Browser(app), email, APP);
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('DEVICE_LIMIT');
  });

  it('the same phone reinstalling the app gets back in after a day unused', async () => {
    const { app, clock } = setup();
    const email = 'rahul@vitbhopal.ac.in';
    const old = new Browser(app);
    await signInAs(old, email, APP);
    clock.advance(24 * 60 * 60 * 1000 + 1);
    const fresh = await signInAs(new Browser(app), email, APP);
    expect(fresh.status).toBe(200);
    expect(fresh.json.devices).toHaveLength(1);
    // The old copy is signed out.
    expect((await old.call('GET', '/me')).json.error.code).toBe('SESSION_REPLACED');
  });

  it('staff are not limited to one app phone', async () => {
    const { app } = setup();
    expect((await signInAs(new Browser(app), 'admin@vitbhopal.ac.in', APP)).status).toBe(200);
    expect((await signInAs(new Browser(app), 'admin@vitbhopal.ac.in', APP)).status).toBe(200);
  });

  it('clearing the app’s data: the same phone is the same device again, at once', async () => {
    const { app } = setup();
    const email = 'rahul@vitbhopal.ac.in';
    const before = new Browser(app);
    expect((await signInAs(before, email, APP, 'a1b2c3d4e5f60718')).status).toBe(200);
    await signInAs(new Browser(app), email, LAPTOP);
    // Data cleared: no cookie, a brand-new copy of the app on the same phone.
    const after = await signInAs(new Browser(app), email, APP, 'A1B2C3D4E5F60718');
    expect(after.status).toBe(200);
    expect(after.json.devices).toHaveLength(2);
  });

  it('one phone can’t hop between students’ accounts', async () => {
    const { app } = setup();
    expect((await signInAs(new Browser(app), 'rahul@vitbhopal.ac.in', APP, 'feedface00112233')).status).toBe(
      200,
    );
    const other = await signInAs(
      new Browser(app),
      'asha.24bce10001@vitbhopal.ac.in',
      APP,
      'feedface00112233',
    );
    expect(other.status).toBe(409);
    expect(other.json.error.code).toBe('PHONE_IN_USE');
    // A different phone is fine for that student, and so is a browser.
    expect(
      (await signInAs(new Browser(app), 'asha.24bce10001@vitbhopal.ac.in', APP, '0011223344556677')).status,
    ).toBe(200);
  });

  it('the Partner app is never tied to a phone', async () => {
    const { app } = setup();
    const partnerUa = `${PHONE} ScholarsStackApp/partner`;
    expect(
      (await signInAs(new Browser(app), 'admin@vitbhopal.ac.in', partnerUa, 'cafebabe01234567')).status,
    ).toBe(200);
    expect(
      (await signInAs(new Browser(app), 'rahul@vitbhopal.ac.in', partnerUa, 'cafebabe01234567')).status,
    ).toBe(200);
  });
});
