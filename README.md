<p align="center">
  <img src="logo.svg" alt="machine_native" width="120" />
</p>

# machine_native

The application is the markup. The markup is the transport. The transport is the application.

A machine_native application is a state machine defined in markup. In the browser, that markup is HTML. On the server, it's SCXML. Between nodes, it's whichever format the receiving host speaks. The machine carries its states, guards, actions, context, and capability requirements in one document. It serialises, posts to a capable host, executes there, and comes back with its state updated. Same machine. Same engine. No API layer between them.

```html
<script src="mn/engine.js"></script>
<script src="mn/browser.js"></script>

<div mn="purchase-order">
  <mn-ctx>{"title":"","amount":0,"items":[],"submitted_at":null}</mn-ctx>

  <!-- The form. Browser renders this. -->
  <div mn-state="draft">
    <mn-transition event="submit" to="submitted">
      <mn-guard>(and (> (count items) 0) (> amount 0))</mn-guard>
      <mn-action>(set! submitted_at (now))</mn-action>
    </mn-transition>
    <input mn-model="title" placeholder="Title" />
    <input mn-model="amount" type="number" placeholder="Amount" />
    <button mn-to="submit">Send to Pipeline</button>
  </div>

  <!-- The pipeline. Browser can't do this — routes to a capable server. -->
  <div mn-state="submitted">
    <mn-where>(requires 'persist' 'notify')</mn-where>
    <mn-transition event="approve" to="approved">
      <mn-guard>(<= amount 100000)</mn-guard>
      <mn-action>(invoke! :type 'notify' :input (obj :to 'finance@co' :subject title))</mn-action>
    </mn-transition>
    <mn-transition event="reject" to="rejected">
      <mn-guard>(> amount 100000)</mn-guard>
    </mn-transition>
  </div>

  <div mn-state="approved" mn-final></div>
  <div mn-state="rejected" mn-final></div>
</div>
```

The browser renders `draft`, a form with two-way binding and a guarded submit button. When the user submits, the machine transitions to `submitted`. That state declares `(requires 'persist' 'notify')`, capabilities the browser doesn't have. The runtime serialises the machine, sends it to a server that does, and the server runs the pipeline: approve or reject based on the amount, dispatch effects, return the result. The browser renders it.

No REST endpoint was defined. No shared types were written. The machine carried its own rules to the server. The guard `(<= amount 100000)` evaluated identically in both places. One expression language. One engine. Two hosts.

---

## Why

Traditional architectures split behaviour across nodes and then build infrastructure to keep them in sync. The browser node has a state management library. The server node has API endpoints. Shared types keep them from drifting. Integration tests verify they agree. Each node implements its own view of the same business rules.

machine_native puts the rules in the machine, not in the nodes. The machine carries its states, its transition rules, its data, and its capability requirements. Nodes provide capabilities (DOM rendering, persistence, email, solving). The machine travels to whichever node has the capabilities it needs. The expression language is closed: ~120 built-in functions, no `eval()`, no ambient scope, guards structurally forbidden from side effects. A guard that passes on one node will pass on any other. Arbitrary code cannot make that guarantee.

Zero dependencies, zero build step. Two script tags in a browser node. `require('machine-native')` in a server node. Drop an `[mn]` element into any page and a MutationObserver auto-initialises it.

Start with the [interactive tutorial](examples/learn.html). 24 lessons, zero setup.

---

## How it works

### One engine, two hosts

The same s-expression engine runs on every node. The browser is a node with DOM capabilities (`dom`, `user-input`, `css-transition`, `localstorage`). A server is a node with service capabilities (`persist`, `notify`, `fulfil`). Each node has a native markup format: HTML for the browser, SCXML for the server. The `transforms` module converts between them at the edge. Same states. Same guards. Same context. Different serialisation for each node.

### Capability registry and routing

Any process that has the engine and some effect adapters is a node. Nodes register with a capability registry, itself a machine running on the engine:

```
POST /register
{
  "address": "http://10.0.1.5:4000",
  "capabilities": ["persist", "log", "notify", "fulfil"],
  "formats": ["html", "scxml"]
}
```

The registry maintains a route table. When a machine enters a state that declares capability requirements, the runtime looks up which nodes can satisfy them:

```html
<div mn-state="submitted">
  <mn-where>(requires 'persist' 'notify')</mn-where>
  ...
</div>
```

The browser node doesn't have `persist` or `notify`. It checks the route table, finds a node that does, serialises the machine, and sends it. The receiving node compiles, executes the pipeline, dispatches effects through its adapters, and returns the result.

The registry, the routing, the capability discovery, and the `mn-where` mechanism all work today.

### Effects and the async pipeline

Machines declare effects but don't implement them. `(invoke! :type 'persist' :input data)` says "I need persistence." The host provides the adapter:

```javascript
var result = await machine.executePipelineAsync(def, {
  effects: {
    persist: async function(input) { return await db.insert(input); },
    notify: async function(input) { return await sendEmail(input); },
    solver: async function(input) { return await runCPSAT(input); }
  }
});
```

Each adapter is awaited. The `bind` field on `invoke!` injects the return value back into context. `(invoke! :type 'solver' :bind 'schedule' :input data)` means the solver's result lands in `context.schedule` and the next guard can read it. `on-success` and `on-error` route events back into the machine when adapters resolve or reject. The entire server-side execution model for the [purchase order app](examples/purchase-order/) is 94 lines.

### The expression language

One syntax for all logic: `(function arg1 arg2)`.

```clojure
(when cond value)              ;; conditional
(do a b c)                     ;; sequence
(set! key value)               ;; mutation
(->> x (f) (g) (h))            ;; pipeline
(fn [x] body)  or  #(> % 0)   ;; lambda
```

~120 built-in functions. The language is closed: no `eval()`, no `new Function()`, no ambient scope. Guards are structurally forbidden from causing side effects. The evaluator rejects `!` mutation forms before running them on the pure read path. Conventions: `!` = mutation, `$` = framework value, `:keyword` = string key. Full reference in [REFERENCE.md](REFERENCE.md).

### How the pieces compose

```
┌─────────────┐         ┌──────────────┐         ┌──────────────┐
│ Browser Node │         │   Registry   │         │ Server Node  │
│              │         │              │         │              │
│  engine.js   │         │  (a machine  │         │  engine.js   │
│  browser.js  │────────▶│   running on │────────▶│  machine.js  │
│              │  route  │   the engine)│  lookup  │  scxml.js    │
│  capabilities:│  table  │              │         │  transforms  │
│   dom        │◀────────│  GET /routes │         │              │
│   user-input │         │              │         │  capabilities:│
│   css-trans  │         └──────────────┘         │   persist    │
│   localstorage│                                 │   notify     │
│              │──── POST machine ────────────────▶│   fulfil     │
│              │                                  │   log        │
│              │◀─── result ──────────────────────│              │
└──────────────┘                                  └──────────────┘
```

Every node discovers capabilities via the registry. States declare what they need via `mn-where`. The runtime routes automatically. The receiving node compiles the machine into its native format, runs the pipeline, converts back, and returns the result. No hand-written API. No service contracts. The machine definition is the contract.

---

## What this becomes

Today that's one hop: browser to server and back. The architecture is designed for chains. A machine enters a procurement node that adds approval states based on its business rules, moves to a fulfilment node that adds shipping states, and reaches a persistence node that executes the assembled machine and stores the result. Each node contributes markup. The final document is the complete, auditable record of every decision every host made.

The document flows through infrastructure the way a packet flows through a network, routed by what it needs, not by where it was built. See [ROADMAP.md](ROADMAP.md) for the concrete plan.

---

## AI and machine generation

LLMs produce better output when the output format is constrained. A machine_native definition is maximally constrained:

- The function set is fixed and enumerated. An LLM cannot invent functions that don't exist.
- Guards are structurally verified as pure before execution. A generated guard cannot cause side effects.
- Every transition target can be checked against the declared state list. A generated transition to a nonexistent state is caught by `validate()` before the machine runs.
- `validate()` walks every guard and action AST and flags references to context keys that don't exist in the definition. A typo in a generated expression is caught statically, not at runtime.

An LLM generating JavaScript can produce code that type-checks, passes a linter, and still does the wrong thing at runtime. An LLM generating a machine_native definition produces a document that can be structurally verified to be internally consistent before it executes anywhere.

In the capability node model, an LLM is just another node. It receives a partial machine, contributes states based on its domain knowledge (approval rules, pricing logic, compliance checks), and passes the machine on. The contributed markup is inspectable, diffable, and subject to the same structural validation as human-authored markup. No special integration. No SDK. The machine format is the interface.

---

## Examples

- [Interactive Tutorial](examples/learn.html): 24 lessons, learn by building
- [Sticky Notes](examples/sticky-notes.html): CRUD app, zero JavaScript
- [Snow Check SPA](examples/spa/): multi-page app with components, command palette, live weather
- [Purchase Order](examples/purchase-order/): full-stack browser form to server pipeline with async effects
- [Batch Reactor](examples/batch-reactor/): ISA-88 industrial process control with compound states

---

## Install

```html
<script src="https://unpkg.com/machine-native/mn/engine.js"></script>
<script src="https://unpkg.com/machine-native/mn/browser.js"></script>
```

```
npm install machine-native
```

Zero dependencies. Eight files. One folder. No build step.

---

## License

MIT
