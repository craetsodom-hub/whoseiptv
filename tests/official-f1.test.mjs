import assert from "node:assert/strict";
import test from "node:test";
import {
  extractFormulaOneRaceLinks,
  parseFormulaOneBroadcasters,
  parseFormulaOneRacePage
} from "../scripts/official-f1.mjs";

const now = Math.floor(Date.parse("2026-07-19T12:00:00Z") / 1000);

test("extracts unique official Formula 1 race links", () => {
  const html = `
    <a href="/en/racing/2026/belgium">Belgium</a>
    <a href="/en/racing/2026/belgium">Belgium again</a>
    <a href="/en/racing/2026/hungary">Hungary</a>
  `;
  assert.deepEqual(extractFormulaOneRaceLinks(html, 2026), [
    "https://www.formula1.com/en/racing/2026/belgium",
    "https://www.formula1.com/en/racing/2026/hungary"
  ]);
});

test("parses country broadcasters and rejects unconfirmed rows", () => {
  const html = `
    <table><tbody>
      <tr><td>United Kingdom</td><td>Sky UK</td></tr>
      <tr><td>France</td><td>Canal+</td></tr>
      <tr><td>China</td><td>To be confirmed</td></tr>
    </tbody></table>
  `;
  const result = parseFormulaOneBroadcasters(html, { "Sky UK": ["Sky Sports F1"] });
  assert.deepEqual(result, [
    { channelName: "Sky UK", aliases: ["Sky Sports F1"], territory: "GB", confirmed: true },
    { channelName: "Canal+", aliases: [], territory: "FR", confirmed: true }
  ]);
});

test("keeps only important current Formula 1 sessions with exact UTC times", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@context": "http://schema.org",
    "@type": "SportsEvent",
    name: "Belgian Grand Prix",
    image: { url: "https://media.formula1.com/image/upload/belgium.jpg" },
    subEvent: [
      { "@id": "practice", name: "Practice 3 - Belgian Grand Prix", startDate: "2026-07-19T10:00:00Z" },
      { "@id": "race", name: "Race - Belgian Grand Prix", startDate: "2026-07-19T13:00:00Z" }
    ]
  })}</script>`;
  const broadcasts = [{ channelName: "Sky UK", aliases: [], territory: "GB", confirmed: true }];
  const result = parseFormulaOneRacePage(html, broadcasts, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Belgian Grand Prix");
  assert.equal(result[0].sport, "formula1");
  assert.equal(result[0].artworkUrl, "https://media.formula1.com/image/upload/belgium.jpg");
  assert.equal(result[0].startUtcEpochSeconds, 1784466000);
});
