# ADR-004: Structural purity enforcement for bindings

## Status
Accepted

## Context
Bindings (`<mn-text>`, `<mn-show>`, `<mn-class>`, `<mn-bind>`) should be pure reads. They observe state but should never change it. If a binding mutates state during evaluation, it creates Heisenberg bugs: the act of rendering changes what is being rendered. The dependency tracking pass would also corrupt state while trying to observe it.

## Decision
The read path (`eval` / `sevalPure`) structurally rejects all `!` mutation forms by walking the AST before evaluation. Violations throw an error with the function name and guidance on where to use it instead.

## Rejected mutation forms in bindings
`set!`, `inc!`, `dec!`, `toggle!`, `push!`, `remove-where!`, `splice!`, `assoc!`

## Rationale
- Convention is not enough. Developers make mistakes. `<mn-text>(do (inc! count) count)</mn-text>` looks like it would work. It would silently corrupt state on every render cycle.
- AST walking is cheap. Checking the head symbol of each sub-expression before evaluation adds negligible cost.
- The error message is actionable. It tells you which function is rejected and where to put it (`<mn-action>` inside `<mn-transition>`, or `<mn-on>`).
- The write path is unaffected. `_exec` does not use `sevalPure`. Actions, event handlers, init/exit hooks can still mutate freely.

## Consequences
- No accidental mutation during rendering. This class of bug is structurally eliminated.
- The `!` naming convention becomes load-bearing. It's how the framework identifies mutations.
- Pure functions that happen to end with `!` (none currently) would be incorrectly rejected. The convention is enforced, not just suggested.
