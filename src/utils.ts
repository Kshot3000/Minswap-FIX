export function tryParseBigInt(value: string | number): bigint | null {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function formatNumber(value: bigint, decimals: number): string {
  if (value === 0n) {
    return "0";
  }

  // SECURITY FIX: Handle negative values gracefully to prevent malformed market cap outputs
  const isNegative = value < 0n;
  const absoluteValue = isNegative ? -value : value;
  const numberString = absoluteValue.toString();

  let formatted: string;
  if (numberString.length <= decimals) {
    formatted = `0.${numberString.padStart(decimals, "0")}`;
  } else {
    const postfix = numberString.slice(numberString.length - decimals).replace(/0+$/g, "");
    const decimalPoint = postfix.length ? "." : "";
    const prefix = numberString.slice(0, numberString.length - decimals);
    formatted = prefix + decimalPoint + postfix;
  }

  return isNegative ? `-${formatted}` : formatted;
}

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_GROUP_REGEX = /^[0-9a-fA-F]{1,4}$/;

/**
 * Parses a dotted-quad IPv4 address into its four octets.
 * The WHATWG URL parser already normalizes shorthand/hex/octal IPv4
 * forms (e.g. "127.1", "0x7f000001", "2130706433") to a dotted quad,
 * so by the time a hostname reaches this helper those bypasses are gone.
 */
function parseIPv4(hostname: string): number[] | null {
  const match = IPV4_REGEX.exec(hostname);
  if (!match) {
    return null;
  }
  const octets = match.slice(1).map((part) => Number(part));
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/** True for loopback, private, link-local, CGNAT, benchmarking,
 * documentation, multicast and otherwise reserved IPv4 space — none of
 * which can be a legitimate public supply endpoint. */
function isNonPublicIPv4(octets: number[]): boolean {
  const [a, b] = octets;
  return (
    a === 0 || // 0.0.0.0/8 "this host on this network"
    a === 10 || // 10.0.0.0/8 private
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    a === 127 || // 127.0.0.0/8 loopback
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local (incl. cloud metadata 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 0) || // 192.0.0.0/24 (incl. 192.0.2.0/24 TEST-NET-1)
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    (a === 198 && b === 51) || // 198.51.100.0/24 TEST-NET-2
    (a === 203 && b === 0) || // 203.0.113.0/24 TEST-NET-3
    a >= 224 // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  );
}

/**
 * Expands an IPv6 address (without brackets) into eight 16-bit groups.
 * Returns null when the address cannot be parsed. Handles "::"
 * compression and a trailing embedded dotted-quad IPv4 part.
 */
function parseIPv6(hostname: string): number[] | null {
  let host = hostname;
  const lastColon = host.lastIndexOf(":");
  const tail = lastColon >= 0 ? host.slice(lastColon + 1) : "";
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) {
      return null;
    }
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    host = `${host.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = host.split("::");
  if (halves.length > 2) {
    return null;
  }
  const parseGroups = (part: string): number[] | null => {
    if (part === "") {
      return [];
    }
    const groups = part
      .split(":")
      .map((group) => (IPV6_GROUP_REGEX.test(group) ? Number.parseInt(group, 16) : Number.NaN));
    return groups.some((group) => Number.isNaN(group)) ? null : groups;
  };
  const left = parseGroups(halves[0]);
  const right = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (left === null || right === null) {
    return null;
  }
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const missing = 8 - left.length - right.length;
  if (missing < 1) {
    return null;
  }
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

/** True for IPv6 loopback, unspecified, link-local, unique-local,
 * multicast, documentation, and IPv4-mapped/compatible addresses that
 * embed a non-public IPv4 address. */
function isNonPublicIPv6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (groups.every((group) => group === 0)) {
    return true; // :: unspecified
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) {
    return true; // ::1 loopback
  }
  // IPv4-mapped ::ffff:0:0/96 and deprecated IPv4-compatible ::/96:
  // the real destination is the embedded IPv4 address.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return isNonPublicIPv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  if (g0 >= 0xfe80 && g0 <= 0xfebf) {
    return true; // fe80::/10 link-local
  }
  if (g0 >= 0xfc00 && g0 <= 0xfdff) {
    return true; // fc00::/7 unique local
  }
  if (g0 >= 0xff00) {
    return true; // ff00::/8 multicast
  }
  if (g0 === 0x2001 && g1 === 0x0db8) {
    return true; // 2001:db8::/32 documentation
  }
  return false;
}

/**
 * SECURITY FIX: Validates URLs to prevent SSRF and malicious redirects.
 * Only https URLs with a public host are allowed:
 * - no embedded credentials (phishing / host-confusion vector)
 * - "localhost" and any "*.localhost" name, with or without a trailing dot
 * - IPv4 literals in loopback/private/link-local/reserved ranges
 *   (the previous version compared the hostname against four literals —
 *   and even its "::1" entry never matched, because URL hostnames keep
 *   their brackets, e.g. "[::1]")
 * - IPv6 literals in loopback/link-local/unique-local/reserved ranges,
 *   including IPv4-mapped forms such as [::ffff:127.0.0.1]
 *
 * Known limit: this validates the URL as written. It cannot stop DNS
 * rebinding (a public name that resolves to a private address) — pair
 * it with egress filtering where that threat matters.
 */
export function isValidExternalURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username !== "" || parsed.password !== "") return false;

    // URL hostnames retain brackets for IPv6 literals ("[::1]").
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      hostname = hostname.slice(1, -1);
    }
    hostname = hostname.replace(/\.+$/, "");
    if (hostname === "") return false;

    if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;

    const ipv4 = parseIPv4(hostname);
    if (ipv4) {
      return !isNonPublicIPv4(ipv4);
    }
    if (hostname.includes(":")) {
      const ipv6 = parseIPv6(hostname);
      if (!ipv6) return false;
      return !isNonPublicIPv6(ipv6);
    }
    return true;
  } catch {
    return false;
  }
}

export function isBigInt(value: string | number): boolean {
  return !Number.isNaN(Number(value)) && value.toString() === tryParseBigInt(value)?.toString();
}

export function isAPIEndPoint(str: string | number): boolean {
  return typeof str === "string" && str.startsWith("https://");
}

export function isAddress(str: string | number): boolean {
  return typeof str === "string" && (str.startsWith("addr") || str.startsWith("stake"));
}

/**
 * Validates a token ID to prevent path traversal attacks.
 * Token IDs on Cardano are strictly hexadecimal strings (policy ID +
 * hex-encoded asset name), so anything else — path separators, dots,
 * non-hex characters — is rejected outright (returns null).
 *
 * The previous version silently *stripped* non-hex characters instead.
 * That could map a malformed ID onto a different token's metadata
 * (e.g. inserting "/" into an ID returned another token's file), so
 * validation now fails closed.
 *
 * Lives in utils (not tokenApi) so it stays unit-testable: tokenApi's
 * module uses `import.meta`, which the repo's ts-jest/CommonJS test
 * setup cannot load.
 */
const TOKEN_ID_REGEX = /^[0-9a-fA-F]+$/;

export function sanitizeTokenId(tokenId: string): string | null {
  if (typeof tokenId !== "string" || !TOKEN_ID_REGEX.test(tokenId)) {
    return null;
  }
  return tokenId;
}

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
/** Strict non-negative decimal amount: digits, plus at most one
 * fractional part. Anything else in a supply response fails closed. */
const AMOUNT_REGEX = /^(\d+)(?:\.(\d+))?$/;

/**
 * Fetches a decimal amount from an external supply endpoint.
 * SECURITY FIXES:
 * - The URL — and every redirect target — is validated with
 *   isValidExternalURL() before any request is made. fetch() follows
 *   redirects automatically, so a single up-front check would still
 *   let a public URL bounce the request to an internal address;
 *   redirects are therefore followed manually and re-validated.
 * - Requests time out after 10s instead of hanging an unattended scan.
 * - The response body must be a strict non-negative decimal amount;
 *   empty, negative, radix-prefixed ("0x…"), or multiply-dotted bodies
 *   resolve to null instead of being coerced into a number.
 * - Any failure (blocked URL, non-2xx response, network error) resolves
 *   to null, matching the declared `bigint | null` contract — callers
 *   already translate null into a null market-cap response.
 */
export async function getAmountFromURL(url: string, decimals: number): Promise<bigint | null> {
  if (!Number.isInteger(decimals) || decimals < 0) {
    return null;
  }
  let currentURL = url;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (!isValidExternalURL(currentURL)) {
      console.warn(`Blocked potentially unsafe URL fetch: ${currentURL}`);
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(currentURL, { redirect: "manual", signal: controller.signal });
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) {
        return null;
      }
      try {
        currentURL = new URL(location, currentURL).toString();
      } catch {
        return null;
      }
      continue;
    }

    if (!response.ok) {
      return null;
    }

    // Parse the body as a strict non-negative decimal amount, failing
    // closed (null) on anything else. The body is untrusted network
    // data, and the previous parser failed open in several ways:
    // - "" or whitespace became 0n (BigInt("") === 0n) — a fabricated
    //   zero supply for an endpoint that returned nothing;
    // - "1.5.2" silently dropped the second fraction and returned the
    //   amount for "1.5" (split() destructuring ignored the rest);
    // - "-100" / "-1.5" were accepted as negative amounts;
    // - "0x10" was accepted as 16 (BigInt parses radix prefixes).
    // Only digits with at most one fractional part are accepted, and
    // the fraction must fit in `decimals` digits (as before).
    const rawAmount = (await response.text()).trim();
    const amountMatch = AMOUNT_REGEX.exec(rawAmount);
    if (!amountMatch) {
      return null;
    }
    const [, integerPart, fractionalPart = ""] = amountMatch;
    if (fractionalPart.length > decimals) {
      return null;
    }
    return tryParseBigInt(integerPart + fractionalPart.padEnd(decimals, "0"));
  }
  return null;
}
