import { describe, expect, test } from "@jest/globals";

import fs from "node:fs";
import path from "node:path";
import type { Adapter } from "../src/adapters";
import { MarketCapAPI } from "../src/apis/marketcapApi";
import type { TokenMetadata } from "../src/types";
import { formatNumber, sanitizeTokenId } from "../src/utils";

/**
 * Note on coverage shape: TokenAPI's module uses `import.meta.dirname`,
 * which the repo's ts-jest/CommonJS setup cannot load at all — one
 * reason the original security patch shipped with zero tests for it.
 * Its testable logic (token-ID validation) therefore lives in
 * src/utils, and tokenApi.ts itself is guarded at source level below.
 * The assembled bundle is additionally verified end-to-end (rollup
 * build + Node ESM import) as a release check — see README "Tests".
 */
const tokenApiSource = fs.readFileSync(path.join(process.cwd(), "src", "apis", "tokenApi.ts"), "utf-8");

describe("sanitizeTokenId", () => {
  test("accepts plain hex token IDs", () => {
    expect(sanitizeTokenId("007394e3117755fbb0558b93c54ce3bc6c85770920044ade143dc742505443")).toBe(
      "007394e3117755fbb0558b93c54ce3bc6c85770920044ade143dc742505443",
    );
    expect(sanitizeTokenId("0123456789abcdefABCDEF")).toBe("0123456789abcdefABCDEF");
  });

  test("rejects traversal and any non-hex input instead of stripping it", () => {
    expect(sanitizeTokenId("../../etc/passwd")).toBeNull();
    expect(sanitizeTokenId("../secret")).toBeNull();
    expect(sanitizeTokenId("abc/def")).toBeNull();
    expect(sanitizeTokenId("")).toBeNull();
    // A malformed ID must never be silently rewritten into another
    // token's ID (the old strip-based sanitizer did exactly that).
    expect(sanitizeTokenId("007394e3/117755fbb0558b93c54ce3bc6c85770920044ade143dc742505443")).toBeNull();
    expect(sanitizeTokenId("007394e3117755fbb0558b93c54ce3bc6c85770920044ade143dc742505443zz")).toBeNull();
  });
});

describe("TokenAPI source guards", () => {
  test("never calls CommonJS require() in this ESM package", () => {
    // Regression guard for a total TokenAPI outage: the published ES
    // bundle ("type": "module") throws `ReferenceError: require is
    // not defined`, which made getToken() return null for all 599
    // tokens and getTokens() return []. ts-jest transpiles to
    // CommonJS — where require() exists — so only a source-level
    // guard can catch this class of bug in this suite.
    expect(tokenApiSource).not.toMatch(/\brequire\s*\(/);
  });

  test("imports JSON_SCHEMA statically from js-yaml and validates IDs via utils", () => {
    expect(tokenApiSource).toMatch(/import\s*\{[^}]*\bJSON_SCHEMA\b[^}]*\}\s*from\s*"js-yaml"/);
    expect(tokenApiSource).toMatch(/load\(tokenFileData,\s*\{\s*schema:\s*JSON_SCHEMA\s*\}\)/);
    expect(tokenApiSource).toMatch(/import\s*\{\s*sanitizeTokenId\s*\}\s*from\s*"\.\.\/utils"/);
  });
});

describe("token dataset hygiene", () => {
  test("every token file is named <hex>.yaml, the only shape TokenAPI can load", () => {
    // Regression guard: one token shipped as .yml — TokenAPI only ever
    // reads "<id>.yaml", so that token was invisible to getToken /
    // getTokens even though its file sat in the dataset.
    const files = fs.readdirSync(path.join(process.cwd(), "src", "tokens"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file).toMatch(/^[0-9a-fA-F]+\.yaml$/);
    }
  });
});

describe("token dataset validation", () => {
  test("every token file validates against tokenSchema (the check-format gate)", async () => {
    // Mirrors internal/validateTokenFiles.ts (pnpm check-format),
    // which lint-staged runs on commit. Until the URL_REGEX compile
    // crash was fixed, this gate crashed before validating anything;
    // two dataset defects hid behind it (a .yml extension, and
    // underscore-grouped amounts that load as strings and fail both
    // the schema and MarketCapAPI's isBigInt routing).
    const Ajv = (await import("ajv")).default;
    const { load } = await import("js-yaml");
    const { tokenSchema } = await import("../src/tokenSchema");
    const validate = new Ajv().compile(tokenSchema);
    const tokensDir = path.join(process.cwd(), "src", "tokens");
    const files = fs.readdirSync(tokensDir);
    expect(files.length).toBeGreaterThan(500);
    const failures: string[] = [];
    for (const file of files) {
      const data = {
        tokenId: file.split(".")[0],
        ...(load(fs.readFileSync(path.join(tokensDir, file), "utf-8")) as object),
      };
      if (!validate(data)) {
        failures.push(file);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("MarketCapAPI negative-supply clamping", () => {
  const tokenInfo = {
    tokenId: "aabbcc",
    project: "ClampTest",
    categories: ["DeFi"],
    verified: true,
    decimals: 0,
    maxSupply: "1000",
    treasuryOnChain: "addr1treasury",
  } satisfies TokenMetadata;

  test("clamps to zero when the treasury holds more than the total supply", async () => {
    const adapter: Adapter = {
      getAmountInAddress: async () => 2000n,
      getOnchainAmountOfAsset: async () => 0n,
    };
    const info = await new MarketCapAPI(adapter).getMarketCapInfo(tokenInfo);
    expect(info).toEqual({ total: "0", circulating: "0" });
  });

  test("subtracts normally when the treasury is below the total supply", async () => {
    const adapter: Adapter = {
      getAmountInAddress: async () => 250n,
      getOnchainAmountOfAsset: async () => 0n,
    };
    const info = await new MarketCapAPI(adapter).getMarketCapInfo(tokenInfo);
    expect(info).toEqual({ total: "750", circulating: "750" });
  });

  test("formatNumber renders negative values without malformed output", () => {
    expect(formatNumber(-12345n, 5)).toBe("-0.12345");
    expect(formatNumber(-1230003000n, 5)).toBe("-12300.03");
  });
});
