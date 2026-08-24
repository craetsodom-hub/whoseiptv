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

function teamIdentity(value) {
  const normalized = normalizeBroadcastText(value).replace(/\b(?:fc|cf|afc)\b/g, " ").replace(/\s+/g, " ").trim();
  return TEAM_ALIASES.get(normalized) ?? normalized;
}

function competitionIdentity(value) {
  return normalizeBroadcastText(value).replace(/\s+(?:19|20)\d{2}(?:\s+(?:19|20)?\d{2})?$/, "");
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
  const channelName = String(item?.channelName ?? "").trim();
  const territory = String(item?.territory ?? "").trim().toUpperCase();
  if (!channelName || !isSupportedTerritory(territory)) return null;
  return {
    channelName,
    aliases: cleanAliases(channelName, item.aliases ?? []),
    territory,
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
    if (candidate.destinationPrecision === "network" && accepted.some((item) => item.territory === candidate.territory &&
      item.destinationPrecision === "channel" && canonicalChannelIdentity(item.channelName).startsWith(canonicalChannelIdentity(candidate.channelName)))) continue;
    const strongerExclusive = accepted.some((item) => item.territory === candidate.territory && item.exclusive && strongerSource(item, candidate) <= 0);
    if (strongerExclusive) continue;
    if (candidate.exclusive) {
      for (let index = accepted.length - 1; index >= 0; index -= 1) {
        if (accepted[index].territory === candidate.territory && strongerSource(accepted[index], candidate) > 0) accepted.splice(index, 1);
      }
    }
    const key = `${candidate.territory}|${canonicalChannelIdentity(candidate.channelName)}`;
    const existing = accepted.find((item) => `${item.territory}|${canonicalChannelIdentity(item.channelName)}` === key);
    if (existing) {
      existing.aliases = cleanAliases(existing.channelName, [...existing.aliases, candidate.channelName, ...candidate.aliases]);
      continue;
    }
    accepted.push(candidate);
  }
  const groups = new Map();
  for (const item of accepted) groups.set(item.territory, [...(groups.get(item.territory) ?? []), item]);
  const balanced = [];
  const territories = [...groups.keys()].sort();
  for (let index = 0; balanced.length < MAX_BROADCASTS_PER_EVENT; index += 1) {
    let added = false;
    for (const territory of territories) {
      const item = groups.get(territory)[index];
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
        return (event.broadcastRights ?? []).filter((right) => allowed.has(right.territory) && right.holders.some((holder) =>
          canonicalChannelIdentity(holder.name) === canonicalChannelIdentity(broadcast.rightsHolder)
        )).map((right) => ({ ...broadcast, territory: right.territory }));
      })).filter((broadcast) => {
        if (broadcast.sourceType === "official-event") return true;
        if (!["official-broadcaster-schedule", "official-network-selection"].includes(broadcast.sourceType)) return false;
        const rights = (event.broadcastRights ?? []).find((right) => right.territory === broadcast.territory);
        const channel = canonicalChannelIdentity(broadcast.channelName);
        const declaredHolder = canonicalChannelIdentity(broadcast.rightsHolder);
        return rights?.holders.some((holder) => {
          const identity = canonicalChannelIdentity(holder.name);
          return channel.startsWith(identity) || (declaredHolder && declaredHolder === identity);
        }) ?? false;
      });
    event.broadcasts = mergeExactBroadcasts(event.broadcasts ?? [], matched);
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
