import { broadcastScopeKey, broadcastTerritories } from "./resolver.mjs";

const EXACT_SOURCE_TYPES = new Set([
  "official-event",
  "official-broadcaster-schedule",
  "official-network-selection"
]);

function groupedDestinationLabels(destinations) {
  const groups = new Map();
  for (const destination of destinations) {
    const key = `${broadcastScopeKey(destination)} / ${destination.channelName} / ${destination.sourceUrl}`;
    groups.set(key, [...new Set([...(groups.get(key) ?? []), ...broadcastTerritories(destination)])]);
  }
  return [...groups.entries()].map(([key, territories]) => {
    const destination = destinations.find((item) => `${broadcastScopeKey(item)} / ${item.channelName} / ${item.sourceUrl}` === key);
    const label = destination?.region ? `${destination.displayRegion} (${destination.region}; ${territories.sort().join(",")})` : territories.sort().join(",");
    return `${label} / ${destination.channelName} / ${destination.sourceUrl}`;
  });
}

function groupedRightLabels(rights) {
  const groups = new Map();
  for (const right of rights) {
    const key = `${right.holders.map((holder) => holder.name).join(", ")} / ${right.sourceUrl}`;
    groups.set(key, [...(groups.get(key) ?? []), right.territory]);
  }
  return [...groups.entries()].map(([key, territories]) => `${territories.sort().join(",")} / ${key}`);
}

export function classifyFootballEvent(event) {
  const broadcasts = event.broadcasts ?? [];
  const exactChannels = broadcasts.filter((item) => EXACT_SOURCE_TYPES.has(item.sourceType));
  const allEventServices = broadcasts.filter((item) => item.sourceType === "official-all-events");
  const sourceEventFallback = broadcasts.filter((item) => item.sourceType === "source-event");
  const officialTerritories = new Set([...exactChannels, ...allEventServices].flatMap(broadcastTerritories));
  const rightsWithoutDestination = (event.broadcastRights ?? []).filter((item) => !officialTerritories.has(item.territory));
  let level = "E";
  if (exactChannels.length > 0) level = "A";
  else if (allEventServices.length > 0) level = "B";
  else if (sourceEventFallback.length > 0) level = "C";
  else if ((event.broadcastRights?.length ?? 0) > 0) level = "D";
  return {
    level,
    exactChannels,
    allEventServices,
    sourceEventFallback,
    rightsWithoutDestination,
    unsupportedTerritories: (event.broadcastRights?.length ?? 0) === 0
      ? ["No current competition rights catalog entry or registered first-party resolver"]
      : [],
    exactLabels: groupedDestinationLabels(exactChannels),
    allEventLabels: groupedDestinationLabels(allEventServices),
    fallbackLabels: groupedDestinationLabels(sourceEventFallback),
    rightsLabels: groupedRightLabels(rightsWithoutDestination)
  };
}

export function footballCoverageSummary(events) {
  const football = events.filter((event) => event.sport === "football");
  const classified = football.map((event) => ({ event, coverage: classifyFootballEvent(event) }));
  return {
    football: classified,
    total: classified.length,
    exactChannels: classified.filter(({ coverage }) => coverage.exactChannels.length > 0).length,
    officialDestinations: classified.filter(({ coverage }) => coverage.exactChannels.length > 0 || coverage.allEventServices.length > 0).length,
    fallbackOnly: classified.filter(({ coverage }) => coverage.level === "C").length,
    rightsOnly: classified.filter(({ coverage }) => coverage.level === "D").length,
    unresolved: classified.filter(({ coverage }) => coverage.level === "E").length
  };
}
