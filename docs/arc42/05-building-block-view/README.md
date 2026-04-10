# 5. Building Block View

## Level 1: System overview

```
┌─────────────────────────────────────────────────────┐
│                  machine_perfect                     │
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
| Scope management | Prototype-chain context layering | `makeScope`, `applyScope` |
| Dependency tracking | Record reads, record writes, compute overlap | `depKey`, `startTracking`, `stopTracking` |
| Path utilities | Dotted path get/set with safety | `get`, `set` |
| User functions | JS escape hatch registry | `fn`, `userFns` |

## Level 2: Browser host

| Component | Responsibility |
|-----------|---------------|
| HTML compiler | Read `mp-*` attributes → canonical machine definition |
| DOM bindings | `<mp-text>`, `mp-model`, `<mp-show>`, `<mp-class>`, `<mp-bind>` |
| Event delegation | `mp-to` click handler, `<mp-on>`, `mp-model` input/change |
| Template system | `mp-define`, `mp-slot`, `mp-import` |
| Temporal behaviour | `mp-temporal` — (animate), (after), (every) |
| List rendering | `mp-each` with keyed reconciliation |
| Capability routing | `mp-where` on states and transitions — `to()` checks target state, routes to capable host |
| Persistence | `mp-persist` via localStorage |
| Context sync | Phase 5: `mp-ctx` attribute synced on every update, markup reflects live state |
| Lifecycle | `mp-init`, `mp-exit`, `mp-ref` |
| Inter-machine events | `(emit name)` inside `mp-to`, `mp-receive` |
| Auto-init | MutationObserver for dynamic DOM |

## Level 2: Node host

| Component | Responsibility |
|-----------|---------------|
| SCXML compiler | Parse SCXML + MP extensions → canonical machine definition |
| Machine core | `createInstance`, `sendEvent`, `inspect`, `snapshot`, `restore`, `validate`, `executePipeline` |
| Effect adapters | Capability declarations — persist, notify, fulfil, log, etc. |
| Durable timers | Persist `after`/`every` across restarts |
| Transforms | HTML ↔ SCXML structural conversion, `extractContext`, `extractMachine` |
| Server | HTTP server, serves machine markup, receives machine markup |

## Level 2: Capability-based hosting (proposed — ADR-012)

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
effect adapters registered. A state with `<mp-where>(requires 'persist')</mp-where>`
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
      init: null,     // mp-init / onentry expression
      exit: null      // mp-exit / onexit expression
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
