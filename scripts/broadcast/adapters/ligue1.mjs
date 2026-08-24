import { parseRows, scheduleAdapter } from "./common.mjs";

export const LIGUE1_URL = "https://ligue1.com/en/fixtures-results";
const CHANNEL = /^Ligue 1\+ (?:[2-9]|\d{2})$/i;

export function parseLigue1Schedule(html) {
  return parseRows(html, { channelKeys: ["channels", "channel", "broadcasters"], channelPattern: CHANNEL, competitionFallback: "Ligue 1" })
    .map((row) => ({ ...row, broadcastsFor: () => [{ territory: "FR", rightsHolder: "Ligue 1+" }] }));
}

export const ligue1Adapter = scheduleAdapter({ id: "ligue1-france", url: LIGUE1_URL, parse: parseLigue1Schedule });
