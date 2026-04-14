# 5. Building Block View

## Level 1: System overview

```
┌─────────────────────────────────────────────────────┐
│                  machine_native                     │
│                                                      │
│  ┌────────────────┐          ┌────────────────┐      │
│  │  Browser Host   │          │   Node Host     │     │
│  │                 │          │                 │     │
│  │  HTML compiler  │          │  SCXML compiler │     │
│  │  DOM bindings   │          │  HTTP API       │     │
│  │  Event deleg.   │          │  Persistence    │     │
│  │  CSS transitions│          │  Effect adapters│     │
│  │  MutationObs.   │          │  Durable timers │     │
│  └───────┬─────────┘          └───────┬─────────┘     │
│          │                            │               │
│          └────────────┬───────────────┘               │
│                       │                               │
│              ┌────────┴────────┐                      │
│              │  Shared Engine   │                     │
│              │                  │                     │
│              │  Tokenizer       │                     │
│              │  Parser          │                     │
│              │  Evaluator       │                     │
│              │  Stdlib (~120 fns)│                     │
│              │  Dep tracking    │                     │
│              │  Scope mgmt     │                     │
│              │  Path utilities  │                     │
│              │  Purity enforce  │                     │
│              └──────────────────┘                     │
└─────────────────────────────────────────────────────┘
```

## Level 2: Shared engine

| Component | Responsibility | Key functions |
|-----------|---------------|---------------|
| Tokenizer | String → token array | `tokenize` |
| Parser | Tokens → AST (cached) | `parse`, `parseOne` |
| Evaluator | AST + context → value | `seval`, `sevalInner` |
| Pure evaluator | AST + context → value (rejects mutations) | `sevalPure` |
| Stdlib | ~120 built-in functions as dispatch table | `stdlib` object |
| First-class | Built-in functions as values for HOFs | `firstClass` object |
| Expression interface | String expression → value (read) or side effect (write) | `eval`, `exec` |
| Scope management | Prototype-chain context layering, immutable merge | `makeScope`, `newContext` |
| Dependency tracking | Record reads, record writes, compute overlap | `depKey`, `startTracking`, `stopTracking` |
| Path utilities | Dotted path get/set with safety | `get`, `set` |
| User functions | JS escape hatch registry | `fn`, `userFns` |

## Level 2: Browser host

| Component | Responsibility |
|-----------|---------------|
| HTML compiler | Read `mn-*` attributes → canonical machine definition |
| DOM bindings | `<mn-text>`, `mn-model`, `<mn-show>`, `<mn-class>`, `<mn-bind>` |
| Event delegation | `mn-to` click handler, `<mn-on>`, `mn-model` input/change |
| Template system | `mn-define`, `mn-slot`, `mn-import` |
| Temporal behaviour | `mn-temporal`: (animate), (after), (every) |
| List rendering | `mn-each` with keyed reconciliation |
| Capability routing | `mn-where` on states and transitions. `to()` checks target state, routes to capable host |
| Fire-and-forget transport | `_sendMachineToNode` dispatches by transport type, returns immediately |
| SSE receiver | `_openSSE` opens EventSource, receives machine results, updates instances |
| Invoke stamping | `_stampAndEnter` creates child machine DOM elements from `<invoke>` content |
| Persistence | `mn-persist` via localStorage |
| Context sync | Phase 5: `mn-ctx` attribute synced on every update, markup reflects live state |
| Lifecycle | `mn-init`, `mn-exit`, `mn-ref` |
| Inter-machine events | `(emit name)` inside `mn-to`, `mn-receive` |
| Auto-init | MutationObserver for dynamic DOM |

## Level 2: Node host

| Component | Responsibility |
|-----------|---------------|
| SCXML compiler | Parse SCXML + MP extensions → canonical machine definition |
| Machine core | `createInstance`, `sendEvent`, `inspect`, `snapshot`, `restore`, `validate`, `executePipeline`, `executePipelineAsync` |
| Invoke resolver | Resolves `<invoke src>` via effect adapters, embeds stored SCXML as inline invoke content |
| Effect adapters | Pluggable capability declarations: any host registers the adapters it provides |
| Durable timers | Persist `after`/`every` across restarts |
| Transforms | SCXML metadata extraction (`extractMachine`, `extractMetadata`, `stampMetadata`) |
| Server | HTTP server, serves machine markup, receives machine markup |

## Level 2: Capability-based hosting

```
┌──────────────────────────────────────────────────────────────┐
│                    Route Table                                │
│  (requires 'log')       → host-pool-A                        │
│  (requires 'notify')    → host-pool-B                        │
│  (requires 'persist')   → host-pool-C                        │
│  (requires 'fulfil')    → host-pool-C                        │
└──────────────────┬───────────────────────────────────────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
┌───┴───┐    ┌────┴────┐    ┌───┴───┐
│Pool A │    │ Pool B  │    │Pool C │
│       │    │         │    │       │
│Engine │    │ Engine  │    │Engine │
│+ log  │    │+ notify │    │+persist│
│       │    │         │    │+fulfil │
└───────┘    └─────────┘    └───────┘
```

Services dissolve into capability pools: engine instances with specific
effect adapters registered. A state with `<mn-where>(requires 'persist')</mn-where>`
routes to any host in a pool that has a `persist` adapter.

The machine definition carries its own routing requirements. The route table
maps capability requirements to host addresses. This is the only infrastructure
concern.

## Canonical machine definition format

Both compilers produce this shape:

```js
{
  id: "purchase-order",
  initial: "draft",
  context: { amount: 0, items: [] },
  states: {
    draft: {
      on: {
        submit: [{
          target: "submitted",
          guard: "(> (count items) 0)",     // s-expression string
          action: "(set! submitted_at (now))" // s-expression string
        }]
      },
      init: null,     // mn-init / onentry expression
      exit: null      // mn-exit / onexit expression
    },
    submitted: {
      on: {
        approve: [{ target: "approved" }],
        reject: [{ target: "rejected" }]
      }
    },
    approved: { final: true },
    rejected: { final: true }
  }
}
```

S-expressions are preserved as strings. They are parsed and evaluated at runtime by the shared engine.
