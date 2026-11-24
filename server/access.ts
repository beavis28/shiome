// Cloudflare Access のログイン確認。
// Access を通ったリクエストには Cf-Access-Jwt-Assertion ヘッダー（署名付き JWT）が付くので、
// その署名・発行元・対象（AUD）を検証する。Access を設定するまでは API を一切返さない（安全側）。
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { cached, HOUR } from './cache.ts';

// 公開鍵は取得結果（値）だけをキャッシュする。通信中の Promise をリクエスト間で共有すると Workers では止まるため
const certs = (team: string) =>
  cached(`access:certs:${team}`, HOUR, async () => {
    const res = await fetch(`${team}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`certs ${res.status}`);
    return (await res.json()) as JSONWebKeySet;
  });

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string; // 例: https://yourteam.cloudflareaccess.com
  ACCESS_AUD?: string; // Access アプリケーションの Application Audience (AUD) タグ
  ALLOW_PUBLIC?: string; // "1" で認証なし（非推奨。動作確認用）
  DEV_USER_EMAIL?: string; // ALLOW_PUBLIC=1 のときだけ使う、手元テスト用のログイン中メールアドレス
}

export type AccessResult = { ok: true; email: string | null } | { ok: false; status: 401 | 503; error: string };

export async function checkAccess(req: Request, env: AccessEnv): Promise<AccessResult> {
  if (env.ALLOW_PUBLIC === '1') return { ok: true, email: env.DEV_USER_EMAIL || null };
  const team = env.ACCESS_TEAM_DOMAIN?.replace(/\/+$/, '');
  if (!team || !env.ACCESS_AUD) {
    return { ok: false, status: 503, error: 'Cloudflare Access が未設定です（ACCESS_TEAM_DOMAIN と ACCESS_AUD を設定してください）' };
  }
  const token = req.headers.get('cf-access-jwt-assertion');
  if (!token) return { ok: false, status: 401, error: 'ログインが必要です' };
  try {
    const { payload } = await jwtVerify(token, createLocalJWKSet(await certs(team)), { issuer: team, audience: env.ACCESS_AUD });
    return { ok: true, email: typeof payload.email === 'string' ? payload.email : null };
  } catch {
    return { ok: false, status: 401, error: 'ログイン情報を確認できませんでした' };
  }
}
