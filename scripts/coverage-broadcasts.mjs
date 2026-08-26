import { readFile } from "node:fs/promises";
import { isSupportedTerritory, territoryKind } from "./territories.mjs";
import { canonicalChannelIdentity } from "./broadcast/normalize.mjs";
import { broadcastScopeKey, broadcastTerritories } from "./broadcast/resolver.mjs";
import { footballCoverageSummary } from "./broadcast/coverage.mjs";
import { eventIdentityEvidence } from "./broadcast/identity.mjs";

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
const topTierPattern = /^(?:Premier League|English Premier League|UEFA Champions League|UEFA Europa League|UEFA Conference League|LaLiga|LALIGA EA SPORTS|Spanish La Liga|Italian Serie A|Bundesliga|Ligue 1)$/i;

const invalid = assignments.filter(({ broadcast }) => broadcastTerritories(broadcast).length === 0);
const supportedTerritories = [...new Set(assignments.flatMap(({ broadcast }) => broadcastTerritories(broadcast)))].sort();
const officialExactTerritories = [...new Set(assignments.filter(isOfficial).flatMap(({ broadcast }) => broadcastTerritories(broadcast)))].sort();
const rightsTerritories = [...new Set(events.flatMap((event) => event.broadcastRights ?? []).map((right) => right.territory).filter(isSupportedTerritory))].sort();
const anomalies = [];
for (const event of events) {
  if (/^(?:TBC|TBD|To Be (?:Confirmed|Determined))(?:\s|$)/i.test(event.homeTeam?.name ?? "") ||
      /^(?:TBC|TBD|To Be (?:Confirmed|Determined))(?:\s|$)/i.test(event.awayTeam?.name ?? "")) {
    anomalies.push(`${event.id}: placeholder participant published as confirmed`);
  }
  const pairs = new Set();
  for (const broadcast of event.broadcasts ?? []) {
    const pair = `${broadcastScopeKey(broadcast)}|${broadcast.channelName.toLocaleLowerCase("en-US")}`;
    if (pairs.has(pair)) anomalies.push(`${event.id}: duplicate territory/channel ${pair}`);
    pairs.add(pair);
    const aliases = broadcast.aliases ?? [];
    if (new Set(aliases).size !== aliases.length) anomalies.push(`${event.id}: duplicate alias on ${broadcast.channelName}`);
    const channelNumber = broadcast.channelName.match(/(?:^|\s)(\d+)$/)?.[1];
    if (channelNumber && aliases.some((alias) => {
      const aliasNumber = alias.match(/(?:^|\s)(\d+)$/)?.[1];
      return aliasNumber && aliasNumber !== channelNumber;
    })) anomalies.push(`${event.id}: numbered channel alias crosses identity for ${broadcast.channelName}`);
    if (event.sport === "football" && ["official-broadcaster-schedule", "official-network-selection"].includes(broadcast.sourceType) && broadcast.destinationVerified !== true) {
      anomalies.push(`${event.id}: unverified schedule destination ${broadcast.channelName}`);
    }
  }
}
for (let left = 0; left < events.length; left += 1) {
  for (let right = left + 1; right < events.length; right += 1) {
    if (eventIdentityEvidence(events[left], events[right])) {
      anomalies.push(`${events[left].id}/${events[right].id}: duplicate semantic fixture`);
    }
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
  console.log(`  provider families investigated: ${coverage.investigation.providers.length ? coverage.investigation.providers.join(", ") : "none"}`);
  console.log(`  authoritative sources checked: ${coverage.investigation.sources.length ? coverage.investigation.sources.join(" ; ") : "none"}`);
}
const topTierGaps = footballSummary.football.filter(({ event, coverage }) => topTierPattern.test(event.competition ?? "") &&
  coverage.exactChannels.length === 0 && coverage.allEventServices.length === 0);
console.log(`Top-tier fixtures without official destination: ${topTierGaps.length}`);
for (const { event, coverage } of topTierGaps) {
  console.log(`TOP-TIER GAP | ${event.competition ?? "(none)"} | ${event.title} | ${coverage.investigation.reason}`);
}
console.log(`Current supported territories: ${supportedTerritories.length} (${supportedTerritories.map((code) => `${code}:${territoryKind(code)}`).join(", ")})`);
console.log(`Official exact coverage territories: ${officialExactTerritories.length} (${officialExactTerritories.join(", ")})`);
console.log(`Unique official exact channels: ${uniqueOfficialChannels.size}`);
console.log(`Rights metadata territories: ${rightsTerritories.length} (${rightsTerritories.join(", ")})`);
console.log(`Invalid/legacy territories: ${invalid.length}`);
console.log(`Sanity anomalies: ${anomalies.length}`);
for (const anomaly of anomalies) console.log(`ANOMALY | ${anomaly}`);
if (officialLinear.length === 0) throw new Error("OFFICIAL exact linear must be greater than zero");
if (invalid.length > 0) throw new Error("Invalid or empty broadcaster territory scope emitted");
if (anomalies.length > 0) throw new Error("Generated feed sanity audit failed");
if (assignments.some(({ broadcast }) => !broadcast.sourceType || !broadcast.sourceUrl || !broadcast.matchingMethod)) {
  throw new Error("Every broadcaster assignment must carry provenance");
}
