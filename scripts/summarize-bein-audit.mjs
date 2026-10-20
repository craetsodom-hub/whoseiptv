import { readFile } from 'node:fs/promises';
const audit = JSON.parse(await readFile('.bein-window-audit.json', 'utf8'));
console.log(JSON.stringify(audit.samples.filter(r => r.live).slice(0, 4).map(r => ({
  live: r.live, replay: r.replay, channel: r.channel, startDate: r.startDate,
  data: Object.fromEntries(Object.entries(r.data).filter(([k]) => !/description|synopsis|image|logo/i.test(k)))
})), null, 2));
