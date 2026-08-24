import { readFile } from "node:fs/promises";
import { isSupportedTerritory, territoryKind } from "./territories.mjs";
import { canonicalChannelIdentity } from "./broadcast/normalize.mjs";
import { footballCoverageSummary } from "./broadcast/coverage.mjs";

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
const uniqueOfficialChannels = new Set([...officialLinear, ...officialServices].map(({ broadcast }) => canonicalChannelIdentity(broadcast.channelName)));
const footballSummary = footballCoverageSummary(events);

const invalid = assignments.filter(({ broadcast }) => !isSupportedTerritory(broadcast.territory));
const supportedTerritories = [...new Set(assignments.filter(({ broadcast }) => isSupportedTerritory(broadcast.territory)).map(({ broadcast }) => broadcast.territory))].sort();
const officialExactTerritories = [...new Set(assignments.filter(isOfficial).map(({ broadcast }) => broadcast.territory))].sort();
const rightsTerritories = [...new Set(events.flatMap((event) => event.broadcastRights ?? []).map((right) => right.territory).filter(isSupportedTerritory))].sort();
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
console.log(`Football events: ${footballSummary.total}`);
console.log(`Football events with exact channels: ${footballSummary.exactChannels}`);
console.log(`Football events with official destination: ${footballSummary.officialDestinations}`);
console.log(`Football fallback-only events: ${footballSummary.fallbackOnly}`);
console.log(`Football rights-only events: ${footballSummary.rightsOnly}`);
console.log(`Football unresolved events: ${footballSummary.unresolved}`);
console.log("\nPer-football-fixture coverage (A exact channel, B all-event service, C source fallback, D rights only, E no evidence)");
for (const { event, coverage } of footballSummary.football) {
  console.log(`EVENT ${coverage.level} | ${event.competition ?? "(none)"} | ${event.title}`);
  console.log(`  exact channels: ${coverage.exactLabels.length ? coverage.exactLabels.join(" ; ") : "none"}`);
  console.log(`  all-event services: ${coverage.allEventLabels.length ? coverage.allEventLabels.join(" ; ") : "none"}`);
  console.log(`  source-event fallback: ${coverage.fallbackLabels.length ? coverage.fallbackLabels.join(" ; ") : "none"}`);
  console.log(`  rights without usable destination: ${coverage.rightsLabels.length ? coverage.rightsLabels.join(" ; ") : "none"}`);
  console.log(`  unsupported territories: ${coverage.unsupportedTerritories.length ? coverage.unsupportedTerritories.join(" ; ") : "none"}`);
}
console.log(`Current supported territories: ${supportedTerritories.length} (${supportedTerritories.map((code) => `${code}:${territoryKind(code)}`).join(", ")})`);
console.log(`Official exact coverage territories: ${officialExactTerritories.length} (${officialExactTerritories.join(", ")})`);
console.log(`Unique official exact channels: ${uniqueOfficialChannels.size}`);
console.log(`Rights metadata territories: ${rightsTerritories.length} (${rightsTerritories.join(", ")})`);
console.log(`Invalid/legacy territories: ${invalid.length}`);
console.log(`Sanity anomalies: ${anomalies.length}`);
for (const anomaly of anomalies) console.log(`ANOMALY | ${anomaly}`);
if (officialLinear.length === 0) throw new Error("OFFICIAL exact linear must be greater than zero");
if (invalid.length > 0) throw new Error(`Invalid/legacy territories emitted: ${[...new Set(invalid.map(({ broadcast }) => broadcast.territory))].join(", ")}`);
if (anomalies.length > 0) throw new Error("Generated feed sanity audit failed");
if (assignments.some(({ broadcast }) => !broadcast.sourceType || !broadcast.sourceUrl || !broadcast.matchingMethod)) {
  throw new Error("Every broadcaster assignment must carry provenance");
}
