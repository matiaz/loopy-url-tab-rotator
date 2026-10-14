(() => {
  let port = chrome.runtime.connect({ name: "keepalive" });
  port.onDisconnect.addListener(() => {
    port = null;
  });
})();
