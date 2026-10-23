/**
 * The announcement email: plain HTML tables and inline styles, because that is what
 * mail apps render reliably. The body is plain text: blank lines start paragraphs and
 * lines starting with "- " become bullets.
 */
import type { Announcement } from '../domain/entities';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface RenderContext {
  appUrl: string;
  name: string | null;
  unsubscribeUrl: string;
}

export function absoluteUrl(appUrl: string, url: string): string {
  if (!url) return '';
  return url.startsWith('/') ? `${appUrl}${url}` : url;
}

function bodyHtml(body: string): string {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim());
      if (lines.every((l) => l.startsWith('- '))) {
        const items = lines.map((l) => `<li style="margin:0 0 6px">${esc(l.slice(2))}</li>`).join('');
        return `<ul style="margin:0 0 16px;padding-left:20px">${items}</ul>`;
      }
      return `<p style="margin:0 0 16px">${lines.map(esc).join('<br>')}</p>`;
    })
    .join('');
}

export function renderAnnouncement(
  a: Pick<Announcement, 'subject' | 'heading' | 'body' | 'ctaLabel' | 'ctaUrl'>,
  ctx: RenderContext,
): { subject: string; html: string; text: string } {
  const first = ctx.name?.trim().split(/\s+/)[0];
  const hello = first ? `Hi ${esc(first)},` : 'Hi,';
  const cta = absoluteUrl(ctx.appUrl, a.ctaUrl);
  const button =
    cta && a.ctaLabel
      ? `<tr><td style="padding:8px 32px 28px"><a href="${esc(cta)}" style="display:inline-block;background:#F5B83D;color:#161B3A;font-weight:700;text-decoration:none;padding:14px 26px;border-radius:999px;font-size:16px">${esc(a.ctaLabel)} &rarr;</a></td></tr>`
      : '';
  const html = `<!doctype html><html><body style="margin:0;background:#F1F1F2;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#161B3A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1F2;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:#2F3C7E;padding:22px 32px;color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.3px">Scholars <span style="color:#A1D6E2">Stack</span></td></tr>
<tr><td style="padding:28px 32px 4px;font-size:13px;letter-spacing:2px;color:#12728A;font-family:Consolas,monospace">NEW ON THE SHELF</td></tr>
<tr><td style="padding:4px 32px 16px;font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-0.6px">${esc(a.heading)}</td></tr>
<tr><td style="padding:0 32px 8px;font-size:16px;line-height:1.6;color:#2B3256"><p style="margin:0 0 16px">${hello}</p>${bodyHtml(a.body)}</td></tr>
${button}
<tr><td style="padding:18px 32px 26px;border-top:1px solid #E6EAF2;font-size:12px;line-height:1.6;color:#4D5675">You're getting this because you signed in to Scholars Stack with your college email. <a href="${esc(ctx.unsubscribeUrl)}" style="color:#12728A">Stop these emails</a>.<br>Independent student project, not affiliated with VIT Bhopal University.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    first ? `Hi ${first},` : 'Hi,',
    '',
    a.heading,
    '',
    a.body.trim(),
    '',
    cta && a.ctaLabel ? `${a.ctaLabel}: ${cta}` : '',
    '',
    `Stop these emails: ${ctx.unsubscribeUrl}`,
  ]
    .filter((l, i, all) => !(l === '' && all[i - 1] === ''))
    .join('\n');
  return { subject: a.subject, html, text };
}
