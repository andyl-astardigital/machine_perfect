/**
 * machine_perfect engine v0.5.0 — S-expression evaluator and runtime core.
 *
 * The shared heart of machine_perfect. Zero DOM dependencies.
 * Used by the frontend (browser) and backend (Node/SCXML) runtimes.
 *
 * Contains: tokenizer, parser, evaluator, standard library (~120 functions),
 * dependency tracking, scope management, path utilities, purity enforcement.
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
    root.MPEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Tokenizer                                                              ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function tokenize(str) {
    var tokens = [], i = 0, len = str.length;
    while (i < len) {
      var ch = str[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '(' || ch === ')' || ch === '[' || ch === ']') {
        tokens.push(ch); i++; continue;
      }
      if (ch === '#' && i + 1 < len && str[i + 1] === '(') {
        tokens.push('#('); i += 2; continue;
      }
      if (ch === "'") {
        var j = i + 1;
        while (j < len && str[j] !== "'") j++;
        if (j >= len) throw new Error('[mp] unterminated string literal starting at position ' + i);
        tokens.push({ t: 'S', v: str.slice(i + 1, j) });
        i = j + 1; continue;
      }
      var w = i;
      while (w < len && !/[\s()\[\]]/.test(str[w])) w++;
      var word = str.slice(i, w);
      if (word === 'true') tokens.push({ t: 'B', v: true });
      else if (word === 'false') tokens.push({ t: 'B', v: false });
      else if (word === 'nil') tokens.push({ t: 'N', v: null });
      else if (word[0] === ':') tokens.push({ t: 'K', v: word.slice(1) });
      else if (!isNaN(Number(word)) && word !== '') tokens.push({ t: '#', v: Number(word) });
      else tokens.push({ t: 'Y', v: word });
      i = w;
    }
    return tokens;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Parser                                                                 ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function parseOne(tokens) {
    if (tokens.length === 0) return null;
    var tok = tokens.shift();
    if (tok === '(') {
      var list = [];
      while (tokens.length > 0 && tokens[0] !== ')') list.push(parseOne(tokens));
      if (tokens.length === 0) throw new Error('[mp] unexpected end of expression — missing ")"');
      tokens.shift();
      return list;
    }
    if (tok === '[') {
      var vec = [];
      while (tokens.length > 0 && tokens[0] !== ']') vec.push(parseOne(tokens));
      if (tokens.length === 0) throw new Error('[mp] unexpected end of expression — missing "]"');
      tokens.shift();
      return { t: 'V', v: vec };
    }
    if (tok === '#(') {
      var body = [];
      while (tokens.length > 0 && tokens[0] !== ')') body.push(parseOne(tokens));
      if (tokens.length === 0) throw new Error('[mp] unexpected end of expression — missing ")" in #()');
      tokens.shift();
      // %1/%2/%3 are positional; % is an alias for %1 (first arg).
      // The fn case binds % = %1 when the first param is named %1.
      return [{ t: 'Y', v: 'fn' }, { t: 'V', v: [
        { t: 'Y', v: '%1' }, { t: 'Y', v: '%2' }, { t: 'Y', v: '%3' }
      ] }, body.length === 1 ? body[0] : body];
    }
    return tok;
  }

  var parseCache = Object.create(null);
  var parseCacheSize = 0;

  function parse(str) {
    if (str in parseCache) return parseCache[str];
    var tokens = tokenize(str.trim());
    var exprs = [];
    while (tokens.length > 0) exprs.push(parseOne(tokens));
    var result = exprs.length === 1 ? exprs[0] : [{ t: 'Y', v: 'do' }].concat(exprs);
    if (parseCacheSize >= 2000) { parseCache = Object.create(null); parseCacheSize = 0; }
    parseCache[str] = result;
    parseCacheSize++;
    return result;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Evaluator                                                              ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  var evalDepth = 0;
  var userFns = {};
  var debug = false;
  var trackingDeps = false;
  var trackedDeps = null;

  function seval(node, ctx) {
    if (node === null || node === undefined) return null;
    if (++evalDepth > 512) { evalDepth--; throw new Error('[mp] expression too deeply nested (max depth 512)'); }
    try { return sevalInner(node, ctx); } finally { evalDepth--; }
  }

  // Find the scope that owns a key — walk the prototype chain.
  // Mutations inside let/fn must write to the original scope, not the child.
  function _owner(ctx, key) {
    var scope = ctx;
    while (scope) {
      if (scope.hasOwnProperty(key)) return scope;
      scope = Object.getPrototypeOf(scope);
    }
    return ctx;
  }

  function _markDirty(ctx, key) {
    if (ctx.__mpInst) { if (!ctx.__mpInst._mpDirty) ctx.__mpInst._mpDirty = {}; ctx.__mpInst._mpDirty[depKey(key)] = true; }
  }

  function sevalInner(node, ctx) {
    if (!Array.isArray(node)) {
      if (typeof node === 'string') return node;
      switch (node.t) {
        case 'S': return node.v;
        case '#': return node.v;
        case 'B': return node.v;
        case 'N': return null;
        case 'K': return node.v;
        case 'V':
          var arr = [];
          for (var i = 0; i < node.v.length; i++) arr.push(seval(node.v[i], ctx));
          return arr;
        case 'Y':
          var name = node.v;
          if (name === '$state') return ctx.$state;
          if (name === '$el') return ctx.$el;
          if (name === '$event') return ctx.$event;
          if (name === '$item') return ctx.$item;
          if (name === '$index') return ctx.$index;
          if (name === '$detail') return ctx.$detail;
          if (name.indexOf('.') !== -1) {
            if (trackingDeps) trackedDeps[depKey(name)] = true;
            return get(ctx, name);
          }
          // Context takes priority over built-in functions — a variable named
          // "count" should resolve to the context value, not the stdlib function.
          // Built-ins and user fns are the fallback for names not in context.
          if (name in ctx) {
            if (trackingDeps) trackedDeps[name] = true;
            return ctx[name];
          }
          if (firstClass[name]) return firstClass[name];
          if (userFns[name]) return userFns[name];
          if (debug) console.warn('[mp-debug] undefined variable "' + name + '"');
          return null;
      }
      return node;
    }

    if (node.length === 0) return null;
    var head = node[0];
    var fn = (head && head.t === 'Y') ? head.v : null;
    var n1 = node[1], n2 = node[2], n3 = node[3], n4 = node[4];
    var nLen = node.length - 1;

    switch (fn) {
      case 'if':
        return seval(n1, ctx) ? seval(n2, ctx) : (n3 != null ? seval(n3, ctx) : null);
      case 'when':
        if (!seval(n1, ctx)) return null;
        var result = null; for (var i = 2; i < node.length; i++) result = seval(node[i], ctx); return result;
      case 'unless':
        if (seval(n1, ctx)) return null;
        var result = null; for (var i = 2; i < node.length; i++) result = seval(node[i], ctx); return result;
      case 'when-state':
        return ctx.$state === (n1.v || String(n1)) ? seval(n2, ctx) : null;
      case 'cond':
        for (var i = 1; i < node.length; i += 2) {
          if (i + 1 < node.length && seval(node[i], ctx)) return seval(node[i + 1], ctx);
        }
        return null;
      case 'and':
        var val = true; for (var i = 1; i < node.length; i++) { val = seval(node[i], ctx); if (!val) return val; } return val;
      case 'or':
        var val = false; for (var i = 1; i < node.length; i++) { val = seval(node[i], ctx); if (val) return val; } return val;
      case 'do':
        var result = null; for (var i = 1; i < node.length; i++) result = seval(node[i], ctx); return result;
      case 'let':
        var bindings = n1;
        var blist = bindings.t === 'V' ? bindings.v : (Array.isArray(bindings) ? bindings : []);
        var local = Object.create(ctx);
        for (var i = 0; i < blist.length; i += 2) {
          local[blist[i].v] = seval(blist[i + 1], local);
        }
        // Implicit do: evaluate all body forms, return last
        var result = null; for (var i = 2; i < node.length; i++) result = seval(node[i], local);
        return result;
      case 'fn':
        var params = n1;
        var plist = params.t === 'V' ? params.v : (Array.isArray(params) ? params : []);
        var fnNode = node; // capture for closure
        return function () {
          var local = Object.create(ctx);
          for (var i = 0; i < plist.length; i++) local[plist[i].v] = arguments[i];
          // #() lambdas use %1/%2/%3 for positional args; % is an alias for %1.
          if (plist.length > 0 && plist[0].v === '%1') local['%'] = arguments[0];
          // Implicit do: evaluate all body forms, return last
          var result = null; for (var i = 2; i < fnNode.length; i++) result = seval(fnNode[i], local);
          return result;
        };
      case '->':
        var result = n1;
        for (var i = 2; i < node.length; i++) {
          if (Array.isArray(node[i])) {
            result = [node[i][0], result].concat(node[i].slice(1));
          } else {
            result = [node[i], result];
          }
        }
        return seval(result, ctx);
      case '->>':
        var result = n1;
        for (var i = 2; i < node.length; i++) {
          if (Array.isArray(node[i])) {
            result = node[i].concat([result]);
          } else {
            result = [node[i], result];
          }
        }
        return seval(result, ctx);

      case 'set!':
        var val = seval(n2, ctx);
        if (n1.v.indexOf('.') !== -1) {
          set(ctx, n1.v, val);
          _markDirty(ctx, n1.v);
        }
        else { if (unsafePaths[n1.v]) return val; _owner(ctx, n1.v)[n1.v] = val; _markDirty(ctx, n1.v); }
        return val;
      case 'inc!':
        if (n1.v.indexOf('.') !== -1) { var cur = get(ctx, n1.v); set(ctx, n1.v, (cur || 0) + 1); }
        else { if (unsafePaths[n1.v]) return 0; var ownInc = _owner(ctx, n1.v); ownInc[n1.v] = (ownInc[n1.v] || 0) + 1; }
        _markDirty(ctx, n1.v);
        return n1.v.indexOf('.') !== -1 ? get(ctx, n1.v) : ctx[n1.v];
      case 'dec!':
        if (n1.v.indexOf('.') !== -1) { var cur = get(ctx, n1.v); set(ctx, n1.v, (cur || 0) - 1); }
        else { if (unsafePaths[n1.v]) return 0; var ownDec = _owner(ctx, n1.v); ownDec[n1.v] = (ownDec[n1.v] || 0) - 1; }
        _markDirty(ctx, n1.v);
        return n1.v.indexOf('.') !== -1 ? get(ctx, n1.v) : ctx[n1.v];
      case 'toggle!':
        if (n1.v.indexOf('.') !== -1) { set(ctx, n1.v, !get(ctx, n1.v)); }
        else { if (unsafePaths[n1.v]) return false; var ownTog = _owner(ctx, n1.v); ownTog[n1.v] = !ownTog[n1.v]; }
        _markDirty(ctx, n1.v);
        return n1.v.indexOf('.') !== -1 ? get(ctx, n1.v) : ctx[n1.v];
      case 'swap!':
        // (swap! key fn arg1 arg2 ...) — apply fn to current value, replace atomically
        var swapKey = n1.v;
        if (unsafePaths[swapKey]) return null;
        var swapFn = seval(n2, ctx);
        var swapCur = swapKey.indexOf('.') !== -1 ? get(ctx, swapKey) : ctx[swapKey];
        var swapArgs = [swapCur];
        for (var si = 3; si < node.length; si++) swapArgs.push(seval(node[si], ctx));
        var swapResult = swapFn.apply(null, swapArgs);
        if (swapKey.indexOf('.') !== -1) set(ctx, swapKey, swapResult);
        else _owner(ctx, swapKey)[swapKey] = swapResult;
        _markDirty(ctx, swapKey);
        return swapResult;
      case 'push!':
        var arr = seval(n1, ctx);
        var val = seval(n2, ctx);
        if (Array.isArray(arr)) arr.push(val);
        if (n1.t === 'Y') _markDirty(ctx, n1.v);
        return arr;
      case 'remove-where!':
        var arr = seval(n1, ctx);
        var key = seval(n2, ctx);
        var val = seval(n3, ctx);
        if (Array.isArray(arr)) {
          for (var i = arr.length - 1; i >= 0; i--) { if (arr[i][key] === val) arr.splice(i, 1); }
        }
        if (n1.t === 'Y') _markDirty(ctx, n1.v);
        return arr;
      case 'splice!':
        var arr = seval(n1, ctx);
        var idx = seval(n2, ctx);
        var count = n3 != null ? seval(n3, ctx) : 1;
        if (Array.isArray(arr)) arr.splice(idx, count);
        if (n1.t === 'Y') _markDirty(ctx, n1.v);
        return arr;

      // All ! forms in this engine mutate in place. assoc! sets a key on
      // an existing object. This differs from Clojure's transient assoc!.
      case 'assoc!':
        var assocObj = seval(n1, ctx);
        var assocKey = seval(n2, ctx);
        var assocVal = seval(n3, ctx);
        if (assocObj && !unsafePaths[assocKey]) assocObj[assocKey] = assocVal;
        if (n1.t === 'Y') _markDirty(ctx, n1.v);
        return assocObj;
      case 'in-state?':
        var checkState = seval(n1, ctx);
        if (checkState == null) return false;
        var curState = ctx.$state || '';
        if (curState === checkState) return true;
        var curParts = curState.split('.');
        var checkParts = checkState.split('.');
        if (checkParts.length >= curParts.length) return false;
        for (var isp = 0; isp < checkParts.length; isp++) { if (curParts[isp] !== checkParts[isp]) return false; }
        return true;
      case 'to':
        var target = n1.t === 'Y' ? n1.v : String(seval(n1, ctx));
        ctx.__mpTo = target;
        return target;
      case 'emit':
        var eName = n1.t === 'Y' ? n1.v : String(seval(n1, ctx));
        ctx.__mpEmit = eName;
        ctx.__mpEmitPayload = node.length > 2 ? seval(node[2], ctx) : undefined;
        return eName;
      // (invoke! :type 'http.post' :input (obj ...) :bind :result :on-success 'ok' :on-error 'err')
      // Declares an effect for the host to execute. The machine says WHAT,
      // the host adapter decides HOW. The effect descriptor is stored on
      // the scope for the runtime to collect after evaluation.
      case 'invoke!':
        var invokeArgs = {};
        for (var ii = 1; ii < node.length; ii += 2) {
          var iKey = seval(node[ii], ctx);
          var iVal = (ii + 1 < node.length) ? seval(node[ii + 1], ctx) : null;
          invokeArgs[iKey] = iVal;
        }
        if (!ctx.__mpEffects) ctx.__mpEffects = [];
        ctx.__mpEffects.push(invokeArgs);
        return invokeArgs;

      case 'prevent!':
        if (ctx.__mpEvent) ctx.__mpEvent.preventDefault();
        else if (ctx.$event) ctx.$event.preventDefault();
        return null;
      case 'stop!':
        if (ctx.__mpEvent) ctx.__mpEvent.stopPropagation();
        else if (ctx.$event) ctx.$event.stopPropagation();
        return null;
      case 'focus!':
        var focusTarget = seval(n1, ctx);
        if (focusTarget && typeof focusTarget.focus === 'function') {
          setTimeout(function () { focusTarget.focus(); }, 0);
        }
        return null;
      case 'animate':
        if (ctx.__mpAnimate) ctx.__mpAnimate();
        return null;
      case 'after':
        var ms = seval(n1, ctx);
        if (ctx.__mpAfterTimer) ctx.__mpAfterTimer(ms, n2);
        return null;
      case 'every':
        var ems = seval(n1, ctx);
        if (ctx.__mpEveryInterval) ctx.__mpEveryInterval(ems, n2, ctx);
        return null;
      case 'then!':
        var promise = seval(n1, ctx);
        var key = n2 ? seval(n2, ctx) : null;
        var thenState = n3 ? seval(n3, ctx) : null;
        var errorState = n4 ? seval(n4, ctx) : null;
        var machineEl = ctx.$el;
        if (promise && typeof promise.then === 'function') {
          promise.then(function (result) {
            if (machineEl && machineEl._mp) {
              if (key) machineEl._mp.ctx[key] = result;
              if (thenState) machineEl._mp.to(thenState);
              else machineEl._mp.update();
            } else if (ctx.__mpResolve) {
              ctx.__mpResolve(key, result, thenState);
            }
          }).catch(function (err) {
            if (machineEl && machineEl._mp) {
              if (errorState) {
                if (key) machineEl._mp.ctx[key] = err;
                machineEl._mp.to(errorState);
              } else {
                console.warn('[mp] async error:', err);
              }
            } else if (ctx.__mpReject) {
              ctx.__mpReject(key, err, errorState);
            }
          });
        }
        return null;
    }

    // apply: (apply fn [args]) — spread a collection into a function call
    if (fn === 'apply') {
      var fnName = n1.t === 'Y' ? n1.v : null;
      var applyArgs = seval(n2, ctx);
      // stdlib functions take (array) — pass args directly
      if (fnName && stdlib[fnName]) return stdlib[fnName](applyArgs);
      // user functions take (...args) — spread
      if (fnName && userFns[fnName]) return userFns[fnName].apply(null, applyArgs);
      // Evaluated function (lambda)
      var applyFn = seval(n1, ctx);
      if (typeof applyFn === 'function') return applyFn.apply(null, applyArgs);
      return null;
    }

    var args = new Array(nLen);
    for (var i = 0; i < nLen; i++) args[i] = seval(node[i + 1], ctx);

    if (stdlib[fn]) return stdlib[fn](args);
    if (userFns[fn]) return userFns[fn].apply(null, args);

    // Head might be an expression that evaluates to a function: ((fn [x] ...) 7)
    var headVal = fn ? ctx[fn] : seval(head, ctx);
    if (typeof headVal === 'function') return headVal.apply(null, args);

    console.warn('[mp] unknown function: ' + fn);
    return null;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Standard library                                                       ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function _deepEq(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) { if (!_deepEq(a[i], b[i])) return false; }
      return true;
    }
    if (typeof a === 'object') {
      var ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (var j = 0; j < ka.length; j++) { if (!_deepEq(a[ka[j]], b[ka[j]])) return false; }
      return true;
    }
    return false;
  }

  var stdlib = {
    '+':   function (a) { return a.reduce(function (x, y) { return x + y; }, 0); },
    '-':   function (a) { if (a.length === 1) return -a[0]; var r = a[0]; for (var i = 1; i < a.length; i++) r -= a[i]; return r; },
    '*':   function (a) { return a.reduce(function (x, y) { return x * y; }, 1); },
    '/':   function (a) { var r = a[0]; for (var i = 1; i < a.length; i++) { if (a[i] === 0) throw new Error('[mp] division by zero'); r /= a[i]; } return r; },
    'mod': function (a) { if (a[1] === 0) throw new Error('[mp] modulo by zero'); return a[0] % a[1]; },
    'inc': function (a) { return a[0] + 1; },
    'dec': function (a) { return a[0] - 1; },
    'abs': function (a) { return Math.abs(a[0]); },
    'min': function (a) { return Math.min.apply(null, a); },
    'max': function (a) { return Math.max.apply(null, a); },
    'round': function (a) { return Math.round(a[0]); },
    'floor': function (a) { return Math.floor(a[0]); },
    'ceil':  function (a) { return Math.ceil(a[0]); },
    '=':  function (a) { for (var i = 1; i < a.length; i++) { if (!_deepEq(a[i - 1], a[i])) return false; } return true; },
    '!=': function (a) { for (var i = 1; i < a.length; i++) { if (_deepEq(a[i - 1], a[i])) return false; } return true; },
    '>':  function (a) { for (var i = 1; i < a.length; i++) { if (!(a[i - 1] > a[i])) return false; } return true; },
    '<':  function (a) { for (var i = 1; i < a.length; i++) { if (!(a[i - 1] < a[i])) return false; } return true; },
    '>=': function (a) { for (var i = 1; i < a.length; i++) { if (!(a[i - 1] >= a[i])) return false; } return true; },
    '<=': function (a) { for (var i = 1; i < a.length; i++) { if (!(a[i - 1] <= a[i])) return false; } return true; },
    'not':    function (a) { return !a[0]; },
    'nil?':   function (a) { return a[0] == null; },
    'some?':  function (a) { return a[0] != null; },
    'true?':  function (a) { return a[0] === true; },
    'false?': function (a) { return a[0] === false; },
    'empty?': function (a) { var v = a[0]; if (v == null) return true; if (typeof v === 'string' || Array.isArray(v)) return v.length === 0; if (typeof v === 'object') return Object.keys(v).length === 0; return false; },
    'str':       function (a) { return a.map(function (x) { return x == null ? '' : String(x); }).join(''); },
    'upper':     function (a) { return String(a[0] || '').toUpperCase(); },
    'lower':     function (a) { return String(a[0] || '').toLowerCase(); },
    'trim':      function (a) { return String(a[0] || '').trim(); },
    'split':     function (a) { return String(a[0] || '').split(a[1] || ''); },
    'join':      function (a) { return (a[0] || []).join(a[1] != null ? a[1] : ''); },
    'starts?':   function (a) { return String(a[0] || '').indexOf(a[1]) === 0; },
    'ends?':     function (a) { var s = String(a[0] || ''), n = a[1] || ''; return n.length === 0 ? true : s.slice(-n.length) === n; },
    'contains?': function (a) { return String(a[0] || '').indexOf(a[1]) !== -1; },
    'replace':   function (a) { return String(a[0] || '').split(a[1]).join(a[2] || ''); },
    'subs':      function (a) { return String(a[0] || '').substring(a[1], a[2]); },
    'count':     function (a) { return a[0] == null ? 0 : (a[0].length != null ? a[0].length : Object.keys(a[0]).length); },
    'first':     function (a) { return a[0] != null && a[0].length > 0 ? a[0][0] : null; },
    'last':      function (a) { return a[0] != null && a[0].length > 0 ? a[0][a[0].length - 1] : null; },
    'nth':       function (a) { var v = a[0] != null ? a[0][a[1]] : undefined; return v !== undefined ? v : null; },
    'rest':      function (a) { return a[0] ? a[0].slice(1) : []; },
    'take':      function (a) { return (a[1] || []).slice(0, a[0]); },
    'drop':      function (a) { return (a[1] || []).slice(a[0]); },
    'concat':    function (a) { var r = (a[0] || []).slice(); for (var i = 1; i < a.length; i++) r = r.concat(a[i] || []); return r; },
    'reverse':   function (a) { return (a[0] || []).slice().reverse(); },
    'sort':      function (a) { return (a[0] || []).slice().sort(a[1] || undefined); },
    'includes?': function (a) { return (a[0] || []).indexOf(a[1]) !== -1; },
    'has-key?': function (a) { return a[0] != null && a[1] in Object(a[0]); },
    'index-of':  function (a) { var i = (a[0] || []).indexOf(a[1]); return i === -1 ? null : i; },
    'uniq':      function (a) { return a[0] ? a[0].filter(function (v, i, s) { return s.indexOf(v) === i; }) : []; },
    'range':     function (a) { var start = a.length === 1 ? 0 : a[0], end = a.length === 1 ? a[0] : a[1], step = a[2] || 1; var r = []; for (var i = start; i < end; i += step) r.push(i); return r; },
    'map':     function (a) { var fn = _coerceFn(a[0]); return (a[1] || []).map(fn); },
    'filter':  function (a) { var fn = _coerceFn(a[0]); return (a[1] || []).filter(fn); },
    'find':    function (a) { var fn = _coerceFn(a[0]); var r = (a[1] || []).find(fn); return r !== undefined ? r : null; },
    'every?':  function (a) { var fn = _coerceFn(a[0]); return (a[1] || []).every(fn); },
    'some':    function (a) { var arr = a[1] || [], fn = _coerceFn(a[0]); for (var i = 0; i < arr.length; i++) { var v = fn(arr[i]); if (v) return v; } return null; },
    'reduce':  function (a) { var fn = _coerceFn(a[0]); return (a[2] || []).reduce(fn, a[1]); },
    'flat-map': function (a) { var fn = _coerceFn(a[0]); return (a[1] || []).reduce(function (r, x) { return r.concat(fn(x)); }, []); },
    'sort-by': function (a) { var fn = _coerceFn(a[0]); return (a[1] || []).slice().sort(function (x, y) { var fx = fn(x), fy = fn(y); return fx < fy ? -1 : fx > fy ? 1 : 0; }); },
    'obj':    function (a) { var o = {}; for (var i = 0; i < a.length; i += 2) { if (!unsafePaths[a[i]]) o[a[i]] = a[i + 1]; } return o; },
    'get':    function (a) { if (a[0] == null) return null; var v = a[0][a[1]]; return v !== undefined ? v : null; },
    'keys':   function (a) { return a[0] ? Object.keys(a[0]) : []; },
    'vals':   function (a) { return a[0] ? Object.keys(a[0]).map(function (k) { return a[0][k]; }) : []; },
    'assoc':  function (a) { var o = {}; for (var k in a[0]) { if (a[0].hasOwnProperty(k) && !unsafePaths[k]) o[k] = a[0][k]; } for (var i = 1; i < a.length - 1; i += 2) { if (!unsafePaths[a[i]]) o[a[i]] = a[i + 1]; } return o; },
    'dissoc': function (a) { var skip = {}; for (var i = 1; i < a.length; i++) skip[a[i]] = true; var o = {}; for (var k in a[0]) { if (a[0].hasOwnProperty(k) && !skip[k] && !unsafePaths[k]) o[k] = a[0][k]; } return o; },
    'merge':  function (a) { var o = {}; for (var i = 0; i < a.length; i++) { if (a[i]) for (var k in a[i]) { if (a[i].hasOwnProperty(k) && !unsafePaths[k]) o[k] = a[i][k]; } } return o; },
    'type':  function (a) { return a[0] === null ? 'nil' : Array.isArray(a[0]) ? 'list' : typeof a[0]; },
    'num':   function (a) { return Number(a[0]); },
    'int':   function (a) { return parseInt(a[0], a[1] || 10); },
    'float': function (a) { return parseFloat(a[0]); },
    'bool':  function (a) { return !!a[0]; },
    'now':       function () { return Date.now(); },
    'timestamp': function (a) { return new Date(a[0]).getTime(); },
    'uuid': function () {
      return 'mp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    },
    'date-fmt': function (a) {
      if (!a[0]) return '';
      var d = new Date(a[0]);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },
    'requires': function (a) {
      for (var i = 0; i < a.length; i++) {
        if (typeof a[i] !== 'string') console.warn('[mp] requires expects string arguments. Got ' + typeof a[i] + ' for argument ' + (i + 1) + '. Did you forget quotes? Use (requires \'name\') not (requires name).');
      }
      return a;
    },
    'identity': function (a) { return a[0]; },
    'list':  function (a) { return a.slice(); },
    'not=':  function (a) { for (var i = 1; i < a.length; i++) { if (_deepEq(a[i - 1], a[i])) return false; } return true; },
    'distinct': function (a) { if (!a[0]) return []; var seen = {}, r = []; for (var i = 0; i < a[0].length; i++) { var k = JSON.stringify(a[0][i]); if (!seen[k]) { seen[k] = true; r.push(a[0][i]); } } return r; },
    'mapcat': function (a) { var fn = _coerceFn(a[0]), arr = a[1] || [], r = []; for (var i = 0; i < arr.length; i++) { var v = fn(arr[i]); if (Array.isArray(v)) for (var j = 0; j < v.length; j++) r.push(v[j]); else r.push(v); } return r; },
    'get-in': function (a) { var obj = a[0], path = a[1]; if (!obj || !path) return null; for (var i = 0; i < path.length; i++) { obj = obj[path[i]]; if (obj == null) return null; } return obj; },
    'update': function (a) { var fn = _coerceFn(a[2]); var o = {}; for (var k in a[0]) { if (a[0].hasOwnProperty(k) && !unsafePaths[k]) o[k] = a[0][k]; } if (!unsafePaths[a[1]]) o[a[1]] = fn(o[a[1]]); return o; },
    'log':  function (a) { console.log.apply(console, a); return a[0]; },
    'warn': function (a) { console.warn.apply(console, a); return a[0]; },

    // ── Collection transforms ──
    'conj':     function (a) {
      if (a[0] != null && typeof a[0] === 'object' && !Array.isArray(a[0])) {
        var o = {}; for (var k in a[0]) { if (a[0].hasOwnProperty(k) && !unsafePaths[k]) o[k] = a[0][k]; }
        if (Array.isArray(a[1]) && a[1].length >= 2 && !unsafePaths[a[1][0]]) o[a[1][0]] = a[1][1];
        return o;
      }
      return (a[0] || []).concat([a[1]]);
    },
    'select-keys': function (a) { var obj = a[0] || {}, ks = a[1] || [], o = {}; for (var i = 0; i < ks.length; i++) { if (ks[i] in obj) o[ks[i]] = obj[ks[i]]; } return o; },
    'zipmap':   function (a) { var ks = a[0] || [], vs = a[1] || [], o = {}; for (var i = 0; i < ks.length; i++) { if (!unsafePaths[ks[i]]) o[ks[i]] = i < vs.length ? vs[i] : null; } return o; },
    'number?':  function (a) { return typeof a[0] === 'number'; },
    'string?':  function (a) { return typeof a[0] === 'string'; },
    'boolean?': function (a) { return typeof a[0] === 'boolean'; },
    'map?':     function (a) { return a[0] != null && typeof a[0] === 'object' && !Array.isArray(a[0]); },
    'coll?':    function (a) { return Array.isArray(a[0]); },
    'fn?':      function (a) { return typeof a[0] === 'function'; },
    'group-by': function (a) { var fn = _coerceFn(a[0]), arr = a[1] || [], r = Object.create(null); for (var i = 0; i < arr.length; i++) { var k = fn(arr[i]); if (!r[k]) r[k] = []; r[k].push(arr[i]); } return r; },
    'assoc-in': function (a) { var obj = a[0] || {}, path = a[1], val = a[2]; return _assocIn(obj, path, 0, val); },
    'update-in': function (a) { var obj = a[0] || {}, path = a[1], fn = _coerceFn(a[2]); var cur = obj; for (var i = 0; i < path.length; i++) cur = cur ? cur[path[i]] : null; return _assocIn(obj, path, 0, fn(cur)); },
    'starts-with?': function (a) { return String(a[0] || '').indexOf(a[1]) === 0; },
    'ends-with?':   function (a) { if (a[1] == null) return false; var s = String(a[0] || ''), needle = String(a[1]); return s.indexOf(needle, s.length - needle.length) !== -1; },
    'comp':    function (a) { var fns = a.slice(); return function (x) { for (var i = fns.length - 1; i >= 0; i--) x = fns[i](x); return x; }; },
    'partial': function (a) { var fn = a[0], bound = a.slice(1); return function () { return fn.apply(null, bound.concat(Array.prototype.slice.call(arguments))); }; }
  };

  // Keywords as property accessors in HOFs: (sort-by :name items)
  function _coerceFn(f) {
    if (typeof f === 'string') return function (x) { return x != null ? x[f] : null; };
    return f;
  }

  // Deep assoc-in helper
  function _assocIn(obj, path, idx, val) {
    var o = {};
    if (obj != null) { for (var k in obj) { if (obj.hasOwnProperty(k) && !unsafePaths[k]) o[k] = obj[k]; } }
    var key = path[idx];
    if (unsafePaths[key]) return o;
    if (idx === path.length - 1) { o[key] = val; }
    else { o[key] = _assocIn(o[key], path, idx + 1, val); }
    return o;
  }

  var firstClass = {
    '+':   function (a, b) { return a + b; },
    '-':   function (a, b) { return a - b; },
    '*':   function (a, b) { return a * b; },
    '/':   function (a, b) { return a / b; },
    'inc': function (x) { return x + 1; },
    'dec': function (x) { return x - 1; },
    'not': function (x) { return !x; },
    'str': function () { return Array.prototype.slice.call(arguments).map(function (x) { return x == null ? '' : String(x); }).join(''); },
    'count': function (x) { return x == null ? 0 : x.length != null ? x.length : Object.keys(x).length; },
    'get': function (o, k) { if (o == null) return null; var v = o[k]; return v !== undefined ? v : null; },
    'upper': function (s) { return String(s || '').toUpperCase(); },
    'lower': function (s) { return String(s || '').toLowerCase(); },
    'trim': function (s) { return String(s || '').trim(); },
    'max': function (a, b) { return Math.max(a, b); },
    'min': function (a, b) { return Math.min(a, b); },
    'identity': function (x) { return x; },
    'conj': function (coll, x) {
      if (coll != null && typeof coll === 'object' && !Array.isArray(coll)) {
        var o = {}; for (var k in coll) { if (coll.hasOwnProperty(k) && !unsafePaths[k]) o[k] = coll[k]; }
        if (Array.isArray(x) && x.length >= 2 && !unsafePaths[x[0]]) o[x[0]] = x[1];
        return o;
      }
      return (coll || []).concat([x]);
    }
  };


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Expression interface                                                   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function makeScope(ctx, state, el, event) {
    var scope = Object.create(ctx);
    scope.$state = state;
    scope.$el = el;
    scope.$event = event || null;
    return scope;
  }

  var mutationForms = { 'set!':1, 'inc!':1, 'dec!':1, 'toggle!':1, 'push!':1,
                        'remove-where!':1, 'splice!':1, 'assoc!':1, 'invoke!':1, 'swap!':1,
                        'then!':1, 'focus!':1, 'prevent!':1, 'stop!':1,
                        'to':1, 'emit':1 };

  function _checkPure(node) {
    if (!Array.isArray(node)) return;
    if (node.length > 0 && node[0] && node[0].t === 'Y' && mutationForms[node[0].v]) {
      throw new Error('[mp] mutation "' + node[0].v + '" is not allowed in bindings. Move it to <mp-on>, <mp-init>, <mp-exit>, mp-to, or a transition <mp-action>.');
    }
    for (var i = 0; i < node.length; i++) {
      if (Array.isArray(node[i])) _checkPure(node[i]);
      // Check inside vector literals [expr1 expr2 ...]
      if (node[i] && node[i].t === 'V' && Array.isArray(node[i].v)) {
        for (var j = 0; j < node[i].v.length; j++) {
          if (Array.isArray(node[i].v[j])) _checkPure(node[i].v[j]);
        }
      }
    }
  }

  function sevalPure(node, ctx) {
    _checkPure(node);
    return seval(node, ctx);
  }

  function evalExpr(expr, ctx, state, el) {
    if (!expr) return null;
    var str = expr.trim();
    if (!str) return null;
    if (str.charAt(0) === '(') return sevalPure(parse(str), makeScope(ctx, state, el));
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (str === 'nil') return null;
    if (str === '$state') return state;
    if (str.charAt(0) === "'" && str.charAt(str.length - 1) === "'") return str.slice(1, -1);
    if (!isNaN(Number(str)) && str !== '') return Number(str);
    if (str.indexOf('.') !== -1) {
      if (trackingDeps) trackedDeps[depKey(str)] = true;
      return get(ctx, str);
    }
    if (trackingDeps) trackedDeps[str] = true;
    if (debug && !(str in ctx)) console.warn('[mp-debug] undefined variable "' + str + '"');
    var val = ctx[str];
    return val !== undefined ? val : null;
  }

  function execExpr(expr, ctx, state, el, event, inst) {
    if (!expr) return null;
    var str = expr.trim();
    if (!str) return null;
    var scope = makeScope(ctx, state, el, event);
    if (inst) scope.__mpInst = inst;
    seval(parse(str), scope);
    applyScope(scope, ctx, inst);
    // Return collected signals for the host to act on
    return {
      to: scope.__mpTo || null,
      emit: scope.__mpEmit || null,
      emitPayload: scope.__mpEmitPayload !== undefined ? scope.__mpEmitPayload : null,
      effects: scope.__mpEffects || null
    };
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Dependency tracking                                                    ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function depKey(name) {
    if (name.charAt(0) === '$' && name.indexOf('$store.') === 0) {
      var rest = name.substring(7);
      var dot = rest.indexOf('.');
      return dot === -1 ? name : '$store.' + rest.substring(0, dot);
    }
    var dot = name.indexOf('.');
    return dot === -1 ? name : name.substring(0, dot);
  }

  function applyScope(scope, target, inst) {
    for (var k in scope) {
      if (scope.hasOwnProperty(k) && k.charAt(0) !== '$' && k.indexOf('__mp') !== 0) {
        target[k] = scope[k];
        if (inst) { if (!inst._mpDirty) inst._mpDirty = {}; inst._mpDirty[depKey(k)] = true; }
      }
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Path utilities                                                         ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function get(obj, path) {
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (obj == null) return null;
      obj = obj[parts[i]];
    }
    return obj !== undefined ? obj : null;
  }

  var unsafePaths = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };

  function set(obj, path, val) {
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (unsafePaths[parts[i]]) return;
    }
    for (var i = 0; i < parts.length - 1; i++) {
      if (obj[parts[i]] == null) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = val;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Public API                                                             ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  return {
    // Parser
    parse: parse,

    // Evaluator
    seval: seval,
    sevalPure: sevalPure,

    // Expression interface (string → result)
    eval: evalExpr,
    exec: execExpr,

    // Scope
    makeScope: makeScope,
    applyScope: applyScope,

    // Dependency tracking
    depKey: depKey,
    startTracking: function () { trackingDeps = true; trackedDeps = {}; },
    stopTracking: function () { trackingDeps = false; var deps = trackedDeps; trackedDeps = null; return deps; },
    addDep: function (key) { if (trackedDeps) trackedDeps[key] = true; },

    // Path utilities
    get: get,
    set: set,

    // Extension points
    fn: function (name, func) { userFns[name] = func; },
    stdlib: stdlib,
    userFns: userFns,

    // Config
    get debug() { return debug; },
    set debug(v) { debug = !!v; },

    version: '0.5.0'
  };
});
