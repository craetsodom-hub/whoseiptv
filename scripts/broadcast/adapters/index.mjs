import { beinMenaAdapter } from "./bein-mena.mjs";
import { bundesligaAdapter } from "./bundesliga.mjs";
import { laligaAdapter } from "./laliga.mjs";
import { movistarChampionsAdapter } from "./movistar-plus.mjs";
import { premierLeagueAdapter } from "./premier-league.mjs";
import { skySportsAdapter } from "./sky-sports.mjs";

// Each registered parser fails closed on missing semantic fields. Ligue 1
// exact channels are collected from its current ma-api match contract in
// official-football; the retired fixtures-results page is not requested.
// The TNT adapter remains unregistered until its live hydration contract is captured.
export const OFFICIAL_BROADCAST_ADAPTERS = Object.freeze([
  beinMenaAdapter,
  skySportsAdapter,
  premierLeagueAdapter,
  laligaAdapter,
  movistarChampionsAdapter,
  bundesligaAdapter
]);

// The registry is deliberately declarative: the discovery runner can only
// call adapters listed here, and each one declares its trusted first-party
// host, parser contract, and relevant fixture scope.  It never hands URLs to
// the desktop application or asks it to scrape pages.
const sourceContracts = {
  "bein-mena": { sourceUrl: "https://www.beinsports.com/en-mena/tv-guide", appliesTo: (event, territory) => /football/i.test(event.sport) && ["MA", "QA", "AE", "SA", "TR"].includes(territory) },
  "sky-sports-uk": { sourceUrl: "https://www.skysports.com/watch/football-on-sky/competitions/premier-league", appliesTo: (event, territory) => /premier league/i.test(event.competition ?? "") && territory === "GB" },
  "premier-league-selections": { sourceUrl: "https://www.premierleague.com/en/fixtures", appliesTo: (event, territory) => /premier league/i.test(event.competition ?? "") && territory === "GB" },
  "laliga-spain": { sourceUrl: "https://www.laliga.com/laliga-easports/resultados", appliesTo: (event, territory) => /la ?liga|spanish la liga/i.test(event.competition ?? "") && territory === "ES" },
  "movistar-plus-champions-spain": { sourceUrl: "https://www.movistarplus.es/programacion-tv", appliesTo: (event, territory) => /champions league/i.test(event.competition ?? "") && territory === "ES" },
  "bundesliga-active": { sourceUrl: "https://www.bundesliga.com/en/bundesliga/matchday", appliesTo: (event, territory) => /bundesliga/i.test(event.competition ?? "") && territory === "DE" }
};
for (const adapter of OFFICIAL_BROADCAST_ADAPTERS) Object.assign(adapter, sourceContracts[adapter.id]);

export const OFFICIAL_ADAPTER_STATUS = Object.freeze(OFFICIAL_BROADCAST_ADAPTERS.map(({ id, contractStatus, parserTypes, trustedHosts }) => ({
  id, contractStatus, parserTypes, trustedHosts, registered: true
})));
