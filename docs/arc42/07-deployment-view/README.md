# 7. Deployment View

## Frontend deployment

```
Browser
  └── index.html
        ├── <script src="engine.js">                 (shared engine)
        ├── <script src="mp/browser.js">              (browser runtime)
        ├── <link rel="mp-import" href="...">        (component files)
        └── <template mp-define="...">               (inline components)
```

No build step. No bundler. No npm install. Copy the files, open in browser.

Distribution channels:
- Direct file: `mp/engine.js` + `mp/browser.js`
- CDN: `unpkg.com/machine-perfect`
- npm: `npm install machine-perfect`

## Backend deployment

```
Node.js host
  ├── mp/engine.js             (same engine as browser)
  ├── mp/machine.js            (canonical machine execution)
  ├── mp/transforms.js         (HTML ↔ SCXML)
  ├── mp/scxml.js              (SCXML compiler)
  ├── effect adapters           (capabilities: persist, notify, fulfil, log, etc.)
  └── views/                    (EJS templates for server-rendered machine markup)
```

A backend host is just the shared engine with effect adapters. There is no "server framework" — any Node process that imports the engine and registers adapters is a capable host.

## Capability-based deployment (proposed — ADR-012)

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

**Deployment = capability declaration.** An instance says "I can persist and fulfil." It joins pool C. Scaling means adding more instances to a pool. The route table maps capability requirements to pools.

**No service boundaries.** The machine definition carries its own routing via `mp-where`. A transition with `(requires 'persist')` routes to any host in any pool that has a `persist` adapter. The machine doesn't know or care which pool handles it.

**No API definitions.** The machine definition is the contract. A host receives a machine instance, compiles it, advances the transition, and returns the updated instance. Every host speaks the same protocol: machine in, machine out.

## Canonical format and substrates

SCXML is the canonical format. It's what machines ARE.

| Context | Format | Why |
|---------|--------|-----|
| Host → host | SCXML | The canonical format. W3C standard. XSD validates. XSLT transforms. |
| Storage | SCXML | The machine definition persists as SCXML. |
| Browser rendering | HTML | Browsers render HTML. The browser host transforms SCXML → HTML at the edge. |
| Browser transport | HTML → SCXML | The browser transforms its HTML back to SCXML before sending. |
| In-memory runtime | JS objects | Transient. Like a DOM is to HTML. Exists while the engine runs. |

The browser is the ONE special place where HTML exists. The SCXML ↔ HTML transform is the browser host's adapter responsibility. Everything else is SCXML.

## Development environment

```
machine_perfect/
  mp/
    engine.js                 ← runs everywhere
    machine.js                ← canonical machine execution
    transforms.js             ← HTML ↔ SCXML, extractContext, extractMachine
    browser.js                ← browser DOM runtime
    scxml.js                  ← SCXML compiler
    host.js                   ← HTTP server
    adapters.js               ← storage and effect adapter interfaces
    registry.js               ← capability registry
    machines/                 ← SCXML machine definitions
    tests/                    ← all tests
  examples/
    spa/                      ← Snow Check (client-side, JSON side effects)
    purchase-order/           ← Full-stack (server-rendered, machine transport)
      views/                  ← EJS templates (server-rendered machine markup)
      components/             ← mp-import component files
      services.js             ← Pipeline (3 capability pools in one process)
  docs/
    arc42/                    ← This documentation
```

Testing: `npm test` (all Node tests). Browser: open `mp/tests/browser.test.html`.
