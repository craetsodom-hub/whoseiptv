import { parseRows, scheduleAdapter } from "./common.mjs";

export const BUNDESLIGA_URL = "https://www.bundesliga.com/en/bundesliga/matchday";
const ACTIVE = /^(?:Sky Deutschland|DAZN|WOW)$/i;

export function parseBundesligaSchedule(html) {
  return parseRows(html, { channelKeys: ["activeBroadcasters", "activeBroadcaster"], channelPattern: ACTIVE, competitionFallback: "Bundesliga" })
    .map((row) => ({ ...row, broadcastsFor: () => [{ territory: "DE" }] }));
}

export const bundesligaAdapter = scheduleAdapter({ id: "bundesliga-active", url: BUNDESLIGA_URL, parse: parseBundesligaSchedule });
