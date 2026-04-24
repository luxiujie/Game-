# Game++ Desktop for Nexus Mods

Game++ is a Windows desktop application built with Electron, React, and TypeScript to provide a local-first Nexus Mods experience. It is designed to help users sign in with their Nexus Mods account, browse supported games and mods, receive `nxm://` protocol callbacks, and manage local downloads from a dedicated desktop interface.

This repository is currently under active development. The project already includes the core desktop shell, local account flow, download orchestration, persistent queue/history management, and protocol handoff handling, while some network-routing features are still being expanded.

## Project Goals

- Provide a desktop-native workflow for Nexus Mods users on Windows
- Support official Nexus Mods account authentication for in-app user access
- Handle `nxm://` links locally so download actions can return to the desktop app
- Keep account credentials, session state, and download state on the user's own machine
- Build a foundation for future download-source expansion and desktop-side automation

## Current Capabilities

- Electron desktop shell with React renderer
- Nexus Mods account connection
  - Personal API key login
  - OAuth / SSO-style desktop handoff flow scaffold
- Game list, mod overview, and mod detail browsing
- Local download dispatch flow
  - Premium users can use direct desktop download flow
  - Non-premium users can be redirected to the browser and returned through `nxm://`
- `nxm://` protocol registration and callback handling
- Persistent download queue, history, and recent protocol events
- Local settings management for download directory, retries, and network behavior
- Proxy configuration UI with system, built-in, and custom proxy modes

## Authentication and OAuth Use

This project requests an official Nexus Mods application identity so users can sign in from within the desktop app instead of relying only on manually pasted API keys.

The intended OAuth use case is:

- open the official Nexus Mods authorization flow from the desktop app
- let the user approve access with their own Nexus Mods account
- receive the authorization result locally in the desktop application
- store the resulting local session only on the user's machine
- use that session only to access Nexus Mods features that the user has explicitly authorized

The application does not aim to resell, mirror, or publicly redistribute Nexus Mods content. Its purpose is to provide a desktop client experience for browsing and download handoff initiated by the end user.

## Privacy and Security Notes

- User credentials and session data are stored locally on the user's device
- When available, Electron safe storage is used for local secret protection
- Download state, settings, and protocol events are persisted locally
- The app does not require a public third-party account dashboard for routine use
- The project is intended to act as a client for the authenticated end user, not as a credential-sharing service

## Technical Overview

- Frontend: React + TypeScript + Vite
- Desktop shell: Electron
- Shared contracts: TypeScript interfaces shared across renderer and desktop service
- Local service layer: desktop-side orchestration for auth, downloads, queue state, and protocol callbacks
- Nexus integration: API client and OAuth / SSO helper flow

Key folders:

- `src/`: renderer UI
- `electron/`: desktop runtime, IPC, persistence, download handling, protocol routing
- `server/`: reusable Nexus API and OAuth/SSO integration logic
- `shared/`: shared TypeScript contracts

## Development

```bash
npm install
npm run dev
```

Build the project:

```bash
npm run build
```

## Current Status

This project is a working desktop prototype / foundation rather than a fully finished public release.

Implemented today:

- desktop UI shell
- local account connection flow
- `nxm://` registration and callback handling
- download queue and history persistence
- local file download orchestration

Still being expanded:

- full production-ready OAuth flow polish
- built-in proxy endpoint list integration from a backend service
- additional installation and post-download workflows

## Intended Audience

Game++ is intended for Nexus Mods users who want a desktop-first workflow for browsing content, authenticating locally, and managing download handoff in a dedicated Windows application.

## Disclaimer

This is an independent software project and is not affiliated with, endorsed by, or maintained by Nexus Mods.
