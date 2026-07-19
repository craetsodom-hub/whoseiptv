function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function cleanAliases(aliases) {
  return (Array.isArray(aliases) ? aliases : [])
    .map((alias) => String(alias ?? "").trim())
    .filter(Boolean)
    .filter((alias, index, all) => all.indexOf(alias) === index)
    .slice(0, 8);
}

export function augmentWithOfficialRights(events, rightsConfig) {
  if (!Array.isArray(events) || !rightsConfig || rightsConfig.rightsType !== "tv-internet") {
    return events;
  }
  const competitionContains = (rightsConfig.competitionContains ?? [])
    .map(normalized)
    .filter(Boolean);
  if (competitionContains.length === 0) return events;

  for (const event of events) {
    const competition = normalized(event.competition);
    if (!competition || !competitionContains.some((part) => competition.includes(part))) continue;
    const broadcasts = Array.isArray(event.broadcasts) ? event.broadcasts : [];
    for (const country of rightsConfig.countries ?? []) {
      const territory = String(country?.territory ?? "").trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(territory)) continue;
      for (const channel of country.channels ?? []) {
        const channelName = String(channel?.name ?? "").trim();
        if (!channelName) continue;
        const duplicate = broadcasts.some((candidate) =>
          candidate.territory === territory && normalized(candidate.channelName) === normalized(channelName)
        );
        if (!duplicate && broadcasts.length < 64) {
          broadcasts.push({
            channelName,
            aliases: cleanAliases(channel.aliases),
            territory,
            confirmed: true
          });
        }
      }
    }
    event.broadcasts = broadcasts;
  }
  return events;
}

export function validateOfficialRightsConfig(config) {
  if (!config || config.rightsType !== "tv-internet" || !config.source || !config.lastVerified) {
    throw new Error("Official rights configuration metadata is incomplete");
  }
  if (!Array.isArray(config.countries) || config.countries.length !== 30) {
    throw new Error("Official rights configuration must contain exactly 30 countries");
  }
  const territories = new Set();
  for (const country of config.countries) {
    if (!/^[A-Z]{2}$/.test(country?.territory ?? "") || territories.has(country.territory)) {
      throw new Error("Official rights configuration contains an invalid or duplicate territory");
    }
    territories.add(country.territory);
    if (!Array.isArray(country.channels) || country.channels.length === 0 || country.channels.some((channel) => !String(channel?.name ?? "").trim())) {
      throw new Error(`Official rights configuration has no channel for ${country.territory}`);
    }
  }
  return true;
}
