import { JSON_SCHEMA, load } from "js-yaml";

import fs from "node:fs";
import path from "node:path";
import { TOKENS_DIR } from "../consts";
import type { GetTokenOptions, TokenMetadata } from "../types";
import { sanitizeTokenId } from "../utils";

/**
 * Directory containing this module — and, in the published bundles, the
 * copied `tokens/` data directory. The ES bundle reads it from
 * `import.meta.dirname`. esbuild compiles that expression to
 * `undefined` in the CommonJS bundle (build/index.cjs), where Node
 * instead provides the module-scoped `__dirname` global natively, so
 * fall back to it — with only the import.meta form, every TokenAPI call
 * in the CJS bundle threw on `path.resolve(undefined, …)`.
 */
function moduleDir(): string {
  return typeof import.meta.dirname === "string" ? import.meta.dirname : __dirname;
}

export class TokenAPI {
  /**
   * Get token's metadata by its ID.
   * @param tokenId The concatenation of token policy ID and hex-coded token name.
   * @returns The token metadata followed the token schema.
   */
  public async getToken(tokenId: string) {
    try {
      const __dirname = moduleDir();
      // SECURITY FIX: Reject non-hex token IDs to prevent path traversal (e.g., "../")
      const safeTokenId = sanitizeTokenId(tokenId);
      if (safeTokenId === null) {
        return null;
      }
      const tokensDir = path.resolve(__dirname, TOKENS_DIR);
      const filePath = path.resolve(tokensDir, `${safeTokenId}.yaml`);
      // Defense in depth: the resolved file must stay inside the tokens directory.
      if (!filePath.startsWith(tokensDir + path.sep)) {
        return null;
      }
      const tokenFileData = fs.readFileSync(filePath, "utf-8");
      // SECURITY FIX: Parse with the restrictive JSON_SCHEMA so malicious YAML
      // cannot construct arbitrary JavaScript types. JSON_SCHEMA is imported
      // statically — in this ESM package ("type": "module") a CommonJS
      // require of js-yaml throws `ReferenceError: require is not defined`,
      // which silently made every getToken() call return null in the
      // published ES bundle. (Guarded in test/tokenApi.test.ts.)
      const tokenData: TokenMetadata = {
        tokenId,
        ...(load(tokenFileData, { schema: JSON_SCHEMA }) as Omit<TokenMetadata, "tokenId">),
      };
      return tokenData;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  /**
   * Get all tokens' metadata by its ID.
   * @param options Only verified or only tokens with market cap.
   * @returns The list of all tokens' metadata.
   */
  public async getTokens(options?: GetTokenOptions) {
    const __dirname = moduleDir();
    const directory = path.join(__dirname, TOKENS_DIR);
    const tokenList: TokenMetadata[] = [];
    const files = fs.readdirSync(directory);
    for (const file of files) {
      const tokenString = file.split(".")[0];
      const token = await this.getToken(tokenString);
      if (!token) {
        continue;
      }
      const matchedVerify = !options?.verifiedOnly || (options?.verifiedOnly && token.verified);
      const matchedMarketCap = !options?.hasMarketCapOnly || (options?.hasMarketCapOnly && !!token.maxSupply);
      if (matchedVerify && matchedMarketCap) {
        tokenList.push(token);
      }
    }
    return tokenList;
  }
}
