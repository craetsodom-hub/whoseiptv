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

export const OFFICIAL_ADAPTER_STATUS = Object.freeze(OFFICIAL_BROADCAST_ADAPTERS.map(({ id, contractStatus, parserTypes, trustedHosts }) => ({
  id, contractStatus, parserTypes, trustedHosts, registered: true
})));
