import { createHmac } from 'node:crypto';

/** Must match HmacTileSeeder in the API: HMAC-SHA256(secret, "fileId:page"), first 32 hex chars. */
export function tileSeed(secret: string, fileId: string, pageNo: number): string {
  return createHmac('sha256', secret).update(`${fileId}:${pageNo}`).digest('hex').slice(0, 32);
}
