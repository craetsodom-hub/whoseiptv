import participantConfig from "../../config/participant-identities.json" with { type: "json" };
import rightsConfig from "../../config/official-event-broadcasters.json" with { type: "json" };
import { normalizeBroadcastText } from "./normalize.mjs";

const ORGANIZATION_TOKENS = new Set(["ac", "afc", "association", "bc", "ca", "cc", "cd", "cf", "club", "fc", "hc", "rfc", "sad", "sc"]);
const CONNECTIVE_TOKENS = new Set(["and", "de", "del", "the"]);
const TOKEN_EQUIVALENTS = new Map([
  ["st", "saint"], ["ste", "sainte"], ["utd", "united"], ["mt", "mount"]
]);
const GENERIC_IDENTITY_TOKENS = new Set(["athletic", "city", "club", "national", "racing", "sporting", "united"]);
const PARTICIPANT_TYPES = new Set(["club", "constructor", "driver", "individual", "national-team", "participant", "team"]);
const SPORTS = new Set(["basketball", "cricket", "football", "formula1", "rugby", "tennis"]);
const WOMEN = new Set(["women", "womens", "woman", "female", "ladies", "femenino", "femenina", "feminin", "femminile", "frauen"]);
const MEN = new Set(["men", "mens", "male"]);

function normalizedAliases(value) {
  if (typeof value === "string") return [value];
  return [value?.name, ...(Array.isArray(value?.aliases) ? value.aliases : []), ...(Array.isArray(value?.alternateNames) ? value.alternateNames : [])]
    .map(normalizeBroadcastText).filter(Boolean);
}

function sourceIds(value) {
  const ids = new Map();
  for (const [source, id] of Object.entries(value?.sourceIds ?? {})) {
    const provider = String(source).trim().toLowerCase();
    const sourceId = String(id ?? "").trim();
    if (provider && sourceId) ids.set(provider, sourceId);
  }
  const provider = String(value?.source ?? "").trim().toLowerCase();
  const sourceId = String(value?.sourceId ?? "").trim();
  if (provider && sourceId) ids.set(provider, sourceId);
  return ids;
}

function scopedKey(...values) {
  return JSON.stringify(values);
}

function compatibleSourceIds(left, right) {
  const leftIds = sourceIds(left);
  const rightIds = sourceIds(right);
  const common = [...leftIds.keys()].filter((source) => rightIds.has(source));
  if (common.some((source) => leftIds.get(source) !== rightIds.get(source))) return "conflict";
  return common.length > 0 ? "match" : "none";
}

function explicitType(value) {
  const type = String(value?.participantType ?? value?.type ?? value?.kind ?? "").trim().toLowerCase();
  if (type) return type;
  return normalizedAliases(value).some((alias) => /\bnational team\b/.test(alias)) ? "national-team" : null;
}

function explicitCountry(value) {
  return String(value?.country ?? value?.countryCode ?? "").trim().toUpperCase() || null;
}

function qualifiers(value) {
  const normalized = normalizeBroadcastText(value);
  const tokens = normalized.split(" ").filter(Boolean);
  const youthNumber = normalized.match(/\b(?:u|under)\s?(\d{1,2})\b/)?.[1] ?? null;
  const youth = youthNumber ? `u${youthNumber}` : tokens.some((token) => token === "youth" || token === "junior" || token === "juniors") ? "youth" : null;
  let squad = null;
  if (/\b(?:reserves?|reserve team|second team)\b/.test(normalized)) squad = "reserve";
  else if (/\bb team\b/.test(normalized) || /(?:^|\s)b$/.test(normalized)) squad = "b";
  else if (/(?:^|\s)ii$/.test(normalized)) squad = "ii";
  else if (/(?:^|\s)iii$/.test(normalized)) squad = "iii";
  else if (/(?:^|\s)([2-9])$/.test(normalized)) squad = `number:${normalized.match(/([2-9])$/)[1]}`;
  const gender = tokens.some((token) => WOMEN.has(token)) ? "women" : tokens.some((token) => MEN.has(token)) ? "men" : null;
  return { gender, youth, squad };
}

function qualifiersCompatible(left, right) {
  if ((left.gender === "women") !== (right.gender === "women")) return false;
  if (left.gender && right.gender && left.gender !== right.gender) return false;
  if (left.youth !== right.youth && (left.youth || right.youth)) return false;
  return left.squad === right.squad;
}

function identityTokens(value) {
  const qualifier = qualifiers(value);
  const nationalTeam = /\bnational team\b/.test(normalizeBroadcastText(value));
  const youthPattern = /^(?:u\d{1,2}|under\d{1,2}|youth|junior|juniors)$/;
  return normalizeBroadcastText(value).split(" ").filter(Boolean).map((token) => TOKEN_EQUIVALENTS.get(token) ?? token).filter((token) =>
    !ORGANIZATION_TOKENS.has(token) && !CONNECTIVE_TOKENS.has(token) && !WOMEN.has(token) && !MEN.has(token) &&
    !youthPattern.test(token) && !["women", "team", "reserves", "reserve"].includes(token) && !(nationalTeam && token === "national")
  ).filter((token, index, all) => !(qualifier.squad && index === all.length - 1 && ["b", "ii", "iii", "2", "3", "4", "5", "6", "7", "8", "9"].includes(token)));
}

export function createParticipantIdentityRegistry(config) {
  if (!config || typeof config !== "object" || !Array.isArray(config.participants)) {
    throw new Error("Invalid canonical participant identity registry");
  }
  const entries = new Map();
  const aliases = new Map();
  const sourceIdentities = new Map();
  for (const entry of config.participants ?? []) {
    const id = String(entry?.id ?? "").trim();
    const sport = String(entry?.sport ?? "").trim().toLowerCase();
    const type = String(entry?.type ?? "").trim().toLowerCase();
    const country = entry?.country == null ? null : String(entry.country).trim().toUpperCase();
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id) || !SPORTS.has(sport) || !PARTICIPANT_TYPES.has(type) ||
        (country && !/^[A-Z]{2}$/.test(country)) || !Array.isArray(entry?.names) || entry.names.length === 0 ||
        entry.names.some((name) => typeof name !== "string") || entries.has(id)) {
      throw new Error("Invalid canonical participant identity registry");
    }
    const normalizedNames = entry.names.map((name) => normalizeBroadcastText(name));
    if (normalizedNames.some((name) => !name) || new Set(normalizedNames).size !== normalizedNames.length) {
      throw new Error("Duplicate canonical participant alias");
    }
    const normalizedEntry = { ...entry, id, sport, type, ...(country ? { country } : {}) };
    entries.set(id, normalizedEntry);
    for (const name of entry.names) {
      const normalized = normalizeBroadcastText(name);
      const key = scopedKey(sport, normalized);
      if (aliases.has(key)) throw new Error(`Ambiguous canonical participant alias: ${key}`);
      aliases.set(key, id);
    }
    if (entry.sourceIds !== undefined && (!entry.sourceIds || typeof entry.sourceIds !== "object" || Array.isArray(entry.sourceIds))) {
      throw new Error("Invalid canonical participant source IDs");
    }
    for (const [source, sourceId] of Object.entries(entry.sourceIds ?? {})) {
      const provider = String(source).trim().toLowerCase();
      const value = String(sourceId ?? "").trim();
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider) || !["string", "number"].includes(typeof sourceId) || !value || /[\u0000-\u001f]/.test(value)) {
        throw new Error("Invalid canonical participant source ID");
      }
      const key = scopedKey(sport, provider, value);
      if (sourceIdentities.has(key)) throw new Error(`Ambiguous canonical participant source ID: ${key}`);
      sourceIdentities.set(key, id);
    }
  }
  return { entries, aliases, sourceIdentities };
}

const PARTICIPANTS = createParticipantIdentityRegistry(participantConfig);
const COMPETITIONS = new Map();
for (const competition of rightsConfig.competitions ?? []) {
  for (const alias of competition.aliases ?? []) {
    const key = normalizeBroadcastText(alias).replace(/\s+(?:19|20)\d{2}(?:\s+(?:19|20)?\d{2})?$/, "");
    const existing = COMPETITIONS.get(key);
    if (existing && existing !== competition.id) throw new Error(`Ambiguous canonical competition alias: ${key}`);
    COMPETITIONS.set(key, competition.id);
  }
}

function registryIdentity(value, sport, registry = PARTICIPANTS) {
  const ids = new Set();
  for (const alias of normalizedAliases(value)) {
    const id = registry.aliases.get(scopedKey(sport, alias));
    if (id) ids.add(id);
  }
  for (const [source, id] of sourceIds(value)) {
    const canonicalId = registry.sourceIdentities.get(scopedKey(sport, source, id));
    if (canonicalId) ids.add(canonicalId);
  }
  if (ids.size !== 1) return null;
  const entry = registry.entries.get([...ids][0]);
  const type = explicitType(value);
  const country = explicitCountry(value);
  return (type && type !== entry.type) || (country && entry.country && country !== entry.country) ? null : entry;
}

export function competitionIdentity(value) {
  const normalized = normalizeBroadcastText(typeof value === "string" ? value : value?.name)
    .replace(/\s+(?:19|20)\d{2}(?:\s+(?:19|20)?\d{2})?$/, "");
  const id = COMPETITIONS.get(normalized);
  return id ? `registry:${id}` : normalized ? `name:${normalized}` : null;
}

function exactAliasMatch(left, right) {
  const leftAliases = normalizedAliases(left);
  const rightAliases = normalizedAliases(right);
  const safe = (alias) => identityTokens(alias).some((token) => !GENERIC_IDENTITY_TOKENS.has(token));
  if (leftAliases[0] === rightAliases[0]) return safe(leftAliases[0]);
  return leftAliases.slice(1).some((alias) => alias === rightAliases[0] && safe(alias)) ||
    rightAliases.slice(1).some((alias) => alias === leftAliases[0] && safe(alias));
}

function acronymMatch(leftTokens, rightTokens) {
  const match = (short, long) => short.length === 1 && /^[a-z]{2,5}$/.test(short[0]) && long.length >= 2 &&
    long.some((token) => !GENERIC_IDENTITY_TOKENS.has(token)) && long.map((token) => token[0]).join("") === short[0];
  return match(leftTokens, rightTokens) || match(rightTokens, leftTokens);
}

function conservativeTokenMatch(leftTokens, rightTokens) {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const common = [...left].filter((token) => right.has(token)).length;
  if (common < 2) return false;
  const distinctiveCommon = [...left].filter((token) => right.has(token) && !GENERIC_IDENTITY_TOKENS.has(token)).length;
  if (distinctiveCommon === 0) return false;
  const shorter = Math.min(left.size, right.size);
  const longer = Math.max(left.size, right.size);
  const union = new Set([...left, ...right]).size;
  return distinctiveCommon >= 2 && ((common === shorter && longer - shorter <= 2) ||
    (common / shorter >= 0.8 && common / union >= 0.67));
}

export function participantIdentityEvidence(left, right, sport, registry = PARTICIPANTS) {
  if (!left || !right || !sport) return null;
  const ids = compatibleSourceIds(left, right);
  if (ids === "conflict") return null;
  const leftType = explicitType(left);
  const rightType = explicitType(right);
  if (leftType && rightType && leftType !== rightType) return null;
  const leftQualifiers = qualifiers(normalizedAliases(left)[0]);
  const rightQualifiers = qualifiers(normalizedAliases(right)[0]);
  if (!qualifiersCompatible(leftQualifiers, rightQualifiers)) return null;
  const leftRegistry = registryIdentity(left, sport, registry);
  const rightRegistry = registryIdentity(right, sport, registry);
  const leftCountry = explicitCountry(left) ?? leftRegistry?.country;
  const rightCountry = explicitCountry(right) ?? rightRegistry?.country;
  const effectiveLeftType = leftType ?? leftRegistry?.type;
  const effectiveRightType = rightType ?? rightRegistry?.type;
  if (effectiveLeftType && effectiveRightType && effectiveLeftType !== effectiveRightType) return null;
  if (leftCountry && rightCountry && leftCountry !== rightCountry) return null;
  if (ids === "match") return { score: 100, method: "compatible-source-id" };
  if (leftRegistry && rightRegistry) {
    if (leftRegistry.id !== rightRegistry.id || (leftRegistry.type && rightRegistry.type && leftRegistry.type !== rightRegistry.type)) return null;
    return { score: 90, method: "canonical-participant-alias" };
  }
  if (exactAliasMatch(left, right)) return { score: 80, method: "exact-normalized-participant" };

  const leftTokens = identityTokens(normalizedAliases(left)[0]);
  const rightTokens = identityTokens(normalizedAliases(right)[0]);
  if (leftTokens.length === 0 || rightTokens.length === 0) return null;
  const leftKey = [...leftTokens].sort().join(" ");
  const rightKey = [...rightTokens].sort().join(" ");
  if (leftKey === rightKey && leftTokens.some((token) => !GENERIC_IDENTITY_TOKENS.has(token))) {
    return { score: 70, method: "structured-participant-equivalence" };
  }
  if (acronymMatch(leftTokens, rightTokens)) return { score: 60, method: "participant-acronym" };
  if (conservativeTokenMatch(leftTokens, rightTokens)) return { score: 50, method: "supported-participant-token-equivalence" };
  return null;
}

function participant(event, side) {
  const value = event?.[`${side}Team`];
  if (value && typeof value === "object") return value;
  return {
    name: value,
    aliases: event?.[`${side}TeamAliases`],
    participantType: event?.[`${side}TeamType`],
    sourceIds: event?.[`${side}TeamSourceIds`]
  };
}

function eventSourceIdStatus(event, candidate) {
  return compatibleSourceIds(event, candidate);
}

export function eventIdentityEvidence(event, candidate, toleranceSeconds = 15 * 60) {
  if (!event || !candidate) return null;
  if (Boolean(event.sport) !== Boolean(candidate.sport) || (event.sport && event.sport !== candidate.sport)) return null;
  // Legacy football fixtures predate the explicit sport field. Current feed
  // events always carry it, while adapters in this resolver are football-only.
  const sport = candidate.sport ?? "football";
  const competitionIds = compatibleSourceIds(event.competition, candidate.competition);
  if (competitionIds === "conflict" || (competitionIds !== "match" && competitionIdentity(event.competition) !== competitionIdentity(candidate.competition))) return null;
  if (!Number.isInteger(event.startUtcEpochSeconds) || !Number.isInteger(candidate.startUtcEpochSeconds) ||
      Math.abs(event.startUtcEpochSeconds - candidate.startUtcEpochSeconds) > toleranceSeconds) return null;
  const eventIds = eventSourceIdStatus(event, candidate);
  if (eventIds === "conflict") return null;
  if (eventIds === "match") return { score: 1000, matchingMethod: "compatible-source-event-id" };

  const eventHome = participant(event, "home");
  const eventAway = participant(event, "away");
  const candidateHome = participant(candidate, "home");
  const candidateAway = participant(candidate, "away");
  const pairings = [
    [participantIdentityEvidence(eventHome, candidateHome, sport), participantIdentityEvidence(eventAway, candidateAway, sport), "ordered"],
    [participantIdentityEvidence(eventHome, candidateAway, sport), participantIdentityEvidence(eventAway, candidateHome, sport), "unordered"]
  ].filter(([left, right]) => left && right).filter(([left, right]) =>
    (left.score > 60 || right.score >= 70) && (right.score > 60 || left.score >= 70)
  );
  if (pairings.length === 0) return null;
  const bestScore = Math.max(...pairings.map(([left, right]) => left.score + right.score));
  const best = pairings.filter(([left, right]) => left.score + right.score === bestScore);
  if (best.length !== 1) return null;
  const [left, right, order] = best[0];
  return {
    score: left.score + right.score,
    matchingMethod: `${order}:${left.method}+${right.method}`
  };
}
