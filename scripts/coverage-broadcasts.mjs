import { readFile } from "node:fs/promises";
import { isSupportedTerritory, territoryKind } from "./territories.mjs";

const feed = JSON.parse(await readFile(new URL("../feed/events/v1/events.json", import.meta.url), "utf8"));
const events = Array.isArray(feed.events) ? feed.events : [];
const assignments = events.flatMap((event) => (event.broadcasts ?? []).map((broadcast) => ({ event, broadcast })));
const isService = ({ broadcast }) => broadcast.destinationType === "service" ||
  /DAZN|Disney\+|iPlayer|Paramount\+|ESPN\+|Peacock|Prime Video|Apple TV|Sky Go|Movistar Plus\+|online|stream/i.test(broadcast.channelName);
const isOfficial = ({ broadcast }) => broadcast.sourceType?.startsWith("official-");
const officialLinear = assignments.filter((item) => isOfficial(item) && !isService(item));
const sourceEventLinear = assignments.filter((item) => item.broadcast.sourceType === "source-event" && !isService(item));
const officialServices = assignments.filter((item) => isOfficial(item) && isService(item));
const sourceEventServices = assignments.filter((item) => item.broadcast.sourceType === "source-event" && isService(item));
const rightsOnly = events.filter((event) => (event.broadcastRights?.length ?? 0) > 0 && (event.broadcasts?.length ?? 0) === 0);
const unresolved = events.filter((event) => (event.broadcasts?.length ?? 0) === 0 && (event.broadcastRights?.length ?? 0) === 0);

function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "invalid-url"; }
}

function printGroups(items) {
  const groups = new Map();
  for (const { event, broadcast } of items) {
    const key = [broadcast.sourceType, domain(broadcast.sourceUrl), event.competition ?? "(none)", broadcast.territory, broadcast.channelName].join(" | ");
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...groups].sort(([left], [right]) => left.localeCompare(right))) console.log(`${key} | ${count}`);
}

const invalid = assignments.filter(({ broadcast }) => !isSupportedTerritory(broadcast.territory));
const supportedTerritories = [...new Set(assignments.filter(({ broadcast }) => isSupportedTerritory(broadcast.territory)).map(({ broadcast }) => broadcast.territory))].sort();
const anomalies = [];
for (const event of events) {
  const pairs = new Set();
  for (const broadcast of event.broadcasts ?? []) {
    const pair = `${broadcast.territory}|${broadcast.channelName.toLocaleLowerCase("en-US")}`;
    if (pairs.has(pair)) anomalies.push(`${event.id}: duplicate territory/channel ${pair}`);
    pairs.add(pair);
    const aliases = broadcast.aliases ?? [];
    if (new Set(aliases).size !== aliases.length) anomalies.push(`${event.id}: duplicate alias on ${broadcast.channelName}`);
    const channelNumber = broadcast.channelName.match(/(?:^|\s)(\d+)$/)?.[1];
    if (channelNumber && aliases.some((alias) => {
      const aliasNumber = alias.match(/(?:^|\s)(\d+)$/)?.[1];
      return aliasNumber && aliasNumber !== channelNumber;
    })) anomalies.push(`${event.id}: numbered channel alias crosses identity for ${broadcast.channelName}`);
  }
}
console.log(`OFFICIAL exact linear: ${officialLinear.length}`);
console.log(`SOURCE-EVENT exact linear: ${sourceEventLinear.length}`);
console.log(`OFFICIAL exact services: ${officialServices.length}`);
console.log(`SOURCE-EVENT exact services: ${sourceEventServices.length}`);
console.log(`Rights-only events: ${rightsOnly.length}`);
console.log(`Unresolved events: ${unresolved.length}`);
console.log(`Current supported territories: ${supportedTerritories.length} (${supportedTerritories.map((code) => `${code}:${territoryKind(code)}`).join(", ")})`);
console.log(`Invalid/legacy territories: ${invalid.length}`);
console.log(`Sanity anomalies: ${anomalies.length}`);
for (const anomaly of anomalies) console.log(`ANOMALY | ${anomaly}`);
console.log("\nsourceType | source domain | competition | territory | channel | assignments");
printGroups(assignments);

if (officialLinear.length === 0) throw new Error("OFFICIAL exact linear must be greater than zero");
if (invalid.length > 0) throw new Error(`Invalid/legacy territories emitted: ${[...new Set(invalid.map(({ broadcast }) => broadcast.territory))].join(", ")}`);
if (anomalies.length > 0) throw new Error("Generated feed sanity audit failed");
if (assignments.some(({ broadcast }) => !broadcast.sourceType || !broadcast.sourceUrl || !broadcast.matchingMethod)) {
  throw new Error("Every broadcaster assignment must carry provenance");
}
