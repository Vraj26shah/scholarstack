import { TILE_GRID, scrambleMoves } from '@ss/contracts';
import sharp from 'sharp';

export interface ScrambleOptions {
  /** Longest side after resizing; keeps pages sharp but light. */
  maxWidth?: number;
  quality?: number;
}

/**
 * Resizes a page so both sides divide evenly into the tile grid, then writes each tile to its
 * shuffled position. The result is a WebP that looks like noise until the reader puts it back.
 */
export async function scramblePage(
  input: Buffer | Uint8Array,
  seed: string,
  options: ScrambleOptions = {},
): Promise<Buffer> {
  const maxWidth = options.maxWidth ?? 1240;
  const meta = await sharp(input).metadata();
  const srcW = meta.width ?? maxWidth;
  const srcH = meta.height ?? Math.round((maxWidth * 297) / 210);
  const scale = Math.min(1, maxWidth / srcW);
  const tileW = Math.max(1, Math.floor((srcW * scale) / TILE_GRID));
  const tileH = Math.max(1, Math.floor((srcH * scale) / TILE_GRID));
  const width = tileW * TILE_GRID;
  const height = tileH * TILE_GRID;

  // Decode once to raw RGB, move tiles with plain memory copies, encode once.
  // (Same output as compositing tile images, several times faster.)
  const base = await sharp(input)
    .flatten({ background: '#ffffff' })
    .resize(width, height, { fit: 'fill' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer();
  const rowBytes = width * 3;
  const tileBytes = tileW * 3;
  const out = Buffer.alloc(base.length, 255);
  for (const m of scrambleMoves(seed)) {
    for (let y = 0; y < tileH; y++) {
      const src = (m.fromRow * tileH + y) * rowBytes + m.fromCol * tileBytes;
      const dst = (m.toRow * tileH + y) * rowBytes + m.toCol * tileBytes;
      base.copy(out, dst, src, src + tileBytes);
    }
  }
  return sharp(out, { raw: { width, height, channels: 3 } })
    .webp({ quality: options.quality ?? 72 })
    .toBuffer();
}
