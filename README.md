# Training Plan Overview

[https://nikimicallef.github.io/training-plan-overview/](https://nikimicallef.github.io/training-plan-overview/)

## Requirements

- Node `24+`
- npm

The project declares `node >=24.0.0` in [package.json](/Users/micalln/workspace/training-plan-overview/package.json).

## Install

From the project root:

```bash
npm install
```

## Environment

Committed template:

- [.env.example](/Users/micalln/workspace/training-plan-overview/.env.example)

Local ignored file:

- [.env.local](/Users/micalln/workspace/training-plan-overview/.env.local)

Create the local file from the template:

```bash
cp .env.example .env.local
```

Current environment variables:

- `RUN_LIVE_INTERVALS_ICU_TESTS`
  Controls whether the live Intervals.icu integration suite runs.
  Default: `false`
- `INTERVALS_ICU_API_KEY`
  Real Intervals.icu API key used only by the live integration suite.
  Default: empty

`.env.local` is sourced automatically by:

```bash
npm run test:intervals
```

## Run Locally

Start the Vite dev server:

```bash
npm run dev
```

Open the local URL printed by Vite, usually:

```text
http://localhost:5173
```

## Build

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Tests

Run the default test suite:

```bash
npm test -- --run
```

or:

```bash
npm test
```

This runs the standard Vitest suite and skips the live Intervals.icu integration tests unless explicitly enabled.

Run the opt-in Intervals.icu integration suite:

```bash
npm run test:intervals
```

To actually execute the live Intervals.icu tests, set the following in `.env.local`:

```env
RUN_LIVE_INTERVALS_ICU_TESTS=true
INTERVALS_ICU_API_KEY=your_real_api_key
```

Those tests:

- create real Intervals.icu events
- update real Intervals.icu events
- delete real Intervals.icu events
- attempt cleanup after the run

Do not enable them in CI unless you intentionally want external API traffic and have provided a valid API key.

## License

This project is licensed under the custom attribution terms in [LICENSE.md](/Users/micalln/workspace/training-plan-overview/LICENSE.md).

Copying, forking, modifying, and redistributing are allowed, but public reuse must include this attribution line prominently:

Built on top of a project created by [Niki Micallef](https://www.instagram.com/niki.runs/) from [Born on the Trail](https://www.bornonthetrail.com/), originally hosted on [GitHub](https://github.com/nikimicallef/training-plan-overview).

## Common Commands

```bash
npm install
npm run dev
npm run build
npm run preview
npm test -- --run
npm run test:intervals
```
