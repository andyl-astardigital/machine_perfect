# ADR-002: State machines as the component model

## Status
Accepted

## Context
Frontend frameworks use different component models: virtual DOM components (React), reactive proxies (Vue), compiled components (Svelte), x-data scopes (Alpine). The backend has controllers, services, handlers, actors.

## Decision
Use finite state machines as the universal component model for both frontend and backend.

## Rationale
- Eliminates impossible states: 3 booleans = 8 combinations, half are bugs. A machine has exactly the states that make sense.
- Lazy rendering: only the active state's content exists in the DOM. The working set is physically minimal.
- Explicit transitions: if a transition doesn't exist in the markup, it can't happen. The state chart is the specification.
- Inspectable: you can ask a machine what state it's in, what transitions are legal, what events are accepted.
- Lifecycle scoping: timers, subscriptions, and content are tied to state lifecycle. Enter starts them, exit stops them. No manual cleanup.
- Backend portable: the same state/transition/guard/action model works for business processes, workflows, and API resources.

## Consequences
- Every UI component must be thought of as a state machine. This is a different mental model from "render based on props."
- Simple components (a button, a text display) still need at least one state, even if it's trivial.
- The learning curve is steeper for developers unfamiliar with state machines.
- The payoff is structural correctness. Bugs that are common in boolean-based UIs simply cannot occur.
