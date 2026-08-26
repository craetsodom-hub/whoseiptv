import { compareEvents } from "./football-ranking.mjs";
import { isSupportedTerritory } from "./territories.mjs";
import { MAX_BROADCASTS_PER_EVENT, broadcastTerritories, mergeExactBroadcasts } from "./broadcast/resolver.mjs";
import { eventIdentityEvidence } from "./broadcast/identity.mjs";

const MAX_PAST_SECONDS = 6 * 60 * 60;
const MAX_FUTURE_SECONDS = 8 * 24 * 60 * 60;
const MAX_EVENTS = 100;
// Deduplicate before applying this larger bound so broad rights maps do not lose
// later territories merely because their source happened to be processed last.
const MAX_ALIASES_PER_BROADCAST = 12;
const TRUSTED_ARTWORK_HOSTS = new Set([
  "r2.thesportsdb.com",
  "www.thesportsdb.com",
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
  const sourceId = clean(details?.[`id${prefix}Team`], 100);
  return {
    name,
    badgeUrl: imageUrl(details?.[`str${prefix}TeamBadge`]),
    ...(sourceId ? { sourceIds: { thesportsdb: sourceId } } : {})
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

export function mergeBroadcastAssignments(left = [], right = []) {
  return mergeExactBroadcasts(left, right);
}

export function mergeCollectedEvents(events) {
  const merged = new Map();
  for (const event of events) {
    let key = event.id?.startsWith("tsdb-")
      ? event.id
      : `${event.sport}|${event.startUtcEpochSeconds}|${event.title.toLocaleLowerCase("en-US")}`;
    if (!merged.has(key) && !event.id?.startsWith("tsdb-")) {
      const possible = [...merged.entries()].map(([candidateKey, candidate]) => ({
        candidateKey,
        evidence: eventIdentityEvidence(candidate, event)
      })).filter(({ evidence }) => evidence);
      if (possible.length > 0) {
        const bestScore = Math.max(...possible.map(({ evidence }) => evidence.score));
        const best = possible.filter(({ evidence }) => evidence.score === bestScore);
        if (best.length === 1) key = best[0].candidateKey;
      }
    }
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, event);
      continue;
    }
    existing.broadcasts = mergeExactBroadcasts(existing.broadcasts, event.broadcasts);
    existing.homeTeam ??= event.homeTeam;
    existing.awayTeam ??= event.awayTeam;
    existing.artworkUrl ??= event.artworkUrl;
    existing.competition ??= event.competition;
    existing.broadcasterEvidence ??= event.broadcasterEvidence;
  }
  return [...merged.values()];
}

export function selectEvents(events, maximum = MAX_EVENTS) {
  const bySport = new Map();
  for (const event of events) bySport.set(event.sport, [...(bySport.get(event.sport) ?? []), event]);
  for (const sportEvents of bySport.values()) sportEvents.sort(compareEvents);
  const selected = [];
  for (let index = 0; selected.length < maximum; index += 1) {
    let added = false;
    for (const sportEvents of bySport.values()) {
      if (sportEvents[index] && selected.length < maximum) {
        selected.push(sportEvents[index]);
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}

export function buildFeed(records, aliasesByChannel, nowEpochSeconds, detailsByEvent = new Map(), options = {}) {
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
    if (!sourceId || !title || !isSupportedTerritory(territory) || !startUtcEpochSeconds) continue;
    if (startUtcEpochSeconds < earliest || startUtcEpochSeconds > latest) continue;

    const id = `tsdb-${sourceId}`;
    const event = eventsById.get(id) ?? {
      id,
      sourceIds: { thesportsdb: sourceId },
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
    if (channelName && !duplicate && event.broadcasts.length < MAX_BROADCASTS_PER_EVENT) {
      event.broadcasts.push({
        channelName,
        aliases: aliasesFor(channelName, aliasesByChannel),
        territory,
        confirmed: true,
        sourceType: "source-event",
        sourceUrl: "https://www.thesportsdb.com/api/v1/json/123/eventstv.php",
        verifiedAt: new Date(nowEpochSeconds * 1000).toISOString().slice(0, 10),
        matchingMethod: "source-event-id"
      });
    }
    eventsById.set(id, event);
  }

  // Football fixtures with no current destination remain in the feed so the
  // resolver can attach rights metadata and the coverage report can expose
  // the gap instead of silently treating it as a non-event.
  const events = [...eventsById.values()].filter((event) => event.broadcasts.length > 0 || event.sport === "football");
  for (const event of events) event.broadcasts = mergeExactBroadcasts(event.broadcasts);

  return {
    schemaVersion: 1,
    generatedAtEpochSeconds: nowEpochSeconds,
    validUntilEpochSeconds: nowEpochSeconds + 12 * 60 * 60,
    events: options.select === false ? events : selectEvents(events)
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
    if (!Array.isArray(event.broadcasts) || event.broadcasts.length > MAX_BROADCASTS_PER_EVENT ||
        (event.broadcasts.length === 0 && event.sport !== "football")) {
      throw new Error(`Event ${event.id} has no confirmed broadcaster`);
    }
    for (const broadcast of event.broadcasts) {
      const territories = broadcastTerritories(broadcast);
      if (!broadcast.channelName || territories.length === 0 || (broadcast.region && (!broadcast.displayRegion || broadcast.territory !== undefined)) || broadcast.confirmed !== true ||
          !broadcast.sourceType || !broadcast.sourceUrl || !broadcast.matchingMethod ||
          (broadcast.aliases !== undefined && (!Array.isArray(broadcast.aliases) || broadcast.aliases.length > MAX_ALIASES_PER_BROADCAST))) {
        throw new Error(`Invalid broadcaster for ${event.id}`);
      }
    }
    if (event.broadcastRights !== undefined && (!Array.isArray(event.broadcastRights) || event.broadcastRights.some((right) =>
      !isSupportedTerritory(right?.territory) || right.sourceType !== "official-rights" || !/^https:\/\//.test(right.sourceUrl ?? "")
    ))) throw new Error(`Invalid rights metadata for ${event.id}`);
  }
  return true;
}
