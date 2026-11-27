import { deviceLabel } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

const PHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const APP = `${PHONE} ScholarsStackApp/student`;
const LAPTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** Signs in with the device's own User-Agent (as the app and browsers send it). */
async function signInAs(b: Browser, email: string, ua: string) {
  const login = await b.call('POST', '/dev/login', { email });
  b.token = login.json.accessToken;
  return b.call('POST', '/session/claim', { label: 'ignored' }, { 'user-agent': ua });
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

  it('two browsers stay allowed for the website', async () => {
    const { app } = setup();
    const email = 'rahul@vitbhopal.ac.in';
    expect((await signInAs(new Browser(app), email, PHONE)).status).toBe(200);
    expect((await signInAs(new Browser(app), email, LAPTOP)).status).toBe(200);
    // …and the total stays two: the app can't be a third.
    expect((await signInAs(new Browser(app), email, APP)).json.error.code).toBe('DEVICE_LIMIT');
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
});
