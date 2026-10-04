# 🛡️ Minswap Security Fixes & Audit Report

This repository contains critical security patches and bug fixes identified during a white-hat audit of the **Minswap Tokens** infrastructure. The goal of this project is to proactively secure the Minswap ecosystem against smart contract risks, SSRF attacks, and data manipulation vulnerabilities.

---

## 🔍 Identified Vulnerabilities & Fixes

### 1. Path Traversal Attack (Critical)
*   **Risk**: Malicious `tokenId` inputs containing `../` could allow attackers to read arbitrary files from the server's filesystem.
*   **Fix**: `sanitizeTokenId()` in `src/utils.ts` validates that token IDs are strictly hexadecimal and rejects anything else outright. (An earlier version stripped non-hex characters instead — that could silently rewrite a malformed ID into a *different* token's ID, so validation now fails closed.) `TokenAPI` additionally verifies the resolved path stays inside the tokens directory.

### 2. Unsafe YAML Deserialization (High)
*   **Risk**: The default YAML loader could execute arbitrary JavaScript objects/functions if a malicious actor injected a compromised token metadata file (Remote Code Execution risk).
*   **Fix**: Upgraded the loader to use `JSON_SCHEMA`, restricting parsing to safe JSON-compatible structures only.

### 3. SSRF & Malicious URL Injection (High)
*   **Risk**: The system was fetching data from unvalidated URLs, potentially exposing internal network resources or allowing phishing links in token metadata.
*   **Fix**:
    *   `isValidExternalURL()` allows only https URLs with a public host: it blocks embedded credentials, `localhost`/`*.localhost` (with or without a trailing dot), loopback/private/link-local/CGNAT/reserved IPv4 ranges — including the cloud metadata address `169.254.169.254` — and non-public IPv6 literals, including IPv4-mapped forms such as `[::ffff:127.0.0.1]`.
    *   `getAmountFromURL()` follows redirects manually (max 3) and re-validates every redirect target, so a public URL cannot bounce the fetch to an internal address; requests time out after 10s, and any failure resolves to `null` per the function's contract.
    *   Updated `URL_REGEX` to strictly validate domain structures.
    *   *Known limit*: URL-level validation cannot stop DNS rebinding (a public name resolving to a private address); pair it with egress filtering where that threat matters.

### 4. Negative Market Cap Logic Error (Medium)
*   **Risk**: Treasury or burn amounts exceeding the max supply resulted in negative `bigint` values, causing malformed market cap data and potential frontend crashes.
*   **Fix**: Added bounds-checking logic to clamp market cap calculations to zero, ensuring data integrity.

---

## 🔧 Follow-up Audit — 2026-10-03

A verification pass over the fixes above found that two of them did not actually work as shipped. Both are corrected, with regression tests:

### 5. TokenAPI completely broken for ESM consumers (Critical, regression from Fix #1/#2)
*   **Bug**: The YAML fix loaded its schema via a CommonJS `require(...)` call inside this ESM package (`"type": "module"`). In the published ES bundle that throws `ReferenceError: require is not defined`; `getToken()` caught it and returned `null` for **every** token, and `getTokens()` returned an empty list (verified against the built bundle: 0 of 599 tokens loaded).
*   **Fix**: `JSON_SCHEMA` is now imported statically from `js-yaml`. Verified end-to-end after a clean build: all 599 tokens load.
*   **Why tests missed it**: the repo's ts-jest setup transpiles to CommonJS — where `require` exists — and in fact cannot load `tokenApi.ts` at all because of its `import.meta` usage. A source-level guard test now fails the suite if a `require(...)` call ever returns.

### 6. SSRF guard blocked almost nothing (High, incomplete Fix #3)
*   **Bug**: The validator compared the hostname against four literals. Every private range (`10/8`, `172.16/12`, `192.168/16`), the cloud metadata endpoint, `localhost.` (trailing dot), `*.localhost`, and all IPv6 forms passed — even the listed `"::1"` never matched, because URL hostnames keep their brackets (`"[::1]"`).
*   **Fix**: Full range-based validation as described in Fix #3 above, plus redirect re-validation in `getAmountFromURL()`.

### 7. One token invisible to the API (Medium)
*   **Bug**: Token `eb7a93eb…4144414e44` ("DAN") shipped with a `.yml` extension; `TokenAPI` only reads `<id>.yaml`, so the token could never be returned. File renamed to `.yaml` (token ID unchanged) and a dataset-hygiene test now pins the naming shape.

### 8. Stricter `URL_REGEX` did not compile — token validation crashed (High, broken Fix #3)
*   **Bug**: In `src/consts.ts` the pattern's bracket escapes were written with single backslashes in a string literal, so the compiled pattern lost them: the character class closed early and `new RegExp(URL_REGEX)` threw `Nothing to repeat`. Every AJV validation against `tokenSchema` — including the repo's own `pnpm check-format`, wired into lint-staged — crashed before checking a single file.
*   **Fix**: Escapes corrected (`\\[` / `\\]` in the literal). The pattern also now allows `%` in URL paths, so legitimate percent-encoded links (e.g. Telegram invites like `https://t.me/%2B…`) validate.

### 9. Underscore-grouped amounts broke supply math and validation (Medium)
*   **Bug**: Six supply amounts across 5 token files (including MIN's `maxSupply` and `burn`) were written with underscore separators (`5_000_000_000_000000`). js-yaml loads those as *strings*, `MarketCapAPI.isBigInt()` rejects them, and the amounts were misrouted to an on-chain asset lookup using the supply figure as an asset ID; MIN's `burn` entry also failed schema validation.
*   **Fix**: Amounts rewritten as plain integers (digits unchanged, all well below 2^53 so the conversion is lossless). `pnpm check-format` now validates all 599 token files cleanly.

---

## 🔧 Follow-up Audit — 2026-10-04

### 10. CommonJS entry point broken twice over (Critical for `require()` consumers)
*   **Bug 1 — wrong extension**: `package.json` declares `"type": "module"`, so Node loads every `.js` file as ESM — but `main` / `exports.require` pointed at `build/index.js`, which Rollup fills with CommonJS `exports.…` code. `require("@minswap/minswap-tokens")` therefore died with `exports is not defined`; only ESM `import` consumers could use the package. **Fix**: the CommonJS bundle is now emitted as `build/index.cjs` (`main` + `exports.require` updated to match; Rollup derives its output names from `main`). Version bumped to 1.0.10.
*   **Bug 2 — `import.meta.dirname` does not exist in the CJS bundle**: even with the extension fixed, esbuild compiles `import.meta.dirname` to `undefined` in CommonJS output, so every `TokenAPI` call in that bundle threw on `path.resolve(undefined, …)` while the identical code worked in the ES bundle. **Fix**: `tokenApi.ts` resolves its directory via `moduleDir()` — `import.meta.dirname` where available, otherwise the module-scoped `__dirname` global Node provides to CommonJS modules.
*   **Verified end-to-end**: after a clean build, BOTH entries load the full dataset through the package's own `exports` map — `require()` and `import` each return all 599 tokens from `getTokens()`, `getToken()` resolves a real token, and traversal IDs return `null`.

### 11. Supply-amount parser failed open on malformed responses (Medium)
*   **Bug**: `getAmountFromURL()` parsed the (untrusted) response body with `BigInt()` coercion and a two-way `split(".")`. An empty or whitespace body became `0n` — a fabricated zero supply (callers read `null`, not `0`, as "unknown"); `"1.5.2"` silently dropped the second fraction and returned the amount for `"1.5"`; negative amounts (`"-100"`, `"-1.5"`) were accepted; `"0x10"` was accepted as 16 via BigInt's radix-prefix parsing.
*   **Fix**: the body must now be a strict non-negative decimal (`digits[.digits]`, surrounding whitespace trimmed) whose fraction fits in `decimals` digits; anything else — and a non-integer or negative `decimals` argument — resolves to `null`, matching the function's fail-closed contract.

---

## 📂 Files Modified
*   `src/apis/tokenApi.ts` - Path traversal rejection, safe YAML parsing (static `JSON_SCHEMA` import), in-directory path check, dual-bundle directory resolution (`moduleDir()`).
*   `src/apis/marketcapApi.ts` - Market cap logic clamping.
*   `src/utils.ts` - SSRF prevention (range-based URL validation, redirect re-validation, fetch timeout), token-ID validation, and strict fail-closed parsing of supply-amount responses.
*   `src/consts.ts` - Stricter regex patterns; `URL_REGEX` escapes repaired so the pattern compiles, `%` allowed in URL paths.
*   `package.json` / `rollup.config.js` - CommonJS bundle emitted as `build/index.cjs` so `require()` works under `"type": "module"` (v1.0.10).
*   `src/tokens/eb7a93eb….yaml` - Extension corrected from `.yml` so the token is reachable via the API.
*   `src/tokens/*.yaml` (5 files) - Underscore-grouped supply amounts normalized to plain integers.
*   `test/security.test.ts`, `test/tokenApi.test.ts` - Regression tests for every fix above.

---

## ✅ Tests
```
pnpm test        # or: npx jest
```
32 tests across 3 suites: the original utils tests, the SSRF truth table + redirect/timeout behaviour + strict supply-amount parsing + `URL_REGEX` guards (`test/security.test.ts`), and token-ID validation, TokenAPI source guards, package entry-point guards, dataset hygiene + full schema validation, and market-cap clamping (`test/tokenApi.test.ts`). The assembled bundles are also verified end-to-end (rollup build + Node ESM import AND CommonJS require through the package `exports` map: every token in `src/tokens` loads through both entries, traversal IDs return `null`) — necessary because ts-jest/CommonJS cannot load the ESM-only `tokenApi.ts` module.

---

## 📞 Contact & Recognition
For collaboration, questions, or to report additional findings:
*   **X (Twitter)**: [@kshot9000](https://x.com/kshot9000)

## 💰 Donations
If you find value in this security work and wish to support the auditor:
*   **Cardano (ADA)**: `addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v`

---
*This audit was conducted with the permission and best interests of the Minswap team in mind.*
