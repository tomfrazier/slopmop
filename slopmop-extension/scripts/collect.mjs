// Local collector: appends each vote the extension sends to a JSONL file on disk.
//   npm run collect                      -> labels/labels.jsonl on http://127.0.0.1:8788
//   SLOPMOP_LABELS_FILE=~/x.jsonl npm run collect
// Dev tool only. Binds to loopback, accepts only POST /label from the extension, and stores nothing anywhere else.
import { createServer } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const port = Number(process.env.SLOPMOP_COLLECTOR_PORT ?? 8788);
const raw = process.env.SLOPMOP_LABELS_FILE ?? "labels/labels.jsonl";
const file = resolve(raw.startsWith("~") ? raw.replace("~", homedir()) : raw);
const MAX_BODY = 512 * 1024;
mkdirSync(dirname(file), { recursive: true });

const count = () => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0);
const VOTES = new Set(["no", "maybe", "probably", null]);

const server = createServer((req, res) => {
  const origin = req.headers.origin ?? "";
  // Only the extension (or a bare local tool like curl) may talk to this; a web page can't.
  if (origin && !origin.startsWith("chrome-extension://")) return void res.writeHead(403).end();
  const hostOk = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? "");
  if (!hostOk) return void res.writeHead(403).end();
  const send = (code, body) => res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": origin || "*" }).end(JSON.stringify(body));

  if (req.method === "OPTIONS") return void res.writeHead(204, { "access-control-allow-origin": origin || "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, GET" }).end();
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, file, lines: count() });
  if (req.method !== "POST" || req.url !== "/label") return send(404, { error: "not_found" });

  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > MAX_BODY) req.destroy();
  });
  req.on("end", () => {
    let e;
    try {
      e = JSON.parse(body);
    } catch {
      return send(400, { error: "bad_json" });
    }
    if (typeof e?.urn !== "string" || !VOTES.has(e.label ?? null) || (e.label !== null && !e.verdict)) return send(422, { error: "invalid_event" });
    appendFileSync(file, JSON.stringify(e) + "\n");
    const tag = e.label === null ? "cleared" : e.label;
    console.log(`${new Date().toLocaleTimeString()}  ${tag.padEnd(8)} ${e.urn.slice(0, 18)}  ${(e.text ?? "").replace(/\s+/g, " ").slice(0, 60)}`);
    send(200, { ok: true });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Slop Mop label collector\n  listening on http://127.0.0.1:${port}\n  writing to   ${file}  (${count()} lines so far)\n`);
});
