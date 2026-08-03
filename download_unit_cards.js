const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const XLSX = 'Bloodfields Unit List.xlsx';
const OUT_DIR = path.join(__dirname, 'unit_cards');
const CONCURRENCY = 8;

function unzipText(entry) {
  return execSync('unzip -p "' + XLSX + '" ' + entry, { maxBuffer: 1024 * 1024 * 50 }).toString('utf8');
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Windows-illegal filename characters
const ILLEGAL = /[\\/:*?"<>|]/g;

function sanitizePathSegment(str, { colonToDash = false } = {}) {
  let s = str;
  if (colonToDash) s = s.replace(/:/g, ' -');
  s = s.replace(ILLEGAL, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[. ]+$/, ''); // no trailing dot/space
  return s;
}

function loadSharedStrings() {
  const ss = unzipText('xl/sharedStrings.xml');
  return [...ss.matchAll(/<si>(.*?)<\/si>/gs)].map(m =>
    decodeXmlEntities(m[1].replace(/<[^>]+>/g, ''))
  );
}

function loadRealmSheets() {
  const wb = unzipText('xl/workbook.xml');
  const rels = unzipText('xl/_rels/workbook.xml.rels');
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]*)"/g)) {
    relMap[m[1]] = m[2];
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"\/>/g)) {
    const [, name, rid] = m;
    if (name === 'Changelog') continue;
    const target = relMap[rid]; // e.g. worksheets/sheet2.xml
    const sheetFile = 'xl/' + target;
    const num = target.match(/sheet(\d+)\.xml/)[1];
    sheets.push({ name, sheetFile, relsFile: `xl/worksheets/_rels/sheet${num}.xml.rels` });
  }
  return sheets;
}

function parseSheet(sheetFile, relsFile, strs) {
  const xml = unzipText(sheetFile);
  let rels = '';
  try {
    rels = unzipText(relsFile);
  } catch (e) {
    // no rels file (no hyperlinks) — unexpected for realm sheets but handle gracefully
  }
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]*)"/g)) {
    relMap[m[1]] = decodeXmlEntities(m[2]);
  }
  const hyperMap = {};
  const hlBlock = xml.match(/<hyperlinks>(.*?)<\/hyperlinks>/s);
  if (hlBlock) {
    for (const m of hlBlock[1].matchAll(/<hyperlink r:id="(rId\d+)" ref="([A-Z]+\d+)"\/>/g)) {
      hyperMap[m[2]] = m[1];
    }
  }
  const rows = [...xml.matchAll(/<row r="(\d+)"[^>]*>(.*?)<\/row>/gs)];
  const result = [];
  for (const [, rnum, rowContent] of rows) {
    if (parseInt(rnum, 10) <= 2) continue; // skip header rows
    const cells = {};
    for (const cm of rowContent.matchAll(/<c r="([A-Z]+)(\d+)"[^>]*?(?:\st="(\w+)")?>(?:<v>(.*?)<\/v>)?<\/c>/g)) {
      const [, col, , type, val] = cm;
      cells[col] = type === 's' && val !== undefined ? strs[parseInt(val, 10)] : val;
    }
    const realm = cells['A'];
    const faction = cells['B'];
    const unit = cells['C'];
    if (!realm || !unit) continue; // filters out footnote/blank rows
    const rid = hyperMap['C' + rnum];
    const url = rid ? relMap[rid] : null;
    if (!url) continue;
    result.push({ realm, faction, unit, url });
  }
  return result;
}

function extFromUrlOrType(url, contentType) {
  if (contentType && /image\/jpeg/i.test(contentType)) return '.jpg';
  if (contentType && /image\/png/i.test(contentType)) return '.png';
  if (contentType && /image\/gif/i.test(contentType)) return '.gif';
  if (contentType && /image\/webp/i.test(contentType)) return '.webp';
  const m = url.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
  return m ? '.' + m[1].toLowerCase() : '.jpg';
}

function download(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BloodfieldsCardDownloader/1.0' } },
      res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          resolve(download(nextUrl, destPath, redirectsLeft - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const finalDest = destPath.replace(/\.jpg$/i, extFromUrlOrType(url, res.headers['content-type']));
        const fileStream = fs.createWriteStream(finalDest);
        res.pipe(fileStream);
        fileStream.on('finish', () => fileStream.close(() => resolve(finalDest)));
        fileStream.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}

async function runPool(items, worker, concurrency) {
  let idx = 0;
  const results = [];
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = { ok: true, value: await worker(items[i]) };
      } catch (e) {
        results[i] = { ok: false, error: e };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return results;
}

async function main() {
  console.log('Reading shared strings and workbook structure...');
  const strs = loadSharedStrings();
  const sheets = loadRealmSheets();
  console.log('Realm sheets found:', sheets.map(s => s.name).join(', '));

  const allUnits = [];
  for (const sheet of sheets) {
    const rows = parseSheet(sheet.sheetFile, sheet.relsFile, strs);
    console.log(`  ${sheet.name}: ${rows.length} units`);
    allUnits.push(...rows);
  }
  console.log(`Total units to process: ${allUnits.length}`);

  // Pre-create folder tree
  for (const u of allUnits) {
    const realmDir = sanitizePathSegment(u.realm);
    const factionDir = sanitizePathSegment(u.faction);
    const dir = path.join(OUT_DIR, realmDir, factionDir);
    fs.mkdirSync(dir, { recursive: true });
  }

  let downloaded = 0,
    skipped = 0,
    failed = [];

  await runPool(
    allUnits,
    async u => {
      const realmDir = sanitizePathSegment(u.realm);
      const factionDir = sanitizePathSegment(u.faction);
      const unitFile = sanitizePathSegment(u.unit, { colonToDash: true });
      const destBase = path.join(OUT_DIR, realmDir, factionDir, unitFile);
      const guessedExt = extFromUrlOrType(u.url, null);
      const destPath = destBase + guessedExt;

      // skip if any file with this basename (any extension) already exists
      const dir = path.dirname(destPath);
      const base = path.basename(destBase);
      const already = fs.readdirSync(dir).some(f => path.parse(f).name === base);
      if (already) {
        skipped++;
        return;
      }

      try {
        await download(u.url, destPath);
        downloaded++;
      } catch (e) {
        failed.push({ realm: u.realm, faction: u.faction, unit: u.unit, url: u.url, error: e.message });
      }
    },
    CONCURRENCY
  );

  console.log('\n--- Summary ---');
  console.log('Total units:', allUnits.length);
  console.log('Downloaded:', downloaded);
  console.log('Skipped (already existed):', skipped);
  console.log('Failed:', failed.length);
  if (failed.length) {
    console.log('\nFailed downloads:');
    for (const f of failed) {
      console.log(`  [${f.realm} / ${f.faction} / ${f.unit}] ${f.url} -> ${f.error}`);
    }
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
