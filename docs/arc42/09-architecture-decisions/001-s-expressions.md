# ADR-001: S-expressions as the expression language

## Status
Accepted

## Context
The framework needs an expression language for guards, actions, bindings, and event handlers. Options: JavaScript expressions (like Alpine/Vue), template literals, a custom DSL, or s-expressions.

## Decision
Use s-expressions (Clojure-inspired) as the single expression language everywhere.

## Rationale
- **One syntax** — the same language in `<mp-text>`, `<mp-on>`, `<mp-class>`, `<mp-receive>`, `<mp-guard>`, `<mp-action>`. Guards, actions, and bindings are s-expressions inside structural child elements. No context switching.
- **Safe** — no `eval()`, no `new Function()`. The tokenizer/parser/evaluator is a closed system. Expressions can't escape the sandbox.
- **Portable** — s-expressions are trivially parseable in any language. The same expression evaluates identically in browser and Node.
- **Inspectable** — the evaluator is a tree-walker. Dependencies are observable. The AST is data.
- **Dependency trackable** — because all data access goes through `seval`, the evaluator can instrument reads and writes without Proxies or a compiler.

## Consequences
- Developers must learn s-expression syntax. The `(function arg1 arg2)` form is unfamiliar to most web developers.
- No TypeScript type checking of expressions. Errors are runtime-only.
- The `!` suffix convention for mutations enables purity enforcement but is a convention to learn.
- The expression language is closed — adding new built-ins requires framework changes, not user code. `MachinePerfect.fn()` is the escape hatch.
