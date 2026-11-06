/**
 * Page images are stored with their tiles shuffled. The converter scrambles them with a
 * secret per-page seed; the reader receives that seed only inside a short-lived signed
 * response and puts the tiles back on a canvas. Both sides use these exact functions.
 */
export const TILE_GRID = 8;

/** xmur3 string hash → 32-bit seed. */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 PRNG. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * permutation[dest] = source tile index. In the scrambled image, the tile at position `dest`
 * holds the original tile `permutation[dest]`.
 */
export function tilePermutation(seed: string, grid: number = TILE_GRID): number[] {
  const count = grid * grid;
  const order = Array.from({ length: count }, (_, i) => i);
  const rand = prng(hashSeed(seed));
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  return order;
}

export interface TileMove {
  /** column/row of the tile in the image you read from */
  fromCol: number;
  fromRow: number;
  /** column/row of the tile in the image you write to */
  toCol: number;
  toRow: number;
}

/** Moves that turn an original page into its scrambled form. */
export function scrambleMoves(seed: string, grid: number = TILE_GRID): TileMove[] {
  return tilePermutation(seed, grid).map((source, dest) => ({
    fromCol: source % grid,
    fromRow: Math.floor(source / grid),
    toCol: dest % grid,
    toRow: Math.floor(dest / grid),
  }));
}

/** Moves that turn a scrambled page back into the original. */
export function unscrambleMoves(seed: string, grid: number = TILE_GRID): TileMove[] {
  return tilePermutation(seed, grid).map((source, dest) => ({
    fromCol: dest % grid,
    fromRow: Math.floor(dest / grid),
    toCol: source % grid,
    toRow: Math.floor(source / grid),
  }));
}
