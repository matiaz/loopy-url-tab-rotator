const HAS_OFFSCREEN = typeof chrome.offscreen !== "undefined";
const MIN_INTERVAL_SEC = 1;
const MAX_INTERVAL_SEC = 86400;
const DEFAULT_INTERVAL_SEC = 30;
const DEFAULT_LOOP_COUNT = 2;
const WATCHDOG_ALARM = "rotation-watchdog";
const CATCH_UP_GRACE_MS = 2000;

const state = {
  running: false,
  mode: null,
  config: null,
  currentIndex: 0,
  currentLoop: 0,
  tabIds: [],
  targetTabId: null,
  timerId: null,
  startTime: null,
  lastAdvanceAt: null
};

let resumePromise = null;
let creatingOffscreen = null;

function isHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (e) {
    return false;
  }
}

function clampInterval(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_INTERVAL_SEC;
  return Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, seconds));
}

function sanitizeConfig(mode, config) {
  if (!config || typeof config !== "object") return null;

  const loop = config.loop === true;
  const indefinite = loop && config.indefinite === true;
  const loopCount = loop && !indefinite
    ? Math.max(1, Math.floor(Number(config.loopCount)) || DEFAULT_LOOP_COUNT)
    : null;

  const sanitized = {
    interval: clampInterval(config.interval),
    loop,
    indefinite,
    loopCount
  };

  if (mode === "singleTab") {
    const urls = Array.isArray(config.urls) ? config.urls.filter(isHttpUrl) : [];
    if (urls.length === 0) return null;
    sanitized.urls = urls;
    return sanitized;
  }

  if (mode === "openTabs") {
    sanitized.reloadOnSwitch = config.reloadOnSwitch === true;
    return sanitized;
  }

  return null;
}

async function persistState() {
  await chrome.storage.local.set({
    rotation: {
      running: state.running,
      mode: state.mode,
      config: state.config,
      currentIndex: state.currentIndex,
      currentLoop: state.currentLoop,
      tabIds: state.tabIds,
      targetTabId: state.targetTabId,
      startTime: state.startTime,
      lastAdvanceAt: state.lastAdvanceAt
    }
  });
}

async function loadPersistedState() {
  const data = await chrome.storage.local.get("rotation");
  return data.rotation || null;
}

async function clearPersistedState() {
  await chrome.storage.local.remove("rotation");
}

async function resetState() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }

  if (HAS_OFFSCREEN) {
    await stopOffscreenTimer();
  }

  await chrome.alarms.clear(WATCHDOG_ALARM);

  state.running = false;
  state.mode = null;
  state.config = null;
  state.currentIndex = 0;
  state.currentLoop = 0;
  state.tabIds = [];
  state.targetTabId = null;
  state.startTime = null;
  state.lastAdvanceAt = null;

  await clearPersistedState();
}

function getStatus() {
  if (!state.running) {
    return { running: false };
  }

  const status = {
    running: true,
    mode: state.mode,
    currentIndex: state.currentIndex,
    currentLoop: state.currentLoop,
    startTime: state.startTime
  };

  if (state.mode === "singleTab") {
    status.totalItems = state.config.urls.length;
    status.currentItem = state.config.urls[state.currentIndex];
  } else if (state.mode === "openTabs") {
    status.totalItems = state.tabIds.length;
  }

  status.loop = state.config.loop;
  status.indefinite = state.config.indefinite;
  status.loopCount = state.config.loopCount;

  return status;
}

async function advance() {
  if (!state.running) return;

  const totalItems = state.mode === "singleTab"
    ? state.config.urls.length
    : state.tabIds.length;

  state.currentIndex++;
  state.lastAdvanceAt = Date.now();

  if (state.currentIndex >= totalItems) {
    if (!state.config.loop) {
      await resetState();
      return;
    }

    state.currentLoop++;

    if (!state.config.indefinite && state.currentLoop >= state.config.loopCount) {
      await resetState();
      return;
    }

    state.currentIndex = 0;
  }

  if (state.mode === "singleTab") {
    loadSingleTabUrl();
  } else {
    switchToTab();
  }

  await persistState();
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] ? tabs[0].id : null;
}

async function adoptActiveTab(url) {
  const tabId = await getActiveTabId();
  if (tabId === null || !state.running) return;
  state.targetTabId = tabId;
  chrome.tabs.update(tabId, { url }, () => void chrome.runtime.lastError);
  await persistState();
}

function whenTabMissing(tabId, callback) {
  chrome.tabs.get(tabId, () => {
    if (chrome.runtime.lastError) callback();
  });
}

function loadSingleTabUrl() {
  const url = state.config.urls[state.currentIndex];
  const tabId = state.targetTabId;
  if (tabId === null) {
    adoptActiveTab(url);
    return;
  }
  chrome.tabs.update(tabId, { url }, () => {
    if (!chrome.runtime.lastError) return;
    whenTabMissing(tabId, () => {
      if (state.running && state.targetTabId === tabId) {
        adoptActiveTab(url);
      }
    });
  });
}

function dropTab(tabId) {
  const index = state.tabIds.indexOf(tabId);
  if (index === -1) return;
  const wasCurrent = index === state.currentIndex;
  state.tabIds.splice(index, 1);

  if (state.tabIds.length === 0) {
    resetState();
    return;
  }

  if (index < state.currentIndex || wasCurrent) {
    state.currentIndex--;
  }

  if (wasCurrent) {
    advance();
  } else {
    persistState();
  }
}

function switchToTab() {
  const tabId = state.tabIds[state.currentIndex];
  chrome.tabs.update(tabId, { active: true }, () => {
    if (chrome.runtime.lastError) {
      whenTabMissing(tabId, () => {
        if (state.running && state.mode === "openTabs") {
          dropTab(tabId);
        }
      });
      return;
    }
    if (state.config && state.config.reloadOnSwitch) {
      chrome.tabs.reload(tabId);
    }
  });
}

async function ensureOffscreenDocument() {
  if (!HAS_OFFSCREEN) return;
  if (await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: "background/offscreen.html",
      reasons: ["BLOBS"],
      justification: "Timer for URL rotation"
    }).finally(() => {
      creatingOffscreen = null;
    });
  }
  await creatingOffscreen;
}

async function startOffscreenTimer(intervalMs) {
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({
    action: "start-offscreen-timer",
    interval: intervalMs
  }).catch(() => {});
}

async function stopOffscreenTimer() {
  try {
    const exists = await chrome.offscreen.hasDocument();
    if (exists) {
      chrome.runtime.sendMessage({ action: "stop-offscreen-timer" }).catch(() => {});
      await chrome.offscreen.closeDocument();
    }
  } catch (e) {}
}

async function startTimer(intervalSec) {
  const intervalMs = intervalSec * 1000;

  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }

  if (HAS_OFFSCREEN) {
    await startOffscreenTimer(intervalMs);
  } else {
    state.timerId = setInterval(() => {
      advance();
    }, intervalMs);
  }

  await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
}

async function startSingleTab(config) {
  await resetState();
  state.running = true;
  state.mode = "singleTab";
  state.config = config;
  state.startTime = Date.now();
  state.lastAdvanceAt = state.startTime;
  state.targetTabId = await getActiveTabId();

  loadSingleTabUrl();
  await persistState();
  await startTimer(config.interval);
}

async function startOpenTabs(config) {
  await resetState();
  state.running = true;
  state.mode = "openTabs";
  state.config = config;
  state.startTime = Date.now();
  state.lastAdvanceAt = state.startTime;

  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  state.tabIds = tabs.map((t) => t.id);
  if (state.tabIds.length === 0) {
    await resetState();
    return;
  }

  const activeTabs = tabs.filter((t) => t.active);
  if (activeTabs.length > 0) {
    state.currentIndex = state.tabIds.indexOf(activeTabs[0].id);
    if (state.currentIndex === -1) state.currentIndex = 0;
  }

  await persistState();
  await startTimer(config.interval);
}

async function resumeRotation(saved) {
  const config = sanitizeConfig(saved.mode, saved.config);
  if (!config) {
    await resetState();
    return;
  }

  state.running = true;
  state.mode = saved.mode;
  state.config = config;
  state.currentIndex = saved.currentIndex || 0;
  state.currentLoop = saved.currentLoop || 0;
  state.tabIds = saved.tabIds || [];
  state.targetTabId = typeof saved.targetTabId === "number" ? saved.targetTabId : null;
  state.startTime = saved.startTime;
  state.lastAdvanceAt = saved.lastAdvanceAt || null;

  await startTimer(config.interval);
}

function ensureResumed() {
  if (state.running) return Promise.resolve();
  if (!resumePromise) {
    resumePromise = loadPersistedState()
      .then((saved) => {
        if (saved && saved.running && !state.running) {
          return resumeRotation(saved);
        }
      })
      .finally(() => {
        resumePromise = null;
      });
  }
  return resumePromise;
}

function isAdvanceOverdue() {
  if (!state.running || !state.lastAdvanceAt) return false;
  const elapsed = Date.now() - state.lastAdvanceAt;
  return elapsed >= state.config.interval * 1000 + CATCH_UP_GRACE_MS;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== WATCHDOG_ALARM) return;

  await ensureResumed();

  if (!state.running) {
    await chrome.alarms.clear(WATCHDOG_ALARM);
    return;
  }

  if (isAdvanceOverdue()) {
    await advance();
  }

  if (HAS_OFFSCREEN && state.running) {
    try {
      const exists = await chrome.offscreen.hasDocument();
      if (!exists) {
        await startOffscreenTimer(state.config.interval * 1000);
      }
    } catch (e) {}
  }
});

function handleStart(message, sendResponse) {
  const config = sanitizeConfig(message.mode, message.config);
  if (!config) {
    sendResponse({ success: false });
    return;
  }

  const start = message.mode === "singleTab" ? startSingleTab : startOpenTabs;
  start(config)
    .then(() => sendResponse({ success: true }))
    .catch(() => sendResponse({ success: false }));
}

function handleGetStatus(sendResponse) {
  ensureResumed().then(() => {
    const status = getStatus();

    if (!status.running || status.mode !== "openTabs") {
      sendResponse(status);
      return;
    }

    const tabId = state.tabIds[state.currentIndex];
    if (typeof tabId !== "number") {
      status.currentItem = "Unknown tab";
      sendResponse(status);
      return;
    }

    chrome.tabs.get(tabId, (tab) => {
      status.currentItem = !chrome.runtime.lastError && tab ? tab.title : "Unknown tab";
      sendResponse(status);
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") {
    return false;
  }

  if (message.action === "tick") {
    if (state.running) {
      advance();
    } else {
      ensureResumed().then(() => {
        if (state.running) {
          advance();
        } else if (HAS_OFFSCREEN) {
          stopOffscreenTimer();
        }
      });
    }
    return false;
  }

  if (message.action === "start") {
    handleStart(message, sendResponse);
    return true;
  }

  if (message.action === "stop") {
    resetState().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === "getStatus") {
    handleGetStatus(sendResponse);
    return true;
  }

  return false;
});

ensureResumed();
