import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFeed, validateFeed } from "./feed-core.mjs";

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
  { query: "Morocco", territory: "MA" }
];
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_CHARACTERS = 1_000_000;

function utcDate(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function fetchCountryDay(country, date) {
  const parameters = new URLSearchParams({ d: date, s: "Soccer", a: country.query });
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
      __territory: country.territory
    }));
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const aliasesByChannel = JSON.parse(await readFile(aliasesPath, "utf8"));
  const dates = [utcDate(0), utcDate(1), utcDate(2)];
  const records = [];
  let successfulRequests = 0;
  const totalRequests = dates.length * countries.length;

  for (const date of dates) {
    for (const country of countries) {
      try {
        records.push(...await fetchCountryDay(country, date));
        successfulRequests += 1;
      } catch (error) {
        console.error(`Source failed for ${country.territory} on ${date}: ${error.message}`);
      }
    }
  }

  if (successfulRequests < Math.ceil(totalRequests * 0.8)) {
    throw new Error(`Only ${successfulRequests}/${totalRequests} source requests succeeded; keeping the previous feed`);
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const feed = buildFeed(records, aliasesByChannel, nowEpochSeconds);
  validateFeed(feed, nowEpochSeconds);

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(feed, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  console.log(`Published ${feed.events.length} football events from ${successfulRequests}/${totalRequests} successful requests`);
}

await main();
