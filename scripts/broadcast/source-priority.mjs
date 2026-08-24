export const SOURCE_PRIORITY = Object.freeze({
  "official-event": 400,
  "official-all-events": 350,
  "official-broadcaster-schedule": 300,
  "official-network-selection": 250,
  "official-rights": 200,
  "source-event": 100
});

export function sourcePriority(value) {
  return SOURCE_PRIORITY[value] ?? 0;
}

export function strongerSource(left, right) {
  const difference = sourcePriority(right?.sourceType) - sourcePriority(left?.sourceType);
  if (difference !== 0) return difference;
  return String(left?.sourceUrl ?? "").localeCompare(String(right?.sourceUrl ?? ""), "en-US");
}
