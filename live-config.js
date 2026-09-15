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
})();
