# 🛡️ Minswap Security Fixes & Audit Report

This repository contains critical security patches and bug fixes identified during a white-hat audit of the **Minswap Tokens** infrastructure. The goal of this project is to proactively secure the Minswap ecosystem against smart contract risks, SSRF attacks, and data manipulation vulnerabilities.

---

## 🔍 Identified Vulnerabilities & Fixes

### 1. Path Traversal Attack (Critical)
*   **Risk**: Malicious `tokenId` inputs containing `../` could allow attackers to read arbitrary files from the server's filesystem.
*   **Fix**: Implemented strict hexadecimal sanitization in `TokenAPI` to ensure only valid Cardano token IDs are processed.

### 2. Unsafe YAML Deserialization (High)
*   **Risk**: The default YAML loader could execute arbitrary JavaScript objects/functions if a malicious actor injected a compromised token metadata file (Remote Code Execution risk).
*   **Fix**: Upgraded the loader to use `JSON_SCHEMA`, restricting parsing to safe JSON-compatible structures only.

### 3. SSRF & Malicious URL Injection (High)
*   **Risk**: The system was fetching data from unvalidated URLs, potentially exposing internal network resources or allowing phishing links in token metadata.
*   **Fix**:
    *   Added `isValidExternalURL()` to block internal IP ranges (localhost, private networks).
    *   Updated `URL_REGEX` to strictly validate domain structures.

### 4. Negative Market Cap Logic Error (Medium)
*   **Risk**: Treasury or burn amounts exceeding the max supply resulted in negative `bigint` values, causing malformed market cap data and potential frontend crashes.
*   **Fix**: Added bounds-checking logic to clamp market cap calculations to zero, ensuring data integrity.

---

## 📂 Files Modified
*   `src/apis/tokenApi.ts` - Path traversal & YAML security fixes.
*   `src/apis/marketcapApi.ts` - Market cap logic clamping.
*   `src/utils.ts` - SSRF prevention and URL validation.
*   `src/consts.ts` - Stricter regex patterns.

---

## 📞 Contact & Recognition
For collaboration, questions, or to report additional findings:
*   **X (Twitter)**: [@kshot9000](https://x.com/kshot9000)

## 💰 Donations
If you find value in this security work and wish to support the auditor:
*   **Cardano (ADA)**: `addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v`

---
*This audit was conducted with the permission and best interests of the Minswap team in mind.*
