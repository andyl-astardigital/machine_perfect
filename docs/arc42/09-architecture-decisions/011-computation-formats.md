# ADR-011: Machine documents as portable computation formats

## Status
Accepted

## Context
Today, services exchange DATA (JSON, XML). The receiver needs prior knowledge (API docs, SDKs, shared code) to know what to do with the data. The contract (API spec) is separate from the implementation (code). They drift apart. Integration bugs live in the gap.

AI-assisted development amplifies this problem: AI can generate code, but cannot reliably verify arbitrary code. The more unconstrained the output, the more likely it contains subtle errors.

## Decision
Machine definitions are treated as portable computation formats. These are documents that carry their own behaviour, rules, and legal operations. A machine document is simultaneously:

- The specification (what states and transitions exist)
- The implementation (guards and actions as s-expressions)
- The API contract (enabled transitions from current state)
- The validation schema (guard conditions define what's legal)
- The audit trail (state history)

## Rationale
- Self-describing: a service receiving a machine document knows what it can do without external documentation.
- AI-verifiable: finite states, declared transitions, pure guards, and explicit actions can be validated by structural inspection, not just testing.
- Composable: two machine definitions can be merged, transformed, or composed. XSLT can rewrite them. XSD can validate them.
- Portable: the same engine evaluates the same s-expressions in any host. The document runs wherever the engine runs.
- Auditable: every transition is logged. The history is the audit trail. No separate logging infrastructure needed.

## Implications for development velocity
A single developer working with AI assistance can:
1. Describe intent ("I need a purchase order approval workflow")
2. AI generates a machine definition (constrained, verifiable format)
3. AI validates the definition structurally (reachable states, valid guards, no deadlocks)
4. The definition runs on any node (browser, server, or future hosts) without modification
5. The same tooling (graph, lint, simulate, REPL) works for all applications

This eliminates the translation overhead between thinking and building. The mental model (state machines) maps directly to the implementation (machine definitions), which maps directly to the runtime (shared engine).

## Consequences
- Machine definitions become the primary artefact, not source code.
- The expression language must stay closed and constrained. Expanding it to full JavaScript would destroy verifiability.
- Host adapters (effects) are the boundary between the verifiable machine world and the unverifiable external world.
- The vision requires cultural shift: developers must think in machines, not in functions and classes.
