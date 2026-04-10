# Purchase Order — Full-Stack Example

The machine markup is the transport. No JSON APIs. No REST controllers.

## Run it

```bash
node examples/purchase-order/server.js
```

Open http://localhost:4000

## What happens

1. You fill in the form. The HTML markup is the machine: guards, actions, transitions.
2. You click Submit. The browser sends the **HTML machine markup** to the server.
3. The server transforms HTML → SCXML at the edge (once).
4. **SCXML flows through three services** — Order, Approval, Fulfilment. Each advances the machine state in place on the document.
5. The server transforms SCXML → HTML at the edge (once).
6. The browser receives its **machine back** with updated state.

The same `(and (> (count items) 0) (> amount 0))` guard runs in the browser and on the server. Same engine. Same s-expressions.

## The flow

```
Browser                           Server
────────                          ──────
HTML machine     ───POST───→     HTML → SCXML → compile → executePipeline
  (mp-state,                      (transforms.htmlToScxml,    (advance through
   mp-transition,                  scxml.compile)              transitions,
   mp-ctx)                                                     dispatch effects
                                                               via adapters:
                                                               log, notify,
                                                               persist, fulfil)
                                                                    │
HTML machine     ←──response──   SCXML → HTML    ←──────────────────┘
  (updated state,                 (transforms.scxmlToHtml)
   updated context)
```

Every step is markup. HTML at the edges. SCXML inside the pipeline. The machine carries its own behaviour. Effect adapters (`services.js`) define what this host can do — the framework handles the compile → instance → event loop → dispatch pattern.
