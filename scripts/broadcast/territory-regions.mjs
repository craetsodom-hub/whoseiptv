export const TERRITORY_REGIONS = Object.freeze({
  MENA: ["AE", "BH", "DZ", "EG", "IQ", "JO", "KW", "LB", "LY", "MA", "OM", "PS", "QA", "SA", "SY", "TN", "YE"],
  SUB_SAHARAN_AFRICA: ["AO", "BF", "BI", "BJ", "BW", "CD", "CF", "CG", "CI", "CM", "CV", "DJ", "ER", "ET", "GA", "GH", "GM", "GN", "GQ", "GW", "KE", "KM", "LR", "LS", "MG", "ML", "MR", "MU", "MW", "MZ", "NA", "NE", "NG", "RW", "SC", "SD", "SL", "SN", "SO", "SS", "ST", "SZ", "TD", "TG", "TZ", "UG", "ZA", "ZM", "ZW"],
  SOUTH_AMERICA: ["AR", "BO", "BR", "CL", "CO", "EC", "GY", "PE", "PY", "SR", "UY", "VE"],
  INDIAN_SUBCONTINENT: ["BD", "BT", "IN", "LK", "MV", "NP", "PK"],
  CARIBBEAN: ["AG", "AI", "AW", "BB", "BQ", "BS", "CU", "CW", "DM", "DO", "GD", "GP", "HT", "JM", "KN", "KY", "LC", "MQ", "MS", "PR", "TC", "TT", "VC", "VG", "VI"]
});

export function expandTerritories(scope) {
  if (typeof scope?.territory === "string" && /^[A-Z]{2}$/.test(scope.territory)) return [scope.territory];
  const territories = TERRITORY_REGIONS[scope?.region];
  if (!territories) throw new Error(`Unknown territory region: ${scope?.region}`);
  const excluded = new Set(scope.exclude ?? []);
  return territories.filter((territory) => !excluded.has(territory));
}
