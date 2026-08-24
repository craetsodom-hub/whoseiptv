import { broadcastScopeKey, broadcastTerritories } from "./resolver.mjs";

const EXACT_SOURCE_TYPES = new Set([
  "official-event",
  "official-broadcaster-schedule",
  "official-network-selection"
]);
const AUTHORITATIVE_SOURCE_CHECKS = [
  { competitions: /premier league/i, provider: "Sky Sports UK", source: "https://www.skysports.com/watch/football-on-sky/competitions/premier-league" },
  { competitions: /premier league/i, provider: "Premier League selections", source: "https://www.premierleague.com/en/fixtures" },
  { competitions: /la ?liga|spanish la liga/i, provider: "LaLiga Spain", source: "https://www.laliga.com/laliga-easports/resultados" },
  { competitions: /^UEFA Champions League$/i, provider: "Movistar Plus+ Spain", source: "https://www.movistarplus.es/programacion-tv" },
  { competitions: /ligue 1/i, provider: "Ligue 1 official match API", source: "https://ma-api.ligue1.fr/championship-match/" },
  { competitions: /bundesliga/i, provider: "Bundesliga official schedule", source: "https://www.bundesliga.com/en/bundesliga/matchday" },
  { competitions: /major league soccer|\bmls\b|leagues cup/i, provider: "MLS match API", source: "https://sportapi.mlssoccer.com/api/matches/bySportecIds/" }
];

function investigation(event) {
  const checks = AUTHORITATIVE_SOURCE_CHECKS.filter((item) => item.competitions.test(event.competition ?? ""));
  if ((event.broadcastRights ?? []).some((right) => right.holders.some((holder) => /^beIN Sports$/i.test(holder.name)))) {
    checks.push({ provider: "beIN MENA EPG", source: "https://www.beinsports.com/api/opta/tv-event?region=en-mena" });
  }
  const providers = [...new Set(checks.map((item) => item.provider))];
  const sources = [...new Set(checks.map((item) => item.source))];
  return {
    providers,
    sources,
    reason: providers.length > 0
      ? "No checked authoritative source produced an exact fixture destination or an explicit all-match entitlement."
      : "No registered authoritative source contract currently covers this competition."
  };
}

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
    rightsLabels: groupedRightLabels(rightsWithoutDestination),
    investigation: investigation(event)
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
