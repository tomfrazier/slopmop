/** IPv4/IPv6 CIDR matching, used to test a caller's address against published cloud-provider ranges. */

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Standard (non-mixed) IPv6 text form, expanding one "::" run. IPv4-mapped forms (::ffff:1.2.3.4) are not recognised: they fail to
 * parse and simply never match, which is the safe direction (nothing is ever wrongly blocked because of it). */
function ipv6ToBigInt(ip: string): bigint | null {
  if ((ip.match(/::/g) ?? []).length > 1) return null;
  const [head, tail] = ip.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = ip.includes("::") ? [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill("0"), ...tailGroups] : headGroups;
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

/** True when `ip` falls inside `cidr`. Mismatched address families never match. Malformed input never matches (fails closed to "not in range", never to "in range"). */
export function inCidr(ip: string, cidr: string): boolean {
  const slash = cidr.lastIndexOf("/");
  if (slash < 0) return false;
  const range = cidr.slice(0, slash);
  const bits = Number(cidr.slice(slash + 1));
  const isV6 = ip.includes(":");
  if (isV6 !== range.includes(":")) return false;
  if (isV6) {
    if (!Number.isInteger(bits) || bits < 0 || bits > 128) return false;
    const a = ipv6ToBigInt(ip);
    const b = ipv6ToBigInt(range);
    if (a === null || b === null) return false;
    const mask = bits === 0 ? 0n : (((1n << 128n) - 1n) << BigInt(128 - bits)) & ((1n << 128n) - 1n);
    return (a & mask) === (b & mask);
  }
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(range);
  if (a === null || b === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

export const anyCidrMatch = (ip: string, cidrs: readonly string[]): boolean => cidrs.some((c) => inCidr(ip, c));
