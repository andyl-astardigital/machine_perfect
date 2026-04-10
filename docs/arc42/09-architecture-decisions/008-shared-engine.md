# ADR-008: Shared engine extracted to separate module

## Status
Accepted

## Context
The s-expression engine (tokenizer, parser, evaluator, stdlib, dependency tracking, scope management, path utilities) was embedded inside the frontend runtime. The backend needs the same engine.

## Decision
Extract the engine into `mn/engine.js` as a standalone UMD module with zero platform dependencies. The frontend embeds a copy for single-file distribution. The backend imports it directly.

## What is in the shared engine
- Tokenizer (`tokenize`)
- Parser with cache (`parse`)
- Evaluator with depth limit (`seval`, `sevalInner`)
- Pure evaluator (`sevalPure`)
- Standard library (~120 functions, `stdlib`)
- First-class function values (`firstClass`)
- Expression interface (`eval` for reads, `exec` for writes)
- Scope management (`makeScope`, `applyScope`)
- Dependency tracking (`depKey`, `startTracking`, `stopTracking`)
- Path utilities with safety (`get`, `set`)
- User function registry (`fn`, `userFns`)
- Debug mode

## What is NOT in the shared engine
- DOM APIs (querySelector, setAttribute, etc.)
- HTML attribute parsing
- CSS transitions
- MutationObserver
- Event delegation
- Routing
- localStorage persistence
- Template/slot system
- List rendering (mn-each)

## Rationale
- One source of truth: fixes to the evaluator apply to both runtimes.
- Testable in isolation: the engine can be tested in Node without a browser.
- Zero dependencies: the engine is pure JavaScript. No DOM, no Node APIs, no npm packages.
- UMD module: works with require(), define(), or as a global.

## Consequences
- The frontend `mn/browser.js` imports the engine at runtime via UMD. No build step, no duplication.
- The engine API is internal. It's stable for machine_native consumers but not a public npm package yet.
