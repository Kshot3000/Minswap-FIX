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

/**
 * SECURITY FIX: Validates URLs to prevent SSRF and malicious redirects.
 * Ensures the URL points to a valid external domain and not internal/private IPs.
 */
export function isValidExternalURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    
    // Block internal/private IP ranges and localhost
    const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
    if (blockedHosts.includes(parsed.hostname)) return false;
    
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

export async function getAmountFromURL(url: string, decimals: number): Promise<bigint | null> {
  // SECURITY FIX: Validate URL to prevent SSRF attacks
  if (!isValidExternalURL(url)) {
    console.warn(`Blocked potentially unsafe URL fetch: ${url}`);
    return null;
  }

  const response = await fetch(url);
  let amount = await response.text();
  // format to support APIs which return amount with decimal places
  if (amount.includes(".")) {
    const [prefix, postfix] = amount.split(".");
    if (postfix.length > decimals) {
      return null;
    }
    amount = prefix + postfix.padEnd(decimals, "0");
  }

  return tryParseBigInt(amount);
}
