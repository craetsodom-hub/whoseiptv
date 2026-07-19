import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFeed, validateFeed } from "./feed-core.mjs";
import { collectFormulaOneEvents } from "./official-f1.mjs";
import { collectNbaEvents } from "./official-nba.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(projectRoot, "feed/events/v1/events.json");
const aliasesPath = resolve(projectRoot, "config/channel-aliases.json");
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
const REQUEST_PACING_MS = 2_200;
const execFileAsync = promisify(execFile);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function utcDate(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function fetchCountryDay(country, date, sport) {
  const parameters = new URLSearchParams({ d: date, s: sport.query, a: country.query });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${sourceBase}?${parameters}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "WhoseIPTV-Events/1.0 (+https://github.com/craetsodom-hub/whoseiptv)"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARACTERS) throw new Error("Response too large");
    const payload = JSON.parse(text);
    if (payload.tvevents !== null && !Array.isArray(payload.tvevents)) {
      throw new Error("Unexpected response shape");
    }
    return (payload.tvevents ?? []).map((event) => ({
      ...event,
      __territory: country.territory,
      __sport: sport.id
    }));
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchEventDetails(sourceId) {
  const parameters = new URLSearchParams({ id: sourceId });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/lookupevent.php?${parameters}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "WhoseIPTV-Events/1.0 (+https://github.com/craetsodom-hub/whoseiptv)"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARACTERS) throw new Error("Response too large");
    const payload = JSON.parse(text);
    return payload.events?.[0] ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOfficialPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "WhoseIPTV-Events/1.0 (+https://github.com/craetsodom-hub/whoseiptv)"
      },
      signal: controller.signal
    });
    if (response.status === 403) {
      const curl = process.platform === "win32" ? "curl.exe" : "curl";
      const result = await execFileAsync(curl, [
        "-L",
        "--fail",
        "--max-time",
        String(Math.ceil(REQUEST_TIMEOUT_MS / 1000)),
        "-A",
        "WhoseIPTV-Events/1.0",
        url
      ], { maxBuffer: MAX_RESPONSE_CHARACTERS * 2 });
      if (!result.stdout || result.stdout.length > MAX_RESPONSE_CHARACTERS) {
        throw new Error("Official source response is empty or too large");
      }
      return result.stdout;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARACTERS) throw new Error("Response too large");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const aliasesByChannel = JSON.parse(await readFile(aliasesPath, "utf8"));
  const dates = [utcDate(0), utcDate(1), utcDate(2)];
  const records = [];
  let successfulRequests = 0;
  const jobs = dates.flatMap((date) => sports.flatMap((sport) =>
    countries.map((country) => ({ date, sport, country }))
  ));
  const totalRequests = jobs.length;
  for (const { date, sport, country } of jobs) {
    try {
      records.push(...await fetchCountryDay(country, date, sport));
      successfulRequests += 1;
    } catch (error) {
      console.error(`Source failed for ${sport.id}/${country.territory} on ${date}: ${error.message}`);
    }
    await wait(REQUEST_PACING_MS);
  }

  if (successfulRequests < Math.ceil(totalRequests * 0.8)) {
    throw new Error(`Only ${successfulRequests}/${totalRequests} source requests succeeded; keeping the previous feed`);
  }

  const detailsByEvent = new Map();
  for (const sourceId of new Set(records.map((record) => String(record.idEvent ?? "").trim()).filter(Boolean))) {
    try {
      const details = await fetchEventDetails(sourceId);
      if (details) detailsByEvent.set(sourceId, details);
    } catch (error) {
      console.error(`Event details failed for ${sourceId}: ${error.message}`);
    }
    await wait(REQUEST_PACING_MS);
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const feed = buildFeed(records, aliasesByChannel, nowEpochSeconds, detailsByEvent);
  try {
    const [formulaOneResult, nbaResult] = await Promise.allSettled([
      collectFormulaOneEvents({
        fetchText: fetchOfficialPage,
        nowEpochSeconds,
        aliasesByChannel
      }),
      collectNbaEvents({
        fetchText: fetchOfficialPage,
        nowEpochSeconds,
        aliasesByChannel
      })
    ]);
    const formulaOneEvents = formulaOneResult.status === "fulfilled" ? formulaOneResult.value : [];
    const nbaEvents = nbaResult.status === "fulfilled" ? nbaResult.value : [];
    if (formulaOneResult.status === "rejected") {
      console.error(`Official Formula 1 source failed safely: ${formulaOneResult.reason.message}`);
    }
    if (nbaResult.status === "rejected") {
      console.error(`Official NBA source failed safely: ${nbaResult.reason.message}`);
    }
    const allEvents = [...feed.events, ...formulaOneEvents, ...nbaEvents];
    const mergedEvents = new Map();
    for (const event of allEvents) {
      const key = `${event.sport}|${event.startUtcEpochSeconds}|${event.title.toLocaleLowerCase("en-US")}`;
      const existing = mergedEvents.get(key);
      if (!existing) {
        mergedEvents.set(key, event);
      } else {
        existing.broadcasts = [...existing.broadcasts, ...event.broadcasts]
          .filter((broadcast, index, all) => all.findIndex((candidate) =>
            candidate.territory === broadcast.territory &&
            candidate.channelName.toLocaleLowerCase("en-US") === broadcast.channelName.toLocaleLowerCase("en-US")
          ) === index);
        existing.homeTeam ??= event.homeTeam;
        existing.awayTeam ??= event.awayTeam;
        existing.competition ??= event.competition;
      }
    }
    feed.events = [...mergedEvents.values()]
      .sort((left, right) => left.startUtcEpochSeconds - right.startUtcEpochSeconds)
      .slice(0, 100);
    console.log(`Collected ${formulaOneEvents.length} official Formula 1 and ${nbaEvents.length} official basketball events`);
  } catch (error) {
    console.error(`Official source batch failed safely: ${error.message}`);
  }
  validateFeed(feed, nowEpochSeconds);

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(feed, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  console.log(`Published ${feed.events.length} multi-sport events from ${successfulRequests}/${totalRequests} successful requests`);
}

await main();
