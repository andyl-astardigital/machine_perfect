# 4. Solution Strategy

## Core decisions

| Decision | Approach | Alternative rejected |
|----------|----------|---------------------|
| Expression language | S-expressions (Clojure-inspired) | JavaScript expressions (security risk, inconsistent syntax) |
| Component model | Finite state machines | Components with arbitrary state (React/Vue model) |
| Reactivity | Runtime dependency tracking via evaluator instrumentation | Proxies (Vue), compiler (Svelte), virtual DOM (React) |
| Binding purity | Structural enforcement — `_eval` rejects mutation forms | Convention only (Alpine) |
| Shared engine | Single JS codebase, ES5, UMD | Rust port (two codebases to maintain) |
| Backend markup | SCXML + MP extensions | Custom XML format (no standard to build on) |
| Backend persistence | Postgres with JSONB datamodels | Document DB (less query power), flat files (no transactions) |
| Canonical format | Plain JS object with s-expression strings preserved | AST-compiled form (loses readability and inspectability) |

## Architecture approach

**Three-layer split:**

1. **Shared engine** (`mp/engine.js`) — tokenizer, parser, evaluator, stdlib, dependency tracking, scope management, path utilities. Zero platform dependencies. Runs identically in browser and Node.

2. **Canonical machine definition** — a plain JS object that both markup formats (HTML and SCXML) compile into. Contains states, transitions, guards (as s-expression strings), actions (as s-expression strings), initial state, context shape. The engine evaluates the s-expressions at runtime, not at compile time.

3. **Host runtimes** — platform-specific adapters that connect the engine to the outside world.
   - Browser host: DOM bindings, event delegation, CSS transitions, MutationObserver, localStorage.
   - Node host: HTTP API, Postgres persistence, effect adapters, durable timers.

## Key quality approaches

| Quality goal | Approach |
|-------------|----------|
| Performance | Cached binding lists, dirty-key skip, value-diff child updates, cursor-based reconciliation |
| Correctness | Pure bindings (mutations throw), bounded recursion, prototype pollution defense, try/catch on all JSON.parse |
| Portability | S-expressions are strings until evaluation. No platform APIs in guards or actions. |
| Inspectability | Machine definitions are data. Enabled transitions are computable. History is appendable. |
