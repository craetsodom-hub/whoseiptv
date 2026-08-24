import { TERRITORY_REGIONS } from "../territory-regions.mjs";
import { embeddedJson, exactRow, objectsWithin, parseRows, scheduleAdapter, stringValue } from "./common.mjs";

export const BEIN_MENA_URL = "https://www.beinsports.com/en-mena/tv-guide";
const CHANNEL = /^beIN(?: SPORTS)? (?:[1-9]|4K|XTRA(?: \d+)?)$/i;

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
  return rows.map((row) => ({ ...row, channels: row.channels.map((name) => name.replace(/\s+/g, " ").trim()), broadcastsFor: () => [{ region: "MENA", rightsHolder: "beIN Sports", regionTerritories: TERRITORY_REGIONS.MENA }] }));
}

export const beinMenaAdapter = scheduleAdapter({ id: "bein-mena", url: BEIN_MENA_URL, parse: parseBeinMenaGuide });
