window.BDA_CONFIG = {
  // Google Form public submission endpoint, e.g. https://docs.google.com/forms/d/e/.../formResponse
  formAction: '',

  // Entry name for the single short-answer field, e.g. entry.123456789
  formEntry: '',

  // Published CSV containing active question in A2 (header in A1)
  controlCsv: '',

  // Published CSV containing response rows
  responsesCsv: '',

  // Zero-based columns in responsesCsv for QuestionID and Answer
  responseQuestionColumn: 1,
  responseAnswerColumn: 2,

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
