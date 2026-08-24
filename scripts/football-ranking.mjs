const COMPETITIONS = [
  { score: 100, aliases: ["fifa world cup", "fifa world cup 2026", "uefa champions league", "uefa european championship", "uefa euro", "copa america"] },
  { score: 96, aliases: ["fifa club world cup"] },
  { score: 91, aliases: ["english premier league", "premier league", "spanish la liga", "la liga", "laliga", "uefa europa league", "copa libertadores", "africa cup of nations", "afcon", "fifa world cup qualifying", "world cup qualification"] },
  { score: 84, aliases: ["italian serie a", "serie a", "german bundesliga", "bundesliga", "french ligue 1", "ligue 1", "uefa nations league", "uefa conference league", "uefa europa conference league", "brasileirao serie a", "campeonato brasileiro serie a", "afc champions league elite", "caf champions league"] },
  { score: 81, aliases: ["fa cup", "copa del rey", "coppa italia", "dfb pokal", "coupe de france"] },
  { score: 75, aliases: ["saudi pro league", "primeira liga", "eredivisie", "super lig", "liga mx", "argentine primera division", "argentina primera division", "major league soccer", "mls", "belgian pro league", "scottish premiership"] },
  { score: 45, aliases: ["international friendly", "friendly"] }
];

const TEAMS = [
  { score: 100, aliases: ["real madrid", "fc barcelona", "barcelona", "manchester united", "liverpool", "bayern munich", "bayern munchen", "manchester city"] },
  { score: 96, aliases: ["arsenal", "paris saint germain", "psg", "chelsea", "juventus", "inter milan", "internazionale", "ac milan", "milan"] },
  { score: 91, aliases: ["atletico madrid", "borussia dortmund", "tottenham hotspur", "tottenham", "napoli", "roma", "benfica", "porto", "ajax", "flamengo", "palmeiras", "corinthians", "river plate", "boca juniors", "al nassr", "al hilal"] },
  { score: 84, aliases: ["bayer leverkusen", "olympique de marseille", "marseille", "sporting cp", "sporting lisbon", "feyenoord", "galatasaray", "fenerbahce", "newcastle united", "newcastle", "aston villa", "sevilla", "al ittihad", "al ahli", "inter miami", "psv eindhoven", "psv", "club america", "monterrey", "tigres uanl", "celtic"] },
  { score: 76, aliases: ["pumas unam", "pumas", "cruz azul", "chivas guadalajara", "gremio", "sao paulo", "santos", "vasco da gama", "racing club", "independiente"] },
  { score: 100, aliases: ["brazil", "argentina", "france", "spain", "england", "germany", "portugal", "italy", "netherlands"] },
  { score: 88, aliases: ["morocco", "mexico", "united states", "usa", "japan", "south korea", "senegal", "nigeria", "algeria", "egypt", "colombia", "uruguay", "croatia", "saudi arabia", "australia"] }
];

const EXCLUDED_COMPETITION_TOKENS = new Set(["women", "womens", "female", "youth", "reserve", "reserves", "academy", "u17", "u18", "u19", "u20", "u21", "u23", "ii"]);

export function normalizeFootballName(value) {
  return String(value ?? "").normalize("NFD").replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function exactScore(value, groups, fallback) {
  const normalized = normalizeFootballName(value);
  return groups.find((group) => group.aliases.some((alias) => normalizeFootballName(alias) === normalized))?.score ?? fallback;
}

export function competitionPopularity(value) {
  const normalized = normalizeFootballName(value);
  if (normalized.split(" ").some((token) => EXCLUDED_COMPETITION_TOKENS.has(token))) return 20;
  const exact = exactScore(normalized, COMPETITIONS, null);
  if (exact !== null) return exact;
  const withoutSeason = normalized.replace(/\s+(?:19|20)\d{2}(?:\s+(?:19|20)?\d{2})?$/, "");
  return exactScore(withoutSeason, COMPETITIONS, 35);
}

export function teamPopularity(value) {
  return exactScore(value, TEAMS, 20);
}

export function matchSignificance(event) {
  const text = normalizeFootballName(`${event?.competition ?? ""} ${event?.title ?? ""}`);
  if (/\bfinal\b/.test(text) && !/\bsemi ?final\b|\bquarter ?final\b/.test(text)) return 4;
  if (/\bsemi ?final\b/.test(text)) return 3;
  if (/\bquarter ?final\b|\bround of 16\b/.test(text)) return 2;
  if (/\bplay off\b|\bplayoff\b/.test(text)) return 1;
  return 0;
}

function teamNames(event) {
  if (event?.homeTeam?.name && event?.awayTeam?.name) return [event.homeTeam.name, event.awayTeam.name];
  return String(event?.title ?? "").split(/\s+(?:vs?\.?|at)\s+/i).slice(0, 2);
}

export function footballImportance(event) {
  const scores = teamNames(event).map(teamPopularity).sort((a, b) => b - a);
  const clubScore = (scores[0] ?? 20) * 0.65 + (scores[1] ?? 20) * 0.35;
  return Number((competitionPopularity(event?.competition) * 0.6 + clubScore * 0.4 + matchSignificance(event)).toFixed(3));
}

export function compareEvents(left, right) {
  if (left.sport === "football" && right.sport === "football") {
    const importance = footballImportance(right) - footballImportance(left);
    if (importance !== 0) return importance;
  }
  return left.startUtcEpochSeconds - right.startUtcEpochSeconds || String(left.id).localeCompare(String(right.id), "en-US");
}
