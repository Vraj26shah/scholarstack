import { campaignTag } from '@ss/contracts';

/**
 * Where visitors come from. Links shared in WhatsApp groups, on Instagram or on posters carry a
 * tag (`?utm_source=whatsapp&utm_campaign=ece-25`, or the short `?ref=whatsapp-ece-25`). When
 * someone lands with one, it is reported once (Admin › Insights › Where people come from), kept on
 * this device, and reported again if they sign in later, so each group or post can be judged by
 * the sign-ups it brings, not only the clicks. GA4 reads the same utm_* tags from the address on
 * its own.
 *
 * Only the tag is stored: nothing about the person, and nothing that leaves this device except the
 * two counts above.
 */

export interface Campaign {
  source: string;
  campaign?: string;
}

const KEY = 'ss_campaign';
/** A first visit older than this no longer gets the credit for a sign-in. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** The tag in a page address, or null. `ref=whatsapp-ece-25` → source "whatsapp", campaign "ece-25". */
export function campaignFrom(search: string): Campaign | null {
  const q = new URLSearchParams(search);
  const source = campaignTag(q.get('utm_source'));
  if (source) {
    const campaign = campaignTag(q.get('utm_campaign')) ?? undefined;
    return campaign ? { source, campaign } : { source };
  }
  const ref = campaignTag(q.get('ref'));
  if (!ref) return null;
  const [head, ...rest] = ref.split('-');
  const campaign = campaignTag(rest.join('-')) ?? undefined;
  return campaign ? { source: head!, campaign } : { source: head! };
}

interface Saved extends Campaign {
  at: number;
  /** A sign-in has already been reported for this visit. */
  signedIn?: boolean;
}

/** Reads the saved first visit field by field: an old or hand-edited value never breaks a page. */
function load(now: number): Saved | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (!raw || typeof raw !== 'object') return null;
    const source = campaignTag(typeof raw.source === 'string' ? raw.source : null);
    const at = typeof raw.at === 'number' ? raw.at : 0;
    if (!source || now - at > KEEP_MS) return null;
    const campaign = campaignTag(typeof raw.campaign === 'string' ? raw.campaign : null) ?? undefined;
    return { source, ...(campaign ? { campaign } : {}), at, signedIn: raw.signedIn === true };
  } catch {
    return null;
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private windows and blocked storage: the visit is still counted, the sign-in just isn't linked.
  }
}

/**
 * The page just opened. Returns the tag to report as "arrived", or null. The newest tagged link
 * wins (someone who first came from a poster and signs up after a WhatsApp post credits WhatsApp).
 */
export function noteArrival(search: string, now = Date.now()): Campaign | null {
  const c = campaignFrom(search);
  if (!c) return null;
  const prev = load(now);
  const same = prev && prev.source === c.source && prev.campaign === c.campaign;
  save({ ...c, at: now, signedIn: same ? prev.signedIn : false });
  return c;
}

/** Signed in: the tag to credit with it, once per tagged visit (null if none or already done). */
export function noteSignIn(now = Date.now()): Campaign | null {
  const s = load(now);
  if (!s || s.signedIn) return null;
  save({ ...s, signedIn: true });
  return s.campaign ? { source: s.source, campaign: s.campaign } : { source: s.source };
}

/**
 * A link to share, tagged so its visits and sign-ups are counted: `shareLink(origin, '/tools/timetable',
 * 'whatsapp', 'ECE 25 batch')` → `…/tools/timetable?utm_source=whatsapp&utm_medium=social&utm_campaign=ece-25-batch`.
 */
export function shareLink(origin: string, path: string, source: string, campaign?: string): string {
  const url = new URL(path || '/', origin);
  const s = campaignTag(source);
  const c = campaignTag(campaign);
  if (s) {
    url.searchParams.set('utm_source', s);
    url.searchParams.set('utm_medium', s === 'poster' ? 'offline' : 'social');
    if (c) url.searchParams.set('utm_campaign', c);
  }
  return url.toString();
}
