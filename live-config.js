(() => {
  const c = window.BDA_CONFIG || (window.BDA_CONFIG = {});
  c.questionsCsv = String(c.questionsCsv || '').replace('range=A4:H43', 'range=A4:I43');
  if (c.responsesCsv && !c.responsesCsv.includes('headers=')) {
    c.responsesCsv += (c.responsesCsv.includes('?') ? '&' : '?') + 'headers=1';
  }
  c.responseTimestampColumn = 0;
  c.protocolPrefix = 'BDA1';
  c.defaultPollSeconds = 20;
  c.defaultOpenSeconds = 30;
  c.presenterPollMs = 1200;
  c.studentPollMs = 1800;
  c.registrationRetryMs = 8000;
  c.actionPendingTimeoutMs = 15000;

  const studentView = new URLSearchParams(location.search).get('view') !== 'present';
  if (studentView) {
    const root = document.getElementById('app');
    if (root) root.id = 'bda-identity-hold';
    setTimeout(() => {
      const held = document.getElementById('bda-identity-hold');
      if (held) held.id = 'app';
      const script = document.createElement('script');
      script.src = `identity-bootstrap.js?v=20260915-matricola-key-${Date.now()}`;
      document.body.appendChild(script);
    }, 0);
  }
})();
