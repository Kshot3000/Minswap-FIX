import { load } from "js-yaml";

import fs from "node:fs";
import path from "node:path";
import { TOKENS_DIR } from "../consts";
import type { GetTokenOptions, TokenMetadata } from "../types";

/**
 * Sanitizes token ID to prevent path traversal attacks.
 * Token IDs on Cardano are strictly hexadecimal strings.
 */
function sanitizeTokenId(tokenId: string): string {
  return tokenId.replace(/[^a-fA-F0-9]/g, "");
}

export class TokenAPI {
  /**
   * Get token's metadata by its ID.
   * @param tokenId The concatenation of token policy ID and hex-coded token name.
   * @returns The token metadata followed the token schema.
   */
  public async getToken(tokenId: string) {
    try {
      const __dirname = import.meta.dirname;
      // SECURITY FIX: Sanitize tokenId to prevent path traversal (e.g., "../")
      const safeTokenId = sanitizeTokenId(tokenId);
      const filePath = path.join(__dirname, `${TOKENS_DIR}/${safeTokenId}.yaml`);
      const tokenFileData = fs.readFileSync(filePath, "utf-8");
      // SECURITY FIX: Use safeLoad schema to prevent arbitrary code execution via malicious YAML
      const tokenData: TokenMetadata = {
        tokenId,
        ...(load(tokenFileData, { schema: require("js-yaml").JSON_SCHEMA }) as Omit<TokenMetadata, "tokenId">),
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
    const __dirname = import.meta.dirname;
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
