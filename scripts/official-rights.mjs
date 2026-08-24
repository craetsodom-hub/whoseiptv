// Backward-compatible entry points retained for build-feed and existing imports.
export { attachRightsMetadata as augmentWithOfficialRights, attachAllEventDestinations, validateRightsCatalog as validateOfficialRightsConfig, coverageReport, matchingRights } from "./broadcast/rights-catalog.mjs";
export { mergeExactBroadcasts as mergeBroadcasts } from "./broadcast/resolver.mjs";
