# Changelog

## 0.5.0 (2026)

Initial public release.

### Core
- State machines as the component model (`mn`, `mn-state`, `mn-to`)
- S-expression language with ~120 built-in functions
- Lazy state rendering: content created on entry, destroyed on exit
- Two-way data binding (`mn-text`, `mn-model`, `mn-show`, `mn-class`, `mn-bind-*`)
- Keyed list reconciliation (`mn-each` with `mn-key`)
- Template composition (`mn-define`, `mn-slot`, `mn-import`)
- Inter-machine events: `(emit name)` and `(emit name payload)` with `$detail` in receivers
- Global shared state (`mn-store`)
- Machine-scope computed bindings (`mn-let`): derived values, reactive, not persisted
- Temporal behaviour engine (`mn-temporal`): CSS animations via `(animate)`, timers via `(after)`, intervals via `(every)`
- Capability-based routing (`mn-where`): states declare capability requirements, runtime routes to capable nodes
- Capability registry (`mn/registry.js`): nodes register, route table served via HTTP
- URL routing (`mn-url`): state-to-URL mapping with pushState, popstate, deep linking
- Auto loading states: framework injects loading indicator for `mn-where` states during fetch
- localStorage persistence (`mn-persist`)
- Lifecycle hooks (`mn-init`, `mn-exit`)
- Context sync: `mn-ctx` attribute stays in sync with live state
- Async with error handling via `(then! expr :key 'ok' 'error')`
- MutationObserver auto-init (HTMX compatible)
- Debug mode (`MachineNative.debug = true`)

### Performance
- Runtime dependency tracking via evaluator instrumentation (no Proxies)
- Dirty-based update skipping: only affected bindings re-evaluate
- Value-diffing child updates: unchanged children skipped entirely
- Cached binding lists, no DOM scan on repeat updates
- Cursor-based keyed reconciliation, no unnecessary DOM moves
- Bounded parse cache (evicts at 2000 entries)
- Pre-allocated args, prototype-chain scopes, zero-copy item contexts

### Safety
- Pure binding evaluation: mutations in mn-text/mn-show/mn-class throw
- Prototype pollution defence on all mutation paths: `set!`, `inc!`, `dec!`, `toggle!`, `swap!`, `assoc!`
- Recursion depth limit (512)
- Error messages include element tag and expression
- All JSON.parse calls wrapped in try/catch
- Document-level listener cleanup on machine destroy

### Backend
- Shared s-expression engine (`mn/engine.js`): same evaluator in browser and Node
- Canonical machine execution (`mn/machine.js`): createDefinition, createInstance, sendEvent, inspect, snapshot, restore, validate, executePipeline
- SCXML compiler (`mn/scxml.js`): parses SCXML + MP extensions into canonical format
- HTTP host (`mn/host.js`): machine-native API, zero dependencies
- Effect system (`invoke!`): declared effects dispatched to registered adapters
- Durable timers: after/every metadata persisted in snapshots, restored with elapsed time adjustment
- Adapter interfaces (`mn/adapters.js`): formalised storage and effect contracts, validated at startup
- In-memory storage adapter (Postgres/SQLite/etc. pluggable via same interface)
- 1140+ tests across engine, machine, transforms, SCXML, host, adapters, registry, browser, pipeline, and integration
