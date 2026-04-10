# 1. Introduction and Goals

## What is machine_native?

An application development platform where state machines are the universal unit of definition, execution, and exchange. S-expressions are the expression language. Markup is the authoring substrate. One engine runs on every node. The browser is a node with DOM capabilities. A server is a node with service capabilities. Each node has a native markup format (HTML, SCXML). Machines travel between nodes, routed by what they need.

machine_native is designed for a world where AI generates, validates, and composes applications by producing constrained, verifiable, inspectable machine definitions instead of arbitrary code. The machine document is simultaneously the specification, the implementation, the API contract, and the audit trail.

The key insight: today we pass DATA between services and systems (JSON, XML). machine_native passes COMPUTATION. Machine documents carry their own behaviour, their own rules, their own legal operations. They describe what can happen next and under what conditions.

## Essential requirements

| # | Requirement | Priority |
|---|-------------|----------|
| R1 | State machines as the universal component model, frontend and backend | Must |
| R2 | S-expressions as the single expression language, same evaluator everywhere | Must |
| R3 | Markup-first authoring: each node's native format (HTML, SCXML) | Must |
| R4 | Shared core engine, one codebase, runs on every node | Must |
| R5 | Tier-1 performance via dependency tracking (no Proxies, no compiler) | Must |
| R6 | Pure bindings, read path structurally cannot mutate state | Must |
| R7 | Zero build step for browser node. Two script tags, it works | Must |
| R8 | Machine definitions structurally verifiable by tooling and AI | Must |
| R9 | Machine definitions portable between services as executable contracts | Must |
| R10 | Capability-based hosting: hosts declare effect adapters, transitions route by capability | Should |
| R11 | Distributed transition execution. `mn-where` routes transitions to capable hosts | Should |
| R12 | Backend persistence via effect adapters (Postgres, Redis, file, etc.) | Should |
| R13 | Tooling unification, one graph/lint/repl/simulator for both runtimes | Should |
| R14 | SCXML W3C compliance where practical | Could |

## Quality goals

| # | Quality | Concrete measure |
|---|---------|-----------------|
| Q1 | Performance | Create 1000 keyed rows < 200ms. Targeted update < 5ms. |
| Q2 | Correctness | 1140+ automated tests across browser and Node. Purity enforcement. Recursion limits. |
| Q3 | Verifiability | Machine definitions inspectable without execution: reachable states, valid targets, guard dependencies, deadlock detection. |
| Q4 | Portability | Same s-expression evaluates identically in browser and Node. Same machine definition runs in both hosts. |
| Q5 | Safety | No eval(). Closed expression language. Prototype pollution defense. Bounded caches. |
| Q6 | AI-compatibility | Constrained format that AI can generate, validate, and compose reliably. Finite state space, enumerable transitions, declarative logic. |
| Q7 | Velocity | Single developer can build full-stack applications across domains (asset management, petrophysics, fleet intelligence) using one mental model. |

## Stakeholders

| Role | Concern |
|------|---------|
| Solo developer / small team | Can I build full-stack apps at 10x speed with one mental model across all my projects? |
| AI coding assistant | Can I generate correct machine definitions and verify them structurally, without executing arbitrary code? |
| Architect | Is the model consistent across the stack? Can machines be composed, transformed, and exchanged? |
| Operations | Can I inspect, replay, and audit machine behaviour in production? |
| Future services | Can I receive a machine document and know what to do with it, without reading API docs or needing an SDK? |

## The larger vision

Software is moving from code-centric to specification-centric development. AI can generate code but cannot reliably verify arbitrary code. Machine definitions are verifiable by construction:

- States are finite and enumerable
- Transitions are declared and checkable (do all targets exist? are any states unreachable?)
- Guards are pure expressions that can be evaluated in isolation
- Actions are explicit mutations traceable to specific transitions
- The enabled operations at any point are computable from the definition + current state

machine_native is a substrate for AI-assisted application development. The AI produces constrained, inspectable computation formats rather than unconstrained code.

The end state: machines as portable computation units exchanged between capability pools, between humans and AIs, between organisations. These are computation formats, not data formats. They carry their own behaviour, their own routing requirements, and their own execution topology.

## The capability-based hosting model

Traditional distributed systems decompose into services with APIs between them. machine_native dissolves services into capability pools:

- A host is an engine instance with effect adapters (capabilities) registered.
- A transition can declare what capabilities it needs: `mn-where="(requires 'persist')"`.
- A route table maps capability requirements to host addresses.
- The machine definition carries its own routing. One document describes the full distributed system.

Machines carry their own behaviour. Hosts declare what they can do. A load balancer in front of capability pools replaces traditional service architecture.
