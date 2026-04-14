# 10. Quality Requirements

## Quality tree

```
Quality
├── Performance
│   ├── Create 1000 keyed rows < 200ms
│   ├── Partial update (100/1000) < 50ms
│   ├── Targeted update (1/100 nested machines) < 5ms
│   ├── Swap 2 rows < 30ms
│   └── Delete 500 rows < 100ms
│
├── Correctness
│   ├── 1490 automated tests
│   ├── Purity enforcement (mutations in bindings throw)
│   ├── Recursion depth limit (512)
│   ├── Prototype pollution defense
│   ├── All JSON.parse wrapped in try/catch
│   └── Error messages include element + expression
│
├── Portability
│   ├── Same evaluator in browser and Node
│   ├── Same s-expression semantics everywhere
│   ├── Same dependency tracking algorithm
│   └── Same purity enforcement
│
├── Maintainability
│   ├── Functions under 150 lines
│   ├── Descriptive naming (no single-letter vars)
│   ├── Section headers with prose
│   ├── No TODO/FIXME/HACK
│   └── Coding standards in CONTRIBUTING.md
│
├── Safety
│   ├── No eval() or new Function()
│   ├── Closed expression language
│   ├── Bounded caches
│   └── Listener cleanup on destroy
│
└── Inspectability
    ├── Debug mode (undefined vars, transitions)
    ├── Machine definitions are data (not code)
    ├── Enabled transitions computable
    └── History appendable (backend)
```

## Quality scenarios

| # | Scenario | Expected response |
|---|---------|-------------------|
| QS1 | Developer writes `(set! x 5)` inside `mn-text` | Framework throws with function name + guidance |
| QS2 | Malformed JSON in `mn-ctx='not json'` | Framework warns, uses empty context, page continues |
| QS3 | 1000-row list created | Renders in < 200ms |
| QS4 | 1 of 100 nested machines updated | Update completes in < 5ms |
| QS5 | Machine destroyed | All listeners (outside, popstate, inter-machine) cleaned up |
| QS6 | Same guard expression evaluated in browser and Node | Returns identical result |
| QS7 | `(set! __proto__.x 1)` attempted | Silently rejected, Object.prototype not polluted |
| QS8 | 600-deep nested expression | Throws "too deeply nested" instead of stack overflow |
