# machine_perfect Language Reference

## Two concepts

**State machines:** `mp-state` elements define states. Only one is active. Content is created on entry, destroyed on exit. Transitions are declared with `mp-to` or `<mp-transition>`. If a transition doesn't exist in the markup, it can't happen.

**S-expressions:** `(function arg1 arg2)`. One syntax for all logic. Bare words resolve to context values. Lists apply functions. Five control forms cover everything.

**The rule:** attributes carry bare identifiers and static values. S-expressions go in elements.

---

## Attributes

```
mp="name"                   Machine instance
mp-state="name"             State (lazy: created on entry, destroyed on exit)
mp-to="state"               Click → transition to named state
mp-ctx='{"k":"v"}'          Initial context (JSON — or use <mp-ctx> element)
mp-initial="state"          Override initial state
mp-final                    Mark state as terminal (no further transitions)

mp-text="field"             textContent from bare variable (shorthand for <mp-text>)
mp-model="path"             Two-way input binding

mp-each="items"             Repeat template for each item in bare array name
mp-key="field"              Keyed reconciliation (bare field name)

mp-ref="name"               Element reference → $refs.name
mp-persist="key"            localStorage persistence
mp-url="/path"              Map state to browser URL (static path)

<template mp-define="name"> Reusable machine template
<mp-slot name="x">          Content projection point
<link rel="mp-import"
      href="file.mp.html">  Import external component
<mp-store name value>       Global shared state → $store.name
```

---

## Elements

Elements carry all logic. If it has parentheses, it is an element, not an attribute.

### Machine structure

```html
<!-- Context — inline JSON or expression -->
<mp-ctx>{"title":"","amount":0}</mp-ctx>

<!-- Computed binding — available throughout the machine, not persisted -->
<mp-let name="valid">(and (> (count title) 0) (> amount 0))</mp-let>

<!-- Receive inter-machine events -->
<mp-receive event="order-approved">(to done)</mp-receive>

<!-- Capability-based routing (server-side) -->
<mp-where>(requires 'log' 'notify')</mp-where>

<!-- Parameterised URL mapping -->
<mp-url>(path '/orders/:id' ctx)</mp-url>
```

### Transitions

```html
<mp-transition event="submit" to="submitted">
  <mp-guard>(and (> (count title) 0) (> amount 0))</mp-guard>
  <mp-action>(set! submitted_at (now))</mp-action>
  <mp-emit>order-created</mp-emit>
</mp-transition>
```

- `<mp-guard>` — pure expression; if falsy, transition is blocked
- `<mp-action>` — effectful expression; runs on transition
- `<mp-emit>` — dispatches a named inter-machine event

### Lifecycle

```html
<mp-init>(focus! $refs.titleInput)</mp-init>   <!-- on state entry -->
<mp-exit>(set! draft '')</mp-exit>              <!-- before state exit -->
<mp-temporal>(animate)</mp-temporal>            <!-- CSS animation -->
<mp-temporal>(after 3000 (to idle))</mp-temporal>
<mp-temporal>(every 5000 (then! (fetch-data) :data))</mp-temporal>
```

`<mp-init>` and `<mp-exit>` appear inside a state or at the machine root. `<mp-temporal>` appears inside a state.

### Bindings

```html
<!-- textContent from expression -->
<p><mp-text>(str count ' items')</mp-text></p>

<!-- Visibility from expression -->
<div><mp-show>(> count 0)</mp-show>...</div>

<!-- CSS classes from expression -->
<div class="badge">
  <mp-class>(cond (= status 'done') 'badge-success' true 'badge-ghost')</mp-class>
</div>

<!-- Attribute binding -->
<button><mp-bind attr="disabled">(not valid)</mp-bind>Submit</button>
<a><mp-bind attr="href">url</mp-bind>Link</a>

<!-- Void element — <mp-bind> appears as sibling, still binds to void element -->
<img class="photo" />
<mp-bind attr="src">imageUrl</mp-bind>
```

### DOM events

```html
<!-- Standard event -->
<button><mp-on event="click">(do (inc! count) (to counting))</mp-on>+</button>

<!-- With modifiers: prevent, stop, self, once, outside -->
<form>
  <mp-on event="submit.prevent">(do (push! items newItem) (to idle))</mp-on>
  ...
</form>

<!-- Key filtering uses $event -->
<div>
  <mp-on event="keydown">(when (= (get $event :key) 'Enter') (to submit))</mp-on>
  <input mp-model="title" />
</div>

<!-- Click outside to close -->
<div mp-state="open">
  <mp-on event="click.outside">(to closed)</mp-on>
  ...
</div>
```

Event modifiers: `.prevent` (preventDefault), `.stop` (stopPropagation), `.self` (only if event.target is the element), `.once` (remove after first fire), `.outside` (fire when clicking outside the element). Modifiers combine: `<mp-on event="submit.prevent.stop">`.

> **`<mp-on>` vs `<mp-transition>`:** DOM event handlers defined with `<mp-on>` are browser-only. They do not travel to SCXML. For transitions that need to be part of the machine's definition and transport to the server, use `<mp-transition>`. A button's `mp-to="eventName"` fires a named event that `<mp-transition event="eventName">` handles.

### Lists

```html
<!-- Bare array name -->
<template mp-each="items" mp-key="name">
  <div><span><mp-text>name</mp-text></span></div>
</template>

<!-- Expression in element — complex filtering and sorting -->
<template mp-key="name">
  <mp-each>(->> items (filter #(> (get % :score) 80)) (sort-by :name))</mp-each>
  <div><span><mp-text>name</mp-text></span></div>
</template>
```

---

## S-expressions

### Atoms
```
42                  number
'hello'             string (single quotes, HTML uses double)
true  false         boolean
nil                 null
:keyword            string key (for objects)
name                symbol → context lookup
$state              current state name
$event              DOM event (in <mp-on>)
$item  $index       current item/index (in mp-each)
$detail             emit payload (in <mp-receive>)
$refs               element references
$store              global store
$el                 machine element
```

### Control flow
```
(if cond then else)         branch
(when cond value)           conditional value (nil if false)
(unless cond value)         inverse of when
(cond c1 v1 c2 v2 ...)     multi-branch
(and a b c)                 short-circuit and
(or a b c)                  short-circuit or
(not x)                     negate
(do a b c)                  sequence, return last
(let [x 1 y 2] body)       local bindings (implicit do, multiple body forms)
(fn [x y] body)             lambda (implicit do, multiple body forms)
#(> % 0)                    shorthand lambda (% = single argument, no %1/%2)
(-> x (f a) (g b))          thread first
(->> x (f) (g))             thread last
```

### Values
```
(str a b c)                 concatenate as string
(+ a b)  (- a b)            arithmetic (variadic)
(* a b)  (/ a b)            arithmetic (variadic)
(mod a b)                   modulo
(inc x)  (dec x)            +1 / -1
(abs x)  (min a b)          math
(max a b)  (round x)        math
(floor x)  (ceil x)         math
(= a b c)  (not= a b)      equality (variadic, structural on objects/arrays, != is alias)
(> a b c)  (< a b c)        comparison (variadic, checks monotonic sequence)
(>= a b c)  (<= a b c)      comparison (variadic)
(nil? x)  (some? x)         null check
(empty? x)                  empty check (collections, strings, and nil)
(number? x)  (string? x)   type predicates
(boolean? x) (map? x)      type predicates
(coll? x)  (fn? x)         type predicates (coll? is true for arrays only)
(true? x)  (false? x)      strict boolean predicates
(type x)                    returns 'nil', 'number', 'string', 'list', or typeof result
(num x)  (int x)  (float x) type coercion to number
(bool x)                    type coercion to boolean
(upper s)  (lower s)        case
(trim s)  (split s d)       string ops
(subs s start end)          substring
(join arr d)                join array
(contains? s sub)           substring check (not key membership, use has-key?)
(starts? s p)  (ends? s suf)  prefix/suffix (aliases: starts-with?, ends-with?)
(replace s old new)         replace
(count coll)                length
(first c)  (last c)         endpoints
(nth coll n)  (rest c)      access
(take n c)  (drop n c)      slice
(concat a b c)              combine (variadic)
(reverse c)                 reverse
(conj coll x)               new collection with x added (pure, works on arrays and objects)
(includes? c val)           value membership in collection
(index-of c val)            index of val in collection (-1 if not found)
(has-key? obj key)          key exists in object
(distinct c)  (uniq c)      deduplicate (distinct is primary)
(range n)  (range a b)      integer sequence
(list a b c)                create list
(obj :k v :k v)             create object
(get obj :key)              read property
(get-in obj [:a :b])        nested read
(keys obj)  (vals obj)      enumerate
(assoc obj :k v :k2 v2)    new with keys (variadic)
(dissoc obj :k :k2)         new without keys (variadic)
(merge o1 o2)               combine objects
(select-keys obj [:a :b])   new object with only specified keys
(zipmap [:a :b] [1 2])      create object from parallel key and value sequences
(update obj :k f)           apply function to value
(assoc-in obj [:a :b] v)    set nested path (pure)
(update-in obj [:a :b] f)   apply function at nested path
(map f coll)                transform (f can be :keyword)
(filter f coll)             select (f can be :keyword)
(find f coll)               first match (f can be :keyword)
(reduce f init coll)        fold
(sort coll)                  sort (natural order)
(sort-by f coll)            order (f can be :keyword)
(every? f coll)             all match?
(some f coll)               first truthy predicate result (not boolean)
(mapcat f coll)             map + flatten (alias: flat-map)
(group-by f coll)           group into map by f
(identity x)                return argument unchanged
(apply f coll)              apply function to list as args
(comp f g h)                function composition (right to left)
(partial f arg1)            partial application
```

### Mutation (! = side effect)
```
(set! key value)             set context value
(inc! key)  (dec! key)       increment / decrement (supports dot-paths)
(toggle! key)                flip boolean (supports dot-paths)
(push! arr value)            append to array
(remove-where! arr :k val)   remove matching items
(splice! arr idx count)      remove by index
(assoc! obj key val)         set key on object in place
(swap! key f arg1 ...)       apply pure fn to value, replace: ctx[key] = f(ctx[key], arg1, ...)
(invoke! :type 'name' :input data)  declare effect for host to dispatch
```

### Machine signals
```
(to state)                   signal transition (any s-expression context)
(emit name)                  signal event dispatch (no payload, $detail = nil)
(emit name payload)          signal event dispatch ($detail = payload in receiver)
(prevent!)                   preventDefault (inside <mp-on>)
(stop!)                      stopPropagation (inside <mp-on>)
(after ms expr)              one-shot timer (inside <mp-temporal>)
(every ms expr)              repeating interval (inside <mp-temporal>)
(animate)                    CSS enter/leave animation (inside <mp-temporal>)
(then! expr :key 'ok' 'err') async: resolve → ok state, reject → err state
(requires 'cap1' 'cap2')     capability declaration (inside <mp-where>)
(in-state? 'name')           true if current state matches or is a child of name
(focus! element)             focus a DOM element (browser only)
```

### Utility
```
(now)                        current timestamp (Date.now)
(uuid)                       generate unique id string
(timestamp str)              parse date string to timestamp
(date-fmt ts)                format timestamp for display
(log a b c)                  console.log, returns first arg
(warn a b c)                 console.warn, returns first arg
```

---

## Global stores

```html
<mp-store name="user" value='{"name":"Andrew","role":"admin"}'></mp-store>
```

Readable in any machine as `$store.user.name`. Writable with `(set! $store.user.name 'New')`. Shared by reference. When one machine writes, all machines see the change on their next update. Use `<mp-emit>` or `(emit name)` inside `<mp-on>` to notify other machines to re-render.

---

## Conventions

| Convention | Meaning | Examples |
|-----------|---------|---------|
| `!` suffix | Side effect / mutation | `set!` `inc!` `push!` `prevent!` |
| `?` suffix | Predicate (returns boolean) | `nil?` `some?` `empty?` `every?` |
| `$` prefix | Framework-provided value | `$state` `$event` `$item` `$refs` |
| `:` prefix | Keyword (string literal) | `:name` `:id` `:region` |

---

## Lifecycle

**State entry:** content cloned from template, bindings evaluated, nested machines initialised, `<mp-init>` runs, `<mp-temporal>` behaviours start (animate, after, every).

**State exit:** `<mp-exit>` runs, CSS leave animation plays, temporal behaviours cleared, nested machines cleaned up, content destroyed.

**Machine creation:** context parsed from `<mp-ctx>` or `mp-ctx` attribute, `mp-persist` restores saved values, `$store` and `$refs` attached, initial state stamped, machine-level `<mp-init>` runs, `<mp-receive>` listeners registered.

**DOM mutation:** MutationObserver auto-initialises new `[mp]` elements and cleans up removed ones. Works with HTMX, fetch, SSE, or any mechanism that mutates the DOM.

---

## Debugging

Enable debug mode to log transitions, guard evaluations, routing decisions, and binding updates to the console:

```js
MachinePerfect.debug = true;
```

**When an s-expression has an error:** the engine logs a warning to the console with the expression and element tag, then returns `null`. Bindings with errors render empty. Guards with errors fail (transition blocked). Actions with errors are skipped.

**When an unknown function is called:** a `[mp] unknown function: name` warning appears in the console. The call returns `null`.

**When a guard blocks a transition:** in debug mode, a message logs which guard expression failed and on which element.

**Common mistakes:**
- Forgetting single quotes around strings: `(= name Andrew)` looks up a variable `Andrew`. Use `(= name 'Andrew')`.
- Putting s-expressions in attributes: `mp-text="(str a b)"` is not valid. Use `<mp-text>(str a b)</mp-text>` inside the element.
- Mutations in bindings: `<mp-text>(inc! x)</mp-text>` throws an error. Mutations are only allowed in `<mp-action>`, `<mp-on>`, `<mp-init>`, `<mp-exit>`.
- Missing `mp-key` on `mp-each`: works but logs a warning. Without keys, the reconciler cannot efficiently track items.
- `<mp-text>` overwrites sibling text: `<span><mp-text>count</mp-text> items</span>` — the " items" text is overwritten on update. Put static text inside the expression: `<mp-text>(str count ' items')</mp-text>`.

**Clojure divergences:**
- `(join arr sep)` takes array first, separator second. Clojure's `clojure.string/join` takes separator first.
- `(contains? s sub)` checks substring presence. Clojure's `contains?` checks key membership. Use `(has-key? obj key)` for key checks.
- `#(> % 0)` supports single argument `%` only. Clojure also supports `%1`, `%2`, `%3`.

**Reserved event names:** `__auto` (eventless transitions) and `__timeout` (timer-fired transitions) are used internally and should not be used as event names in machine definitions.

---

## SCXML support

machine_perfect implements a subset of the W3C SCXML specification, extended with `<mp->` child elements for guards, actions, and capability routing.

| Feature | Status |
|---------|--------|
| `<scxml>` with `initial` | Supported |
| `<state>` with `id` | Supported |
| `<final>` with `id` | Supported |
| `<transition>` with `event`, `target`, `cond` | Supported |
| `<mp-guard>` / `<mp-action>` child elements | Supported (MP extension) |
| `<datamodel>` / `<data>` | Supported |
| `<mp-init>`, `<mp-exit>` on states | Supported (MP extension) |
| `<mp-where>` on states | Supported (MP extension) |
| `<mp-temporal>` on states | Supported (MP extension) |
| Compound (nested) states | Supported |
| Parallel states | Not yet |
| History states | Not yet |
| `<invoke>` | Not yet (use `invoke!` s-expression) |
| `<raise>` / internal events | Not yet |

---

## Node execution API

```javascript
var machine = require('machine-perfect/machine');
var scxml = require('machine-perfect/scxml');
```

| Function | Purpose |
|----------|---------|
| `scxml.compile(xmlString, options)` | Parse SCXML to a machine definition |
| `machine.createDefinition(spec)` | Create a definition from `{ id, states, context }` |
| `machine.createInstance(def, options)` | Create a running instance with host adapters |
| `machine.sendEvent(inst, event, data)` | Send an event, returns transition result |
| `machine.inspect(inst)` | Query enabled transitions, state, context (no side effects) |
| `machine.snapshot(inst)` | Serializable copy for persistence |
| `machine.restore(def, snapshot, host)` | Restore from snapshot |
| `machine.validate(def)` | Validate a definition (check targets, guards) |
| `machine.executePipeline(def, options)` | Advance machine synchronously to final state |
| `machine.executePipelineAsync(def, options)` | Same, but `await`s each effect adapter |

### executePipeline / executePipelineAsync

Drives a machine from its initial state through all transitions until it reaches a final state, a route signal, or a guard blocks all available events.

`executePipeline` dispatches effects synchronously (fire-and-forget). `executePipelineAsync` awaits each effect adapter's return value and injects it back into context via the `bind` field on `invoke!`. Use the async version when adapters return promises (database queries, HTTP calls, solver invocations).

```javascript
// Sync — effects are fire-and-forget
var result = machine.executePipeline(def, {
  effects: { log: fn, notify: fn, persist: fn },
  maxSteps: 10
});

// Async — effects are awaited, results injected into context
var result = await machine.executePipelineAsync(def, {
  effects: {
    solver: async function(input) { return await solveCPSAT(input); },
    persist: async function(input) { return await db.insert(input); }
  },
  maxSteps: 10,
  format: scxmlString,
  formatUpdater: transforms.updateScxmlState
});
// Returns: { instance, format, history, effects, blocked, route }
```

The `bind` field on `invoke!` connects the adapter's return value to the machine's context:

```
(invoke! :type 'solver' :bind 'schedule' :input data)
```

After the adapter resolves, `context.schedule` contains the result. The next guard can read it.

`on-success` and `on-error` send events back into the machine when an adapter resolves or rejects:

```
(invoke! :type 'api' :on-success 'completed' :on-error 'failed' :input request)
```
