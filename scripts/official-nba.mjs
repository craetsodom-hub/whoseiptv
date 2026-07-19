const NBA_GAMES_URL = "https://www.nba.com/games?date=";
const MAX_PAST_SECONDS = 6 * 60 * 60;
const MAX_FUTURE_SECONDS = 8 * 24 * 60 * 60;

function normalizedName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function aliasesFor(channelName, aliasesByChannel) {
  const key = normalizedName(channelName);
  const entry = Object.entries(aliasesByChannel).find(
    ([candidate]) => normalizedName(candidate) === key
  );
  return [...new Set(entry?.[1] ?? [])].slice(0, 8);
}

function nextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match) throw new Error("NBA schedule data is missing");
  return JSON.parse(match[1]);
}

function broadcasterEntries(card, aliasesByChannel) {
  const broadcasters = card.broadcasters ?? {};
  const entries = [];
  for (const [key, values] of Object.entries(broadcasters)) {
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      const channelName = String(value?.broadcasterDisplayName ?? "").trim();
      if (!channelName) continue;
      const region = String(value?.broadcasterLocalizationRegion ?? "").toUpperCase();
      const territory = key.startsWith("intl") && /^[A-Z]{2}$/.test(region) ? region : "US";
      entries.push({
        channelName,
        aliases: aliasesFor(channelName, aliasesByChannel),
        territory,
        confirmed: true
      });
    }
  }
  return entries.filter((broadcast, index, all) =>
    all.findIndex((candidate) => candidate.territory === broadcast.territory &&
      normalizedName(candidate.channelName) === normalizedName(broadcast.channelName)) === index
  );
}

function cardEvents(data, nowEpochSeconds, aliasesByChannel) {
  const earliest = nowEpochSeconds - MAX_PAST_SECONDS;
  const latest = nowEpochSeconds + MAX_FUTURE_SECONDS;
  const cards = data?.props?.pageProps?.gameCardFeed?.modules?.flatMap((module) => module.cards ?? []) ?? [];
  return cards.map((item) => item.cardData).map((card) => {
    const start = Math.floor(Date.parse(card?.gameTimeUtc ?? "") / 1000);
    const home = card?.homeTeam?.teamName;
    const away = card?.awayTeam?.teamName;
    const title = home && away ? `${away} vs ${home}` : card?.heroConfiguration?.headline;
    const broadcasts = broadcasterEntries(card, aliasesByChannel);
    if (!card?.gameId || !title || !Number.isInteger(start) || start < earliest || start > latest || broadcasts.length === 0) {
      return null;
    }
    return {
      id: `nba-${card.gameId}`,
      title: String(title).slice(0, 200),
      sport: "basketball",
      competition: String(card.cardHat ?? card.seasonType ?? "NBA").slice(0, 120),
      startUtcEpochSeconds: start,
      status: "confirmed",
      broadcasts
    };
  }).filter(Boolean);
}

export function parseNbaSchedulePage(html, nowEpochSeconds, aliasesByChannel = {}) {
  return cardEvents(nextData(html), nowEpochSeconds, aliasesByChannel);
}

export async function collectNbaEvents({ fetchText, nowEpochSeconds, aliasesByChannel }) {
  const dates = [0, 1].map((offset) => {
    const date = new Date((nowEpochSeconds + offset * 24 * 60 * 60) * 1000);
    return date.toISOString().slice(0, 10);
  });
  const events = [];
  for (const date of dates) {
    events.push(...parseNbaSchedulePage(
      await fetchText(`${NBA_GAMES_URL}${date}`),
      nowEpochSeconds,
      aliasesByChannel
    ));
  }
  return events;
}
