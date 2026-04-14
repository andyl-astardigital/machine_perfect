# Roadmap

## v0.6 (current)

Immutable context everywhere. Decomposed machine architecture. SCXML is the only wire format — one endpoint, one pipeline path, no REST. Implicit error state with `$error` and `$errorSource`.

Done in v0.6:
- Immutable context throughout engine, machine, and browser layers
- mn:where checked on state entry mid-pipeline (capability-based blocking)
- Decomposed app → small focused machines (nav, order-list, director-queue, purchase-order, toast)
- Data adapter as effect (no separate data request path)
- Server has zero business logic — one pipeline path, adapters only
- mn-initial for starting machines at any state
- Canonical context getter/setter (no desync between browser and canonical instances)
- $store immutable broadcast across machines
- Implicit error state with $error and $errorSource in context
- Array index paths in setImmutable (items.0.qty works correctly)

Done in v0.7:
- Transport-as-capability: registry stores `{ id, capabilities, transport: { type, address } }` instead of flat address
- Fire-and-forget POST: browser sends machine, gets 202 back immediately, result pushed via SSE
- SSE: browser opens EventSource to server on init, receives machine results as base64 SCXML events
- `_sendMachineToNode` dispatches by `node.transport.type` — extensible for MQTT, WebSocket, etc.
- `<invoke type="scxml" src="name"/>` — stored machines loaded from SQLite as live child machines
- `<invoke type="scxml" src="name" mn-state="state"/>` — filter invoked machines by state
- `_invokeCounts` computed by pipeline invoke resolver: `{ total, byState: { fulfilled: N, ... } }`
- Machine-as-persistence: SQLite stores entire SCXML snapshots, not extracted JSON
- `_receiveMachine` recompiles response SCXML to pick up embedded invokes
- `_stampAndEnter` creates child machine DOM elements from invoke content
- Emit suppression on route signals (no premature emits mid-flight)
- `_transitionTo` reentrancy guard prevents stack overflow during nested transitions
- `_mnBoundInst` tracks which instance bound DOM events, prevents stale handlers

Done in v0.8:
- Pipeline event ordering: definition order, not alphabetical. The author controls priority.
- Format update after targetless effect dispatch (SSE receives correct state after on-success/on-error)
- `mn:project` — context projection at the transport boundary. S-expression builds projected context. Evaluated during invoke resolution. Sensitive fields never leave the server.
- `mn:project as="machine-name"` — derive a different machine for different audiences. The canonical machine declares transforms to other machine types. Different SCXML name, states, template. Both canonical and derived are complete, functioning machines.
- `$state` and `$id` available in projection expressions for state mapping and canonical reference
- `$initial` reserved key in projection for mapping canonical states to derived states
- Reverse path: derived machine with `$canonical_id` routes to server. Pipeline loads canonical, merges user edits, runs canonical pipeline, re-projects back to derived format.
- Authentication pattern: session machine routes to server for auth adapter. SQLite users table with scrypt hashing. Durable sessions with 24h TTL. `$user` and `$token` returned via effect adapter return merge.
- Authorization: guards on machine transitions check `$user.role` from `$store.session`. The machine defines its own access control.
- Data privacy: `mn:project as=` transforms canonical machines for different audiences. Non-directors get safe summary machines. Directors get full context. Sensitive fields never reach unauthorized browsers.
- Explicit error states: machines define their own `error` state with recovery transitions, overriding the implicit final error.
- Dashboard with Chart.js: `MachineNative.fn('renderChart')` proves third-party JS integration. Machine carries data, escape hatch renders it.
- Browser runtime fixes (found via real e2e testing with Puppeteer):
  - Key modifier filtering: `keydown.enter` only fires on Enter, not every keystroke
  - Static AST dep tracking: short-circuit evaluation (`or`, `and`, `if`) no longer defeats binding dependency discovery
  - Synchronous mn-init: `$store` writes from init are visible to bindings in the same transition (no more setTimeout deferral)
  - State hiding on mn:where route: previous state DOM hidden before routing, not left visible
  - Null guard on `extractContext`/`extractMachine`: src invokes without inline SCXML no longer crash `_stampAndEnter`
  - `$store` broadcast triggers `update()` on other machines so cross-machine bindings re-render
  - `_stampAndEnter` clears state content before re-stamping from template
- Decomposition patterns proven by e2e testing:
  - Shared navbar at template root — persists across state transitions, no re-render on navigation
  - Session machine as sibling, not nested — survives nav transitions, communicates via `$store` + `emit`
  - Cross-machine Sign out: navbar emits `logout`, session receives via `mn-receive`, SCXML brain handles the transition
- Chrome DevTools extension: live machine inspector panel with state list, context viewer, transition log, REPL
- 6 Puppeteer e2e tests that type into real inputs and click real buttons

## v0.9: Browser-side effects

1. **Browser invoke! dispatch.** Today only server pipelines dispatch effects via `invoke!`. Browser-side effect adapters (file upload, local storage, camera, geolocation) need the same dispatch mechanism. The machine says `(invoke! :type 'upload' :input $fileBlob :bind uri)`, the browser's upload adapter handles it.

## v1.0: Performance and polish

2. **Large context patterns.** Pagination in data adapters. Machine tracks cursor. Context holds one page. Pattern documentation, not framework change.

## Not planned

3. **SCXML `<parallel>` states.** One machine with multiple regions all active simultaneously. Solves a composition problem by adding complexity to the engine when machine_native already solves it through decomposition — three child machines, each routing independently, parent tracks completions via mn-receive. Composition over complexity.

4. **Implicit error recovery.** The framework provides an implicit error state that catches throws. It does NOT provide auto-retry, recovery transitions, or browser error UI. If the author wants recovery, they define their own error state with transitions. Error handling is machine authoring, not framework magic.

5. **Parent-child context injection.** Already solved by $store and emit/mn-receive.

6. **Conditional machine composition.** Already works with mn-show on child machine elements.

7. **User context ($user).** Inject via host adapter at the transport boundary. Pattern, not framework.

8. **TypeScript types.** ES5 with no build step.

9. **Virtual DOM.** State machine model means only one state's content exists at a time.

10. **Plugin system.** Effect adapters, user functions, and host adapters cover all extension points.
