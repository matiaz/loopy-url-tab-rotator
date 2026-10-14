const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const MIN_INTERVAL_SEC = 1;
const MAX_INTERVAL_SEC = 86400;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

let statusInterval = null;

function parseHttpUrl(value) {
  const input = SCHEME_PATTERN.test(value) ? value : "https://" + value;
  let url;
  try {
    url = new URL(input);
  } catch (e) {
    return { error: "Enter a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "Only http:// and https:// URLs are supported." };
  }
  return { url: url.href };
}

function isHttpUrl(value) {
  return typeof value === "string" && SCHEME_PATTERN.test(value) && !parseHttpUrl(value).error;
}

function showFieldError(el, message) {
  el.textContent = message;
  el.classList.remove("hidden");
}

function clearFieldError(el) {
  el.textContent = "";
  el.classList.add("hidden");
}

function initTheme() {
  chrome.storage.local.get("theme", (data) => {
    const theme = data.theme || "light";
    document.documentElement.setAttribute("data-theme", theme);
  });

  $("#theme-toggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    chrome.storage.local.set({ theme: next });
  });
}

function initTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => t.classList.remove("active"));
      $$(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $(`#${tab.dataset.tab}-panel`).classList.add("active");
    });
  });
}

function initSingleTab() {
  const urlInput = $("#url-input");
  const urlAddBtn = $("#url-add-btn");
  const urlList = $("#url-list");
  const intervalSelect = $("#single-interval");
  const customInterval = $("#single-custom-interval");
  const loopCheckbox = $("#single-loop");
  const loopOptions = $("#single-loop-options");
  const loopRadios = document.querySelectorAll('input[name="single-loop-type"]');
  const loopCountWrap = $("#single-loop-count-wrap");
  const urlError = $("#url-error");

  function addUrl() {
    const value = urlInput.value.trim();
    if (!value) return;
    const result = parseHttpUrl(value);
    if (result.error) {
      showFieldError(urlError, result.error);
      urlInput.focus();
      return;
    }
    clearFieldError(urlError);
    renderUrlItem(result.url);
    urlInput.value = "";
    urlInput.focus();
    saveSettings();
  }

  urlAddBtn.addEventListener("click", addUrl);
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addUrl();
  });
  urlInput.addEventListener("input", () => clearFieldError(urlError));

  function renderUrlItem(url) {
    const li = document.createElement("li");
    li.setAttribute("draggable", "true");

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "\u2630";

    const text = document.createElement("span");
    text.className = "url-text";
    text.textContent = url;
    text.title = url;

    const del = document.createElement("button");
    del.className = "url-delete";
    del.textContent = "\u00d7";
    del.addEventListener("click", () => {
      li.remove();
      saveSettings();
    });

    li.appendChild(handle);
    li.appendChild(text);
    li.appendChild(del);
    urlList.appendChild(li);

    li.addEventListener("dragstart", (e) => {
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      saveSettings();
    });

    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dragging = urlList.querySelector(".dragging");
      if (!dragging || dragging === li) return;
      const rect = li.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const reference = e.clientY < midY ? li : li.nextSibling;
      if (reference === dragging || dragging.nextSibling === reference) return;
      urlList.insertBefore(dragging, reference);
    });
  }

  intervalSelect.addEventListener("change", () => {
    customInterval.classList.toggle("hidden", intervalSelect.value !== "custom");
    clearFieldError($("#single-interval-error"));
    saveSettings();
  });

  $("#single-custom-seconds").addEventListener("change", saveSettings);
  $("#single-custom-seconds").addEventListener("input", () => clearFieldError($("#single-interval-error")));

  loopCheckbox.addEventListener("change", () => {
    loopOptions.classList.toggle("hidden", !loopCheckbox.checked);
    saveSettings();
  });

  loopRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      loopCountWrap.classList.toggle("hidden", radio.value !== "count" || !radio.checked);
      saveSettings();
    });
  });

  $("#single-loop-count").addEventListener("change", saveSettings);

  $("#single-start-btn").addEventListener("click", () => {
    const urls = getUrlList();
    if (urls.length === 0) return;

    const interval = getValidatedInterval("single");
    if (interval === null) return;

    const config = {
      urls,
      interval,
      loop: loopCheckbox.checked,
      indefinite: loopCheckbox.checked && document.querySelector('input[name="single-loop-type"]:checked').value === "indefinite",
      loopCount: loopCheckbox.checked ? parseInt($("#single-loop-count").value) || 2 : null
    };

    sendStart("singleTab", config);
  });

  return { renderUrlItem };
}

function initOpenTabs() {
  const intervalSelect = $("#tabs-interval");
  const customInterval = $("#tabs-custom-interval");
  const loopCheckbox = $("#tabs-loop");
  const loopOptions = $("#tabs-loop-options");
  const loopRadios = document.querySelectorAll('input[name="tabs-loop-type"]');
  const loopCountWrap = $("#tabs-loop-count-wrap");

  intervalSelect.addEventListener("change", () => {
    customInterval.classList.toggle("hidden", intervalSelect.value !== "custom");
    clearFieldError($("#tabs-interval-error"));
    saveSettings();
  });

  $("#tabs-custom-seconds").addEventListener("change", saveSettings);
  $("#tabs-custom-seconds").addEventListener("input", () => clearFieldError($("#tabs-interval-error")));

  loopCheckbox.addEventListener("change", () => {
    loopOptions.classList.toggle("hidden", !loopCheckbox.checked);
    saveSettings();
  });

  loopRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      loopCountWrap.classList.toggle("hidden", radio.value !== "count" || !radio.checked);
      saveSettings();
    });
  });

  $("#tabs-loop-count").addEventListener("change", saveSettings);

  $("#tabs-start-btn").addEventListener("click", () => {
    const interval = getValidatedInterval("tabs");
    if (interval === null) return;

    const config = {
      interval,
      loop: loopCheckbox.checked,
      indefinite: loopCheckbox.checked && document.querySelector('input[name="tabs-loop-type"]:checked').value === "indefinite",
      loopCount: loopCheckbox.checked ? parseInt($("#tabs-loop-count").value) || 2 : null,
      reloadOnSwitch: $("#tabs-reload").checked
    };

    sendStart("openTabs", config);
  });
}

function getUrlList() {
  const items = $$("#url-list li .url-text");
  return Array.from(items).map((el) => el.textContent);
}

function sendStart(mode, config) {
  chrome.runtime.sendMessage({ action: "start", mode, config }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) return;
    showStatusView();
  });
}

function getInterval(prefix) {
  const select = $(`#${prefix}-interval`);
  if (select.value !== "custom") {
    return parseInt(select.value);
  }
  const raw = $(`#${prefix}-custom-seconds`).value.trim();
  const seconds = raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(seconds) || seconds < MIN_INTERVAL_SEC || seconds > MAX_INTERVAL_SEC) {
    return null;
  }
  return Math.floor(seconds);
}

function getValidatedInterval(prefix) {
  const interval = getInterval(prefix);
  const errorEl = $(`#${prefix}-interval-error`);
  if (interval === null) {
    showFieldError(errorEl, `Enter a number of seconds between ${MIN_INTERVAL_SEC} and ${MAX_INTERVAL_SEC}.`);
    $(`#${prefix}-custom-seconds`).focus();
    return null;
  }
  clearFieldError(errorEl);
  return interval;
}

function showStatusView() {
  $("#config-view").classList.add("hidden");
  $("#status-view").classList.remove("hidden");
  startStatusPolling();
}

function showConfigView() {
  $("#status-view").classList.add("hidden");
  $("#config-view").classList.remove("hidden");
  stopStatusPolling();
}

function startStatusPolling() {
  stopStatusPolling();
  updateStatus();
  statusInterval = setInterval(updateStatus, 1000);
}

function stopStatusPolling() {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
}

function updateStatus() {
  chrome.runtime.sendMessage({ action: "getStatus" }, (status) => {
    if (chrome.runtime.lastError || !status || !status.running) {
      showConfigView();
      return;
    }

    const modeLabel = status.mode === "singleTab" ? "Single Tab Rotation" : "Open Tabs Rotation";
    $("#status-mode").textContent = modeLabel;
    $("#status-current").textContent = status.currentItem || "";
    $("#status-progress").textContent = `${status.mode === "singleTab" ? "URL" : "Tab"} ${status.currentIndex + 1} of ${status.totalItems}`;

    if (status.loop) {
      if (status.indefinite) {
        $("#status-loop").textContent = `Loop ${status.currentLoop + 1} (indefinite)`;
      } else {
        $("#status-loop").textContent = `Loop ${status.currentLoop + 1} of ${status.loopCount}`;
      }
      $("#status-loop").classList.remove("hidden");
    } else {
      $("#status-loop").classList.add("hidden");
    }

    const elapsed = Math.floor((Date.now() - status.startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    $("#status-elapsed").textContent = `Elapsed: ${mins}m ${secs.toString().padStart(2, "0")}s`;
  });
}

function initStopButton() {
  $("#stop-btn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "stop" }, () => {
      void chrome.runtime.lastError;
      showConfigView();
    });
  });
}

function saveSettings() {
  const singleLoopType = document.querySelector('input[name="single-loop-type"]:checked');
  const tabsLoopType = document.querySelector('input[name="tabs-loop-type"]:checked');

  const settings = {
    singleTab: {
      urls: getUrlList(),
      interval: getInterval("single"),
      intervalSelect: $("#single-interval").value,
      customSeconds: $("#single-custom-seconds").value,
      loop: $("#single-loop").checked,
      loopType: singleLoopType ? singleLoopType.value : "indefinite",
      loopCount: parseInt($("#single-loop-count").value) || 2
    },
    openTabs: {
      interval: getInterval("tabs"),
      intervalSelect: $("#tabs-interval").value,
      customSeconds: $("#tabs-custom-seconds").value,
      loop: $("#tabs-loop").checked,
      loopType: tabsLoopType ? tabsLoopType.value : "indefinite",
      loopCount: parseInt($("#tabs-loop-count").value) || 2,
      reloadOnSwitch: $("#tabs-reload").checked
    }
  };

  chrome.storage.local.set(settings);
}

function loadSettings(singleTabHelpers) {
  chrome.storage.local.get(["singleTab", "openTabs"], (data) => {
    if (data.singleTab) {
      const s = data.singleTab;
      if (s.urls) {
        s.urls.filter(isHttpUrl).forEach((url) => singleTabHelpers.renderUrlItem(url));
      }
      if (s.intervalSelect) {
        $("#single-interval").value = s.intervalSelect;
        if (s.intervalSelect === "custom") {
          $("#single-custom-interval").classList.remove("hidden");
          $("#single-custom-seconds").value = s.customSeconds || "";
        }
      }
      if (s.loop) {
        $("#single-loop").checked = true;
        $("#single-loop-options").classList.remove("hidden");
        const radio = document.querySelector(`input[name="single-loop-type"][value="${s.loopType || "indefinite"}"]`);
        if (radio) radio.checked = true;
        if (s.loopType === "count") {
          $("#single-loop-count-wrap").classList.remove("hidden");
          $("#single-loop-count").value = s.loopCount || 2;
        }
      }
    }

    if (data.openTabs) {
      const o = data.openTabs;
      if (o.intervalSelect) {
        $("#tabs-interval").value = o.intervalSelect;
        if (o.intervalSelect === "custom") {
          $("#tabs-custom-interval").classList.remove("hidden");
          $("#tabs-custom-seconds").value = o.customSeconds || "";
        }
      }
      if (o.loop) {
        $("#tabs-loop").checked = true;
        $("#tabs-loop-options").classList.remove("hidden");
        const radio = document.querySelector(`input[name="tabs-loop-type"][value="${o.loopType || "indefinite"}"]`);
        if (radio) radio.checked = true;
        if (o.loopType === "count") {
          $("#tabs-loop-count-wrap").classList.remove("hidden");
          $("#tabs-loop-count").value = o.loopCount || 2;
        }
      }
      if (o.reloadOnSwitch) {
        $("#tabs-reload").checked = true;
      }
    }
  });
}

function checkRunningState() {
  chrome.runtime.sendMessage({ action: "getStatus" }, (status) => {
    if (chrome.runtime.lastError) return;
    if (status && status.running) {
      showStatusView();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initTabs();
  const singleTabHelpers = initSingleTab();
  initOpenTabs();
  initStopButton();
  loadSettings(singleTabHelpers);
  checkRunningState();
  $("#version-label").textContent = "v" + chrome.runtime.getManifest().version;
});
