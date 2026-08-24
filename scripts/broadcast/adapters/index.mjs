import { beinMenaAdapter } from "./bein-mena.mjs";
import { bundesligaAdapter } from "./bundesliga.mjs";
import { laligaAdapter } from "./laliga.mjs";
import { ligue1Adapter } from "./ligue1.mjs";
import { premierLeagueAdapter } from "./premier-league.mjs";
import { skySportsAdapter } from "./sky-sports.mjs";

// Each registered parser fails closed on missing semantic fields. The TNT
// adapter remains unregistered until its live hydration contract is captured.
export const OFFICIAL_BROADCAST_ADAPTERS = Object.freeze([
  beinMenaAdapter,
  skySportsAdapter,
  premierLeagueAdapter,
  laligaAdapter,
  ligue1Adapter,
  bundesligaAdapter
]);

export const OFFICIAL_ADAPTER_STATUS = Object.freeze(OFFICIAL_BROADCAST_ADAPTERS.map(({ id, contractStatus, parserTypes, trustedHosts }) => ({
  id, contractStatus, parserTypes, trustedHosts, registered: true
})));
