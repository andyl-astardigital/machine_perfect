# ADR-005: Node.js for backend (not Rust)

## Status
Accepted

## Context
The backend needs a runtime for the SCXML machine engine. Options: Rust (performance, single binary) or Node.js (shared language with the frontend engine).

## Decision
Use Node.js for the backend runtime.

## Rationale
- Same evaluator: the s-expression engine (`mn/engine.js`) runs in Node without modification. `require('./mn/engine.js')` gives you the same tokenizer, parser, evaluator, stdlib, and dependency tracker that runs in the browser.
- No cross-language port: a Rust backend means rewriting ~700 lines of proven, tested evaluator code in a different language, then keeping two implementations in sync forever. Every new stdlib function, every evaluator fix, every dep tracking improvement would be done twice.
- Performance is sufficient: the s-expression evaluator processes a transition in microseconds. The bottleneck is I/O (Postgres, HTTP), not expression evaluation. Node handles I/O well.
- Consistent with philosophy: the framework's promise is "no build step, just run." `npx machine-native serve` is consistent. A Rust binary requires compilation.
- One mental model: same language, same debugger, same test framework, same contributors. The frontend-to-backend bridge is `require`, not an FFI boundary.

## Consequences
- No single static binary. Deployment requires Node.js.
- No Rust-level memory safety guarantees.
- If expression evaluation becomes a bottleneck (unlikely), there's no path to native speed without a port.
- One codebase, one language, one evaluator, zero sync overhead. The upside outweighs these trade-offs.
