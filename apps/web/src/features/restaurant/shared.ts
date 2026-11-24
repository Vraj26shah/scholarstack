import { formatMobile } from '@ss/contracts';

export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** A phone number as WhatsApp wants it: digits, with India's 91 in front of a 10-digit number. */
export const waNumber = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
};

/** Opens a WhatsApp chat with the message already typed (the person still presses send). */
export const waLink = (phone: string, text = '') =>
  `https://wa.me/${waNumber(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/** WhatsApp's own green, so the button is recognised at a glance. */
export const WA_BUTTON =
  'inline-flex items-center justify-center gap-2.5 rounded-full font-semibold no-underline press cursor-pointer select-none bg-[#1fa855] text-white hover:brightness-105 shadow-[0_10px_24px_-14px_rgba(31,168,85,0.9)]';

export interface SlipLine {
  qty: number;
  label: string;
  price: number;
}

/** The order, written out as a slip for WhatsApp. */
export function orderMessage(o: {
  restaurant: string;
  code?: string;
  lines: SlipLine[];
  total: number;
  mode: 'delivery' | 'pickup';
  address: string;
  name: string;
  phone: string;
  note: string;
}) {
  return [
    `*New order${o.code ? ` ${o.code}` : ''}* · ${o.restaurant}`,
    '',
    ...o.lines.map((l) => `${l.qty} × ${l.label} — ${rupees(l.qty * l.price)}`),
    '',
    `*Total: ${rupees(o.total)}* (pay on ${o.mode === 'delivery' ? 'delivery' : 'pickup'})`,
    o.mode === 'delivery' ? `Deliver to: ${o.address}` : 'Pickup',
    `Name: ${o.name}`,
    `Phone: ${o.phone.length === 10 ? formatMobile(o.phone) : o.phone}`,
    o.note ? `Note: ${o.note}` : '',
    '',
    'Sent from Scholars Stack',
  ]
    .filter((l, i, all) => l !== '' || (all[i - 1] ?? '') !== '')
    .join('\n');
}

/**
 * Shrinks a photo in the browser before it's uploaded: at most 900 px on its longest side, as
 * WebP (or JPEG where the browser can't make WebP). A phone photo of 4 MB becomes ~100 KB.
 */
export async function shrinkPhoto(file: File, max = 900): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't a photo we can read. Try a JPEG or PNG."));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("This browser can't prepare photos. Try another browser.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const as = (type: string, q: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));
    const webp = await as('image/webp', 0.82);
    if (webp && webp.type === 'image/webp') return webp;
    const jpeg = await as('image/jpeg', 0.85);
    if (!jpeg) throw new Error("This browser can't prepare photos. Try another browser.");
    return jpeg;
  } finally {
    URL.revokeObjectURL(url);
  }
}
