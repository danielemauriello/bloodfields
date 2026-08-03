// First-time setup: downloads unit card images and builds data/units.json
// and data/factions.json, skipping any step whose output already exists.
// Required by server.js, which runs this automatically on startup — run
// `node setup.js` directly only if you want to pre-populate without starting
// the server. Run the underlying scripts directly if you need to force a refresh.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const UNIT_CARDS_DIR = path.join(__dirname, 'unit_cards');
const UNITS_FILE = path.join(__dirname, 'data', 'units.json');
const FACTIONS_FILE = path.join(__dirname, 'data', 'factions.json');

function dirHasFiles(dir) {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some(entry => {
    const full = path.join(dir, entry);
    return fs.statSync(full).isFile() || dirHasFiles(full);
  });
}

function run(script) {
  console.log(`\n> node ${script}`);
  execFileSync(process.execPath, [script], { stdio: 'inherit', cwd: __dirname });
}

if (dirHasFiles(UNIT_CARDS_DIR)) {
  console.log('unit_cards/ already has images — skipping download_unit_cards.js');
} else {
  run('download_unit_cards.js');
}

if (fs.existsSync(UNITS_FILE)) {
  console.log('data/units.json already exists — skipping build_data.js');
} else {
  run('build_data.js');
}

if (fs.existsSync(FACTIONS_FILE)) {
  console.log('data/factions.json already exists — skipping build_factions.js');
} else {
  run('build_factions.js');
}

if (require.main === module) {
  console.log('\nSetup complete. Run `node server.js` to start the app.');
}
