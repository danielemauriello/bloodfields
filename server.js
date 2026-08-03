// Zero-dependency static file server for local development. Roster storage
// and PDF export both run entirely client-side (see public/app.js and
// public/pdf-builder.js) so the same public/ + data/ + unit_cards/ tree this
// serves locally is also what gets published to GitHub Pages — this server
// has no app logic of its own beyond first-time asset setup.
// Run with: node server.js  (then open http://localhost:3000)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

require('./setup'); // downloads unit cards / builds units.json + factions.json on first run; no-op after that

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UNIT_CARDS_DIR = path.join(ROOT, 'unit_cards');
const DATA_DIR = path.join(ROOT, 'data');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

// Serves a file from `rootDir`, refusing to escape it (path traversal guard).
function serveFile(res, rootDir, relPath) {
  const resolvedRoot = path.resolve(rootDir);
  const target = path.resolve(rootDir, '.' + path.sep + relPath);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size });
    fs.createReadStream(target).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  try {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method not allowed');
      return;
    }

    if (pathname === '/data/units.json') {
      return serveFile(res, DATA_DIR, 'units.json');
    }

    if (pathname === '/data/factions.json') {
      return serveFile(res, DATA_DIR, 'factions.json');
    }

    if (pathname.startsWith('/unit_cards/')) {
      return serveFile(res, UNIT_CARDS_DIR, pathname.slice('/unit_cards/'.length));
    }

    if (pathname === '/') pathname = '/index.html';
    return serveFile(res, PUBLIC_DIR, pathname);
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end('Internal server error');
  }
});

server.listen(PORT, () => {
  console.log(`Bloodfields roster builder running at http://localhost:${PORT}`);
});
