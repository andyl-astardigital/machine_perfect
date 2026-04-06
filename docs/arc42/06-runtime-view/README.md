# 6. Runtime View

## Scenario 0: Boot sequence

The boot sequence has two async dependencies: component imports and the
route table. Both must complete before machines with mp-where can function.
The developer writes ONE line of config. Everything else is automatic.

```
Browser loads page
    │
    ▼
<script src="mp/engine.js">     ← engine module loads (sync)
<script src="mp/browser.js">     ← runtime module loads (sync)
    │
    │ Module body executes:
    │   schedules _boot() via setTimeout(0)
    │   (deferred so the rest of the page HTML is parsed first)
    │
    ▼
<link rel="mp-import" href="..."> ← parsed into DOM (sync, not fetched yet)
<mp-store name="app" value="{}">  ← parsed into DOM
<div mp="app" mp-initial="orders"> ← parsed into DOM
    │
    ▼
<script>MachinePerfect.init({ registry: 'http://localhost:3100' });</script>
    │
    │ Sets _registry = url
    │ Starts _fetchRouteTable() → async fetch begins
    │ Does NOT call init() — boot handles that
    │
    ▼
Event loop runs _boot() (from the earlier setTimeout)
    │
    ├─ Step 1: _loadImports()
    │   Fetches all <link rel="mp-import"> files in parallel
    │   Parses returned HTML for <template mp-define> elements
    │   Registers templates: _templates['po-toast'] = templateEl
    │   Returns promise that resolves when ALL imports complete
    │
    ├─ Step 2: init()  (runs after imports resolve)
    │   _processStores()  — reads <mp-store> elements, populates _store
    │   Scans document for [mp] elements
    │   For each: _createInstance(el)
    │     _initMachine()  — reads mp-ctx, mp-persist, finds states, saves templates
    │     Creates inst object with to(), update(), emit()
    │     _wireInstance()  — scans bindings, attaches events, inits nested machines
    │     Fires mp-init on machine element (setTimeout 0)
    │     Fires mp-init on initial state element (setTimeout 0)
    │     If initial state has mp-where → chains on _routeTableReady promise
    │
    ├─ Step 3: _observe()
    │   Starts MutationObserver on document.body
    │   Any future [mp] elements added to DOM will auto-init
    │
    ▼
_routeTableReady resolves (route table fetched from registry)
    │
    ▼
Initial state mp-where trigger fires
    │ inst.to('orders')
    │ to() checks stateMap['orders'] mp-where → (requires 'ui-render')
    │ browser lacks 'ui-render' → ROUTE
    │ finds po-server in route table
    │ sends machine, receives HTML, stamps into orders state
    │
    ▼
App is ready. User sees order list.
```

### Boot dependencies

```
_loadImports() ──────────────────┐
                                  ├──→ init() → machines created
DOM parsed ──────────────────────┘
                                        │
_fetchRouteTable() ──────────────────── ├──→ mp-where triggers
                                        │
                                  ┌─────┘
                                  ▼
                          App fully interactive
```

### Key constraints

1. `init(config)` sets registry and starts route fetch but does NOT create machines.
   `_boot()` creates machines after imports load.

2. `mp-where` on initial states chains on `_routeTableReady` — the promise from
   `_fetchRouteTable()`. If no registry is configured, mp-where fires immediately
   (and fails gracefully if no capable node exists).

3. Component templates (`mp-import`) MUST be loaded before `init()` runs.
   Otherwise machines referencing those templates fail with "no template for X."

4. The inline `<script>` with `init(config)` MUST appear after the `<link mp-import>`
   elements in the HTML. This ensures the module has already scheduled `_boot()` which
   will load imports before creating machines.

5. `_boot()` runs via `setTimeout(0)` — it fires after ALL synchronous script execution
   completes but before any user interaction. This guarantees the config is set before
   boot starts.


## Scenario 1: Local transition — user clicks a button

```
User clicks [Add Item]
    │
    ▼
Document click listener (delegated)
    │ finds closest [mp-to]
    │ finds closest [mp] → machine instance
    │
    ▼
mp-to="(when (not (empty? newItem)) (do (push! items (obj :name newItem)) (to .)))"
    │
    ├─ Evaluate guard: engine.eval("(not (empty? newItem))", ctx)
    │   pure evaluation — cannot mutate
    │   returns true → proceed
    │
    ├─ Execute action: engine.exec("(push! items (obj :name newItem))", ctx)
    │   mutates ctx.items
    │   records dirty key: "items"
    │
    ▼
inst.to(".")
    │ self-transition — no state change
    │ no mp-where on state → local execution
    │ rebuild binding cache
    │ evaluate only bindings whose deps include "items"
    │ update DOM
    │
    ▼
Phase 5: sync mp-ctx attribute
    │ machineEl.setAttribute('mp-ctx', JSON.stringify(ctx))
    │ markup reflects live state
    │
    ▼
User sees new item in list
```

## Scenario 2: State-level mp-where — page load

```
Browser boots
    │
    ▼
MachinePerfect.init({ registry: 'http://localhost:3100' })
    │ fetches route table from registry
    │ stores node list locally
    │
    ▼
MutationObserver / DOMContentLoaded → _boot()
    │ loads mp-import components
    │ scans for [mp] elements
    │ creates machine instances
    │
    ▼
App machine: mp-initial="orders"
    │ enters initial state 'orders'
    │ calls to('orders')
    │
    ▼
to('orders')
    │ checks stateMap['orders'] for mp-where attribute
    │ finds: mp-where="(requires 'ui-render')"
    │ evaluates → ['ui-render']
    │ browser capabilities: ['dom', 'user-input', 'localstorage', 'css-transition']
    │ browser lacks 'ui-render' → ROUTE
    │
    ├─ Show target state with inline content (loading spinner)
    │
    ├─ _findCapableNode(['ui-render'])
    │   → finds po-server at http://localhost:4000
    │
    ├─ _sendMachineToNode(appEl, node, 'orders')
    │   POST http://localhost:4000/api/machine
    │   Headers: Content-Type: text/html
    │            X-MP-Target: orders
    │            X-MP-Machine: app
    │   Body: machine outerHTML (with synced mp-ctx)
    │
    ▼
Server receives POST /api/machine
    │ X-MP-Machine: app → UI render mode
    │ X-MP-Target: orders
    │ renders order-list.ejs with current orders
    │ returns HTML fragment
    │
    ▼
Browser receives HTML response
    │ stamps into orders state: stateEl.innerHTML = html
    │ scans for bindings, attaches events, inits nested machines
    │ MutationObserver boots any [mp] elements in response
    │
    ▼
User sees order list (or empty state)
```

## Scenario 3: Navigation via mp-receive

```
User clicks [View] on an order card (server-rendered)
    │
    ▼
Order card machine: mp-to="(emit navigate-detail (obj :id id))"
    │ dispatches CustomEvent('mp-navigate-detail') with payload {id: ...}
    │
    ▼
App machine's mp-receive catches event
    │ (on 'navigate-detail' (do (set! _actionId (get $detail :id)) (to detail)))
    │ sets _actionId in app context
    │ calls inst.to('detail')
    │
    ▼
to('detail')
    │ checks stateMap['detail'] for mp-where
    │ finds: mp-where="(requires 'ui-render')"
    │ browser lacks 'ui-render' → ROUTE
    │
    ├─ Phase 5 syncs mp-ctx (now includes _actionId)
    ├─ POST to capable node with X-MP-Target: detail
    │
    ▼
Server receives request
    │ X-MP-Machine: app, X-MP-Target: detail
    │ extracts context: _actionId = 'po-xxx'
    │ looks up order by ID
    │ renders order-detail.ejs
    │ returns HTML with order data
    │
    ▼
Browser stamps detail view
    │ nested order-detail machine boots via MutationObserver
    │ mp-each renders items, effects, history
    │ mp-on:click.outside on delete confirmation
    │
    ▼
User sees order detail
```

## Scenario 4: Pipeline execution via state-level mp-where

```
User fills purchase order form, clicks [Send to Pipeline]
    │
    ▼
Click handler on purchase-order machine (nested inside app)
    │ mp-to="(when (and (> (count items) 0) (> amount 0)) (do (set! submitted_at (now)) (to submitted)))"
    │ guard evaluates → true
    │ action executes: (set! submitted_at (now))
    │ calls inst.to('submitted')
    │
    ▼
to('submitted')
    │ checks stateMap['submitted'] for mp-where
    │ finds: mp-where="(requires 'log' 'notify' 'persist' 'fulfil')"
    │ browser lacks all → ROUTE
    │
    ├─ _sendMachineToNode(purchaseOrderEl, node, 'submitted')
    │   POST with X-MP-Machine: purchase-order
    │   Body: purchase-order machine outerHTML (with synced ctx)
    │
    ▼
Server receives purchase-order machine
    │ X-MP-Machine: purchase-order → pipeline mode
    │ transforms HTML → SCXML
    │ machine.executePipeline(def, { effects: adapters }):
    │
    │   draft → submitted
    │     guard: (> (count items) 0) → true
    │     action: (set! submitted_at (now))
    │     effect: invoke! log → adapter dispatches
    │
    │   submitted → approved (amount < 100,000)
    │     guard: (some? title) → true
    │     action: (set! approved_at (now))
    │     effect: invoke! notify → adapter dispatches
    │
    │   approved → fulfilled
    │     effect: invoke! fulfil → adapter dispatches
    │     effect: invoke! persist → order stored
    │
    │ SCXML → HTML (for display in response)
    │ renders pipeline-result.ejs
    │ returns HTML
    │
    ▼
Browser receives pipeline result
    │ stamps into 'submitted' state of purchase-order machine
    │ user sees: effects fired, audit trail, SCXML/HTML that travelled
    │
    ▼
User clicks [View All Orders]
    │ emits 'navigate-orders'
    │ app machine receives, calls (to orders)
    │ → Scenario 2 flow: orders state mp-where routes to server
    │ → server returns updated order list (with new order)
```

## Scenario 5: Delete via context-carried intent

```
User clicks [Delete Order] on detail view
    │
    ▼
delete-confirm machine: mp-to="open" → shows confirmation
User clicks [Yes, delete]
    │ mp-to="(do (emit delete-order (obj :id id)) (to closed))"
    │
    ▼
App machine mp-receive:
    │ (on 'delete-order' (do
    │     (set! _action 'delete')
    │     (set! _actionId (get $detail :id))
    │     (to orders)))
    │
    ▼
to('orders')
    │ mp-where="(requires 'ui-render')" → ROUTE
    │ Phase 5 syncs mp-ctx: {_action: 'delete', _actionId: 'po-xxx'}
    │ POST to server with synced context
    │
    ▼
Server receives request
    │ X-MP-Target: orders
    │ extracts context: _action='delete', _actionId='po-xxx'
    │ deletes order from storage
    │ renders order-list.ejs (order is gone)
    │ returns HTML
    │
    ▼
Browser stamps updated order list
    │ deleted order not present
    │
    ▼
User sees order removed
```

## Scenario 6: Auto-refresh via (every)

```
Orders state entered
    │ mp-temporal="(every 30000 (to orders))"
    │ interval starts: every 30 seconds
    │
    ▼
30 seconds elapsed
    │ engine evaluates (to orders)
    │
    ▼
to('orders') — targets current state
    │ checks mp-where="(requires 'ui-render')" → ROUTE
    │ sends to capable node
    │ server returns fresh order list
    │ stamps updated content
    │
    ▼
User sees refreshed data (no page reload)
```

## What is identical across ALL scenarios

| Step | Every transition |
|------|-----------------|
| Guard evaluation | `engine.eval(guardExpr, ctx)` — pure, cannot mutate |
| Action execution | `engine.exec(actionExpr, ctx)` — mutates, records dirty keys |
| Context sync | Phase 5: `setAttribute('mp-ctx', JSON.stringify(ctx))` |
| Capability check | `to()` reads target state's `mp-where`, evaluates, checks host capabilities |
| Remote routing | `_findCapableNode` + `_sendMachineToNode` — same for all sources |
| Content stamping | `stateEl.innerHTML = html` + `_initNested` + `_scanBindAttrs` |
| Purity enforcement | `sevalPure` rejects mutations in guards — browser and server |

The engine does the same work everywhere. The host does platform-specific work. All routing goes through `to()`, one mechanism for every transition source.
