/*
  One shared login for the department, set in Vercel → Settings → Environment Variables:
    LOGIN_ID        the login ID
    LOGIN_PASSWORD  the password
  The password never appears in the code or on GitHub.
  After signing in, the browser holds a signed token that lasts 12 hours.
  Changing the password in Vercel (and redeploying) signs everyone out.
*/
import { createHmac, timingSafeEqual } from 'node:crypto';

const HOURS = 12;

function secret() {
  const id = process.env.LOGIN_ID || '', pw = process.env.LOGIN_PASSWORD || '';
  if (!id || !pw) throw new Error('LOGIN_ID and LOGIN_PASSWORD are not set on the server');
  return 'cdoe-workboard|' + id + '|' + pw;
}

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

const sign = payload => createHmac('sha256', secret()).update(payload).digest('base64url');

export function login(id, password, name) {
  secret(); // throws a clear error if not configured
  if (!same(String(id || '').trim(), process.env.LOGIN_ID) ||
      !same(String(password || ''), process.env.LOGIN_PASSWORD)) {
    return null;
  }
  const who = String(name || '').trim().slice(0, 60) || 'ID ' + process.env.LOGIN_ID;
  const payload = Buffer.from(JSON.stringify({ who, exp: Date.now() + HOURS * 3600e3 })).toString('base64url');
  return { token: payload + '.' + sign(payload), who };
}

/* Returns the signed-in name, or null if the token is missing, forged or expired. */
export function verify(token) {
  const [payload, mac] = String(token || '').split('.');
  if (!payload || !mac || !same(mac, sign(payload))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return p.exp > Date.now() ? p.who : null;
  } catch { return null; }
}
