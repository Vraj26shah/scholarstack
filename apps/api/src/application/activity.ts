import type { TrackHitBody } from '@ss/contracts';

/**
 * What a page view or an action is recorded as. Only known pages are kept, by their route, so the
 * activity table can't be filled with made-up paths (and a file id or order id never ends up in
 * it). Returns null for anything that isn't counted (admin pages, sign-in callbacks).
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOOL = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PLAIN = new Set([
  '/',
  '/shelf',
  '/account',
  '/contribute',
  '/help',
  '/sign-in',
  '/terms',
  '/privacy',
  '/contact',
  '/unsubscribe',
]);

export function pageTarget(rawPath: string): string | null {
  const path = (rawPath.split(/[?#]/)[0] ?? '').toLowerCase().replace(/\/+$/, '') || '/';
  if (path.length > 120) return null;
  if (PLAIN.has(path)) return path;
  if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/auth/')) return null;
  const [, first, second, ...rest] = path.split('/');
  if (rest.length > 0) return '/other';
  if ((first === 'c' || first === 'b') && second && second.length <= 80 && SLUG.test(second))
    return `/${first}/${second}`;
  // Every tool, including ones added later, by its key.
  if (first === 'tools' && second && TOOL.test(second)) return `/tools/${second}`;
  // Which file or order is private detail: only that the reader or checkout was used.
  if (first === 'read' && second) return '/read';
  if (first === 'checkout' && second) return '/checkout';
  return '/other';
}

const ON_PAGE = new Set(['peek_open', 'begin_checkout', 'apply_promo_code']);
/** Actions that say where they happened on any page: a tool used, or someone stuck. */
const ANY_PAGE = new Set([
  'tool_used',
  'stuck_error',
  'stuck_crash',
  'stuck_rage',
  'stuck_form',
  'payment_cancelled',
]);

/** An action, with the page it was on: "peek_open:/c/dbms-2025-cse-core", "tool_used:/tools/cgpa". */
export function activityTarget(body: TrackHitBody): { kind: 'page' | 'action'; target: string } | null {
  const page = pageTarget(body.path);
  if (body.kind === 'page') return page ? { kind: 'page', target: page } : null;
  // "from:whatsapp/ece-25:/tools/timetable" (landed on that page from that link) and
  // "signin_from:whatsapp/ece-25" (signed in after arriving that way). Tags are already checked
  // against CAMPAIGN_TAG, so they fit the activity table's target rule.
  if (body.kind === 'source') {
    const tag = `${body.source}/${body.campaign ?? '-'}`;
    return body.step === 'arrived'
      ? { kind: 'action', target: `from:${tag}${page ? `:${page}` : ''}` }
      : { kind: 'action', target: `signin_from:${tag}` };
  }
  if (body.name === 'tool_used')
    return page?.startsWith('/tools/') ? { kind: 'action', target: `tool_used:${page}` } : null;
  // Only actions that belong to the course or bundle on screen name it (signing in doesn't).
  const on =
    page && ((ON_PAGE.has(body.name) && /^\/[cb]\//.test(page)) || ANY_PAGE.has(body.name)) ? page : null;
  return { kind: 'action', target: on ? `${body.name}:${on}` : body.name };
}
