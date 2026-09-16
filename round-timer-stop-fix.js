(() => {
  'use strict';

  function stopClosedRoundTimer() {
    const root = document.getElementById('app');
    if (!root) return;

    const presenterClosed = !!root.querySelector('.state-pill.closed');
    const kicker = root.querySelector('.kicker');
    const studentClosed = !!kicker && /\bCLOSED\b/i.test(kicker.textContent || '');
    if (!presenterClosed && !studentClosed) return;

    root.querySelectorAll('.timer-value[data-round-deadline]').forEach(timer => {
      timer.textContent = '0';
      timer.removeAttribute('data-round-deadline');
      timer.dataset.roundStopped = '1';
    });
  }

  const observer = new MutationObserver(() => queueMicrotask(stopClosedRoundTimer));
  observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});

  stopClosedRoundTimer();
  setInterval(stopClosedRoundTimer, 200);
})();
