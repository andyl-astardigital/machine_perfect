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
Browser                           Server edge              Services
────────                          ──────────               ────────
HTML machine     ───POST───→     HTML → SCXML    ───→    Order Service
  (mp-state,                      (transform               (parse SCXML,
   mp-to with                      once)                    send 'submit',
   guards/actions,                                         mutate in place)
   mp-ctx)                                                       │
                                                           Approval Service
                                                             (parse SCXML,
                                                              approve/reject,
                                                              mutate in place)
                                                                 │
                                                           Fulfilment Service
                                                             (receive SCXML,
                                                              log, return)
                                                                 │
HTML machine     ←──response──   SCXML → HTML    ←───────────────┘
  (updated state,                 (transform
   updated context)                once)
```

Every step is markup. HTML at the edges. SCXML between services. The machine carries its own behaviour.
