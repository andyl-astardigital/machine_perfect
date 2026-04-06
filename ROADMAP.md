# Roadmap

## v1.0 (current)

Shipped. 1145 tests. The framework works end-to-end: browser machines, server pipelines, capability routing, URL routing, emit payloads, computed bindings, auto loading states, 24-lesson interactive guide, purchase order reference app.

## v1.1: Production server

**Async executePipeline.** The current pipeline calls effect adapters synchronously. Production adapters (Postgres, SendGrid, S3) return promises. `executePipelineAsync` awaits each effect result sequentially and injects the return value back into context.

**Context validation.** The browser sends `mp-ctx` to the server. The server trusts it. A `validate` option on `executePipeline` lets the host declare which context fields are trusted and which must be re-derived from server-side data before the pipeline runs.

**Server-derived SPA routes.** The server currently hardcodes SPA fallback routes. With `mp-url` on state elements, the server can parse the machine definition at startup and derive its route table from the markup. The machine is the single source of truth for both browser and server routing.

## v2.0: Distributed compilation

**Capability-driven machine assembly.** The machine travels between hosts not just for execution but for construction. Each host on the route contributes states, guards, and transitions based on its domain knowledge and the machine's context. The final host in the chain executes the fully assembled machine.

The browser sends a partial machine: "I need approval, fulfilment, and persistence." The approval host inspects the context, adds approval states with guards derived from its own business rules (two approvers for amounts over 50k, different thresholds per department). The fulfilment host adds its states (backordered, split shipment). The persist host is last in line, executes the complete machine, and returns the result.

No host needs to know about the others. Each contributes its expertise as markup. The final machine is the complete, auditable record of every decision every host made.

Formally: runtime partial evaluation of an open statechart, where each capable host closes a subset of underspecified transitions using domain-local context and appends its contribution as serialised markup. The document is simultaneously its own assembly history and its executable definition.

### Why the groundwork is done

The v1.0 architecture was not designed for this, but it supports it:

- `executePipeline` already produces route signals when a state requires capabilities the current host lacks. The machine knows it needs to move.
- `_sendMachineToNode` already serialises the full machine as HTML and POSTs it to a remote host. The transport exists.
- Markup-as-definition means the accumulated state IS the wire format. You cannot do this with a JavaScript object graph. Markup survives serialisation, is human-readable, diffable, and auditable at every hop.
- The s-expression guard language is sandboxed and serialisable. A contributing host's guards travel with the machine and execute identically on the final host.

The engine itself needs no changes. The work is in the contribution protocol.

### Open problems

**Contribution protocol.** `mp-where` currently means "execute this state on a capable host." v2.0 needs it to also mean "a capable host should contribute states to this machine." These are different contracts. A new host endpoint mode (`contribute` vs `execute`) and a way to express assembly intent in the markup are needed.

**Context trust across hops.** Each intermediate host trusts the machine it receives. A malformed or malicious machine can inject states that subsequent hosts execute. Context validation (v1.1) must be mandatory and verifiable at each hop before distributed assembly is viable. Cryptographic signing of host contributions would prevent tampering after assembly.

**Partial assembly failure.** If host 3 of 5 fails mid-contribution, the machine is partially assembled. The assembled-so-far document is a valid statechart (it can be inspected and diffed), but it is incomplete. Rollback or compensation semantics are needed: either undo the partial assembly or mark the machine as incomplete with a clear failure state.

**Contribution conflicts.** Two hosts may add states that reference the same context keys with different assumptions. The assembly protocol needs conflict detection (two hosts adding a state with the same name) and clear rules for context key ownership.

**Distributed tracing.** Trace IDs attached to machine transport. Each host logs its contributions and execution steps. A trace viewer reconstructs the full journey: browser session, routing decisions, host contributions, guard evaluations, state transitions, effect dispatch, across every host the machine visited. This is not optional for v2.0. Without it, debugging an assembled machine is worse than debugging microservices.

## v2.1: Statechart extensions

**Parallel states and history states.** Completeness features for SCXML conformance. Parallel states allow two child states active simultaneously. History states resume the last active child on re-entry. The workaround today is sibling machines with emit/receive, which covers most cases. Worth doing for credibility against XState but not blocking any real application pattern.

## Not planned

**TypeScript types.** The framework is ES5 with no build step. TypeScript definitions could be provided as a separate `.d.ts` file for consumers who want them, but the framework itself will not be rewritten in TypeScript.

**Virtual DOM.** The framework operates on real DOM nodes. State content is created and destroyed, not diffed. This is intentional: the state machine model means only one state's content exists at a time, so there is nothing to diff.

**Plugin system.** The framework is extensible through effect adapters, user functions (`MachinePerfect.fn()`), and the host adapter interface. A formal plugin API would add abstraction without adding capability.
