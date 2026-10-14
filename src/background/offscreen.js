let timerId = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "start-offscreen-timer") {
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      chrome.runtime.sendMessage({ action: "tick" });
    }, message.interval);
  }

  if (message.action === "stop-offscreen-timer") {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }
});
