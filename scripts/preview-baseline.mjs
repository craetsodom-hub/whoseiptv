import { validateFeed } from './feed-core.mjs';

// A failed/expired shared feed cannot block independent official adapters or
// acquire a new lifetime just because fresh fixtures were collected elsewhere.
export function previewBaseline(previous, now) {
  if (!Number.isSafeInteger(previous?.generatedAtEpochSeconds) || !Number.isSafeInteger(previous?.validUntilEpochSeconds) ||
      previous.generatedAtEpochSeconds <= 0 || previous.validUntilEpochSeconds - previous.generatedAtEpochSeconds > 43200)
    return { events: [], state: 'invalid', expires: null };
  try { validateFeed(previous, previous?.generatedAtEpochSeconds); }
  catch { return { events: [], state: 'invalid', expires: null }; }
  if (previous.generatedAtEpochSeconds > now || previous.validUntilEpochSeconds <= now || now - previous.generatedAtEpochSeconds > 43200)
    return { events: [], state: 'expired', expires: null };
  return { events: previous.events, state: 'ready', expires: previous.validUntilEpochSeconds };
}
