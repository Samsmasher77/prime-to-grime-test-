import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
};

// Minimal Vercel-style req/res polyfill for local /api/* dev.
// Lets us import and run api/*.js handlers the same way Vercel runs them,
// so we don't need `vercel dev` installed for local iteration.
function wrapResponse(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) { resolve({}); return; }
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      } else {
        resolve(data);
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res) {
  // /api/foo → api/foo.js
  const urlPath = req.url.split('?')[0];
  const relative = urlPath.replace(/^\/api\//, '');
  const handlerPath = path.join(__dirname, 'api', relative + '.js');

  if (!fs.existsSync(handlerPath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API route not found: ' + urlPath }));
    return;
  }

  try {
    req.body = await readBody(req);
    wrapResponse(res);
    // Cache-bust the import so edits are picked up without restarting
    const mod = await import(pathToFileURL(handlerPath).href + '?t=' + Date.now());
    const handler = mod.default || mod.handler;
    if (typeof handler !== 'function') {
      res.status(500).json({ error: 'Handler must export a default function' });
      return;
    }
    await handler(req, res);
  } catch (err) {
    console.error('[api]', urlPath, err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    await handleApi(req, res);
    return;
  }

  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);

  // Strip query strings
  filePath = filePath.split('?')[0];

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found: ' + req.url);
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Serving at http://localhost:${PORT}`);
});
