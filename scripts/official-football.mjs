const SKY_URL = "https://www.skysports.com/watch/football-on-sky/competitions/premier-league";
const LALIGA_URL = "https://www.laliga.com/laliga-easports/resultados";
const LIGUE1_CALENDAR_URL = "https://ma-api.ligue1.fr/championship-calendar/1/nearest-game-weeks";
const LIGUE1_MATCH_URL = "https://ma-api.ligue1.fr/championship-match/";
const MLS_SCHEDULE_URL = "https://stats-api.mlssoccer.com/matches/seasons/MLS-SEA-0001KA";
const MLS_MATCH_URL = "https://sportapi.mlssoccer.com/api/matches/bySportecIds/";
const EXACT_SKY_CHANNELS = new Set([
  "Sky Sports Main Event",
  "Sky Sports Premier League",
  "Sky Sports+"
]);

function text(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function aliasesFor(channelName, aliasesByChannel) {
  return (aliasesByChannel[channelName] ?? []).filter((alias, index, all) => all.indexOf(alias) === index).slice(0, 8);
}

function broadcast(channelName, territory, aliasesByChannel, sourceType, sourceUrl, matchingMethod) {
  return {
    channelName,
    aliases: aliasesFor(channelName, aliasesByChannel),
    territory,
    confirmed: true,
    sourceType,
    sourceUrl,
    matchingMethod,
    ...(["official-broadcaster-schedule", "official-network-selection"].includes(sourceType) ? { destinationVerified: true } : {})
  };
}

export function parseSkyPremierLeague(html, aliasesByChannel = {}, referenceDate = new Date()) {
  const candidates = [];
  const dateSections = String(html).split(/(?=<h3\b[^>]*>)/i);
  for (const section of dateSections) {
    const dateLabel = text(section.match(/^<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
    const dateParts = dateLabel.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})(?:st|nd|rd|th)\s+([A-Za-z]+)$/);
    if (!dateParts) continue;
    let year = referenceDate.getUTCFullYear();
    const month = new Date(`${dateParts[2]} 1, 2000 UTC`).getUTCMonth();
    if (!Number.isInteger(month)) continue;
    if (month < referenceDate.getUTCMonth() - 6) year += 1;
    if (month > referenceDate.getUTCMonth() + 6) year -= 1;

    for (const match of section.matchAll(/<div\b[^>]*class="[^"]*event-group[^"]*"[^>]*>([\s\S]*?)<p\b[^>]*class="[^"]*event-detail[^"]*"[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/div>/gi)) {
      const teams = [...match[1].matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi)].map((item) => text(item[1]));
      const kickoff = text(match[1].match(/<li\b[^>]*class="[^"]*col2[^"]*"[^>]*>([\s\S]*?)<\/li>/i)?.[1]);
      const details = text(match[2]);
      const channels = [...details.matchAll(/(Sky Sports Main Event|Sky Sports Premier League|Sky Sports\+)\s*\(/g)]
        .map((item) => item[1]).filter((channel, index, all) => EXACT_SKY_CHANNELS.has(channel) && all.indexOf(channel) === index);
      if (teams.length < 2 || !/^\d{2}:\d{2}$/.test(kickoff) || channels.length === 0) continue;
      const start = Date.UTC(year, month, Number(dateParts[1]), Number(kickoff.slice(0, 2)), Number(kickoff.slice(3)));
      candidates.push({
        source: "sky",
        sourceUrl: SKY_URL,
        sourceId: `sky-${teams[0]}-${teams[1]}-${start}`,
        title: `${teams[0]} vs ${teams[1]}`,
        competition: "Premier League",
        homeTeam: teams[0],
        awayTeam: teams[1],
        startUtcEpochSeconds: Math.floor(start / 1000),
        broadcasts: channels.map((channel) => broadcast(channel, "GB", aliasesByChannel, "official-broadcaster-schedule", SKY_URL, "fixture-row-teams-kickoff"))
      });
    }
  }
  return candidates;
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
      startUtcEpochSeconds: Math.floor(start / 1000),
      broadcasts: channels.map((channel) => broadcast(channel, "ES", aliasesByChannel, "official-event", LALIGA_URL, "embedded-match-object"))
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
    broadcasts: channels.map((channel) => broadcast(channel, "FR", aliasesByChannel, "official-event", `${LIGUE1_MATCH_URL}${match.id}`, "official-match-id"))
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
    return {
      id: resolved?.source.id ?? candidate.sourceId,
      title: candidate.title,
      sport: "football",
      competition: candidate.competition,
      startUtcEpochSeconds: candidate.startUtcEpochSeconds,
      status: "confirmed",
      homeTeam: { name: candidate.homeTeam, badgeUrl: null },
      awayTeam: { name: candidate.awayTeam, badgeUrl: null },
      broadcasts: candidate.broadcasts.map((item) => resolved ? {
        ...item,
        eventMatchingMethod: resolved.evidence.matchingMethod,
        eventMatchConfidence: resolved.evidence.score
      } : item),
      broadcasterEvidence: { source: candidate.source, url: candidate.sourceUrl, eventMatched: Boolean(resolved) }
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
