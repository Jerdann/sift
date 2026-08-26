import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { OutlookOAuthInput } from "../../shared/contracts/outlook";

export const OUTLOOK_SCOPES = Object.freeze([
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.ReadWrite",
  "MailboxSettings.ReadWrite",
]);
export type OutlookFetch = typeof fetch;
type ExternalOpener = (url: string) => Promise<void>;
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}
const base64url = (value: Buffer) => value.toString("base64url");
const sameState = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const tokenEndpoint = (tenant: string) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;

export const exchangeOutlookCode = async (
  input: OutlookOAuthInput,
  code: string,
  verifier: string,
  redirectUri: string,
  fetchPort: OutlookFetch = fetch,
): Promise<TokenResponse> => {
  const body = new URLSearchParams({
    client_id: input.clientId,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    scope: OUTLOOK_SCOPES.join(" "),
  });
  const response = await fetchPort(tokenEndpoint(input.tenant), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("outlook_token_exchange_failed");
  return (await response.json()) as TokenResponse;
};
export const refreshOutlookAccessToken = async (
  clientId: string,
  tenant: string,
  refreshToken: string,
  fetchPort: OutlookFetch = fetch,
): Promise<string> => {
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: OUTLOOK_SCOPES.join(" "),
  });
  const response = await fetchPort(tokenEndpoint(tenant), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("outlook_token_refresh_failed");
  return ((await response.json()) as TokenResponse).access_token;
};
export const authorizeOutlook = async (
  input: OutlookOAuthInput,
  openExternal: ExternalOpener,
  fetchPort: OutlookFetch = fetch,
): Promise<{ email: string; refreshToken: string }> => {
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(32));
  let settle!: (value: string) => void;
  let reject!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, rejectPromise) => {
    settle = resolve;
    reject = rejectPromise;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/oauth2callback") {
      response.writeHead(404).end("Not found");
      return;
    }
    const code = url.searchParams.get("code");
    const returned = url.searchParams.get("state") ?? "";
    const valid = Boolean(code) && sameState(state, returned);
    response.writeHead(valid ? 200 : 400, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      valid
        ? "<!doctype html><title>Sift connected</title><h1>Outlook connected</h1><p>You can close this tab and return to Sift.</p>"
        : "<!doctype html><title>Connection stopped</title><h1>Outlook was not connected</h1>",
    );
    if (!valid) reject(new Error("outlook_oauth_state_invalid"));
    else settle(code!);
  });
  await new Promise<void>((resolve, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "localhost", resolve);
  });
  const redirectUri = `http://localhost:${(server.address() as AddressInfo).port}/oauth2callback`;
  const authorization = new URL(
    `https://login.microsoftonline.com/${input.tenant}/oauth2/v2.0/authorize`,
  );
  authorization.search = new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: OUTLOOK_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const timeout = setTimeout(
    () => reject(new Error("outlook_oauth_timeout")),
    300_000,
  );
  try {
    await openExternal(authorization.toString());
    const tokens = await exchangeOutlookCode(
      input,
      await codePromise,
      verifier,
      redirectUri,
      fetchPort,
    );
    if (!tokens.refresh_token) throw new Error("outlook_refresh_token_missing");
    const profile = await fetchPort(
      "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName",
      { headers: { authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!profile.ok) throw new Error("outlook_profile_failed");
    const payload = (await profile.json()) as {
      mail?: string;
      userPrincipalName?: string;
    };
    const email = payload.mail ?? payload.userPrincipalName;
    if (!email) throw new Error("outlook_profile_email_missing");
    return { email, refreshToken: tokens.refresh_token };
  } finally {
    clearTimeout(timeout);
    server.close();
  }
};
