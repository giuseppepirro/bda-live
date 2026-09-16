(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const DEFAULT_TIMEOUT_MS = 9000;

  window.fetch = function bdaFetch(input, init = {}) {
    const controller = new AbortController();
    const upstream = init.signal;
    let upstreamAbort = null;

    if (upstream) {
      if (upstream.aborted) controller.abort(upstream.reason);
      else {
        upstreamAbort = () => controller.abort(upstream.reason);
        upstream.addEventListener('abort', upstreamAbort, {once:true});
      }
    }

    const timeout = setTimeout(() => controller.abort(new DOMException('BDA request timeout', 'AbortError')), DEFAULT_TIMEOUT_MS);
    return nativeFetch(input, {...init, signal:controller.signal})
      .finally(() => {
        clearTimeout(timeout);
        if (upstream && upstreamAbort) upstream.removeEventListener('abort', upstreamAbort);
      });
  };

  window.addEventListener('error', event => {
    const target = event.target;
    if (!(target instanceof HTMLScriptElement)) return;
    const root = document.getElementById('app');
    if (!root) return;
    root.innerHTML = `<div style="padding:40px;font-family:Arial,sans-serif;max-width:760px">
      <h2 style="margin:0 0 12px">BDA LIVE could not start</h2>
      <p style="color:#666;line-height:1.5">A required script did not load. Refresh the page; if a VPN or privacy extension is active, temporarily disable it for this page.</p>
      <button onclick="location.reload()" style="border:0;border-radius:10px;padding:12px 16px;background:#bd1724;color:white;font-weight:800;cursor:pointer">RETRY</button>
    </div>`;
  }, true);

  setTimeout(() => {
    const root = document.getElementById('app');
    if (!root) return;
    if (!/Loading BDA LIVE/i.test(root.textContent || '')) return;
    root.innerHTML = `<div style="padding:40px;font-family:Arial,sans-serif;max-width:760px">
      <h2 style="margin:0 0 12px">BDA LIVE is waiting for classroom data</h2>
      <p style="color:#666;line-height:1.5">The initial data request did not complete. This is commonly caused by a VPN, privacy extension, or a temporary Google Sheets connection issue.</p>
      <button onclick="location.reload()" style="border:0;border-radius:10px;padding:12px 16px;background:#bd1724;color:white;font-weight:800;cursor:pointer">RETRY</button>
    </div>`;
  }, 11000);
})();
