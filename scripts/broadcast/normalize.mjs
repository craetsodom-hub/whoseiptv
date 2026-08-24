const QUALITY = new Set(["hd", "fhd", "uhd", "4k", "sd"]);
const COUNTRY_TOKENS = new Set(["uk", "gb", "us", "usa", "fr", "es", "de", "it", "pt", "ca", "au", "ma", "mena", "ar", "br", "mx", "za", "ng", "sa", "ae", "qa", "tr", "nl", "be"]);
const NUMBER_WORDS = new Map([["one", "1"], ["two", "2"], ["three", "3"], ["four", "4"], ["five", "5"]]);

export function normalizeBroadcastText(value) {
  return String(value ?? "").normalize("NFD").replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US").replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function canonicalChannelIdentity(value) {
  const tokens = normalizeBroadcastText(value).split(" ").filter(Boolean);
  while (tokens.length > 1 && COUNTRY_TOKENS.has(tokens[0])) tokens.shift();
  while (tokens.length > 1 && COUNTRY_TOKENS.has(tokens.at(-1))) tokens.pop();
  return tokens.filter((token) => !QUALITY.has(token)).map((token) => NUMBER_WORDS.get(token) ?? token).join("");
}

export function cleanAliases(channelName, aliases = [], maximum = 12) {
  const canonical = canonicalChannelIdentity(channelName);
  const seen = new Set();
  return aliases.map((alias) => String(alias ?? "").trim()).filter(Boolean).filter((alias) => {
    const normalized = normalizeBroadcastText(alias);
    if (!normalized || seen.has(normalized) || normalizeBroadcastText(channelName) === normalized) return false;
    // Formatting aliases must retain the same channel number and identity.
    if (canonicalChannelIdentity(alias) !== canonical) return false;
    seen.add(normalized);
    return true;
  }).slice(0, maximum);
}
