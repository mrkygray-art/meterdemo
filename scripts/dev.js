// Local test server: serves /public and runs the /api routes the same way
// Vercel does (each file exports GET/POST handlers that take a Request and
// return a Response). Run with:  npm run dev   then open http://localhost:3000

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function handleApi(req, res, url) {
  const name = url.pathname.replace('/api/', '');
  const file = path.join(root, 'api', `${name}.js`);
  if (!/^[a-z-]+$/.test(name) || !existsSync(file)) return send(res, 404, 'Not found');

  const mod = await import(pathToFileURL(file).href);
  const handler = mod[req.method];
  if (!handler) return send(res, 405, 'Method not allowed');

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);

  const request = new Request(url, { method: req.method, headers: req.headers, body });
  const response = await handler(request);

  const headers = {};
  response.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function handleStatic(res, url) {
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.normalize(path.join(root, 'public', rel));
  if (!file.startsWith(path.join(root, 'public')) || !existsSync(file)) return send(res, 404, 'Not found');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
}

function send(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(text);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else await handleStatic(res, url);
    } catch (err) {
      console.error(err);
      send(res, 500, 'Server error');
    }
  })
  .listen(PORT, () => console.log(`MeterDemo running at http://localhost:${PORT}`));
