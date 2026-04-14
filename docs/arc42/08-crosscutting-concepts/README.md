# 8. Crosscutting Concepts

## Purity model

The framework enforces a structural read/write split:

- `eval` (read path) evaluates an s-expression and returns a value. Rejects all `!` mutation forms by walking the AST before evaluation. Used for guards, bindings, derived values.
- `exec` (write path) evaluates an s-expression and returns a new context with mutations applied. The original context is never modified. Used for actions, event handlers, init/exit hooks.

This is enforcement, not convention. `(set! x 5)` inside a guard or binding throws an error with the function name and guidance on where to put it.

Both runtimes use the same split. A guard that is pure in the browser is pure on the backend.

## Immutable context

Context is never mutated in place. `engine.exec()` returns `{ context: newCtx }` — a new object built from scope mutations via `newContext()`. The original context is untouched.

This applies at every layer:

- **Engine**: `set!`, `push!`, `inc!`, `dec!`, `toggle!`, `swap!`, `remove-where!`, `splice!`, `assoc!` all create new values in the scope. `newContext(scope, ctx)` merges scope own-properties into a shallow copy of the original context.
- **Canonical machine**: `sendEvent` threads `result.context` through exit → action → init → auto-transition. Each step receives the previous step's new context.
- **Browser**: Every `_exec` call threads `result.context` back to `inst.ctx`. The canonical instance's `context` property is a getter/setter linked to `inst.ctx` — replace once, both see it.
- **$store**: When one machine writes to `$store`, the framework replaces the entire `_store` object and broadcasts the new value to all machines. No shared mutable reference.
- **Adapters**: Return data. The framework merges it into context. Adapters never receive a mutable context reference.

Structural sharing via `setImmutable(root, path, val)` handles nested path mutations including array indices (`items.0.qty`). Only the path from root to the changed leaf is copied.

## Implicit error state

Every machine gets an implicit `error` state (final) injected by `createDefinition` if none is defined. When any guard, action, or effect throws during `sendEvent`, the catch block:

1. Sets `$error` (the error message) and `$errorSource` (the event that caused it) in context
2. Transitions the machine to the `error` state

This means no machine silently swallows exceptions. If the author wants recovery, they define their own `error` state with outbound transitions. The implicit one is a dead end — the machine stops, the error is visible.

`validate()` skips the implicit error state in unreachability checks so it doesn't flag as dead code.

## Invoke and machine-as-persistence

Machines are stored as complete SCXML snapshots. The SCXML carries state, context, transitions, guards, and effects — everything needed to resume execution. There is no separate "data model" extracted from the machine. The persistence adapter is pluggable — the framework stores and retrieves SCXML strings via whatever storage engine the host provides.

`<invoke type="scxml" src="machine-name"/>` on a state loads stored machines as live children. The pipeline's invoke resolver:

1. Calls a data adapter to retrieve stored machines by name
2. Embeds each machine's SCXML as `<invoke><content>SCXML</content></invoke>` in the format string
3. Computes `_invokeCounts`: `{ total, byState: { ... } }` and merges into context

The browser's `_stampAndEnter` creates child machine DOM elements from invoke content: `<div mn="name" mn-initial="state" mn-ctx="...">`. Each child renders itself using its paired `.mn.html` template.

`mn-state` attribute on invoke filters by machine state: `<invoke type="scxml" src="name" mn-state="state"/>` loads only machines currently in that state.

## Context projection (mn:project)

The machine defines what data travels to different audiences. `mn:project` is an s-expression on the machine's SCXML root, evaluated during invoke resolution on the server. The projected context replaces `mn-ctx` before the SCXML reaches the browser. Fields not in the projection never leave the server.

```xml
<mn:project when="(!= (get $user :role) 'director')">
  (obj :title title :amount amount :item_count (count items))
</mn:project>
```

The `when` condition evaluates against the **parent machine's context** (who's asking). The body evaluates against the **child machine's context** (the stored machine's data). First matching `when` wins. No match = full context travels.

`mn:project as="machine-name"` derives a completely different machine. The canonical machine declares transforms to other machine types — different SCXML name, different states, different template. Both are complete, independently functioning machines. The invoke resolver builds a minimal SCXML envelope with the derived name, mapped initial state (`$initial`), and projected context.

The reverse path: a derived machine with `$canonical_id` in context routes back to the server. The pipeline loads the canonical by ID, merges user edits from the derived context, runs the canonical through the pipeline, and re-projects the result back to the derived machine format.

This is the third axis of machine self-description:
- `mn:where` — where does the machine execute
- `mn:guard` — when can transitions fire
- `mn:project` — what does the machine look like to different audiences

## Dependency tracking

Every data access flows through the evaluator. During evaluation, the engine records which context keys were read. After evaluation, those keys are stored as the binding's "deps."

When a mutation occurs, the mutated key is recorded as "dirty." On the next update, only bindings whose deps overlap with dirty keys are re-evaluated.

This gives O(changed bindings) updates instead of O(all bindings). No Proxies, no compiler, no magic. We control the evaluator, so we see every read.

The backend uses the same mechanism to determine which views/projections need recalculating after a state transition.

## Error handling strategy

| Error type | Response |
|------------|----------|
| Malformed JSON in `mn-ctx` or `mn-store` | Warn, use empty object, continue |
| Unknown s-expression function | Warn, return null |
| Mutation in binding (`set!` in `mn-text`) | Throw with function name and guidance |
| Expression too deeply nested (>512) | Throw |
| Prototype pollution attempt (`__proto__`) | Silently reject |
| Unknown state in transition | Warn, return false |
| Missing template | Warn with available template names |
| Async rejection without error state | Warn |
| Async rejection with error state | Transition to error state, store error |

Principle: user errors are loud (throw or warn). Framework robustness issues fail soft.

## Security model

- No `eval()` or `new Function()`. The s-expression engine is a closed, sandboxed evaluator.
- Prototype pollution defense: `set!`, `inc!`, `dec!`, `toggle!`, `swap!`, and `assoc!` all reject `__proto__`, `constructor`, `prototype` keys.
- Recursion depth limit: max 512 nested calls, prevents stack overflow.
- Parse cache bounded: evicts at 2000 entries, prevents memory exhaustion.
- User functions are explicit: `MachineNative.fn()` must be called to register. No implicit code execution.

## Machine lifecycle

Both runtimes follow the same lifecycle:

```
Definition loaded (implicit error state injected if absent)
    ↓
Instance created (context initialised, immutable)
    ↓
Initial state entered
    ↓
    ╔═══════════════════════════════════════════╗
    ║  Event arrives                            ║
    ║  → Guard evaluated (pure, new context)    ║
    ║  → Exit hook runs (new context)           ║
    ║  → Action executed (new context)          ║
    ║  → State changed                          ║
    ║  → mn:where check (route if host lacks    ║
    ║    capabilities, suppresses emits)         ║
    ║  → Entry hook runs (new context)          ║
    ║  → Timers started                         ║
    ║  → Host notified (DOM/HTTP)               ║
    ║                                           ║
    ║  On throw → error state ($error,          ║
    ║             $errorSource in context)       ║
    ╚═══════════════════════════════════════════╝
    ↓ (repeats)
Final state reached → instance complete
```

## Host adapter interface

The shared engine communicates with hosts through an adapter:

```js
{
  now()                          // current timestamp
  scheduleAfter(ms, callback)   // one-shot timer
  scheduleEvery(ms, callback)   // repeating timer
  cancelTimer(id)               // cancel a timer
  emit(eventName, detail)       // inter-machine event
  persist(snapshot)              // save state
  log(level, ...args)           // diagnostics
  capabilities: []               // list of capabilities this host provides
}
```

Browser implements these with `setTimeout`, `CustomEvent`, `localStorage`.
Node implements these with durable timers, event bus, pluggable persistence adapters, effect adapters.

## AI verifiability

Machine definitions are structurally verifiable without execution:

| Check | How |
|-------|-----|
| All transition targets are valid states | Enumerate states, check each target exists |
| No unreachable states | Graph traversal from initial state |
| No deadlocks | Every non-final state has at least one enabled transition |
| Guards reference existing context keys | Parse guard s-expressions, extract symbol names, check against datamodel |
| Actions only mutate declared context keys | Parse action s-expressions, extract `set!`/`inc!` targets |
| No mutations in guards | Already enforced by `sevalPure`, but also checkable statically |
| Effect types match registered adapters | Compare `invoke!` types against host capability list |

An AI can generate a machine definition and validate it structurally before any human sees it. Arbitrary JavaScript does not allow this.

## Computation formats vs data formats

Traditional systems exchange data: JSON payloads describing current state. The receiver needs prior knowledge of what to do with the data, provided through API documentation, SDKs, or shared code.

machine_native exchanges computation: machine documents that describe behaviour. The receiver reads the document and knows:
- what states exist
- what transitions are legal from the current state
- what conditions must be met
- what will happen when a transition fires

REST says "here is a resource, here are the verbs." machine_native says "here is a computation unit, here are its legal operations." The machine document is self-describing, self-validating, and executable by any host with the shared engine.

## Capability-based distribution

Traditional distribution routes by service name. Capability-based distribution routes by which host can fulfil the required effects.

A transition declares what it needs:
```html
mn-where="(requires 'persist' 'notify')"
```

The host runtime resolves this against a route table:
```
persist + notify → http://pool-c:4003
```

Services dissolve into capability pools: engine instances with specific effect adapters. The machine carries its own routing. The route table is the only infrastructure configuration.

Consequences:
- One machine document shows every state, transition, effect, and where it executes.
- Deployment is capability declaration: "I can persist and fulfil", not "I am the order service."
- Scaling is pool-level. More persistence throughput means adding instances to the persist pool. No API changes.
- Testing is structural. Mock the adapters, run the full pipeline in one process. The machine does not know the difference.
- The distributed system is declarative and inspectable. AI can reason about topology because it is not hidden in infrastructure config.

## Fire-and-forget transport

When mn:where routes a machine to a remote node, the browser sends the SCXML via HTTP POST and receives a 202 immediately. The browser does not wait for the pipeline result. This prevents blocking the UI during long-running server pipelines.

Results are pushed back via Server-Sent Events (SSE). The browser opens an EventSource to its server on init, identified by a session ID (`X-MN-Session` header on POST, `/sse/:sessionId` endpoint). When the server finishes pipeline execution, it pushes the result SCXML as a base64-encoded SSE event. The browser decodes, recompiles (to pick up embedded invokes), and updates the machine instance.

This pattern applies uniformly — UI data fetches, approval workflows, and pipeline execution all use the same fire-and-forget POST + SSE push mechanism. There is no separate request/response path for "simple" data loads vs "complex" pipelines.
