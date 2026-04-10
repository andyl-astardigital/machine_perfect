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
- The engine is a separate module (`mp/engine.js`) imported by `mp/browser.js` at runtime. No build step, no duplication.
- `mp/browser.js` is ~2100 lines / ~98KB unminified. The engine adds ~800 lines. Reasonable for a framework.
- npm consumers get the browser runtime via `require('machine-perfect/browser')` and the engine via `require('machine-perfect')`.
