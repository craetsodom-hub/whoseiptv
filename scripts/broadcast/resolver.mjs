import { canonicalChannelIdentity, cleanAliases, normalizeBroadcastText } from "./normalize.mjs";
import { strongerSource } from "./source-priority.mjs";
import { isSupportedTerritory } from "../territories.mjs";

export const MAX_BROADCASTS_PER_EVENT = 256;
const TIME_TOLERANCE_SECONDS = 15 * 60;
const TEAM_ALIASES = new Map([
  ["inter", "internazionale"], ["inter milan", "internazionale"], ["fc internazionale milano", "internazionale"],
  ["bayern munchen", "bayern munich"], ["paris saint germain", "psg"], ["man city", "manchester city"],
  ["spurs", "tottenham hotspur"], ["tottenham", "tottenham hotspur"], ["brighton", "brighton and hove albion"],
  ["newcastle", "newcastle united"], ["athletic", "athletic club"], ["celta", "celta vigo"], ["lyon", "olympique lyonnais"]
]);
const COMPETITION_ALIASES = new Map([
  ["laliga", "laliga"], ["laliga ea sports", "laliga"], ["spanish la liga", "laliga"], ["la liga", "laliga"],
  ["english premier league", "premier league"]
]);

function teamIdentity(value) {
  const normalized = normalizeBroadcastText(value).replace(/\b(?:fc|cf|afc)\b/g, " ").replace(/\s+/g, " ").trim();
  return TEAM_ALIASES.get(normalized) ?? normalized;
}

function competitionIdentity(value) {
  const normalized = normalizeBroadcastText(value).replace(/\s+(?:19|20)\d{2}(?:\s+(?:19|20)?\d{2})?$/, "");
  return COMPETITION_ALIASES.get(normalized) ?? normalized;
}

export function broadcastTerritories(item) {
  const territories = [...new Set([
    ...(Array.isArray(item?.territories) ? item.territories : []),
    item?.territory
  ].map((territory) => String(territory ?? "").trim().toUpperCase()).filter(isSupportedTerritory))];
  return territories.sort();
}

export function broadcastScopeKey(item) {
  const territories = broadcastTerritories(item);
  if (item?.region) return `region:${String(item.region).trim().toLowerCase()}`;
  return `territory:${territories[0] ?? ""}`;
}

export function matchesEvent(event, candidate, toleranceSeconds = TIME_TOLERANCE_SECONDS) {
  if (competitionIdentity(event?.competition) !== competitionIdentity(candidate?.competition)) return false;
  if (!Number.isInteger(event?.startUtcEpochSeconds) || !Number.isInteger(candidate?.startUtcEpochSeconds) ||
      Math.abs(event.startUtcEpochSeconds - candidate.startUtcEpochSeconds) > toleranceSeconds) return false;
  const eventTeams = [teamIdentity(event?.homeTeam?.name), teamIdentity(event?.awayTeam?.name)].sort();
  const candidateTeams = [teamIdentity(candidate?.homeTeam), teamIdentity(candidate?.awayTeam)].sort();
  return eventTeams.every(Boolean) && candidateTeams.every(Boolean) && eventTeams[0] === candidateTeams[0] && eventTeams[1] === candidateTeams[1];
}

function normalizeAssignment(item) {
  const rawChannelName = String(item?.channelName ?? "").trim();
  const region = String(item?.region ?? "").trim() || undefined;
  const displayRegion = String(item?.displayRegion ?? "").trim() || undefined;
  const territories = broadcastTerritories(item);
  const channelName = region && displayRegion && !rawChannelName.endsWith(` ${displayRegion}`) ? `${rawChannelName} ${displayRegion}` : rawChannelName;
  if (!channelName || territories.length === 0 || (region && !displayRegion)) return null;
  return {
    channelName,
    aliases: cleanAliases(channelName, item.aliases ?? []),
    ...(region ? { region, displayRegion, territories } : { territory: territories[0] }),
    confirmed: true,
    sourceType: item.sourceType ?? "source-event",
    matchingMethod: item.matchingMethod ?? item.ruleType ?? item.sourceType ?? "source-event-id",
    sourceUrl: item.sourceUrl,
    verifiedAt: item.verifiedAt,
    exclusive: item.exclusive === true,
    destinationType: item.destinationType,
    ruleType: item.ruleType,
    destinationPrecision: item.destinationPrecision ?? "channel",
    rightsHolder: item.rightsHolder
  };
}

export function mergeExactBroadcasts(...collections) {
  const candidates = collections.flat().map(normalizeAssignment).filter(Boolean).sort(strongerSource);
  const accepted = [];
  for (const candidate of candidates) {
    const scope = broadcastScopeKey(candidate);
    if (candidate.destinationPrecision === "network" && accepted.some((item) => broadcastScopeKey(item) === scope &&
      item.destinationPrecision === "channel" && canonicalChannelIdentity(item.channelName).startsWith(canonicalChannelIdentity(candidate.channelName)))) continue;
    const strongerExclusive = accepted.some((item) => broadcastScopeKey(item) === scope && item.exclusive && strongerSource(item, candidate) <= 0);
    if (strongerExclusive) continue;
    if (candidate.exclusive) {
      for (let index = accepted.length - 1; index >= 0; index -= 1) {
        if (broadcastScopeKey(accepted[index]) === scope && strongerSource(accepted[index], candidate) > 0) accepted.splice(index, 1);
      }
    }
    const key = `${scope}|${canonicalChannelIdentity(candidate.channelName)}`;
    const existing = accepted.find((item) => `${broadcastScopeKey(item)}|${canonicalChannelIdentity(item.channelName)}` === key);
    if (existing) {
      existing.aliases = cleanAliases(existing.channelName, [...existing.aliases, candidate.channelName, ...candidate.aliases]);
      if (existing.region) existing.territories = [...new Set([...existing.territories, ...candidate.territories])].sort();
      continue;
    }
    accepted.push(candidate);
  }
  const groups = new Map();
  for (const item of accepted) {
    const scope = broadcastScopeKey(item);
    groups.set(scope, [...(groups.get(scope) ?? []), item]);
  }
  const balanced = [];
  const scopes = [...groups.keys()].sort();
  for (let index = 0; balanced.length < MAX_BROADCASTS_PER_EVENT; index += 1) {
    let added = false;
    for (const scope of scopes) {
      const item = groups.get(scope)[index];
      if (item && balanced.length < MAX_BROADCASTS_PER_EVENT) {
        balanced.push(item);
        added = true;
      }
    }
    if (!added) break;
  }
  return balanced;
}

export function resolveExactBroadcasts(events, scheduleCandidates) {
  for (const event of events) {
    const matched = scheduleCandidates.filter((candidate) => matchesEvent(event, candidate))
      .flatMap((candidate) => (candidate.broadcasts ?? []).flatMap((broadcast) => {
        if (!broadcast.region) return [broadcast];
        const allowed = new Set(broadcast.regionTerritories ?? []);
        const territories = (event.broadcastRights ?? []).filter((right) => allowed.has(right.territory) && right.holders.some((holder) =>
          canonicalChannelIdentity(holder.name) === canonicalChannelIdentity(broadcast.rightsHolder)
        )).map((right) => right.territory);
        return territories.length > 0 ? [{ ...broadcast, territories }] : [];
      })).filter((broadcast) => {
        if (broadcast.sourceType === "official-event") return true;
        if (!["official-broadcaster-schedule", "official-network-selection"].includes(broadcast.sourceType)) return false;
        const channel = canonicalChannelIdentity(broadcast.channelName);
        const declaredHolder = canonicalChannelIdentity(broadcast.rightsHolder);
        return broadcastTerritories(broadcast).some((territory) => (event.broadcastRights ?? []).find((right) => right.territory === territory)?.holders.some((holder) => {
          const identity = canonicalChannelIdentity(holder.name);
          return channel.startsWith(identity) || (declaredHolder && declaredHolder === identity);
        }) ?? false);
      });
    event.broadcasts = mergeExactBroadcasts(event.broadcasts ?? [], matched);
  }
  return events;
}

export function canonicalizeRegionalBroadcasts(events) {
  for (const event of events) {
    const groups = new Map();
    const retained = [];
    for (const broadcast of event.broadcasts ?? []) {
      const isMenaEpg = broadcast.sourceType === "official-broadcaster-schedule" &&
        /beinsports\.com\/api\/opta\/tv-event\?region=en-mena/i.test(broadcast.sourceUrl ?? "") &&
        /^beIN SPORTS (?:\d+|EN [12])$/i.test(broadcast.channelName ?? "") && isSupportedTerritory(broadcast.territory);
      if (!isMenaEpg) {
        retained.push(broadcast);
        continue;
      }
      const key = [broadcast.channelName, broadcast.sourceUrl, broadcast.matchingMethod].join("|");
      groups.set(key, [...(groups.get(key) ?? []), broadcast]);
    }
    const regional = [...groups.values()].map((items) => ({
      ...items[0],
      region: "Arabic",
      displayRegion: "AR",
      territories: items.map((item) => item.territory)
    }));
    event.broadcasts = mergeExactBroadcasts(retained, regional);
  }
  return events;
}

export async function collectAdaptersSafely(adapters, context, onError = () => {}) {
  const results = await Promise.allSettled(adapters.map((adapter) => adapter.collect(context)));
  return results.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    onError(adapters[index].id, result.reason);
    return [];
  });
}
