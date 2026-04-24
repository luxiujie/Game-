# Game++

Game++ is a Windows desktop client for working with Nexus Mods in a more local, desktop-oriented way.

The project is built with Electron, React, and TypeScript, and focuses on a few practical pieces of the Nexus workflow: signing in, browsing games and mods, handling `nxm://` callbacks, and coordinating local downloads from the desktop instead of leaving everything to the browser.

It is still an active work in progress, but the core application shell and several key flows are already in place.

## What It Does

- desktop UI for browsing Nexus-related content
- local account connection flow
- `nxm://` protocol registration and callback handling
- download queue and history management
- local persistence for app settings and session state
- network configuration for retry and proxy behavior

## Why This Project Exists

Browser-based mod flows are fine for quick use, but desktop tools are still useful when you want tighter control over local downloads, protocol handoff, and application state.

Game++ is an attempt to build that kind of desktop foundation in a clean and modern stack, with enough structure to keep expanding into a fuller Windows client over time.

Longer term, the project is also meant to grow into game-specific local mod management for selected titles. For games such as Black Myth: Wukong and Black Myth: Zhong Kui, the plan is for Game++ to handle local mods more directly and provide simpler one-click install and one-click uninstall workflows.

## Current State

Already working:

- Electron desktop shell
- React renderer and shared typed contracts
- Nexus account connection via personal API key
- desktop-side SSO / OAuth-style flow scaffold
- game list, mod overview, and mod detail requests
- direct download orchestration for supported cases
- browser handoff plus `nxm://` return flow for other cases
- local queue, history, and recent callback persistence

Still evolving:

- built-in proxy endpoint integration
- game-specific local mod management for selected titles
- one-click install and uninstall flows for supported games
- broader install / post-download workflows
- more complete release polish for wider public use

## Tech Stack

- Electron
- React
- TypeScript
- Vite
- Express for local service helpers where needed

## Project Structure

- `src/` - renderer UI
- `electron/` - desktop runtime, IPC, persistence, download handling, protocol integration
- `server/` - Nexus API and auth-related helper logic
- `shared/` - shared TypeScript contracts
- `scripts/` - development and packaging utilities

## Local-First Behavior

Game++ is designed as a desktop client, so account state, settings, queue state, and download metadata are kept on the user's machine rather than managed through a hosted dashboard.

When platform support is available, local secure storage APIs are used to protect sensitive values.

## Development

Install dependencies:

```bash
npm install
```

Start the desktop app in development mode:

```bash
npm run dev
```

Build the renderer and Electron bundles:

```bash
npm run build
```

Create a Windows package:

```bash
npm run dist:win
```

## Notes

- This project targets Windows desktop usage first.
- Browser preview mode is useful for UI work, but desktop-only features such as protocol registration and local download orchestration require Electron.
- Some network-routing features are present in the UI and desktop runtime, with built-in proxy source integration planned as a later step.

## Disclaimer

Game++ is an independent project and is not affiliated with or endorsed by Nexus Mods.
