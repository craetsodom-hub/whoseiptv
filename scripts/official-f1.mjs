const CALENDAR_BASE = "https://www.formula1.com/en/racing";
const BROADCASTERS_URL = "https://www.formula1.com/en/information/f1-broadcasters.1eqG3L8AlJATj7icjBtrfN";
const MAX_PAST_SECONDS = 6 * 60 * 60;
const MAX_FUTURE_SECONDS = 8 * 24 * 60 * 60;

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedName(value) {
  return decodeHtml(value)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildEnglishRegionIndex() {
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
  const index = new Map();
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      const name = displayNames.of(code);
      if (name && name !== code && !index.has(normalizedName(name))) {
        index.set(normalizedName(name), code);
      }
    }
  }
  return index;
}

const regionIndex = buildEnglishRegionIndex();
const regionOverrides = new Map([
  ["united kingdom of great britain and northern ireland", "GB"],
  ["united kingdom", "GB"],
  ["united states", "US"],
  ["korea south", "KR"],
  ["chinese taipei", "TW"],
  ["russia", "RU"],
  ["vietnam", "VN"]
]);

function territoryForCountry(value) {
  const normalized = normalizedName(value.replace(/\s*\([^)]*\)\s*/g, " "));
  return regionOverrides.get(normalized) ?? regionIndex.get(normalized) ?? null;
}

function splitBroadcasters(value) {
  return decodeHtml(value)
    .split(/\s+(?:&|\/|and)\s+/i)
    .map((name) => name.trim())
    .filter(Boolean);
}

function aliasesFor(channelName, aliasesByChannel) {
  const key = normalizedName(channelName);
  const entry = Object.entries(aliasesByChannel).find(
    ([candidate]) => normalizedName(candidate) === key
  );
  return [...new Set(entry?.[1] ?? [])].slice(0, 8);
}

export function parseFormulaOneBroadcasters(html, aliasesByChannel = {}) {
  const broadcasts = [];
  const rows = html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => decodeHtml(match[1]));
    if (cells.length < 2) continue;
    const territory = territoryForCountry(cells[0]);
    if (!territory) continue;
    for (const channelName of splitBroadcasters(cells[1])) {
      if (/to be confirmed/i.test(channelName)) continue;
      broadcasts.push({
        channelName: channelName.slice(0, 120),
        aliases: aliasesFor(channelName, aliasesByChannel),
        territory,
        confirmed: true
      });
    }
  }
  return broadcasts.filter((broadcast, index, all) =>
    all.findIndex((candidate) => candidate.territory === broadcast.territory &&
      normalizedName(candidate.channelName) === normalizedName(broadcast.channelName)) === index
  );
}

export function extractFormulaOneRaceLinks(html, year) {
  const links = new Set();
  const pattern = new RegExp(`href=["'](/en/racing/${year}/[a-z0-9-]+)["']`, "gi");
  for (const match of html.matchAll(pattern)) links.add(`https://www.formula1.com${match[1]}`);
  return [...links];
}

function jsonLdObjects(html) {
  const objects = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1]);
      if (Array.isArray(value)) objects.push(...value);
      else if (Array.isArray(value?.["@graph"])) objects.push(...value["@graph"]);
      else if (value) objects.push(value);
    } catch {
      // A malformed structured-data block is ignored; the source health gate
      // will prevent an empty collection from replacing a valid feed.
    }
  }
  return objects;
}

function stableSlug(value) {
  return normalizedName(value).replace(/\s+/g, "-").slice(0, 100);
}

function officialArtworkUrl(value) {
  const url = typeof value === "string" ? value : value?.url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "media.formula1.com"
      ? parsed.toString().slice(0, 300)
      : null;
  } catch {
    return null;
  }
}

export function parseFormulaOneRacePage(html, broadcasts, nowEpochSeconds) {
  const earliest = nowEpochSeconds - MAX_PAST_SECONDS;
  const latest = nowEpochSeconds + MAX_FUTURE_SECONDS;
  const events = [];
  for (const root of jsonLdObjects(html)) {
    if (root?.["@type"] !== "SportsEvent") continue;
    for (const session of root.subEvent ?? []) {
      const name = decodeHtml(session?.name);
      if (!/^(race|sprint)\s*-/i.test(name)) continue;
      const startUtcEpochSeconds = Math.floor(Date.parse(session.startDate) / 1000);
      if (!Number.isInteger(startUtcEpochSeconds) || startUtcEpochSeconds < earliest || startUtcEpochSeconds > latest) {
        continue;
      }
      events.push({
        id: `f1-${stableSlug(session["@id"] ?? name)}-${startUtcEpochSeconds}`,
        title: name.replace(/^Race\s*-\s*/i, "").trim(),
        sport: "formula1",
        competition: "Formula 1",
        startUtcEpochSeconds,
        status: "confirmed",
        broadcasts,
        artworkUrl: officialArtworkUrl(session.image) ?? officialArtworkUrl(root.image)
      });
    }
  }
  return events;
}

export async function collectFormulaOneEvents({ fetchText, nowEpochSeconds, aliasesByChannel }) {
  const years = [...new Set([
    new Date(nowEpochSeconds * 1000).getUTCFullYear(),
    new Date((nowEpochSeconds + MAX_FUTURE_SECONDS) * 1000).getUTCFullYear()
  ])];
  const broadcasterHtml = await fetchText(BROADCASTERS_URL);
  const broadcasts = parseFormulaOneBroadcasters(broadcasterHtml, aliasesByChannel);
  if (broadcasts.length < 10) throw new Error("Formula 1 broadcaster table is incomplete");

  const raceLinks = new Set();
  for (const year of years) {
    const calendarHtml = await fetchText(`${CALENDAR_BASE}/${year}`);
    for (const link of extractFormulaOneRaceLinks(calendarHtml, year)) raceLinks.add(link);
  }
  if (raceLinks.size < 10) throw new Error("Formula 1 calendar is incomplete");

  const events = [];
  for (const link of raceLinks) {
    const raceHtml = await fetchText(link);
    events.push(...parseFormulaOneRacePage(raceHtml, broadcasts, nowEpochSeconds));
  }
  return events;
}
