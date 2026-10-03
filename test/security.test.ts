import { describe, expect, jest, test } from "@jest/globals";
import { URL_REGEX } from "../src/consts";
import { getAmountFromURL, isValidExternalURL } from "../src/utils";

describe("URL_REGEX (token metadata link pattern)", () => {
  test("compiles — including under AJV's unicode flag", () => {
    // Regression guard: the pattern's string literal once lost its
    // bracket escapes, so the compiled value threw "Nothing to
    // repeat" and every tokenSchema validation (pnpm check-format)
    // crashed before checking a single file.
    expect(() => new RegExp(URL_REGEX)).not.toThrow();
    expect(() => new RegExp(URL_REGEX, "u")).not.toThrow();
  });

  test("accepts ordinary https links, including percent-encoded paths", () => {
    const regex = new RegExp(URL_REGEX);
    expect(regex.test("https://twitter.com/MinswapDEX")).toBe(true);
    expect(regex.test("https://www.coingecko.com/en/coins/minswap")).toBe(true);
    // A real dataset link: Telegram invite with %2B ("+") in the path.
    expect(regex.test("https://t.me/%2BOWS5F7Tpp85iODU0")).toBe(true);
  });

  test("rejects non-https and host-less values", () => {
    const regex = new RegExp(URL_REGEX);
    expect(regex.test("http://example.com/page")).toBe(false);
    expect(regex.test("https://localhost/admin")).toBe(false); // single-label host, no domain/TLD
    expect(regex.test("javascript:alert(1)")).toBe(false);
    expect(regex.test("https://")).toBe(false);
  });
});

/**
 * Regression tests for the SSRF guard.
 *
 * The original fix compared the hostname against four literals
 * (["localhost", "127.0.0.1", "0.0.0.0", "::1"]) — every private-range
 * address below sailed through it, and even "::1" never matched
 * because URL hostnames keep their brackets ("[::1]").
 */
describe("isValidExternalURL", () => {
  test("allows public https endpoints", () => {
    expect(isValidExternalURL("https://api.example.com/supply")).toBe(true);
    expect(isValidExternalURL("https://cdn.minswap.org/v1/supply?x=1")).toBe(true);
    expect(isValidExternalURL("https://8.8.8.8/supply")).toBe(true);
    expect(isValidExternalURL("https://[2606:4700:4700::1111]/supply")).toBe(true);
  });

  test("rejects non-https and malformed URLs", () => {
    expect(isValidExternalURL("http://api.example.com/supply")).toBe(false);
    expect(isValidExternalURL("ftp://api.example.com/supply")).toBe(false);
    expect(isValidExternalURL("not a url")).toBe(false);
    expect(isValidExternalURL("")).toBe(false);
  });

  test("rejects URLs with embedded credentials", () => {
    expect(isValidExternalURL("https://user:pass@api.example.com/")).toBe(false);
    expect(isValidExternalURL("https://user@api.example.com/")).toBe(false);
  });

  test("rejects localhost in its written forms", () => {
    expect(isValidExternalURL("https://localhost/admin")).toBe(false);
    expect(isValidExternalURL("https://localhost./admin")).toBe(false);
    expect(isValidExternalURL("https://sub.localhost/admin")).toBe(false);
    expect(isValidExternalURL("https://LOCALHOST/admin")).toBe(false);
  });

  test("rejects loopback and private IPv4 ranges", () => {
    expect(isValidExternalURL("https://127.0.0.1/admin")).toBe(false);
    expect(isValidExternalURL("https://127.1/admin")).toBe(false); // parser normalizes to 127.0.0.1
    expect(isValidExternalURL("https://0x7f000001/admin")).toBe(false); // hex form, normalized likewise
    expect(isValidExternalURL("https://10.0.0.5/internal")).toBe(false);
    expect(isValidExternalURL("https://172.16.0.10/internal")).toBe(false);
    expect(isValidExternalURL("https://172.31.255.255/internal")).toBe(false);
    expect(isValidExternalURL("https://192.168.1.1/admin")).toBe(false);
    expect(isValidExternalURL("https://0.0.0.0/admin")).toBe(false);
  });

  test("rejects link-local, CGNAT, and reserved IPv4 ranges", () => {
    // 169.254.169.254 is the cloud instance-metadata endpoint — the
    // highest-value SSRF target — and the old guard allowed it.
    expect(isValidExternalURL("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isValidExternalURL("https://100.64.0.1/internal")).toBe(false);
    expect(isValidExternalURL("https://198.18.0.1/internal")).toBe(false);
    expect(isValidExternalURL("https://192.0.2.1/internal")).toBe(false);
    expect(isValidExternalURL("https://224.0.0.1/internal")).toBe(false);
  });

  test("allows public addresses at range boundaries", () => {
    expect(isValidExternalURL("https://172.15.0.1/")).toBe(true);
    expect(isValidExternalURL("https://172.32.0.1/")).toBe(true);
    expect(isValidExternalURL("https://100.63.0.1/")).toBe(true);
    expect(isValidExternalURL("https://100.128.0.1/")).toBe(true);
    expect(isValidExternalURL("https://169.253.0.1/")).toBe(true);
  });

  test("rejects non-public IPv6 literals", () => {
    expect(isValidExternalURL("https://[::1]/admin")).toBe(false);
    expect(isValidExternalURL("https://[::]/admin")).toBe(false);
    expect(isValidExternalURL("https://[fe80::1]/admin")).toBe(false);
    expect(isValidExternalURL("https://[fd00::1]/admin")).toBe(false);
    expect(isValidExternalURL("https://[fc12:3456::1]/admin")).toBe(false);
    expect(isValidExternalURL("https://[ff02::1]/admin")).toBe(false);
    expect(isValidExternalURL("https://[2001:db8::1]/admin")).toBe(false);
    // IPv4-mapped forms: the embedded IPv4 address decides.
    expect(isValidExternalURL("https://[::ffff:127.0.0.1]/admin")).toBe(false);
    expect(isValidExternalURL("https://[::ffff:192.168.0.1]/admin")).toBe(false);
    expect(isValidExternalURL("https://[::ffff:8.8.8.8]/admin")).toBe(true);
  });
});

describe("getAmountFromURL", () => {
  const realFetch = globalThis.fetch;

  function mockFetch(handler: (url: string) => { status: number; body?: string; location?: string }) {
    const fn = jest.fn(async (input: unknown) => {
      const { status, body, location } = handler(String(input));
      return {
        status,
        ok: status >= 200 && status < 300,
        headers: {
          get: (name: string) => (name.toLowerCase() === "location" ? (location ?? null) : null),
        },
        text: async () => body ?? "",
      } as Response;
    });
    globalThis.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  test("never fetches a blocked URL", async () => {
    const fn = mockFetch(() => ({ status: 200, body: "100" }));
    await expect(getAmountFromURL("https://169.254.169.254/latest/meta-data/", 0)).resolves.toBeNull();
    await expect(getAmountFromURL("https://192.168.1.1/admin", 0)).resolves.toBeNull();
    expect(fn).not.toHaveBeenCalled();
    globalThis.fetch = realFetch;
  });

  test("parses amounts from a public endpoint", async () => {
    mockFetch(() => ({ status: 200, body: "12345" }));
    await expect(getAmountFromURL("https://api.example.com/supply", 0)).resolves.toBe(12345n);
    mockFetch(() => ({ status: 200, body: "1.5" }));
    await expect(getAmountFromURL("https://api.example.com/supply", 2)).resolves.toBe(150n);
    globalThis.fetch = realFetch;
  });

  test("follows a redirect only to another validated public URL", async () => {
    mockFetch((url) =>
      url.includes("old.example.com")
        ? { status: 302, location: "https://api.example.com/supply" }
        : { status: 200, body: "777" },
    );
    await expect(getAmountFromURL("https://old.example.com/supply", 0)).resolves.toBe(777n);
    globalThis.fetch = realFetch;
  });

  test("blocks a redirect that bounces to a private address", async () => {
    const fn = mockFetch((url) =>
      url.includes("api.example.com")
        ? { status: 302, location: "https://169.254.169.254/latest/meta-data/" }
        : { status: 200, body: "1" },
    );
    await expect(getAmountFromURL("https://api.example.com/supply", 0)).resolves.toBeNull();
    // The redirect target must never actually be fetched.
    expect(fn.mock.calls.map((call) => String(call[0]))).not.toContain("https://169.254.169.254/latest/meta-data/");
    globalThis.fetch = realFetch;
  });

  test("returns null on non-2xx responses and network errors", async () => {
    mockFetch(() => ({ status: 404, body: "not found" }));
    await expect(getAmountFromURL("https://api.example.com/missing", 0)).resolves.toBeNull();
    globalThis.fetch = async () => {
      throw new Error("connection refused");
    };
    await expect(getAmountFromURL("https://api.example.com/supply", 0)).resolves.toBeNull();
    globalThis.fetch = realFetch;
  });
});
