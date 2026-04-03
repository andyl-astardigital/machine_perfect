<p align="center">
  <img src="logo.svg" alt="machine_perfect" width="120" />
</p>

# machine_perfect

**State machines and s-expressions in HTML. JavaScript-optional. No build step.**

```html
<script src="machine-perfect.js"></script>

<div mp="door">
  <div mp-state="locked">
    <p>The door is locked.</p>
    <input mp-model="code" placeholder="Enter code" />
    <button mp-to="unlocked" mp-guard="(= code '1234')">Unlock</button>
  </div>
  <div mp-state="unlocked">
    <p>The door is unlocked.</p>
    <button mp-to="open">Open</button>
    <button mp-to="locked" mp-action="(set! code '')">Lock</button>
  </div>
  <div mp-state="open">
    <p>The door is open.</p>
    <button mp-to="unlocked">Close</button>
  </div>
</div>
```

That's a complete interactive state machine. No JavaScript required. The HTML IS the application.

You can't open a locked door — there's no `mp-to="open"` in the locked state. That transition doesn't exist in the markup, so it can't happen. Not prevented by validation. Not caught by a linter. **Structurally impossible.**

---

## Two ideas, everything else follows

**1. UI is a state machine.** Every `mp` element has named states. Only one is active. Only declared transitions can occur. The HTML structure IS the state chart.

**2. Logic is s-expressions.** One syntax everywhere. `(function arg1 arg2)`. Clojure conventions. Composable, parseable, no eval().

```html
<div mp="counter" mp-ctx='{"count": 0}'>
  <div mp-state="counting">
    <p mp-text="(str count ' items')"></p>
    <button mp-to="." mp-action="(inc! count)">+1</button>
    <button mp-to="confirm" mp-guard="(> count 0)">Reset</button>
  </div>
  <div mp-state="confirm">
    <p>Reset to zero?</p>
    <button mp-to="counting" mp-action="(set! count 0)">Yes</button>
    <button mp-to="counting">No</button>
  </div>
</div>
```

---

## The DSL

Five forms cover everything:

```clojure
(when cond value)              ;; conditional value
(do a b c)                     ;; sequence — run each, return last
(set! key value)               ;; mutation
(->> x (f) (g) (h))            ;; pipeline — thread through functions
(fn [x] body)  or  #(> % 0)   ;; lambda
```

Conventions:
- `!` suffix = mutation: `set!`, `inc!`, `push!`, `toggle!`, `prevent!`
- `$` prefix = framework: `$state`, `$event`, `$item`, `$refs`, `$store`, `$detail`
- `:keyword` = string key: `(obj :name 'Andrew' :age 42)` → `{name: "Andrew", age: 42}`

---

## Attributes

### Structure

| Attribute | Purpose |
|-----------|---------|
| `mp="name"` | Declare a machine instance |
| `mp-state="name"` | Declare a state (content created on entry, destroyed on exit) |
| `mp-to="state"` | Click transitions to state (`.` = self-transition) |
| `mp-ctx='{"key":"val"}'` | Initial context data |
| `mp-initial="state"` | Override initial state (default: first mp-state) |
| `mp-guard="expr"` | Block transition if falsy |
| `mp-action="expr"` | Run during transition |

### Data binding

| Attribute | Purpose |
|-----------|---------|
| `mp-text="expr"` | Set textContent from expression |
| `mp-model="path"` | Two-way input binding |
| `mp-show="expr"` | Visible when truthy |
| `mp-hide="expr"` | Hidden when truthy |
| `mp-class="sexpr"` | Toggle CSS classes: `(when done 'line-through')` |
| `mp-bind-ATTR="expr"` | Bind any HTML attribute: `mp-bind-disabled`, `mp-bind-src` |

### Events

| Attribute | Purpose |
|-----------|---------|
| `mp-on:EVENT="sexpr"` | Handle any DOM event with s-expression |
| `mp-on:EVENT="state"` | Simple: transition on event |
| `mp-emit="name"` | Dispatch event for other machines |
| `mp-receive="(on 'name' body)"` | React to events from other machines |

```html
<!-- Escape key closes, with s-expression -->
<input mp-on:keydown="(when (= (get $event :key) 'Escape') (to closed))" />

<!-- Ctrl+K opens palette -->
<body mp-on:keydown="(when (and (get $event :ctrlKey) (= (get $event :key) 'k'))
                      (do (prevent!) (emit open-palette)))">

<!-- Form submit -->
<form mp-on:submit="(do (prevent!) (push! items (obj :name newName)) (to idle))">
```

### Lists

| Attribute | Purpose |
|-----------|---------|
| `mp-each="expr"` | Repeat template for each array item |
| `mp-key="expr"` | Key for efficient reconciliation |

```html
<template mp-each="(->> items (filter #(> (get % :score) 80)) (sort-by :name) (take 10))"
          mp-key="id">
  <div>
    <span mp-text="name"></span>
    <span mp-text="(str 'Score: ' score)"></span>
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
<!-- Define once -->
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

<!-- Use many times — each is independent -->
<div mp="card"><p slot="content">Question</p><p slot="reveal">Answer</p></div>
<div mp="card"><p slot="content">Another</p><p slot="reveal">One</p></div>
```

### Temporal behavior

`mp-transition` scopes temporal activities to state lifecycle. Enter → start. Leave → clean up automatically.

```html
<!-- CSS enter/leave animation -->
<div mp-state="detail" mp-transition>

<!-- Auto-transition after delay -->
<div mp-state="toast" mp-transition="(after 2000 idle)">

<!-- Repeating interval (polling, clock, animation) -->
<div mp-state="monitoring" mp-transition="(every 5000 (then! (fetch-status) :data))">

<!-- Combined -->
<div mp-state="countdown" mp-transition="(do (every 1000 (dec! remaining)) (after 10000 expired))">
```

```css
.mp-enter-active, .mp-leave-active { transition: all 0.2s ease; }
.mp-enter-from, .mp-leave-to { opacity: 0; transform: translateY(8px); }
```

### Lifecycle

| Attribute | Purpose |
|-----------|---------|
| `mp-init="expr"` | Run on machine creation or state entry |
| `mp-ref="name"` | Reference element as `$refs.name` |
| `mp-persist="key"` | Save/restore context to localStorage |
| `mp-route` | Enable hash-based routing |
| `mp-path="/path"` | Map state to URL path |

### Global state

```html
<mp-store name="user" value='{"name": "Andrew", "role": "engineer"}'></mp-store>

<!-- Any machine can read it -->
<span mp-text="$store.user.name"></span>
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
(= a b)  (!= a b)  (> a b)  (< a b)  (>= a b)  (<= a b)
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
(concat a b)  (includes? coll val)  (uniq coll)  (range a b)
(map f coll)  (filter f coll)  (find f coll)  (reduce f init coll)
(sort-by f coll)  (every? f coll)  (some f coll)  (flat-map f coll)
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
(to state)                     ;; signal transition (inside mp-on:/mp-receive)
(emit name)                    ;; signal event emission
(prevent!)                     ;; preventDefault on $event
(stop!)                        ;; stopPropagation on $event
(after ms state)               ;; timed transition (inside mp-transition)
(every ms expr)                ;; repeating interval (inside mp-transition)
(then! promise :key 'state')   ;; async: resolve promise, store result, transition
```

### Special variables
```
$state    Current state name
$event    DOM event (inside mp-on:)
$item     Current item (inside mp-each)
$index    Current index (inside mp-each)
$detail   Emitter's context (inside mp-receive)
$refs     Element references (via mp-ref)
$store    Global store
$el       Machine element
```

---

## JS escape hatch

For browser APIs (fetch, D3, WebSocket, canvas):

```js
// Register once
MachinePerfect.fn('fetch-json', function(url) {
    return fetch(url).then(function(r) { return r.json(); });
});

MachinePerfect.fn('render-chart', function(el, data) {
    d3.select(el).selectAll('rect').data(data)...
});
```

```html
<!-- Call from any s-expression -->
<div mp-init="(then! (fetch-json '/api/data') :items 'ready')">
<div mp-init="(render-chart $refs.chart data)">
```

The boundary is the browser. Below it: JavaScript. Above it: s-expressions. Application logic never lives in a `.js` file.

---

## How it works with servers

machine_perfect is transport-agnostic. It doesn't know or care how content arrives.

**HTMX:** Swaps HTML into the DOM. MutationObserver auto-initializes new machines.

**fetch:** Register `fetch-json` via `MachinePerfect.fn()`. Call via `(then!)`.

**WebSocket / SSE:** Register a listener via `MachinePerfect.fn()`. Push data into context.

**No server:** Static HTML with client-side state. Works from a file.

---

## Install

```html
<script src="https://unpkg.com/machine_perfect/src/machine-perfect.js"></script>
```

```
npm install machine_perfect
```

Zero dependencies. One file. ~600 lines of code.

---

## Examples

- **[Interactive Tutorial](examples/learn.html)** — Learn the concepts step by step
- **[Snow Check SPA](examples/spa/)** — European ski resort finder with routing, live weather data, reusable components, command palette
- **[Sticky Notes](examples/sticky-notes.html)** — CRUD app, zero JavaScript, reusable components

---

## License

MIT
