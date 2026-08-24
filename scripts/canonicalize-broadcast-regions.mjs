import { readFile, writeFile } from "node:fs/promises";
import { canonicalizeRegionalBroadcasts } from "./broadcast/resolver.mjs";
import { validateFeed } from "./feed-core.mjs";

const path = new URL("../feed/events/v1/events.json", import.meta.url);
const feed = JSON.parse(await readFile(path, "utf8"));
canonicalizeRegionalBroadcasts(feed.events ?? []);
validateFeed(feed, feed.generatedAtEpochSeconds);
await writeFile(path, `${JSON.stringify(feed, null, 2)}\n`, "utf8");
console.log("Canonicalized regional broadcaster destinations in the current feed");
