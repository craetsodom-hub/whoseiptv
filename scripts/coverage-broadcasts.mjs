import { readFile } from "node:fs/promises";
import { isSupportedTerritory, territoryKind } from "./territories.mjs";
import { canonicalChannelIdentity } from "./broadcast/normalize.mjs";

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
const rightsOnly = events.filter((event) => (event.broadcastRights?.length ?? 0) > 0 && (event.broadcasts?.length ?? 0) === 0);
const unresolved = events.filter((event) => (event.broadcasts?.length ?? 0) === 0 && (event.broadcastRights?.length ?? 0) === 0);
const footballEvents = events.filter((event) => event.sport === "football");

function eventCoverage(event) {
  const broadcasts = event.broadcasts ?? [];
  if (broadcasts.some((broadcast) => broadcast.sourceType?.startsWith("official-"))) return "official";
  if (broadcasts.some((broadcast) => broadcast.sourceType === "source-event")) return "source-event-only";
  if ((event.broadcastRights?.length ?? 0) > 0) return "rights-only";
  return "no-evidence";
}

function coverageCounts(items) {
  const counts = { total: items.length, official: 0, sourceEventOnly: 0, rightsOnly: 0, noEvidence: 0 };
  for (const item of items) {
    const coverage = eventCoverage(item);
    if (coverage === "official") counts.official += 1;
    else if (coverage === "source-event-only") counts.sourceEventOnly += 1;
    else if (coverage === "rights-only") counts.rightsOnly += 1;
    else counts.noEvidence += 1;
  }
  return counts;
}

function printEventCoverage(label, items) {
  const counts = coverageCounts(items);
  const percentage = counts.total === 0 ? "0.0" : ((counts.official / counts.total) * 100).toFixed(1);
  console.log(`${label}: ${counts.total}`);
  console.log(`Unique officially resolved events: ${counts.official}`);
  console.log(`Official exact-event %: ${percentage}%`);
  console.log(`Source-event-only: ${counts.sourceEventOnly}`);
  console.log(`Rights-only: ${counts.rightsOnly}`);
  console.log(`No broadcaster evidence: ${counts.noEvidence}`);
}

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
console.log(`Rights-only events: ${rightsOnly.length}`);
console.log(`Unresolved events: ${unresolved.length}`);
printEventCoverage("Total football events", footballEvents);
console.log("Football event coverage by competition");
for (const competition of [...new Set(footballEvents.map((event) => event.competition ?? "(none)"))].sort()) {
  const counts = coverageCounts(footballEvents.filter((event) => (event.competition ?? "(none)") === competition));
  const percentage = counts.total === 0 ? "0.0" : ((counts.official / counts.total) * 100).toFixed(1);
  console.log(`${competition} | total ${counts.total} | official ${counts.official} (${percentage}%) | source-event-only ${counts.sourceEventOnly} | rights-only ${counts.rightsOnly} | no-evidence ${counts.noEvidence} | unresolved ${counts.rightsOnly + counts.noEvidence}`);
}
console.log(`Current supported territories: ${supportedTerritories.length} (${supportedTerritories.map((code) => `${code}:${territoryKind(code)}`).join(", ")})`);
console.log(`Official exact coverage territories: ${officialExactTerritories.length} (${officialExactTerritories.join(", ")})`);
console.log(`Unique official exact channels: ${uniqueOfficialChannels.size}`);
console.log(`Rights metadata territories: ${rightsTerritories.length} (${rightsTerritories.join(", ")})`);
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
