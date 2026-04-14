# 6. Runtime View

## Scenario 0: Boot sequence

The boot sequence has two async dependencies: component imports and the
route table. Both must complete before machines with mn-where can function.
The developer writes ONE line of config. Everything else is automatic.

```
Browser loads page
    │
    ▼
<script src="mn/engine.js">     ← engine module loads (sync)
<script src="mn/browser.js">     ← runtime module loads (sync)
    │
    │ Module body executes:
    │   schedules _boot() via setTimeout(0)
    │   (deferred so the rest of the page HTML is parsed first)
    │
    ▼
<link rel="mn-import" href="..."> ← parsed into DOM (sync, not fetched yet)
<mn-store name="app" value="{}">  ← parsed into DOM
<div mn="app" mn-initial="home">  ← parsed into DOM
    │
    ▼
<script>MachineNative.init({ registry: '...', server: '...' });</script>
    │
    │ Sets _registry = url
    │ Starts _fetchRouteTable() → async fetch begins
    │ Opens SSE connection to server (if configured)
    │ Does NOT call init() — boot handles that
    │
    ▼
Event loop runs _boot() (from the earlier setTimeout)
    │
    ├─ Step 1: _loadImports()
    │   Fetches all <link rel="mn-import"> files in parallel
    │   Parses returned HTML for <template mn-define> elements
    │   Registers templates: _templates['my-component'] = templateEl
    │   Returns promise that resolves when ALL imports complete
    │
    ├─ Step 2: init()  (runs after imports resolve)
    │   _processStores()  — reads <mn-store> elements, populates _store
    │   Scans document for [mn] elements
    │   For each: _createInstance(el)
    │     _initMachine()  — reads mn-ctx, mn-persist, finds states, saves templates
    │     Creates inst object with to(), update(), emit()
    │     _wireInstance()  — scans bindings, attaches events, inits nested machines
    │     Fires mn-init on machine element (setTimeout 0)
    │     Fires mn-init on initial state element (setTimeout 0)
    │     If initial state has mn-where → chains on _routeTableReady promise
    │
    ├─ Step 3: _observe()
    │   Starts MutationObserver on document.body
    │   Any future [mn] elements added to DOM will auto-init
    │
    ▼
_routeTableReady resolves (route table fetched from registry)
    │
    ▼
Initial state mn-where triggers fire
    │ machines with mn-where on initial state route to capable hosts
    │ fire-and-forget POST, results arrive via SSE
    │
    ▼
App is ready. User sees initial content.
```

### Boot dependencies

```
_loadImports() ──────────────────┐
                                  ├──→ init() → machines created
DOM parsed ──────────────────────┘
                                        │
_fetchRouteTable() ──────────────────── ├──→ mn-where triggers
                                        │
                                  ┌─────┘
                                  ▼
                          App fully interactive
```

### Key constraints

1. `init(config)` sets registry and starts route fetch but does NOT create machines.
   `_boot()` creates machines after imports load.

2. `mn-where` on initial states chains on `_routeTableReady`, the promise from
   `_fetchRouteTable()`. If no registry is configured, mn-where fires immediately
   (and fails gracefully if no capable node exists).

3. Component templates (`mn-import`) MUST be loaded before `init()` runs.
   Otherwise machines referencing those templates fail with "no template for X."

4. The inline `<script>` with `init(config)` MUST appear after the `<link mn-import>`
   elements in the HTML. This ensures the module has already scheduled `_boot()` which
   will load imports before creating machines.

5. `_boot()` runs via `setTimeout(0)`. It fires after ALL synchronous script execution
   completes but before any user interaction. This guarantees the config is set before
   boot starts.


## Scenario 1: Local transition (user clicks a button)

```
User clicks [Add Item]
    │
    ▼
Document click listener (delegated)
    │ finds closest [mn-to]
    │ finds closest [mn] → machine instance
    │
    ▼
<button mn-to="add-item">Add Item</button>
    │
    │ <mn-transition event="add-item" to=".">
    │   <mn-guard>(not (empty? newItem))</mn-guard>
    │   <mn-action>(push! items (obj :name newItem))</mn-action>
    │ </mn-transition>
    │
    ├─ Evaluate guard: engine.eval("(not (empty? newItem))", ctx)
    │   pure evaluation — cannot mutate
    │   returns true → proceed
    │
    ├─ Execute action: engine.exec("(push! items (obj :name newItem))", ctx)
    │   returns { context: newCtx } with updated items
    │   records dirty key: "items"
    │
    ▼
inst.to(".")
    │ self-transition — no state change
    │ no mn-where on state → local execution
    │ rebuild binding cache
    │ evaluate only bindings whose deps include "items"
    │ update DOM
    │
    ▼
Phase 5: sync mn-ctx attribute
    │ machineEl.setAttribute('mn-ctx', JSON.stringify(ctx))
    │ markup reflects live state
    │
    ▼
User sees new item in list
```

## Scenario 2: Remote state via mn-where

A machine enters a state that requires capabilities the browser lacks. The framework routes the machine to a capable host.

```
Machine enters state 'processing'
    │ <mn-where>(requires 'persist' 'notify')</mn-where>
    │ browser capabilities: ['dom', 'user-input', 'localstorage', 'css-transition']
    │ browser lacks 'persist' and 'notify' → ROUTE
    │
    ├─ _findCapableNode(['persist', 'notify'])
    │   queries route table from registry
    │   finds capable host with matching adapters
    │
    ├─ _sendMachineToNode (fire and forget)
    │   POST to capable host's registered address
    │   Headers: Content-Type: application/xml
    │            X-MN-Session: <session-id>
    │   Body: machine SCXML (with synced mn-ctx)
    │   Returns immediately (202)
    │
    ▼
Host receives SCXML
    │ compiles to canonical definition
    │ executePipelineAsync: advances transitions
    │ effect adapters fire (persist, notify, etc.)
    │ pipeline runs until it reaches a state with no
    │   auto-transition or a state requiring capabilities
    │   this host also lacks
    │
    ├─ Pushes result SCXML back via SSE
    │
    ▼
Browser receives SSE event
    │ decodes SCXML
    │ _receiveMachine: recompiles definition, updates instance
    │ machine now at its new state
    │ DOM updates to reflect new state content
    │
    ▼
User sees result
```

## Scenario 3: Browser-only machine (no mn-where)

Not every machine routes. Browser-only machines handle UI concerns locally.

```
User clicks [Settings]
    │
    ▼
nav machine (browser-only, no mn-where on any state):
    │ <button mn-to="settings">Settings</button>
    │ transitions to 'settings' state
    │ previous state's DOM destroyed, settings state DOM created
    │ mn-show/mn-class/mn-text bindings evaluate
    │
    ▼
User clicks [Back]
    │ <button mn-to="home">Back</button>
    │ transitions to 'home' state
    │ settings DOM destroyed, home DOM created
    │
    ▼
All local. No network. No routing.
```

## Scenario 4: Pipeline execution (multi-step server-side)

A machine transitions through multiple states on the server in a single pipeline run.

```
Machine at state 'draft', user triggers 'submit'
    │
    ▼
Browser: guard evaluates → true (returns new context)
    │ action executes: returns { context: newCtx }
    │ calls inst.to('submitted')
    │
    ▼
to('submitted')
    │ checks stateMap['submitted'] for <mn-where>
    │ finds: <mn-where>(requires 'log' 'persist')</mn-where>
    │ browser lacks both → ROUTE
    │ emits suppressed (route signal — no premature emits mid-flight)
    │
    ├─ fire-and-forget POST to capable host
    │
    ▼
Host receives SCXML at state 'submitted'
    │ executePipelineAsync(def, { effects: adapters }):
    │
    │   submitted → reviewed
    │     guard evaluates → true
    │     action: returns new context
    │     effect: invoke! log → adapter dispatches
    │
    │   reviewed → complete
    │     effect: invoke! persist → adapter stores SCXML snapshot
    │
    │ Pipeline stops at 'complete' (final state)
    │ Pushes result SCXML via SSE
    │
    ▼
Browser receives completed machine
    │ _receiveMachine updates instance
    │ emits fire (previously suppressed)
    │ machine renders 'complete' state content
    │
    ▼
User sees result
```

## Scenario 5: Human-in-the-loop (mn-where capability gating)

A pipeline reaches a state that no automated host can satisfy. The machine blocks until a human acts.

```
Host pipeline advances machine to 'approval-required'
    │ <mn-where>(requires 'human-review')</mn-where>
    │ no host has 'human-review' capability → pipeline returns route signal
    │ persist adapter stores SCXML snapshot at 'approval-required'
    │
    ▼
Browser machine with <invoke type="scxml" src="workflow" mn-state="approval-required"/>
    │ loads blocked machines from persistence as live children
    │ _stampAndEnter creates child machine DOM elements
    │ each child renders itself using its paired .mn.html template
    │ user sees approval UI with context data
    │
    ▼
User clicks [Approve]
    │ child machine transitions: approval-required → approved
    │ <mn-where>(requires 'persist')</mn-where> → ROUTE
    │ fire-and-forget POST to capable host
    │
    ▼
Host pipeline continues:
    │ approved → complete
    │ effects fire, SCXML snapshot updated
    │ result pushed via SSE
    │
    ▼
Browser receives completed machine
```

## Scenario 6: Timed behaviour via mn-temporal

```
Machine enters state with temporal behaviour
    │ <mn-temporal>(every 30000 (to refresh))</mn-temporal>
    │ interval starts: every 30 seconds
    │
    ▼
30 seconds elapsed
    │ engine evaluates (to refresh)
    │
    ▼
to('refresh')
    │ if state has mn-where → routes to capable host
    │ if no mn-where → local re-evaluation and DOM update
    │ same transition mechanics as any other trigger source
    │
    ▼
User sees refreshed content (no page reload)
```

## What is identical across ALL scenarios

| Step | Every transition |
|------|-----------------|
| Guard evaluation | `engine.eval(guardExpr, ctx)`, pure, cannot mutate |
| Action execution | `engine.exec(actionExpr, ctx)` → `{ context, to, emit, effects }`, immutable — returns new context |
| Context sync | Phase 5: `setAttribute('mn-ctx', JSON.stringify(ctx))` |
| Capability check | `to()` reads target state's `<mn-where>`, evaluates, checks host capabilities |
| Remote routing | `_findCapableNode` + `_sendMachineToNode`, same for all sources |
| Content stamping | `stateEl.innerHTML = html` + `_initNested` + `_scanBindAttrs` |
| Purity enforcement | `sevalPure` rejects mutations in guards, browser and server |

The engine does the same work everywhere. The host does platform-specific work. All routing goes through `to()`. One mechanism for every transition source.
