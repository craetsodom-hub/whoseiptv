import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const name = pathname === '/feed/events/v1/events.json' ? 'events.json' : pathname === '/feed/events/v1/coverage.json' ? 'coverage.json' : null;
  if (!name) { response.writeHead(404).end(); return; }
  try { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(await readFile(new URL(`../.preview-bein/${name}`, import.meta.url))); }
  catch { response.writeHead(503).end(); }
}).listen(8766, '127.0.0.1');
