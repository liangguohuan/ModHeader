const ALL_RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
  'font', 'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other'
];

async function getData() {
  const result = await chrome.storage.local.get('modheader');
  return result.modheader || null;
}

function generateId() {
  return 'id_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function createDefaultData() {
  const profileId = generateId();
  return {
    enabled: true,
    profiles: [{
      id: profileId,
      name: 'Profile 1',
      enabled: true,
      urlFilters: [],
      requestHeaders: [],
      responseHeaders: []
    }],
    activeProfileId: profileId
  };
}

// Valid HTTP header token chars (RFC 7230)
function isValidHeaderName(name) {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}

function isAscii(str) {
  return /^[\x00-\x7F]*$/.test(str);
}

function buildRules(data) {
  if (!data.enabled) return [];

  const rules = [];
  let ruleId = 1;

  for (const profile of data.profiles) {
    if (!profile.enabled) continue;

    const reqHeaders = profile.requestHeaders
      .filter(h => h.enabled && h.name && isValidHeaderName(h.name.trim()))
      .map(h => {
        const rule = { header: h.name.trim(), operation: h.operation || 'set' };
        if (rule.operation !== 'remove') rule.value = isAscii(h.value || '') ? (h.value || '') : '';
        return rule;
      });

    const resHeaders = profile.responseHeaders
      .filter(h => h.enabled && h.name && isValidHeaderName(h.name.trim()))
      .map(h => {
        const rule = { header: h.name.trim(), operation: h.operation || 'set' };
        if (rule.operation !== 'remove') rule.value = isAscii(h.value || '') ? (h.value || '') : '';
        return rule;
      });

    if (reqHeaders.length === 0 && resHeaders.length === 0) continue;

    const action = { type: 'modifyHeaders' };
    if (reqHeaders.length > 0) action.requestHeaders = reqHeaders;
    if (resHeaders.length > 0) action.responseHeaders = resHeaders;

    const enabledFilters = (profile.urlFilters || []).filter(f => {
      if (!f.enabled || !f.value || !f.value.trim()) return false;
      // declarativeNetRequest rejects non-ASCII characters in urlFilter
      if (!f.isRegex && !/^[\x00-\x7F]*$/.test(f.value)) return false;
      return true;
    });

    if (enabledFilters.length === 0) {
      rules.push({
        id: ruleId++,
        priority: 1,
        action,
        condition: { resourceTypes: ALL_RESOURCE_TYPES }
      });
    } else {
      for (const filter of enabledFilters) {
        if (ruleId > 4999) break;
        const condition = { resourceTypes: ALL_RESOURCE_TYPES };
        if (filter.isRegex) {
          condition.regexFilter = filter.value.trim();
        } else {
          condition.urlFilter = filter.value.trim();
        }
        rules.push({ id: ruleId++, priority: 1, action, condition });
      }
    }
  }

  return rules;
}

async function applyRules(data) {
  const newRules = buildRules(data);
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = existing.map(r => r.id);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
      addRules: newRules
    });
    return newRules.length;
  } catch (err) {
    console.error('[ModHeader] Rule update failed:', err);
    return 0;
  }
}

// Serialize applies so concurrent updateDynamicRules calls never race.
let applyChain = Promise.resolve(0);
function queueApply(data) {
  applyChain = applyChain.then(() => applyRules(data), () => applyRules(data));
  return applyChain;
}

async function setIcon(enabled) {
  try {
    const sizes = [16, 32, 48, 128];
    const imageData = {};
    for (const size of sizes) {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d');
      const r = size * 0.12;
      const color = enabled ? '#3b82f6' : '#64748b';

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(size - r, 0);
      ctx.quadraticCurveTo(size, 0, size, r);
      ctx.lineTo(size, size - r);
      ctx.quadraticCurveTo(size, size, size - r, size);
      ctx.lineTo(r, size);
      ctx.quadraticCurveTo(0, size, 0, size - r);
      ctx.lineTo(0, r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(size * 0.65)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('M', size / 2, size * 0.52);

      imageData[size] = ctx.getImageData(0, 0, size, size);
    }
    await chrome.action.setIcon({ imageData });
  } catch (e) {
    // OffscreenCanvas unavailable in some contexts
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  let data = await getData();
  if (!data) {
    data = createDefaultData();
    await chrome.storage.local.set({ modheader: data });
  }
  await queueApply(data);
  await setIcon(data.enabled);
});

chrome.runtime.onStartup.addListener(async () => {
  const data = await getData();
  if (data) {
    await queueApply(data);
    await setIcon(data.enabled);
  }
});

// Fallback for external edits to storage (routed through the same queue so it
// can never race the popup's APPLY message path).
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.modheader && changes.modheader.newValue) {
    const data = changes.modheader.newValue;
    await queueApply(data);
    await setIcon(data.enabled);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'APPLY' && msg.data) {
    setIcon(msg.data.enabled);
    queueApply(msg.data).then(ruleCount => {
      sendResponse({ ruleCount });
    });
    return true; // async response
  }
  if (msg.type === 'GET_STATUS') {
    chrome.declarativeNetRequest.getDynamicRules().then(rules => {
      sendResponse({ ruleCount: rules.length });
    });
    return true; // async response
  }
});
