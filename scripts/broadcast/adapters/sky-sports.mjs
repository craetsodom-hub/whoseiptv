import { decodeHtml, headingTeamPair, parseRows, scheduleAdapter, semanticBlocks, semanticKickoff, timestamp } from "./common.mjs";
import { parseSkyFixtureSchedule } from '../sky-fixtures.mjs';

export const SKY_SPORTS_URL = "https://www.skysports.com/watch/football-on-sky/competitions/premier-league";
const CHANNEL = /^Sky Sports(?: Main Event| Premier League|\+)$/i;

export function parseSkySemanticHtml(html) {
  return semanticBlocks(html, ["article", "li"]).map((block) => {
    const teams = headingTeamPair(block);
    const startUtcEpochSeconds = timestamp(semanticKickoff(block));
    const text = decodeHtml(block);
    const channels = [...new Set([...text.matchAll(/Sky Sports(?: Main Event| Premier League|\+)/gi)].map((match) => match[0]))];
    if (!teams || !startUtcEpochSeconds || channels.length === 0) return null;
    return { ...teams, competition: "Premier League", startUtcEpochSeconds, channels };
  }).filter(Boolean);
}

export function parseSkySportsSchedule(html) {
  const rows = [...parseRows(html, { channelKeys: ["channels", "channelNames", "broadcasters"], channelPattern: CHANNEL, competitionFallback: "Premier League", sourceTimeKeys: ["kickoff", "kickoffTime"] }), ...parseSkySemanticHtml(html)];
  return rows.filter((row, index, all) => all.findIndex((item) => item.homeTeam === row.homeTeam && item.awayTeam === row.awayTeam && item.startUtcEpochSeconds === row.startUtcEpochSeconds && item.channels.join("|") === row.channels.join("|")) === index)
    .map((row) => ({ ...row, broadcastsFor: () => [{ territory: "GB", rightsHolder: "Sky Sports", languages: [] }] }));
}

export const skySportsAdapter = scheduleAdapter({ id: "sky-sports-uk", url: SKY_SPORTS_URL, parse: parseSkySportsSchedule });
const collectStructuredSchedule = skySportsAdapter.collect;
skySportsAdapter.collect = async context => {
  const html = await context.fetchText(SKY_SPORTS_URL);
  if (!/class=["'][^"']*\bevent-group\b/i.test(html)) {
    return collectStructuredSchedule({ ...context, fetchText: async () => html });
  }
  return parseSkyFixtureSchedule(html, context.aliasesByChannel, new Date(context.verifiedAt ?? Date.now())).map(candidate => ({
    ...candidate,
    broadcasts: candidate.broadcasts.map(broadcast => ({ ...broadcast, verifiedAt: context.verifiedAt, checkedAt: context.verifiedAt }))
  }));
};
skySportsAdapter.contractStatus = "semantic-html-verified";
skySportsAdapter.parserTypes = ["embedded-page-state", "json-ld", "semantic-html"];
