// Dev-time script: parses "Bloodfields Unit List.xlsx" column J (faction
// description / per-type abilities / loyalty bonus) into data/factions.json.
// Re-run manually (`node build_factions.js`) whenever the xlsx changes.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const XLSX = 'Bloodfields Unit List.xlsx';
const OUT_FILE = path.join(__dirname, 'data', 'factions.json');

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

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Faction names in column B sometimes carry a handicap suffix (e.g.
// "Vile Dragonborn - (H +2)") that doesn't appear in the column J prose.
function cleanFactionName(faction) {
  return faction.replace(/\s*-\s*\(H[^)]*\)\s*$/, '').trim();
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
    sheets.push({ name, sheetFile: 'xl/' + relMap[rid] });
  }
  return sheets;
}

// Column J cells hold rich text as multiple <r><t>...</t></r> runs — join them
// so line breaks inside the cell survive as \n.
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
    const unitType = cells['D'];
    if (!realm || !faction || !unit) continue; // filters out footnote/blank rows
    result.push({ realm, faction, type: unitType || '', j: cells['J'] || '' });
  }
  return result;
}

// Splits raw column J text into { description, abilities, bonus } using the
// faction's own set of unit-type names (column D) as block markers: once a
// line starts with "<Type>: " everything up to the next marker belongs to
// that type's ability text, and once a line starts with "Loyalty Bonus:" (or
// "<Faction> Loyalty Bonus:") everything from there to the end is the bonus.
function splitFactionText(rawText, factionClean, knownTypesLower) {
  // A "Loyalty Bonus:" line is sometimes prefixed with the faction name, and
  // that prefix doesn't always match column B exactly (typos happen — e.g.
  // "Jurrasic Amazons Loyalty Bonus:" for faction "Jurassic Amazons"), so
  // match loosely on any short name-like prefix rather than requiring an
  // exact match against factionClean.
  const bonusRe = /^[A-Za-z' ]{0,40}Loyalty Bonus:\s/;
  const headerRe = /^([A-Z][A-Za-z' ]{1,40}):\s/;

  const buckets = { description: [], bonus: [] };
  const abilityOrder = [];
  let currentKey = null; // null = description, 'BONUS' = bonus, else a type name

  for (const line of rawText.split('\n')) {
    const trimmed = line.trim();
    if (currentKey !== 'BONUS' && bonusRe.test(trimmed)) {
      currentKey = 'BONUS';
    } else if (currentKey !== 'BONUS') {
      const m = trimmed.match(headerRe);
      if (m && knownTypesLower.has(m[1].toLowerCase())) {
        currentKey = m[1]; // use the casing as written in the prose
        if (!abilityOrder.includes(currentKey)) abilityOrder.push(currentKey);
      }
    }

    if (currentKey === null) buckets.description.push(line);
    else if (currentKey === 'BONUS') buckets.bonus.push(line);
    else {
      if (!buckets[currentKey]) buckets[currentKey] = [];
      buckets[currentKey].push(line);
    }
  }

  const clean = lines =>
    lines
      .join('\n')
      .replace(/^\n+|\n+$/g, '')
      .trim();

  // Drop leading lines that just repeat the faction name or a "Last update"
  // stamp — they carry no information beyond what's already in `faction`.
  let descLines = buckets.description;
  while (
    descLines.length &&
    (descLines[0].trim() === '' ||
      descLines[0].trim() === factionClean ||
      /^Last update:/i.test(descLines[0].trim()))
  ) {
    descLines = descLines.slice(1);
  }

  const abilities = {};
  for (const type of abilityOrder) {
    const text = clean(buckets[type]);
    if (text) abilities[type] = text;
  }

  return {
    description: clean(descLines),
    abilities,
    bonus: clean(buckets.bonus) || null,
  };
}

function main() {
  console.log('Reading shared strings and workbook structure...');
  const strs = loadSharedStrings();
  const sheets = loadRealmSheets();
  console.log('Sheets found:', sheets.map(s => s.name).join(', '));

  const allRows = [];
  for (const sheet of sheets) {
    allRows.push(...parseSheet(sheet.sheetFile, strs));
  }
  console.log(`Total rows parsed: ${allRows.length}`);

  // Column D can hold multiple comma-separated types per unit (e.g. "Cursed,
  // Mage, Warmachine"). Build the full cross-faction type vocabulary — a
  // faction's column J text sometimes documents an ability for a type that
  // isn't on any of that faction's own units (e.g. a shared Mercenary type),
  // so matching against the global set (case-insensitively, since column D's
  // casing is inconsistent) catches those too.
  const knownTypesLower = new Set();
  for (const row of allRows) {
    for (const t of row.type.split(',').map(s => s.trim()).filter(Boolean)) {
      knownTypesLower.add(t.toLowerCase());
    }
  }

  // Group rows by realm+faction, in first-seen order, keeping the (single)
  // non-empty column J text for each faction.
  const groups = new Map();
  for (const row of allRows) {
    const key = `${row.realm}|||${row.faction}`;
    let g = groups.get(key);
    if (!g) {
      g = { realm: row.realm, faction: row.faction, rawText: '' };
      groups.set(key, g);
    }
    if (row.j && !g.rawText) g.rawText = row.j;
  }

  const factions = [];
  let skipped = 0;
  for (const g of groups.values()) {
    if (!g.rawText) {
      skipped++;
      continue;
    }
    const factionClean = cleanFactionName(g.faction);
    const { description, abilities, bonus } = splitFactionText(g.rawText, factionClean, knownTypesLower);
    factions.push({
      id: slugify(`${g.realm}__${g.faction}`),
      realm: g.realm,
      faction: g.faction,
      description,
      abilities,
      bonus,
    });
  }

  console.log(`Factions with a description: ${factions.length}`);
  console.log(`Factions with no column J text (skipped): ${skipped}`);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(factions, null, 2));
  console.log(`\nWrote ${factions.length} factions to ${path.relative(__dirname, OUT_FILE)}`);
}

main();
