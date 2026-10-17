import { canonicalChannelIdentity } from "./normalize.mjs";
import { broadcastTerritories } from "./resolver.mjs";

const PARSER_TYPES = new Set(["structured-json", "json-ld", "embedded-page-state", "semantic-html", "semantic-table", "first-party-json-api", "embedded-json"]);
const EXACT_SOURCE_TYPES = new Set(["official-event", "official-broadcaster-schedule"]);

function trustedUrl(url, hosts) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && hosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function validateOfficialSourceAdapter(adapter) {
  if (!adapter?.id || typeof adapter.collect !== "function" || !Array.isArray(adapter.trustedHosts) || adapter.trustedHosts.length === 0 ||
      !Array.isArray(adapter.parserTypes) || adapter.parserTypes.length === 0 || adapter.parserTypes.some((type) => !PARSER_TYPES.has(type))) {
    throw new Error("Invalid official source adapter contract");
  }
  if (adapter.sourceUrl && !trustedUrl(adapter.sourceUrl, adapter.trustedHosts)) throw new Error(`Untrusted source URL for ${adapter.id}`);
  if (adapter.appliesTo !== undefined && typeof adapter.appliesTo !== "function") throw new Error(`Invalid applicability contract for ${adapter.id}`);
  return true;
}

export async function discoverOfficialDestinations(adapters, context) {
  adapters.forEach(validateOfficialSourceAdapter);
  const settled = await Promise.allSettled(adapters.map((adapter) => adapter.collect(context)));
  const attempts = settled.map((result, index) => ({
    id: adapters[index].id,
    sourceUrl: adapters[index].sourceUrl,
    parserTypes: adapters[index].parserTypes,
    success: result.status === "fulfilled",
    candidates: result.status === "fulfilled" ? result.value.length : 0,
    ...(result.status === "rejected" ? { failure: String(result.reason?.message ?? result.reason).slice(0, 240) } : {})
  }));
  return {
    candidates: settled.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    attempts
  };
}

function exactDestination(item) {
  return item?.confirmed === true && EXACT_SOURCE_TYPES.has(item.sourceType) &&
    (item.destinationPrecision ?? "channel") === "channel" && item.destinationVerified !== false;
}

function sourceApplies(adapter, event, territory) {
  return typeof adapter.appliesTo !== "function" || adapter.appliesTo(event, territory);
}

export function buildDiscoveryCoverage(events, adapters, attempts) {
  const adapterById = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  const eventReports = events.flatMap((event) => {
    const knownTerritories = [...new Set([...(event.broadcastRights ?? []).map((right) => right.territory), ...event.broadcasts.flatMap(broadcastTerritories)])].sort();
    // A fixture without either rights or a destination is still a coverage
    // gap.  It is reported under `unknown` rather than silently disappearing.
    const territories = knownTerritories.length > 0 ? knownTerritories : ["unknown"];
    return territories.map((territory) => {
      const attempted = attempts.filter((attempt) => sourceApplies(adapterById.get(attempt.id), event, territory));
      const exact = (event.broadcasts ?? []).filter(exactDestination).filter((item) => broadcastTerritories(item).includes(territory));
      const rights = (event.broadcastRights ?? []).filter((right) => right.territory === territory);
      const rejected = exact.length > 0 ? null : rights.length > 0
        ? "Rights-holder information exists but no verified event-level channel destination was found."
        : attempted.some((attempt) => !attempt.success)
          ? "A permitted official source failed; no event-level destination was emitted."
          : "No permitted official source returned a verified event-level destination.";
      return {
        eventId: event.id,
        sport: event.sport,
        competition: event.competition ?? null,
        territory,
        sourcesAttempted: attempted,
        exactDestinations: exact.map((item) => ({ channelName: item.channelName, normalizedName: canonicalChannelIdentity(item.channelName), sourceUrl: item.sourceUrl })),
        rightsWithoutEventDestination: exact.length === 0 ? rights.map((right) => right.holders.map((holder) => holder.name)) : [],
        rejectionReason: rejected
      };
    });
  });
  const dimensions = ["sport", "competition", "territory", "sourceAdapter"];
  const summaries = {};
  for (const dimension of dimensions) {
    const groups = new Map();
    const items = dimension === "sourceAdapter"
      ? attempts.map((attempt) => ({ key: attempt.id, covered: attempt.success && attempt.candidates > 0, attempted: true }))
      : eventReports.map((report) => ({ key: String(report[dimension] ?? "unknown"), covered: report.exactDestinations.length > 0, attempted: report.sourcesAttempted.length > 0 }));
    for (const item of items) groups.set(item.key, [...(groups.get(item.key) ?? []), item]);
    summaries[dimension] = [...groups.entries()].map(([key, grouped]) => ({
      [dimension]: key,
      total: grouped.length,
      attempted: grouped.filter((item) => item.attempted).length,
      exactCovered: grouped.filter((item) => item.covered).length,
      coveragePercentage: grouped.length ? Number((grouped.filter((item) => item.covered).length / grouped.length * 100).toFixed(1)) : 0
    })).sort((left, right) => String(left[dimension]).localeCompare(String(right[dimension])));
  }
  return { generatedAt: new Date().toISOString(), adapters: attempts, events: eventReports, summaries };
}
