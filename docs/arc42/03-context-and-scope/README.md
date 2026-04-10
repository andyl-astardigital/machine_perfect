# 3. Context and Scope

## Business context

```
                         ┌──────────────────────────────────┐
                         │        machine_native            │
                         │                                   │
    HTML markup ────────►│  ┌──────────┐   ┌──────────┐     │◄──── SCXML markup
                         │  │ Browser  │   │  Node    │     │
    User clicks ────────►│  │  Host    │   │  Host    │     │◄──── HTTP events
                         │  └────┬─────┘   └────┬─────┘     │
    AI-generated ───────►│       └──────┬───────┘           │◄──── AI-generated
    definitions          │        Shared Engine              │      definitions
                         │    (s-expr evaluator +            │
                         │     machine execution)            │
                         └──────────────────────────────────┘
                            │         │           │
                   Browser DOM   Postgres    Service-to-service
                                             machine exchange
```

## External interfaces

| Interface | Direction | Description |
|-----------|-----------|-------------|
| HTML attributes | In (browser) | `mn-state`, `<mn-transition event="name" to="target"><mn-guard>guard</mn-guard><mn-action>action</mn-action><mn-emit>name</mn-emit></mn-transition>`, etc. |
| SCXML documents | In (backend) | `<state>`, `<transition>` with `cond`, `mn-action`, `mn-emit` attributes |
| Canonical JSON | In/Out (both) | Machine definitions as portable computation documents |
| DOM | Out (browser) | textContent, attributes, visibility, CSS classes |
| HTTP API | In/Out (backend) | Events in, machine state + enabled transitions out |
| Postgres | Out (backend) | Instance snapshots, audit log, definition storage |
| External APIs | Out (backend) | Effect adapters (HTTP, email, queues) |
| localStorage | In/Out (browser) | `mn-persist` state persistence |
| MachineNative.fn() | In (both) | User-registered functions (JS escape hatch) |
| AI tooling | In/Out | Generate definitions, validate structure, simulate paths |

## Machine exchange model

A machine document flowing between systems carries:
- Its current state (where it is)
- Its legal transitions (where it can go)
- Its guard conditions (under what rules)
- Its actions (what happens when it moves)
- Its context data (what it knows)
- Its history (where it has been)
- Its enabled operations (what can be done RIGHT NOW)

The receiving system needs no SDK, no API documentation, and no prior knowledge. The machine document is the contract.

## What is NOT in scope (current phase)

- Server-side rendering (SSR) of frontend markup
- Real-time sync between frontend and backend machines
- Visual machine editor / drag-and-drop designer
- SCXML parallel states and history states (deferred)
- XSLT machine transformation (deferred)
- XSD schema validation of machine documents (deferred)
- Multi-language evaluator ports (Rust, Python, deferred)
