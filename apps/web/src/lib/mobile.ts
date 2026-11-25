import { normaliseMobile } from '@ss/contracts';

// Typing an Indian mobile number the easy way: any of +91, 0, spaces or dashes, tidied as typed.

/** "9876543210" → "98765 43210" while typing; +91, 0, spaces and dashes are taken off. */
export function tidyMobile(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('00')) d = d.slice(2);
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
  d = d.slice(0, 10);
  return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
}
/** What to say under the number box while it's being typed. */
export function mobileHint(raw: string): { ok: boolean; text: string } | null {
  const d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (normaliseMobile(raw)) return { ok: true, text: 'Looks right' };
  if (d.length < 10)
    return { ok: false, text: `${10 - d.length} more digit${10 - d.length === 1 ? '' : 's'}` };
  return { ok: false, text: 'Indian mobile numbers start with 6, 7, 8 or 9' };
}
