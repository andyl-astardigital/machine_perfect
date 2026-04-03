# machine_perfect — The Bigger Idea

## What we built

A frontend framework where state machines are the component model, s-expressions are the expression language, and everything lives in HTML. Zero JavaScript required. Zero build step. Tier-1 performance via runtime dependency tracking through evaluator instrumentation. ~2000 lines, zero dependencies.

This is the proof of concept for something larger.

## What comes next

### The machine is the document

machine_perfect proved that state machines + s-expressions + markup is a complete application model for the browser. The same model applies to backend systems, but with a shift in what "markup" means.

Instead of HTML elements with `mp-state` and `mp-to`, the document is SCXML — the W3C standard for state chart XML. Instead of rendering DOM, the runtime executes transitions, evaluates guards, fires actions, and emits events. The s-expression engine is language-agnostic and ports directly.

The radical idea: **services don't exchange messages. They exchange machines.**

A machine document carries:
- Its current state (where it is)
- Its legal transitions (where it can go)
- Its guard conditions (under what rules)
- Its actions (what happens when it moves)
- Its data (what it knows)
- Its history (where it's been)

A downstream service receives a machine, advances it through its own domain logic, and passes it on. The machine accumulates state and constraints as it flows. No SDK. No API contract separate from the implementation. The document IS the contract AND the implementation.

### The stack

**SCXML** — W3C-standard state machine semantics. Parallel states, history states, event-based communication, formal execution semantics. A solved specification that nobody uses because the tooling never materialized.

**S-expressions** — The expression language from machine_perfect, replacing SCXML's ECMAScript dependency. Trivially parseable in any language. A Rust service, a Go service, a Python service can all evaluate `(> amount 10000)` without embedding V8. The dependency tracking carries over — when a field changes, the runtime knows which guards to re-evaluate.

**XSD** — Schema validation for machine documents. Not just "is this valid XML" but "is this a legal machine." Are all transition targets valid states? Does the data schema match what the guards reference? Are required fields present before this transition can fire?

**XSLT** — Machine transformation. Add audit logging to every transition. Strip internal states before sending to a partner. Merge two machines into a composed machine. Translate field names between domains. Machines are data — they transform like data.

### What this replaces

**WS-BPEL** got the idea right and the execution wrong — bloated, committee-designed, required massive infrastructure. This is the same idea done small and sharp.

**AWS Step Functions** are JSON blobs that reference Lambda ARNs. The behavior isn't in the document — it's scattered across your AWS account. The machine is a pointer, not the thing itself.

**Temporal workflows** are code, not data. You can't transform them, validate them structurally, or send them to a service that doesn't have your SDK.

**REST/gRPC APIs** separate the contract from the implementation. You write an OpenAPI spec AND the code that implements it AND hope they stay in sync. With machine documents, the contract IS the implementation.

### Example: Purchase order

```xml
<scxml xmlns="http://www.w3.org/2005/07/scxml"
       xmlns:mp="http://machine-perfect.dev/scxml"
       initial="draft">

  <datamodel>
    <data id="amount" expr="0"/>
    <data id="approver" expr="nil"/>
    <data id="items" expr="[]"/>
  </datamodel>

  <state id="draft">
    <transition event="submit" target="submitted"
                mp:guard="(and (> amount 0) (> (count items) 0))"/>
  </state>

  <state id="submitted">
    <transition event="approve" target="approved"
                mp:guard="(some? approver)"
                mp:action="(set! approved-at (now))"/>
    <transition event="reject" target="rejected"
                mp:action="(set! rejected-at (now))"/>
    <!-- Auto-approve under threshold -->
    <transition target="approved"
                mp:guard="(< amount 10000)"
                mp:action="(do (set! approver 'system') (set! approved-at (now)))"/>
  </state>

  <state id="approved">
    <transition event="fulfill" target="fulfilled"/>
    <transition event="cancel" target="cancelled"
                mp:guard="(nil? fulfilled-at)"/>
  </state>

  <final id="fulfilled"/>
  <final id="rejected"/>
  <final id="cancelled"/>
</scxml>
```

This document is simultaneously:
- The business rules (what can happen and when)
- The validation schema (amount must be > 0, items must be non-empty)
- The audit trail (timestamps on every transition)
- The remaining work (what transitions are still available from the current state)
- The API contract (submit, approve, reject, fulfill, cancel — those are the operations)

Send it to procurement. They advance it to `approved`. Send it to fulfillment. They advance it to `fulfilled`. Nobody needed your SDK. Nobody read your API docs. The machine told them everything.

### The Node runtime

1. Parse SCXML + MP extensions
2. Evaluate s-expressions (the engine from machine_perfect, unchanged)
3. Execute transitions with guards and actions
4. Track dependencies (same algorithm — know which guards depend on which data)
5. Emit events for inter-machine composition
6. Validate against XSD schemas
7. Transform via XSLT pipelines
8. Serialize/deserialize machine state for persistence or transmission
9. HTTP/gRPC interface for receiving and advancing machines

### Why this works

The s-expression engine is the key. It's:
- **Language-agnostic** — no JS runtime needed. Implement the evaluator in any language.
- **Safe** — no eval, no arbitrary code execution. The expression language is closed and sandboxed.
- **Inspectable** — you can read every guard and action. No opaque function references.
- **Transformable** — s-expressions are data. XSLT can rewrite them.
- **Trackable** — dependency tracking tells you exactly what changed and what needs re-evaluation.

The frontend framework proved all of this works in the browser. The backend framework applies the same ideas to distributed systems.

### The name

machine_perfect. Same name. Same philosophy. Same engine. Different runtime.

Frontend: machines that render DOM.
Backend: machines that flow between services.

Both: state machines + s-expressions + markup. Declared, not coded.
