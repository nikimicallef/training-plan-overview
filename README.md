# Training Plan Overview

Front-end React + TypeScript application for planning endurance training across three connected views:

- `Volume Design`: weekly volume, zones, elevation, and long-run percentages
- `Week Design`: event priorities, phase goals, and weekly focus planning
- `Calendar`: daily workout scheduling against the prescribed weekly plan

## Requirements

- Node `24+`
- npm

This project is configured for Node `24+` in `package.json`.

## Install

From the project root:

```bash
npm install
```

If your default `node` is older on this machine, use the Homebrew Node path:

```bash
env PATH=/opt/homebrew/bin:$PATH npm install
```

## Run Locally

Start the Vite dev server:

```bash
npm run dev
```

If your shell still resolves to an older Node version, run:

```bash
env PATH=/opt/homebrew/bin:$PATH npm run dev
```

Then open the local URL printed by Vite, usually:

```text
http://localhost:5173
```

## Build

Create a production build:

```bash
npm run build
```

Or with the Homebrew Node path:

```bash
env PATH=/opt/homebrew/bin:$PATH npm run build
```

Preview the production build locally:

```bash
npm run preview
```

Or:

```bash
env PATH=/opt/homebrew/bin:$PATH npm run preview
```

## Deploy to GitHub Pages

This repo is configured to deploy through GitHub Actions.

What is already set up:

- Vite uses relative asset paths, so the app can be hosted on a GitHub Pages project site
- A Pages workflow is included at `.github/workflows/deploy-pages.yml`
- A `public/.nojekyll` file is included so GitHub Pages serves the static files as-is

What you need to do in GitHub:

1. Push this repository to GitHub.
2. Open `Settings -> Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Push to `main` or `master`, or run the workflow manually from the `Actions` tab.

The workflow will:

- install dependencies with Node `24`
- run `npm run build`
- publish the `dist/` folder to GitHub Pages

## Main Features

- Split-screen layout with a resizable divider
- Left-side live chart with:
  - stacked weekly bars for `Z1`, `Z2`, `Z3`
  - long-run line
  - elevation line
  - event-grade background bands from Week Design
- Right-side tabs:
  - `Volume Design`
  - `Week Design`
  - `Calendar`
- Export tools:
  - `Download Package`: zip with chart image, week-design image, and calendar Excel file
  - `Download JSON`: save the full planner state
  - `Upload JSON`: restore a previously saved planner state

## Notes

- Week countdown is zero-based relative to race week:
  - race week = `0`
  - previous week = `1`
- Calendar weeks are Monday to Sunday
- The prescribed weekly values in `Calendar` are always pulled from `Volume Design`
- Scheduled values in `Calendar` come from the daily workouts entered in that tab
