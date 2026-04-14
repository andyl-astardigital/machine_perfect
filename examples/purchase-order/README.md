# Purchase Order — Full-Stack Reference App

A production-grade purchase order approval system built entirely in machine_native. Login, role-based views, data privacy, approval workflows, reject-edit-resubmit, real-time updates, and a Chart.js dashboard — all defined in machine documents. The server has zero business logic.

## Run it

```bash
node mn/registry.js &
node examples/purchase-order/server.js
```

Open http://localhost:4000. Log in as **alice** (requester) or **bob** (director). Password = username.

## Machines

```
machines/
  session.scxml              ← Auth: login → server validates → $user/$token
  nav.scxml                  ← Navigation: browser-only, auth gate, page routing
  order-list.scxml           ← Order list: routes to server for data, invokes stored POs
  director-queue.scxml       ← Director view: loads POs at director-approval state
  purchase-order.scxml       ← Canonical PO: approval pipeline with effects + projections
  purchase-order-status.scxml← Derived PO: safe read-only view for non-directors
  dashboard.scxml            ← Stats: routes to server, renders Chart.js via escape hatch
  toast.scxml                ← Notifications: browser-only, auto-dismiss
```

Each `.scxml` has a paired `.mn.html` template. The SCXML defines behaviour. The HTML defines rendering.

## Patterns

### 1. Authentication — the machine carries its own auth

The session machine routes to the server for credential validation. The auth adapter validates against the SQLite users table (scrypt-hashed passwords), creates a durable session, and returns `{$user, $token}` via the effect adapter return mechanism. The browser stores the session via `mn-persist` and writes `$store.session` so every machine on the page knows who's logged in.

No middleware. No auth headers. No server changes. The session machine is a machine like any other — it routes via `mn:where`, the server runs the pipeline, the adapter validates.

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

### 2. Authorization — guards ARE the access control

The purchase-order machine's director-approval transitions check `$store.session.user.role`. Only directors can approve or reject. The machine defines its own access control — not middleware, not server config.

```xml
<transition event="director-approve" target="approved">
  <mn:guard>(= (get (get $store.session :user) :role) 'director')</mn:guard>
</transition>
```

### 3. Data privacy — mn:project, the third axis

The canonical purchase-order declares how it transforms for different audiences. Non-directors get a completely different machine (`purchase-order-status`) with only safe fields. Sensitive data (notes, cost centre, margin) never reaches the browser.

```xml
<mn:project as="purchase-order-status"
  when="(!= (get $user :role) 'director')">
  (obj
    :title title
    :amount amount
    :item_count (count items)
    :submitted_by (get $user :name)
    :$initial (cond
      (= $state 'fulfilled') 'fulfilled'
      (= $state 'rejected') 'rejected'
      true 'pending'))
</mn:project>
```

Three axes of machine self-description:
- `mn:where` — where does the machine execute
- `mn:guard` — when can transitions fire
- `mn:project` — what does the machine look like to different audiences

### 4. Reverse path — derived machines act on canonicals

Alice's status machine can cancel or resubmit. The status machine routes to the server with `$canonical_id`. The server loads the canonical, merges Alice's edits, runs the canonical through the pipeline, and re-projects back as the status machine.

Forward: canonical context → s-expression → derived machine context
Reverse: derived event + edits → canonical pipeline → re-project

### 5. Rule changes are tiny

**Requirement: "Orders over £50,000 now need director approval."**

Traditional stack: change the API, database, frontend validation, routing, permissions, notifications, tests. ~200 lines across 8 files.

machine_native: change one guard, add one state to the SCXML.

### 6. Third-party integration — escape hatch

The dashboard machine loads order stats from the server (same pipeline pattern), then renders Chart.js charts via `MachineNative.fn('renderChart')`. The machine carries the data. The registered function renders it. Works with any JS library.

### 7. Error recovery

The order-list machine defines its own `error` state with a `retry` transition — overriding the implicit final error. On throw, the user sees the error and can retry. The framework provides the safety net. The author provides the recovery strategy.

### 8. Decomposition — shared chrome, independent machines

The navbar lives at the nav template root — outside any `mn-state`. It persists across state transitions. Clicking Orders → Create → Dashboard swaps the content area below. The navbar never re-renders.

The navbar reads `$store.session` for user info (name, role badge, Director tab visibility). When the session machine updates `$store.session`, the dep tracking re-evaluates only the changed bindings on the navbar. No cascade. No re-render of unrelated content.

The Sign out button in the navbar emits `logout`. The session machine (a sibling in index.html) receives it via `mn-receive`. The SCXML brain's `logout` transition handles the cleanup. Two machines, one button, zero nesting.

This is the pattern: machines that share data use `$store`. Machines that trigger transitions use `emit`/`receive`. Shared UI elements live at the template root. Machine boundaries are rendering boundaries.

## Infrastructure

```
server.js     ← Generic. One POST endpoint, SSE push, static files. Zero business logic.
services.js   ← Wires adapters into pipeline executor. Passes compiler for projections.
db.js         ← SQLite: machines table + users table + sessions table. Scrypt hashing.
adapters/
  auth.js     ← Validates credentials, creates durable sessions
  data.js     ← Loads machines from SQLite by name/state/id
  persist.js  ← Stores SCXML snapshots
  log.js      ← Console output
  notify.js   ← Simulated email (console)
  fulfil.js   ← Simulated dispatch (console)
```

Copy this folder. Change the machines. You have a full-stack app.
