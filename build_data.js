// Dev-time script: parses "Bloodfields Unit List.xlsx" and cross-references it with the
// already-downloaded card images in unit_cards/ to produce data/units.json.
// Re-run manually (`node build_data.js`) whenever the xlsx changes.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const XLSX = 'Bloodfields Unit List.xlsx';
const UNIT_CARDS_DIR = path.join(__dirname, 'unit_cards');
const OUT_FILE = path.join(__dirname, 'data', 'units.json');

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

// Windows-illegal filename characters — same rule the downloader used, so filenames match.
const ILLEGAL = /[\\/:*?"<>|]/g;

function sanitizePathSegment(str, { colonToDash = false } = {}) {
  let s = str;
  if (colonToDash) s = s.replace(/:/g, ' -');
  s = s.replace(ILLEGAL, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[. ]+$/, '');
  return s;
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
    const target = relMap[rid];
    sheets.push({ name, sheetFile: 'xl/' + target });
  }
  return sheets;
}

function parseSheet(sheetFile, strs) {
  const xml = unzipText(sheetFile);
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
    const type = cells['D'];
    const cost = cells['E'];
    if (!realm || !faction || !unit) continue; // filters out footnote/blank rows
    result.push({ realm, faction, unit, type: type || '', cost: cost !== undefined ? parseFloat(cost) : null });
  }
  return result;
}

// Build an index of realmDir/factionDir/unitBasename -> actual file on disk (any extension).
function indexUnitCards() {
  const index = new Map();
  for (const realmDir of fs.readdirSync(UNIT_CARDS_DIR)) {
    const realmPath = path.join(UNIT_CARDS_DIR, realmDir);
    if (!fs.statSync(realmPath).isDirectory()) continue;
    for (const factionDir of fs.readdirSync(realmPath)) {
      const factionPath = path.join(realmPath, factionDir);
      if (!fs.statSync(factionPath).isDirectory()) continue;
      for (const file of fs.readdirSync(factionPath)) {
        const base = path.parse(file).name;
        index.set(`${realmDir}/${factionDir}/${base}`, path.join(realmDir, factionDir, file));
      }
    }
  }
  return index;
}

function main() {
  console.log('Reading shared strings and workbook structure...');
  const strs = loadSharedStrings();
  const sheets = loadRealmSheets();
  console.log('Sheets found:', sheets.map(s => s.name).join(', '));

  const allUnits = [];
  for (const sheet of sheets) {
    const rows = parseSheet(sheet.sheetFile, strs);
    console.log(`  ${sheet.name}: ${rows.length} units`);
    allUnits.push(...rows);
  }
  console.log(`Total rows parsed: ${allUnits.length}`);

  const imageIndex = indexUnitCards();
  console.log(`Indexed ${imageIndex.size} image files on disk`);

  const seenIds = new Set();
  const missingImages = [];
  const duplicateIds = [];
  const units = [];

  for (const u of allUnits) {
    const realmDir = sanitizePathSegment(u.realm);
    const factionDir = sanitizePathSegment(u.faction);
    const unitBase = sanitizePathSegment(u.unit, { colonToDash: true });
    const key = `${realmDir}/${factionDir}/${unitBase}`;
    const rel = imageIndex.get(key);
    if (!rel) {
      missingImages.push(key);
      continue;
    }
    const id = slugify(`${u.realm}__${u.faction}__${u.unit}`);
    if (seenIds.has(id)) {
      duplicateIds.push(id);
      continue;
    }
    seenIds.add(id);
    units.push({
      id,
      realm: u.realm,
      faction: u.faction,
      unit: u.unit,
      type: u.type,
      cost: u.cost,
      image: 'unit_cards/' + rel.split(path.sep).join('/'),
    });
  }

  if (missingImages.length) {
    console.error(`\nERROR: ${missingImages.length} unit(s) had no matching image file:`);
    for (const m of missingImages) console.error('  ' + m);
  }
  if (duplicateIds.length) {
    console.error(`\nERROR: ${duplicateIds.length} duplicate unit id(s):`);
    for (const d of duplicateIds) console.error('  ' + d);
  }
  if (missingImages.length || duplicateIds.length) {
    console.error('\nAborting — fix the issues above before writing data/units.json');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(units, null, 2));
  console.log(`\nWrote ${units.length} units to ${path.relative(__dirname, OUT_FILE)}`);
}

main();
