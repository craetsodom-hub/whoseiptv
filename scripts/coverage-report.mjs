const topTier = /^(?:Premier League|English Premier League|UEFA Champions League|UEFA Europa League|UEFA Conference League|LaLiga|LALIGA EA SPORTS|Spanish La Liga|Italian Serie A|Bundesliga|Ligue 1)$/i;

function isExactChannel(broadcast) {
  return broadcast?.destinationPrecision === "channel" ||
    ["official-broadcaster-schedule", "official-network-selection", "source-event"].includes(broadcast?.sourceType);
}

export function createCoverageReport(feed, sourceAttempts, generatedAtEpochSeconds) {
  const football = feed.events.filter((event) => event.sport === "football");
  const withExact = football.filter((event) => event.broadcasts.some(isExactChannel));
  const withOfficial = football.filter((event) => event.broadcasts.some((broadcast) => broadcast.sourceType?.startsWith("official-")));
  const fallbackOnly = football.filter((event) => event.broadcasts.length > 0 && !event.broadcasts.some((broadcast) => broadcast.sourceType?.startsWith("official-")));
  const topTierUnsupported = football.filter((event) => topTier.test(event.competition ?? "") && !event.broadcasts.some(isExactChannel));
  return {
    schemaVersion: 1,
    generatedAtEpochSeconds,
    sourceAttempts,
    summary: {
      footballFixtures: football.length,
      exactChannelFixtures: withExact.length,
      officialDestinationFixtures: withOfficial.length,
      fallbackOnlyFixtures: fallbackOnly.length,
      topTierUnsupportedFixtures: topTierUnsupported.length
    },
    gaps: topTierUnsupported.map((event) => ({ id: event.id, competition: event.competition ?? null, title: event.title }))
  };
}
