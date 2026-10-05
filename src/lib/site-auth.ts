import { timingSafeEqual } from "node:crypto";

/** Process environment fields the shared password gate reads on each request. */
export interface SiteAuthEnv {
  SITE_USER?: string;
  SITE_PASSWORD?: string;
}

/**
 * Shared password for the whole site. An unset or empty `SITE_PASSWORD` leaves the gate off.
 * A whitespace-only value is treated as unset so a blank host field does not lock the app.
 */
export function sitePassword(env: SiteAuthEnv): string | null {
  const password = env.SITE_PASSWORD;
  if (password == null || password.trim().length === 0) return null;
  return password;
}

function sameText(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

/** Username and password from an HTTP Basic `Authorization` header, or null when the header is unusable. */
export function credentialsFromAuthorization(header: string | null): { user: string; password: string } | null {
  if (!header) return null;
  const match = /^Basic\s+([A-Za-z0-9+/]+=*)$/i.exec(header.trim());
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const splitAt = decoded.indexOf(":");
  if (splitAt < 0) return null;
  return { user: decoded.slice(0, splitAt), password: decoded.slice(splitAt + 1) };
}

/**
 * Whether this request may proceed.
 * The gate is open when `SITE_PASSWORD` is unset. When it is set, the Basic username must equal
 * `SITE_USER` and the password must equal `SITE_PASSWORD`. A set password with a blank `SITE_USER`
 * rejects every request.
 */
export function basicAuthAllows(authorization: string | null, env?: SiteAuthEnv): boolean {
  const source: SiteAuthEnv = env ?? (process.env as SiteAuthEnv);
  const password = sitePassword(source);
  if (password == null) return true;
  const user = source.SITE_USER ?? "";
  if (user.length === 0) return false;
  const credentials = credentialsFromAuthorization(authorization);
  if (!credentials) return false;
  return sameText(credentials.user, user) && sameText(credentials.password, password);
}
