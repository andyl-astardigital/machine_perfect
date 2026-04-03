# Changelog

## 0.5.0 (2025)

Initial public release.

### Core
- State machines as the component model (`mp`, `mp-state`, `mp-to`)
- S-expression language with ~60 built-in functions
- Lazy state rendering (content created on entry, destroyed on exit)
- Two-way data binding (`mp-text`, `mp-model`, `mp-show`, `mp-hide`, `mp-class`, `mp-bind-*`)
- Keyed list reconciliation (`mp-each` with `mp-key`)
- Template composition (`mp-define`, `mp-slot`, `mp-import`)
- Inter-machine events (`mp-emit`, `mp-receive`)
- Global shared state (`mp-store`)
- CSS transition engine (`mp-transition`)
- Temporal behavior (`(after ms state)`, `(every ms expr)`)
- Hash-free client-side routing (`mp-route`, `mp-path`) via History API
- localStorage persistence (`mp-persist`)
- Lifecycle hooks (`mp-init`, `mp-exit`)
- Async with error handling (`(then! expr :key 'ok' 'error')`)
- MutationObserver auto-init (HTMX compatible)
- Debug mode (`MachinePerfect.debug = true`)

### Performance
- Runtime dependency tracking via evaluator instrumentation (no Proxies)
- Dirty-based update skipping (only affected bindings re-evaluate)
- Value-diffing child updates (unchanged children skipped entirely)
- Cached binding lists (no DOM scan on repeat updates)
- Cursor-based keyed reconciliation (no unnecessary DOM moves)
- Bounded parse cache (evicts at 2000 entries)
- Pre-allocated args, prototype-chain scopes, zero-copy item contexts

### Safety
- Pure binding evaluation (mutations in mp-text/mp-show/mp-class throw)
- Prototype pollution defense in path traversal
- Recursion depth limit (512)
- Error messages include element tag and expression
- All JSON.parse calls wrapped in try/catch
- Document-level listener cleanup on machine destroy
