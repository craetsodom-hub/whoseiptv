const QUALITY = new Set(["hd", "fhd", "uhd", "4k", "sd"]);
const COUNTRY_TOKENS = new Set(["uk", "gb", "us", "usa", "fr", "es", "de", "it", "pt", "ca", "au", "ma", "mena", "ar", "br", "mx", "za", "ng", "sa", "ae", "qa", "tr", "nl", "be"]);
const NUMBER_WORDS = new Map([["one", "1"], ["two", "2"], ["three", "3"], ["four", "4"], ["five", "5"]]);

export function normalizeBroadcastText(value) {
  return String(value ?? "").replace(/[ßẞ]/g, "ss").replace(/[øØ]/g, "o").replace(/[łŁ]/g, "l")
    .replace(/[đĐðÐ]/g, "d").replace(/[þÞ]/g, "th").replace(/[æÆ]/g, "ae").replace(/[œŒ]/g, "oe")
    .normalize("NFKD").replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US").replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function canonicalChannelIdentity(value) {
  const tokens = normalizeBroadcastText(value).split(" ").filter(Boolean);
  while (tokens.length > 1 && COUNTRY_TOKENS.has(tokens[0])) tokens.shift();
  while (tokens.length > 1 && COUNTRY_TOKENS.has(tokens.at(-1))) tokens.pop();
  return tokens.filter((token) => !QUALITY.has(token)).map((token) => NUMBER_WORDS.get(token) ?? token).join("");
}

// These are deliberately presentation-only variants.  They make a newly
// discovered channel useful against ordinary playlist spelling differences
// without turning the feed into a provider alias catalogue.  A territory is
// part of a broadcast's scope, not its channel identity, so prefixes are
// removed only for comparison/alias generation and never copied across a
// territory boundary.
export function genericBroadcastAliases(channelName, maximum = 12) {
  const raw = String(channelName ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return [];
  const withoutQuality = raw.replace(/(?:\s*[-|/]?\s*)(?:HD|FHD|UHD|SD|4K)\b/gi, "").trim();
  const withoutLocalePrefix = withoutQuality.replace(/^(?:[A-Z]{2}|USA|UK|MENA)\s*(?:\||[-/:])\s*/i, "").trim();
  const candidates = [withoutQuality, withoutLocalePrefix]
    .filter((value) => value && value !== raw)
    .filter((value, index, all) => all.indexOf(value) === index)
    .filter((value) => canonicalChannelIdentity(value) === canonicalChannelIdentity(raw));
  return candidates.slice(0, maximum);
}

export function broadcastAliases(channelName, legacyAliases = [], maximum = 12) {
  // Existing aliases are retained for backwards compatibility. New source
  // adapters pass no provider-specific aliases; they receive the generic
  // normalization variants above instead.
  const legacy = legacyAliases.map((alias) => String(alias ?? "").trim()).filter(Boolean)
    .filter((alias, index, all) => all.indexOf(alias) === index);
  const generic = cleanAliases(channelName, genericBroadcastAliases(channelName), maximum);
  return [...legacy, ...generic.filter((alias) => !legacy.includes(alias))].slice(0, maximum);
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
