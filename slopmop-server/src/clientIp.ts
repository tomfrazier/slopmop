/** The caller's IP address, as the platform reports it. Used only for the per-IP rate limit and the datacenter block; never stored raw (see Store.hashInstall). */
export function clientIp(request: Request): string | null {
  // Vercel (and most proxies) set this as "client, proxy1, proxy2, ...": the first entry is the original caller.
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return request.headers.get("x-real-ip")?.trim() || null;
}
