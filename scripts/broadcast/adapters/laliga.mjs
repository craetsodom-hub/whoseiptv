import { decodeHtml, parseRows, scheduleAdapter, teamPair, timestamp } from "./common.mjs";

export const LALIGA_URL = "https://www.laliga.com/laliga-easports/resultados";
const OPERATOR = /^(?:DAZN|Movistar LALIGA)$/i;

export function parseLaligaSemanticTable(html) {
  const rows = [...String(html ?? "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
  if (rows.length < 2) return [];
  const headers = [...rows[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((match) => decodeHtml(match[1]).toLocaleUpperCase("es-ES"));
  const indexes = { date: headers.indexOf("FECHA"), time: headers.indexOf("HORARIO"), match: headers.indexOf("PARTIDO"), operator: headers.indexOf("OPERADOR") };
  if (Object.values(indexes).some((index) => index < 0)) return [];
  return rows.slice(1).map((row) => {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => match[1]);
    if (cells.length <= Math.max(...Object.values(indexes))) return null;
    const teams = teamPair({ title: decodeHtml(cells[indexes.match]) });
    const operator = decodeHtml(cells[indexes.operator]);
    const datetime = `${cells[indexes.date]} ${cells[indexes.time]}`.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1];
    const startUtcEpochSeconds = timestamp(datetime);
    if (!teams || !startUtcEpochSeconds || !OPERATOR.test(operator)) return null;
    return { ...teams, competition: "LaLiga", startUtcEpochSeconds, channels: [operator] };
  }).filter(Boolean);
}

export function parseLaligaSchedule(html) {
  const rows = [...parseRows(html, { channelKeys: ["operators", "operator", "broadcasters"], channelPattern: OPERATOR, competitionFallback: "LaLiga", sourceTimeKeys: ["kickoff", "kickoffTime", "startDate"] }), ...parseLaligaSemanticTable(html)];
  return rows.filter((row, index, all) => all.findIndex((item) => item.homeTeam === row.homeTeam && item.awayTeam === row.awayTeam && item.startUtcEpochSeconds === row.startUtcEpochSeconds && item.channels.join("|") === row.channels.join("|")) === index)
    .map((row) => ({ ...row, broadcastsFor: (channel) => [{ territory: "ES", rightsHolder: /^Movistar/i.test(channel) ? "Movistar Plus+" : "DAZN", destinationType: /^DAZN$/i.test(channel) ? "service" : "linear" }] }));
}

export const laligaAdapter = scheduleAdapter({ id: "laliga-spain", url: LALIGA_URL, parse: parseLaligaSchedule });
laligaAdapter.contractStatus = "semantic-html-verified";
laligaAdapter.parserTypes = ["embedded-json", "semantic-table"];
