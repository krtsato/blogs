export async function verifyTurnstile(token: string | undefined | null, secret: string | undefined, ip: string | null) {
  if (!secret) return true; // 環境に設定がない場合はスキップ
  if (!token) return false;

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form
  });
  if (!resp.ok) return false;
  const json = (await resp.json()) as { success?: boolean };
  return !!json.success;
}
