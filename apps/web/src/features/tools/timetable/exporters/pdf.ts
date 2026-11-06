/**
 * The smallest valid PDF: one A4 landscape page showing one JPEG, centred with a margin. Written by
 * hand (a few objects and a cross-reference table), so the site needs no PDF library.
 */
export function imagePdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const pageW = 842;
  const pageH = 595;
  const margin = 24;
  const scale = Math.min((pageW - margin * 2) / width, (pageH - margin * 2) / height);
  const w = +(width * scale).toFixed(2);
  const h = +(height * scale).toFixed(2);
  const x = +((pageW - w) / 2).toFixed(2);
  const y = +((pageH - h) / 2).toFixed(2);
  const draw = `q ${w} 0 0 ${h} ${x} ${y} cm /Im0 Do Q`;

  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const add = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string | (string | Uint8Array)[]) => {
    offsets[n] = length;
    add(`${n} 0 obj\n`);
    for (const piece of Array.isArray(body) ? body : [body]) add(piece);
    add('\nendobj\n');
  };

  add('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  object(4, [
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream',
  ]);
  object(5, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);

  const xref = length;
  add('xref\n0 6\n0000000000 65535 f \n');
  for (let n = 1; n <= 5; n++) add(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/** Save bytes as a file the browser downloads. */
export function download(bytes: Uint8Array | Blob, name: string, type: string) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
