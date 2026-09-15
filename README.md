# BDA LIVE

Public live classroom interaction frontend for **Big Data Analytics and Reasoning**.

## Views

- Student view: `https://giuseppepirro.github.io/bda-live/`
- Presenter view: `https://giuseppepirro.github.io/bda-live/?view=present`

## Dynamic question bank

Questions are read live from the Google Sheet **BDA LIVE Config**.

- `B1` contains the active question ID.
- Question rows are `4:43`, columns `A:H`.
- Columns are: `ID`, `Week`, `Type`, `Question`, `Options`, `Correct answer`, `Teaching cue`, `Source`.
- `Options` are pipe-separated (`A|B|C|D`).
- Supported frontend interaction types are `POLL`, `OPEN`, and `WORDCLOUD`.

Changing `B1` during class switches both the student and presenter views automatically. Adding or editing question text/options in rows 4–43 does not require a code change.

### Pause / disable submissions

Set `B1` to `OFF` to pause BDA LIVE. No question row named `OFF` is required.

While paused:

- student inputs disappear;
- submissions are disabled;
- the student and presenter views show `Waiting for the next question…`;
- changing `B1` back to any valid question ID automatically resumes the session.

## Architecture

The frontend is hosted on GitHub Pages. Google Forms is used for anonymous submissions and Google Sheets is used as the live data source.

The existing Google Form backend is preserved. The frontend submits through `entry.136156598` and encodes each answer as:

`Qx|||answer`

The response sheet is then read back by the presenter view and filtered by the currently active question ID.

`config.js` contains only backend/data-source configuration; the question bank itself is no longer hard-coded in the repository.
