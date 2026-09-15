# BDA LIVE

Public live classroom interaction frontend for **Big Data Analytics and Reasoning**.

## Views

- Student view: `https://giuseppepirro.github.io/bda-live/`
- Presenter view: `https://giuseppepirro.github.io/bda-live/?view=present`

## Interaction modes

- Q1 — word cloud
- Q2 — interest poll
- Q3 — assessment-route poll
- Q4 — open exit ticket

## Architecture

The frontend is hosted on GitHub Pages. Google Forms is used for anonymous submissions and Google Sheets is used as the live data source.

`config.js` contains the four questions and the Google backend endpoints. The page intentionally contains no student identity collection.

## Google backend setup still required

The existing Google Form can be reused as a single transport field. The frontend submits values encoded with the active question ID. The linked response sheet must expose a public CSV view so the presentation page can aggregate responses live.

Once the Google endpoint and published CSV URL are inserted into `config.js`, the same QR can be used throughout the lecture.
