# Datependency

Datependency is a lightweight release/version planning app for tracking milestone dates across product versions. It is built for local single-user use with a small Express server, vanilla HTML/CSS/JS, and JSON file persistence.

## What It Does

- Create versions with a GA date.
- Track configurable milestones per version.
- Mark milestones as completed.
- Mark versions as released and hide released versions by default.
- View versions as detailed cards, collapsed rows, or a month/quarter timeline.
- Keep an append-only audit trail in `server/audit.log`.

## Requirements

- Node.js 18 or newer
- npm

## Setup

Install dependencies:

```bash
npm install
```

## Run The App

Start the server:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Settings are available at:

```text
http://localhost:3000/settings
```

## Data Files

- `server/data.json` stores versions and the milestone template.
- `server/audit.log` stores audit events as JSON lines.

## Tests

Run the dependency engine tests:

```bash
npm test
```
