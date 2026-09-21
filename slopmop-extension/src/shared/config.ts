declare const __SERVER_URL__: string;
declare const __COLLECTOR_URL__: string;
/** Set with SLOPMOP_SERVER_URL at build time; defaults to a local `npm run dev` server in slopmop-server. */
export const SERVER_URL: string = typeof __SERVER_URL__ === "string" ? __SERVER_URL__ : "http://localhost:8787";
/**
 * Developer-only: a local collector (`npm run collect`) that appends every vote to a file. Off (null) unless the extension
 * is built with SLOPMOP_COLLECTOR_URL, so a normal build never touches localhost and asks for no extra permission.
 */
export const COLLECTOR_URL: string | null = typeof __COLLECTOR_URL__ === "string" && __COLLECTOR_URL__ ? __COLLECTOR_URL__ : null;
/** The server's versioned API. On Vercel, files under api/ are served at /api/..., so this works with no rewrites. */
export const API_BASE = `${SERVER_URL}/api/v1`;
export const NETWORK = "linkedin";
