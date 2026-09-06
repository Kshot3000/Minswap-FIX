import type { Adapter } from "../adapters";
import type { MarketCapInfoResponse, TokenMetadata } from "../types";
import { formatNumber, getAmountFromURL, isAPIEndPoint, isAddress, isBigInt } from "../utils";

const nullResponse = {
  total: null,
  circulating: null,
};

export class MarketCapAPI {
  private readonly adapter: Adapter;

  constructor(adapter: Adapter) {
    this.adapter = adapter;
  }

  /**
   * Get market cap information of an asset.
   * @param tokenInfo Token metadata followed by the token schema.
   * @returns The maximum supply of an asset.
   * @returns The circulating amount of an asset.
   */
  public async getMarketCapInfo(tokenInfo: TokenMetadata): Promise<MarketCapInfoResponse> {
    if (!tokenInfo.maxSupply) {
      throw new Error("MarketCap has not been configured.");
    }

    const tokenId = tokenInfo.tokenId;
    const decimals = tokenInfo.decimals;
    let maxSupply: (string | number)[];

    if (Array.isArray(tokenInfo.maxSupply)) {
      maxSupply = tokenInfo.maxSupply;
    } else {
      maxSupply = [tokenInfo.maxSupply];
    }

    const total = await this.getAmountFromArray(tokenId, maxSupply, decimals);
    if (total === null) {
      return nullResponse;
    }

    if (!tokenInfo.circulatingOnChain && !tokenInfo.burn && !tokenInfo.treasury && !tokenInfo.treasuryOnChain) {
      return {
        total: formatNumber(total, decimals),
      };
    }

    if (tokenInfo.treasuryOnChain) {
      const treasuryRaw = tokenInfo.treasuryOnChain;

      const treasury = await this.adapter.getAmountInAddress(treasuryRaw, tokenId);
      // SECURITY FIX: Clamp to zero to prevent negative market cap if treasury > total supply
      const adjustedTotal = total - treasury < 0n ? 0n : total - treasury;
      return {
        total: formatNumber(adjustedTotal, decimals),
        circulating: formatNumber(adjustedTotal, decimals),
      };
    }

    const [treasury, burn] = await Promise.all([
      this.getAmountFromArray(tokenId, tokenInfo.treasury ?? [], decimals),
      this.getAmountFromArray(tokenId, tokenInfo.burn ?? [], decimals),
    ]);

    if (burn === null || treasury === null) {
      return nullResponse;
    }

    if (tokenInfo.circulatingOnChain) {
      const circulatingOnChain = await this.getAmountFromArray(tokenId, tokenInfo.circulatingOnChain, decimals);

      if (circulatingOnChain === null) {
        return nullResponse;
      }

      // SECURITY FIX: Clamp to zero to prevent negative market cap
      const adjustedTotal1 = total - burn < 0n ? 0n : total - burn;
      const adjustedCirculating1 = circulatingOnChain - treasury < 0n ? 0n : circulatingOnChain - treasury;
      return {
        total: formatNumber(adjustedTotal1, decimals),
        circulating: formatNumber(adjustedCirculating1, decimals),
      };
    }

    // SECURITY FIX: Clamp to zero to prevent negative market cap
    const adjustedTotal2 = total - burn < 0n ? 0n : total - burn;
    const adjustedCirculating2 = total - treasury - burn < 0n ? 0n : total - treasury - burn;
    return {
      total: formatNumber(adjustedTotal2, decimals),
      circulating: formatNumber(adjustedCirculating2, decimals),
    };
  }

  private async getAmountFromArray(
    token: string,
    values: (string | number)[],
    decimals: number,
  ): Promise<bigint | null> {
    const amounts = await Promise.all(
      values.map((value) => {
        if (isBigInt(value)) {
          return BigInt(value);
        }
        if (isAddress(value)) {
          return this.adapter.getAmountInAddress(value.toString(), token);
        }
        if (isAPIEndPoint(value)) {
          return getAmountFromURL(value.toString(), decimals);
        }
        return this.adapter.getOnchainAmountOfAsset(value.toString());
      }),
    );
    let amount = 0n;
    for (const value of amounts) {
      if (value === null) {
        return null;
      }
      amount += value;
    }
    return amount;
  }
}
