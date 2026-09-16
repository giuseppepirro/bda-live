window.BDA_CONFIG = {
  // Google Form public submission endpoint.
  formAction: 'https://docs.google.com/forms/d/e/1FAIpQLSfm5t9i2_dXrORyO_P5PlRXihoyspVBsIkmYXjtx6KNONqDzw/formResponse',

  // Google Form short-answer field. Events are stored using the BDA1 protocol.
  formEntry: 'entry.136156598',

  // Public CSV for the control sheet. B1 contains OFF, Qx, or ROUND:<round-id>.
  controlCsv: 'https://docs.google.com/spreadsheets/d/1-uu8VgqKawuOTh6JNHplNL8FDMnv-VevdFJFOy6hYmY/gviz/tq?tqx=out:csv&sheet=BDA%20LIVE%20Config&range=A1:B2',

  // Question bank. Column J is the editable round membership.
  // ID, Week, Type, Question, Options, Correct answer, Teaching cue, Source, Time limit, Round.
  questionsCsv: 'https://docs.google.com/spreadsheets/d/1-uu8VgqKawuOTh6JNHplNL8FDMnv-VevdFJFOy6hYmY/gviz/tq?tqx=out:csv&headers=0&sheet=BDA%20LIVE%20Config&range=A4:J60',

  // Round definitions: Round ID, Label, Mode, Duration, Notes.
  roundsCsv: 'https://docs.google.com/spreadsheets/d/1-uu8VgqKawuOTh6JNHplNL8FDMnv-VevdFJFOy6hYmY/gviz/tq?tqx=out:csv&headers=1&sheet=BDA%20LIVE%20Rounds&range=A1:E30',

  // The Google Form writes all REGISTER / START / ANSWER / END / RESET events here.
  responsesCsv: 'https://docs.google.com/spreadsheets/d/1-uu8VgqKawuOTh6JNHplNL8FDMnv-VevdFJFOy6hYmY/gviz/tq?tqx=out:csv&sheet=Risposte%20del%20modulo%201',

  // Zero-based column containing the Google Form answer/event payload.
  combinedResponseColumn: 1
};
