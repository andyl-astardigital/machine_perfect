/**
 * machine_perfect v0.5.0 — Markup-native application runtime.
 *
 * Build full applications in HTML. State machines are the component model.
 * JavaScript-optional. No build step. No bundler.
 *
 *   <div mp="toggle">
 *     <div mp-state="off">
 *       <button mp-to="on">Turn on</button>
 *     </div>
 *     <div mp-state="on">
 *       <p>It's on!</p>
 *       <button mp-to="off">Turn off</button>
 *     </div>
 *   </div>
 *
 * ── Core ────────────────────────────────────────────────────────────────────
 *   mp="name"                       Machine instance
 *   mp-state="name"                 State (visible when active)
 *   mp-initial="name"               Override initial state
 *   mp-ctx='{"key":"val"}'          Context data
 *   mp-to="state"                   Click → transition ("." = self)
 *   mp-guard="expr"                 Block transition if falsy
 *   mp-action="statements"          Run JS during transition
 *
 * ── Data binding ────────────────────────────────────────────────────────────
 *   mp-text="expr"                  textContent from expression
 *   mp-model="path"                 Two-way input binding
 *   mp-show="expr"                  Show if truthy
 *   mp-hide="expr"                  Hide if truthy
 *   mp-class="(when expr 'cls')"    Toggle class via s-expression
 *   mp-bind-ATTR="expr"             Bind any HTML attribute
 *
 * ── Events ──────────────────────────────────────────────────────────────────
 *   mp-on:EVENT="state"             Transition on any DOM event
 *   mp-on:EVENT.MODIFIER="state"    With modifiers: prevent, stop, self,
 *                                   enter, escape, space, tab, once, outside
 *   mp-emit="name"                  Dispatch event for other machines
 *   mp-receive="(on 'name' body)"   Receive machine events ($detail = source ctx)
 *
 * ── Lists ───────────────────────────────────────────────────────────────────
 *   mp-each="expr"                  Repeat template for each array item
 *   mp-key="expr"                   Key for efficient reconciliation
 *   In scope: $item, $index         Current item and index
 *
 * ── Transitions ─────────────────────────────────────────────────────────────
 *   mp-transition                   Enable CSS enter/leave animations
 *   mp-transition="(after ms st)"   ...with timed auto-transition
 *   Classes applied: mp-enter-from, mp-enter-active, mp-enter-to,
 *                    mp-leave-from, mp-leave-active, mp-leave-to
 *
 * ── Templates ───────────────────────────────────────────────────────────────
 *   <template mp-define="name">     Reusable machine template
 *
 * ── Lifecycle ───────────────────────────────────────────────────────────────
 *   mp-init="statements"            Run on creation / state entry
 *   mp-exit="statements"            Run before state content is destroyed
 *   mp-ref="name"                   Reference element as $refs.name
 *
 * ── Timing ──────────────────────────────────────────────────────────────────
 *   (after ms state)                Inside mp-transition — auto-transition
 *
 * ── HTMX integration ───────────────────────────────────────────────────────
 *   Works automatically. A MutationObserver initializes new [mp] elements
 *   when HTMX swaps content. HTMX events work with mp-on: directly:
 *     mp-on:htmx:before-request="loading"
 *     mp-on:htmx:after-swap="ready"
 *   No bridge. No coupling. Just standard DOM events.
 *
 * @version 0.5.0
 * @license MIT
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.MachinePerfect = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  S-expression engine                                                    ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // machine_perfect uses s-expressions as its expression language.
  //
  //   (+ 1 2)                       → 3
  //   (if done 'complete' 'pending') → "complete" or "pending"
  //   (str count ' items')           → "5 items"
  //   (> (count items) 0)            → true/false
  //   (do (inc! count) (set! name 'new'))
  //
  // Bare words without parens are resolved as variable lookups:
  //   "done"   → ctx.done
  //   "count"  → ctx.count
  //   "$state" → current state name
  //
  // This is ONE syntax used everywhere — mp-text, mp-show, mp-guard,
  // mp-action, mp-class, mp-on-*. No ad-hoc mini-languages.

  // ── Tokenizer ──────────────────────────────────────────────────────────
  //
  // Supports: ( ) [ ] 'strings' :keywords numbers true false nil symbols
  // #(expr) shorthand for anonymous functions: #(> % 0) → (fn [%] (> % 0))

  function _tokenize(str) {
    var tokens = [], i = 0, len = str.length;
    while (i < len) {
      var ch = str[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '(' || ch === ')' || ch === '[' || ch === ']') {
        tokens.push(ch); i++; continue;
      }
      // #( → anonymous function shorthand
      if (ch === '#' && i + 1 < len && str[i + 1] === '(') {
        tokens.push('#('); i += 2; continue;
      }
      // String literal (single quotes)
      if (ch === "'") {
        var j = i + 1;
        while (j < len && str[j] !== "'") j++;
        tokens.push({ t: 'S', v: str.slice(i + 1, j) });
        i = j + 1; continue;
      }
      // Atom: number, bool, keyword, symbol
      var j = i;
      while (j < len && !/[\s()\[\]]/.test(str[j])) j++;
      var word = str.slice(i, j);
      if (word === 'true') tokens.push({ t: 'B', v: true });
      else if (word === 'false') tokens.push({ t: 'B', v: false });
      else if (word === 'nil') tokens.push({ t: 'N', v: null });
      else if (word[0] === ':') tokens.push({ t: 'K', v: word.slice(1) });
      else if (!isNaN(Number(word)) && word !== '') tokens.push({ t: '#', v: Number(word) });
      else tokens.push({ t: 'Y', v: word });
      i = j;
    }
    return tokens;
  }

  // ── Parser ─────────────────────────────────────────────────────────────
  // Turns tokens into a tree. Atoms stay as token objects.
  // Lists become arrays. Vectors become {t:'V', v:[...]}
  // #(body) becomes (fn [%] body)

  function _parseOne(tokens) {
    if (tokens.length === 0) return null;
    var tok = tokens.shift();
    if (tok === '(') {
      var list = [];
      while (tokens.length > 0 && tokens[0] !== ')') list.push(_parseOne(tokens));
      if (tokens.length > 0) tokens.shift();
      return list;
    }
    if (tok === '[') {
      var vec = [];
      while (tokens.length > 0 && tokens[0] !== ']') vec.push(_parseOne(tokens));
      if (tokens.length > 0) tokens.shift();
      return { t: 'V', v: vec };
    }
    if (tok === '#(') {
      // Anonymous function shorthand: #(> % 0) → (fn [%] (> % 0))
      // The tokens between #( and ) form ONE expression (a function call list),
      // not separate expressions wrapped in do.
      var body = [];
      while (tokens.length > 0 && tokens[0] !== ')') body.push(_parseOne(tokens));
      if (tokens.length > 0) tokens.shift();
      return [{ t: 'Y', v: 'fn' }, { t: 'V', v: [{ t: 'Y', v: '%' }] }, body.length === 1 ? body[0] : body];
    }
    return tok;
  }

  var _parseCache = {};
  var _parseCacheSize = 0;

  function _parse(str) {
    if (_parseCache[str]) return _parseCache[str];
    var tokens = _tokenize(str.trim());
    // Multiple top-level expressions → wrap in implicit (do ...)
    var exprs = [];
    while (tokens.length > 0) exprs.push(_parseOne(tokens));
    var result = exprs.length === 1 ? exprs[0] : [{ t: 'Y', v: 'do' }].concat(exprs);
    // perf: evict cache if it grows beyond reasonable bounds (long-running SPAs)
    if (_parseCacheSize > 2000) { _parseCache = {}; _parseCacheSize = 0; }
    _parseCache[str] = result;
    _parseCacheSize++;
    return result;
  }

  // ── Evaluator ──────────────────────────────────────────────────────────

  var _evalDepth = 0;

  function _seval(node, ctx) {
    if (node === null || node === undefined) return null;
    if (++_evalDepth > 512) { _evalDepth--; throw new Error('[mp] expression too deeply nested (max depth 512)'); }
    try { return _sevalInner(node, ctx); } finally { _evalDepth--; }
  }

  function _sevalInner(node, ctx) {
    // Atom (token object)
    if (!Array.isArray(node)) {
      if (typeof node === 'string') return node; // shouldn't happen, but safety
      switch (node.t) {
        case 'S': return node.v;                    // string literal
        case '#': return node.v;                    // number
        case 'B': return node.v;                    // boolean
        case 'N': return null;                      // nil
        case 'K': return node.v;                    // keyword → string
        case 'V':                                   // vector [1 2 3] → JS array
          var arr = [];
          for (var i = 0; i < node.v.length; i++) arr.push(_seval(node.v[i], ctx));
          return arr;
        case 'Y':                                   // symbol → context lookup
          var name = node.v;
          if (name === '$state') return ctx.$state;
          if (name === '$el') return ctx.$el;
          if (name === '$event') return ctx.$event;
          if (name === '$item') return ctx.$item;
          if (name === '$index') return ctx.$index;
          if (name === '$detail') return ctx.$detail;
          if (name.indexOf('.') !== -1) {
            if (_trackingDeps) _trackedDeps[_depKey(name)] = true;
            return _get(ctx, name);
          }
          // Built-in functions as first-class values (for reduce, map, etc.)
          if (_firstClass[name]) return _firstClass[name];
          // User-registered functions as first-class values
          if (_userFns[name]) return _userFns[name];
          if (_trackingDeps) _trackedDeps[name] = true;
          if (_debug && !(name in ctx)) console.warn('[mp:debug] undefined variable "' + name + '"');
          return ctx[name];
      }
      return node;
    }

    // List (function application)
    if (node.length === 0) return null;
    var head = node[0];
    var fn = (head && head.t === 'Y') ? head.v : null;
    // Use node directly with +1 offset — avoids allocating a sliced array
    // on every function call. n1/n2/n3/n4 are shorthands for the hot path.
    var n1 = node[1], n2 = node[2], n3 = node[3], n4 = node[4];
    var nLen = node.length - 1; // arg count

    // ── Special forms (args NOT pre-evaluated) ───────────────────────

    switch (fn) {
      case 'if':
        return _seval(n1, ctx) ? _seval(n2, ctx) : (n3 != null ? _seval(n3, ctx) : null);

      case 'when':
        return _seval(n1, ctx) ? _seval(n2, ctx) : null;

      case 'unless':
        return !_seval(n1, ctx) ? _seval(n2, ctx) : null;

      case 'when-state':
        // (when-state editing 'ring-2') — returns value if machine is in named state
        return ctx.$state === (n1.v || String(n1)) ? _seval(n2, ctx) : null;

      case 'cond':
        for (var i = 1; i < node.length; i += 2) {
          if (i + 1 < node.length && _seval(node[i], ctx)) return _seval(node[i + 1], ctx);
        }
        return null;

      case 'and':
        var val; for (var i = 1; i < node.length; i++) { val = _seval(node[i], ctx); if (!val) return val; } return val;

      case 'or':
        for (var i = 1; i < node.length; i++) { var val = _seval(node[i], ctx); if (val) return val; } return val;

      case 'do':
        var result; for (var i = 1; i < node.length; i++) result = _seval(node[i], ctx); return result;

      case 'let':
        // (let [x 1 y 2] (+ x y))  — vector bindings (Clojure-style)
        var bindings = n1, body = n2;
        // Support both vector {t:'V',v:[...]} and list [...] for bindings
        var blist = bindings.t === 'V' ? bindings.v : (Array.isArray(bindings) ? bindings : []);
        var local = Object.create(ctx);
        for (var i = 0; i < blist.length; i += 2) {
          local[blist[i].v] = _seval(blist[i + 1], local);
        }
        return _seval(body, local);

      case 'fn':
        // (fn [x y] (+ x y))  — vector params (Clojure-style)
        var params = n1, body = n2;
        var plist = params.t === 'V' ? params.v : (Array.isArray(params) ? params : []);
        return function () {
          var local = Object.create(ctx);
          for (var i = 0; i < plist.length; i++) local[plist[i].v] = arguments[i];
          return _seval(body, local);
        };

      // ── Threading macros (Clojure-style) ───────────────────────────
      // (-> x (f a) (g b))  → (g (f x a) b)     — thread as FIRST arg
      // (->> x (f a) (g b)) → (g a (f a x))      — thread as LAST arg
      case '->':
        var result = n1;
        for (var i = 2; i < node.length; i++) {
          if (Array.isArray(node[i])) {
            result = [node[i][0], result].concat(node[i].slice(1));
          } else {
            result = [node[i], result];
          }
        }
        return _seval(result, ctx);

      case '->>':
        var result = n1;
        for (var i = 2; i < node.length; i++) {
          if (Array.isArray(node[i])) {
            result = node[i].concat([result]);
          } else {
            result = [node[i], result];
          }
        }
        return _seval(result, ctx);

      case 'set!':
        var val = _seval(n2, ctx);
        if (n1.v.indexOf('.') !== -1) {
          _set(ctx, n1.v, val);
          // Dotted paths mutate via prototype chain — _applyScope won't see them.
          // Record the dirty key directly so dependency tracking picks it up.
          if (ctx.__mpInst) { if (!ctx.__mpInst._mpDirty) ctx.__mpInst._mpDirty = {}; ctx.__mpInst._mpDirty[_depKey(n1.v)] = true; }
        }
        else ctx[n1.v] = val;
        return val;

      case 'inc!':
        ctx[n1.v] = (ctx[n1.v] || 0) + 1; return ctx[n1.v];

      case 'dec!':
        ctx[n1.v] = (ctx[n1.v] || 0) - 1; return ctx[n1.v];

      case 'toggle!':
        ctx[n1.v] = !ctx[n1.v]; return ctx[n1.v];

      case 'push!':
        var arr = _seval(n1, ctx);
        var val = _seval(n2, ctx);
        if (Array.isArray(arr)) arr.push(val);
        return arr;

      case 'remove-where!':
        // (remove-where! items :id val)
        var arr = _seval(n1, ctx);
        var key = _seval(n2, ctx);
        var val = _seval(n3, ctx);
        if (Array.isArray(arr)) {
          for (var i = arr.length - 1; i >= 0; i--) { if (arr[i][key] === val) arr.splice(i, 1); }
        }
        return arr;

      case 'splice!':
        var arr = _seval(n1, ctx);
        var idx = _seval(n2, ctx);
        var count = n3 != null ? _seval(n3, ctx) : 1;
        if (Array.isArray(arr)) arr.splice(idx, count);
        return arr;

      // Machine integration — these store intent on the scope for
      // the framework to pick up after evaluation completes.
      case 'to':
        var target = n1.t === 'Y' ? n1.v : String(_seval(n1, ctx));
        ctx.__mpTo = target;
        return target;

      case 'emit':
        var eName = n1.t === 'Y' ? n1.v : String(_seval(n1, ctx));
        ctx.__mpEmit = eName;
        return eName;

      // Event control — call from within mp-on: s-expressions
      case 'prevent!':
        if (ctx.__mpEvent) ctx.__mpEvent.preventDefault();
        else if (ctx.$event) ctx.$event.preventDefault();
        return null;

      case 'stop!':
        if (ctx.__mpEvent) ctx.__mpEvent.stopPropagation();
        else if (ctx.$event) ctx.$event.stopPropagation();
        return null;

      // (after ms state) — one-shot timer, then transition. Inside mp-transition.
      case 'after':
        var ms = _seval(n1, ctx);
        var st = n2.t === 'Y' ? n2.v : String(_seval(n2, ctx));
        if (ctx.__mpAfterTimer) ctx.__mpAfterTimer(ms, st);
        return null;

      // (every ms body) — repeating interval. Inside mp-transition.
      // Automatically cleared when the state is exited.
      case 'every':
        var ems = _seval(n1, ctx);
        if (ctx.__mpEveryInterval) ctx.__mpEveryInterval(ems, n2, ctx);
        return null;

      // (then! promise-expr :key 'success-state' 'error-state')
      // Evaluates the expression (which should return a Promise),
      // stores the resolved value at ctx[key], optionally transitions.
      // If the promise rejects and an error state is provided, transitions
      // there and stores the error at ctx[key]. Without an error state,
      // rejection is warned but the machine stays put.
      case 'then!':
        var promise = _seval(n1, ctx);
        var key = n2 ? _seval(n2, ctx) : null;
        var thenState = n3 ? _seval(n3, ctx) : null;
        var errorState = n4 ? _seval(n4, ctx) : null;
        var machineEl = ctx.$el;
        if (promise && typeof promise.then === 'function') {
          promise.then(function (result) {
            if (!machineEl || !machineEl._mp) return;
            if (key) machineEl._mp.ctx[key] = result;
            if (thenState) machineEl._mp.to(thenState);
            else machineEl._mp.update();
          }).catch(function (err) {
            if (!machineEl || !machineEl._mp) return;
            if (errorState) {
              if (key) machineEl._mp.ctx[key] = err;
              machineEl._mp.to(errorState);
            } else {
              console.warn('[mp] async error:', err);
            }
          });
        }
        return null;
    }

    // ── Standard library dispatch ──────────────────────────────────
    // Pre-evaluate all args, then dispatch to the stdlib table.

    var args = new Array(nLen);
    for (var i = 0; i < nLen; i++) args[i] = _seval(node[i + 1], ctx);

    if (_stdlib[fn]) return _stdlib[fn](args);

    // Try user-registered function (MachinePerfect.fn())
    if (_userFns[fn]) return _userFns[fn].apply(null, args);

    // Try calling a function from context
    var ctxFn = ctx[fn];
    if (typeof ctxFn === 'function') return ctxFn.apply(null, args);

    console.warn('[mp] unknown function: ' + fn);
    return null;
  }

  // ── Standard library ───────────────────────────────────────────────
  //
  // ~60 built-in functions organized by domain. Each receives the
  // pre-evaluated args array. This table is the complete vocabulary
  // of the s-expression language (excluding special forms above).

  var _stdlib = {
    // Math
    '+':   function (a) { return a.reduce(function (x, y) { return x + y; }, 0); },
    '-':   function (a) { return a.length === 1 ? -a[0] : a[0] - a[1]; },
    '*':   function (a) { return a.reduce(function (x, y) { return x * y; }, 1); },
    '/':   function (a) { return a[0] / a[1]; },
    'mod': function (a) { return a[0] % a[1]; },
    'inc': function (a) { return a[0] + 1; },
    'dec': function (a) { return a[0] - 1; },
    'abs': function (a) { return Math.abs(a[0]); },
    'min': function (a) { return Math.min.apply(null, a); },
    'max': function (a) { return Math.max.apply(null, a); },
    'round': function (a) { return Math.round(a[0]); },
    'floor': function (a) { return Math.floor(a[0]); },
    'ceil':  function (a) { return Math.ceil(a[0]); },

    // Comparison
    '=':  function (a) { return a[0] === a[1]; },
    '!=': function (a) { return a[0] !== a[1]; },
    '>':  function (a) { return a[0] > a[1]; },
    '<':  function (a) { return a[0] < a[1]; },
    '>=': function (a) { return a[0] >= a[1]; },
    '<=': function (a) { return a[0] <= a[1]; },

    // Logic
    'not':    function (a) { return !a[0]; },
    'nil?':   function (a) { return a[0] == null; },
    'some?':  function (a) { return a[0] != null; },
    'true?':  function (a) { return a[0] === true; },
    'false?': function (a) { return a[0] === false; },
    'empty?': function (a) { return !a[0] || (a[0].length != null && a[0].length === 0); },

    // Strings
    'str':       function (a) { return a.map(function (x) { return x == null ? '' : String(x); }).join(''); },
    'upper':     function (a) { return String(a[0] || '').toUpperCase(); },
    'lower':     function (a) { return String(a[0] || '').toLowerCase(); },
    'trim':      function (a) { return String(a[0] || '').trim(); },
    'split':     function (a) { return String(a[0] || '').split(a[1] || ''); },
    'join':      function (a) { return (a[0] || []).join(a[1] != null ? a[1] : ''); },
    'starts?':   function (a) { return String(a[0] || '').indexOf(a[1]) === 0; },
    'ends?':     function (a) { return String(a[0] || '').slice(-(a[1] || '').length) === a[1]; },
    'contains?': function (a) { return String(a[0] || '').indexOf(a[1]) !== -1; },
    'replace':   function (a) { return String(a[0] || '').split(a[1]).join(a[2] || ''); },
    'subs':      function (a) { return String(a[0] || '').substring(a[1], a[2]); },

    // Collections
    'count':     function (a) { return a[0] == null ? 0 : (a[0].length != null ? a[0].length : Object.keys(a[0]).length); },
    'first':     function (a) { return a[0] && a[0][0]; },
    'last':      function (a) { return a[0] && a[0][a[0].length - 1]; },
    'nth':       function (a) { return a[0] && a[0][a[1]]; },
    'rest':      function (a) { return a[0] ? a[0].slice(1) : []; },
    'take':      function (a) { return (a[1] || []).slice(0, a[0]); },
    'drop':      function (a) { return (a[1] || []).slice(a[0]); },
    'concat':    function (a) { return (a[0] || []).concat(a[1] || []); },
    'reverse':   function (a) { return (a[0] || []).slice().reverse(); },
    'sort':      function (a) { return (a[0] || []).slice().sort(a[1] || undefined); },
    'includes?': function (a) { return (a[0] || []).indexOf(a[1]) !== -1; },
    'index-of':  function (a) { return (a[0] || []).indexOf(a[1]); },
    'uniq':      function (a) { return a[0] ? a[0].filter(function (v, i, s) { return s.indexOf(v) === i; }) : []; },
    'range':     function (a) { var r = []; for (var i = a[0] || 0; i < a[1]; i += (a[2] || 1)) r.push(i); return r; },

    // Higher-order — Clojure argument order: (fn collection)
    'map':     function (a) { return (a[1] || []).map(a[0]); },
    'filter':  function (a) { return (a[1] || []).filter(a[0]); },
    'find':    function (a) { return (a[1] || []).find(a[0]); },
    'every?':  function (a) { return (a[1] || []).every(a[0]); },
    'some':    function (a) { return (a[1] || []).some(a[0]); },
    'reduce':  function (a) { return (a[2] || []).reduce(a[0], a[1]); },
    'flat-map': function (a) { return (a[1] || []).reduce(function (r, x) { return r.concat(a[0](x)); }, []); },
    'sort-by': function (a) { return (a[1] || []).slice().sort(function (x, y) { var fx = a[0](x), fy = a[0](y); return fx < fy ? -1 : fx > fy ? 1 : 0; }); },

    // Objects
    'obj':    function (a) { var o = {}; for (var i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1]; return o; },
    'get':    function (a) { return a[0] != null ? a[0][a[1]] : null; },
    'keys':   function (a) { return a[0] ? Object.keys(a[0]) : []; },
    'vals':   function (a) { return a[0] ? Object.keys(a[0]).map(function (k) { return a[0][k]; }) : []; },
    'assoc':  function (a) { var o = {}; for (var k in a[0]) o[k] = a[0][k]; o[a[1]] = a[2]; return o; },
    'assoc!': function (a) { if (a[0]) a[0][a[1]] = a[2]; return a[0]; },
    'dissoc': function (a) { var o = {}; for (var k in a[0]) { if (k !== a[1]) o[k] = a[0][k]; } return o; },
    'merge':  function (a) { var o = {}; for (var i = 0; i < a.length; i++) { if (a[i]) for (var k in a[i]) o[k] = a[i][k]; } return o; },

    // Type
    'type':  function (a) { return a[0] === null ? 'nil' : Array.isArray(a[0]) ? 'list' : typeof a[0]; },
    'num':   function (a) { return Number(a[0]); },
    'int':   function (a) { return parseInt(a[0], a[1] || 10); },
    'float': function (a) { return parseFloat(a[0]); },
    'bool':  function (a) { return !!a[0]; },

    // Date/time
    'now':       function () { return Date.now(); },
    'timestamp': function (a) { return new Date(a[0]).getTime(); },

    // Console
    'log':  function (a) { console.log.apply(console, a); return a[0]; },
    'warn': function (a) { console.warn.apply(console, a); return a[0]; }
  };

  // User-registered functions — the JS escape hatch.
  var _userFns = {};

  // Debug mode — set MachinePerfect.debug = true for verbose diagnostics.
  // Reports: missing context variables, unknown functions, state transitions,
  // expression evaluation errors. Off by default for production performance.
  var _debug = false;

  // Built-in functions as first-class values.
  // In Clojure, (reduce + 0 items) works because + is a value.
  // These let built-in names resolve as functions when used as arguments.
  // Note: 2-arity so they work correctly with Array.reduce/map/filter
  // which pass (acc, val, index, array). Direct calls (+ 1 2 3) use
  // the variadic switch case instead.
  var _firstClass = {
    '+':   function (a, b) { return a + b; },
    '-':   function (a, b) { return a - b; },
    '*':   function (a, b) { return a * b; },
    '/':   function (a, b) { return a / b; },
    'inc': function (x) { return x + 1; },
    'dec': function (x) { return x - 1; },
    'not': function (x) { return !x; },
    'str': function () { return Array.prototype.slice.call(arguments).map(function (x) { return x == null ? '' : String(x); }).join(''); },
    'count': function (x) { return x == null ? 0 : x.length != null ? x.length : Object.keys(x).length; },
    'get': function (o, k) { return o != null ? o[k] : null; },
    'upper': function (s) { return String(s || '').toUpperCase(); },
    'lower': function (s) { return String(s || '').toLowerCase(); },
    'trim': function (s) { return String(s || '').trim(); },
    'max': function (a, b) { return Math.max(a, b); },
    'min': function (a, b) { return Math.min(a, b); }
  };


  // ── Expression interface ────────────────────────────────────────────
  //
  // _eval: READ — evaluate an expression and return the result.
  // _exec: WRITE — evaluate for side effects, copy mutations back to ctx.
  //
  // Both accept raw attribute strings. Both use the cached parser.
  // _eval is used in bindings (mp-text, mp-show, mp-guard, mp-bind-*).
  // _exec is used in actions (mp-init, mp-action).

  function _makeScope(ctx, state, el, event) {
    var scope = Object.create(ctx);
    scope.$state = state;
    scope.$el = el;
    scope.$event = event || null;
    return scope;
  }

  // Pure evaluator — wraps _seval but throws on mutation forms.
  // Bindings must never change state; this enforces it structurally.
  var _mutationForms = { 'set!':1, 'inc!':1, 'dec!':1, 'toggle!':1, 'push!':1,
                         'remove-where!':1, 'splice!':1, 'assoc!':1 };

  function _sevalPure(node, ctx) {
    if (Array.isArray(node) && node.length > 0 && node[0] && node[0].t === 'Y') {
      if (_mutationForms[node[0].v]) {
        throw new Error('[mp] mutation "' + node[0].v + '" is not allowed in bindings (mp-text, mp-show, mp-class, mp-bind-*). Use mp-action or mp-on: instead.');
      }
      // Check nested expressions (e.g. (do (set! x 1) x) — the set! is inside a do)
      for (var i = 1; i < node.length; i++) {
        if (Array.isArray(node[i])) _sevalPure(node[i], ctx);
      }
    }
    return _seval(node, ctx);
  }

  // _eval: pure read path for bindings. Throws on mutations.
  function _eval(expr, ctx, state, el) {
    if (!expr) return undefined;
    var str = expr.trim();
    if (!str) return undefined;
    // S-expression — pure evaluation (no ! mutations allowed)
    if (str.charAt(0) === '(') return _sevalPure(_parse(str), _makeScope(ctx, state, el));
    // Bare atom — symbol lookup
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (str === 'nil') return null;
    if (str === '$state') return state;
    if (str.charAt(0) === "'" && str.charAt(str.length - 1) === "'") return str.slice(1, -1);
    if (!isNaN(Number(str)) && str !== '') return Number(str);
    if (str.indexOf('.') !== -1) {
      if (_trackingDeps) _trackedDeps[_depKey(str)] = true;
      return _get(ctx, str);
    }
    if (_trackingDeps) _trackedDeps[str] = true;
    return ctx[str];
  }

  function _exec(expr, ctx, state, el, event, inst) {
    if (!expr) return;
    var str = expr.trim();
    if (!str) return;
    var scope = _makeScope(ctx, state, el, event);
    // Make inst available to set! for dotted-path dirty tracking
    if (inst) scope.__mpInst = inst;
    _seval(_parse(str), scope);
    _applyScope(scope, ctx, inst);
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Dependency tracking                                                    ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Runtime read/write tracking through the s-expression evaluator.
  //
  // READ tracking: during binding cache build, _seval records which context
  // keys each binding expression accesses. Stored as deps on the binding.
  //
  // WRITE tracking: when s-expressions mutate context (set!, inc!, etc.),
  // the mutated keys are recorded as dirty on the machine instance. On
  // update(), only bindings whose deps overlap with dirty keys are evaluated.
  //
  // No Proxies. No compiler. We are the runtime — every data access and
  // every mutation flows through _seval, so we see everything.

  var _trackingDeps = false;
  var _trackedDeps = null;

  // Normalize a symbol name to a dependency key.
  // Simple names: 'temp' → 'temp'
  // $store paths: '$store.filters.country' → '$store.filters' (two segments)
  // Other dotted: 'user.name' → 'user' (root segment)
  function _depKey(name) {
    if (name.charAt(0) === '$' && name.indexOf('$store.') === 0) {
      var rest = name.substring(7);
      var dot = rest.indexOf('.');
      return dot === -1 ? name : '$store.' + rest.substring(0, dot);
    }
    var dot = name.indexOf('.');
    return dot === -1 ? name : name.substring(0, dot);
  }

  // Copy own scope mutations to target ctx, recording dirty keys on inst.
  // Replaces all the manual copy-back loops throughout the framework.
  function _applyScope(scope, target, inst) {
    for (var k in scope) {
      if (scope.hasOwnProperty(k) && k.charAt(0) !== '$' && k.charAt(0) !== '_') {
        target[k] = scope[k];
        if (inst) { if (!inst._mpDirty) inst._mpDirty = {}; inst._mpDirty[_depKey(k)] = true; }
      }
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Utilities                                                              ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  // Path get/set for mp-model (e.g. "user.name" → ctx.user.name)
  function _get(obj, path) {
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (obj == null) return undefined;
      obj = obj[parts[i]];
    }
    return obj;
  }

  var _unsafePaths = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };

  function _set(obj, path, val) {
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (_unsafePaths[parts[i]]) return; // defense against prototype pollution
    }
    for (var i = 0; i < parts.length - 1; i++) {
      if (obj[parts[i]] == null) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = val;
  }

  // Query elements belonging to this machine (not nested child machines).
  // Rule: element belongs to its closest [mp] ancestor.
  function _own(machineEl, selector) {
    var all = machineEl.querySelectorAll(selector);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].closest('[mp]') === machineEl) out.push(all[i]);
    }
    return out;
  }

  // Build a merged scope for an mp-each item.
  // Uses prototype chain — item properties shadow machine context without copying.
  function _itemCtx(machineCtx, item, index) {
    var scope = Object.create(machineCtx);
    if (item && typeof item === 'object') {
      for (var k in item) if (item.hasOwnProperty(k)) scope[k] = item[k];
    }
    scope.$item = item;
    scope.$index = index;
    return scope;
  }

  // Build $refs map from mp-ref elements owned by this machine.
  function _buildRefs(machineEl) {
    var refs = {};
    var refEls = _own(machineEl, '[mp-ref]');
    for (var i = 0; i < refEls.length; i++) refs[refEls[i].getAttribute('mp-ref')] = refEls[i];
    return refs;
  }

  // Safe querySelectorAll — returns [] for text nodes that lack the method.
  function _querySafe(el, selector) {
    return el.querySelectorAll ? el.querySelectorAll(selector) : [];
  }

  // Walk up from el to find the closest mp-each item scope.
  // Returns the item scope if found, otherwise the machine's context.
  function _scopeFor(el, machineEl, ctx) {
    var cur = el;
    while (cur && cur !== machineEl) {
      if (cur._mpItemScope) return cur._mpItemScope;
      cur = cur.parentElement;
    }
    return ctx;
  }

  // Boolean HTML attributes — these are set/removed rather than assigned a value.
  var _boolAttrs = ['disabled','readonly','required','checked','selected','multiple',
                    'open','hidden','autofocus','autoplay','controls','loop','muted',
                    'novalidate','formnovalidate','reversed'];


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Inter-machine events                                                   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // mp-emit dispatches named events. mp-receive listens.
  //
  // Emit:    <button mp-emit="saved">Save</button>
  // Receive: <div mp="toast" mp-receive="(on 'saved' (to show))">
  //
  // The receive attribute contains s-expressions using (on 'name' body).
  // Multiple (on) forms can be in one attribute. $detail is the emitter's ctx.
  //
  // (on) is a special form registered as an event listener at init time.
  // It does NOT run during normal expression evaluation.

  var _events = {};

  function _regReceive(inst) {
    var raw = inst.el.getAttribute('mp-receive');
    if (!raw) return;

    // Parse the mp-receive value. Multiple (on ...) forms are wrapped in implicit (do).
    var parsed = _parse(raw.trim());
    // Extract individual (on ...) forms
    var ons = [];
    if (Array.isArray(parsed) && parsed[0] && parsed[0].t === 'Y' && parsed[0].v === 'on') {
      ons.push(parsed);
    } else if (Array.isArray(parsed) && parsed[0] && parsed[0].t === 'Y' && parsed[0].v === 'do') {
      for (var i = 1; i < parsed.length; i++) {
        if (Array.isArray(parsed[i]) && parsed[i][0] && parsed[i][0].t === 'Y' && parsed[i][0].v === 'on') {
          ons.push(parsed[i]);
        }
      }
    }

    for (var i = 0; i < ons.length; i++) {
      var onForm = ons[i];
      // (on 'eventName' body)
      var evName = onForm[1].t === 'S' ? onForm[1].v : (onForm[1].t === 'Y' ? onForm[1].v : String(_seval(onForm[1], {})));
      var body = onForm[2];

      (function (name, bodyExpr, machine) {
        if (!_events[name]) {
          _events[name] = [];
          var handler = function (e) {
            var list = _events[name];
            for (var j = 0; j < list.length; j++) {
              var entry = list[j];
              if (entry.inst.el === e.detail.source) continue;

              var scope = _makeScope(entry.inst.ctx, entry.inst.state, entry.inst.el);
              scope.$detail = e.detail.ctx;
              scope.__mpInst = entry.inst;
              _seval(entry.body, scope);
              _applyScope(scope, entry.inst.ctx, entry.inst);
              if (scope.__mpTo) {
                var target = scope.__mpTo === '.' ? entry.inst.state : scope.__mpTo;
                entry.inst.to(target);
              } else {
                entry.inst.update();
              }
              if (scope.__mpEmit) entry.inst.emit(scope.__mpEmit);
            }
          };
          document.addEventListener('mp:' + name, handler);
          _events[name]._handler = handler; // stored for cleanup
        }
        _events[name].push({ inst: machine, body: bodyExpr });
      })(evName, body, inst);
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  DOM event binding (mp-on:event)                                        ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Attach DOM event listeners declared with mp-on:EVENT.MODIFIERS="state".
  // Called during machine init and after mp-each cloning.

  function _attachDomEvents(container, inst) {
    var all = container.querySelectorAll('*');
    var check = function (el) {
      if (el._mpEventsBound) return;
      if (el.closest('[mp]') !== inst.el) return;
      var attrs = el.attributes;
      for (var i = 0; i < attrs.length; i++) {
        if (attrs[i].name.indexOf('mp-on:') === 0) {
          _bindOneEvent(el, attrs[i].name.slice(6), attrs[i].value, inst);
        }
      }
      el._mpEventsBound = true;
    };
    for (var i = 0; i < all.length; i++) check(all[i]);
    check(container);
  }

  function _bindOneEvent(el, raw, targetState, inst) {
    var parts = raw.split('.');
    var evName = parts[0];
    var mods = parts.slice(1);
    var isOutside = mods.indexOf('outside') !== -1;

    var handler = function (e) {
      if (mods.indexOf('self') !== -1 && e.target !== el) return;
      if (isOutside && el.contains(e.target)) return;

      // Build scope with $event
      var itemScope = _scopeFor(el, inst.el, inst.ctx);
      var scope = Object.create(itemScope);
      scope.$event = e;

      if (targetState.charAt(0) === '(') {
        // ── S-expression mode ────────────────────────────────────────
        // The entire handler is ONE s-expression. No separate guard/action.
        // (when), (if), etc. naturally filter. (to), (emit), (prevent!),
        // (stop!) signal intent.
        //
        //   mp-on:keydown="(when (= (get $event :key) 'Escape') (to closed))"
        //   mp-on:keydown="(when (and (get $event :ctrlKey) (= (get $event :key) 'k'))
        //                    (do (prevent!) (emit open-palette)))"
        //
        scope.__mpEvent = e;
        scope.__mpInst = inst;
        _seval(_parse(targetState), scope);
        _applyScope(scope, inst.ctx, inst);
        // Handle (to state) signal
        if (scope.__mpTo) {
          var target = scope.__mpTo === '.' ? inst.state : scope.__mpTo;
          inst.to(target);
        } else {
          inst.update();
        }
        // Handle (emit name) signal
        if (scope.__mpEmit) inst.emit(scope.__mpEmit);

      } else {
        // ── Bare state name mode (backward compatible) ───────────────
        var guard = el.getAttribute('mp-guard');
        if (guard && !_eval(guard, scope, inst.state, el)) return;
        if (mods.indexOf('prevent') !== -1) e.preventDefault();
        if (mods.indexOf('stop') !== -1) e.stopPropagation();

        var action = el.getAttribute('mp-action');
        if (action) {
          var merged = Object.create(inst.ctx);
          for (var k in scope) { if (scope.hasOwnProperty(k)) merged[k] = scope[k]; }
          _exec(action, merged, inst.state, el, e);
          _applyScope(merged, inst.ctx, inst);
        }

        var emit = el.getAttribute('mp-emit');
        if (emit) inst.emit(emit);

        var target = targetState || '.';
        if (target === '.') target = inst.state;
        inst.to(target);
      }
    };

    var target = isOutside ? document : el;
    var opts = mods.indexOf('once') !== -1 ? { once: true } : false;
    target.addEventListener(evName, handler, opts);
    // Track document-level listeners for cleanup when the machine is destroyed
    if (isOutside) {
      if (!inst.el._mpCleanups) inst.el._mpCleanups = [];
      inst.el._mpCleanups.push(function () { document.removeEventListener(evName, handler); });
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Attribute binding setup (mp-bind-*)                                    ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Scans elements for mp-bind-ATTR attributes and caches the bindings
  // on the element for fast processing during update().

  function _scanBindAttrs(container, machineEl) {
    var all = container.querySelectorAll('*');
    var process = function (el) {
      if (el.closest('[mp]') !== machineEl) return;
      var attrs = el.attributes;
      for (var i = 0; i < attrs.length; i++) {
        if (attrs[i].name.indexOf('mp-bind-') === 0) {
          if (!el._mpBindAttrs) el._mpBindAttrs = [];
          el._mpBindAttrs.push({ attr: attrs[i].name.slice(8), expr: attrs[i].value });
        }
      }
      // Mark for the combined querySelectorAll in update()
      if (el._mpBindAttrs) el.setAttribute('mp-bound', '');
    };
    for (var i = 0; i < all.length; i++) process(all[i]);
    process(container);
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  CSS transition engine (mp-transition)                                  ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // When a state element has the mp-transition attribute, entering and leaving
  // are animated via CSS classes instead of instant show/hide.
  //
  // Enter sequence (state becomes active):
  //   Frame 0: add mp-enter-from, mp-enter-active. Remove hidden.
  //   Frame 1: remove mp-enter-from, add mp-enter-to.
  //   After transition ends: remove mp-enter-active, mp-enter-to.
  //
  // Leave sequence (state becomes inactive):
  //   Frame 0: add mp-leave-from, mp-leave-active.
  //   Frame 1: remove mp-leave-from, add mp-leave-to.
  //   After transition ends: remove mp-leave-active, mp-leave-to. Set hidden.
  //
  // Usage with CSS:
  //   .mp-enter-active, .mp-leave-active { transition: all 0.2s ease; }
  //   .mp-enter-from, .mp-leave-to { opacity: 0; transform: scale(0.95); }

  function _transitionEnter(el) {
    el._mpLeaving = false; // cancel any pending leave
    // Clean up any in-progress leave transition classes
    el.classList.remove('mp-leave-from', 'mp-leave-active', 'mp-leave-to');
    el.hidden = false;
    el.classList.add('mp-enter-from', 'mp-enter-active');
    // Force reflow so the browser sees the from-state before transitioning
    el.offsetHeight; // eslint-disable-line no-unused-expressions
    requestAnimationFrame(function () {
      el.classList.remove('mp-enter-from');
      el.classList.add('mp-enter-to');
      _onTransitionEnd(el, function () {
        el.classList.remove('mp-enter-active', 'mp-enter-to');
      });
    });
  }

  function _transitionLeave(el, cb) {
    el._mpLeaving = true;
    // Clean up any in-progress enter transition classes
    el.classList.remove('mp-enter-from', 'mp-enter-active', 'mp-enter-to');
    el.classList.add('mp-leave-from', 'mp-leave-active');
    el.offsetHeight; // eslint-disable-line no-unused-expressions
    requestAnimationFrame(function () {
      el.classList.remove('mp-leave-from');
      el.classList.add('mp-leave-to');
      _onTransitionEnd(el, function () {
        el.classList.remove('mp-leave-active', 'mp-leave-to');
        // Only hide if still leaving (not re-entered)
        if (el._mpLeaving) {
          el.hidden = true;
          el._mpLeaving = false;
        }
        if (cb) cb();
      });
    });
  }

  function _onTransitionEnd(el, cb) {
    // Get computed transition duration. If none, fire immediately.
    var style = getComputedStyle(el);
    var dur = parseFloat(style.transitionDuration) || 0;
    var animDur = parseFloat(style.animationDuration) || 0;
    var total = Math.max(dur, animDur);
    if (total === 0) {
      cb();
    } else {
      // Use timeout as fallback (transitionend can be unreliable)
      setTimeout(cb, total * 1000 + 50);
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  mp-each: list rendering                                                ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // <template mp-each="items" mp-key="id">
  //   <div><span mp-text="name"></span></div>
  // </template>
  //
  // Renders template content for each item in the array. If mp-key is set,
  // uses keyed reconciliation (add/remove only, preserves existing DOM and
  // machine state). Without mp-key, does full re-render each update.
  //
  // Inside the template, $item is the current item, $index is the index,
  // and if the item is an object its properties are directly accessible.

  // Compare old ctx values with new item data. Copy only changed
  // properties, record dirty keys, call update only if something changed.
  // Used by keyed reconciliation to skip unchanged child machines entirely.
  function _diffChild(mpInst, item) {
    var dirty = null;
    for (var k in item) {
      if (item.hasOwnProperty(k) && k.charAt(0) !== '$') {
        if (mpInst.ctx[k] !== item[k]) {
          mpInst.ctx[k] = item[k];
          if (!dirty) dirty = {};
          dirty[k] = true;
        }
      }
    }
    if (dirty) { mpInst._mpDirty = dirty; mpInst.update(); }
  }

  function _updateEach(machineEl, inst) {
    var tmpls = _own(machineEl, 'template[mp-each]');
    for (var t = 0; t < tmpls.length; t++) {
      var tmpl = tmpls[t];
      var expr = tmpl.getAttribute('mp-each');
      var keyExpr = tmpl.getAttribute('mp-key');
      var items = _eval(expr, inst.ctx, inst.state, tmpl);
      if (!Array.isArray(items)) items = [];

      // Initialize tracking structures
      if (!tmpl._mpMarker) {
        tmpl._mpMarker = document.createComment('mp-each-end');
        tmpl.parentNode.insertBefore(tmpl._mpMarker, tmpl.nextSibling);
        tmpl._mpRendered = [];    // rendered root elements (ordered)
        tmpl._mpKeyMap = {};    // key → element map (keyed mode only)
      }
      var marker = tmpl._mpMarker;
      var rendered = tmpl._mpRendered;
      var parent = tmpl.parentNode;

      if (keyExpr) {
        // ── Keyed reconciliation ─────────────────────────────────────
        var newKeys = [];
        var newMap = {};
        for (var i = 0; i < items.length; i++) {
          var scope = _itemCtx(inst.ctx, items[i], i);
          var key = String(_eval(keyExpr, scope, inst.state, tmpl));
          newKeys.push(key);
          newMap[key] = { item: items[i], index: i, scope: scope };
        }

        // Remove elements for deleted keys
        var oldKeyMap = tmpl._mpKeyMap;
        for (var k in oldKeyMap) {
          if (!newMap[k]) {
            oldKeyMap[k].remove();
            delete oldKeyMap[k];
            inst._mpBindCache = null; // DOM changed
          }
        }

        // Add/reorder — cursor tracks expected DOM position.
        // Only calls insertBefore when an element is actually out of order,
        // avoiding unnecessary DOM mutations and MutationObserver churn.
        var cursor = tmpl.nextSibling;
        while (cursor && cursor !== marker && cursor.nodeType !== 1) cursor = cursor.nextSibling;
        var domChanged = false;

        for (var i = 0; i < newKeys.length; i++) {
          var key = newKeys[i];
          var el;
          if (oldKeyMap[key]) {
            // ── Existing item: diff and update ──
            el = oldKeyMap[key];
            el._mpItemScope = newMap[key].scope;
            // perf: only call update on child machines whose data actually changed
            var uItem = items[i];
            if (uItem && typeof uItem === 'object') {
              if (el._mp) _diffChild(el._mp, uItem);
              var uNested = _querySafe(el, '[mp]');
              for (var ni = 0; ni < uNested.length; ni++) {
                if (uNested[ni]._mp) _diffChild(uNested[ni]._mp, uItem);
              }
            }
            // perf: skip insertBefore when already in position (avoids MutationObserver churn)
            if (el !== cursor) {
              parent.insertBefore(el, cursor || marker);
            } else {
              cursor = el.nextSibling;
              while (cursor && cursor !== marker && cursor.nodeType !== 1) cursor = cursor.nextSibling;
            }
          } else {
            // ── New item: clone, stamp context, initialize ──
            var frag = tmpl.content.cloneNode(true);
            el = frag.firstElementChild;
            if (!el) { el = frag.firstChild; }
            el._mpItemScope = newMap[key].scope;
            // Nested [mp] elements need mp-ctx so _createInstance reads their initial data
            var kItemJson = JSON.stringify(items[i]);
            if (el.hasAttribute && el.hasAttribute('mp')) {
              el.setAttribute('mp-ctx', kItemJson);
            }
            var kNested = _querySafe(el, '[mp]');
            for (var ni = 0; ni < kNested.length; ni++) {
              kNested[ni].setAttribute('mp-ctx', kItemJson);
            }
            parent.insertBefore(frag, cursor || marker);
            oldKeyMap[key] = el;
            domChanged = true;
            _scanBindAttrs(el, machineEl);
            _attachDomEvents(el, inst);
            _initNested(el);
          }
        }

        // Invalidate parent's binding cache if DOM structure changed
        if (domChanged) inst._mpBindCache = null;

        tmpl._mpKeyMap = oldKeyMap;
        tmpl._mpRendered = newKeys.map(function (k) { return oldKeyMap[k]; });

      } else {
        // ── Non-keyed: full re-render ────────────────────────────────
        // Remove old
        for (var i = 0; i < rendered.length; i++) {
          rendered[i].remove();
        }
        rendered.length = 0;
        inst._mpBindCache = null; // DOM changed

        // Create new
        for (var i = 0; i < items.length; i++) {
          var frag = tmpl.content.cloneNode(true);
          var el = frag.firstElementChild;
          if (!el) el = frag.firstChild;
          el._mpItemScope = _itemCtx(inst.ctx, items[i], i);
          // Set mp-ctx on ALL [mp] elements in the item (root + nested)
          var itemJson = JSON.stringify(items[i]);
          if (el.hasAttribute && el.hasAttribute('mp')) {
            el.setAttribute('mp-ctx', itemJson);
          }
          var nestedMp = _querySafe(el, '[mp]');
          for (var ni = 0; ni < nestedMp.length; ni++) {
            nestedMp[ni].setAttribute('mp-ctx', itemJson);
          }
          parent.insertBefore(frag, marker);
          rendered.push(el);
          _scanBindAttrs(el, machineEl);
          _attachDomEvents(el, inst);
          _initNested(el);
        }
      }
    }
  }

  // Initialize any [mp] elements within a container
  function _initNested(container) {
    if (container.hasAttribute && container.hasAttribute('mp') && !container._mp) {
      _createInstance(container);
    }
    var nested = _querySafe(container, '[mp]');
    for (var i = 0; i < nested.length; i++) {
      if (!nested[i]._mp) _createInstance(nested[i]);
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Machine instance                                                       ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // A machine instance is created for each [mp] element. It holds the
  // current state, context data, and methods to transition and update.
  // Templates, stores, and imports are module-level registries shared
  // across all instances.

  var _templates = {};

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  mp-store — Global shared state                                         ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // <mp-store name="user" value='{"name":"Andrew","role":"geologist"}'></mp-store>
  //
  // Accessible in ANY machine as $store.user.name. Shared by reference —
  // when one machine writes $store.user.name = 'New', all machines see it
  // on their next update. Use mp-emit to notify other machines to re-render.

  var _store = {};

  function _processStores(root) {
    var els = root.querySelectorAll('mp-store');
    for (var i = 0; i < els.length; i++) {
      var name = els[i].getAttribute('name');
      var val = els[i].getAttribute('value');
      if (name) {
        try { _store[name] = val ? JSON.parse(val) : {}; }
        catch (err) { console.warn('[mp] malformed mp-store "' + name + '":', err.message); _store[name] = {}; }
      }
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  mp-import — Markup module system                                       ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // <link rel="mp-import" href="/components/note-card.mp.html">
  //
  // Fetches .mp.html files, parses them, and registers any <template mp-define>
  // blocks they contain. This is the module/import system for markup — files
  // become modules, templates become exports. No bundler, no import statements,
  // no build step.
  //
  // All imports are fetched in parallel and must complete before machines
  // are initialized (templates need to exist before they're cloned).
  //
  // .mp.html files can contain:
  //   - <template mp-define="name"> blocks (component definitions)
  //   - <mp-store> elements (shared state declarations)
  //   - <style> blocks (component styles)

  function _loadImports(root) {
    root = root || document;
    var links = root.querySelectorAll('link[rel="mp-import"]');
    if (links.length === 0) return Promise.resolve();

    // Try XMLHttpRequest first (works from file:// in most browsers),
    // fall back to fetch (works on http/https).
    function loadFile(href) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', href, true);
        xhr.onload = function () {
          if (xhr.status === 0 || xhr.status === 200) resolve(xhr.responseText);
          else reject(new Error('[mp] import failed: ' + href + ' (' + xhr.status + ')'));
        };
        xhr.onerror = function () {
          reject(new Error('[mp] import failed: ' + href));
        };
        xhr.send();
      });
    }

    var fetches = [];
    for (var i = 0; i < links.length; i++) {
      (function (href) {
        fetches.push(loadFile(href).catch(function (err) {
          // Fail gracefully — warn but don't crash the app.
          // Templates from this import won't be available, but
          // inline templates and other imports still work.
          console.warn('[mp] import skipped:', href, '— use a server for mp-import, or inline templates with <template mp-define>');
          return null;
        }));
      })(links[i].getAttribute('href'));
    }

    return Promise.all(fetches).then(function (texts) {
      for (var i = 0; i < texts.length; i++) {
        if (!texts[i]) continue; // skipped import (failed gracefully)
        var doc = new DOMParser().parseFromString(texts[i], 'text/html');
        // Register templates
        var tmpls = doc.querySelectorAll('template[mp-define]');
        for (var j = 0; j < tmpls.length; j++) {
          // Import the template into the current document so it can be cloned
          var imported = document.importNode(tmpls[j], true);
          _templates[imported.getAttribute('mp-define')] = imported;
        }
        // Register stores
        _processStores(doc);
        // Inject styles
        var styles = doc.querySelectorAll('style');
        for (var j = 0; j < styles.length; j++) {
          document.head.appendChild(styles[j].cloneNode(true));
        }
      }
    });
  }


  // ── Template resolution with slot injection ─────────────────────────
  //
  // If a <template mp-define="name"> exists for a machine, clone it into
  // the machine element. Before cloning, save the element's children as
  // slot content. Named slots match by attribute, unnamed slots get the rest.

  function _resolveTemplate(el, name) {
    // Only warn if the machine has no inline states AND no matching template
    if (!_templates[name] && name && !el.querySelector('[mp-state]')) {
      console.warn('[mp] no template for "' + name + '". Available:', Object.keys(_templates).join(', '));
    }
    if (!_templates[name] || el.querySelector('[mp-state]')) return;

    // Save slot content before template replaces children
    var slotContent = {};
    var defaultSlot = [];
    var origChildren = [];
    while (el.firstChild) {
      origChildren.push(el.removeChild(el.firstChild));
    }
    for (var i = 0; i < origChildren.length; i++) {
      var child = origChildren[i];
      if (child.nodeType === 1 && child.hasAttribute('slot')) {
        slotContent[child.getAttribute('slot')] = child;
      } else if (child.nodeType === 1 || (child.nodeType === 3 && child.textContent.trim())) {
        defaultSlot.push(child);
      }
    }

    // Clone template content into the element
    el.appendChild(_templates[name].content.cloneNode(true));

    // Replace <mp-slot> placeholders with provided content (or unwrap defaults)
    var slots = el.querySelectorAll('mp-slot');
    for (var i = 0; i < slots.length; i++) {
      var slotName = slots[i].getAttribute('name');
      if (slotName && slotContent[slotName]) {
        slots[i].replaceWith(slotContent[slotName]);
      } else if (!slotName && defaultSlot.length > 0) {
        var frag = document.createDocumentFragment();
        for (var j = 0; j < defaultSlot.length; j++) frag.appendChild(defaultSlot[j]);
        slots[i].replaceWith(frag);
      } else {
        var frag = document.createDocumentFragment();
        while (slots[i].firstChild) frag.appendChild(slots[i].firstChild);
        slots[i].replaceWith(frag);
      }
    }
  }


  // ── Client-side routing ─────────────────────────────────────────────────
  //
  // <div mp="app" mp-route>
  //   <div mp-state="home" mp-path="/">Home</div>
  //   <div mp-state="settings" mp-path="/settings">Settings</div>
  // </div>
  //
  // Uses the History API (pushState) for clean URLs.
  // On init: reads location.pathname, routes to matching mp-path state.
  // On transition: updates the URL via pushState.
  // On back/forward: transitions to matching state.

  function _setupRoute(el, inst, stateMap, stateTmpls, initial) {
    if (!el.hasAttribute('mp-route')) return;

    var currentPath = location.pathname || '/';
    for (var sn in stateMap) {
      if (stateMap[sn].getAttribute('mp-path') === currentPath && sn !== initial) {
        if (initial && stateMap[initial]) {
          stateMap[initial].innerHTML = '';
          stateMap[initial].hidden = true;
        }
        inst.state = sn;
        stateMap[sn].appendChild(stateTmpls[sn].content.cloneNode(true));
        stateMap[sn].hidden = false;
        _scanBindAttrs(stateMap[sn], el);
        _attachDomEvents(stateMap[sn], inst);
        _initNested(stateMap[sn]);
        inst.update();
        break;
      }
    }

    var _origTo = inst.to;
    inst.to = function (target) {
      var result = _origTo(target);
      if (result && stateMap[target]) {
        var path = stateMap[target].getAttribute('mp-path');
        if (path && location.pathname !== path) {
          try { history.pushState(null, '', path); } catch (e) { /* file:// protocol */ }
        }
      }
      return result;
    };

    var popHandler = function () {
      var path = location.pathname || '/';
      for (var sn in stateMap) {
        if (stateMap[sn].getAttribute('mp-path') === path && inst.state !== sn) {
          _origTo(sn);
          break;
        }
      }
    };
    window.addEventListener('popstate', popHandler);
    if (!el._mpCleanups) el._mpCleanups = [];
    el._mpCleanups.push(function () { window.removeEventListener('popstate', popHandler); });
  }


  // ── Machine setup ───────────────────────────────────────────────────
  //
  // Parse context, restore persistence, discover states, save content
  // as lazy-rendering templates, stamp the initial state.

  function _initMachine(el, name) {
    _resolveTemplate(el, name);

    // Context from mp-ctx attribute, with mp-persist overlay
    var ctxAttr = el.getAttribute('mp-ctx');
    var ctx = {};
    if (ctxAttr) {
      try { ctx = JSON.parse(ctxAttr); }
      catch (err) { console.warn('[mp] malformed mp-ctx on "' + name + '":', err.message); }
    }
    var persistKey = el.getAttribute('mp-persist');
    if (persistKey) {
      try {
        var saved = JSON.parse(localStorage.getItem('mp:' + persistKey) || '{}');
        for (var k in saved) if (saved.hasOwnProperty(k)) ctx[k] = saved[k];
      } catch (e) { /* ignore corrupt localStorage */ }
    }
    ctx.$store = _store;
    ctx.$refs = _buildRefs(el);

    // Discover states: save each state's content as a template for lazy rendering
    var stateEls = _own(el, '[mp-state]');
    var stateMap = {};
    var stateNames = [];
    var stateTmpls = {};
    for (var i = 0; i < stateEls.length; i++) {
      var sn = stateEls[i].getAttribute('mp-state');
      stateMap[sn] = stateEls[i];
      stateNames.push(sn);
      var tmpl = document.createElement('template');
      while (stateEls[i].firstChild) tmpl.content.appendChild(stateEls[i].firstChild);
      stateTmpls[sn] = tmpl;
      stateEls[i].hidden = true;
    }

    var initial = el.getAttribute('mp-initial') || stateNames[0] || null;
    if (initial && stateTmpls[initial]) {
      stateMap[initial].appendChild(stateTmpls[initial].content.cloneNode(true));
      stateMap[initial].hidden = false;
    }

    return { ctx: ctx, persistKey: persistKey, stateMap: stateMap, stateNames: stateNames, stateTmpls: stateTmpls, initial: initial };
  }


  // ── Binding application ───────────────────────────────────────────────
  //
  // The body of inst.update(). Extracted so _createInstance stays under
  // 150 lines. Runs mp-each, builds/uses the binding cache with
  // dependency tracking, applies all binding types, persists to localStorage.

  function _applyBindings(machineEl, inst, persistKey) {
    var state = inst.state;
    var ctx = inst.ctx;
    var dirty = inst._mpDirty;
    inst._mpDirty = null;

    // ── Phase 1: List rendering (may create new DOM) ─────────
    _updateEach(machineEl, inst);

    // ── Phase 2: Build or refresh binding cache ─────────────
    // First render (or after DOM structure change): scan for bound
    // elements, evaluate each binding once to discover its deps.
    // perf: subsequent renders skip this entirely.
    if (!inst._mpBindCache) {
      var all = machineEl.querySelectorAll('[mp-text],[mp-model],[mp-show],[mp-hide],[mp-class],[mp-bound]');
      inst._mpBindCache = [];
      for (var i = 0; i < all.length; i++) {
        var elem = all[i];
        if (elem.closest('[mp]') !== machineEl) continue;
        // Build per-element binding descriptor (once per element lifetime)
        if (!elem._mpBind) {
          elem._mpBind = {};
          var attr;
          attr = elem.getAttribute('mp-text'); if (attr) elem._mpBind.text = attr;
          attr = elem.getAttribute('mp-model'); if (attr) elem._mpBind.model = attr;
          if (elem.hasAttribute('mp-show') && !elem.hasAttribute('mp-state')) elem._mpBind.show = elem.getAttribute('mp-show');
          attr = elem.getAttribute('mp-hide'); if (attr) elem._mpBind.hide = attr;
          attr = elem.getAttribute('mp-class');
          if (attr) {
            elem._mpBind.classExpr = attr;
            var parsed = _parse(attr.trim());
            elem._mpBind.classParsed = (Array.isArray(parsed) && parsed[0] && parsed[0].t === 'Y' && parsed[0].v === 'do')
              ? parsed.slice(1) : [parsed];
          }
        }
        // Track deps: evaluate with tracking enabled to discover
        // which context keys this element's bindings read.
        var scope = _scopeFor(elem, machineEl, ctx);
        _trackingDeps = true; _trackedDeps = {};
        try {
          if (elem._mpBind.text) _eval(elem._mpBind.text, scope, state, elem);
          if (elem._mpBind.show) _eval(elem._mpBind.show, scope, state, elem);
          if (elem._mpBind.hide) _eval(elem._mpBind.hide, scope, state, elem);
          if (elem._mpBind.classExpr) for (var j = 0; j < elem._mpBind.classParsed.length; j++) _seval(elem._mpBind.classParsed[j], _makeScope(scope, state, elem));
          if (elem._mpBindAttrs) for (var j = 0; j < elem._mpBindAttrs.length; j++) _eval(elem._mpBindAttrs[j].expr, scope, state, elem);
        } catch (err) {
          _trackingDeps = false; _trackedDeps = null;
          var tag = '<' + elem.tagName.toLowerCase();
          var failedExpr = elem._mpBind.text || elem._mpBind.show || elem._mpBind.hide || elem._mpBind.classExpr || '?';
          throw new Error('[mp] error in ' + tag + '> expression "' + failedExpr + '": ' + err.message);
        }
        if (elem._mpBind.model) _trackedDeps[_depKey(elem._mpBind.model)] = true;
        elem._mpBind.deps = _trackedDeps;
        _trackingDeps = false; _trackedDeps = null;
        inst._mpBindCache.push(elem);
      }
      dirty = null; // first build — force full render below
    }

    // ── Phase 3: Apply bindings ──────────────────────────────
    // perf: skip elements whose tracked deps don't overlap dirty set
    var cache = inst._mpBindCache;
    for (var i = 0; i < cache.length; i++) {
      var bound = cache[i];
      var binding = bound._mpBind;

      // perf: skip elements whose tracked deps don't overlap dirty set
      if (dirty) {
        var hit = false;
        for (var dk in binding.deps) { if (dirty[dk]) { hit = true; break; } }
        if (!hit) continue;
      }

      var scope = _scopeFor(bound, machineEl, ctx);

      try {
        if (binding.text) {
          var val = _eval(binding.text, scope, state, bound);
          if (val !== undefined && val !== null) bound.textContent = val;
        }

        if (binding.model) {
          var val = _get(scope, binding.model);
          if (bound.type === 'checkbox') bound.checked = !!val;
          else if (document.activeElement !== bound) bound.value = (val != null) ? val : '';
        }

        if (binding.show) {
          bound.hidden = !_eval(binding.show, scope, state, bound);
        }

        if (binding.hide) {
          bound.hidden = !!_eval(binding.hide, scope, state, bound);
        }

        if (binding.classExpr) {
          var classScope = Object.create(scope); classScope.$state = state;
          if (!bound._mpPrevClasses) bound._mpPrevClasses = [];
          var prev = bound._mpPrevClasses;
          var next = [];
          for (var j = 0; j < binding.classParsed.length; j++) {
            var cls = _seval(binding.classParsed[j], classScope);
            if (cls && typeof cls === 'string') { next.push(cls); bound.classList.add(cls); }
          }
          for (var j = 0; j < prev.length; j++) {
            if (next.indexOf(prev[j]) === -1) bound.classList.remove(prev[j]);
          }
          bound._mpPrevClasses = next;
        }

        if (bound._mpBindAttrs) {
          for (var j = 0; j < bound._mpBindAttrs.length; j++) {
            var val = _eval(bound._mpBindAttrs[j].expr, scope, state, bound);
            var attr = bound._mpBindAttrs[j].attr;
            if (_boolAttrs.indexOf(attr) !== -1) {
              if (val) bound.setAttribute(attr, ''); else bound.removeAttribute(attr);
            } else if (attr === 'class') {
              if (bound._mpOrigClass === undefined) bound._mpOrigClass = bound.className;
              bound.className = bound._mpOrigClass + (val ? ' ' + val : '');
            } else {
              if (val != null) bound.setAttribute(attr, val); else bound.removeAttribute(attr);
            }
          }
        }
      } catch (err) {
        // Report which element and binding failed, then re-throw
        var tag = '<' + bound.tagName.toLowerCase();
        var failedExpr = binding.text || binding.show || binding.hide || binding.classExpr || (bound._mpBindAttrs && bound._mpBindAttrs[0] && bound._mpBindAttrs[0].expr) || '?';
        throw new Error('[mp] error in ' + tag + '> expression "' + failedExpr + '": ' + err.message);
      }
    }

    // mp-bind-* on the machine element itself
    if (machineEl._mpBindAttrs) {
      var scope = _scopeFor(machineEl, machineEl, ctx);
      for (var j = 0; j < machineEl._mpBindAttrs.length; j++) {
        var val = _eval(machineEl._mpBindAttrs[j].expr, scope, state, machineEl);
        var attr = machineEl._mpBindAttrs[j].attr;
        if (_boolAttrs.indexOf(attr) !== -1) {
          if (val) machineEl.setAttribute(attr, ''); else machineEl.removeAttribute(attr);
        } else {
          if (val != null) machineEl.setAttribute(attr, val); else machineEl.removeAttribute(attr);
        }
      }
    }

    // ── Phase 4: Persist ─────────────────────────────────────
    if (persistKey) {
      var toSave = {};
      for (var k in ctx) {
        if (ctx.hasOwnProperty(k) && k.charAt(0) !== '$') toSave[k] = ctx[k];
      }
      try { localStorage.setItem('mp:' + persistKey, JSON.stringify(toSave)); }
      catch (e) { /* localStorage full or unavailable */ }
    }
  }


  // ── Post-init wiring ──────────────────────────────────────────────────
  //
  // After the inst object is created, wire up event receivers, scan for
  // bind attributes, attach DOM event listeners, init nested machines,
  // run the first render, evaluate temporal transitions, set up routing,
  // and run mp-init.

  function _wireInstance(el, inst, setup, evalTransition) {
    _regReceive(inst);
    _scanBindAttrs(el, el);
    _attachDomEvents(el, inst);
    if (setup.initial && setup.stateMap[setup.initial]) _initNested(setup.stateMap[setup.initial]);
    inst.update();
    if (setup.initial && setup.stateMap[setup.initial]) evalTransition(setup.stateMap[setup.initial], setup.initial);
    _setupRoute(el, inst, setup.stateMap, setup.stateTmpls, setup.initial);
    var initExpr = el.getAttribute('mp-init');
    if (initExpr) {
      setTimeout(function () { _exec(initExpr, setup.ctx, inst.state, el); }, 0);
    }
  }


  function _createInstance(el) {
    var name = el.getAttribute('mp');
    var setup = _initMachine(el, name);
    var ctx = setup.ctx;
    var stateMap = setup.stateMap;
    var stateNames = setup.stateNames;
    var stateTmpls = setup.stateTmpls;
    var persistKey = setup.persistKey;
    var initial = setup.initial;
    var afterTimer = null;
    var stateIntervals = [];

    // Evaluate mp-transition temporal expressions: (after ms state), (every ms body).
    // Defined here so it closes over afterTimer/stateIntervals/ctx/el/inst.
    // Called from to() on state entry and from post-init for the initial state.
    function _evalTransition(stateEl, stateName) {
      var transVal = stateEl.getAttribute('mp-transition');
      if (!transVal) return;
      var tScope = _makeScope(ctx, stateName, el);
      tScope.__mpAfterTimer = function (ms, st) {
        afterTimer = setTimeout(function () { afterTimer = null; inst.to(st); }, ms);
      };
      tScope.__mpEveryInterval = function (ms, bodyNode) {
        var id = setInterval(function () {
          var scope = _makeScope(inst.ctx, inst.state, el);
          scope.__mpInst = inst;
          _seval(bodyNode, scope);
          _applyScope(scope, inst.ctx, inst);
          inst.update();
        }, ms);
        stateIntervals.push(id);
      };
      _seval(_parse(transVal), tScope);
    }

    var inst = {
      el: el,
      name: name,
      ctx: ctx,
      state: initial,
      states: stateNames,

      // ── to — state transition ──────────────────────────────────
      // Destroys leaving state's content, creates entering state's
      // content from template, runs enter/leave CSS transitions,
      // rebuilds $refs, calls update(), fires mp:transition event,
      // evaluates mp-transition temporal expressions.
      to: function (target) {
        if (target === '.') target = inst.state;
        if (stateNames.length > 0 && stateNames.indexOf(target) === -1) {
          console.warn('[mp] unknown state "' + target + '" in "' + name + '"');
          return false;
        }
        if (afterTimer) { clearTimeout(afterTimer); afterTimer = null; }
        for (var ci = 0; ci < stateIntervals.length; ci++) clearInterval(stateIntervals[ci]);
        stateIntervals = [];

        var prev = inst.state;
        inst.state = target;
        if (_debug) console.log('[mp:debug] ' + name + ': ' + prev + ' → ' + target);

        // Invalidate binding cache — DOM structure is about to change
        if (prev !== target) inst._mpBindCache = null;

        // ── Destroy leaving state's content ──────────────────────────
        if (prev && stateMap[prev] && prev !== target) {
          var leaveEl = stateMap[prev];
          // mp-exit: run cleanup before content is destroyed (cancel fetches, release resources)
          if (leaveEl.hasAttribute('mp-exit')) {
            _exec(leaveEl.getAttribute('mp-exit'), ctx, prev, el, null, inst);
          }
          var destroyContent = function () {
            var nested = leaveEl.querySelectorAll('[mp]');
            for (var i = 0; i < nested.length; i++) _cleanupInstance(nested[i]);
            leaveEl.innerHTML = '';
            leaveEl.hidden = true;
          };
          if (leaveEl.hasAttribute('mp-transition')) {
            _transitionLeave(leaveEl, destroyContent);
          } else {
            destroyContent();
          }
        }

        // ── Create entering state's content from template ────────────
        if (stateMap[target] && stateTmpls[target] && prev !== target) {
          var enterEl = stateMap[target];
          enterEl.appendChild(stateTmpls[target].content.cloneNode(true));
          // Set up the freshly stamped content
          _scanBindAttrs(enterEl, el);
          _attachDomEvents(enterEl, inst);
          _initNested(enterEl);
          if (enterEl.hasAttribute('mp-transition')) {
            _transitionEnter(enterEl);
          } else {
            enterEl.hidden = false;
          }
        }

        // Rebuild $refs (content changed, refs may have moved)
        ctx.$refs = _buildRefs(el);

        inst.update();

        // mp-init on state elements: runs each time the state is entered.
        // This is the entry action — use it for setup that needs fresh content
        // (focus an input, render a chart, fetch detail data).
        if (stateMap[target] && stateMap[target].hasAttribute('mp-init') && prev !== target) {
          var stateInit = stateMap[target].getAttribute('mp-init');
          setTimeout(function () { _exec(stateInit, ctx, inst.state, el); }, 0);
        }

        el.dispatchEvent(new CustomEvent('mp:transition', {
          bubbles: true,
          detail: { machine: name, prev: prev, next: target, ctx: ctx }
        }));

        if (stateMap[target]) _evalTransition(stateMap[target], target);
        return true;
      },

      emit: function (eventName) {
        document.dispatchEvent(new CustomEvent('mp:' + eventName, {
          detail: { source: el, ctx: ctx, state: inst.state }
        }));
      },

      // ── update — delegates to _applyBindings ─────────────────────
      update: function () {
        _applyBindings(el, inst, persistKey);
      }
    };

    el._mp = inst;
    _wireInstance(el, inst, setup, _evalTransition);
    return inst;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Global event delegation                                                ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  var _listening = false;

  function _setupListeners() {
    if (_listening) return;
    _listening = true;

    // mp-to: click → transition
    //
    // When inside an mp-each item, the item scope ($item, $index, item
    // properties) is available for reading in guards and actions, but
    // ACTION MUTATIONS WRITE TO THE MACHINE'S CONTEXT, not the item scope.
    // This lets (set! selected $item) work correctly from list items.
    document.addEventListener('click', function (e) {
      var toEl = e.target.closest('[mp-to]');
      if (!toEl) return;
      var machineEl = toEl.closest('[mp]');
      if (!machineEl || !machineEl._mp) return;
      var inst = machineEl._mp;

      // Get item scope for reads (has $item, $index, item properties)
      var itemScope = _scopeFor(toEl, machineEl, inst.ctx);

      // Guard evaluates against item scope (needs to read item data)
      var guard = toEl.getAttribute('mp-guard');
      if (guard && !_eval(guard, itemScope, inst.state, toEl)) {
        toEl.dispatchEvent(new CustomEvent('mp:guard-failed', { bubbles: true }));
        return;
      }

      // Action writes to MACHINE context, with item data overlaid for reads
      var action = toEl.getAttribute('mp-action');
      if (action) {
        if (itemScope !== inst.ctx) {
          // Inside mp-each: merge item scope into machine ctx for reads,
          // but mutations land on machine ctx
          var merged = Object.create(inst.ctx);
          for (var k in itemScope) {
            if (itemScope.hasOwnProperty(k)) merged[k] = itemScope[k];
          }
          _exec(action, merged, inst.state, toEl, e);
          _applyScope(merged, inst.ctx, inst);
        } else {
          _exec(action, inst.ctx, inst.state, toEl, e, inst);
        }
      }

      var emit = toEl.getAttribute('mp-emit');
      if (emit) inst.emit(emit);

      var target = toEl.getAttribute('mp-to');
      if (target === '.') target = inst.state;
      inst.to(target);
    });

    // mp-model: input → context
    // When inside an mp-each item, also updates the original $item so
    // changes persist through re-renders.
    function _modelSet(m, machineEl) {
      var inst = machineEl._mp;
      var scope = _scopeFor(m, machineEl, inst.ctx);
      var path = m.getAttribute('mp-model');
      var val = m.type === 'checkbox' ? m.checked : m.value;
      _set(scope, path, val);
      if (!inst._mpDirty) inst._mpDirty = {};
      inst._mpDirty[_depKey(path)] = true;
      // If inside an mp-each item, also write to the original array item
      // so the change survives re-renders
      if (scope.$item && typeof scope.$item === 'object') {
        _set(scope.$item, path, val);
      }
      inst.update();
    }

    document.addEventListener('input', function (e) {
      var modelEl = e.target.closest('[mp-model]');
      if (!modelEl) return;
      var machineEl = modelEl.closest('[mp]');
      if (!machineEl || !machineEl._mp) return;
      _modelSet(modelEl, machineEl);
    });

    // mp-model on <select>
    document.addEventListener('change', function (e) {
      var modelEl = e.target.closest('select[mp-model]');
      if (!modelEl) return;
      var machineEl = modelEl.closest('[mp]');
      if (!machineEl || !machineEl._mp) return;
      _modelSet(modelEl, machineEl);
    });
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  CSS injection                                                          ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function _injectCSS() {
    if (document.getElementById('mp-css')) return;
    var styleEl = document.createElement('style');
    styleEl.id = 'mp-css';
    styleEl.textContent =
      '[mp-state][hidden],[mp-show][hidden],[mp-hide][hidden]{display:none!important}';
    document.head.appendChild(styleEl);
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Init                                                                   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function init(root) {
    _injectCSS();
    _setupListeners();
    root = root || document;

    // If root itself is an [mp] element, init it directly
    if (root.nodeType === 1 && root.hasAttribute && root.hasAttribute('mp')) {
      if (!root._mp) _createInstance(root);
      return;
    }

    // Process stores first (global shared state)
    _processStores(root);

    // Process inline templates
    var tmplEls = root.querySelectorAll('template[mp-define]');
    for (var i = 0; i < tmplEls.length; i++) {
      _templates[tmplEls[i].getAttribute('mp-define')] = tmplEls[i];
    }

    // Init all machines
    var els = root.querySelectorAll('[mp]');
    for (var i = 0; i < els.length; i++) {
      if (!els[i]._mp) _createInstance(els[i]);
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Auto-init + MutationObserver                                           ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // On page load: scan and initialize all [mp] elements.
  // After load: a MutationObserver watches for new [mp] elements added to
  // the DOM — by HTMX swaps, mp-each, server push, or any other mechanism.
  // New machines are initialized automatically. No manual init() calls needed.
  //
  // This is what makes integration seamless: HTMX swaps in new HTML,
  // the observer sees new [mp] elements, machine_perfect initializes them.
  // mp-import files are fetched and parsed before any machines are initialized.

  function _cleanupInstance(el) {
    if (!el._mp) return;
    // Remove from inter-machine event registry, clean up empty channels
    for (var name in _events) {
      _events[name] = _events[name].filter(function (e) { return e.inst.el !== el; });
      if (_events[name].length === 0 && _events[name]._handler) {
        document.removeEventListener('mp:' + name, _events[name]._handler);
        delete _events[name];
      }
    }
    // Run tracked cleanups (outside listeners, popstate handlers)
    if (el._mpCleanups) {
      for (var i = 0; i < el._mpCleanups.length; i++) el._mpCleanups[i]();
      delete el._mpCleanups;
    }
    delete el._mp;
  }

  function _observe() {
    if (typeof MutationObserver === 'undefined') return;
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        // Handle added nodes — init new machines
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.hasAttribute('mp') && !node._mp) {
            _createInstance(node);
          }
          var nested = _querySafe(node, '[mp]');
          for (var k = 0; k < nested.length; k++) {
            if (!nested[k]._mp) _createInstance(nested[k]);
          }
          var tmpls = _querySafe(node, 'template[mp-define]');
          for (var k = 0; k < tmpls.length; k++) {
            _templates[tmpls[k].getAttribute('mp-define')] = tmpls[k];
          }
        }
        // Handle removed nodes — cleanup dead machines (prevents memory leaks
        // when HTMX swaps out content containing machines)
        var removed = mutations[i].removedNodes;
        for (var j = 0; j < removed.length; j++) {
          var node = removed[j];
          if (node.nodeType !== 1) continue;
          // Skip nodes that were moved (e.g. by mp-each reorder), not actually removed.
          // insertBefore on an existing child generates remove+add mutations, but the
          // node is still connected after the move completes. Only clean up truly
          // detached nodes.
          if (node.isConnected) continue;
          if (node._mp) _cleanupInstance(node);
          var dead = _querySafe(node, '[mp]');
          for (var k = 0; k < dead.length; k++) {
            _cleanupInstance(dead[k]);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Boot: load imports (async), then init machines (sync), then observe mutations
  function _boot() {
    _loadImports().then(function () {
      init();
      _observe();
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _boot);
    } else {
      setTimeout(_boot, 0);
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Public API                                                             ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  return {
    init: init,
    get: function (el) { return (el && el._mp) || null; },
    destroy: function (el) {
      if (!el) return;
      var nested = _querySafe(el, '[mp]');
      for (var i = 0; i < nested.length; i++) _cleanupInstance(nested[i]);
      _cleanupInstance(el);
    },
    fn: function (name, func) { _userFns[name] = func; },
    store: _store,
    templates: _templates,
    version: '0.5.0',
    get debug() { return _debug; },
    set debug(v) { _debug = !!v; }
  };
});
