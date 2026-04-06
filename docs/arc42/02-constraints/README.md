# 2. Constraints

## Technical constraints

| # | Constraint | Rationale |
|---|-----------|-----------|
| TC1 | Shared engine must be ES5 JavaScript | Frontend must run without transpilation. "Open the HTML file" promise. |
| TC2 | No external runtime dependencies in the engine | The engine is the shared layer. It cannot depend on DOM, Node APIs, or npm packages. |
| TC3 | Frontend distributable as a single file | CDN delivery, unpkg, copy-paste into projects. The browser runtime bundles the engine. |
| TC4 | S-expressions are the only expression language | No JavaScript expressions, no template literals, no ad-hoc mini-languages. One syntax everywhere. |
| TC5 | Backend uses Node.js | Same language as the engine. No cross-language port to maintain. |
| TC6 | SCXML as backend markup format | W3C standard. Established state chart semantics. XML tooling exists. |
| TC7 | Postgres for backend persistence | JSONB for flexible datamodels. Mature, reliable, widely deployed. |

## Organisational constraints

| # | Constraint | Rationale |
|---|-----------|-----------|
| OC1 | MIT license | Maximum adoption. No corporate friction. |
| OC2 | No build step for development | Contributors should be able to open HTML files and see results. |
| OC3 | Coding standards enforced by convention, not tooling | ES5 means no TypeScript, no ESLint config. Standards live in CONTRIBUTING.md. |

## Conventions

| # | Convention | Scope |
|---|-----------|-------|
| CV1 | `!` suffix = mutation (`set!`, `inc!`, `push!`) | S-expression language |
| CV2 | `?` suffix = predicate (`nil?`, `some?`, `empty?`) | S-expression language |
| CV3 | `$` prefix = framework variable (`$state`, `$store`, `$event`) | Runtime context |
| CV4 | `_mp` prefix = DOM expando property | Frontend runtime |
| CV5 | Functions under 150 lines (except evaluator switch) | All code |
| CV6 | Comments explain WHY, not what | All code |
