# 11. Risks and Technical Debt

## Risks

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|------------|
| R1 | S-expression syntax deters mainstream adoption | High | High | Tutorial with 11 lessons. Consistent syntax is the counter-argument. |
| R2 | No TypeScript support limits team adoption | Medium | Medium | API is 7 members. Types add little value for a small surface. |
| R3 | Frontend has engine copy embedded (not imported) | Low | Medium | Engine is source of truth in `mp/engine.js`. Frontend bundles it for zero-dep distribution. Build script can concatenate. |
| R4 | Conditional branch deps not tracked on first eval | Low | Low | Full eval fallback on external `update()`. Rare in practice. |
| R5 | No SSR — SEO-sensitive apps can't use frontend | Medium | Medium | Backend could render initial HTML from machine definitions (future). |
| R6 | SCXML spec is large — partial compliance may confuse | Low | Medium | Document which SCXML features are supported. Start small. |
| R7 | Parse cache eviction is blunt (full wipe at 2000) | Low | Low | Sufficient for all current use cases. LRU if needed later. |

## Technical debt

| # | Debt | Severity | Plan |
|---|------|----------|------|
| D1 | Frontend `mp/browser.js` has engine code duplicated from `mp/engine.js` | Medium | Add build script to concatenate `mp/engine.js` + browser DOM code into single distributable. |
| D2 | `_createInstance` still compiles HTML → machine in one pass | Medium | Refactor to: compile HTML → canonical definition, then create instance from definition. Aligns with backend model. |
| D3 | `_attachDomEvents` and `_scanBindAttrs` have duplicated scan pattern | Low | Could unify into single scan pass. Low priority — both are init-only, not hot path. |
| D4 | No headless test runner | Low | Browser tests work but can't run in CI. Consider Playwright runner. |
| D5 | SPA demo has ~100 lines of inline JS for API calls | Low | Accepted — JavaScript is optional, not forbidden. Documents the escape hatch pattern. |
