(() => {
  const c = window.BDA_CONFIG || (window.BDA_CONFIG = {});
  c.questionsCsv = String(c.questionsCsv || '')
    .replace('range=A4:H43', 'range=A4:I44')
    .replace('range=A4:I43', 'range=A4:I44');
  c.defaultCloudSeconds = 30;
})();
