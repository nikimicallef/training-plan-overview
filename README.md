# Training Plan Overview

## Requirements

- Node `24+`
- npm

The project declares `node >=24.0.0` in [package.json](/Users/micalln/workspace/training-plan-overview/package.json).

If this machine resolves an older `node` by default, use the Homebrew Node path:

```bash
env PATH=/opt/homebrew/bin:$PATH <command>
```

Examples in this README use plain `npm`, but the `PATH` prefix may be required on this machine.

## Install

From the project root:

```bash
npm install
```

If needed:

```bash
env PATH=/opt/homebrew/bin:$PATH npm install
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

## GitHub Pages

The app is configured for GitHub Pages deployment through GitHub Actions.

Relevant files:

- [vite.config.ts](/Users/micalln/workspace/training-plan-overview/vite.config.ts)
- [.github/workflows/deploy-pages.yml](/Users/micalln/workspace/training-plan-overview/.github/workflows/deploy-pages.yml)
- [public/.nojekyll](/Users/micalln/workspace/training-plan-overview/public/.nojekyll)

To deploy:

1. Push the repository to GitHub.
2. Open `Settings -> Pages`.
3. Set `Source` to `GitHub Actions`.
4. Push to the configured branch or run the workflow manually.

## Common Commands

```bash
npm install
npm run dev
npm run build
npm run preview
npm test -- --run
npm run test:intervals
```
