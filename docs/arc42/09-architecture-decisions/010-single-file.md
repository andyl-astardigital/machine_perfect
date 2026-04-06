# ADR-010: Single-file distribution for frontend

## Status
Accepted

## Context
The frontend framework could be distributed as multiple modules (engine + runtime) or as a single self-contained file.

## Decision
Distribute the frontend as a single file (`mp/browser.js`) that embeds the shared engine. No imports, no dependencies, no build step for consumers.

## Rationale
- **Copy and go** — download one file, add a `<script>` tag, it works. The simplest possible onboarding.
- **CDN delivery** — one URL: `unpkg.com/machine-perfect/mp/browser.js`. No dependency resolution.
- **Offline capable** — the file is self-contained. Works from `file://`. Works without internet after first load.
- **View source** — the entire framework is in one file. `Ctrl+U` in the browser shows you everything. Reading the source is documentation.
- **Competitive positioning** — Alpine, Mithril, and Preact all distribute as single files. It's the expected form factor for lightweight frameworks.

## Consequences
- The engine code exists in two places: `mp/engine.js` (source of truth) and embedded in `mp/browser.js` (distribution copy).
- A build script is needed to concatenate `mp/engine.js` + browser DOM code into the distributable. Until then, manual sync.
- The file is ~2000 lines / ~60KB unminified. Reasonable for a framework. Minified + gzipped would be ~8-10KB.
- npm consumers get the single file via `require('machine-perfect')` which points to `mp/browser.js`.
