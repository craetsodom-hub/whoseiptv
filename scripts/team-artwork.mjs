import { canonicalChannelIdentity } from "./broadcast/normalize.mjs";

const TRUSTED_HOSTS = new Set(["r2.thesportsdb.com", "www.thesportsdb.com", "cdn.nba.com", "media.formula1.com", "assets.laliga.com", "images.mlssoccer.com"]);

export function trustedBadgeUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && TRUSTED_HOSTS.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function createTeamArtworkResolver({ fetchText, apiKey = "123", now = () => Date.now(), ttlMs = 7 * 24 * 60 * 60 * 1000, concurrency = 3, minIntervalMs = 250, maxRequests = 25, cache = new Map() } = {}) {
  if (typeof fetchText !== "function" || !Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(minIntervalMs) || minIntervalMs < 0 || !Number.isInteger(maxRequests) || maxRequests < 0) {
    throw new Error("Invalid team artwork resolver configuration");
  }
  const pending = new Map();
  let active = 0;
  let lastRequestAt = 0;
  let requests = 0;
  const queue = [];
  const schedule = (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    drain();
  });
  const drain = () => {
    while (active < concurrency && queue.length > 0) {
      const { task, resolve, reject } = queue.shift();
      active += 1;
      const delay = Math.max(0, lastRequestAt + minIntervalMs - now());
      Promise.resolve(delay ? new Promise((done) => setTimeout(done, delay)) : undefined)
        .then(() => { lastRequestAt = now(); return task(); })
        .then(resolve, reject).finally(() => { active -= 1; drain(); });
    }
  };
  const endpoint = (path, parameters) => `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/${path}.php?${new URLSearchParams(parameters)}`;
  const lookup = async (key, url, exactName) => {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.badgeUrl;
    if (pending.has(key)) return pending.get(key);
    if (requests >= maxRequests) return null;
    requests += 1;
    const request = schedule(async () => {
      try {
        const payload = JSON.parse(await fetchText(url));
        const teams = Array.isArray(payload?.teams) ? payload.teams : [];
        const team = exactName ? teams.find((candidate) => canonicalChannelIdentity(candidate?.strTeam) === canonicalChannelIdentity(exactName)) : teams[0];
        const badgeUrl = trustedBadgeUrl(team?.strTeamBadge);
        cache.set(key, { badgeUrl, expiresAt: now() + ttlMs });
        return badgeUrl;
      } catch {
        // Negative results are cached too, but a source outage is never
        // allowed to alter an otherwise valid fixture.
        cache.set(key, { badgeUrl: null, expiresAt: now() + Math.min(ttlMs, 60 * 60 * 1000) });
        return null;
      } finally {
        pending.delete(key);
      }
    });
    pending.set(key, request);
    return request;
  };
  return {
    cache,
    stats: () => ({ requests, maximumRequests: maxRequests }),
    async resolve(team) {
      if (!team || trustedBadgeUrl(team.badgeUrl)) return trustedBadgeUrl(team?.badgeUrl);
      const id = String(team.sourceIds?.thesportsdb ?? "").trim();
      if (id) return lookup(`id:${id}`, endpoint("lookupteam", { id }), null);
      const name = String(team.name ?? "").trim();
      if (!name) return null;
      // Name search is accepted only when the returned official record agrees
      // exactly after generic normalization; it never guesses a club badge.
      return lookup(`name:${canonicalChannelIdentity(name)}`, endpoint("searchteams", { t: name }), name);
    }
  };
}

export async function enrichTeamArtwork(events, resolver) {
  const teams = events.flatMap((event) => [event.homeTeam, event.awayTeam]).filter(Boolean);
  await Promise.all(teams.map(async (team) => {
    if (trustedBadgeUrl(team.badgeUrl)) return;
    const badgeUrl = await resolver.resolve(team);
    if (badgeUrl) team.badgeUrl = badgeUrl;
    else if (team.badgeUrl === undefined) team.badgeUrl = null;
  }));
  return events;
}
