# Contributing to machine_perfect

## Principles

The entire framework lives in `mp/`. Read the source before contributing. The coding standards below are non-negotiable.

## Architecture

```
mp/
  engine.js         s-expression evaluator, stdlib, dep tracking
  machine.js        canonical machine execution, mp-where route signals
  transforms.js     HTML to SCXML structural transforms
  browser.js        DOM bindings, events, routing, lifecycle
  scxml.js          SCXML compiler
  host.js           HTTP API server
  adapters.js       storage and effect adapter interfaces
  registry.js       capability registry server
  machines/         SCXML machine definitions
  tests/            all test suites
examples/
  purchase-order/   full-stack: app + pipeline + registry
    tests/          Puppeteer integration tests
  spa/              client-side only (Snow Check)
tests/
  run-browser-tests.js  Puppeteer runner for mp/tests/browser.test.html
```

## API surface

**9 shared attributes** (same in HTML and SCXML, all `mp-`):
`mp`, `mp-state`, `mp-initial`, `mp-final`, `mp-ctx`, `mp-to`, `mp-where`, `mp-init`, `mp-exit`

**Browser-only attributes:**
`mp-model`, `mp-each`, `mp-key`, `mp-persist`, `mp-ref`, `mp-url`, `mp-loading`, `mp-store`, `mp-define`, `mp-slot`, `mp-import`

**Structural child elements (all s-expression logic):**
`<mp-text>`, `<mp-show>`, `<mp-class>`, `<mp-bind>`, `<mp-on>`, `<mp-let>`, `<mp-transition>`, `<mp-guard>`, `<mp-action>`, `<mp-emit>`, `<mp-init>`, `<mp-exit>`, `<mp-temporal>`, `<mp-receive>`, `<mp-where>`, `<mp-each>`, `<mp-ctx>`

**2 JS methods, 2 JS properties:**
`init(config)`, `fn(name, func)`, `store`, `debug`

All attributes use the `mp-` prefix in both HTML and SCXML.

## Development

No build step required.

```bash
# Run all Node tests
npm test

# Run browser tests (headless)
node --test tests/run-browser-tests.js

# Run PO integration tests (requires registry + server running)
node mp/registry.js &
node examples/purchase-order/server.js &
node --test examples/purchase-order/tests/integration.test.js

# Open browser tests manually
# Serve from project root, open mp/tests/browser.test.html
```

## Testing

Write a failing test before touching production code. Every new feature needs tests. Every bug fix needs a regression test. Performance benchmarks must not regress. All tests must pass before submitting.

Browser tests use the same `assert`/`eq`/`has` pattern with no framework. Integration tests use Node's built-in `node:test` + `node:assert` with Puppeteer.

## Code standards

### Naming
- `_` prefix for private functions in browser runtime: `_ownElements`, `_scopeFor`, `_createInstance`
- No prefix for shared engine exports: `parse`, `seval`, `evalExpr`
- `$` prefix for framework context variables: `$state`, `$el`, `$event`, `$store`
- `!` suffix for mutation: `set!`, `inc!`, `toggle!`
- `?` suffix for predicates: `nil?`, `some?`, `empty?`
- DOM element properties: `_mp` prefix + descriptive camelCase
- No single-letter variable names outside the stdlib hot path

### Design before code
Never make micro decisions without designing them first. Build the best solution, not the quickest. If that requires rethinking the architecture, rethink the architecture. Never change code without a failing test first. If you hit a roadblock, design the solution in the arc42 docs before coding.

### Functions
Under 150 lines. `sevalInner` is the only exception because a flat switch is the correct evaluator shape. Extract when self-contained or duplicated. Closures stay closures when they capture mutable shared state.

### Comments
Major sections get box-drawing headers with prose. Subsections get `// -- name --` headers. Inline comments explain why, not what. `// perf:` prefix for performance-motivated code. No TODO, FIXME, or HACK.

### Error handling
All `JSON.parse` calls wrapped in try/catch with helpful error messages. Binding errors re-throw with element tag and expression. Unknown functions warn and return null. Invalid attribute combinations warn with specific guidance. Debug mode (`MachinePerfect.debug = true`) logs transitions, guard failures, and routing decisions.

### Purity
`eval` rejects all `!` mutation forms. Bindings (`<mp-text>`, `<mp-show>`, `<mp-class>`, `<mp-bind>`) cannot change state. `exec` allows mutations and is used by `<mp-action>`, `<mp-on>`, `<mp-init>`, and `<mp-exit>`. This split is structural, not conventional.

### Style
ES5 throughout the shared engine and browser runtime. `var`, `function`, `for`. Backend code may use modern Node.js features. Two blank lines between major sections. `== null` for null/undefined checks (intentional loose equality).

## Pull requests

One feature or fix per PR. Include tests (red first, then green). Update docs if the API changes. Update CHANGELOG.md. Run the full test suite before submitting.
