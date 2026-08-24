import { parseRows, scheduleAdapter } from "./common.mjs";

export const PREMIER_LEAGUE_URL = "https://www.premierleague.com/en/fixtures";
const NETWORK = /^(?:Sky Sports|TNT Sports)$/i;

export function parsePremierLeagueSelections(html) {
  return parseRows(html, { channelKeys: ["broadcasters", "broadcaster", "tv"], channelPattern: NETWORK, competitionFallback: "Premier League", sourceTimeKeys: ["kickoff", "kickoffTime", "startDate"] })
    .map((row) => ({
      ...row,
      sourceType: "official-network-selection",
      broadcastsFor: (channel) => [{ territory: "GB", rightsHolder: channel, destinationPrecision: "network" }]
    }));
}

export const premierLeagueAdapter = scheduleAdapter({ id: "premier-league-selections", url: PREMIER_LEAGUE_URL, parse: parsePremierLeagueSelections });
