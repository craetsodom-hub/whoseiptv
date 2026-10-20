import { broadcastAliases, canonicalChannelIdentity } from "../normalize.mjs";
import { TERRITORY_REGIONS } from "../territory-regions.mjs";
import { embeddedJson, exactRow, objectsWithin, parseRows, stringValue, REPLAY_MARKERS } from "./common.mjs";
import { beinMenaLanguages } from "../languages.mjs";
import { reviewedChannelAudio } from "../channel-identity.mjs";

export const BEIN_MENA_URL = "https://www.beinsports.com/en-mena/tv-guide";
// Some full EPG rows carry long programme descriptions. Keep pages well below
// the shared fetch size limit while still discovering the whole API window.
const BEIN_MENA_PAGE_SIZE = 100;
const BEIN_MENA_MAX_PAGES = 100;
const BEIN_MENA_API_BASE = "https://www.beinsports.com/api/opta/tv-event?region=en-mena";
export const BEIN_MENA_API_URL = `${BEIN_MENA_API_BASE}&limit=${BEIN_MENA_PAGE_SIZE}&offset=0`;
// These are the MENA destinations observed in the official guide. Language
// variants are separate channels; French MAX/FR and AFC packages are excluded.
const CHANNEL = /^beIN(?: SPORTS)? (?:(?:[1-9]|10)|4K(?: HDR)?|XTRA(?: [1-9])?|EN [12])$/i;

function regionalBroadcast(channelName) {
  return [{ region: "MENA", displayRegion: "MENA", rightsHolder: "beIN Sports", regionTerritories: TERRITORY_REGIONS.MENA, languages: beinMenaLanguages(channelName) }];
}

function normalizedChannel(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedSport(value) {
  const sport = String(value ?? "").trim().toLowerCase();
  return sport === "soccer" ? "football" : sport || undefined;
}

function guideKickoff(data) {
  const date = String(data?.m_date ?? "").slice(0, 10);
  const time = String(data?.m_time ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(time)) return null;
  const milliseconds = Date.parse(date && time ? `${date}T${time}` : "");
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}

// A programme start is not a match kickoff. Keep the interval separate and
// reconcile it against an independently sourced fixture in the resolver.
function programmeMatch(item) {
  const data = item?.data;
  if (item?.channel?.provider?.name !== "epg.bein" || data?.ChannelName !== item.channel.name ||
      String(data?.ChannelCode) !== String(item.channel.externalId)) return null;
  // Partial structured identities must not be replaced by title guesses.
  if ([data?.teama, data?.teamb, data?.m_date, data?.m_time, data?.competition_name].some(Boolean)) return null;
  const title = String(data?.Title?.English ?? "").trim();
  if (REPLAY_MARKERS.test(title)) return null;
  const match = title.match(/^(.+?)\s+vs\.?\s+(.+?)\s+-\s+(Spanish LaLiga|UEFA Champions League|UEFA Europa League|UEFA Conference League|Premier League|Ligue 1|Bundesliga)\s+(\d{4})[/-](\d{2}|\d{4})(?:\s+-\s+[^\n]+)?$/i);
  if (!match || Number(match[5].length === 2 ? match[4].slice(0, 2) + match[5] : match[5]) !== Number(match[4]) + 1) return null;
  const competitions = {
    "spanish laliga": ["LaLiga", "Spanish League - Primera División"],
    "uefa champions league": ["UEFA Champions League", "UEFA Champions League"],
    "uefa europa league": ["UEFA Europa League", "UEFA Europa League"],
    "uefa conference league": ["UEFA Conference League", "UEFA Conference League"],
    "premier league": ["Premier League", "English Premier League"],
    "ligue 1": ["Ligue 1", "French Ligue 1"],
    "bundesliga": ["Bundesliga", "German Bundesliga"]
  };
  const [competition, category] = competitions[match[3].toLowerCase()];
  if (data?.Category?.English !== category) return null;
  const start = String(item.startDate ?? "");
  const duration = String(data.Duration ?? "").match(/^(\d{2}):([0-5]\d):([0-5]\d)$/);
  if (!/Z$/.test(start) || !duration) return null;
  const from = Date.parse(start) / 1000;
  const seconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  if (!Number.isInteger(from) || seconds < 90 * 60 || seconds > 5 * 3600) return null;
  const seasonStart = Date.UTC(Number(match[4]), 6, 1) / 1000;
  const seasonEnd = Date.UTC(Number(match[4]) + 1, 6, 1) / 1000;
  if (from < seasonStart || from >= seasonEnd) return null;
  return { homeTeam: match[1].trim(), awayTeam: match[2].trim(), competition,
    programmeWindow: { startUtcEpochSeconds: from, endUtcEpochSeconds: from + seconds },
    matchingMethod: "bein-epg-title-competition-programme-window" };
}

export function parseBeinMenaApi(body, sourceUrl = BEIN_MENA_API_URL) {
  let payload;
  try { payload = typeof body === "string" ? JSON.parse(body) : body; } catch { return []; }
  if (!Array.isArray(payload?.rows)) return [];
  const rows = payload.rows.flatMap((item) => {
    const data = item?.data;
    // The endpoint includes APAC rows even with region=en-mena. Never use
    // channel names alone to transplant a regional feed into MENA.
    if (item?.channel?.provider?.name && item.channel.provider.name !== "epg.bein") return [];
    const channelName = normalizedChannel(item?.channel?.name ?? data?.ChannelName);
    const homeTeam = String(data?.teama ?? "").trim();
    const awayTeam = String(data?.teamb ?? "").trim();
    const competition = String(data?.competition_name ?? "").trim();
    const homeTeamSourceId = String(data?.teama_id ?? "").trim();
    const awayTeamSourceId = String(data?.teamb_id ?? "").trim();
    const sourceId = String(data?.matchid ?? "").trim();
    const startUtcEpochSeconds = guideKickoff(data);
    const isLive = item?.live === true && String(data?.Live).toLowerCase() === "true";
    if (!CHANNEL.test(channelName) || !isLive || item?.replay === true) return [];
    if (!homeTeam || !awayTeam || !competition || !startUtcEpochSeconds) {
      const programme = programmeMatch(item);
      return programme ? [{ ...programme, sport: "football", channels: [channelName], broadcastsFor: regionalBroadcast, sourceUrl }] : [];
    }
    return [{
      homeTeam, awayTeam, competition, sport: normalizedSport(data?.sport ?? data?.sport_name) ?? "football",
      ...(homeTeamSourceId ? { homeTeamSourceId } : {}),
      ...(awayTeamSourceId ? { awayTeamSourceId } : {}),
      ...(sourceId ? { sourceId } : {}),
      startUtcEpochSeconds, channels: [channelName], broadcastsFor: regionalBroadcast,
      matchingMethod: "bein-epg-match-teams-competition-kickoff", sourceUrl
    }];
  });
  return rows.filter((row, index, all) => all.findIndex((item) => item.competition === row.competition &&
    item.homeTeam === row.homeTeam && item.awayTeam === row.awayTeam && item.startUtcEpochSeconds === row.startUtcEpochSeconds && item.programmeWindow?.startUtcEpochSeconds === row.programmeWindow?.startUtcEpochSeconds &&
    item.channels[0] === row.channels[0]) === index);
}

function pageCount(body) {
  let payload;
  try { payload = typeof body === "string" ? JSON.parse(body) : body; } catch { return 1; }
  const count = Number(payload?.count);
  const pages = Number.isSafeInteger(count) && count >= 0 ? Math.ceil(count / BEIN_MENA_PAGE_SIZE) : 1;
  if (pages > BEIN_MENA_MAX_PAGES) throw new Error("beIN EPG row count exceeds the audited limit");
  return pages;
}

function pageUrl(page) {
  return `${BEIN_MENA_API_BASE}&limit=${BEIN_MENA_PAGE_SIZE}&offset=${page * BEIN_MENA_PAGE_SIZE}`;
}

// Retained for sanitized hydration/HTML regression fixtures. Production uses
// the first-party API above because it explicitly aligns match and EPG fields.
export function parseBeinMenaGuide(html) {
  const options = { channelKeys: ["channelName", "channel", "station"], channelPattern: CHANNEL, requireLive: true };
  const nested = embeddedJson(html).flatMap(objectsWithin).flatMap((container) => {
    const channelName = stringValue(container, ["channelName", "channel", "station"]);
    if (!CHANNEL.test(channelName ?? "")) return [];
    const programmes = ["programmes", "programs", "schedule", "events"].flatMap((key) => Array.isArray(container[key]) ? container[key] : []);
    return programmes.map((programme) => exactRow({ ...programme, channelName }, options)).filter(Boolean);
  });
  const rows = [...parseRows(html, options), ...nested].filter((row, index, all) => all.findIndex((item) =>
    item.homeTeam === row.homeTeam && item.awayTeam === row.awayTeam && item.startUtcEpochSeconds === row.startUtcEpochSeconds && item.channels.join("|") === row.channels.join("|")
  ) === index);
  return rows.map((row) => ({ ...row, channels: row.channels.map(normalizedChannel), broadcastsFor: regionalBroadcast }));
}

export const beinMenaAdapter = {
  id: "bein-mena",
  contractStatus: "first-party-api-verified",
  parserTypes: ["first-party-json-api", "semantic-html", "embedded-json"],
  trustedHosts: ["www.beinsports.com"],
  async collect({ fetchText, verifiedAt, aliasesByChannel = {}, onPartialFailure = () => {} }) {
    // The API does not expose a verified date-filter contract. Its count field
    // is authoritative for the current EPG window, so discover every page
    // from that response instead of relying on stale hard-coded offsets.
    const bodies = [];
    const failures = [];
    try {
      const firstBody = await fetchText(BEIN_MENA_API_URL);
      bodies.push({ url: BEIN_MENA_API_URL, body: firstBody });
      for (let page = 1; page < pageCount(firstBody); page += 1) {
        const url = pageUrl(page);
        try { bodies.push({ url, body: await fetchText(url) }); }
        catch (error) {
          failures.push(error);
          // Respect throttling: do not continue hammering the provider.
          if (error?.status === 429 || /HTTP 429/.test(String(error?.message))) break;
        }
      }
    } catch (error) {
      if (/exceeds the audited limit/i.test(String(error?.message))) throw error;
      failures.push(error);
    }
    let guideHtml = "";
    try { guideHtml = await fetchText(BEIN_MENA_URL); } catch (error) { failures.push(error); }
    if (bodies.length === 0 && !guideHtml) throw failures[0] ?? new Error("beIN schedule sources returned no data");
    for (const failure of failures) onPartialFailure(String(failure?.message ?? failure).slice(0, 160));
    const apiRows = bodies.flatMap(({ url, body }) => parseBeinMenaApi(body, url));
    // The public guide and JSON endpoint are independent first-party views.
    // Read both because the API can expose a narrower active window while the
    // guide already publishes future exact-channel assignments.
    const guideRows = guideHtml ? parseBeinMenaGuide(guideHtml) : [];
    const rows = [...apiRows, ...guideRows].filter((row, index, all) => all.findIndex((item) =>
      item.competition === row.competition && item.homeTeam === row.homeTeam && item.awayTeam === row.awayTeam &&
      item.startUtcEpochSeconds === row.startUtcEpochSeconds && item.programmeWindow?.startUtcEpochSeconds === row.programmeWindow?.startUtcEpochSeconds && item.channels.join("|") === row.channels.join("|")
    ) === index);
    return rows.map((row) => ({
      sport: row.sport ?? "football",
      competition: row.competition,
      homeTeam: row.homeTeamSourceId ? { name: row.homeTeam, sourceIds: { "bein-opta": row.homeTeamSourceId } } : row.homeTeam,
      awayTeam: row.awayTeamSourceId ? { name: row.awayTeam, sourceIds: { "bein-opta": row.awayTeamSourceId } } : row.awayTeam,
      ...(row.sourceId ? { sourceIds: { "bein-opta": row.sourceId } } : {}),
      startUtcEpochSeconds: row.startUtcEpochSeconds,
      ...(row.programmeWindow ? { programmeWindow: row.programmeWindow, matchingMethod: row.matchingMethod } : {}),
      broadcasts: row.channels.flatMap((channelName) => row.broadcastsFor(channelName).map((broadcast) => ({
        ...broadcast,
        ...reviewedChannelAudio(channelName, "MENA", verifiedAt),
        channelName,
        aliases: broadcastAliases(channelName, Object.entries(aliasesByChannel).find(([name]) => canonicalChannelIdentity(name) === canonicalChannelIdentity(channelName))?.[1] ?? []),
        sourceType: "official-broadcaster-schedule",
        destinationVerified: true,
        sourceUrl: row.sourceUrl ?? BEIN_MENA_API_URL,
        verifiedAt,
        destinationType: "linear",
        matchingMethod: row.matchingMethod
      })))
    }));
  }
};
