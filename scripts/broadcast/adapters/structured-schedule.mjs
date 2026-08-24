import { normalizeBroadcastText } from "../normalize.mjs";

function safeHttpsUrl(value, trustedHosts) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !trustedHosts.includes(url.hostname)) throw new Error("Untrusted official schedule URL");
  return url.toString();
}

// Official adapters translate their source-specific parser into this narrow
// candidate contract. Nothing is emitted unless both teams, competition,
// kickoff, territory, and an exact destination are present.
export function structuredScheduleAdapter({ id, url, trustedHosts, sourceType, parse }) {
  if (!["official-event", "official-broadcaster-schedule"].includes(sourceType)) throw new Error("Invalid exact-event source type");
  const sourceUrl = safeHttpsUrl(url, trustedHosts);
  return {
    id,
    async collect({ fetchText, verifiedAt }) {
      const rows = await parse(await fetchText(sourceUrl));
      return rows.map((row) => {
        const startUtcEpochSeconds = Math.floor(Date.parse(row.startUtc) / 1000);
        const broadcasts = (row.broadcasts ?? []).filter((item) => /^[A-Z]{2}$/.test(item.territory) && normalizeBroadcastText(item.channelName)).map((item) => ({
          ...item, sourceType, sourceUrl, verifiedAt, exclusive: item.exclusive === true
        }));
        if (!normalizeBroadcastText(row.competition) || !normalizeBroadcastText(row.homeTeam) || !normalizeBroadcastText(row.awayTeam) || !Number.isInteger(startUtcEpochSeconds) || broadcasts.length === 0) return null;
        return { competition: row.competition, homeTeam: row.homeTeam, awayTeam: row.awayTeam, startUtcEpochSeconds, broadcasts };
      }).filter(Boolean);
    }
  };
}
