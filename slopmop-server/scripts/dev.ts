// Local server with the same handlers Vercel runs. `npm run dev` (reads .env.local). No Vercel account needed:
// with no Turso variables set it uses a SQLite file at data/slopmop.db.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { loadConfig } from "../src/config.js";
import { getContext } from "../src/context.js";
import { handle, setupFailure } from "../src/handlers.js";
import { PATHS as ROUTES } from "../src/paths.js";

const PORT = Number(process.env.PORT ?? 8787);

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2" };
/** The same response headers Vercel applies to /admin (CSP and friends), read from vercel.json so local runs test what production serves. */
async function adminHeaders(): Promise<Record<string, string>> {
  try {
    const cfg = JSON.parse(await readFile(join(process.cwd(), "vercel.json"), "utf8"));
    const rule = cfg.headers?.find((h: { source: string }) => h.source.startsWith("/admin"));
    return Object.fromEntries((rule?.headers ?? []).map((h: { key: string; value: string }) => [h.key.toLowerCase(), h.value]));
  } catch {
    return {};
  }
}

/** Serves public/admin so the dashboard can be tried locally, as Vercel serves it in production. */
async function staticFile(pathname: string): Promise<Response | null> {
  const rel = normalize(pathname === "/admin" || pathname === "/admin/" ? "/admin/index.html" : pathname);
  if (rel.includes("..")) return null;
  try {
    const headers: Record<string, string> = { "content-type": TYPES[extname(rel)] ?? "application/octet-stream", ...(await adminHeaders()) };
    return new Response(await readFile(join(process.cwd(), "public", rel)), { headers });
  } catch {
    return null;
  }
}

/** Every route in ROUTES, so a new endpoint can't be forgotten here. */
const ROUTE_PATH = new RegExp(`^\\/(?:api\\/)?v1\\/(${Object.keys(ROUTES).map((k) => k.replace(/\//g, "\\/")).join("|")})\\/?$`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  // Serves /api/v1/<route> (as on Vercel) and /v1/<route>.
  const m = ROUTE_PATH.exec(url.pathname);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(url, {
    method: req.method,
    headers: Object.fromEntries(Object.entries(req.headers).filter((e): e is [string, string] => typeof e[1] === "string")),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });

  let response: Response;
  const asset = !m && (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) ? await staticFile(url.pathname) : null;
  if (asset) response = asset;
  else if (!m) response = Response.json({ error: "not_found", message: "Not found." }, { status: 404 });
  else {
    try {
      response = await handle(ROUTES[m[1]], request, await getContext());
    } catch (e) {
      response = setupFailure(e, request, loadConfig(process.env));
    }
  }
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(PORT, "127.0.0.1", async () => {
  console.log(`Slop Mop server on http://127.0.0.1:${PORT}  (routes: /api/v1/{judge,vote,usage,health})`);
  try {
    const h = await (await fetch(`http://127.0.0.1:${PORT}/api/v1/health`)).json();
    console.log("health:", JSON.stringify(h));
  } catch {
    /* health is informational */
  }
});
