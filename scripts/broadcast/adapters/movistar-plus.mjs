import { decodeHtml } from "./common.mjs";

const CHANNEL_SLUGS = ["chapio", "chap1", "chap2", "chap3", "chap4"];
const BASE_URL = "https://www.movistarplus.es/programacion-tv";

function madridEpoch(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const milliseconds = Date.parse(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", timeZoneName: "longOffset" }).formatToParts(new Date(milliseconds));
  const offset = parts.find((part) => part.type === "timeZoneName")?.value.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!offset) return null;
  const seconds = (Number(offset[2]) * 60 + Number(offset[3])) * 60 * (offset[1] === "+" ? 1 : -1);
  return Math.floor(milliseconds / 1000) - seconds;
}

function scheduleDate(sourceUrl) {
  return new URL(sourceUrl).pathname.match(/\/programacion-tv\/[^/]+\/(\d{4}-\d{2}-\d{2})$/)?.[1] ?? null;
}

function channelName(html) {
  return decodeHtml(html.match(/<li\s+class="active"[\s\S]*?<img[^>]+title="([^"]+)"/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
}

export function parseMovistarChampionsSchedule(html, sourceUrl) {
  const date = scheduleDate(sourceUrl);
  const channel = channelName(html);
  if (!date || !channel) return [];
  const rows = [...html.matchAll(/<li\s+class="title">([\s\S]*?)<\/li>[\s\S]{0,500}?<li\s+class="time">\s*(\d{2}:\d{2})\s*<\/li>/gi)].flatMap((match) => {
    const title = decodeHtml(match[1]).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const fixture = title.match(/^UEFA Champions League(?:\s*\([^)]*\))?\s*:\s*(.+?)\s+-\s+(.+)$/i);
    const startUtcEpochSeconds = madridEpoch(date, match[2]);
    if (!fixture || !startUtcEpochSeconds) return [];
    return [{
      competition: "UEFA Champions League",
      homeTeam: fixture[1].trim(),
      awayTeam: fixture[2].trim(),
      startUtcEpochSeconds,
      channelName: channel,
      sourceUrl
    }];
  });
  return rows.filter((row, index, all) => all.findIndex((item) => item.homeTeam === row.homeTeam &&
    item.awayTeam === row.awayTeam && item.startUtcEpochSeconds === row.startUtcEpochSeconds && item.channelName === row.channelName) === index);
}

function datesForEvents(events) {
  const dates = new Set();
  for (const event of events ?? []) {
    if (event.competition !== "UEFA Champions League" || !Number.isInteger(event.startUtcEpochSeconds)) continue;
    for (const offset of [-1, 0, 1]) {
      const date = new Date((event.startUtcEpochSeconds + offset * 86_400) * 1000).toISOString().slice(0, 10);
      dates.add(date);
    }
  }
  return [...dates].sort();
}

export const movistarChampionsAdapter = {
  id: "movistar-plus-champions-spain",
  contractStatus: "semantic-html-verified",
  parserTypes: ["semantic-html"],
  trustedHosts: ["www.movistarplus.es"],
  async collect({ events, fetchText, verifiedAt, aliasesByChannel = {} }) {
    const responses = await Promise.allSettled(datesForEvents(events).flatMap((date) => CHANNEL_SLUGS.map(async (slug) => {
      const sourceUrl = `${BASE_URL}/${slug}/${date}`;
      return { sourceUrl, html: await fetchText(sourceUrl) };
    })));
    const schedules = responses.filter((result) => result.status === "fulfilled").map((result) => result.value);
    const rows = schedules.flatMap(({ sourceUrl, html }) => parseMovistarChampionsSchedule(html, sourceUrl)).filter((row, index, all) =>
      all.findIndex((item) => item.homeTeam === row.homeTeam && item.awayTeam === row.awayTeam &&
        item.startUtcEpochSeconds === row.startUtcEpochSeconds && item.channelName === row.channelName) === index);
    return rows.map((row) => ({
      sport: "football",
      competition: row.competition,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      startUtcEpochSeconds: row.startUtcEpochSeconds,
      broadcasts: [{
        channelName: row.channelName,
        aliases: aliasesByChannel[row.channelName] ?? [],
        territory: "ES",
        sourceType: "official-event",
        sourceUrl: row.sourceUrl,
        verifiedAt,
        destinationType: "linear",
        matchingMethod: "movistar-epg-match-teams-coverage-time"
      }]
    }));
  }
};
