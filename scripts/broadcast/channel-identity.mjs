import audioConfig from '../../config/channel-audio-evidence.json' with { type: 'json' };
// Broadcast identity is stricter than playlist spelling compatibility.
// Do not strip country/feed suffixes, language variants, channel numbers or 4K.
export function exactChannelKey(name) {
  return String(name ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}
export function stableChannelId(item) {
  const scope = item.region ? `region:${item.region}` : `territory:${item.territory}`;
  return `${scope.toLowerCase()}|${exactChannelKey(item.channelName)}|${(item.languages ?? []).slice().sort().join(',')}`;
}
export function verifiedLanguageEvidence(item) {
  const evidence = item?.languageEvidence;
  if (!evidence || !['event-audio', 'feed-audio'].includes(evidence.scope) || !Number.isFinite(Date.parse(evidence.verifiedAt))) return undefined;
  try {
    const url = new URL(evidence.sourceUrl), source = new URL(item.sourceUrl);
    const reviewed = audioConfig.rules.some(rule => rule.sourceUrl === url.href && rule.scope === evidence.scope &&
      rule.region === item.region && rule.channelNames.includes(item.channelName) && source.hostname === rule.scheduleHost &&
      Date.parse(evidence.verifiedAt) === Date.parse(rule.verifiedAt) && Date.now() < Date.parse(rule.reviewValidUntil) &&
      Array.isArray(item.languages) && item.languages.length > 0 && item.languages.every(code => rule.languages.includes(code)));
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        source.protocol !== 'https:' || source.username || source.password || source.port ||
        (source.hostname !== url.hostname && !reviewed)) return undefined;
  }
  catch { return undefined; }
  return { scope: evidence.scope, sourceUrl: evidence.sourceUrl, verifiedAt: evidence.verifiedAt };
}

export function reviewedChannelAudio(channelName, region, checkedAt) {
  const time = Date.parse(checkedAt);
  const rule = audioConfig.rules.find(rule => rule.channelNames.includes(channelName) && rule.region === region &&
    time >= Date.parse(rule.verifiedAt) && time < Date.parse(rule.reviewValidUntil));
  return rule ? { languages: rule.languages, languageEvidence: { scope: rule.scope, sourceUrl: rule.sourceUrl, verifiedAt: rule.verifiedAt } } : {};
}
