# ADR-006: Canonical machine definition format

## Status
Accepted

## Context
The framework has two markup substrates: HTML (frontend) and SCXML (backend). Both describe the same thing — state machines with guards, actions, context, and transitions. The engine needs to execute them uniformly.

## Decision
Define a canonical machine definition format — a plain JS object — that both HTML and SCXML compile into. S-expressions are preserved as strings in this format, not pre-compiled or pre-evaluated.

## Format

```js
{
  id: "machine-name",
  initial: "first-state",
  context: { key: value, ... },
  states: {
    "state-name": {
      on: {
        "event-name": [{
          target: "next-state",
          guard: "(s-expression)",    // string, evaluated at runtime
          action: "(s-expression)",   // string, evaluated at runtime
          emit: "event-name"          // optional
        }]
      },
      init: "(s-expression)",         // run on entry
      exit: "(s-expression)",         // run before exit
      after: { ms: 1000, target: "timeout-state" },  // temporal
      every: { ms: 500, action: "(s-expression)" },   // repeating
      final: false
    }
  }
}
```

## Rationale
- **S-expressions stay as strings** — they are not compiled to AST at definition time. The evaluator parses and caches them lazily at first evaluation. This preserves inspectability: you can read a guard and understand it.
- **Plain JS object** — serialisable to JSON for storage, transferable between services, inspectable in a debugger.
- **Uniform execution** — the engine's `sendEvent` function works on this format regardless of whether it came from HTML or SCXML. One code path for transition logic.
- **No intermediate representation tax** — the format is the simplest possible description. No visitor pattern, no node types, no abstract syntax complexity.

## Consequences
- Both runtimes need a compiler: HTML → canonical (browser), SCXML → canonical (backend).
- The browser currently compiles and executes in one pass (`_createInstance`). Refactoring to a two-pass model is technical debt D2.
- The canonical format is an internal detail, not a user-facing API. Users write HTML or SCXML, never JSON.
- Machine tooling (graph, lint, REPL) operates on the canonical format, making it host-agnostic.
