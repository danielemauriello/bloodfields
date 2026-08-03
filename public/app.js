(function () {
  'use strict';

  const state = {
    units: [],
    unitsById: new Map(),
    factionsByKey: new Map(), // `${realm}|||${faction}` -> faction reference info
    selectedRealm: null,
    rosterIds: new Set(),
    currentRosterName: '',
    lastSavedIds: new Set(), // snapshot of rosterIds as of the last save/load/new-roster, for dirty checking
  };

  function markClean() {
    state.lastSavedIds = new Set(state.rosterIds);
  }

  function hasUnsavedChanges() {
    if (state.rosterIds.size !== state.lastSavedIds.size) return true;
    for (const id of state.rosterIds) {
      if (!state.lastSavedIds.has(id)) return true;
    }
    return false;
  }

  const el = id => document.getElementById(id);

  const els = {
    realmForm: el('realm-form'),
    startBtn: el('start-btn'),
    savedRosterList: el('saved-roster-list'),
    viewPicker: el('view-realm-picker'),
    viewMain: el('view-main'),
    unitList: el('unit-list'),
    topbarRealm: el('topbar-realm'),
    topbarRealmName: el('topbar-realm-name'),
    changeRealmBtn: el('change-realm-btn'),
    rosterToggle: el('roster-toggle'),
    rosterToggleCount: el('roster-toggle-count'),
    rosterToggleCost: el('roster-toggle-cost'),
    rosterDrawer: el('roster-drawer'),
    rosterBackdrop: el('roster-backdrop'),
    rosterCloseBtn: el('roster-close-btn'),
    rosterRealmLabel: el('roster-realm-label'),
    rosterItems: el('roster-items'),
    rosterTotalCost: el('roster-total-cost'),
    rosterNameInput: el('roster-name-input'),
    rosterSaveBtn: el('roster-save-btn'),
    rosterSaveStatus: el('roster-save-status'),
    rosterPdfBtn: el('roster-pdf-btn'),
    rosterClearBtn: el('roster-clear-btn'),
    modal: el('image-modal'),
    modalImg: el('modal-img'),
    modalCaption: el('modal-caption'),
    modalClose: el('modal-close'),
  };

  function formatCost(cost) {
    return Number.isInteger(cost) ? String(cost) : cost.toFixed(1);
  }

  function rosterTotalCost() {
    let sum = 0;
    for (const id of state.rosterIds) {
      const u = state.unitsById.get(id);
      if (u) sum += u.cost;
    }
    return sum;
  }

  // ---------- Realm picker ----------

  function renderRealmPicker() {
    const realms = [...new Set(state.units.filter(u => u.realm !== 'Mercenaries').map(u => u.realm))].sort();
    els.realmForm.innerHTML = '';
    for (const realm of realms) {
      const label = document.createElement('label');
      label.className = 'realm-option';
      label.innerHTML = `<input type="radio" name="realm" value="${escapeAttr(realm)}"> <span>${escapeHtml(realm)}</span>`;
      els.realmForm.appendChild(label);
    }
    els.realmForm.addEventListener('change', () => {
      els.startBtn.disabled = !els.realmForm.querySelector('input[name="realm"]:checked');
    });
  }

  els.startBtn.addEventListener('click', () => {
    const checked = els.realmForm.querySelector('input[name="realm"]:checked');
    if (!checked) return;
    state.selectedRealm = checked.value;
    state.rosterIds = new Set();
    state.currentRosterName = '';
    markClean();
    showMainView();
  });

  async function loadSavedRosters() {
    const res = await fetch('/api/rosters');
    const rosters = await res.json();
    const names = Object.keys(rosters).sort((a, b) => (rosters[b].savedAt || '').localeCompare(rosters[a].savedAt || ''));
    els.savedRosterList.innerHTML = '';
    if (!names.length) {
      els.savedRosterList.innerHTML = '<p class="empty-note">No saved rosters yet.</p>';
      return;
    }
    for (const name of names) {
      const r = rosters[name];
      const validIds = (r.unitIds || []).filter(id => state.unitsById.has(id));
      const total = validIds.reduce((sum, id) => sum + state.unitsById.get(id).cost, 0);
      const card = document.createElement('div');
      card.className = 'saved-roster-card';
      card.innerHTML = `
        <div class="saved-roster-info">
          <strong>${escapeHtml(name)}</strong>
          <div class="saved-roster-meta">${escapeHtml(r.realm)} · ${validIds.length} units · ${formatCost(total)} pts</div>
        </div>
        <div class="saved-roster-actions">
          <button class="btn load-btn">Load</button>
          <a class="btn pdf-btn" href="/api/rosters/${encodeURIComponent(name)}/pdf">PDF</a>
          <button class="btn delete-btn">Delete</button>
        </div>`;
      card.querySelector('.load-btn').addEventListener('click', () => {
        state.selectedRealm = r.realm;
        state.rosterIds = new Set(validIds);
        state.currentRosterName = name;
        markClean();
        showMainView();
      });
      card.querySelector('.delete-btn').addEventListener('click', async () => {
        if (!confirm(`Delete saved roster "${name}"?`)) return;
        await fetch('/api/rosters/' + encodeURIComponent(name), { method: 'DELETE' });
        loadSavedRosters();
      });
      els.savedRosterList.appendChild(card);
    }
  }

  // ---------- Main view ----------

  function showMainView() {
    els.viewPicker.classList.add('hidden');
    els.viewMain.classList.remove('hidden');
    els.topbarRealm.classList.remove('hidden');
    els.topbarRealmName.textContent = state.selectedRealm;
    els.rosterToggle.classList.remove('hidden');
    els.rosterNameInput.value = state.currentRosterName;
    renderUnitList();
    renderRosterDrawer();
    closeDrawer();
  }

  function showPickerView() {
    els.viewMain.classList.add('hidden');
    els.viewPicker.classList.remove('hidden');
    els.topbarRealm.classList.add('hidden');
    els.rosterToggle.classList.add('hidden');
    closeDrawer();
    loadSavedRosters();
  }

  els.changeRealmBtn.addEventListener('click', () => {
    if (hasUnsavedChanges() && !confirm('Go back? Any unsaved changes to the current roster will be lost.')) {
      return;
    }
    state.selectedRealm = null;
    showPickerView();
  });

  function groupUnits() {
    const inRealm = state.units.filter(u => u.realm === state.selectedRealm);
    const mercs = state.units.filter(u => u.realm === 'Mercenaries');
    const byFaction = list => {
      const map = new Map();
      for (const u of list) {
        if (!map.has(u.faction)) map.set(u.faction, []);
        map.get(u.faction).push(u);
      }
      const factions = [...map.keys()].sort((a, b) => a.localeCompare(b));
      return factions.map(f => ({
        realm: map.get(f)[0].realm,
        faction: f,
        units: map.get(f).sort((a, b) => a.unit.localeCompare(b.unit)),
      }));
    };
    return [...byFaction(inRealm), ...byFaction(mercs)];
  }

  // Strips a (sometimes typo'd) "<Faction> Loyalty Bonus:" prefix so it isn't
  // repeated right under our own "Loyalty Bonus" heading.
  function stripBonusPrefix(text) {
    return text.replace(/^[A-Za-z' ]{0,40}Loyalty Bonus:\s*/, '');
  }

  function renderFactionInfo(f) {
    const wrap = document.createElement('div');
    wrap.className = 'faction-info';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'faction-info-toggle';
    toggle.textContent = 'Faction info ▾';
    wrap.appendChild(toggle);

    const body = document.createElement('div');
    body.className = 'faction-info-body hidden';

    if (f.description) {
      for (const para of f.description.split('\n').map(s => s.trim()).filter(Boolean)) {
        const p = document.createElement('p');
        p.textContent = para;
        body.appendChild(p);
      }
    }
    const abilityEntries = Object.entries(f.abilities || {});
    if (abilityEntries.length) {
      const h4 = document.createElement('h4');
      h4.textContent = 'Abilities';
      body.appendChild(h4);
      const ul = document.createElement('ul');
      for (const [, text] of abilityEntries) {
        const li = document.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
    if (f.bonus) {
      const h4 = document.createElement('h4');
      h4.textContent = 'Loyalty Bonus';
      body.appendChild(h4);
      const p = document.createElement('p');
      p.textContent = stripBonusPrefix(f.bonus);
      body.appendChild(p);
    }

    wrap.appendChild(body);
    toggle.addEventListener('click', () => {
      const open = !body.classList.contains('hidden');
      body.classList.toggle('hidden', open);
      toggle.textContent = open ? 'Faction info ▾' : 'Faction info ▴';
    });
    return wrap;
  }

  function renderUnitList() {
    const groups = groupUnits();
    els.unitList.innerHTML = '';
    for (const group of groups) {
      const section = document.createElement('section');
      section.className = 'faction-group';
      const h3 = document.createElement('h3');
      h3.textContent = group.faction;
      section.appendChild(h3);
      const info = state.factionsByKey.get(`${group.realm}|||${group.faction}`);
      if (info) section.appendChild(renderFactionInfo(info));
      for (const u of group.units) {
        section.appendChild(renderUnitRow(u));
      }
      els.unitList.appendChild(section);
    }
  }

  function renderUnitRow(u) {
    const row = document.createElement('div');
    row.className = 'unit-row';
    row.dataset.id = u.id;

    const nameBtn = document.createElement('button');
    nameBtn.className = 'unit-name-btn';
    nameBtn.textContent = u.unit;
    nameBtn.addEventListener('click', () => openImageModal(u));

    const type = document.createElement('span');
    type.className = 'unit-type';
    type.textContent = u.type || '';

    const cost = document.createElement('span');
    cost.className = 'unit-cost';
    cost.textContent = formatCost(u.cost) + ' pts';

    const addBtn = document.createElement('button');
    addBtn.className = 'add-btn';
    addBtn.type = 'button';
    setAddBtnState(addBtn, state.rosterIds.has(u.id));
    addBtn.addEventListener('click', () => toggleUnit(u.id, addBtn));

    row.append(nameBtn, type, cost, addBtn);
    return row;
  }

  function setAddBtnState(btn, inRoster) {
    if (inRoster) {
      btn.textContent = '✓';
      btn.classList.add('added');
      btn.title = 'Remove from roster';
    } else {
      btn.textContent = '+';
      btn.classList.remove('added');
      btn.title = 'Add to roster';
    }
  }

  function toggleUnit(id, btnEl) {
    if (state.rosterIds.has(id)) {
      state.rosterIds.delete(id);
    } else {
      state.rosterIds.add(id);
    }
    if (btnEl) setAddBtnState(btnEl, state.rosterIds.has(id));
    renderRosterDrawer();
  }

  function openImageModal(u) {
    els.modalImg.src = u.image;
    els.modalImg.alt = u.unit;
    els.modalCaption.textContent = `${u.unit} — ${u.faction} — ${formatCost(u.cost)} pts`;
    els.modal.classList.remove('hidden');
  }

  function closeImageModal() {
    els.modal.classList.add('hidden');
    els.modalImg.src = '';
  }

  els.modalClose.addEventListener('click', closeImageModal);
  els.modal.querySelector('.modal-backdrop').addEventListener('click', closeImageModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeImageModal();
      closeDrawer();
    }
  });

  // ---------- Roster drawer ----------

  function renderRosterDrawer() {
    const ids = [...state.rosterIds];
    const units = ids.map(id => state.unitsById.get(id)).filter(Boolean).sort((a, b) => a.unit.localeCompare(b.unit));
    els.rosterRealmLabel.textContent = state.selectedRealm ? `Realm: ${state.selectedRealm}` : '';
    els.rosterItems.innerHTML = '';
    if (!units.length) {
      els.rosterItems.innerHTML = '<p class="empty-note">No units added yet.</p>';
    } else {
      for (const u of units) {
        const item = document.createElement('div');
        item.className = 'roster-item';
        item.innerHTML = `
          <span class="roster-item-name">${escapeHtml(u.unit)}</span>
          <span class="roster-item-cost">${formatCost(u.cost)} pts</span>
          <button class="roster-item-remove" title="Remove">×</button>`;
        item.querySelector('.roster-item-remove').addEventListener('click', () => {
          state.rosterIds.delete(u.id);
          renderRosterDrawer();
          const btn = els.unitList.querySelector(`.unit-row[data-id="${cssEscape(u.id)}"] .add-btn`);
          if (btn) setAddBtnState(btn, false);
        });
        els.rosterItems.appendChild(item);
      }
    }
    const total = rosterTotalCost();
    els.rosterTotalCost.textContent = formatCost(total);
    els.rosterToggleCount.textContent = ids.length;
    els.rosterToggleCost.textContent = formatCost(total);
  }

  function openDrawer() {
    els.rosterDrawer.classList.add('open');
    els.rosterBackdrop.classList.remove('hidden');
  }
  function closeDrawer() {
    els.rosterDrawer.classList.remove('open');
    els.rosterBackdrop.classList.add('hidden');
  }

  els.rosterToggle.addEventListener('click', openDrawer);
  els.rosterCloseBtn.addEventListener('click', closeDrawer);
  els.rosterBackdrop.addEventListener('click', closeDrawer);

  els.rosterClearBtn.addEventListener('click', () => {
    if (!state.rosterIds.size) return;
    if (!confirm('Clear all units from the current roster?')) return;
    state.rosterIds.clear();
    state.currentRosterName = '';
    els.rosterNameInput.value = '';
    renderRosterDrawer();
    renderUnitList();
  });

  els.rosterSaveBtn.addEventListener('click', async () => {
    const name = els.rosterNameInput.value.trim();
    if (!name) {
      showSaveStatus('Enter a name for this roster.', true);
      return;
    }
    if (!state.rosterIds.size) {
      showSaveStatus('Add at least one unit before saving.', true);
      return;
    }
    try {
      const res = await fetch('/api/rosters/' + encodeURIComponent(name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ realm: state.selectedRealm, unitIds: [...state.rosterIds] }),
      });
      if (!res.ok) throw new Error('Save failed');
      state.currentRosterName = name;
      markClean();
      showSaveStatus(`Saved as "${name}".`, false);
    } catch (e) {
      showSaveStatus('Could not save roster.', true);
    }
  });

  els.rosterPdfBtn.addEventListener('click', async () => {
    if (!state.rosterIds.size) {
      showSaveStatus('Add at least one unit before downloading a PDF.', true);
      return;
    }
    const originalText = els.rosterPdfBtn.textContent;
    els.rosterPdfBtn.disabled = true;
    els.rosterPdfBtn.textContent = 'Building PDF…';
    try {
      const res = await fetch('/api/roster-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          realm: state.selectedRealm,
          unitIds: [...state.rosterIds],
          name: state.currentRosterName || 'Roster',
        }),
      });
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${state.currentRosterName || 'roster'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      showSaveStatus('Could not build PDF.', true);
    } finally {
      els.rosterPdfBtn.disabled = false;
      els.rosterPdfBtn.textContent = originalText;
    }
  });

  function showSaveStatus(msg, isError) {
    els.rosterSaveStatus.textContent = msg;
    els.rosterSaveStatus.classList.toggle('error', !!isError);
    setTimeout(() => {
      if (els.rosterSaveStatus.textContent === msg) els.rosterSaveStatus.textContent = '';
    }, 4000);
  }

  // ---------- utils ----------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }
  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
  }

  // ---------- init ----------

  async function init() {
    const [unitsRes, factionsRes] = await Promise.all([
      fetch('/data/units.json'),
      fetch('/data/factions.json'),
    ]);
    state.units = await unitsRes.json();
    for (const u of state.units) state.unitsById.set(u.id, u);
    if (factionsRes.ok) {
      const factions = await factionsRes.json();
      for (const f of factions) state.factionsByKey.set(`${f.realm}|||${f.faction}`, f);
    }
    renderRealmPicker();
    await loadSavedRosters();
  }

  init();
})();
