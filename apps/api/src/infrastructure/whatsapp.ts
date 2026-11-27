import { hmacSha256Hex, safeEqual } from './crypto';

/**
 * WhatsApp Cloud API webhook helpers. We only ever *receive* (students send "VERIFY <code>" to
 * the site's number): incoming messages cost nothing, and we never reply, so no access token or
 * paid messages are involved.
 */

/** Meta signs every webhook body with the app secret: "sha256=<hex HMAC>". */
export async function whatsappSignatureOk(appSecret: string, rawBody: string, header: string | undefined) {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  return safeEqual(header.slice(7).toLowerCase(), await hmacSha256Hex(appSecret, rawBody));
}

/** The text messages in a webhook body: who sent them (digits with country code) and what they said. */
export function whatsappTexts(body: unknown): { from: string; text: string }[] {
  const out: { from: string; text: string }[] = [];
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    const changes = (e as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      const messages = (c as { value?: { messages?: unknown[] } })?.value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const m of messages.slice(0, 50)) {
        const msg = m as { from?: unknown; type?: unknown; text?: { body?: unknown } };
        if (msg.type === 'text' && typeof msg.from === 'string' && typeof msg.text?.body === 'string')
          out.push({ from: msg.from, text: msg.text.body.slice(0, 200) });
      }
    }
  }
  return out;
}
