export const SOURCE_PRIORITY = Object.freeze({
  "official-event": 400,
  // A first-party fixture schedule is Level 1 evidence and must win when it
  // identifies the same destination as a broader all-event entitlement.
  "official-broadcaster-schedule": 390,
  "official-network-selection": 380,
  "official-all-events": 350,
  "official-rights": 200,
  "source-event": 100
});

export function sourcePriority(value) {
  return SOURCE_PRIORITY[value] ?? 0;
}

export function strongerSource(left, right) {
  const difference = sourcePriority(right?.sourceType) - sourcePriority(left?.sourceType);
  if (difference !== 0) return difference;
  const source = String(left?.sourceUrl ?? "").localeCompare(String(right?.sourceUrl ?? ""), "en-US");
  if (source !== 0) return source;
  const confidence = Number(right?.eventMatchConfidence ?? 0) - Number(left?.eventMatchConfidence ?? 0);
  if (confidence !== 0) return confidence;
  const channel = String(left?.channelName ?? "").localeCompare(String(right?.channelName ?? ""), "en-US");
  if (channel !== 0) return channel;
  const territory = String(left?.territory ?? "").localeCompare(String(right?.territory ?? ""), "en-US");
  if (territory !== 0) return territory;
  return String(left?.matchingMethod ?? "").localeCompare(String(right?.matchingMethod ?? ""), "en-US");
}
