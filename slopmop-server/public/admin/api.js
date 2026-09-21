// Talking to the admin API, and what the page remembers between renders (the key lives in sessionStorage only).
const API = "/api/v1/admin";
const TOKEN_KEY = "slopmop-admin-token";
const PREFS_KEY = "slopmop-admin-prefs";
const DEFAULT_PREFS = { range: "7d", network: "", refresh: true };

export const prefs = (() => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(sessionStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_PREFS };
  }
})();

export const savePrefs = () => {
  try {
    sessionStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode */
  }
};

export const getToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
};

export const setToken = (t) => {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
};

/** The admin key was refused, or the admin API is switched off. The page then shows the sign-in form. */
export class AuthError extends Error {}

/** GET (or POST when `body` is given) an admin endpoint. Returns parsed JSON, or the Response when `raw`. */
export async function api(path, params = {}, raw = false, body = null) {
  const url = new URL(API + path, location.origin);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${getToken()}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401) throw new AuthError("That admin key was not accepted.");
  if (res.status === 404 && !body) throw new AuthError("The admin API is off: set ADMIN_TOKEN in the server's environment and redeploy.");
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.message || `Server answered ${res.status}.`);
  }
  return raw ? res : res.json();
}
