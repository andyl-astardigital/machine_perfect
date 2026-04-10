# ADR-012: Capability-based hosting and distributed transition execution

## Status
Proposed

## Context
Traditional distributed systems decompose into services, each with its own codebase, API, deployment, and team. Business logic scatters across boundaries. The contract between services (API spec) is separate from the implementation (code). Integration is glue work.

machine_native already proved that a single machine definition carries its own behaviour (guards, actions, effects) and runs identically on any host via the shared engine. ADR-011 established machine documents as portable computation formats.

How should machines cross host boundaries? The conventional answer is APIs: design routes, parse requests, validate payloads. If the machine already carries its own behaviour, the receiving host only needs to know one thing: whether it can fulfil the required effects.

## Decision
Distribution is expressed as a property of transition execution. A transition can declare WHERE it executes via `mn-where`, expressed as an s-expression evaluated by the same engine:

```html
<button mn-to="submit">Submit</button>

<mn-transition event="submit" to="submitted">
  <mn-guard>(and (> (count items) 0) (> amount 0))</mn-guard>
  <mn-action>(set! submitted_at (now))</mn-action>
  <mn-action>(invoke! :type 'log' :input title)</mn-action>
  <mn-where>(requires 'log')</mn-where>
</mn-transition>
```

Hosting is capability-based:
- A host is an engine instance with effect adapters registered. A host declares what it can do: `persist`, `notify`, `log`, `fulfil`.
- A transition declares what capabilities it needs via `mn-where`. The expression `(requires 'persist' 'notify')` means "this transition must execute on a host that has `persist` and `notify` adapters."
- A route table maps capability requirements to host addresses, a well-known registry of which hosts have which capabilities.
- No `mn-where` means local execution (the default). Distribution is opt-in.

The machine instance (state, context, definition) is serialised in the canonical format, transmitted to the capable host, the transition executes, and the updated instance returns or forwards to the next capable host.

## What this eliminates

| Traditional | Capability-based |
|---|---|
| Service A with order API | Engine instance with `log` adapter |
| Service B with approval API | Engine instance with `notify` adapter |
| Service C with fulfilment API | Engine instance with `persist` + `fulfil` adapters |
| API specs between services | Machine definition is the contract |
| Client SDK for each service | Same engine everywhere |
| Service discovery by name | Capability matching by effect requirements |
| Separate deployment configs | Capability declarations |

Services dissolve into capability pools. The machine definition carries its own routing requirements. A load balancer in front of capability pools replaces traditional service meshes.

## The canonical format

SCXML is the canonical format (not JSON, not HTML).

- SCXML travels between hosts, gets stored, gets validated with XSD, and gets transformed with XSLT.
- HTML is the browser rendering of SCXML. Browsers render HTML, so the browser host transforms SCXML to HTML for rendering and HTML to SCXML for transport. This conversion happens at the browser edge only.
- In-memory JS objects are a transient runtime representation, like a DOM is to HTML. They exist while the engine runs.

The browser is a capability host like any other. Its special capabilities are `dom`, `user-input`, `css-transition`, `localstorage`. Its special substrate is HTML. The SCXML ↔ HTML transform is the browser host's adapter responsibility.

Everything else (host to host, storage, validation, AI inspection) is SCXML all the way through. The transport protocol (HTTP, gRPC, AMQP) is a host adapter concern.

## What remains outside the machine

The machine definition does NOT handle authentication, authorisation, retries/circuit breaking, idempotency, or encryption. These are host infrastructure concerns. They wrap the transport adapter, not the machine. Guards can enforce business rules ("amount < 100000"), but network-level concerns stay in the host.

## Rationale
- Self-routing: the machine definition tells you where every transition executes. One document describes the full distributed system.
- Capability matching: hosts don't need to know about specific machines. They declare what they can do. Any machine whose transitions need those capabilities can execute there.
- Testability: mock the adapters, run the entire distributed pipeline in one process. The machine doesn't know the difference.
- AI composability: an AI reads one document and sees the topology, the business rules, the effects, the routing. It can validate, generate, and compose distributed systems.
- Emergent topology: the system topology emerges from capability declarations, not from architecture diagrams drawn in meetings.

## Consequences
- The concept of "service" is replaced by "capability pool."
- API design as a discipline is replaced by machine definition authoring.
- Deployment becomes capability declaration: "this instance can persist and notify."
- The route table (capability to host address) is the single piece of infrastructure config.
- The framework must handle machine serialisation, transmission, and deserialisation as a core concern, not an escape hatch.
- Cultural shift: architects think in capabilities and effects, not services and endpoints.
