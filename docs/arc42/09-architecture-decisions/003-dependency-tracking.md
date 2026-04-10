# ADR-003: Runtime dependency tracking without Proxies

## Status
Accepted

## Context
Reactive frameworks need to know which UI elements depend on which data, so they can update selectively. Approaches: Proxies (Vue/Solid), compiler analysis (Svelte), virtual DOM diffing (React), or brute-force re-evaluation (Alpine).

## Decision
Track dependencies at runtime by instrumenting the s-expression evaluator. When a binding is first evaluated, the engine records which context keys were accessed. On subsequent updates, only bindings whose recorded deps overlap with mutated ("dirty") keys are re-evaluated.

## Rationale
- **No Proxies** — Proxies add complexity, have edge cases with arrays and nested objects, and require wrapping user data. Our data is plain JS objects.
- **No compiler** — a compile step would break the "open the HTML file" promise.
- **100% coverage** — because ALL data access flows through `seval` → symbol resolution, we see every read. No opt-in, no wrapping, no decorators. Including dynamic property access via `(get obj key)`.
- **Naturally portable** — the same tracking mechanism works in browser and Node. No platform-specific reactivity system.
- **The evaluator is the instrumentation point** — Vue needs Proxies because it evaluates JavaScript, which it can't intercept. We evaluate s-expressions, which we fully control.

## Consequences
- Deps are tracked on first evaluation. Conditional branches not taken on first eval are not tracked. This is the same trade-off Svelte makes. Full eval fallback catches edge cases.
- The tracking adds a small overhead per symbol resolution (one hash set write). Negligible compared to the evaluation itself.
- External mutations (via JS, not s-expressions) don't record dirty keys. External `update()` calls trigger full evaluation. This is the correct fallback.
