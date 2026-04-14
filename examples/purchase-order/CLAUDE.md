# machine_native — Application Development Guide

This file primes Claude to build applications with machine_native. Every pattern here is proven in this purchase order app. Copy this file to any new app folder.

## How to think

**The machine IS the program.** States, transitions, guards, actions, effects, routing — all declared in SCXML markup. The server is dumb infrastructure. The browser renders. The machine defines everything.

**Think in machines, not components.** Each machine has one job. A session machine handles auth. A nav machine handles routing. An order-list machine fetches data. A purchase-order machine runs the approval pipeline. Machines communicate via `$store` (shared data) and `emit`/`receive` (events). They don't nest for data sharing — they're siblings.

**Think in states, not flags.** If something can be loading, ready, or errored — that's three states, not three booleans. If a transition shouldn't happen, don't add the transition. The absence of a transition IS the guard.

## Architecture

```
Browser                              Server
────────                             ──────
SCXML machine    ───POST───→         scxml.compile → executePipelineAsync
  (serialised)                        (advance transitions, dispatch effects)
                                              │
SCXML response   ←──SSE────         Result SCXML with final state + context
  (stamps into DOM)
```

- Browser sends machines via HTTP POST (fire and forget, 202)
- Server pushes results via SSE
- SCXML is the only wire format
- The server has zero business logic — it wires adapters and runs pipelines

## File structure

```
machines/
  name.scxml          ← Behaviour: states, transitions, guards, effects, mn:where
  name.mn.html        ← Rendering: DOM bindings, templates, visual feedback
adapters/
  effect-name.js      ← Side effects: persist, notify, auth, data, etc.
server.js             ← Generic pipeline server (copy, never modify)
services.js           ← Wires adapters into pipeline executor
db.js                 ← SQLite machine store (copy, never modify)
index.html            ← Bootstrap: script tags, link declarations, mn-store
```

## Creating a new machine

Every machine is two files paired by name:

**behaviour.scxml** — the authority:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<scxml xmlns:mn="http://machine-native.dev/scxml/1.0"
       name="my-machine" initial="idle"
       mn-ctx='{"title":"","count":0}'>

  <state id="idle">
    <transition event="start" target="active">
      <mn:guard>(not (empty? title))</mn:guard>
      <mn:action>(set! count (+ count 1))</mn:action>
    </transition>
  </state>

  <state id="active">
    <mn:where>(requires 'persist')</mn:where>
    <transition event="done" target="complete">
      <mn:action>(invoke! :type 'persist')</mn:action>
    </transition>
  </state>

  <final id="complete"/>
</scxml>
```

**rendering.mn.html** — visual only:
```html
<template mn-define="my-machine">
  <div mn-state="idle">
    <input mn-model="title" />
    <button mn-to="start">
      <mn-bind attr="disabled">(empty? title)</mn-bind>
      Go
    </button>
  </div>

  <div mn-state="active">
    <p>Processing...</p>
  </div>

  <div mn-state="complete" mn-final>
    <p>Done: <mn-text>title</mn-text></p>
  </div>
</template>
```

**Rules:**
- Guards and transitions live in SCXML only
- mn-text, mn-show, mn-class, mn-bind, mn-on live in HTML only
- The HTML never duplicates transition logic
- mn-to fires events that the SCXML brain handles

## Patterns

### Authentication
The session machine routes to server for auth validation. The auth adapter validates against the database and returns `{$user, $token}` via effect adapter return merge. The session writes `$store.session` on authentication so all machines can read the current user.

```xml
<!-- session.scxml: authenticating state routes to server -->
<state id="authenticating">
  <mn:where>(requires 'auth')</mn:where>
  <transition event="verify">
    <mn:action>(invoke! :type 'auth'
      :input (obj :username username :password password)
      :on-success 'auth-ok' :on-error 'auth-fail')</mn:action>
  </transition>
  <transition event="auth-ok" target="authenticated">
    <mn:guard>(some? $user)</mn:guard>
  </transition>
</state>
```

No middleware. No auth headers. The machine carries its own auth.

### Authorization
Guards check `$store.session.user.role`. The machine defines its own access control:

```xml
<mn:guard>(= (get (get $store.session :user) :role) 'director')</mn:guard>
```

### Data privacy (mn:project)
The canonical machine declares what different audiences see:

```xml
<mn:project as="my-machine-summary" when="(!= (get $user :role) 'admin')">
  (obj :title title :count count :$initial (if (= $state 'complete') 'done' 'active'))
</mn:project>
```

Non-admins get a different machine (`my-machine-summary`) with only safe fields. Sensitive data never reaches the browser.

### Shared UI (decomposition)
Shared elements like navbars live at the template root — outside any `mn-state`. They persist across state transitions and never re-render on navigation:

```html
<template mn-define="app">
  <!-- Persists across states -->
  <nav>
    <span><mn-text>(get $store.session.user :name)</mn-text></span>
    <button><mn-on event="click">(emit logout)</mn-on>Sign out</button>
  </nav>

  <!-- Only the content swaps -->
  <div mn-state="page-a">...</div>
  <div mn-state="page-b">...</div>
</template>
```

### Cross-machine communication
- **Data sharing:** `$store` — write with `(set! $store.name.key value)`, read with `(get $store.name :key)`. Dep tracking re-evaluates only changed bindings.
- **Events:** `(emit event-name)` dispatches. `<mn-receive event="name">` catches. The SCXML brain handles the event if it has a matching transition.
- **Never nest machines for data sharing.** Machines are siblings. Nesting creates lifecycle coupling.

### Error recovery
Define an explicit `error` state to override the implicit final error:

```xml
<state id="error">
  <transition event="retry" target="loading"/>
</state>
```

The framework sets `$error` and `$errorSource` on throw. The template renders them.

### Pipeline effects
`(invoke! :type 'name' :input data)` declares effects. The server's adapters execute them:

```xml
<mn:action>(do
  (invoke! :type 'persist')
  (invoke! :type 'notify' :input (obj :to 'user@co' :subject title)))</mn:action>
```

Effect adapters return data that merges into context. `on-success` and `on-error` fire events for continuation.

### Human-in-the-loop
A state with `mn:where` requiring a capability no automated node has blocks the pipeline:

```xml
<state id="approval-required">
  <mn:where>(requires 'human-review')</mn:where>
  <transition event="approve" target="approved"/>
  <transition event="reject" target="rejected"/>
</state>
```

The machine is stored. A browser loads it via `<invoke>`. The human acts. The machine resumes.

## Quality rules for machines

- Every non-final state must have at least one outbound transition
- Every transition target must exist as a state
- Guards must be pure — no `!` functions. The engine enforces this.
- Actions must not reference undefined context keys
- States with `mn:where` should have loading/spinner content for the user
- `mn:project` expressions should include `$initial` for state mapping
- Event names should be descriptive: `order-approved` not `done`
- Context keys use snake_case: `submitted_at` not `submittedAt`
- Framework variables use `$` prefix: `$user`, `$token`, `$store`
- Internal keys use `_` prefix: `_invokeCounts`, `_orderStatus`

## What NOT to do

- Don't add REST endpoints alongside `/api/machine`
- Don't put business logic in server.js or adapters
- Don't nest machines inside states that get destroyed on transition
- Don't use `mn-show` for security — use `mn:project` (data never sent vs data hidden in DOM)
- Don't duplicate guards between SCXML and HTML
- Don't use `setTimeout` for init logic — use `mn-init` (runs synchronously)
- Don't assume `$store` exists on the server — guard with `(when (some? $store) ...)`
- Don't use `(to stateName)` in `mn-receive` — use matching event names so the SCXML brain handles it

## Testing

- **Framework tests:** `npm test` — engine, machine, scxml, transforms, host, adapters, registry
- **Browser tests:** open `mn/tests/browser.test.html` in a browser (or serve via HTTP + Puppeteer)
- **Pipeline tests:** call `services.executeAsync(scxml)` directly with test SCXML
- **E2e tests:** Puppeteer opens the real app, types into real inputs, clicks real buttons
- Every assertion checks a hand-computed expected value. No `assert(thing)`.
- E2e tests must verify what the user SEES — no raw s-expressions visible, no stale UI, no hidden-but-present sensitive data
