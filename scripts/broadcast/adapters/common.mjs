import { canonicalChannelIdentity, normalizeBroadcastText } from "../normalize.mjs";

export const REPLAY_MARKERS = /\b(?:replay|highlights?|mini match|review|best of|season review|stories|magazine|preview)\b/i;

export function decodeHtml(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&").replace(/&plus;/gi, "+").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/\s+/g, " ").trim();
}

export function semanticBlocks(html, tags = ["article", "li"]) {
  const pattern = new RegExp(`<(${tags.join("|")})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, "gi");
  return [...String(html ?? "").matchAll(pattern)].map((match) => match[0]);
}

export function semanticKickoff(block) {
  const attributed = block.match(/<time\b[^>]*(?:itemprop=["']startDate["']|data-(?:role|type)=["']kickoff["'])[^>]*datetime=["']([^"']+)["'][^>]*>/i) ??
    block.match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*(?:itemprop=["']startDate["']|data-(?:role|type)=["']kickoff["'])[^>]*>/i);
  if (attributed) return attributed[1];
  return block.match(/(?:kick[ -]?off|kickoff)[^<]{0,40}<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] ?? null;
}

export function headingTeamPair(block) {
  for (const match of block.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    const parts = decodeHtml(match[1]).split(/\s+(?:vs?\.?|versus)\s+/i);
    if (parts.length === 2 && parts.every(Boolean)) return { homeTeam: parts[0], awayTeam: parts[1] };
  }
  return null;
}

export function embeddedJson(html) {
  const documents = [];
  for (const match of String(html ?? "").matchAll(/<script\b[^>]*(?:type=["']application\/(?:ld\+)?json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      documents.push(JSON.parse(match[1]));
    } catch {
      // Official pages change independently. Malformed hydration data fails closed.
    }
  }
  return documents;
}

export function objectsWithin(value) {
  const result = [];
  const visit = (item) => {
    if (!item || typeof item !== "object") return;
    if (!Array.isArray(item)) result.push(item);
    for (const child of Object.values(item)) {
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(value);
  return result;
}

export function stringValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value?.name === "string" && value.name.trim()) return value.name.trim();
  }
  return null;
}

export function stringList(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : item?.name).filter(Boolean);
    if (typeof value === "string") return value.split(/\s*(?:,|\/|\||\band\b)\s*/i).filter(Boolean);
  }
  return [];
}

export function timestamp(value) {
  const milliseconds = Date.parse(String(value ?? ""));
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}

export function teamPair(object) {
  const participant = (side, keys) => {
    const key = keys.find((candidate) => object?.[candidate] !== undefined);
    const raw = key ? object[key] : null;
    const name = typeof raw === "string" ? raw.trim() : String(raw?.name ?? "").trim();
    if (!name) return null;
    const aliases = [...(Array.isArray(raw?.aliases) ? raw.aliases : []), ...(Array.isArray(raw?.alternateNames) ? raw.alternateNames : [])]
      .map((alias) => String(alias ?? "").trim()).filter(Boolean);
    const sourceId = raw?.sourceId ?? raw?.id ?? object?.[`${side}TeamId`] ?? object?.[`${side}Id`];
    const participantType = raw?.participantType ?? raw?.type ?? object?.[`${side}TeamType`];
    const country = raw?.country ?? raw?.countryCode ?? object?.[`${side}TeamCountry`];
    return {
      [`${side}Team`]: name,
      ...(aliases.length > 0 ? { [`${side}TeamAliases`]: aliases } : {}),
      ...(sourceId != null && String(sourceId).trim() ? { [`${side}TeamSourceId`]: String(sourceId).trim() } : {}),
      ...(participantType ? { [`${side}TeamType`]: String(participantType).trim() } : {}),
      ...(country ? { [`${side}TeamCountry`]: String(country).trim() } : {})
    };
  };
  const home = participant("home", ["homeTeam", "home", "teamA"]);
  const away = participant("away", ["awayTeam", "away", "teamB"]);
  if (home && away) return { ...home, ...away };
  const title = stringValue(object, ["title", "name", "eventName"]);
  const parts = title?.split(/\s+(?:vs?\.?|versus)\s+/i);
  return parts?.length === 2 ? { homeTeam: parts[0].trim(), awayTeam: parts[1].trim() } : null;
}

export function exactRow(object, { channelKeys, requireLive = false, channelPattern, competitionFallback, sourceTimeKeys = ["kickoff", "kickoffTime", "startDate", "startTime"] }) {
  const teams = teamPair(object);
  const competition = stringValue(object, ["competition", "competitionName", "league", "tournament"]) ?? competitionFallback;
  const kickoff = timestamp(stringValue(object, sourceTimeKeys));
  const channels = stringList(object, channelKeys).filter((channel) => channelPattern.test(channel));
  const title = stringValue(object, ["title", "name", "eventName"]) ?? `${teams?.homeTeam ?? ""} vs ${teams?.awayTeam ?? ""}`;
  const live = object?.isLive === true || /^live$/i.test(String(object?.status ?? object?.label ?? "")) || /\blive\b/i.test(String(object?.badges ?? ""));
  if (!teams || !competition || !kickoff || channels.length === 0 || REPLAY_MARKERS.test(title) || (requireLive && !live)) return null;
  return { ...teams, competition, startUtcEpochSeconds: kickoff, channels };
}

export function parseRows(html, options) {
  return embeddedJson(html).flatMap(objectsWithin).map((object) => exactRow(object, options)).filter(Boolean)
    .filter((row, index, all) => all.findIndex((candidate) => normalizeBroadcastText(candidate.competition) === normalizeBroadcastText(row.competition) &&
      normalizeBroadcastText(candidate.homeTeam) === normalizeBroadcastText(row.homeTeam) && normalizeBroadcastText(candidate.awayTeam) === normalizeBroadcastText(row.awayTeam) &&
      candidate.startUtcEpochSeconds === row.startUtcEpochSeconds && candidate.channels.join("|") === row.channels.join("|")) === index);
}

function scheduledParticipant(row, side, source) {
  const name = row[`${side}Team`];
  const sourceId = row[`${side}TeamSourceId`];
  const aliases = row[`${side}TeamAliases`];
  const participantType = row[`${side}TeamType`];
  const country = row[`${side}TeamCountry`];
  if (!sourceId && !aliases && !participantType && !country) return name;
  return {
    name,
    ...(Array.isArray(aliases) && aliases.length > 0 ? { aliases } : {}),
    ...(sourceId ? { sourceIds: { [source]: String(sourceId) } } : {}),
    ...(participantType ? { participantType } : {}),
    ...(country ? { country } : {})
  };
}

export function scheduleAdapter({ id, url, parse, sport = "football" }) {
  const trustedHost = new URL(url).hostname;
  return {
    id,
    contractStatus: "fixture-tested-live-unverified",
    parserTypes: ["embedded-json"],
    async collect({ fetchText, verifiedAt, aliasesByChannel = {} }) {
      const rows = parse(await fetchText(url));
      return rows.map((row) => ({
        sport: row.sport ?? sport,
        competition: row.competition,
        homeTeam: scheduledParticipant(row, "home", id),
        awayTeam: scheduledParticipant(row, "away", id),
        startUtcEpochSeconds: row.startUtcEpochSeconds,
        broadcasts: row.channels.flatMap((channelName) => row.broadcastsFor(channelName).map((broadcast) => ({ broadcast, channelName }))).map(({ broadcast, channelName }) => ({
          ...broadcast,
          channelName,
          aliases: Object.entries(aliasesByChannel).find(([name]) => canonicalChannelIdentity(name) === canonicalChannelIdentity(channelName))?.[1] ?? [],
          sourceType: row.sourceType ?? "official-broadcaster-schedule",
          destinationVerified: true,
          sourceUrl: url,
          verifiedAt,
          destinationType: broadcast.destinationType ?? row.destinationType ?? "linear",
          matchingMethod: row.matchingMethod
        }))
      }));
    },
    trustedHosts: [trustedHost]
  };
}
