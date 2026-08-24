import { isSupportedTerritory } from "../territories.mjs";
import { normalizeBroadcastText } from "./normalize.mjs";
import { expandTerritories } from "./territory-regions.mjs";
import { mergeExactBroadcasts } from "./resolver.mjs";

function seasonless(value) {
  return normalizeBroadcastText(value).replace(/\s+(?:19|20)\d{2}(?:\s+(?:19|20)?\d{2})?$/, "");
}

function dateWithin(record, epochSeconds) {
  const date = new Date(epochSeconds * 1000).toISOString().slice(0, 10);
  return date >= record.validFrom && date <= record.validThrough;
}

function eventSeason(event) {
  if (event?.season) return String(event.season);
  const date = new Date(event.startUtcEpochSeconds * 1000);
  const year = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 6 ? year : year - 1;
  return `${start}/${String(start + 1).slice(-2)}`;
}

function allMatchesDestination(destination) {
  return destination?.allMatches === true && /^https:\/\//.test(destination?.allMatchesEvidenceUrl ?? "");
}

export function matchingRights(event, config) {
  const competition = config.competitions.find((item) => item.aliases.some((alias) => seasonless(alias) === seasonless(event.competition)));
  if (!competition) return [];
  const season = eventSeason(event);
  return competition.cycles.filter((cycle) => cycle.seasons.includes(season) && dateWithin(cycle, event.startUtcEpochSeconds))
    .flatMap((cycle) => cycle.coverage.flatMap((coverage) => expandTerritories(coverage).map((territory) => ({
      territory,
      holders: coverage.holders,
      sourceType: "official-rights",
      sourceUrl: cycle.sourceUrl,
      verifiedAt: cycle.lastVerified,
      validFrom: cycle.validFrom,
      validThrough: cycle.validThrough,
      season
    }))));
}

export function attachRightsMetadata(events, config) {
  for (const event of events) {
    const rights = matchingRights(event, config);
    if (rights.length > 0) event.broadcastRights = rights;
    else delete event.broadcastRights;
  }
  return events;
}

export function attachAllEventDestinations(events, config) {
  for (const event of events) {
    const competition = config.competitions.find((item) => item.aliases.some((alias) => seasonless(alias) === seasonless(event.competition)));
    if (!competition) continue;
    const season = eventSeason(event);
    const cycleDestinations = competition.cycles.filter((cycle) => cycle.seasons.includes(season) && dateWithin(cycle, event.startUtcEpochSeconds))
      .flatMap((cycle) => (cycle.allEventDestinations ?? []).filter(allMatchesDestination).map((destination) => ({
        ...destination,
        validFrom: cycle.validFrom,
        validThrough: cycle.validThrough,
        seasons: cycle.seasons
      })));
    const independentDestinations = (competition.allEventDestinations ?? []).filter((destination) => allMatchesDestination(destination) && destination.seasons.includes(season) && dateWithin(destination, event.startUtcEpochSeconds));
    const assignments = [...cycleDestinations, ...independentDestinations].map((destination) => ({
      channelName: destination.name,
      aliases: destination.aliases ?? [],
      territory: destination.territory,
      confirmed: true,
      sourceType: "official-all-events",
      sourceUrl: destination.allMatchesEvidenceUrl,
      verifiedAt: destination.lastVerified,
      destinationType: "service",
      destinationPrecision: "service",
      ruleType: "all-events"
    }));
    event.broadcasts = mergeExactBroadcasts(event.broadcasts ?? [], assignments);
  }
  return events;
}

export function validateRightsCatalog(config) {
  if (config?.version !== 3 || !Array.isArray(config.competitions) || config.competitions.length === 0) throw new Error("Broadcast rights catalog must be version 3");
  const ids = new Set();
  for (const competition of config.competitions) {
    if (!competition.id || ids.has(competition.id) || !Array.isArray(competition.aliases) || competition.aliases.length === 0 || !Array.isArray(competition.cycles) ||
        !/^https:\/\//.test(competition.exactEventSource ?? "") || competition.fallbackPolicy !== "rights-metadata-only" || !Number.isInteger(competition.updateFrequencyHours)) throw new Error("Invalid competition rights metadata");
    ids.add(competition.id);
    for (const destination of competition.allEventDestinations ?? []) {
      if (!Array.isArray(destination.seasons) || destination.seasons.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(destination.validFrom ?? "") ||
          !/^\d{4}-\d{2}-\d{2}$/.test(destination.validThrough ?? "") || destination.validFrom > destination.validThrough || !isSupportedTerritory(destination.territory) ||
          !String(destination.name ?? "").trim() || !/^https:\/\//.test(destination.sourceUrl ?? "") || !allMatchesDestination(destination) || !/^\d{4}-\d{2}-\d{2}$/.test(destination.lastVerified ?? "")) throw new Error(`Invalid independent all-event destination for ${competition.id}`);
    }
    for (const cycle of competition.cycles) {
      if (!/^https:\/\//.test(cycle.sourceUrl ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(cycle.lastVerified ?? "") ||
          !/^\d{4}-\d{2}-\d{2}$/.test(cycle.validFrom ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(cycle.validThrough ?? "") || cycle.validFrom > cycle.validThrough ||
          !Array.isArray(cycle.seasons) || cycle.seasons.length === 0 || !Array.isArray(cycle.coverage)) throw new Error(`Invalid rights cycle for ${competition.id}`);
      const territories = new Set();
      for (const coverage of cycle.coverage) {
        if (!Array.isArray(coverage.holders) || coverage.holders.length === 0 || coverage.holders.some((holder) => !String(holder?.name ?? "").trim())) throw new Error(`Invalid holder for ${competition.id}`);
        for (const territory of expandTerritories(coverage)) {
          if (territories.has(territory)) throw new Error(`Duplicate territory ${territory} for ${competition.id}`);
          territories.add(territory);
        }
      }
      for (const destination of cycle.allEventDestinations ?? []) {
        if (!isSupportedTerritory(destination?.territory) || !String(destination?.name ?? "").trim() || !/^https:\/\//.test(destination?.sourceUrl ?? "") || !allMatchesDestination(destination) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(destination?.lastVerified ?? "")) throw new Error(`Invalid all-event destination for ${competition.id}`);
      }
    }
  }
  return true;
}

export function coverageReport(config, events = [], allTerritories = [], atEpochSeconds = Math.floor(Date.now() / 1000)) {
  return config.competitions.map((competition) => {
    const rightsTerritories = new Set(competition.cycles.flatMap((cycle) => cycle.coverage.flatMap(expandTerritories)));
    const aliases = new Set(competition.aliases.map(seasonless));
    const broadcasts = events.filter((event) => aliases.has(seasonless(event.competition))).flatMap((event) => event.broadcasts ?? []);
    const official = broadcasts.filter((item) => ["official-event", "official-broadcaster-schedule", "official-all-events"].includes(item.sourceType));
    const exactLinearTerritories = new Set(official.filter((item) => item.destinationType !== "service").map((item) => item.territory));
    const guaranteedServiceTerritories = [...competition.cycles.filter((cycle) => dateWithin(cycle, atEpochSeconds))
      .flatMap((cycle) => cycle.allEventDestinations ?? []), ...(competition.allEventDestinations ?? []).filter((item) => dateWithin(item, atEpochSeconds))]
      .filter(allMatchesDestination).map((item) => item.territory);
    const exactServiceTerritories = new Set([...official.filter((item) => item.destinationType === "service").map((item) => item.territory), ...guaranteedServiceTerritories]);
    const exactTerritories = new Set([...exactLinearTerritories, ...exactServiceTerritories]);
    const sourceEventTerritories = new Set(broadcasts.filter((item) => !item.sourceType || item.sourceType === "source-event").map((item) => item.territory));
    return {
      id: competition.id,
      rightsTerritories: [...rightsTerritories].sort(),
      exactEventTerritories: [...exactTerritories].sort(),
      exactLinearTerritories: [...exactLinearTerritories].sort(),
      exactServiceTerritories: [...exactServiceTerritories].sort(),
      sourceEventTerritories: [...sourceEventTerritories].sort(),
      rightsOnlyTerritories: [...rightsTerritories].filter((item) => !exactTerritories.has(item)).sort(),
      unresolvedTerritories: allTerritories.filter((item) => !rightsTerritories.has(item)).sort()
    };
  });
}
