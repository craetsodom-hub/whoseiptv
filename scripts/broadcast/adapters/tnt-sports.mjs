import { parseRows, scheduleAdapter } from "./common.mjs";

export const TNT_SPORTS_URL = "https://www.tntsports.co.uk/football/premier-league/calendar-results.shtml";
const DESTINATION = /^(?:TNT Sports|HBO Max)$/i;

export function parseTntSportsSchedule(html) {
  return parseRows(html, { channelKeys: ["channels", "services", "broadcasters"], channelPattern: DESTINATION, competitionFallback: "Premier League", sourceTimeKeys: ["kickoff", "kickoffTime", "startDate"] })
    .map((row) => ({
      ...row,
      broadcastsFor: (channel) => [{ territory: "GB", rightsHolder: "TNT Sports", destinationType: /^HBO Max$/i.test(channel) ? "service" : "linear", destinationPrecision: /^TNT Sports$/i.test(channel) ? "network" : "channel" }]
    }));
}

// Kept unregistered until the production page's hydration contract is captured.
export const tntSportsAdapter = scheduleAdapter({ id: "tnt-sports-uk", url: TNT_SPORTS_URL, parse: parseTntSportsSchedule });
