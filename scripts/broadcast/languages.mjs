export function normalizeBroadcastLanguages(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item ?? "").trim().toLowerCase())
    .filter((code) => /^[a-z]{2}$/.test(code)))].slice(0, 8);
}

export function beinMenaLanguages(channelName) {
  return []; // Channel branding does not establish commentary audio.
}
