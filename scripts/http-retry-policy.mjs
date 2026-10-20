// Retry-After can be delta seconds or an HTTP date. Never shorten a provider's
// requested pause to the application's ordinary backoff interval.
export function retryAfterMilliseconds(value, now = Date.now()) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}
export function retryDelayMilliseconds(error, attempt) {
  const fallback = error?.status === 429 ? 15_000 * (attempt + 1) : 2_000 * (attempt + 1);
  return Number.isFinite(error?.retryAfterMs) ? Math.max(fallback, error.retryAfterMs) : fallback;
}
