# machine_perfect — Language Reference

## Two concepts

**State machines:** `mp-state` elements define states. Only one is active. Content is created on entry, destroyed on exit. Transitions between states are declared with `mp-to`. If a transition doesn't exist in the markup, it can't happen.

**S-expressions:** `(function arg1 arg2)`. One syntax for all logic. Bare words resolve to context values. Lists apply functions. Five control forms cover everything.

---

## Attributes

```
mp="name"                   Machine instance
mp-state="name"             State (lazy: created on entry, destroyed on exit)
mp-to="state"               Click → transition ("." = self)
mp-ctx='{"k":"v"}'          Initial context (JSON)
mp-initial="state"          Override initial state

mp-text="expr"              textContent from expression
mp-model="path"             Two-way input binding
mp-show="expr"              Visible when truthy
mp-hide="expr"              Hidden when truthy
mp-class="(sexpr)"          CSS classes from s-expressions
mp-bind-ATTR="expr"         Bind any HTML attribute

mp-on:EVENT="sexpr|state"   DOM event handler
mp-emit="name"              Dispatch machine event
mp-receive="(on 'n' body)"  Receive machine events

mp-each="expr"              List rendering (expr must return array)
mp-key="expr"               Keyed reconciliation

mp-define="name"            Template definition (on <template>)
mp-import="url"             Module import (on <link rel="mp-import">)
<mp-slot name="x">          Content projection point

mp-transition               CSS enter/leave animation
mp-transition="(sexpr)"     Temporal behavior: (after), (every)
mp-init="expr"              Run on creation / state entry
mp-exit="expr"              Run before state content is destroyed
mp-ref="name"               Element reference → $refs.name
mp-persist="key"            localStorage persistence
mp-route                    Enable client-side routing (History API)
mp-path="/path"             Map state to URL

<mp-store name value>       Global shared state → $store.name
```

---

## S-expressions

### Atoms
```
42                  number
'hello'             string (single quotes — HTML uses double)
true  false         boolean
nil                 null
:keyword            string key (for objects)
name                symbol → context lookup
$state              current state name
$event              DOM event (in mp-on:)
$item  $index       current item/index (in mp-each)
$detail             emitter context (in mp-receive)
$refs               element references
$store              global store
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
(let [x 1 y 2] body)       local bindings
(fn [x y] body)             lambda
#(> % 0)                    shorthand lambda (% = argument)
(-> x (f a) (g b))          thread first
(->> x (f) (g))             thread last
```

### Values
```
(str a b c)                 concatenate as string
(+ a b)  (- a b)            arithmetic
(* a b)  (/ a b)            arithmetic
(mod a b)                   modulo
(inc x)  (dec x)            +1 / -1
(abs x)  (min a b)          math
(max a b)  (round x)        math
(floor x)  (ceil x)         math
(= a b)  (!= a b)           equality
(> a b)  (< a b)            comparison
(>= a b)  (<= a b)          comparison
(nil? x)  (some? x)         null check
(empty? x)                  empty check
(upper s)  (lower s)        case
(trim s)  (split s d)       string ops
(join arr d)                join array
(contains? s sub)           substring check
(starts? s p)  (ends? s s)  prefix/suffix
(replace s old new)         replace
(count coll)                length
(first c)  (last c)         endpoints
(nth coll n)  (rest c)      access
(take n c)  (drop n c)      slice
(concat a b)  (reverse c)   combine
(includes? c val)           membership
(uniq c)  (range a b)       utility
(obj :k v :k v)             create object
(get obj :key)              read property
(keys obj)  (vals obj)      enumerate
(assoc obj :k v)            new with key
(dissoc obj :k)             new without key
(merge o1 o2)               combine objects
(map f coll)                transform
(filter f coll)             select
(find f coll)               first match
(reduce f init coll)        fold
(sort-by f coll)            order
(every? f coll)             all match?
(some f coll)               any match?
(flat-map f coll)           map + flatten
```

### Mutation (! = side effect)
```
(set! key value)             set context value
(inc! key)  (dec! key)       increment / decrement
(toggle! key)                flip boolean
(push! arr value)            append to array
(remove-where! arr :k val)   remove matching items
(splice! arr idx count)      remove by index
```

### Machine signals
```
(to state)                   transition (inside mp-on: / mp-receive)
(emit name)                  fire event (inside mp-on: / mp-receive)
(prevent!)                   preventDefault (inside mp-on:)
(stop!)                      stopPropagation (inside mp-on:)
(after ms state)             one-shot timer (inside mp-transition)
(every ms expr)              repeating interval (inside mp-transition)
(then! expr :key 'ok' 'err') async: resolve → ok state, reject → err state
```

---

## Event modifiers

```
mp-on:click.prevent="..."     preventDefault
mp-on:click.stop="..."        stopPropagation
mp-on:click.self="..."        only if event.target is the element
mp-on:click.once="..."        remove listener after first fire
mp-on:click.outside="..."     fire when clicking OUTSIDE the element
```

Modifiers combine: `mp-on:submit.prevent.stop="(to saved)"`.

Key filtering uses `$event` in s-expressions — no key modifiers:
```html
mp-on:keydown="(when (= (get $event :key) 'Enter') (to submit))"
mp-on:keydown="(when (and (get $event :ctrlKey) (= (get $event :key) 'k')) (do (prevent!) (emit open-palette)))"
```

---

## Routing

```html
<div mp="app" mp-route>
  <div mp-state="home" mp-path="/">Home</div>
  <div mp-state="settings" mp-path="/settings">Settings</div>
</div>
```

Uses the History API for clean URLs. On init, reads `location.pathname` and transitions to the matching state. On transition, calls `pushState`. Back/forward navigation works automatically. Requires a server that serves `index.html` for all routes.

---

## Global stores

```html
<mp-store name="user" value='{"name":"Andrew","role":"admin"}'></mp-store>
```

Readable in ANY machine as `$store.user.name`. Writable with `(set! $store.user.name 'New')`. Shared by reference — when one machine writes, all machines see the change on their next update. Use `mp-emit` to notify other machines to re-render.

---

## Class expressions

`mp-class` accepts s-expressions that return class name strings:

```html
mp-class="(when active 'ring-2')"
mp-class="(if editing 'border-blue' 'border-gray')"
mp-class="(when-state loading 'animate-pulse')"
mp-class="(do (when active 'ring') (when error 'border-red'))"
```

`when-state` is a shorthand: `(when-state loading 'cls')` adds the class when the machine is in state `loading`.

---

## Conventions

| Convention | Meaning | Examples |
|-----------|---------|---------|
| `!` suffix | Side effect / mutation | `set!` `inc!` `push!` `prevent!` |
| `?` suffix | Predicate (returns boolean) | `nil?` `some?` `empty?` `every?` |
| `$` prefix | Framework-provided value | `$state` `$event` `$item` `$refs` |
| `:` prefix | Keyword (string literal) | `:name` `:id` `:region` |
| `.` as state | Self-transition | `mp-to="."` |

---

## Lifecycle

**State entry:** content cloned from template → bindings evaluated → nested machines initialized → `mp-init` runs → `mp-transition` temporal behaviors start → CSS enter animation plays

**State exit:** `mp-exit` runs → CSS leave animation plays → temporal behaviors cleared → nested machines cleaned up → content destroyed

**Machine creation:** `mp-ctx` parsed → `mp-persist` restores saved values → `$store` and `$refs` attached → initial state stamped → `mp-init` runs → `mp-receive` listeners registered

**DOM mutation:** MutationObserver auto-initializes new `[mp]` elements and cleans up removed ones. Works with HTMX, fetch, SSE, or any mechanism that mutates the DOM.
