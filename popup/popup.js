// ─── State ─────────────────────────────────────────────────────────────────
let data = null;
let activeSection = 'requestHeaders';
let saveTimer = null;
let renameTargetId = null;

// ─── Utils ──────────────────────────────────────────────────────────────────
function generateId() {
  return 'id_' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// RFC 7230 token: valid HTTP header name characters
function isValidHeaderName(name) {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}

function isAscii(str) {
  return /^[\x00-\x7F]*$/.test(str);
}

function debounceSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistData, 150);
}

async function persistData() {
  await chrome.storage.local.set({ modheader: data });
  // Popup is the single apply-driver: background applies rules and returns the
  // accurate count in one round-trip, so the badge can't read a stale value.
  try {
    const res = await chrome.runtime.sendMessage({ type: 'APPLY', data });
    setRuleBadge(res && res.ruleCount);
  } catch (e) {
    // background not ready yet
  }
}

function setRuleBadge(count) {
  const badge = document.getElementById('ruleBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count + (count === 1 ? ' rule' : ' rules');
    badge.className = 'rule-badge active';
  } else {
    badge.textContent = 'no rules';
    badge.className = 'rule-badge inactive';
  }
}

async function updateRuleBadge() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    setRuleBadge(res && res.ruleCount);
  } catch (e) {
    // background not ready yet
  }
}

// ─── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function getActiveProfile() {
  return data.profiles.find(p => p.id === data.activeProfileId) || null;
}

function createProfile(name) {
  return {
    id: generateId(),
    name: name || 'Profile ' + (data.profiles.length + 1),
    enabled: true,
    urlFilters: [],
    requestHeaders: [],
    responseHeaders: []
  };
}

function createHeader() {
  return { id: generateId(), name: '', value: '', operation: 'set', enabled: true };
}

function createFilter() {
  return { id: generateId(), value: '', enabled: true, isRegex: false };
}

// Give every header/filter in a profile a fresh id (used when cloning/importing).
function reassignIds(profile) {
  for (const key of ['requestHeaders', 'responseHeaders', 'urlFilters']) {
    if (Array.isArray(profile[key])) {
      profile[key].forEach(item => { item.id = generateId(); });
    }
  }
}

// ─── Export / Import ──────────────────────────────────────────────────────────
function exportProfiles() {
  const payload = { version: 1, profiles: data.profiles };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `modheader-profiles-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Profiles exported');
}

function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const profile = {
    id: generateId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Imported profile',
    enabled: raw.enabled !== false,
    requestHeaders: [],
    responseHeaders: [],
    urlFilters: []
  };
  const mapHeader = (h) => ({
    id: generateId(),
    name: typeof h.name === 'string' ? h.name : '',
    value: typeof h.value === 'string' ? h.value : '',
    operation: ['set', 'append', 'remove'].includes(h.operation) ? h.operation : 'set',
    enabled: h.enabled !== false
  });
  const mapFilter = (f) => ({
    id: generateId(),
    value: typeof f.value === 'string' ? f.value : '',
    enabled: f.enabled !== false,
    isRegex: f.isRegex === true
  });
  if (Array.isArray(raw.requestHeaders)) profile.requestHeaders = raw.requestHeaders.map(mapHeader);
  if (Array.isArray(raw.responseHeaders)) profile.responseHeaders = raw.responseHeaders.map(mapHeader);
  if (Array.isArray(raw.urlFilters)) profile.urlFilters = raw.urlFilters.map(mapFilter);
  return profile;
}

function importProfiles(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // allow re-importing the same file
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const rawProfiles = Array.isArray(parsed) ? parsed : parsed.profiles;
      if (!Array.isArray(rawProfiles) || rawProfiles.length === 0) {
        toast('No profiles found in file');
        return;
      }
      const imported = rawProfiles.map(normalizeProfile).filter(Boolean);
      if (imported.length === 0) {
        toast('Invalid profile file');
        return;
      }
      data.profiles.push(...imported);
      data.activeProfileId = imported[0].id;
      debounceSave();
      render();
      toast(`Imported ${imported.length} profile${imported.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast('Could not read file');
    }
  };
  reader.readAsText(file);
}

// ─── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.local.get('modheader');
  if (result.modheader) {
    data = result.modheader;
  } else {
    const profile = createProfile('Profile 1');
    data = { enabled: true, profiles: [profile], activeProfileId: profile.id };
    await persistData();
  }

  if (!data.activeProfileId && data.profiles.length > 0) {
    data.activeProfileId = data.profiles[0].id;
  }

  setupStaticListeners();
  setupStorageSync();
  render();
  updateRuleBadge();

  // Highlight import button if opened specifically for importing (e.g. from Firefox popup)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('action') === 'import') {
    const importBtn = document.getElementById('importBtn');
    if (importBtn) {
      importBtn.classList.add('pulse-highlight');
      toast('Please click the highlighted Import button to select your file');
      importBtn.addEventListener('click', () => {
        importBtn.classList.remove('pulse-highlight');
      }, { once: true });
    }
  }
});

// ─── Storage sync (popup ↔ tab editor) ─────────────────────────────────────
function setupStorageSync() {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.modheader && changes.modheader.newValue) {
      data = changes.modheader.newValue;
      if (!data.activeProfileId && data.profiles.length > 0) {
        data.activeProfileId = data.profiles[0].id;
      }
      render();
    }
  });
}

// ─── Static event listeners ──────────────────────────────────────────────────
function setupStaticListeners() {
  // Global toggle
  document.getElementById('globalEnabled').addEventListener('change', (e) => {
    data.enabled = e.target.checked;
    document.querySelector('.app').classList.toggle('disabled', !data.enabled);
    debounceSave();
  });

  // Add profile
  document.getElementById('addProfile').addEventListener('click', () => {
    const profile = createProfile();
    data.profiles.push(profile);
    data.activeProfileId = profile.id;
    debounceSave();
    render();
  });

  // Profile enabled toggle
  document.getElementById('profileEnabled').addEventListener('change', (e) => {
    const profile = getActiveProfile();
    if (!profile) return;
    profile.enabled = e.target.checked;
    renderProfileTabs();
    debounceSave();
  });

  // Delete profile
  document.getElementById('deleteProfile').addEventListener('click', () => {
    if (data.profiles.length <= 1) return;
    const idx = data.profiles.findIndex(p => p.id === data.activeProfileId);
    const name = data.profiles[idx].name;
    data.profiles.splice(idx, 1);
    data.activeProfileId = data.profiles[Math.max(0, idx - 1)].id;
    debounceSave();
    render();
    toast(`Deleted "${name}"`);
  });

  // Section tabs
  document.getElementById('sectionTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-section]');
    if (!tab) return;
    activeSection = tab.dataset.section;
    renderSectionTabs();
    renderSection();
  });

  // Add buttons
  document.getElementById('addRequestHeader').addEventListener('click', () => {
    const profile = getActiveProfile();
    if (!profile) return;
    profile.requestHeaders.push(createHeader());
    renderHeaderList('requestHeaders');
    debounceSave();
  });

  document.getElementById('addResponseHeader').addEventListener('click', () => {
    const profile = getActiveProfile();
    if (!profile) return;
    profile.responseHeaders.push(createHeader());
    renderHeaderList('responseHeaders');
    debounceSave();
  });

  document.getElementById('addUrlFilter').addEventListener('click', () => {
    const profile = getActiveProfile();
    if (!profile) return;
    profile.urlFilters.push(createFilter());
    renderUrlFilters();
    debounceSave();
  });

  // Open in tab — reuse popup.html as full-tab editor
  document.getElementById('openInTab').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
  });

  // Clone profile
  document.getElementById('cloneProfile').addEventListener('click', () => {
    const profile = getActiveProfile();
    if (!profile) return;
    const clone = JSON.parse(JSON.stringify(profile));
    clone.id = generateId();
    clone.name = profile.name + ' copy';
    clone.enabled = true;
    reassignIds(clone);
    data.profiles.push(clone);
    data.activeProfileId = clone.id;
    debounceSave();
    render();
    toast('Profile cloned');
  });

  // Export
  document.getElementById('exportBtn').addEventListener('click', exportProfiles);

  // Import
  document.getElementById('importBtn').addEventListener('click', () => {
    const isFirefox = navigator.userAgent.includes('Firefox');
    const isTabMode = new URLSearchParams(window.location.search).get('mode') === 'tab' || window.innerWidth > 600;
    if (isFirefox && !isTabMode) {
      toast('Opening tab to import profiles...');
      setTimeout(() => {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?mode=tab&action=import') });
      }, 300);
    } else {
      document.getElementById('importFile').click();
    }
  });
  document.getElementById('importFile').addEventListener('change', importProfiles);

  // Rename modal
  document.getElementById('renameCancelBtn').addEventListener('click', closeRenameModal);
  document.getElementById('renameConfirmBtn').addEventListener('click', confirmRename);
  document.getElementById('renameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') closeRenameModal();
  });
  document.getElementById('renameModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('renameModal')) closeRenameModal();
  });
}

// ─── Render ──────────────────────────────────────────────────────────────────
function render() {
  renderGlobalToggle();
  renderProfileTabs();
  renderProfileBar();
  renderSectionTabs();
  renderSection();
}

function renderGlobalToggle() {
  const el = document.getElementById('globalEnabled');
  el.checked = data.enabled;
  document.querySelector('.app').classList.toggle('disabled', !data.enabled);
}

function renderProfileTabs() {
  const container = document.getElementById('profilesTabs');
  container.innerHTML = '';

  for (const profile of data.profiles) {
    const tab = document.createElement('button');
    tab.className = 'profile-tab' + (profile.id === data.activeProfileId ? ' active' : '') + (!profile.enabled ? ' disabled' : '');
    tab.dataset.id = profile.id;
    tab.innerHTML = `
      <span class="profile-tab-dot"></span>
      <span class="profile-tab-name">${escHtml(profile.name)}</span>
      <span class="profile-tab-rename" title="Rename">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M7 1l2 2-5 5H2V6l5-5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
        </svg>
      </span>
    `;

    tab.addEventListener('click', (e) => {
      if (e.target.closest('.profile-tab-rename')) {
        openRenameModal(profile.id, profile.name);
        return;
      }
      data.activeProfileId = profile.id;
      renderProfileTabs();
      renderProfileBar();
      renderSection();
    });

    container.appendChild(tab);
  }
}

function renderProfileBar() {
  const profile = getActiveProfile();
  const enabledEl = document.getElementById('profileEnabled');
  const labelEl = document.getElementById('profileEnabledLabel');
  const deleteBtn = document.getElementById('deleteProfile');

  if (!profile) return;

  enabledEl.checked = profile.enabled;
  labelEl.textContent = profile.enabled ? 'Profile enabled' : 'Profile disabled';
  deleteBtn.style.display = data.profiles.length <= 1 ? 'none' : 'flex';
}

function renderSectionTabs() {
  document.querySelectorAll('.section-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.section === activeSection);
  });
}

function renderSection() {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const active = document.getElementById('section-' + activeSection);
  if (active) active.classList.add('active');

  if (activeSection === 'requestHeaders') renderHeaderList('requestHeaders');
  else if (activeSection === 'responseHeaders') renderHeaderList('responseHeaders');
  else if (activeSection === 'urlFilters') renderUrlFilters();
}

// ─── Header list ─────────────────────────────────────────────────────────────
function renderHeaderList(type) {
  const profile = getActiveProfile();
  const list = document.getElementById(type + 'List');
  if (!list || !profile) return;

  list.innerHTML = '';

  if (profile[type].length === 0) {
    list.appendChild(emptyState('No headers yet. Click "Add" below.'));
    return;
  }

  for (const header of profile[type]) {
    list.appendChild(buildHeaderRow(type, header));
  }
}

function buildHeaderRow(type, header) {
  const row = document.createElement('div');
  row.className = 'header-row' + (header.enabled ? '' : ' disabled');
  row.dataset.id = header.id;

  // Toggle
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'toggle toggle-sm header-toggle';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.checked = header.enabled;
  const toggleTrack = document.createElement('span');
  toggleTrack.className = 'toggle-track';
  const toggleThumb = document.createElement('span');
  toggleThumb.className = 'toggle-thumb';
  toggleTrack.appendChild(toggleThumb);
  toggleLabel.appendChild(toggleInput);
  toggleLabel.appendChild(toggleTrack);

  toggleInput.addEventListener('change', () => {
    header.enabled = toggleInput.checked;
    row.classList.toggle('disabled', !header.enabled);
    debounceSave();
  });

  // Name input
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'input-name';
  nameInput.placeholder = 'Header name';
  nameInput.value = header.name;

  function validateName(val) {
    const trimmed = val.trim();
    if (trimmed && !isValidHeaderName(trimmed)) {
      nameInput.classList.add('input-error');
      nameInput.title = 'Invalid header name — use ASCII letters, digits and !#$%&\'*+-.^_`|~';
    } else {
      nameInput.classList.remove('input-error');
      nameInput.title = '';
    }
  }
  validateName(header.name);

  nameInput.addEventListener('input', () => {
    header.name = nameInput.value;
    validateName(nameInput.value);
    debounceSave();
  });

  // Value input
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.className = 'input-value';
  valueInput.placeholder = 'Header value';
  valueInput.value = header.value || '';
  if (header.operation === 'remove') {
    valueInput.disabled = true;
    valueInput.placeholder = '(not used)';
  }
  function validateValue(val) {
    if (val && !isAscii(val)) {
      valueInput.classList.add('input-error');
      valueInput.title = 'Header value must be ASCII only';
    } else {
      valueInput.classList.remove('input-error');
      valueInput.title = '';
    }
  }
  validateValue(header.value || '');

  valueInput.addEventListener('input', () => {
    header.value = valueInput.value;
    validateValue(valueInput.value);
    debounceSave();
  });

  // Operation select
  const opSelect = document.createElement('select');
  opSelect.className = 'select-op';
  [['set', 'Set'], ['append', 'Append'], ['remove', 'Remove']].forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (header.operation === val) opt.selected = true;
    opSelect.appendChild(opt);
  });
  opSelect.addEventListener('change', () => {
    header.operation = opSelect.value;
    const isRemove = opSelect.value === 'remove';
    valueInput.disabled = isRemove;
    valueInput.placeholder = isRemove ? '(not used)' : 'Header value';
    debounceSave();
  });

  // Delete
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-row-delete';
  deleteBtn.title = 'Remove';
  deleteBtn.innerHTML = '&times;';
  deleteBtn.addEventListener('click', () => {
    const profile = getActiveProfile();
    if (!profile) return;
    profile[type] = profile[type].filter(h => h.id !== header.id);
    renderHeaderList(type);
    debounceSave();
  });

  row.appendChild(toggleLabel);
  row.appendChild(nameInput);
  row.appendChild(valueInput);
  row.appendChild(opSelect);
  row.appendChild(deleteBtn);

  return row;
}

// ─── URL filters ──────────────────────────────────────────────────────────────
function renderUrlFilters() {
  const profile = getActiveProfile();
  const list = document.getElementById('urlFiltersList');
  if (!list || !profile) return;

  list.innerHTML = '';

  if (profile.urlFilters.length === 0) {
    list.appendChild(emptyState('No filters — headers apply to all URLs.'));
    return;
  }

  for (const filter of profile.urlFilters) {
    list.appendChild(buildFilterRow(filter));
  }
}

function buildFilterRow(filter) {
  const row = document.createElement('div');
  row.className = 'url-filter-row';
  row.dataset.id = filter.id;

  // Toggle
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'toggle toggle-sm header-toggle';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.checked = filter.enabled;
  const toggleTrack = document.createElement('span');
  toggleTrack.className = 'toggle-track';
  const toggleThumb = document.createElement('span');
  toggleThumb.className = 'toggle-thumb';
  toggleTrack.appendChild(toggleThumb);
  toggleLabel.appendChild(toggleInput);
  toggleLabel.appendChild(toggleTrack);

  toggleInput.addEventListener('change', () => {
    filter.enabled = toggleInput.checked;
    debounceSave();
  });

  // Pattern input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input-filter';
  input.value = filter.value || '';

  // Regex may legitimately contain non-ASCII (e.g. char classes); the background
  // only ASCII-guards non-regex (urlFilter) patterns.
  const hasNonAscii = (v) => v && /[^\x00-\x7F]/.test(v);

  function validateFilter() {
    input.placeholder = filter.isRegex
      ? '.*\\.example\\.com  (regex)'
      : '||example.com^ or *://api.example.com/*';
    const invalid = !filter.isRegex && hasNonAscii(input.value);
    input.classList.toggle('input-error', invalid);
    input.title = invalid ? 'Wildcard URL filter must be ASCII only — enable .* for regex' : '';
  }

  input.addEventListener('input', () => {
    filter.value = input.value;
    validateFilter();
    debounceSave();
  });

  // Regex toggle
  const regexBtn = document.createElement('button');
  regexBtn.className = 'btn-regex' + (filter.isRegex ? ' active' : '');
  regexBtn.textContent = '.*';
  regexBtn.title = filter.isRegex ? 'Regex matching (on)' : 'Wildcard matching — click for regex';
  regexBtn.addEventListener('click', () => {
    filter.isRegex = !filter.isRegex;
    regexBtn.classList.toggle('active', filter.isRegex);
    regexBtn.title = filter.isRegex ? 'Regex matching (on)' : 'Wildcard matching — click for regex';
    validateFilter();
    debounceSave();
  });

  validateFilter();

  // Delete
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-row-delete';
  deleteBtn.title = 'Remove';
  deleteBtn.innerHTML = '&times;';
  deleteBtn.addEventListener('click', () => {
    const profile = getActiveProfile();
    if (!profile) return;
    profile.urlFilters = profile.urlFilters.filter(f => f.id !== filter.id);
    renderUrlFilters();
    debounceSave();
  });

  row.appendChild(toggleLabel);
  row.appendChild(input);
  row.appendChild(regexBtn);
  row.appendChild(deleteBtn);

  return row;
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function emptyState(msg) {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.innerHTML = `
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect x="4" y="8" width="24" height="3" rx="1.5" fill="currentColor"/>
      <rect x="4" y="14.5" width="16" height="3" rx="1.5" fill="currentColor"/>
      <rect x="4" y="21" width="10" height="3" rx="1.5" fill="currentColor"/>
    </svg>
    <p>${escHtml(msg)}</p>
  `;
  return el;
}

// ─── Rename modal ─────────────────────────────────────────────────────────────
function openRenameModal(id, currentName) {
  renameTargetId = id;
  const input = document.getElementById('renameInput');
  input.value = currentName;
  document.getElementById('renameModal').classList.add('open');
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

function closeRenameModal() {
  renameTargetId = null;
  document.getElementById('renameModal').classList.remove('open');
}

function confirmRename() {
  const name = document.getElementById('renameInput').value.trim();
  if (!name || !renameTargetId) { closeRenameModal(); return; }
  const profile = data.profiles.find(p => p.id === renameTargetId);
  if (profile) {
    profile.name = name;
    debounceSave();
    renderProfileTabs();
  }
  closeRenameModal();
}
