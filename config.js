window.BDA_CONFIG = {
  // Google Form public submission endpoint.
  formAction: 'https://docs.google.com/forms/d/e/1FAIpQLSfm5t9i2_dXrORyO_P5PlRXihoyspVBsIkmYXjtx6KNONqDzw/formResponse',

  // Google Form short-answer field. Answers remain encoded as Qx|||answer.
  formEntry: 'entry.136156598',

  // Public CSV for the control sheet. The active question ID is in B1.
  controlCsv: 'https://docs.google.com/spreadsheets/d/1-uu8VgqKawuOTh6JNHplNL8FDMnv-VevdFJFOy6hYmY/gviz/tq?tqx=out:csv&sheet=BDA%20LIVE%20Config&range=A1:B2',

  // Dynamic question bank in rows 4-43, columns A:H:
  // ID, Week, Type, Question, Options, Correct answer, Teaching cue, Source.
  questionsCsv: 'https://docs.google.com/spreadsheets/d/1-uu8VgqKawuOTh6JNHplNL8FDMnv-VevdFJFOy6hYmY/gviz/tq?tqx=out:csv&sheet=BDA%20LIVE%20Config&range=A4:H43',

  // The Google Form writes responses here. The frontend parses values stored as Qx|||answer.
  responsesCsv: 'https://docs.google.com/spreadsheets/d/1-uu8VgqKawuOTh6JNHplNL8FDMnv-VevdFJFOy6hYmY/gviz/tq?tqx=out:csv&sheet=Risposte%20del%20modulo%201',

  // Zero-based column containing the Google Form answer.
  combinedResponseColumn: 1
};
