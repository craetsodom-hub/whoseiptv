import { canonicalChannelIdentity, cleanAliases } from "./normalize.mjs";
import { eventIdentityEvidence } from "./identity.mjs";
import { strongerSource } from "./source-priority.mjs";
import { isSupportedTerritory } from "../territories.mjs";

export const MAX_BROADCASTS_PER_EVENT = 256;
const TIME_TOLERANCE_SECONDS = 15 * 60;

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
  return eventIdentityEvidence(event, candidate, toleranceSeconds) !== null;
}

function normalizeAssignment(item) {
  const rawChannelName = String(item?.channelName ?? "").trim();
  const region = String(item?.region ?? "").trim() || undefined;
  const displayRegion = String(item?.displayRegion ?? "").trim() || undefined;
  const territories = broadcastTerritories(item);
  const channelName = rawChannelName;
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
    ...(item.destinationVerified === true ? { destinationVerified: true } : {}),
    rightsHolder: item.rightsHolder,
    eventMatchingMethod: item.eventMatchingMethod,
    eventMatchConfidence: item.eventMatchConfidence
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

function trustedScheduleForEvent(event, broadcast) {
  if (broadcast.sourceType === "official-event") return true;
  if (!["official-broadcaster-schedule", "official-network-selection"].includes(broadcast.sourceType) || broadcast.destinationVerified !== true) return false;
  const channel = canonicalChannelIdentity(broadcast.channelName);
  const declaredHolder = canonicalChannelIdentity(broadcast.rightsHolder);
  return broadcastTerritories(broadcast).some((territory) => (event.broadcastRights ?? []).find((right) => right.territory === territory)?.holders.some((holder) => {
    const identity = canonicalChannelIdentity(holder.name);
    return channel.startsWith(identity) || (declaredHolder && declaredHolder === identity);
  }) ?? false);
}

export function filterTrustedScheduleBroadcasts(events) {
  for (const event of events) {
    if (event.sport !== "football") continue;
    event.broadcasts = mergeExactBroadcasts((event.broadcasts ?? []).filter((broadcast) =>
      !["official-broadcaster-schedule", "official-network-selection"].includes(broadcast.sourceType) || trustedScheduleForEvent(event, broadcast)
    ));
  }
  return events;
}

export function resolveExactBroadcasts(events, scheduleCandidates) {
  const matchesByEvent = new Map(events.map((event) => [event, []]));
  for (const candidate of scheduleCandidates) {
    const possible = events.map((event) => ({ event, evidence: eventIdentityEvidence(event, candidate, TIME_TOLERANCE_SECONDS) }))
      .filter(({ evidence }) => evidence);
    if (possible.length === 0) continue;
    const bestScore = Math.max(...possible.map(({ evidence }) => evidence.score));
    const best = possible.filter(({ evidence }) => evidence.score === bestScore);
    if (best.length !== 1) continue;
    matchesByEvent.get(best[0].event).push({ candidate, evidence: best[0].evidence });
  }
  for (const event of events) {
    const matched = matchesByEvent.get(event).flatMap(({ candidate, evidence }) => (candidate.broadcasts ?? []).flatMap((broadcast) => {
        const resolved = {
          ...broadcast,
          eventMatchingMethod: evidence.matchingMethod,
          eventMatchConfidence: evidence.score
        };
        if (!broadcast.region) return [resolved];
        const allowed = new Set(broadcast.regionTerritories ?? []);
        const territories = (event.broadcastRights ?? []).filter((right) => allowed.has(right.territory) && right.holders.some((holder) =>
          canonicalChannelIdentity(holder.name) === canonicalChannelIdentity(broadcast.rightsHolder)
        )).map((right) => right.territory);
        return territories.length > 0 ? [{ ...resolved, territories }] : [];
      })).filter((broadcast) => trustedScheduleForEvent(event, broadcast));
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
