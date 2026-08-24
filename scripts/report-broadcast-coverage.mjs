import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageReport, validateOfficialRightsConfig } from "./official-rights.mjs";
import { OFFICIAL_ADAPTER_STATUS } from "./broadcast/adapters/index.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rights = JSON.parse(await readFile(resolve(root, "config/official-event-broadcasters.json"), "utf8"));
const countries = JSON.parse(await readFile(resolve(root, "config/football-countries.json"), "utf8"));
let events = [];
try {
  events = JSON.parse(await readFile(resolve(root, "feed/events/v1/events.json"), "utf8")).events ?? [];
} catch {
  // A report remains useful before the first generated feed exists.
}
validateOfficialRightsConfig(rights);
const territories = [...new Set(countries.map((item) => item.territory))].sort();
for (const report of coverageReport(rights, events, territories)) {
  console.log(`${report.id}\n  rights territories: ${report.rightsTerritories.length}\n  exact official linear channels: ${report.exactLinearTerritories.length}\n  exact official services: ${report.exactServiceTerritories.length}\n  source-event territories: ${report.sourceEventTerritories.length}\n  rights-holder only: ${report.rightsOnlyTerritories.length}\n  unresolved configured territories: ${report.unresolvedTerritories.length}`);
}
console.log("\nregistered adapter contracts");
for (const adapter of OFFICIAL_ADAPTER_STATUS) {
  console.log(`  ${adapter.id}: ${adapter.contractStatus} (${adapter.parserTypes.join(", ")})`);
}
