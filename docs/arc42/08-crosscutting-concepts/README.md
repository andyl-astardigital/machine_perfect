# 8. Crosscutting Concepts

## Purity model

The framework enforces a structural read/write split:

- `eval` (read path) evaluates an s-expression and returns a value. Rejects all `!` mutation forms by walking the AST before evaluation. Used for guards, bindings, derived values.
- `exec` (write path) evaluates an s-expression for side effects and copies mutations back to the context. Used for actions, event handlers, init/exit hooks.

This is enforcement, not convention. `(set! x 5)` inside a guard or binding throws an error with the function name and guidance on where to put it.

Both runtimes use the same split. A guard that is pure in the browser is pure on the backend.

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
Definition loaded
    ↓
Instance created (context initialised)
    ↓
Initial state entered
    ↓
    ╔═══════════════════════════════╗
    ║  Event arrives                ║
    ║  → Guard evaluated (pure)    ║
    ║  → Exit hook runs            ║
    ║  → Action executed           ║
    ║  → State changed             ║
    ║  → Entry hook runs           ║
    ║  → Timers started            ║
    ║  → Host notified (DOM/HTTP)  ║
    ╚═══════════════════════════════╝
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
Node implements these with durable timers, event bus, Postgres, effect adapters.

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

## Capability-based distribution (proposed, ADR-012)

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
