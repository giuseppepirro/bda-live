(() => {
  const c = window.BDA_CONFIG || (window.BDA_CONFIG = {});
  c.questionsCsv = String(c.questionsCsv || '').replace('range=A4:H43', 'range=A4:I43');
  if (c.responsesCsv && !c.responsesCsv.includes('headers=')) {
    c.responsesCsv += (c.responsesCsv.includes('?') ? '&' : '?') + 'headers=1';
  }
  c.responseTimestampColumn = 0;
  c.protocolPrefix = 'BDA2';
  c.productionCutover = '2026-09-21';
  c.defaultPollSeconds = 20;
  c.defaultOpenSeconds = 30;
  c.presenterPollMs = 1200;
  c.studentPollMs = 1800;
  c.registrationRetryMs = 8000;
  c.registrationControlValue = 'REGISTRATION';
  c.registrationPollMs = 1400;
  c.registrationAckTimeoutMs = 7000;
  c.registrationSubmitJitterMs = 2500;
  c.registrationMaxAttempts = 3;
  c.registrationPresenterPollMs = 700;
  c.actionPendingTimeoutMs = 15000;
  c.studentKeyTimeoutMs = 25000;
  c.studentKeyEndpoint = 'https://script.google.com/macros/s/AKfycbx1WFq39rAT0CAAOAdsiM3GKpm9_zN_l40SbS0Srti29-j9iQtv4UBUkeC_G66YLFkI/exec';

  const style = document.createElement('style');
  style.textContent = '.identity-chip{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';
  document.head.appendChild(style);

  const studentView = new URLSearchParams(location.search).get('view') !== 'present';
  if (studentView) {
    const root = document.getElementById('app');
    if (root) root.id = 'bda-identity-hold';
    setTimeout(() => {
      const held = document.getElementById('bda-identity-hold');
      if (held) held.id = 'app';
      const script = document.createElement('script');
      script.src = `registration-bootstrap.js?v=20260918-registration-${Date.now()}`;
      document.body.appendChild(script);
    }, 0);
  }
})();
