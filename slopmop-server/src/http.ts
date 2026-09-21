import type { Config } from "./config.js";
import { MAX_BODY_BYTES } from "./constants.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\//;

export function originAllowed(origin: string | null, config: Config): boolean {
  if (!origin) return true; // not a browser page (the extension's service worker, curl, a server): nothing to check
  if (EXTENSION_ORIGIN.test(origin)) return true;
  return config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin);
}

export function corsHeaders(origin: string | null, config: Config): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "content-type, x-install-id, authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
  if (origin && originAllowed(origin, config)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}


export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "too_large", "Request body is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "bad_json", "Request body must be JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "bad_json", "Request body must be a JSON object.");
  return body as Record<string, unknown>;
}

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const INSTALL_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export function installIdOf(request: Request): string {
  const id = request.headers.get("x-install-id");
  if (!id || !INSTALL_ID_RE.test(id)) throw new HttpError(400, "missing_install_id", "An x-install-id header (8-64 letters, digits, - or _) is required.");
  return id;
}
