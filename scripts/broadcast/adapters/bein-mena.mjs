import { canonicalChannelIdentity } from "../normalize.mjs";
import { TERRITORY_REGIONS } from "../territory-regions.mjs";
import { embeddedJson, exactRow, objectsWithin, parseRows, stringValue } from "./common.mjs";

export const BEIN_MENA_URL = "https://www.beinsports.com/en-mena/tv-guide";
const BEIN_MENA_API_BASE = "https://www.beinsports.com/api/opta/tv-event?region=en-mena&limit=325";
// The official UI requests up to 3,000 rows. Fetch the same range in bounded
// pages so each decompressed response stays below the feed fetcher's size cap.
export const BEIN_MENA_API_URLS = Object.freeze(Array.from({ length: 9 }, (_, page) => `${BEIN_MENA_API_BASE}&offset=${page * 325}`));
export const BEIN_MENA_API_URL = BEIN_MENA_API_URLS[0];
// These are the MENA destinations observed in the official guide. Language
// variants are separate channels; French MAX/FR and AFC packages are excluded.
const CHANNEL = /^beIN(?: SPORTS)? (?:(?:[1-9]|10)|4K(?: HDR)?|XTRA(?: [1-9])?|EN [12])$/i;

function regionalBroadcast() {
  return [{ region: "MENA", rightsHolder: "beIN Sports", regionTerritories: TERRITORY_REGIONS.MENA }];
}

function normalizedChannel(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function guideKickoff(data) {
  const date = String(data?.m_date ?? "").slice(0, 10);
  const time = String(data?.m_time ?? "").trim();
  const milliseconds = Date.parse(date && time ? `${date}T${time}` : "");
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}

export function parseBeinMenaApi(body, sourceUrl = BEIN_MENA_API_URL) {
  let payload;
  try { payload = typeof body === "string" ? JSON.parse(body) : body; } catch { return []; }
  if (!Array.isArray(payload?.rows)) return [];
  const rows = payload.rows.flatMap((item) => {
    const data = item?.data;
    const channelName = normalizedChannel(item?.channel?.name ?? data?.ChannelName);
    const homeTeam = String(data?.teama ?? "").trim();
    const awayTeam = String(data?.teamb ?? "").trim();
    const competition = String(data?.competition_name ?? "").trim();
    const startUtcEpochSeconds = guideKickoff(data);
    const isLive = item?.live === true && String(data?.Live).toLowerCase() === "true";
    if (!CHANNEL.test(channelName) || !homeTeam || !awayTeam || !competition || !startUtcEpochSeconds || !isLive || item?.replay === true) return [];
    return [{
      homeTeam, awayTeam, competition, startUtcEpochSeconds, channels: [channelName], broadcastsFor: regionalBroadcast,
      matchingMethod: "bein-epg-match-teams-competition-kickoff", sourceUrl
    }];
  });
  return rows.filter((row, index, all) => all.findIndex((item) => item.competition === row.competition &&
    item.homeTeam === row.homeTeam && item.awayTeam === row.awayTeam && item.startUtcEpochSeconds === row.startUtcEpochSeconds &&
    item.channels[0] === row.channels[0]) === index);
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
  parserTypes: ["first-party-json-api"],
  trustedHosts: ["www.beinsports.com"],
  async collect({ fetchText, verifiedAt, aliasesByChannel = {} }) {
    const bodies = [];
    for (const url of BEIN_MENA_API_URLS) bodies.push({ url, body: await fetchText(url) });
    const apiRows = bodies.flatMap(({ url, body }) => parseBeinMenaApi(body, url));
    // HTML is accepted only for the retained captured-hydration contract used
    // by older regression fixtures; live production responses are JSON.
    const rows = apiRows.length > 0 ? apiRows : bodies.flatMap(({ body }) => String(body).includes("<script") ? parseBeinMenaGuide(body) : []);
    return rows.map((row) => ({
      competition: row.competition,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      startUtcEpochSeconds: row.startUtcEpochSeconds,
      broadcasts: row.channels.flatMap((channelName) => row.broadcastsFor().map((broadcast) => ({
        ...broadcast,
        channelName,
        aliases: Object.entries(aliasesByChannel).find(([name]) => canonicalChannelIdentity(name) === canonicalChannelIdentity(channelName))?.[1] ?? [],
        sourceType: "official-broadcaster-schedule",
        sourceUrl: row.sourceUrl ?? BEIN_MENA_API_URL,
        verifiedAt,
        destinationType: "linear",
        matchingMethod: row.matchingMethod
      })))
    }));
  }
};
