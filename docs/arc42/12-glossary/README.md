# 12. Glossary

| Term | Definition |
|------|-----------|
| **Machine** | A finite state machine instance. Has a current state, context data, and responds to events by transitioning between states. |
| **State** | One of a finite set of conditions a machine can be in. In the browser, each state has associated DOM content that is created on entry and destroyed on exit (lazy rendering). |
| **Transition** | A movement from one state to another, triggered by an event. Can have a guard (condition) and an action (side effect). |
| **Guard** | An s-expression that must evaluate to truthy for a transition to proceed. Evaluated purely; cannot mutate state. |
| **Action** | An s-expression executed during a transition for side effects (mutations, emits). Evaluated via the write path. |
| **Context** | The data associated with a machine instance. Mutable via actions. Readable via bindings. |
| **S-expression** | `(function arg1 arg2)`. The expression language used for all logic. Clojure-inspired. |
| **Binding** | A reactive connection between context data and output (DOM element or API response). Re-evaluated when dependencies change. |
| **Dependency tracking** | The mechanism that records which context keys a binding reads, so only affected bindings re-evaluate on mutation. |
| **Dirty key** | A context key that was mutated since the last update. Used to skip unaffected bindings. |
| **Canonical definition** | A plain JS object describing a machine's states, transitions, guards, and actions. Produced by compiling HTML or SCXML markup. S-expressions preserved as strings. |
| **Host** | The platform-specific runtime that connects the shared engine to the outside world. Browser host: DOM. Node host: HTTP/Postgres. |
| **Host adapter** | An interface the shared engine calls for platform capabilities: timers, persistence, effects, events. |
| **Effect** | A declared host capability invocation. Backend machines emit effect descriptors; the host executes them. `MachineNative.fn()` is the frontend equivalent. |
| **Store** | Global shared state accessible to all machines via `$store`. Frontend: `<mn-store>`. Backend: instance context or shared datamodel. |
| **Purity enforcement** | The structural guarantee that the read path (`eval`) cannot execute mutation forms. Violations throw. |
| **Lazy rendering** | Frontend concept: state content is created when entered and destroyed when exited. Only the active state's DOM exists. |
| **Keyed reconciliation** | Efficient list update algorithm. Compares items by key, reuses existing DOM/machines, only creates/removes what changed. |
| **SCXML** | State Chart XML. W3C standard for describing state machine semantics. Used as the backend markup substrate. |
| **Template** | A reusable machine definition. Frontend: `<template mn-define="name">`. Backend: named SCXML document. |
| **Slot** | Content projection point in a template. Callers inject content into named positions. |
| **Capability** | An effect adapter registered on a host. A host with a `persist` adapter has the `persist` capability. |
| **Capability pool** | A set of engine instances sharing the same capability declarations. Replaces the concept of "service." |
| **Route table** | A mapping from capability requirements to host addresses. The only infrastructure configuration needed. |
| **mn-where** | S-expression on a state element declaring what capabilities are needed to enter it. `(requires 'ui-render')` means content comes from a capable host. `(requires 'log' 'persist')` means the machine must travel to a host with those capabilities. The `to()` function checks this on every transition, regardless of source: button click, mn-receive, mn-init, timer, or initial entry. |
| **Context sync** | Phase 5 of update: the `mn-ctx` attribute is written back to the DOM on every render cycle. The markup always reflects live state, so `outerHTML` is a portable snapshot. |
| **Distributed transition** | A transition whose execution crosses a host boundary. The machine instance is serialised and transmitted to the remote host, which advances the transition and returns the updated instance. |
| **Computation format** | A document that carries its own behaviour, rules, legal operations, and routing requirements. The machine definition is a computation format. |
