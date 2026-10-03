export const TOKENS_DIR = "tokens";
// SECURITY FIX: Stricter URL regex to validate domain structure and prevent open redirects
export const URL_REGEX = "^https://(?:[a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,}(?:/[a-zA-Z0-9._~:/?#\\[\\]@!$&'()*+,;=%-]*)?$";
export const ADDRESS_REGEX = "^(addr1|stake1)[0-9a-zA-Z]{53}$|^(addr1|stake1)[0-9a-zA-Z]{98}$|^(Ddz|Ae2)[0-9a-zA-Z]+$";
export const ASSET_ID_REGEX = "^(([a-fA-F0-9]{2}){28,})$";
