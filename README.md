<p align="center">
  <img src="logo.svg" alt="machine_perfect" width="120" />
</p>

# machine_perfect

An application platform where state machines are the unit of definition, execution, and exchange. S-expressions for logic. Markup as the substrate. One engine runs in both browser and Node. Designed for distributed deployment across capability pools.

```html
<script src="mp/engine.js"></script>
<script src="mp/browser.js"></script>

<div mp="door">
  <mp-ctx>{"code":""}</mp-ctx>

  <div mp-state="locked">
    <mp-transition event="unlock" to="unlocked">
      <mp-guard>(= code '1234')</mp-guard>
    </mp-transition>
    <p>The door is locked.</p>
    <input mp-model="code" placeholder="Enter code" />
    <button mp-to="unlock">Unlock</button>
  </div>

  <div mp-state="unlocked">
    <mp-transition event="lock" to="locked">
      <mp-action>(set! code '')</mp-action>
    </mp-transition>
    <p>The door is unlocked.</p>
    <button mp-to="open">Open</button>
    <button mp-to="lock">Lock</button>
  </div>

  <div mp-state="open">
    <p>The door is open.</p>
    <button mp-to="unlocked">Close</button>
  </div>
</div>
```

That's a complete interactive state machine. No JavaScript. The HTML is the application.

Transitions are structural elements — `<mp-transition>` defines what can happen, `<mp-guard>` controls when, `<mp-action>` controls what changes. The button's `mp-to` fires an event by name. No s-expressions in attributes. Parentheses belong in elements.

---

## Why machine_perfect

State management is bolted on to most frameworks as an afterthought. machine_perfect starts from the position that state machines are the component model, and builds everything else from that.

A machine carries its state, its rules, and its data in one document. Every machine is always in a known, named state. You can query what transitions are available, what guards must pass, and what data it holds. The machine definition is the specification, the implementation, and the runtime state in one place.

In the browser, that document is HTML. On the server, it's SCXML. The same s-expression engine evaluates guards and actions in both hosts without translation.

**Machines are data, and the expression language is closed.** A machine definition is a string. It serializes, crosses the wire, and deserializes without losing fidelity. The s-expression stdlib is fixed and enumerated. There is no `eval()`, no dynamic import, no ambient scope. Guards are structurally forbidden from causing side effects: the evaluator rejects `!` mutation forms before running them. An AI generating a machine definition operates inside hard constraints: every function call resolves against a known list, every guard is statically verifiable as pure before execution, every transition target is checkable against the declared state list. This is not possible with arbitrary code.

**Zero dependencies, zero build step.** Include two script tags and write HTML. No npm install required. No bundler. No transpiler.

New to machine_perfect? Start with the **[interactive tutorial](examples/learn.html)**.

---

## Distributed execution

The same engine that runs machines in the browser runs them on the server. Any process with the engine and some effect adapters is a node. Nodes register their capabilities with a registry:

```
POST /register
{ "address": "http://10.0.1.5:4000", "capabilities": ["persist", "log", "notify"], "formats": ["html", "scxml"] }
```

The registry (itself a machine running on the engine) maintains a route table. States declare what they need. The runtime routes automatically.

```html
<div mp-state="orders">
  <mp-where>(requires 'ui-render')</mp-where>
  <span class="loading-spinner"></span>
</div>
```

The browser renders a spinner, sends the machine to a capable node, gets content back, and stamps it in. One mechanism for every transition source: click, receive, timer, initial state entry.

On the server, machines are SCXML:

```xml
<scxml id="purchase-order" initial="draft">
  <datamodel>
    <data id="amount" expr="0"/>
    <data id="items" expr="[]"/>
  </datamodel>
  <state id="draft">
    <transition event="submit" target="submitted">
      <mp-guard>(and (> amount 0) (> (count items) 0))</mp-guard>
    </transition>
  </state>
  <state id="submitted">
    <transition event="approve" target="approved">
      <mp-guard>(<= amount 100000)</mp-guard>
      <mp-action>(set! approved_at (now))</mp-action>
    </transition>
    <transition event="reject" target="rejected"/>
  </state>
  <final id="approved"/>
  <final id="rejected"/>
</scxml>
```

Send this to procurement. They advance it to `approved`. Send it to fulfillment. They don't need an SDK or API docs. The machine definition is the contract.

### What it replaces

REST and gRPC separate the contract from the implementation. AWS Step Functions are JSON blobs pointing at Lambda ARNs, with behaviour scattered across your AWS account. Temporal workflows are code, not data, so you cannot inspect, transform, or validate them structurally. XState is a state machine library for JavaScript, but machines are JSON config objects that require a JS runtime to inspect and cannot cross the client/server boundary as portable documents. WS-BPEL had the right idea twenty years ago but was bloated and committee-designed into irrelevance.

---

## Two ideas

**1. UI is a state machine.** Every `mp` element has named states. Only one is active. Only declared transitions exist. The markup structure is the state chart.

**2. Logic is s-expressions.** One syntax for all logic: `(function arg1 arg2)`. Not a style choice. S-expressions are data: they serialize as strings, cross host boundaries without translation, and parse to an AST in one pass. The evaluator enforces a hard split between a pure read path (`eval`) and a mutating write path (`exec`). Guards cannot cause side effects. There is no `eval()`, no `new Function()`, no access to the outer scope. The expression language is closed, sandboxed, and the same on every host.

```html
<div mp="counter">
  <mp-ctx>{"count": 0}</mp-ctx>

  <div mp-state="counting">
    <mp-transition event="increment" to="counting">
      <mp-action>(inc! count)</mp-action>
    </mp-transition>
    <mp-transition event="reset" to="confirm">
      <mp-guard>(> count 0)</mp-guard>
    </mp-transition>
    <p><mp-text>(str count ' items')</mp-text></p>
    <button mp-to="increment">+1</button>
    <button mp-to="reset">Reset</button>
  </div>
  <div mp-state="confirm">
    <mp-transition event="yes" to="counting">
      <mp-action>(set! count 0)</mp-action>
    </mp-transition>
    <p>Reset to zero?</p>
    <button mp-to="yes">Yes</button>
    <button mp-to="counting">No</button>
  </div>
</div>
```

---

## The DSL

Five forms cover everything:

```clojure
(when cond value)              ;; conditional value
(do a b c)                     ;; sequence, return last
(set! key value)               ;; mutation
(->> x (f) (g) (h))            ;; pipeline, thread through functions
(fn [x] body)  or  #(> % 0)   ;; lambda
```

Conventions:
- `!` suffix = mutation: `set!`, `inc!`, `push!`, `toggle!`, `prevent!`
- `$` prefix = framework value: `$state`, `$event`, `$item`, `$refs`, `$store`, `$detail`
- `:keyword` = string key: `(obj :name 'Andrew' :age 42)` produces `{name: "Andrew", age: 42}`

---

## Attributes and elements

**The rule:** attributes carry bare identifiers and static values. S-expressions go in elements.

### Attributes (bare values only)

| Attribute | Purpose |
|-----------|---------|
| `mp="name"` | Declare a machine instance |
| `mp-state="name"` | Declare a state (content created on entry, destroyed on exit) |
| `mp-to="state"` | Click transitions to named state |
| `mp-ctx='{"key":"val"}'` | Initial context data (JSON) |
| `mp-initial="state"` | Override initial state (default: first mp-state) |
| `mp-final` | Mark state as terminal (no further transitions) |
| `mp-text="field"` | Set textContent from bare variable (shorthand) |
| `mp-model="path"` | Two-way input binding |
| `mp-each="items"` | Repeat template for each item in bare array name |
| `mp-key="field"` | Keyed reconciliation |
| `mp-ref="name"` | Reference element as `$refs.name` |
| `mp-persist="key"` | Save/restore context to localStorage |
| `mp-url="/path"` | Map state to browser URL (static path) |

### Elements (all logic)

Transitions with guards and actions:
```html
<mp-transition event="submit" to="done">
  <mp-guard>(and (> (count title) 0) (> amount 0))</mp-guard>
  <mp-action>(set! submitted_at (now))</mp-action>
  <mp-emit>order-created</mp-emit>
</mp-transition>
```

Bindings (textContent, visibility, classes, attributes):
```html
<p><mp-text>(str count ' items')</mp-text></p>
<div><mp-show>(> count 0)</mp-show>visible content</div>
<div class="badge"><mp-class>(when done 'badge-success')</mp-class>Status</div>
<button><mp-bind attr="disabled">(not valid)</mp-bind>Submit</button>
```

> **Shorthand:** `mp-text="field"` is valid for bare variables (no parentheses). The element form `<mp-text>expr</mp-text>` is required for s-expressions and is the primary syntax.

DOM events with modifiers (`.prevent`, `.stop`, `.self`, `.once`, `.outside`):
```html
<div>
  <mp-on event="keydown">(when (= (get $event :key) 'Escape') (to closed))</mp-on>
  <input mp-model="title" />
</div>
<form>
  <mp-on event="submit.prevent">(do (push! items (obj :name newName)) (to idle))</mp-on>
  ...
</form>
```

Inter-machine events:
```html
<!-- Sender -->
<mp-transition event="save" to="done"><mp-emit>saved</mp-emit></mp-transition>

<!-- Receiver -->
<mp-receive event="saved">(to show)</mp-receive>
```

Lists with filtering and sorting:
```html
<!-- Bare array name -->
<template mp-each="items" mp-key="name">
  <div><span><mp-text>name</mp-text></span></div>
</template>

<!-- Expression inside element -->
<template mp-key="id">
  <mp-each>(->> items (filter #(> (get % :score) 80)) (sort-by :name) (take 10))</mp-each>
  <div>
    <span><mp-text>name</mp-text></span>
    <span><mp-text>(str 'Score: ' score)</mp-text></span>
  </div>
</template>
```

`$item` = current item. `$index` = current index.

### Composition

| Attribute | Purpose |
|-----------|---------|
| `<template mp-define="name">` | Define a reusable machine template |
| `<mp-slot name="x">` | Content projection point in templates |
| `<link rel="mp-import" href="file.mp.html">` | Import components from external files |

```html
<template mp-define="card">
  <div mp-state="front">
    <mp-slot name="content">Default content</mp-slot>
    <button mp-to="back">Flip</button>
  </div>
  <div mp-state="back">
    <mp-slot name="reveal">Default reveal</mp-slot>
    <button mp-to="front">Back</button>
  </div>
</template>

<div mp="card"><p slot="content">Question</p><p slot="reveal">Answer</p></div>
<div mp="card"><p slot="content">Another</p><p slot="reveal">One</p></div>
```

### Temporal behaviour

`<mp-temporal>` scopes temporal activities to the state lifecycle. When the state is entered, temporal behaviours start. When the state is exited, they are cleaned up automatically. Content is an s-expression using `(animate)`, `(after)`, and `(every)`.

```html
<!-- CSS enter/leave animation -->
<div mp-state="detail">
  <mp-temporal>(animate)</mp-temporal>
</div>

<!-- Auto-transition after delay -->
<div mp-state="toast">
  <mp-temporal>(after 2000 (to idle))</mp-temporal>
</div>

<!-- Repeating interval (polling, clock, animation) -->
<div mp-state="monitoring">
  <mp-temporal>(every 5000 (then! (fetch-status) :data))</mp-temporal>
</div>

<!-- Combined -->
<div mp-state="countdown">
  <mp-temporal>(do (animate) (every 1000 (dec! remaining)) (after 10000 (to expired)))</mp-temporal>
</div>
```

```css
.mp-enter-active, .mp-leave-active { transition: all 0.2s ease; }
.mp-enter-from, .mp-leave-to { opacity: 0; transform: translateY(8px); }
```

### Lifecycle elements

| Element | Purpose |
|---------|---------|
| `<mp-init>expr</mp-init>` | Run on machine creation or state entry |
| `<mp-exit>expr</mp-exit>` | Run before state content is destroyed |
| `<mp-let name="x">expr</mp-let>` | Machine-scope computed binding (derived, not persisted) |
| `mp-ref="name"` | Reference element as `$refs.name` (attribute) |
| `mp-persist="key"` | Save/restore context to localStorage (attribute) |
| `mp-url="/path"` | Map state to browser URL (static or `(path '/p/:k' ctxKey)`) |

### Global state

```html
<mp-store name="user" value='{"name": "Andrew", "role": "engineer"}'></mp-store>

<!-- Any machine can read it -->
<span><mp-text>$store.user.name</mp-text></span>
```

---

## S-expression reference

### Control flow
```clojure
(if cond then else)            (when cond value)
(unless cond value)            (cond c1 v1 c2 v2)
(and a b c)                    (or a b c)
(not x)                        (do a b c)
(let [x 1 y 2] body)           (fn [x y] body)  or  #(> % 0)
(-> x (f a) (g b))             (->> x (f) (g))
```

### Math
```clojure
(+ a b)  (- a b)  (* a b)  (/ a b)  (mod a b)
(inc x)  (dec x)  (abs x)  (min a b)  (max a b)
(round x)  (floor x)  (ceil x)
```

### Comparison
```clojure
(= a b)  (not= a b)  (> a b)  (< a b)  (>= a b)  (<= a b)
(nil? x)  (some? x)  (empty? x)
```

### Strings
```clojure
(str a b c)  (upper s)  (lower s)  (trim s)
(split s sep)  (join arr sep)  (replace s old new)
(contains? s sub)  (starts? s pre)  (ends? s suf)
```

### Collections
```clojure
(count coll)  (first coll)  (last coll)  (nth coll n)
(rest coll)  (take n coll)  (drop n coll)  (reverse coll)
(concat a b)  (includes? coll val)  (distinct coll)  (range a b)
(map f coll)  (filter f coll)  (find f coll)  (reduce f init coll)
(sort-by f coll)  (every? f coll)  (some f coll)  (mapcat f coll)
```

### Objects
```clojure
(obj :k1 v1 :k2 v2)           ;; create
(get obj :key)                 ;; read
(keys obj)  (vals obj)         ;; enumerate
(assoc obj :k v)               ;; new obj with key set
(dissoc obj :k)                ;; new obj with key removed
(merge obj1 obj2)              ;; combine
```

### Mutation
```clojure
(set! key value)               ;; set context value
(inc! key)  (dec! key)         ;; increment/decrement
(toggle! key)                  ;; flip boolean
(push! arr value)              ;; append to array
(remove-where! arr :key val)   ;; remove matching items
(splice! arr idx count)        ;; remove by index
```

### Machine
```clojure
(to state)                     ;; signal transition (any s-expression context)
(emit name)                    ;; signal event (no payload, $detail = nil)
(emit name payload)            ;; signal event with data ($detail = payload)
(prevent!)                     ;; preventDefault on $event
(stop!)                        ;; stopPropagation on $event
(after ms expr)                ;; timed behaviour (inside mp-temporal)
(every ms expr)                ;; repeating interval (inside mp-temporal)
(animate)                      ;; CSS enter/leave animation (inside mp-temporal)
(then! promise :key 'ok' 'err') ;; async: resolve → ok state, reject → err state
(requires 'cap1' 'cap2')       ;; capability declaration (inside mp-where)
```

### Special variables
```
$state    Current state name
$event    DOM event (inside <mp-on>)
$item     Current item (inside mp-each)
$index    Current index (inside mp-each)
$detail   Emit payload (inside mp-receive)
$refs     Element references (via mp-ref)
$store    Global store
$el       Machine element
```

---

## JS escape hatch

For browser APIs that the s-expression language does not cover (fetch, WebSocket, canvas, D3), register functions in JavaScript and call them from expressions:

```js
MachinePerfect.fn('fetch-json', function(url) {
    return fetch(url).then(function(r) { return r.json(); });
});
```

```html
<div mp-state="loading">
  <mp-init>(then! (fetch-json '/api/data') :items 'ready')</mp-init>
</div>
```

Application logic lives in s-expressions. JavaScript is the escape hatch for platform APIs that require it.

### Runtime configuration

```js
MachinePerfect.init({
  registry: 'http://localhost:3100',   // capability registry URL
  loading: '<div class="spinner"></div>' // global loading indicator for mp-where states
});
```

---

## Using with existing pages

Drop an `[mp]` element into any page. Include the two script tags. A MutationObserver auto-initialises new machine elements, so machines work alongside other frameworks, inside HTMX swaps, or added dynamically via JavaScript. No global state pollution, no conflicts.

---

## Install

```html
<script src="https://unpkg.com/machine-perfect/mp/engine.js"></script>
<script src="https://unpkg.com/machine-perfect/mp/browser.js"></script>
```

```
npm install machine-perfect
```

Zero dependencies. Eight files. One folder. No build step.

---

## Examples

- **[Interactive Tutorial](examples/learn.html)** - learn the concepts step by step
- **[Snow Check SPA](examples/spa/)** - ski resort finder with reusable components, command palette, and live weather via JS escape hatch
- **[Sticky Notes](examples/sticky-notes.html)** - CRUD app with zero JavaScript
- **[Purchase Order](examples/purchase-order/)** - full-stack: browser form, server-side SCXML pipeline, capability registry. The entire server-side execution model is 94 lines (`services.js`): four effect adapters and a call to `executePipeline`
- **[Batch Reactor](examples/batch-reactor/)** - ISA-88 industrial process control with hierarchical compound states

---

## License

MIT
