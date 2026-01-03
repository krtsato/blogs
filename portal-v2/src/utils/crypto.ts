// 共通ユーティリティ（ハッシュ/JWT 検証など）

// sha256 ハッシュを hex 文字列で返す
export async function sha256(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// HS256 JWT 検証。署名と exp をチェックし、payload を返す。失敗時は null。
export async function verifyJwtHS256(token: string, secret: string): Promise<any | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  const sig = base64UrlToUint8Array(s);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify('HMAC', key, sig.buffer as ArrayBuffer, new TextEncoder().encode(data));
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(p)));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  return payload;
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const b64 = (base64Url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf;
}
