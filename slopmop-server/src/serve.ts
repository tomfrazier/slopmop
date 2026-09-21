import { loadConfig } from "./config.js";
import { getContext } from "./context.js";
import { handle, setupFailure, type Route } from "./handlers.js";
import { json } from "./http.js";
import { adminRouteFor } from "./paths.js";

/** The Vercel entry for a route: `export default serve("judge")`. Pass a function to pick the route from the request (the admin endpoints). */
export function serve(route: Route | ((request: Request) => Route | null)) {
  return {
    async fetch(request: Request): Promise<Response> {
      const picked = typeof route === "function" ? route(request) : route;
      if (!picked) return json(404, { error: "not_found", message: "Not found." });
      let ctx;
      try {
        ctx = await getContext();
      } catch (e) {
        return setupFailure(e, request, loadConfig(process.env));
      }
      return handle(picked, request, ctx);
    },
  };
}

/** The one function behind every /api/v1/admin/<name> endpoint. */
export const serveAdmin = () => serve((request) => adminRouteFor(new URL(request.url).pathname));
