(() => {
  'use strict';
  function patch() {
    const root = document.getElementById('app');
    if (!root) return;
    const kicker = String(root.querySelector('.kicker')?.textContent || '');
    const title = String(root.querySelector('.site-header h1')?.textContent || '');
    const isQ0 = /(^|\s|·)Q0(\s|·|$)/.test(kicker) || title.includes('When you hear “Big Data”');
    if (!isQ0) return;
    root.querySelectorAll('.timer').forEach(el => { el.style.display = 'none'; });
    const prepared = root.querySelector('.prepared-card > p');
    if (prepared && /86400\s*s/i.test(prepared.textContent || '')) prepared.textContent = 'UNTIMED · WORDCLOUD';
  }
  const observer = new MutationObserver(() => queueMicrotask(patch));
  observer.observe(document.documentElement,{childList:true,subtree:true});
  patch();
})();
