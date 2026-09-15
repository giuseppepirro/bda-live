window.BDA_CONFIG = {
  // Google Form public submission endpoint.
  formAction: 'https://docs.google.com/forms/d/e/1FAIpQLSfm5t9i2_dXrORyO_P5PlRXihoyspVBsIkmYXjtx6KNONqDzw/formResponse',

  // Google Form short-answer field.
  formEntry: 'entry.136156598',

  // Public CSV for the control sheet. Active question is B1; the frontend reads row 1, column 2.
  controlCsv: 'https://docs.google.com/spreadsheets/d/1-uu8VgqKawuOTh6JNHplNL8FDMnv-VevdFJFOy6hYmY/gviz/tq?tqx=out:csv&sheet=BDA%20LIVE%20Config&range=A1:B2',

  // The Google Form writes responses here. The frontend parses values stored as Qx|||answer.
  responsesCsv: 'https://docs.google.com/spreadsheets/d/1-uu8VgqKawuOTh6JNHplNL8FDMnv-VevdFJFOy6hYmY/gviz/tq?tqx=out:csv&sheet=Risposte%20del%20modulo%201',

  // Zero-based column containing the Google Form answer.
  combinedResponseColumn: 1,

  questions: [
    {
      id: 'Q1',
      type: 'WORDCLOUD',
      question: 'When you hear “Big Data”, what comes to mind?',
      options: []
    },
    {
      id: 'Q2',
      type: 'POLL',
      question: 'Which block interests you most right now?',
      options: [
        'Foundations & Storage',
        'Distributed Computation',
        'Graphs',
        'Retrieval & Learning'
      ]
    },
    {
      id: 'Q3',
      type: 'POLL',
      question: 'If you had to choose today, which route would you take?',
      options: [
        'Project + Oral',
        'Written + Oral',
        'Not sure yet'
      ]
    },
    {
      id: 'Q4',
      type: 'OPEN',
      question: 'What is one thing about the course that is still unclear?',
      options: []
    }
  ]
};
