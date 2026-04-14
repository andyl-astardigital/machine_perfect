# 7. Deployment View

## Frontend deployment

```
Browser
  └── index.html
        ├── <script src="engine.js">                 (shared engine)
        ├── <script src="mn/browser.js">              (browser runtime)
        ├── <link rel="mn-import" href="...">        (component files)
        └── <template mn-define="...">               (inline components)
```

No build step. No bundler. No npm install. Copy the files, open in browser.

Distribution channels:
- Direct file: `mn/engine.js` + `mn/browser.js`
- CDN: `unpkg.com/machine-native`
- npm: `npm install machine-native`

## Backend deployment

```
Node.js host
  ├── mn/engine.js             (same engine as browser)
  ├── mn/machine.js            (canonical machine execution)
  ├── mn/transforms.js         (SCXML metadata utilities)
  ├── mn/scxml.js              (SCXML compiler)
  ├── effect adapters           (pluggable: persist, notify, fulfil, log, etc.)
  └── persistence              (adapter choice: SQLite, Postgres, flat files, etc.)
```

A backend host is the shared engine with effect adapters. Any Node process that imports the engine and registers adapters is a capable host.

## Capability-based deployment

Traditional deployment defines services. Capability-based deployment defines pools:

```
                    ┌─────────────────┐
                    │   Route Table    │
                    │                  │
                    │ log    → pool-a  │
                    │ notify → pool-b  │
                    │ persist → pool-c │
                    │ fulfil → pool-c  │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                   │
    ┌─────┴─────┐     ┌─────┴─────┐      ┌─────┴─────┐
    │  Pool A    │     │  Pool B    │     │  Pool C    │
    │            │     │            │     │            │
    │  engine.js │     │  engine.js │     │  engine.js │
    │  + log     │     │  + notify  │     │  + persist │
    │            │     │            │     │  + fulfil  │
    │  N instances│    │  N instances│    │  N instances│
    └────────────┘     └────────────┘     └────────────┘
```

Deployment is capability declaration. An instance says "I can persist and fulfil." It joins pool C. Scaling means adding more instances to a pool. The route table maps capability requirements to pools.

There are no service boundaries. The machine definition carries its own routing via `mn-where`. A transition with `(requires 'persist')` routes to any host in any pool that has a `persist` adapter. The machine doesn't know or care which pool handles it.

There are no API definitions. The machine definition is the contract. A host receives a machine instance, compiles it, advances the transition, and returns the updated instance. Every host speaks the same protocol: machine in, machine out.

## Canonical format and substrates

SCXML is the canonical format.

| Context | Format | Why |
|---------|--------|-----|
| Host → host | SCXML | The canonical format. W3C standard. XSD validates. XSLT transforms. |
| Storage | SCXML | The machine definition persists as SCXML. |
| Browser node rendering | HTML | The browser node's native format. Transforms from SCXML at the edge. |
| Browser node transport | HTML → SCXML | The browser node transforms back to SCXML before sending to other nodes. |
| In-memory runtime | JS objects | Transient. Like a DOM is to HTML. Exists while the engine runs. |

HTML only exists on the browser node. The SCXML ↔ HTML transform is the browser node's adapter responsibility. Every other node uses SCXML natively.

## Development environment

```
machine_native/
  mn/
    engine.js                 ← runs everywhere
    machine.js                ← canonical machine execution
    transforms.js             ← SCXML metadata (extractMachine, extractMetadata, stampMetadata)
    browser.js                ← browser DOM runtime
    scxml.js                  ← SCXML compiler
    host.js                   ← HTTP server
    adapters.js               ← storage and effect adapter interfaces
    registry.js               ← capability registry
    machines/                 ← SCXML machine definitions
    tests/                    ← all tests
  examples/
    spa/                      ← Client-side only (browser machines, JSON side effects)
    purchase-order/           ← Full-stack (machine transport, server pipeline, persistence)
  docs/
    arc42/                    ← This documentation
```

Testing: `npm test` (all Node tests). Browser: open `mn/tests/browser.test.html`.
