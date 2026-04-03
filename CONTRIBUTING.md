# Contributing to machine_perfect

## Principles

The framework is a single file (`src/machine-perfect.js`). Read it before contributing — it's designed to be readable top to bottom. The coding standards below are non-negotiable.

## Development

No build step required. Open any HTML file in a browser.

```bash
# Serve locally (for mp-import to work)
npx serve .

# Run tests
# Open tests/test.html in a browser
```

## Testing

All tests are in `tests/test.html`. Open the file in a browser — no test runner needed.

- Every new feature needs tests
- Every bug fix needs a regression test
- Performance tests must not regress (check the inline timings)
- All tests must pass before submitting a PR

## Code standards

### Naming
- `_` prefix for all private functions: `_tokenize`, `_parse`, `_seval`
- `$` prefix for framework context variables: `$state`, `$el`, `$event`, `$store`
- `!` suffix for mutation s-expression functions: `set!`, `inc!`, `toggle!`
- `?` suffix for predicates: `nil?`, `some?`, `empty?`
- DOM element properties use `_mp` prefix + descriptive camelCase: `_mpBind`, `_mpBindCache`, `_mpDirty`
- No single-letter variable names outside the stdlib hot path

### Functions
- Under 150 lines. If it's longer, extract. (`_seval` is the only exception — flat switch statements are the correct shape for evaluators)
- Closures stay closures when they capture mutable shared state
- Extract when a block is self-contained or when code is duplicated

### Comments
- Major sections get box-drawing headers with prose explaining what and why
- Subsections use `// ── name ──` headers
- Inline comments explain WHY, not what
- `// perf:` prefix for performance-motivated code
- No TODO, FIXME, or HACK. Fix it or delete it.

### Error handling
- All `JSON.parse` calls wrapped in try/catch
- Binding errors re-throw with element tag and expression
- Unknown functions warn and return null
- Async errors (`then!`) transition to error state if provided

### Purity
- `_eval` (read path) rejects all `!` mutation forms. Bindings cannot change state.
- `_exec` (write path) allows mutations. Used by mp-action, mp-on:, mp-init, mp-exit.
- This is structural enforcement, not convention.

### Performance
- Never querySelectorAll on every update. Cache the element list.
- Never getAttribute on every update. Cache the values.
- Never re-evaluate bindings whose dependencies haven't changed.
- Never move DOM nodes that haven't moved.
- Never update child machines whose data hasn't changed.

### Style
- ES5 throughout. `var`, `function`, `for`. No transpilation. The framework works by opening an HTML file.
- Two blank lines between major sections.
- `== null` for null/undefined checks (intentional loose equality).

## Pull requests

- One feature or fix per PR
- Include tests
- Update REFERENCE.md if the API changes
- Update CHANGELOG.md
- Run the full test suite before submitting
