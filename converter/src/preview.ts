import sharp from 'sharp';

export interface PreviewOptions {
  /** Width of the preview image; small enough that it's a taste, not a copy. */
  width?: number;
  quality?: number;
}

/**
 * The public first page of a unit: unscrambled, smaller than the reader's pages, with
 * "PREVIEW" stamped diagonally across it so screenshots of it are obviously samples.
 */
export async function renderPreview(
  input: Buffer | Uint8Array,
  options: PreviewOptions = {},
): Promise<Buffer> {
  const width = options.width ?? 760;
  const base = await sharp(input).flatten({ background: '#ffffff' }).resize({ width }).png().toBuffer();
  const { height = Math.round((width * 297) / 210) } = await sharp(base).metadata();
  const marks = Array.from({ length: 7 }, (_, i) => {
    const y = Math.round((i + 0.5) * (height / 6.2));
    return `<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${Math.round(width / 21)}" letter-spacing="${Math.round(width / 160)}" fill="#2F3C7E" fill-opacity="0.10" transform="rotate(-24 ${width / 2} ${y})">PREVIEW · SCHOLARS STACK</text>`;
  }).join('');
  const band = Math.round(width / 11);
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    ${marks}
    <rect x="0" y="${height - band}" width="${width}" height="${band}" fill="#2F3C7E"/>
    <text x="${width / 2}" y="${height - band / 2 + band / 10}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${Math.round(band / 3.6)}" fill="#ffffff">PAGE 1 PREVIEW · the full course is on Scholars Stack</text>
  </svg>`;
  return sharp(base)
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .webp({ quality: options.quality ?? 70 })
    .toBuffer();
}
