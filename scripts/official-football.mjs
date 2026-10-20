const SKY_URL = "https://www.skysports.com/watch/football-on-sky/competitions/premier-league";
const LALIGA_URL = "https://www.laliga.com/laliga-easports/resultados";
const LIGUE1_CALENDAR_URL = "https://ma-api.ligue1.fr/championship-calendar/1/nearest-game-weeks";
const LIGUE1_MATCH_URL = "https://ma-api.ligue1.fr/championship-match/";
const MLS_SCHEDULE_URL = "https://stats-api.mlssoccer.com/matches/seasons/MLS-SEA-0001KA";
const MLS_MATCH_URL = "https://sportapi.mlssoccer.com/api/matches/bySportecIds/";
import { broadcastAliases } from "./broadcast/normalize.mjs";
import { parseSkyFixtureSchedule } from './broadcast/sky-fixtures.mjs';

function aliasesFor(channelName, aliasesByChannel) {
  return broadcastAliases(channelName, aliasesByChannel[channelName] ?? [], 8);
}

function laligaBadgeUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && url.hostname === "assets.laliga.com" && /^\/assets\/\d{4}\/\d{2}\/\d{2}\/(?:small|medium|large)\/[a-z0-9_.-]+\.png$/i.test(url.pathname)
      ? url.toString() : null;
  } catch { return null; }
}

function mlsBadgeUrl(value) {
  try {
    const url = new URL(String(value ?? "").replace("{formatInstructions}", "f_auto,q_auto,w_128,h_128,c_fit"));
    return url.protocol === "https:" && url.hostname === "images.mlssoccer.com" && /^\/image\/upload\/[a-z0-9_,.-]+\/v\d+\/assets\/[a-z0-9_./-]+\.png$/i.test(url.pathname)
      ? url.toString() : null;
  } catch { return null; }
}

function broadcast(channelName, territory, aliasesByChannel, sourceType, sourceUrl, matchingMethod, languages = []) {
  const rightsHolder = /^Sky Sports/i.test(channelName) ? "Sky Sports" : /^Movistar|^M\+/i.test(channelName) ? "Movistar Plus+" : /^DAZN/i.test(channelName) ? "DAZN" : /^Orange/i.test(channelName) ? "Orange" : /^Ligue 1\+/i.test(channelName) ? "Ligue 1+" : channelName === "Apple TV" ? "Apple" : undefined;
  return {
    channelName,
    aliases: aliasesFor(channelName, aliasesByChannel),
    territory,
    // Language needs an explicit audio evidence contract; display language is insufficient.
    ...(rightsHolder ? { rightsHolder } : {}),
    confirmed: true,
    sourceType,
    sourceUrl,
    matchingMethod,
    ...(["official-broadcaster-schedule", "official-network-selection"].includes(sourceType) ? { destinationVerified: true } : {})
  };
}

export function parseSkyPremierLeague(html, aliasesByChannel = {}, referenceDate = new Date()) {
  return parseSkyFixtureSchedule(html, aliasesByChannel, referenceDate);
}

export function parseLaLiga(html, aliasesByChannel = {}) {
  const encoded = String(html).match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!encoded) return [];
  let payload;
  try { payload = JSON.parse(encoded); } catch { return []; }
  const matches = payload?.props?.pageProps?.matches;
  if (!Array.isArray(matches)) return [];
  return matches.flatMap((match) => {
    const homeTeam = String(match?.home_team?.nickname ?? "").trim();
    const awayTeam = String(match?.away_team?.nickname ?? "").trim();
    const start = Date.parse(match?.time ?? match?.date ?? "");
    const channels = (Array.isArray(match?.channels) ? match.channels : [])
      .map((channel) => String(channel?.name ?? "").trim()).filter(Boolean)
      .filter((channel, index, all) => all.indexOf(channel) === index);
    if (!match?.id || !homeTeam || !awayTeam || !Number.isFinite(start) || channels.length === 0) return [];
    return [{
      source: "laliga",
      sourceUrl: LALIGA_URL,
      sourceId: `laliga-${match.id}`,
      title: `${homeTeam} vs ${awayTeam}`,
      competition: "LALIGA EA SPORTS",
      homeTeam,
      awayTeam,
      homeTeamBadgeUrl: laligaBadgeUrl(match?.home_team?.shield?.url),
      awayTeamBadgeUrl: laligaBadgeUrl(match?.away_team?.shield?.url),
      ...(match?.home_team?.id ? { homeTeamSourceIds: { laliga: String(match.home_team.id) } } : {}),
      ...(match?.away_team?.id ? { awayTeamSourceIds: { laliga: String(match.away_team.id) } } : {}),
      startUtcEpochSeconds: Math.floor(start / 1000),
      broadcasts: channels.map((channel) => broadcast(channel, "ES", aliasesByChannel, "official-event", LALIGA_URL, "embedded-match-object", ["es"]))
    }];
  });
}

export function parseLigue1Match(body, aliasesByChannel = {}) {
  let match;
  try { match = typeof body === "string" ? JSON.parse(body) : body; } catch { return []; }
  const homeTeam = String(match?.home?.clubIdentity?.name ?? "").trim();
  const awayTeam = String(match?.away?.clubIdentity?.name ?? "").trim();
  const start = Date.parse(match?.date ?? "");
  const channels = (match?.broadcasters?.local ?? []).map((item) => String(item?.name?.["en-GB"] ?? "").trim())
    .filter((name) => /^Ligue 1\+ \d+$/.test(name)).filter((name, index, all) => all.indexOf(name) === index);
  if (!match?.id || !homeTeam || !awayTeam || !Number.isFinite(start) || channels.length === 0) return [];
  return [{
    source: "ligue1",
    sourceUrl: `${LIGUE1_MATCH_URL}${match.id}`,
    sourceId: match.id,
    title: `${homeTeam} vs ${awayTeam}`,
    competition: "Ligue 1",
    homeTeam,
    awayTeam,
    startUtcEpochSeconds: Math.floor(start / 1000),
    broadcasts: channels.map((channel) => broadcast(channel, "FR", aliasesByChannel, "official-event", `${LIGUE1_MATCH_URL}${match.id}`, "official-match-id", ["fr"]))
  }];
}

export function parseMlsMatch(body, aliasesByChannel = {}) {
  let match;
  try { match = Array.isArray(body) ? body[0] : JSON.parse(body)?.[0]; } catch { return []; }
  const homeTeam = String(match?.home?.fullName ?? "").trim();
  const awayTeam = String(match?.away?.fullName ?? "").trim();
  const competition = String(match?.competition?.name ?? "").trim();
  const start = Date.parse(match?.matchDate ?? "");
  const channel = (match?.broadcasters ?? []).find((item) => item?.broadcasterName === "Apple TV" && item?.broadcasterStreamingURL)?.broadcasterName;
  const placeholder = /^(?:tbc|tbd|to be (?:confirmed|determined))(?:\s+(?:home|away))?$/i;
  if (!match?.sportecId || !homeTeam || !awayTeam || placeholder.test(homeTeam) || placeholder.test(awayTeam) ||
      !competition || !Number.isFinite(start) || !channel || match?.delayedMatch === true) return [];
  const sourceUrl = `${MLS_MATCH_URL}${encodeURIComponent(match.sportecId)}`;
  return [{
    source: "mls",
    sourceUrl,
    sourceId: `mls-${match.sportecId}`,
    title: `${homeTeam} vs ${awayTeam}`,
    competition,
    homeTeam,
    awayTeam,
    homeTeamBadgeUrl: mlsBadgeUrl(match?.home?.logoColorUrl),
    awayTeamBadgeUrl: mlsBadgeUrl(match?.away?.logoColorUrl),
    ...(match?.home?.sportecId ? { homeTeamSourceIds: { mls: String(match.home.sportecId) } } : {}),
    ...(match?.away?.sportecId ? { awayTeamSourceIds: { mls: String(match.away.sportecId) } } : {}),
    startUtcEpochSeconds: Math.floor(start / 1000),
    broadcasts: [broadcast(channel, "US", aliasesByChannel, "official-event", sourceUrl, "mls-match-api-broadcaster")]
  }];
}

async function collectMlsMatches(fetchText, nowEpochSeconds, aliasesByChannel) {
  const start = new Date(nowEpochSeconds * 1000).toISOString().slice(0, 10);
  const end = new Date((nowEpochSeconds + 8 * 86_400) * 1000).toISOString().slice(0, 10);
  const parameters = new URLSearchParams({ "match_date[gte]": start, "match_date[lte]": end, per_page: "120", sort: "planned_kickoff_time:asc,home_team_name:asc" });
  try {
    const schedule = JSON.parse(await fetchText(`${MLS_SCHEDULE_URL}?${parameters}`));
    const ids = [...new Set((schedule?.schedule ?? []).filter((item) => item?.match_status === "scheduled").map((item) => item?.match_id).filter(Boolean))];
    const results = await Promise.allSettled(ids.map((id) => fetchText(`${MLS_MATCH_URL}${encodeURIComponent(id)}`)));
    return results.flatMap((result) => result.status === "fulfilled" ? parseMlsMatch(result.value, aliasesByChannel) : []);
  } catch (error) {
    console.error(`Official MLS source failed safely: ${error.message}`);
    return [];
  }
}

function sourceEvents(records, detailsByEvent) {
  const events = new Map();
  for (const record of records) {
    const sport = String(record?.__sport ?? (record?.strSport === "Soccer" ? "football" : "")).trim().toLowerCase();
    if (sport !== "football") continue;
    const sourceId = String(record?.idEvent ?? "").trim();
    if (!sourceId || events.has(sourceId)) continue;
    const details = detailsByEvent.get(sourceId);
    const title = String(details?.strEvent ?? record?.strEvent ?? "").trim();
    const titleTeams = title.split(/\s+vs\s+/i);
    const homeName = String(details?.strHomeTeam ?? titleTeams[0] ?? "").trim();
    const awayName = String(details?.strAwayTeam ?? titleTeams[1] ?? "").trim();
    const competition = String(details?.strLeague ?? record?.strLeague ?? "").trim();
    const startUtcEpochSeconds = parseUtcTimestamp(details?.strTimestamp ?? record?.strTimeStamp);
    if (!homeName || !awayName || !competition || !Number.isInteger(startUtcEpochSeconds)) continue;
    const homeId = String(details?.idHomeTeam ?? "").trim();
    const awayId = String(details?.idAwayTeam ?? "").trim();
    events.set(sourceId, {
      id: `tsdb-${sourceId}`,
      sourceIds: { thesportsdb: sourceId },
      sport: "football",
      competition,
      startUtcEpochSeconds,
      homeTeam: { name: homeName, ...(homeId ? { sourceIds: { thesportsdb: homeId } } : {}) },
      awayTeam: { name: awayName, ...(awayId ? { sourceIds: { thesportsdb: awayId } } : {}) }
    });
  }
  return [...events.values()];
}

export function resolveOfficialFootball(candidates, records, detailsByEvent = new Map(), nowEpochSeconds = Math.floor(Date.now() / 1000)) {
  const earliest = nowEpochSeconds - 6 * 60 * 60;
  const latest = nowEpochSeconds + 8 * 24 * 60 * 60;
  const sources = sourceEvents(records, detailsByEvent);
  return candidates.filter((candidate) => candidate.startUtcEpochSeconds >= earliest && candidate.startUtcEpochSeconds <= latest).map((candidate) => {
    const possible = sources.map((source) => ({ source, evidence: eventIdentityEvidence(source, { ...candidate, sport: "football" }) }))
      .filter(({ evidence }) => evidence);
    const bestScore = possible.length > 0 ? Math.max(...possible.map(({ evidence }) => evidence.score)) : null;
    const best = possible.filter(({ evidence }) => evidence.score === bestScore);
    const resolved = best.length === 1 ? best[0] : null;
    const homeSourceIds = { ...(candidate.homeTeamSourceIds ?? {}), ...(resolved?.source.homeTeam?.sourceIds ?? {}) };
    const awaySourceIds = { ...(candidate.awayTeamSourceIds ?? {}), ...(resolved?.source.awayTeam?.sourceIds ?? {}) };
    return {
      id: resolved?.source.id ?? candidate.sourceId,
      title: candidate.title,
      sport: "football",
      competition: candidate.competition,
      startUtcEpochSeconds: candidate.startUtcEpochSeconds,
      status: "confirmed",
      ...((candidate.sourceIds || resolved?.source.sourceIds) ? { sourceIds: { ...candidate.sourceIds, ...resolved?.source.sourceIds } } : {}),
      homeTeam: { name: candidate.homeTeam, badgeUrl: candidate.homeTeamBadgeUrl ?? null, ...(Object.keys(homeSourceIds).length ? { sourceIds: homeSourceIds } : {}) },
      awayTeam: { name: candidate.awayTeam, badgeUrl: candidate.awayTeamBadgeUrl ?? null, ...(Object.keys(awaySourceIds).length ? { sourceIds: awaySourceIds } : {}) },
      broadcasts: candidate.broadcasts.map((item) => resolved ? {
        ...item,
        eventMatchingMethod: resolved.evidence.matchingMethod,
        eventMatchConfidence: resolved.evidence.score
      } : item),
      broadcasterEvidence: {
        source: candidate.source,
        url: candidate.sourceUrl,
        // The official row itself is an exact event record. This flag means
        // the destination is attached to the parsed teams/kickoff above.
        eventMatched: true,
        // A separate field records whether it was also reconciled to the
        // shared TheSportsDB source ID; consumers must not confuse the two.
        sourceEventMatched: Boolean(resolved)
      }
    };
  });
}

export async function collectOfficialFootballEvents({ fetchText, aliasesByChannel, records, detailsByEvent, nowEpochSeconds }) {
  const results = await Promise.allSettled([fetchText(SKY_URL), fetchText(LALIGA_URL)]);
  const candidates = [];
  if (results[0].status === "fulfilled") candidates.push(...parseSkyPremierLeague(results[0].value, aliasesByChannel, new Date(nowEpochSeconds * 1000)));
  else console.error(`Official Sky source failed safely: ${results[0].reason.message}`);
  if (results[1].status === "fulfilled") candidates.push(...parseLaLiga(results[1].value, aliasesByChannel));
  else console.error(`Official LaLiga source failed safely: ${results[1].reason.message}`);
  try {
    const nearest = JSON.parse(await fetchText(LIGUE1_CALENDAR_URL));
    const gameWeeks = nearest?.nearestGameWeeks ?? {};
    const ids = [...new Set(Object.values(gameWeeks).flatMap((week) => week?.matchesIds ?? []))].slice(0, 20);
    const matches = await Promise.allSettled(ids.map((id) => fetchText(`${LIGUE1_MATCH_URL}${encodeURIComponent(id)}`)));
    for (const match of matches) if (match.status === "fulfilled") candidates.push(...parseLigue1Match(match.value, aliasesByChannel));
  } catch (error) {
    console.error(`Official Ligue 1 source failed safely: ${error.message}`);
  }
  candidates.push(...await collectMlsMatches(fetchText, nowEpochSeconds, aliasesByChannel));
  return resolveOfficialFootball(candidates, records, detailsByEvent, nowEpochSeconds);
}
import { eventIdentityEvidence } from "./broadcast/identity.mjs";
import { parseUtcTimestamp } from "./feed-core.mjs";
