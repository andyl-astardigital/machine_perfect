# Changelog

## 0.5.0 (2026)

Initial public release.

### Core
- State machines as the component model (`mp`, `mp-state`, `mp-to`)
- S-expression language with ~120 built-in functions
- Lazy state rendering: content created on entry, destroyed on exit
- Two-way data binding (`mp-text`, `mp-model`, `mp-show`, `mp-class`, `mp-bind-*`)
- Keyed list reconciliation (`mp-each` with `mp-key`)
- Template composition (`mp-define`, `mp-slot`, `mp-import`)
- Inter-machine events: `(emit name)` and `(emit name payload)` with `$detail` in receivers
- Global shared state (`mp-store`)
- Machine-scope computed bindings (`mp-let`): derived values, reactive, not persisted
- Temporal behaviour engine (`mp-temporal`): CSS animations via `(animate)`, timers via `(after)`, intervals via `(every)`
- Capability-based routing (`mp-where`): states declare capability requirements, runtime routes to capable nodes
- Capability registry (`mp/registry.js`): nodes register, route table served via HTTP
- URL routing (`mp-url`): state-to-URL mapping with pushState, popstate, deep linking
- Auto loading states: framework injects loading indicator for `mp-where` states during fetch
- localStorage persistence (`mp-persist`)
- Lifecycle hooks (`mp-init`, `mp-exit`)
- Context sync: `mp-ctx` attribute stays in sync with live state
- Async with error handling via `(then! expr :key 'ok' 'error')`
- MutationObserver auto-init (HTMX compatible)
- Debug mode (`MachinePerfect.debug = true`)

### Performance
- Runtime dependency tracking via evaluator instrumentation (no Proxies)
- Dirty-based update skipping: only affected bindings re-evaluate
- Value-diffing child updates: unchanged children skipped entirely
- Cached binding lists, no DOM scan on repeat updates
- Cursor-based keyed reconciliation, no unnecessary DOM moves
- Bounded parse cache (evicts at 2000 entries)
- Pre-allocated args, prototype-chain scopes, zero-copy item contexts

### Safety
- Pure binding evaluation: mutations in mp-text/mp-show/mp-class throw
- Prototype pollution defence on all mutation paths: `set!`, `inc!`, `dec!`, `toggle!`, `swap!`, `assoc!`
- Recursion depth limit (512)
- Error messages include element tag and expression
- All JSON.parse calls wrapped in try/catch
- Document-level listener cleanup on machine destroy

### Backend
- Shared s-expression engine (`mp/engine.js`): same evaluator in browser and Node
- Canonical machine execution (`mp/machine.js`): createDefinition, createInstance, sendEvent, inspect, snapshot, restore, validate, executePipeline
- SCXML compiler (`mp/scxml.js`): parses SCXML + MP extensions into canonical format
- HTTP host (`mp/host.js`): machine-native API, zero dependencies
- Effect system (`invoke!`): declared effects dispatched to registered adapters
- Durable timers: after/every metadata persisted in snapshots, restored with elapsed time adjustment
- Adapter interfaces (`mp/adapters.js`): formalised storage and effect contracts, validated at startup
- In-memory storage adapter (Postgres/SQLite/etc. pluggable via same interface)
- 1140+ tests across engine, machine, transforms, SCXML, host, adapters, registry, browser, pipeline, and integration
