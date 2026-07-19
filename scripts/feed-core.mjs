const MAX_PAST_SECONDS = 6 * 60 * 60;
const MAX_FUTURE_SECONDS = 8 * 24 * 60 * 60;
const MAX_EVENTS = 100;
const MAX_BROADCASTS_PER_EVENT = 12;
const MAX_ALIASES_PER_BROADCAST = 8;
const TRUSTED_ARTWORK_HOSTS = new Set([
  "r2.thesportsdb.com",
  "cdn.nba.com",
  "media.formula1.com"
]);

function clean(value, maxLength) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, maxLength) : null;
}

function channelKey(value) {
  return String(value ?? "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "");
}

function imageUrl(value) {
  const url = clean(value, 300);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && TRUSTED_ARTWORK_HOSTS.has(parsed.hostname) ? url : null;
  } catch {
    return null;
  }
}

function teamFromDetails(details, prefix) {
  const name = clean(details?.[`str${prefix}Team`], 120);
  if (!name) return null;
  return {
    name,
    badgeUrl: imageUrl(details?.[`str${prefix}TeamBadge`])
  };
}

export function parseUtcTimestamp(value) {
  const raw = clean(value, 80);
  if (!raw) return null;

  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    const milliseconds = raw.length >= 13 ? numeric : numeric * 1000;
    return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
  }

  let normalized = raw.replace(" ", "T");
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) normalized += "Z";
  const milliseconds = Date.parse(normalized);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}

function aliasesFor(channelName, aliasesByChannel) {
  const key = channelKey(channelName);
  const entry = Object.entries(aliasesByChannel).find(
    ([candidate]) => channelKey(candidate) === key
  );
  return (entry?.[1] ?? [])
    .map((alias) => clean(alias, 120))
    .filter(Boolean)
    .filter((alias, index, all) => all.indexOf(alias) === index)
    .slice(0, MAX_ALIASES_PER_BROADCAST);
}

export function buildFeed(records, aliasesByChannel, nowEpochSeconds, detailsByEvent = new Map()) {
  if (!Number.isInteger(nowEpochSeconds) || nowEpochSeconds <= 0) {
    throw new Error("A valid generation time is required");
  }

  const earliest = nowEpochSeconds - MAX_PAST_SECONDS;
  const latest = nowEpochSeconds + MAX_FUTURE_SECONDS;
  const eventsById = new Map();

  for (const record of records) {
    const sport = clean(
      record?.__sport ?? (record?.strSport === "Soccer" ? "football" : null),
      40
    );
    if (!sport) continue;
    const sourceId = clean(record.idEvent, 100);
    const details = detailsByEvent.get(sourceId);
    const title = clean(details?.strEvent ?? record.strEvent, 200);
    const channelName = clean(record.strChannel, 120);
    const territory = clean(record.__territory, 16);
    const startUtcEpochSeconds = parseUtcTimestamp(details?.strTimestamp ?? record.strTimeStamp);
    if (!sourceId || !title || !channelName || !territory || !startUtcEpochSeconds) continue;
    if (startUtcEpochSeconds < earliest || startUtcEpochSeconds > latest) continue;

    const id = `tsdb-${sourceId}`;
    const event = eventsById.get(id) ?? {
      id,
      title,
      sport,
      startUtcEpochSeconds,
      status: "confirmed",
      broadcasts: []
    };

    const homeTeam = teamFromDetails(details, "Home");
    const awayTeam = teamFromDetails(details, "Away");
    if (homeTeam && awayTeam && !event.homeTeam) {
      event.homeTeam = homeTeam;
      event.awayTeam = awayTeam;
    }

    const competition = clean(details?.strLeague ?? record.strLeague, 120);
    if (competition && !event.competition) event.competition = competition;

    const duplicate = event.broadcasts.some(
      (broadcast) => broadcast.territory === territory &&
        broadcast.channelName.toLocaleLowerCase("en-US") === channelName.toLocaleLowerCase("en-US")
    );
    if (!duplicate && event.broadcasts.length < MAX_BROADCASTS_PER_EVENT) {
      event.broadcasts.push({
        channelName,
        aliases: aliasesFor(channelName, aliasesByChannel),
        territory,
        confirmed: true
      });
    }
    eventsById.set(id, event);
  }

  const events = [...eventsById.values()]
    .filter((event) => event.broadcasts.length > 0)
    .sort((left, right) => left.startUtcEpochSeconds - right.startUtcEpochSeconds);

  // Keep the feed small and prevent football from crowding every other category out.
  const selected = [];
  const bySport = new Map();
  for (const event of events) bySport.set(event.sport, [...(bySport.get(event.sport) ?? []), event]);
  for (let index = 0; index < 20 && selected.length < MAX_EVENTS; index += 1) {
    for (const sportEvents of bySport.values()) {
      const event = sportEvents[index];
      if (event && selected.length < MAX_EVENTS) selected.push(event);
    }
  }

  return {
    schemaVersion: 1,
    generatedAtEpochSeconds: nowEpochSeconds,
    validUntilEpochSeconds: nowEpochSeconds + 12 * 60 * 60,
    events: selected.sort((left, right) => left.startUtcEpochSeconds - right.startUtcEpochSeconds)
  };
}

export function validateFeed(feed, nowEpochSeconds) {
  if (feed?.schemaVersion !== 1) throw new Error("Unsupported feed schema");
  if (feed.generatedAtEpochSeconds !== nowEpochSeconds) throw new Error("Incorrect generation time");
  if (feed.validUntilEpochSeconds <= nowEpochSeconds) throw new Error("Feed is already stale");
  if (!Array.isArray(feed.events) || feed.events.length > MAX_EVENTS) {
    throw new Error("Invalid event collection");
  }

  const ids = new Set();
  for (const event of feed.events) {
    if (!event.id || ids.has(event.id)) throw new Error("Duplicate or missing event ID");
    ids.add(event.id);
    if (!event.title || !["football", "basketball", "tennis", "formula1", "cricket", "rugby"].includes(event.sport) || event.status !== "confirmed") {
      throw new Error(`Invalid event ${event.id}`);
    }
    if ((event.homeTeam && !event.awayTeam) || (!event.homeTeam && event.awayTeam)) {
      throw new Error(`Incomplete teams for ${event.id}`);
    }
    for (const team of [event.homeTeam, event.awayTeam].filter(Boolean)) {
      if (!team.name || (team.badgeUrl && imageUrl(team.badgeUrl) !== team.badgeUrl)) {
        throw new Error(`Invalid team artwork for ${event.id}`);
      }
    }
    if (event.artworkUrl && imageUrl(event.artworkUrl) !== event.artworkUrl) {
      throw new Error(`Invalid event artwork for ${event.id}`);
    }
    if (!Number.isInteger(event.startUtcEpochSeconds)) throw new Error(`Invalid time for ${event.id}`);
    if (!Array.isArray(event.broadcasts) || event.broadcasts.length === 0) {
      throw new Error(`Event ${event.id} has no confirmed broadcaster`);
    }
    for (const broadcast of event.broadcasts) {
      if (!broadcast.channelName || !broadcast.territory || broadcast.confirmed !== true) {
        throw new Error(`Invalid broadcaster for ${event.id}`);
      }
    }
  }
  return true;
}
