import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GmailOAuthInput } from '../../shared/contracts/gmail';

export const GMAIL_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
]);

interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number; token_type: string }
export type ExternalOpener = (url: string) => Promise<void>;
export type OAuthFetch = typeof fetch;

const base64url = (value: Buffer): string => value.toString('base64url');
const sameState = (left: string, right: string): boolean => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const exchangeGmailCode = async (input: GmailOAuthInput, code: string, verifier: string, redirectUri: string, fetchPort: OAuthFetch = fetch): Promise<TokenResponse> => {
  const body = new URLSearchParams({ client_id: input.clientId, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri });
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  const response = await fetchPort('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) throw new Error('gmail_token_exchange_failed');
  return await response.json() as TokenResponse;
};

export const refreshGmailAccessToken = async (clientId: string, refreshToken: string, clientSecret?: string, fetchPort: OAuthFetch = fetch): Promise<string> => {
  const body = new URLSearchParams({ client_id: clientId, refresh_token: refreshToken, grant_type: 'refresh_token' });
  if (clientSecret) body.set('client_secret', clientSecret);
  const response = await fetchPort('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) throw new Error('gmail_token_refresh_failed');
  const payload = await response.json() as TokenResponse;
  return payload.access_token;
};

export const authorizeGmail = async (input: GmailOAuthInput, openExternal: ExternalOpener, fetchPort: OAuthFetch = fetch): Promise<{ email: string; refreshToken: string }> => {
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(32));
  let settle!: (value: string) => void;
  let reject!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, rejectPromise) => { settle = resolve; reject = rejectPromise; });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/oauth2callback') { response.writeHead(404).end('Not found'); return; }
    const returnedState = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code');
    const oauthError = url.searchParams.get('error');
    response.writeHead(code && sameState(state, returnedState) ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(code && sameState(state, returnedState) ? '<!doctype html><title>Sift connected</title><h1>Gmail connected</h1><p>You can close this tab and return to Sift.</p>' : '<!doctype html><title>Connection stopped</title><h1>Gmail was not connected</h1><p>Return to Sift and try again.</p>');
    if (oauthError) reject(new Error(`gmail_oauth_${oauthError}`));
    else if (!code || !sameState(state, returnedState)) reject(new Error('gmail_oauth_state_invalid'));
    else settle(code);
  });
  await new Promise<void>((resolve, rejectListen) => { server.once('error', rejectListen); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorization.search = new URLSearchParams({ client_id: input.clientId, redirect_uri: redirectUri, response_type: 'code', scope: GMAIL_SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' }).toString();
  const timeout = setTimeout(() => reject(new Error('gmail_oauth_timeout')), 300_000);
  try {
    await openExternal(authorization.toString());
    const code = await codePromise;
    const tokens = await exchangeGmailCode(input, code, verifier, redirectUri, fetchPort);
    if (!tokens.refresh_token) throw new Error('gmail_refresh_token_missing');
    const profile = await fetchPort('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { authorization: `Bearer ${tokens.access_token}` } });
    if (!profile.ok) throw new Error('gmail_profile_failed');
    const payload = await profile.json() as { emailAddress?: string };
    if (!payload.emailAddress) throw new Error('gmail_profile_email_missing');
    return { email: payload.emailAddress, refreshToken: tokens.refresh_token };
  } finally {
    clearTimeout(timeout);
    server.close();
  }
};
