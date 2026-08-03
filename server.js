// Zero-dependency static + JSON-API server for the Bloodfields roster builder.
// Run with: node server.js  (then open http://localhost:3000)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { buildRosterPdf } = require('./pdf');

require('./setup'); // downloads unit cards / builds units.json on first run; no-op after that

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UNIT_CARDS_DIR = path.join(ROOT, 'unit_cards');
const DATA_DIR = path.join(ROOT, 'data');
const UNITS_FILE = path.join(DATA_DIR, 'units.json');
const ROSTERS_FILE = path.join(DATA_DIR, 'rosters.json');

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

let unitsById = new Map();
function loadUnitsIndex() {
  try {
    const units = JSON.parse(fs.readFileSync(UNITS_FILE, 'utf8'));
    unitsById = new Map(units.map(u => [u.id, u]));
  } catch (e) {
    unitsById = new Map();
  }
}
loadUnitsIndex();

// Resolves roster unit ids to card art for PDF export, sorted to match the
// app's own faction/name grouping.
function cardsFromIds(unitIds) {
  const cards = [];
  for (const id of unitIds) {
    const u = unitsById.get(id);
    if (!u) continue;
    cards.push({
      name: u.unit,
      faction: u.faction,
      cost: u.cost,
      imagePath: path.join(UNIT_CARDS_DIR, u.image.slice('/unit_cards/'.length)),
    });
  }
  cards.sort((a, b) => a.faction.localeCompare(b.faction) || a.name.localeCompare(b.name));
  return cards;
}

function sendPdf(res, filename, buffer) {
  const safeName = filename.replace(/[\\"]/g, '').trim() || 'roster';
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': buffer.length,
    'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
  });
  res.end(buffer);
}

function readRosters() {
  try {
    return JSON.parse(fs.readFileSync(ROSTERS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeRosters(rosters) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ROSTERS_FILE, JSON.stringify(rosters, null, 2));
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname === '/data/units.json' && req.method === 'GET') {
      return serveFile(res, DATA_DIR, 'units.json');
    }

    if (pathname.startsWith('/unit_cards/') && req.method === 'GET') {
      return serveFile(res, UNIT_CARDS_DIR, pathname.slice('/unit_cards/'.length));
    }

    if (pathname === '/api/rosters' && req.method === 'GET') {
      return sendJson(res, 200, readRosters());
    }

    if (pathname.startsWith('/api/rosters/') && pathname.endsWith('/pdf') && req.method === 'GET') {
      const name = decodeURIComponent(pathname.slice('/api/rosters/'.length, -'/pdf'.length));
      const roster = readRosters()[name];
      if (!roster) return sendJson(res, 404, { error: 'Roster not found' });
      const cards = cardsFromIds(roster.unitIds);
      if (!cards.length) return sendJson(res, 400, { error: 'Roster has no valid units' });
      const pdf = buildRosterPdf(cards, name, `${roster.realm} — ${cards.length} units — ${cards.reduce((s, c) => s + c.cost, 0)} pts`);
      return sendPdf(res, name, pdf);
    }

    if (pathname === '/api/roster-pdf' && req.method === 'POST') {
      const bodyText = await readBody(req);
      let body;
      try {
        body = JSON.parse(bodyText || '{}');
      } catch (e) {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }
      if (!Array.isArray(body.unitIds) || !body.unitIds.length) {
        return sendJson(res, 400, { error: 'Body must include a non-empty unitIds[]' });
      }
      const cards = cardsFromIds(body.unitIds);
      if (!cards.length) return sendJson(res, 400, { error: 'No valid units found' });
      const title = body.name || 'Roster';
      const subtitle = `${body.realm || ''}${body.realm ? ' — ' : ''}${cards.length} units — ${cards.reduce((s, c) => s + c.cost, 0)} pts`;
      const pdf = buildRosterPdf(cards, title, subtitle);
      return sendPdf(res, title, pdf);
    }

    if (pathname.startsWith('/api/rosters/') && (req.method === 'POST' || req.method === 'DELETE')) {
      const name = decodeURIComponent(pathname.slice('/api/rosters/'.length));
      if (!name) return sendJson(res, 400, { error: 'Missing roster name' });

      const rosters = readRosters();

      if (req.method === 'DELETE') {
        delete rosters[name];
        writeRosters(rosters);
        return sendJson(res, 200, { ok: true });
      }

      // POST: save/overwrite
      const bodyText = await readBody(req);
      let body;
      try {
        body = JSON.parse(bodyText || '{}');
      } catch (e) {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }
      if (!body.realm || !Array.isArray(body.unitIds)) {
        return sendJson(res, 400, { error: 'Body must include realm and unitIds[]' });
      }
      rosters[name] = { realm: body.realm, unitIds: body.unitIds, savedAt: new Date().toISOString() };
      writeRosters(rosters);
      return sendJson(res, 200, { ok: true, name, roster: rosters[name] });
    }

    if (req.method === 'GET') {
      if (pathname === '/') pathname = '/index.html';
      return serveFile(res, PUBLIC_DIR, pathname);
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Bloodfields roster builder running at http://localhost:${PORT}`);
});
