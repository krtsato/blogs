// Slack 署名検証ユーティリティ
import { HTTPException } from 'hono/http-exception';

// Slack 署名検証。失敗時は HTTPException を投げる。
export async function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  signingSecret: string
) {
  if (!timestamp || !signature) {
    throw new HTTPException(400, { message: 'missing slack signature headers' });
  }
  // リプレイ防止（5 分以内）
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) {
    throw new HTTPException(400, { message: 'stale slack request' });
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const sig = `v0=${await hmacSha256Hex(signingSecret, base)}`;
  if (!safeEqual(sig, signature)) {
    throw new HTTPException(401, { message: 'invalid slack signature' });
  }
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bufferToHex(sig);
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
