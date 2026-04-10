# Snow Check, machine_native SPA Demo

A European ski resort snow conditions finder. Live weather data from Open-Meteo, resort images from Wikipedia. Built entirely in HTML with machine_native.

## Architecture

```
index.html              Main page: all machines, stores, layout
components/
  resort-card.mn.html   Reusable resort display (used in browse, compare, saved)
  toast.mn.html         Auto-dismissing notification
  command-palette.mn.html  Ctrl+K search overlay
```

## Machines

| Machine | States | Role |
|---------|--------|------|
| `shell` | (stateless) | Theme switcher, mn-bind on `<html>` data-theme |
| `app` | loading, error, browse, detail, compare, saved | Main application router |
| `filters` | (stateless) | Sidebar filter controls, writes to $store.filters |
| `picks` | (stateless) | Sidebar saved/compare lists |
| `live-clock` | ticking | Auto-updating timestamp via (every) |
| `command-palette` | closed, open | Ctrl+K search overlay |
| `toast` | idle, show | Auto-dismiss notifications via (after) |
| `resort-card` | display | Imported component — one instance per resort |

## Stores

| Store | Shape | Purpose |
|-------|-------|---------|
| `$store.resorts` | `[{name, code, alt, top, region, country, temp, snow, wind, weather, img}]` | Resort data + live weather |
| `$store.filters` | `{country, minSnow, sortBy, query, weatherReady}` | Current filter state |
| `$store.picks` | `{saved: [], compare: []}` | User's saved and compared resorts |

## Data flow

1. On load, `app` starts in `loading` state
2. `mn-init` calls `(then! (load-resorts) :_x 'browse')` — fetches resort list, transitions to browse
3. Browse state renders resort cards via `mn-each` over `$store.resorts` with filter/sort pipeline
4. Weather data arrives asynchronously — store items mutated in place, `app.update()` called
5. Keyed reconciliation diffs child resort-card machines — only changed cards re-render
6. Filters machine writes to `$store.filters` and emits `filters-changed`
7. App receives `filters-changed` and re-renders (mn-each re-evaluates filter pipeline)

## JavaScript escape hatch

Four functions registered via `MachineNative.fn()`:

| Function | Purpose |
|----------|---------|
| `load-resorts` | Fetch resort list from REST Countries + Open-Meteo APIs |
| `refresh-weather` | Re-fetch weather data for all resorts |
| `timestamp-str` | Format a timestamp as "HH:MM" for the "last updated" display |
| `fetch-summary` | Fetch Wikipedia summary for resort detail view |

These are the ONLY JavaScript in the application. Everything else — routing, filtering, sorting, state management, UI updates — is HTML + s-expressions.

## Key patterns demonstrated

- Hash routing via `mn-route` + `mn-path` for SPA navigation
- Lazy state rendering. 6 app states, only the active state's DOM exists.
- Keyed list reconciliation. 27 resort cards with efficient diffing.
- Component reuse. resort-card used in browse grid, compare grid, and saved grid with different slot content.
- Inter-machine events. filters emits, app receives.
- Temporal behavior. live-clock uses `(every)`, toast uses `(after)`.
- Global stores. 3 stores shared across 8 machines.
- Dependency tracking. Weather updates only re-evaluate affected bindings.
- Async data. `(then!)` for initial load, `MachineNative.fn()` for API calls.
- `mn-import` for components loaded from separate .mn.html files.
