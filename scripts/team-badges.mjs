import { readFile, writeFile } from "node:fs/promises";

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_SPACING_MS = 250;
const MAX_CONCURRENCY = 4;
const TRUSTED_HOSTS = new Set(["r2.thesportsdb.com", "www.thesportsdb.com"]);

function trustedBadgeUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && TRUSTED_HOSTS.has(url.hostname) ? value : null;
  } catch {
    return null;
  }
}

async function readCache(cachePath, nowMilliseconds) {
  try {
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    if (cache?.version !== CACHE_VERSION || typeof cache.entries !== "object" || !cache.entries) return {};
    return Object.fromEntries(Object.entries(cache.entries).filter(([teamId, entry]) =>
      /^\d+$/.test(teamId) && typeof entry?.expiresAt === "number" && entry.expiresAt > nowMilliseconds &&
      (entry.badgeUrl === null || trustedBadgeUrl(entry.badgeUrl))
    ));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function mapBounded(values, callback) {
  const results = new Map();
  let index = 0;
  async function worker() {
    while (index < values.length) {
      const value = values[index++];
      results.set(value, await callback(value));
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, values.length) }, worker));
  return results;
}

export async function enrichTeamBadges({ detailsByEvent, cachePath, fetchJson, nowMilliseconds = Date.now(), onError = () => {} }) {
  const cache = await readCache(cachePath, nowMilliseconds);
  const teamIds = [...new Set([...detailsByEvent.values()].flatMap((details) => [details?.idHomeTeam, details?.idAwayTeam])
    .map((id) => String(id ?? "").trim()).filter((id) => /^\d+$/.test(id)))];
  let nextStart = 0;
  const resolved = await mapBounded(teamIds.filter((id) => cache[id] === undefined), async (teamId) => {
    const delay = Math.max(0, nextStart - Date.now());
    nextStart = Math.max(nextStart, Date.now()) + REQUEST_SPACING_MS;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const payload = await fetchJson(teamId);
      return trustedBadgeUrl(payload?.teams?.[0]?.strBadge);
    } catch (error) {
      onError(teamId, error);
      return null;
    }
  });
  for (const [teamId, badgeUrl] of resolved) cache[teamId] = { badgeUrl, expiresAt: nowMilliseconds + CACHE_TTL_MS };
  for (const details of detailsByEvent.values()) {
    for (const [idField, badgeField] of [["idHomeTeam", "strHomeTeamBadge"], ["idAwayTeam", "strAwayTeamBadge"]]) {
      const teamId = String(details?.[idField] ?? "").trim();
      if (!trustedBadgeUrl(details?.[badgeField]) && cache[teamId]?.badgeUrl) details[badgeField] = cache[teamId].badgeUrl;
    }
  }
  await writeFile(cachePath, `${JSON.stringify({ version: CACHE_VERSION, entries: cache }, null, 2)}\n`, "utf8");
  return { requested: resolved.size, cached: teamIds.length - resolved.size, resolved: [...resolved.values()].filter(Boolean).length };
}
