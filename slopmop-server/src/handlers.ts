import type { Config } from "./config.js";
import type { Ctx, Route } from "./ctx.js";
import { StorageNotConfigured } from "./db/types.js";
import { corsHeaders, HttpError, json, originAllowed } from "./http.js";
import { clientsRoute } from "./routes/clientsRoute.js";
import { devicesRoute } from "./routes/devicesRoute.js";
import { eventsRoute, postsRoute } from "./routes/listRoutes.js";
import { limitsRoute } from "./routes/limitsRoute.js";
import { reviewRoute } from "./routes/reviewRoute.js";
import { exportRoute, statsRoute } from "./routes/statsRoute.js";
import { adminManifestRoute, manifestRoute } from "./routes/manifestRoute.js";
import { scoringRoute } from "./routes/scoringRoute.js";
import { simulateRoute } from "./routes/simulateRoute.js";
import { tunerRoute } from "./routes/tunerRoute.js";
import { weightsRoute } from "./routes/weightsRoute.js";
import { judgeRoute } from "./routes/judge.js";
import { healthRoute, usageRoute, voteRoute } from "./routes/vote.js";

export type { Ctx, Route } from "./ctx.js";

type Method = "GET" | "POST";
type Handler = (request: Request, ctx: Ctx) => Promise<Response>;

/** Each endpoint: the methods it accepts and what handles it. */
const ROUTES: Record<Route, { methods: readonly Method[]; handler: Handler }> = {
  judge: { methods: ["POST"], handler: judgeRoute },
  vote: { methods: ["POST"], handler: voteRoute },
  usage: { methods: ["GET"], handler: usageRoute },
  health: { methods: ["GET"], handler: healthRoute },
  export: { methods: ["GET"], handler: exportRoute },
  stats: { methods: ["GET"], handler: statsRoute },
  clients: { methods: ["GET", "POST"], handler: clientsRoute },
  devices: { methods: ["GET"], handler: devicesRoute },
  limits: { methods: ["GET", "POST"], handler: limitsRoute },
  review: { methods: ["POST"], handler: reviewRoute },
  events: { methods: ["GET"], handler: eventsRoute },
  posts: { methods: ["GET"], handler: postsRoute },
  weights: { methods: ["GET", "POST"], handler: weightsRoute },
  scoring: { methods: ["GET", "POST"], handler: scoringRoute },
  manifest: { methods: ["GET"], handler: manifestRoute },
  simulate: { methods: ["POST"], handler: simulateRoute },
  tuner: { methods: ["GET", "POST"], handler: tunerRoute },
  adminManifest: { methods: ["GET", "POST"], handler: adminManifestRoute },
};

/** Every endpoint, as a plain Web-standard Request -> Response function, so it runs unchanged on Vercel and in tests. */
export async function handle(route: Route, request: Request, ctx: Ctx): Promise<Response> {
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, ctx.config);
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    // The server's own pages (the admin dashboard) send an Origin on POST; that is never a foreign site.
    const own = origin !== null && origin === new URL(request.url).origin;
    if (!own && !originAllowed(origin, ctx.config)) throw new HttpError(403, "forbidden_origin", "This origin isn't allowed.");
    const { methods, handler } = ROUTES[route];
    if (!(methods as readonly string[]).includes(request.method)) throw new HttpError(405, "method_not_allowed", `Use ${methods.join(" or ")}.`, {}, { Allow: methods.join(", ") });
    return withHeaders(await handler(request, ctx), cors);
  } catch (e) {
    return withHeaders(errorResponse(e), cors);
  }
}

/** A failure before a context exists (for example no database configured): same JSON errors and CORS as everything else. */
export function setupFailure(e: unknown, request: Request, config: Config): Response {
  return withHeaders(errorResponse(e), corsHeaders(request.headers.get("origin"), config));
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message, ...e.extra }, e.headers);
  if (e instanceof StorageNotConfigured) return json(503, { error: "storage_unavailable", message: e.message });
  // Never log request bodies: they contain other people's posts. Class and message only.
  console.error("[slopmop] unhandled", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  return json(500, { error: "internal", message: "Something went wrong on the server." });
}
