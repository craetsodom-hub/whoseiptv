const PRIORITY_TERRITORIES = {
  football: ["GB", "US", "ES", "FR", "DE", "IT"],
  basketball: ["US", "ES", "FR", "DE"],
  tennis: ["GB", "US", "ES"],
  cricket: ["GB", "IN", "AU"],
  rugby: ["GB", "FR", "ZA"]
};

export function scheduledCountriesForSport(sport, configured, nowEpochSeconds) {
  if (!Array.isArray(configured) || configured.length === 0) return [];
  const priority = (PRIORITY_TERRITORIES[sport.id] ?? [])
    .flatMap((territory) => configured.find((country) => country.territory === territory) ?? []);
  const priorityKeys = new Set(priority.map((country) => `${country.query}|${country.territory}`));
  const secondary = configured.filter((country) => !priorityKeys.has(`${country.query}|${country.territory}`));
  if (secondary.length === 0) return priority;
  const rotation = Math.floor(nowEpochSeconds / (3 * 60 * 60)) % secondary.length;
  return [...priority, secondary[rotation]];
}

export function scheduleRequestCount(sports, footballCountries, sportCountries, nowEpochSeconds, dayCount = 3) {
  return dayCount * sports.reduce((total, sport) => total + scheduledCountriesForSport(
    sport,
    sport.id === "football" ? footballCountries : sportCountries[sport.id],
    nowEpochSeconds
  ).length, 0);
}
