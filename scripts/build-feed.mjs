import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFeed, mergeCollectedEvents, selectEvents, validateFeed } from "./feed-core.mjs";
import { collectFormulaOneEvents } from "./official-f1.mjs";
import { collectNbaEvents } from "./official-nba.mjs";
import { collectOfficialFootballEvents } from "./official-football.mjs";
import { activeAllEventDestinations, attachAllEventDestinations, augmentWithOfficialRights, validateOfficialRightsConfig } from "./official-rights.mjs";
import { canonicalizeRegionalBroadcasts, filterTrustedScheduleBroadcasts, resolveExactBroadcasts } from "./broadcast/resolver.mjs";
import { OFFICIAL_BROADCAST_ADAPTERS } from "./broadcast/adapters/index.mjs";
import { buildDiscoveryCoverage, discoverOfficialDestinations } from "./broadcast/discovery.mjs";
import { createTeamArtworkResolver, enrichTeamArtwork } from "./team-artwork.mjs";
import { scheduledCountriesForSport } from "./source-plan.mjs";
import { retryAfterMilliseconds, retryDelayMilliseconds } from "./http-retry-policy.mjs";
import { collectEuropeanFixtures } from './european-fixtures.mjs';
import { previewBaseline } from './preview-baseline.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(projectRoot, "feed/events/v1/events.json");
const coveragePath = resolve(projectRoot, "feed/events/v1/coverage.json");
const aliasesPath = resolve(projectRoot, "config/channel-aliases.json");
const footballCountriesPath = resolve(projectRoot, "config/football-countries.json");
const sportCountriesPath = resolve(projectRoot, "config/sport-countries.json");
const officialRightsPath = resolve(projectRoot, "config/official-event-broadcasters.json");
const apiKey = process.env.THESPORTSDB_API_KEY || "123";
const sourceBase = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/eventstv.php`;
const countries = [
  { query: "United_Kingdom", territory: "GB" },
  { query: "United_States", territory: "US" },
  { query: "Spain", territory: "ES" },
  { query: "France", territory: "FR" },
  { query: "Morocco", territory: "MA" },
  { query: "Turkey", territory: "TR" },
  { query: "Germany", territory: "DE" },
  { query: "Italy", territory: "IT" }
];
const sports = [
  { query: "Soccer", id: "football" },
  { query: "Basketball", id: "basketball" },
  { query: "Tennis", id: "tennis" },
  { query: "Motorsport", id: "formula1" },
  { query: "Cricket", id: "cricket" },
  { query: "Rugby", id: "rugby" }
];
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_CHARACTERS = 1_000_000;
const REQUEST_PACING_MS = Number(process.env.REQUEST_PACING_MS ?? 2_500);
const MIN_SOURCE_SUCCESS_RATIO = 0.8;
const MAX_DETAIL_REQUESTS = Number(process.env.MAX_DETAIL_REQUESTS ?? 12);
const MAX_ARTWORK_REQUESTS = Number(process.env.MAX_ARTWORK_REQUESTS ?? 8);
const MAX_RETRIES = 2;
const execFileAsync = promisify(execFile);

async function fetchWithCurlFallback(url, accept) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: accept, "User-Agent": "WhoseIPTV-Events/1.0 (+https://github.com/craetsodom-hub/whoseiptv)" },
      signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfterMs = retryAfterMilliseconds(response.headers.get("retry-after"));
      throw error;
    }
    const body = await response.text();
    if (!body || body.length > MAX_RESPONSE_CHARACTERS) throw new Error("Response is empty or too large");
    return body;
  } catch (fetchError) {
    // A valid HTTP response must not be repeated through curl. In particular,
    // retrying a 429 through a second transport doubles pressure on the source.
    if (fetchError?.status) throw fetchError;
    const curl = process.platform === "win32" ? "curl.exe" : "curl";
    const result = await execFileAsync(curl, ["-L", "--fail", "--compressed", "--max-time", String(Math.ceil(REQUEST_TIMEOUT_MS / 1000)), "-A", "WhoseIPTV-Events/1.0", "-H", `Accept: ${accept}`, url], { maxBuffer: MAX_RESPONSE_CHARACTERS * 2 });
    if (!result.stdout || result.stdout.length > MAX_RESPONSE_CHARACTERS) throw fetchError;
    return result.stdout;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(url, accept) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fetchWithCurlFallback(url, accept);
    } catch (error) {
      lastError = error;
      const retryable = !error?.status || error.status === 429 || error.status >= 500;
      if (!retryable || attempt === MAX_RETRIES) break;
      await wait(retryDelayMilliseconds(error, attempt));
    }
  }
  throw lastError;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function generationEpochSeconds() {
  const configured = Number(process.env.SOURCE_DATE_EPOCH);
  const current = Math.floor(Date.now() / 1000);
  if (process.env.SOURCE_DATE_EPOCH === undefined) return current;
  if (!Number.isSafeInteger(configured) || configured <= 0 || Math.abs(current - configured) > 6 * 60 * 60) {
    throw new Error("SOURCE_DATE_EPOCH must be within six hours of the current time");
  }
  return configured;
}

function utcDate(nowEpochSeconds, offsetDays) {
  const date = new Date(nowEpochSeconds * 1000);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function isValidCountryList(value, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return false;
  const entriesAreValid = value.every((country) =>
    typeof country?.query === "string" && country.query.length > 0 &&
    typeof country?.territory === "string" && /^[A-Z]{2}$/.test(country.territory)
  );
  const uniqueEntries = new Set(value.map((country) => `${country.query}|${country.territory}`));
  return entriesAreValid && uniqueEntries.size === value.length;
}

async function fetchCountryDay(country, date, sport) {
  const parameters = new URLSearchParams({ d: date, s: sport.query, a: country.query });
  {
    const text = await fetchWithRetry(`${sourceBase}?${parameters}`, "application/json");
    const payload = JSON.parse(text);
    if (payload.tvevents !== null && !Array.isArray(payload.tvevents)) {
      throw new Error("Unexpected response shape");
    }
    return (payload.tvevents ?? []).map((event) => ({
      ...event,
      __territory: country.territory,
      __sport: sport.id
    }));
  }
}

async function fetchEventDetails(sourceId) {
  const parameters = new URLSearchParams({ id: sourceId });
  {
    const text = await fetchWithRetry(`https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/lookupevent.php?${parameters}`, "application/json");
    const payload = JSON.parse(text);
    return payload.events?.[0] ?? null;
  }
}

async function fetchOfficialPage(url) {
  return fetchWithRetry(url, "text/html,application/xhtml+xml");
}

function configuredCountriesForSport(sport, footballCountries, sportCountries) {
  return sport.id === "football" ? footballCountries : sportCountries[sport.id];
}

function previousDetails(feed) {
  const details = new Map();
  for (const event of feed?.events ?? []) {
    const sourceId = String(event?.sourceIds?.thesportsdb ?? "").trim();
    if (!/^\d+$/.test(sourceId)) continue;
    details.set(sourceId, {
      strEvent: event.title,
      strTimestamp: new Date(event.startUtcEpochSeconds * 1000).toISOString(),
      strLeague: event.competition,
      strHomeTeam: event.homeTeam?.name,
      idHomeTeam: event.homeTeam?.sourceIds?.thesportsdb,
      strHomeTeamBadge: event.homeTeam?.badgeUrl,
      strAwayTeam: event.awayTeam?.name,
      idAwayTeam: event.awayTeam?.sourceIds?.thesportsdb,
      strAwayTeamBadge: event.awayTeam?.badgeUrl
    });
  }
  return details;
}

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function main() {
  let discoveryCoverage = null;
  const nowEpochSeconds = generationEpochSeconds();
  let priorFeed = null;
  try {
    priorFeed = JSON.parse(await readFile(outputPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  if (process.env.SOURCE_DATE_EPOCH !== undefined) {
    try {
      if (priorFeed?.generatedAtEpochSeconds === nowEpochSeconds) {
        validateFeed(priorFeed, nowEpochSeconds);
        console.log(`Feed already generated for SOURCE_DATE_EPOCH=${nowEpochSeconds}; preserving deterministic output`);
        return;
      }
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }
  const aliasesByChannel = JSON.parse(await readFile(aliasesPath, "utf8"));
  const footballCountries = JSON.parse(await readFile(footballCountriesPath, "utf8"));
  const sportCountries = JSON.parse(await readFile(sportCountriesPath, "utf8"));
  const officialRights = JSON.parse(await readFile(officialRightsPath, "utf8"));
  validateOfficialRightsConfig(officialRights);
  if (!isValidCountryList(footballCountries) || footballCountries.length < countries.length) {
    throw new Error("Football country configuration is incomplete");
  }
  for (const sport of sports.filter((candidate) => candidate.id !== "football")) {
    const configuredCountries = sportCountries?.[sport.id];
    if (!isValidCountryList(configuredCountries, sport.id === "formula1")) {
      throw new Error(`Country configuration is incomplete for ${sport.id}`);
    }
  }
  const dates = [utcDate(nowEpochSeconds, 0), utcDate(nowEpochSeconds, 1), utcDate(nowEpochSeconds, 2)];
  const records = [];
  const sourceAttempts = [];
  let successfulRequests = 0;
  const jobs = dates.flatMap((date) => sports.flatMap((sport) =>
    scheduledCountriesForSport(sport, configuredCountriesForSport(sport, footballCountries, sportCountries), nowEpochSeconds)
      .map((country) => ({ date, sport, country }))
  ));
  const totalRequests = jobs.length;
  for (const { date, sport, country } of jobs) {
    try {
      records.push(...await fetchCountryDay(country, date, sport));
      successfulRequests += 1;
      sourceAttempts.push({ sport: sport.id, territory: country.territory, date, status: "success" });
    } catch (error) {
      sourceAttempts.push({ sport: sport.id, territory: country.territory, date, status: "failed", reason: String(error.message).slice(0, 160) });
      console.error(`Source failed for ${sport.id}/${country.territory} on ${date}: ${error.message}`);
    }
    await wait(REQUEST_PACING_MS);
  }

  const baseline = previewBaseline(priorFeed, nowEpochSeconds);
  if (successfulRequests / totalRequests < MIN_SOURCE_SUCCESS_RATIO) {
    console.warn(`Only ${successfulRequests}/${totalRequests} source requests succeeded (minimum ${MIN_SOURCE_SUCCESS_RATIO * 100}%); continuing with baseline (${baseline.events.length} events) and independent official sources`);
  }

  const detailsByEvent = previousDetails(priorFeed);
  const uncachedSourceIds = [...new Set(records.map((record) => String(record.idEvent ?? "").trim()).filter(Boolean))]
    .filter((sourceId) => !detailsByEvent.has(sourceId)).slice(0, MAX_DETAIL_REQUESTS);
  for (const sourceId of uncachedSourceIds) {
    try {
      const details = await fetchEventDetails(sourceId);
      if (details) detailsByEvent.set(sourceId, details);
    } catch (error) {
      console.error(`Event details failed for ${sourceId}: ${error.message}`);
    }
    await wait(REQUEST_PACING_MS);
  }

  const feed = buildFeed(records, aliasesByChannel, nowEpochSeconds, detailsByEvent, { select: false });
  if (successfulRequests / totalRequests < MIN_SOURCE_SUCCESS_RATIO && baseline.events.length > 0) {
    feed.events = mergeCollectedEvents([...baseline.events, ...feed.events]);
  }
  try {
    const [formulaOneResult, nbaResult, footballResult] = await Promise.allSettled([
      collectFormulaOneEvents({
        fetchText: fetchOfficialPage,
        nowEpochSeconds,
        aliasesByChannel
      }),
      collectNbaEvents({
        fetchText: fetchOfficialPage,
        nowEpochSeconds,
        aliasesByChannel
      }),
      collectOfficialFootballEvents({
        fetchText: fetchOfficialPage,
        nowEpochSeconds,
        aliasesByChannel,
        records,
        detailsByEvent
      })
    ]);
    const formulaOneEvents = formulaOneResult.status === "fulfilled" ? formulaOneResult.value : [];
    const nbaEvents = nbaResult.status === "fulfilled" ? nbaResult.value : [];
    const footballEvents = footballResult.status === "fulfilled" ? footballResult.value : [];
    // These collectors read primary sources during this run. Preserve that check
    // timestamp without suggesting that a country/language label verifies audio.
    for (const event of [...footballEvents, ...formulaOneEvents, ...nbaEvents]) {
      for (const broadcast of event.broadcasts ?? []) {
        broadcast.verifiedAt ??= new Date(nowEpochSeconds * 1000).toISOString().slice(0, 10);
        broadcast.checkedAt = new Date(nowEpochSeconds * 1000).toISOString();
      }
    }
    if (formulaOneResult.status === "rejected") {
      console.error(`Official Formula 1 source failed safely: ${formulaOneResult.reason.message}`);
    }
    if (nbaResult.status === "rejected") {
      console.error(`Official NBA source failed safely: ${nbaResult.reason.message}`);
    }
    if (footballResult.status === "rejected") {
      console.error(`Official football sources failed safely: ${footballResult.reason.message}`);
    }
    const europeanFixtures = await collectEuropeanFixtures({fetchText:fetchOfficialPage, nowEpochSeconds, onFailure:failure=>console.error(`European fixture source ${failure.source}: ${failure.error}`)});
    const mergedEvents = mergeCollectedEvents([...feed.events, ...footballEvents, ...formulaOneEvents, ...nbaEvents, ...europeanFixtures]);
    const discovery = await discoverOfficialDestinations(OFFICIAL_BROADCAST_ADAPTERS, {
      events: mergedEvents,
      fetchText: fetchOfficialPage,
      aliasesByChannel,
      verifiedAt: new Date(nowEpochSeconds * 1000).toISOString()
    });
    for (const attempt of discovery.attempts.filter((attempt) => !attempt.success)) {
      console.error(`Official broadcast adapter ${attempt.id} failed safely: ${attempt.failure}`);
    }
    augmentWithOfficialRights(mergedEvents, officialRights);
    filterTrustedScheduleBroadcasts(mergedEvents);
    attachAllEventDestinations(mergedEvents, officialRights);
    for (const candidate of discovery.candidates) for (const broadcast of candidate.broadcasts ?? []) broadcast.checkedAt = new Date(nowEpochSeconds * 1000).toISOString();
    resolveExactBroadcasts(mergedEvents, discovery.candidates);
    canonicalizeRegionalBroadcasts(mergedEvents);
    const artworkCache = new Map();
    for (const event of priorFeed?.events ?? []) for (const team of [event.homeTeam, event.awayTeam].filter(Boolean)) {
      const id = String(team.sourceIds?.thesportsdb ?? "").trim();
      if (/^\d+$/.test(id) && team.badgeUrl) artworkCache.set(`id:${id}`, { badgeUrl: team.badgeUrl, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    }
    const artworkResolver = createTeamArtworkResolver({ fetchText: (url) => fetchWithRetry(url, "application/json"), apiKey, concurrency: 1, minIntervalMs: REQUEST_PACING_MS, maxRequests: MAX_ARTWORK_REQUESTS, cache: artworkCache });
    await enrichTeamArtwork(mergedEvents, artworkResolver);
    discoveryCoverage = buildDiscoveryCoverage(mergedEvents, OFFICIAL_BROADCAST_ADAPTERS, discovery.attempts);
    discoveryCoverage.allEventDestinations = activeAllEventDestinations(officialRights, nowEpochSeconds);
    discoveryCoverage.pipeline = {
      generatedAt: new Date(nowEpochSeconds * 1000).toISOString(),
      scheduleMode: "priority-plus-rotating-secondary-markets",
      requests: totalRequests,
      succeeded: successfulRequests,
      failed: totalRequests - successfulRequests,
      successRatio: Number((successfulRequests / totalRequests).toFixed(3)),
      minimumSuccessRatio: MIN_SOURCE_SUCCESS_RATIO,
      detailRequests: uncachedSourceIds.length,
      maximumDetailRequests: MAX_DETAIL_REQUESTS,
      maximumArtworkRequests: MAX_ARTWORK_REQUESTS,
      sourceAttempts
    };
    feed.events = selectEvents(mergedEvents);
    const matchedFootball = footballEvents.filter((event) => event.broadcasterEvidence?.sourceEventMatched).length;
    console.log(`Collected ${footballEvents.length} exact official football events (${matchedFootball} resolved to source events), ${formulaOneEvents.length} official Formula 1 and ${nbaEvents.length} official basketball events`);
  } catch (error) {
    console.error(`Official source batch failed safely: ${error.message}`);
  }
  validateFeed(feed, nowEpochSeconds);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeJsonAtomic(outputPath, feed);
  if (discoveryCoverage) await writeJsonAtomic(coveragePath, discoveryCoverage);
  console.log(`Published ${feed.events.length} multi-sport events from ${successfulRequests}/${totalRequests} successful requests`);
}

await main();
