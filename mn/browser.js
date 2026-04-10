/**
 * machine_native v0.5.0 — Markup-native application runtime.
 *
 * Build full applications in HTML. State machines are the component model.
 * JavaScript-optional. No build step. No bundler.
 *
 *   <div mn="toggle">
 *     <div mn-state="off">
 *       <button mn-to="on">Turn on</button>
 *     </div>
 *     <div mn-state="on">
 *       <p>It's on!</p>
 *       <button mn-to="off">Turn off</button>
 *     </div>
 *   </div>
 *
 * ── Core attributes (bare identifiers only) ──────────────────────────────────
 *   mn="name"                       Machine instance
 *   mn-state="name"                 State (visible when active)
 *   mn-initial="name"               Override initial state
 *   mn-to="name"                    Click → fire event or transition
 *   mn-model="path"                 Two-way input binding
 *   mn-ref="name"                   Reference element as $refs.name
 *   mn-persist="key"                Save/restore context to localStorage
 *   mn-key="field"                  Key for efficient list reconciliation
 *   mn-each="field"                 Repeat template for each array item (bare name)
 *   mn-url="/path"                  Map state to browser URL (static path)
 *   mn-text="field"                 textContent from bare variable
 *   mn-show="field"                 Show if bare boolean truthy
 *   mn-final                        Terminal state marker
 *   mn-loading="<html>"             Custom loading indicator for mn-where states
 *
 * ── Structural elements (all s-expressions) ─────────────────────────────────
 *   <mn-ctx>json</mn-ctx>           Context data (JSON)
 *   <mn-transition event to>        Transition with guards/actions/emits
 *     <mn-guard>expr</mn-guard>     Guard condition
 *     <mn-action>expr</mn-action>   Side-effect action
 *     <mn-emit>name</mn-emit>       Emit inter-machine event
 *   <mn-text>expr</mn-text>         textContent from s-expression
 *   <mn-show>expr</mn-show>         Show/hide parent via s-expression
 *   <mn-class>expr</mn-class>       Toggle CSS class via s-expression
 *   <mn-bind attr="x">expr</mn-bind> Bind any HTML attribute
 *   <mn-on event="x">expr</mn-on>  DOM event handler
 *   <mn-init>expr</mn-init>         Run on state entry
 *   <mn-exit>expr</mn-exit>         Run before state exit
 *   <mn-temporal>expr</mn-temporal> CSS animation / timers
 *   <mn-let name="x">expr</mn-let> Machine-scope computed binding
 *   <mn-receive event="x">expr</mn-receive>  Receive inter-machine events
 *   <mn-where>expr</mn-where>       Capability-based routing
 *   <mn-url>expr</mn-url>           URL routing via s-expression
 *   <mn-each>expr</mn-each>         List rendering via s-expression
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *   Parentheses → element. Bare word → attribute. No exceptions.
 *
 * ── Composition ─────────────────────────────────────────────────────────────
 *   <template mn-define="name">     Reusable machine template
 *   <mn-slot name="x">              Content projection point
 *   <link rel="mn-import" href="">  Import external component
 *
 * ── Global state ────────────────────────────────────────────────────────────
 *   <mn-store name value>           Global shared state ($store.name)
 *
 * ── HTMX integration ───────────────────────────────────────────────────────
 *   Works automatically. A MutationObserver initialises new [mn] elements
 *   when HTMX swaps content. HTMX events work with <mn-on> directly:
 *     <mn-on event="htmx:before-request">(to loading)</mn-on>
 *     <mn-on event="htmx:after-swap">(to ready)</mn-on>
 *   No bridge. No coupling. Just standard DOM events.
 *
 * @version 0.5.0
 * @license MIT
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory(require('./engine'));
  } else if (typeof define === 'function' && define.amd) {
    define(['./engine'], factory);
  } else {
    root.MachineNative = factory(root.MPEngine);
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (engine) {

  // ── Engine aliases ─────────────────────────────────────────────────────
  // Local references to the shared engine. The engine is imported, not
  // embedded. Same evaluator runs in browser and Node.
  var _parse = engine.parse;
  var _seval = engine.seval;
  var _sevalPure = engine.sevalPure;
  var _eval = engine.eval;
  var _exec = engine.exec;
  var _makeScope = engine.makeScope;
  var _applyScope = engine.applyScope;
  var _get = engine.get;
  var _set = engine.set;
  var _depKey = engine.depKey;
  var _userFns = engine.userFns;

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  DOM runtime                                                            ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Everything below is browser-specific. The s-expression engine is imported
  // from mn/engine.js. This file handles DOM bindings, events, transitions,
  // templates, routing, and the MutationObserver lifecycle.
  //
  // To use: load engine.js first, then this file.
  //   <script src="mn/engine.js"></script>
  //   <script src="mn/browser.js"></script>

  // Query elements belonging to this machine (not nested child machines).
  // Rule: element belongs to its closest [mn] ancestor.
  // Compute ancestor path from a dot-separated state name.
  // 'running.filling' → ['running.filling', 'running']
  function _stateAncestors(s) {
    var a = []; var p = s;
    while (p) { a.push(p); var dot = p.lastIndexOf('.'); p = dot === -1 ? null : p.substring(0, dot); }
    return a;
  }

  // Compute exit and enter paths for a hierarchical transition via LCA.
  function _transitionPaths(prev, target) {
    var prevAnc = prev ? _stateAncestors(prev) : [];
    var targetAnc = _stateAncestors(target);
    var lca = null;
    for (var i = 0; i < targetAnc.length; i++) {
      if (prevAnc.indexOf(targetAnc[i]) !== -1) { lca = targetAnc[i]; break; }
    }
    var exitPath = [];
    for (var j = 0; j < prevAnc.length; j++) {
      if (prevAnc[j] === lca) break;
      exitPath.push(prevAnc[j]);
    }
    var enterPath = [];
    for (var k = targetAnc.length - 1; k >= 0; k--) {
      if (targetAnc[k] === lca) continue;
      enterPath.push(targetAnc[k]);
    }
    return { exitPath: exitPath, enterPath: enterPath };
  }

  function _ownElements(machineEl, selector) {
    var all = machineEl.querySelectorAll(selector);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].closest('[mn]') === machineEl) out.push(all[i]);
    }
    return out;
  }


  // Parse <mn-transition> elements inside a state element.
  // Returns a map of event name → { target, guard, action, emit }.
  // Removes the elements from the DOM after parsing (they are structural, not visual).
  function _parseTransitions(stateEl, machineEl) {
    var transitions = {};
    var els = stateEl.querySelectorAll('mn-transition');
    for (var i = 0; i < els.length; i++) {
      var tel = els[i];
      if (tel.closest('[mn]') !== machineEl) continue;
      var event = tel.getAttribute('event');
      if (!event) continue;
      var def = {
        target: tel.getAttribute('to') || null,
        guard: null,
        action: null,
        emit: null
      };
      var guardEl = tel.querySelector('mn-guard');
      if (guardEl) def.guard = guardEl.textContent.trim();
      var actionEl = tel.querySelector('mn-action');
      if (actionEl) def.action = actionEl.textContent.trim();
      var emitEl = tel.querySelector('mn-emit');
      if (emitEl) def.emit = emitEl.textContent.trim();
      if (!transitions[event]) transitions[event] = [];
      transitions[event].push(def);
      tel.remove();
    }
    return transitions;
  }

  // Build a merged scope for an mn-each item.
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

  // Build $refs map from mn-ref elements owned by this machine.
  function _buildRefs(machineEl) {
    var refs = {};
    var refEls = _ownElements(machineEl, '[mn-ref]');
    for (var i = 0; i < refEls.length; i++) refs[refEls[i].getAttribute('mn-ref')] = refEls[i];
    return refs;
  }

  // Safe querySelectorAll — returns [] for text nodes that lack the method.
  function _querySafe(el, selector) {
    return el.querySelectorAll ? el.querySelectorAll(selector) : [];
  }

  // Walk up from el to find the closest mn-each item scope.
  // Returns the item scope if found, otherwise the machine's context.
  function _scopeFor(el, machineEl, ctx) {
    var cur = el;
    while (cur && cur !== machineEl) {
      if (cur._mnItemScope) return cur._mnItemScope;
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
  // (emit name) in s-expressions dispatches named events. mn-receive listens.
  //
  // Emit:    <mn-transition event="save" to="done"><mn-emit>saved</mn-emit></mn-transition>
  // Receive: <mn-receive event="saved">(to show)</mn-receive>
  //
  // Receive elements are parsed at init time and stored as event listeners.
  // $detail holds the payload from emit. Events do not bubble cross-machine.

  var _events = {};

  function _regReceive(inst) {
    // Parse <mn-receive event="x">body</mn-receive> elements directly.
    // Each element registers one event handler. No attribute synthesis.
    var recEls = inst.el.querySelectorAll('mn-receive');
    for (var ri = 0; ri < recEls.length; ri++) {
      if (recEls[ri].closest('[mn]') !== inst.el) continue;
      var evName = recEls[ri].getAttribute('event');
      var bodyText = recEls[ri].textContent.trim();
      if (!evName || !bodyText) continue;
      recEls[ri].remove();

      var body = _parse(bodyText);

      (function (name, bodyExpr, machine) {
        if (!_events[name]) {
          _events[name] = [];
          var handler = function (e) {
            var list = _events[name];
            for (var j = 0; j < list.length; j++) {
              var entry = list[j];
              if (entry.inst.el === e.detail.source) continue;

              var scope = _makeScope(entry.inst.ctx, entry.inst.state, entry.inst.el);
              scope.$detail = e.detail.payload;
              scope.__mnInst = entry.inst;
              _seval(entry.body, scope);
              _applyScope(scope, entry.inst.ctx, entry.inst);
              if (scope.__mnEmit) entry.inst.emit(scope.__mnEmit, scope.__mnEmitPayload);
              if (scope.__mnTo) {
                entry.inst.to(scope.__mnTo);
              } else {
                entry.inst.update();
              }
            }
          };
          document.addEventListener('mn-' + name, handler);
          _events[name]._handler = handler;
        }
        _events[name].push({ inst: machine, body: bodyExpr });
      })(evName, body, inst);
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  DOM event binding (<mn-on>)                                            ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Attach DOM event listeners parsed from <mn-on event="EVENT.MODIFIERS">.
  // Called during machine init and after mn-each cloning.

  function _attachDomEvents(container, inst) {
    var all = container.querySelectorAll('*');
    var check = function (el) {
      if (el._mnEventsBound) return;
      if (el.closest('[mn]') !== inst.el) return;
      if (el._mnOnHandlers) {
        for (var i = 0; i < el._mnOnHandlers.length; i++) {
          _bindOneEvent(el, el._mnOnHandlers[i].event, el._mnOnHandlers[i].expr, inst);
        }
      }
      el._mnEventsBound = true;
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

      // Apply modifiers
      if (mods.indexOf('prevent') !== -1) e.preventDefault();
      if (mods.indexOf('stop') !== -1) e.stopPropagation();

      // mn-on:EVENT always takes an s-expression
      scope.__mnEvent = e;
      scope.__mnInst = inst;
      _seval(_parse(targetState), scope);
      _applyScope(scope, inst.ctx, inst);
      if (scope.__mnEmit) inst.emit(scope.__mnEmit, scope.__mnEmitPayload);
      if (scope.__mnTo) inst.to(scope.__mnTo);
      else inst.update();
    };

    var target = isOutside ? document : el;
    var opts = mods.indexOf('once') !== -1 ? { once: true } : false;
    target.addEventListener(evName, handler, opts);
    // Track document-level listeners for cleanup when the machine is destroyed
    if (isOutside) {
      if (!inst.el._mnCleanups) inst.el._mnCleanups = [];
      inst.el._mnCleanups.push(function () { document.removeEventListener(evName, handler); });
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Structural element binding setup                                       ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Scans for structural binding elements (mn-text, mn-show, mn-class,
  // mn-bind, mn-on, mn-each, mn-transition) and caches the bindings
  // on the parent element for fast processing during update().

  // perf: void elements cannot have DOM children — define once, reuse in the loop.
  var _voidTags = ['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'];

  function _scanBindAttrs(container, machineEl) {
    // Parse structural binding elements: <mn-text>, <mn-show>, <mn-class>, <mn-bind>
    // Store parsed data directly on parent element properties — never as attributes.
    // The structural elements are removed from the DOM after parsing.
    var bindEls = container.querySelectorAll('mn-text, mn-show, mn-class, mn-bind');
    var toRemove = [];
    for (var bi = 0; bi < bindEls.length; bi++) {
      var bel = bindEls[bi];
      if (bel.closest('[mn]') !== machineEl) continue;
      var parent = bel.parentElement;
      if (!parent) continue;
      var tag = bel.tagName.toLowerCase();
      var expr = bel.textContent.trim();

      if (!parent._mnBind) parent._mnBind = {};

      if (tag === 'mn-text') {
        parent._mnBind.text = expr;
      } else if (tag === 'mn-show') {
        if (!parent.hasAttribute('mn-state')) parent._mnBind.show = expr;
      } else if (tag === 'mn-class') {
        parent._mnBind.classExpr = expr;
        var parsed = _parse(expr.trim());
        parent._mnBind.classParsed = (Array.isArray(parsed) && parsed[0] && parsed[0].t === 'Y' && parsed[0].v === 'do')
          ? parsed.slice(1) : [parsed];
      } else if (tag === 'mn-bind') {
        var bindAttr = bel.getAttribute('attr');
        if (bindAttr) {
          // Void elements (img, input, etc.) cannot have DOM children — the HTML parser
          // re-parents <mn-bind> as a sibling. Detect this via previousElementSibling
          // and redirect the binding to the intended void element.
          var prevSib = bel.previousElementSibling;
          var bindTarget = (prevSib && _voidTags.indexOf(prevSib.tagName.toLowerCase()) !== -1) ? prevSib : parent;
          if (!bindTarget._mnBind) bindTarget._mnBind = {};
          if (!bindTarget._mnBindAttrs) bindTarget._mnBindAttrs = [];
          bindTarget._mnBindAttrs.push({ attr: bindAttr, expr: expr });
          bindTarget.setAttribute('data-mn-bind', '');
        }
        toRemove.push(bel);
        continue;
      }
      parent.setAttribute('data-mn-bind', '');
      toRemove.push(bel);
    }
    for (var ri = 0; ri < toRemove.length; ri++) toRemove[ri].remove();

    // Parse <mn-on event="x"> elements — store handlers on parent for _attachDomEvents
    var onEls = container.querySelectorAll('mn-on');
    var onRemove = [];
    for (var oi = 0; oi < onEls.length; oi++) {
      var oel = onEls[oi];
      if (oel.closest('[mn]') !== machineEl) continue;
      var onEvent = oel.getAttribute('event');
      var onExpr = oel.textContent.trim();
      if (onEvent && onExpr) {
        var onParent = oel.parentElement;
        if (onParent) {
          if (!onParent._mnOnHandlers) onParent._mnOnHandlers = [];
          onParent._mnOnHandlers.push({ event: onEvent, expr: onExpr });
        }
      }
      onRemove.push(oel);
    }
    for (var ori = 0; ori < onRemove.length; ori++) onRemove[ori].remove();

    // Parse <mn-each>expr</mn-each> inside <template> elements.
    // Template content is a DocumentFragment, so querySelectorAll from
    // the container won't find it. Scan template elements directly.
    var templates = container.querySelectorAll('template[mn-key], template[mn-each]');
    for (var tmi = 0; tmi < templates.length; tmi++) {
      var tmpl = templates[tmi];
      if (tmpl.closest('[mn]') !== machineEl) continue;
      var eachEl = tmpl.content.querySelector('mn-each');
      if (eachEl) {
        tmpl._mnEachExpr = eachEl.textContent.trim();
        if (!tmpl.hasAttribute('mn-each')) tmpl.setAttribute('mn-each', '');
        eachEl.remove();
      }
      // Parse <mn-transition> from template content — they define transitions
      // available to mn-to buttons rendered inside each item. Parsed here so
      // they are removed from the template before cloning and available to the
      // mn-to click handler via the pre-parsed transitions map.
      var tplTrans = tmpl.content.querySelectorAll('mn-transition');
      if (tplTrans.length > 0) {
        if (!tmpl._mnTransitions) tmpl._mnTransitions = {};
        for (var tti = 0; tti < tplTrans.length; tti++) {
          var ttel = tplTrans[tti];
          var ttEvent = ttel.getAttribute('event');
          if (!ttEvent) continue;
          var ttDef = { target: ttel.getAttribute('to') || null, guard: null, action: null, emit: null };
          var ttg = ttel.querySelector('mn-guard');
          if (ttg) ttDef.guard = ttg.textContent.trim();
          var tta = ttel.querySelector('mn-action');
          if (tta) ttDef.action = tta.textContent.trim();
          var tte = ttel.querySelector('mn-emit');
          if (tte) ttDef.emit = tte.textContent.trim();
          if (!tmpl._mnTransitions[ttEvent]) tmpl._mnTransitions[ttEvent] = [];
          tmpl._mnTransitions[ttEvent].push(ttDef);
          ttel.remove();
        }
      }
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  CSS transition engine (mn-temporal)                                  ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // When a state contains an mn-temporal element, entering and leaving
  // are animated via CSS classes instead of instant show/hide.
  //
  // Enter sequence (state becomes active):
  //   Frame 0: add mn-enter-from, mn-enter-active. Remove hidden.
  //   Frame 1: remove mn-enter-from, add mn-enter-to.
  //   After transition ends: remove mn-enter-active, mn-enter-to.
  //
  // Leave sequence (state becomes inactive):
  //   Frame 0: add mn-leave-from, mn-leave-active.
  //   Frame 1: remove mn-leave-from, add mn-leave-to.
  //   After transition ends: remove mn-leave-active, mn-leave-to. Set hidden.
  //
  // Usage with CSS:
  //   .mn-enter-active, .mn-leave-active { transition: all 0.2s ease; }
  //   .mn-enter-from, .mn-leave-to { opacity: 0; transform: scale(0.95); }

  function _transitionEnter(el) {
    el._mnLeaving = false; // cancel any pending leave
    // Clean up any in-progress leave transition classes
    el.classList.remove('mn-leave-from', 'mn-leave-active', 'mn-leave-to');
    el.hidden = false;
    el.classList.add('mn-enter-from', 'mn-enter-active');
    el.offsetHeight; // perf: force reflow so browser sees from-state before transitioning
    requestAnimationFrame(function () {
      el.classList.remove('mn-enter-from');
      el.classList.add('mn-enter-to');
      _onTransitionEnd(el, function () {
        el.classList.remove('mn-enter-active', 'mn-enter-to');
      });
    });
  }

  function _transitionLeave(el, cb) {
    el._mnLeaving = true;
    // Clean up any in-progress enter transition classes
    el.classList.remove('mn-enter-from', 'mn-enter-active', 'mn-enter-to');
    el.classList.add('mn-leave-from', 'mn-leave-active');
    el.offsetHeight; // perf: force reflow so browser sees from-state before transitioning
    requestAnimationFrame(function () {
      el.classList.remove('mn-leave-from');
      el.classList.add('mn-leave-to');
      _onTransitionEnd(el, function () {
        el.classList.remove('mn-leave-active', 'mn-leave-to');
        // Only hide if still leaving (not re-entered)
        if (el._mnLeaving) {
          el.hidden = true;
          el._mnLeaving = false;
        }
        if (cb) cb();
      });
    });
  }

  function _maxDuration(durString) {
    if (!durString) return 0;
    var parts = durString.split(',');
    var max = 0;
    for (var i = 0; i < parts.length; i++) {
      var trimmed = parts[i].trim();
      var v = parseFloat(trimmed) || 0;
      // CSS durations in 's' are the base unit; 'ms' values are converted to seconds
      if (trimmed.indexOf('ms') !== -1) v = v / 1000;
      if (v > max) max = v;
    }
    return max;
  }

  function _onTransitionEnd(el, cb) {
    var style = getComputedStyle(el);
    var dur = _maxDuration(style.transitionDuration);
    var animDur = _maxDuration(style.animationDuration);
    var total = Math.max(dur, animDur);
    if (total === 0) {
      cb();
    } else {
      var called = false;
      var done = function () {
        if (called) return;
        called = true;
        el.removeEventListener('transitionend', done);
        el.removeEventListener('animationend', done);
        clearTimeout(fallback);
        cb();
      };
      el.addEventListener('transitionend', done);
      el.addEventListener('animationend', done);
      // Safety net: if the event never fires (element hidden, property not animated),
      // fall back after the computed duration. No fudge factor needed — the native
      // event handles the normal case; this only fires for edge cases.
      var fallback = setTimeout(done, total * 1000 + 50);
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  mn-each: list rendering                                                ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // <template mn-each="items" mn-key="id">
  //   <div><span mn-text="name"></span></div>
  // </template>
  //
  // Renders template content for each item in the array. If mn-key is set,
  // uses keyed reconciliation (add/remove only, preserves existing DOM and
  // machine state). Without mn-key, does full re-render each update.
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
    if (dirty) { mpInst._mnDirty = dirty; mpInst.update(); }
  }

  function _updateEach(machineEl, inst) {
    var tmpls = _ownElements(machineEl, 'template[mn-each]');
    for (var t = 0; t < tmpls.length; t++) {
      var tmpl = tmpls[t];
      var expr = tmpl._mnEachExpr || tmpl.getAttribute('mn-each');
      var keyExpr = tmpl.getAttribute('mn-key');
      if (!keyExpr && engine.debug) console.warn('[mn] mn-each without mn-key causes full re-render on every update. Add mn-key for efficient reconciliation.');
      var items = _eval(expr, inst.ctx, inst.state, tmpl);
      if (!Array.isArray(items)) {
        if (engine.debug && items != null) console.warn('[mn] mn-each expression "' + expr + '" evaluated to ' + typeof items + ', not an array. Treating as empty list.');
        items = [];
      }

      // Initialize tracking structures
      if (!tmpl._mnMarker) {
        tmpl._mnMarker = document.createComment('mn-each-end');
        tmpl.parentNode.insertBefore(tmpl._mnMarker, tmpl.nextSibling);
        tmpl._mnRendered = [];    // rendered root elements (ordered)
        tmpl._mnKeyMap = {};    // key → element map (keyed mode only)
      }
      var marker = tmpl._mnMarker;
      var rendered = tmpl._mnRendered;
      var parent = tmpl.parentNode;

      if (keyExpr) {
        // ── Keyed reconciliation ─────────────────────────────────────
        var newKeys = [];
        var newMap = {};
        for (var i = 0; i < items.length; i++) {
          var scope = _itemCtx(inst.ctx, items[i], i);
          var key = String(_eval(keyExpr, scope, inst.state, tmpl));
          if (newMap[key]) {
            console.warn('[mn] duplicate mn-key="' + key + '" in mn-each. Only the first item with this key will render. Keys must be unique.');
            continue;
          }
          newKeys.push(key);
          newMap[key] = { item: items[i], index: i, scope: scope };
        }

        // Remove elements for deleted keys
        var oldKeyMap = tmpl._mnKeyMap;
        for (var k in oldKeyMap) {
          if (!newMap[k]) {
            oldKeyMap[k].remove();
            delete oldKeyMap[k];
            inst._mnBindCache = null; // DOM changed
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
            el._mnItemScope = newMap[key].scope;
            // perf: only call update on child machines whose data actually changed
            var uItem = newMap[key].item;
            if (uItem && typeof uItem === 'object') {
              if (el._mn) _diffChild(el._mn, uItem);
              var uNested = _querySafe(el, '[mn]');
              for (var ni = 0; ni < uNested.length; ni++) {
                if (uNested[ni]._mn) _diffChild(uNested[ni]._mn, uItem);
              }
            }
            // perf: skip insertBefore when already in position (avoids MutationObserver churn)
            if (el !== cursor) {
              parent.insertBefore(el, cursor || marker);
            }
            // Advance cursor in both branches — after insertBefore the element IS at
            // the cursor position, so the next expected position is el.nextSibling.
            cursor = el.nextSibling;
            while (cursor && cursor !== marker && cursor.nodeType !== 1) cursor = cursor.nextSibling;
          } else {
            // ── New item: clone, stamp context, initialize ──
            var frag = tmpl.content.cloneNode(true);
            el = frag.firstElementChild;
            if (!el) { el = frag.firstChild; }
            el._mnItemScope = newMap[key].scope;
            // Nested [mn] elements need mn-ctx so _createInstance reads their initial data
            var kItemJson = JSON.stringify(newMap[key].item);
            if (el.hasAttribute && el.hasAttribute('mn')) {
              el.setAttribute('mn-ctx', kItemJson);
            }
            var kNested = _querySafe(el, '[mn]');
            for (var ni = 0; ni < kNested.length; ni++) {
              kNested[ni].setAttribute('mn-ctx', kItemJson);
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
        if (domChanged) inst._mnBindCache = null;

        tmpl._mnKeyMap = oldKeyMap;
        tmpl._mnRendered = newKeys.map(function (k) { return oldKeyMap[k]; });

      } else {
        // ── Non-keyed: full re-render ────────────────────────────────
        // Remove old
        for (var i = 0; i < rendered.length; i++) {
          rendered[i].remove();
        }
        rendered.length = 0;
        inst._mnBindCache = null; // DOM changed

        // Create new
        for (var i = 0; i < items.length; i++) {
          var frag = tmpl.content.cloneNode(true);
          var el = frag.firstElementChild;
          if (!el) el = frag.firstChild;
          el._mnItemScope = _itemCtx(inst.ctx, items[i], i);
          // Set mn-ctx on ALL [mn] elements in the item (root + nested)
          var itemJson = JSON.stringify(items[i]);
          if (el.hasAttribute && el.hasAttribute('mn')) {
            el.setAttribute('mn-ctx', itemJson);
          }
          var nestedMp = _querySafe(el, '[mn]');
          for (var ni = 0; ni < nestedMp.length; ni++) {
            nestedMp[ni].setAttribute('mn-ctx', itemJson);
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

  // Initialize any [mn] elements within a container
  function _initNested(container) {
    if (container.hasAttribute && container.hasAttribute('mn') && !container._mn) {
      _createInstance(container);
    }
    var nested = _querySafe(container, '[mn]');
    for (var i = 0; i < nested.length; i++) {
      if (!nested[i]._mn) _createInstance(nested[i]);
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Machine instance                                                       ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // A machine instance is created for each [mn] element. It holds the
  // current state, context data, and methods to transition and update.
  // Templates, stores, and imports are module-level registries shared
  // across all instances.

  var _templates = {};

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  mn-store — Global shared state                                         ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // <mn-store name="user" value='{"name":"Andrew","role":"geologist"}'></mn-store>
  //
  // Accessible in ANY machine as $store.user.name. Shared by reference —
  // when one machine writes $store.user.name = 'New', all machines see it
  // on their next update. Use (emit name) inside mn-to to notify other machines.

  var _store = {};

  function _processStores(root) {
    var els = root.querySelectorAll('mn-store');
    for (var i = 0; i < els.length; i++) {
      var name = els[i].getAttribute('name');
      var val = els[i].getAttribute('value');
      // Only initialize if the store key has never been set — re-calling init()
      // (e.g. after an HTMX swap) must not overwrite runtime-mutated store values.
      if (name && !_store.hasOwnProperty(name)) {
        try { _store[name] = val ? JSON.parse(val) : {}; }
        catch (err) { console.warn('[mn] mn-store name="' + name + '" has invalid JSON in value attribute. Check your quotes and syntax. Error: ' + err.message); _store[name] = {}; }
      }
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  mn-import — Markup module system                                       ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // <link rel="mn-import" href="/components/note-card.mn.html">
  //
  // Fetches .mn.html files, parses them, and registers any <template mn-define>
  // blocks they contain. This is the module/import system for markup — files
  // become modules, templates become exports. No bundler, no import statements,
  // no build step.
  //
  // All imports are fetched in parallel and must complete before machines
  // are initialized (templates need to exist before they're cloned).
  //
  // .mn.html files can contain:
  //   - <template mn-define="name"> blocks (component definitions)
  //   - <mn-store> elements (shared state declarations)
  //   - <style> blocks (component styles)

  function _loadImports(root) {
    root = root || document;
    var links = root.querySelectorAll('link[rel="mn-import"]');
    if (links.length === 0) return Promise.resolve();

    // Try XMLHttpRequest first (works from file:// in most browsers),
    // fall back to fetch (works on http/https).
    function loadFile(href) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', href, true);
        xhr.onload = function () {
          if (xhr.status === 0 || xhr.status === 200) resolve(xhr.responseText);
          else reject(new Error('[mn] import failed: ' + href + ' (' + xhr.status + ')'));
        };
        xhr.onerror = function () {
          reject(new Error('[mn] import failed: ' + href));
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
          console.warn('[mn] import skipped:', href, '— use a server for mn-import, or inline templates with <template mn-define>');
          return null;
        }));
      })(links[i].getAttribute('href'));
    }

    return Promise.all(fetches).then(function (texts) {
      for (var i = 0; i < texts.length; i++) {
        if (!texts[i]) continue; // skipped import (failed gracefully)
        var doc = new DOMParser().parseFromString(texts[i], 'text/html');
        // Register templates
        var tmpls = doc.querySelectorAll('template[mn-define]');
        for (var j = 0; j < tmpls.length; j++) {
          // Import the template into the current document so it can be cloned
          var imported = document.importNode(tmpls[j], true);
          _templates[imported.getAttribute('mn-define')] = imported;
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
  // If a <template mn-define="name"> exists for a machine, clone it into
  // the machine element. Before cloning, save the element's children as
  // slot content. Named slots match by attribute, unnamed slots get the rest.

  function _resolveTemplate(el, name) {
    // Only warn if the machine has no inline states AND no matching template
    if (!_templates[name] && name && !el.querySelector('[mn-state]')) {
      console.warn('[mn] no template for "' + name + '". Available:', Object.keys(_templates).join(', '));
    }
    if (!_templates[name] || el.querySelector('[mn-state]')) return;

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

    // Replace <mn-slot> placeholders with provided content (or unwrap defaults)
    var slots = el.querySelectorAll('mn-slot');
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




  // ── Machine setup ───────────────────────────────────────────────────
  //
  // Parse context, restore persistence, discover states, save content
  // as lazy-rendering templates, stamp the initial state.

  function _initMachine(el, name) {
    _resolveTemplate(el, name);

    // Context from mn-ctx attribute or <mn-ctx> element, with mn-persist overlay
    var ctxAttr = el.getAttribute('mn-ctx');
    var ctxEl = el.querySelector('mn-ctx');
    if (ctxEl && ctxEl.closest('[mn]') === el) {
      ctxAttr = ctxEl.textContent.trim();
      ctxEl.remove();
    }
    var ctx = {};
    if (ctxAttr) {
      try { ctx = JSON.parse(ctxAttr); }
      catch (err) { console.warn('[mn] mn-ctx on machine "' + name + '" has invalid JSON. Check your quotes and syntax. Error: ' + err.message); }
    }
    var persistKey = el.getAttribute('mn-persist');
    if (persistKey) {
      try {
        var saved = JSON.parse(localStorage.getItem('mn-' + persistKey) || '{}');
        for (var k in saved) if (saved.hasOwnProperty(k)) ctx[k] = saved[k];
      } catch (e) { /* ignore corrupt localStorage */ }
    }
    ctx.$store = _store;
    ctx.$refs = _buildRefs(el);

    // Discover states recursively (handles compound/hierarchical states).
    // A compound state is an mn-state that contains child mn-state elements.
    // Content OUTSIDE child mn-state elements is "chrome" (always visible
    // when the compound state is active). Child mn-state content is templated
    // and shown/hidden on internal transitions.
    var stateMap = {};
    var stateNames = [];
    var stateTmpls = {};
    var compoundChromes = {}; // compound state dot-path → chrome template

    function _discoverStates(parentEl, prefix) {
      // Find direct child mn-state elements (not deeper nested)
      var children = parentEl.querySelectorAll('[mn-state]');
      var directChildren = [];
      for (var i = 0; i < children.length; i++) {
        // Must belong to this machine, not a nested [mn]
        if (children[i].closest('[mn]') !== el) continue;
        // Must be a direct child of parentEl (not nested inside another mn-state at this level)
        var parentState = children[i].parentElement ? children[i].parentElement.closest('[mn-state]') : null;
        if (parentState && parentState.closest('[mn]') === el) {
          // This mn-state is inside another mn-state in the same machine
          // Only include if the parent mn-state is parentEl itself
          if (parentState !== parentEl) continue;
        } else if (parentEl !== el) {
          continue;
        }
        directChildren.push(children[i]);
      }

      for (var j = 0; j < directChildren.length; j++) {
        var childEl = directChildren[j];
        var shortName = childEl.getAttribute('mn-state');
        var fullPath = prefix ? prefix + '.' + shortName : shortName;

        stateMap[fullPath] = childEl;
        stateNames.push(fullPath);

        // ── Parse lifecycle elements before content is templated ─────
        // Store on state element properties. The elements are removed so
        // templates don't contain them — the properties persist on the
        // state element across enter/exit cycles.
        var _findOwned = function (tag) {
          var found = childEl.querySelector(tag);
          if (found && found.closest('[mn-state]') === childEl && found.closest('[mn]') === el) return found;
          return null;
        };
        var lcEl;
        lcEl = _findOwned('mn-init');
        if (lcEl) { childEl._mnInit = lcEl.textContent.trim(); lcEl.remove(); }
        lcEl = _findOwned('mn-exit');
        if (lcEl) { childEl._mnExit = lcEl.textContent.trim(); lcEl.remove(); }
        lcEl = _findOwned('mn-temporal');
        if (lcEl) { childEl._mnTemporal = lcEl.textContent.trim(); lcEl.remove(); }
        lcEl = _findOwned('mn-where');
        if (lcEl) { childEl._mnWhere = lcEl.textContent.trim(); lcEl.remove(); }
        // mn-url: bare attribute or <mn-url> element
        if (childEl.hasAttribute('mn-url')) childEl._mnUrlRaw = childEl.getAttribute('mn-url');
        lcEl = _findOwned('mn-url');
        if (lcEl) { childEl._mnUrlRaw = lcEl.textContent.trim(); lcEl.remove(); }

        // Check for nested mn-state elements (compound state)
        var nestedStates = childEl.querySelectorAll('[mn-state]');
        var hasChildren = false;
        for (var k = 0; k < nestedStates.length; k++) {
          if (nestedStates[k].closest('[mn]') === el) {
            var nsParent = nestedStates[k].parentElement ? nestedStates[k].parentElement.closest('[mn-state]') : null;
            if (nsParent === childEl) { hasChildren = true; break; }
          }
        }

        if (hasChildren) {
          // Compound state: separate chrome (non-mn-state children) from child states
          var chromeTmpl = document.createElement('template');
          var childNodes = Array.prototype.slice.call(childEl.childNodes);
          for (var cn = 0; cn < childNodes.length; cn++) {
            var node = childNodes[cn];
            if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('mn-state')) continue;
            chromeTmpl.content.appendChild(node);
          }
          compoundChromes[fullPath] = chromeTmpl;
          // Don't template the whole compound state — children are templated individually
          stateTmpls[fullPath] = null;
          childEl.hidden = true;
          // Recurse into children
          _discoverStates(childEl, fullPath);
        } else {
          // Atomic state: template all content.
          // Template stays in the DOM so outerHTML captures the full machine
          // definition for transport. <template> is inert — no rendering cost.
          var tmpl = document.createElement('template');
          tmpl.setAttribute('mn-state-template', fullPath);
          while (childEl.firstChild) tmpl.content.appendChild(childEl.firstChild);
          stateTmpls[fullPath] = tmpl;
          childEl.after(tmpl);
          // mn-where states get a loading indicator — shown while the server
          // response is in flight. Customisable via mn-loading attribute.
          if (childEl._mnWhere) {
            childEl.innerHTML = childEl.getAttribute('mn-loading') || _defaultLoading;
          }
          childEl.hidden = true;
        }
      }
    }

    _discoverStates(el, null);

    // Machine-level <mn-init> — not inside any state
    var machineInitEl = el.querySelector('mn-init');
    if (machineInitEl && machineInitEl.closest('[mn]') === el) {
      el._mnInit = machineInitEl.textContent.trim();
      machineInitEl.remove();
    }

    // Determine initial state (may need to descend into compound)
    var initial = el.getAttribute('mn-initial') || stateNames[0] || null;
    if (initial) {
      // Descend to atomic initial child if compound
      while (compoundChromes[initial]) {
        // Show compound and stamp chrome
        stateMap[initial].hidden = false;
        stateMap[initial].appendChild(compoundChromes[initial].content.cloneNode(true));
        // Find first child state
        var childPrefix = initial + '.';
        var firstChild = null;
        for (var si = 0; si < stateNames.length; si++) {
          if (stateNames[si].indexOf(childPrefix) === 0 && stateNames[si].indexOf('.', childPrefix.length) === -1) {
            firstChild = stateNames[si];
            break;
          }
        }
        if (!firstChild) break;
        initial = firstChild;
      }
      // Show and stamp the atomic initial state
      if (stateTmpls[initial]) {
        stateMap[initial].appendChild(stateTmpls[initial].content.cloneNode(true));
        stateMap[initial].hidden = false;
      }
    }

    return { ctx: ctx, persistKey: persistKey, stateMap: stateMap, stateNames: stateNames, stateTmpls: stateTmpls, compoundChromes: compoundChromes, initial: initial };
  }


  // ── Binding application ───────────────────────────────────────────────
  //
  // The body of inst.update(). Extracted so _createInstance stays under
  // 150 lines. Runs mn-each, builds/uses the binding cache with
  // dependency tracking, applies all binding types, persists to localStorage.

  function _applyBindings(machineEl, inst, persistKey) {
    var state = inst.state;
    var ctx = inst.ctx;
    var dirty = inst._mnDirty;
    inst._mnDirty = null;

    // ── Phase 1: List rendering (may create new DOM) ─────────
    _updateEach(machineEl, inst);

    // ── Phase 1b: Evaluate mn-let computed bindings ─────────
    // Must run before the binding cache is built so computed values
    // are in ctx when dep tracking evaluates expressions like (not valid).
    if (inst._mnLet) {
      var letScope = _makeScope(ctx, state, machineEl);
      for (var li = 0; li < inst._mnLet.length; li++) {
        var lb = inst._mnLet[li];
        var prev = ctx[lb.name];
        var val = _sevalPure(lb.ast, letScope);
        ctx[lb.name] = val;
        if (val !== prev && dirty) dirty[_depKey(lb.name)] = true;
      }
    }

    // ── Phase 2: Build or refresh binding cache ─────────────
    // First render (or after DOM structure change): scan for bound
    // elements, evaluate each binding once to discover its deps.
    // perf: subsequent renders skip this entirely.
    if (!inst._mnBindCache) {
      var all = machineEl.querySelectorAll('[mn-text],[mn-model],[mn-show],[data-mn-bind]');
      inst._mnBindCache = [];
      for (var i = 0; i < all.length; i++) {
        var elem = all[i];
        if (elem.closest('[mn]') !== machineEl) continue;
        // Build per-element binding descriptor. _mnBind may already be
        // populated by the element parser (_scanBindAttrs). Merge in any
        // bare-word attributes that weren't set by the parser.
        if (!elem._mnBind) elem._mnBind = {};
        if (!elem._mnBind.text) {
          var textAttr = elem.getAttribute('mn-text');
          if (textAttr) elem._mnBind.text = textAttr;
        }
        if (!elem._mnBind.model) {
          var modelAttr = elem.getAttribute('mn-model');
          if (modelAttr) {
            var tag = elem.tagName.toLowerCase();
            if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') {
              console.warn('[mn] mn-model="' + modelAttr + '" on <' + tag + '> — only <input>, <select>, and <textarea> support two-way binding.');
            }
            elem._mnBind.model = modelAttr;
          }
        }
        if (!elem._mnBind.show && elem.hasAttribute('mn-show') && !elem.hasAttribute('mn-state')) {
          elem._mnBind.show = elem.getAttribute('mn-show');
        }
        // Track deps: evaluate with tracking enabled to discover
        // which context keys this element's bindings read.
        var scope = _scopeFor(elem, machineEl, ctx);
        engine.startTracking();
        try {
          if (elem._mnBind.text) _eval(elem._mnBind.text, scope, state, elem);
          if (elem._mnBind.show) _eval(elem._mnBind.show, scope, state, elem);
          if (elem._mnBind.classExpr) for (var j = 0; j < elem._mnBind.classParsed.length; j++) _seval(elem._mnBind.classParsed[j], _makeScope(scope, state, elem));
          if (elem._mnBindAttrs) for (var j = 0; j < elem._mnBindAttrs.length; j++) _eval(elem._mnBindAttrs[j].expr, scope, state, elem);
        } catch (err) {
          engine.stopTracking();
          var tag = '<' + elem.tagName.toLowerCase();
          var failedExpr = elem._mnBind.text || elem._mnBind.show || elem._mnBind.classExpr || '?';
          throw new Error('[mn] error in ' + tag + '> expression "' + failedExpr + '": ' + err.message);
        }
        if (elem._mnBind.model) engine.addDep(_depKey(elem._mnBind.model));
        elem._mnBind.deps = engine.stopTracking();
        inst._mnBindCache.push(elem);
      }
      dirty = null; // first build — force full render below
    }

    // ── Phase 3: Apply bindings ──────────────────────────────
    // perf: skip elements whose tracked deps don't overlap dirty set
    var cache = inst._mnBindCache;
    for (var i = 0; i < cache.length; i++) {
      var bound = cache[i];
      var binding = bound._mnBind;

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
          bound.textContent = (val != null) ? val : '';
        }

        if (binding.model) {
          var val = _get(scope, binding.model);
          if (bound.type === 'checkbox') bound.checked = !!val;
          else if (bound.type === 'radio') bound.checked = (bound.value === val);
          else if (document.activeElement !== bound) bound.value = (val != null) ? val : '';
        }

        if (binding.show) {
          bound.hidden = !_eval(binding.show, scope, state, bound);
        }

        if (binding.classExpr) {
          var classScope = Object.create(scope); classScope.$state = state;
          if (!bound._mnPrevClasses) bound._mnPrevClasses = [];
          var prev = bound._mnPrevClasses;
          var next = [];
          for (var j = 0; j < binding.classParsed.length; j++) {
            var cls = _seval(binding.classParsed[j], classScope);
            if (cls && typeof cls === 'string') {
              var parts = cls.split(/\s+/);
              for (var k = 0; k < parts.length; k++) {
                if (parts[k]) { next.push(parts[k]); bound.classList.add(parts[k]); }
              }
            }
          }
          for (var j = 0; j < prev.length; j++) {
            if (next.indexOf(prev[j]) === -1) bound.classList.remove(prev[j]);
          }
          bound._mnPrevClasses = next;
        }

        if (bound._mnBindAttrs) {
          for (var j = 0; j < bound._mnBindAttrs.length; j++) {
            var val = _eval(bound._mnBindAttrs[j].expr, scope, state, bound);
            var attr = bound._mnBindAttrs[j].attr;
            if (_boolAttrs.indexOf(attr) !== -1) {
              if (val) bound.setAttribute(attr, ''); else bound.removeAttribute(attr);
            } else if (attr === 'class') {
              if (bound._mnOrigClass === undefined) bound._mnOrigClass = bound.className;
              bound.className = bound._mnOrigClass + (val ? ' ' + val : '');
            } else {
              if (val != null) bound.setAttribute(attr, val); else bound.removeAttribute(attr);
            }
          }
        }
      } catch (err) {
        // Report which element and binding failed, then re-throw
        var tag = '<' + bound.tagName.toLowerCase();
        var failedExpr = binding.text || binding.show || binding.classExpr || (bound._mnBindAttrs && bound._mnBindAttrs[0] && bound._mnBindAttrs[0].expr) || '?';
        throw new Error('[mn] error in ' + tag + '> expression "' + failedExpr + '": ' + err.message);
      }
    }

    // mn-bind-* on the machine element itself
    if (machineEl._mnBindAttrs) {
      var scope = _scopeFor(machineEl, machineEl, ctx);
      for (var j = 0; j < machineEl._mnBindAttrs.length; j++) {
        var val = _eval(machineEl._mnBindAttrs[j].expr, scope, state, machineEl);
        var attr = machineEl._mnBindAttrs[j].attr;
        if (_boolAttrs.indexOf(attr) !== -1) {
          if (val) machineEl.setAttribute(attr, ''); else machineEl.removeAttribute(attr);
        } else {
          if (val != null) machineEl.setAttribute(attr, val); else machineEl.removeAttribute(attr);
        }
      }
    }

    // ── Phase 4: Persist ─────────────────────────────────────
    // Exclude mn-let computed values — they are derived, not source data.
    var letKeys = null;
    if (inst._mnLet) {
      letKeys = {};
      for (var li = 0; li < inst._mnLet.length; li++) letKeys[inst._mnLet[li].name] = true;
    }
    if (persistKey) {
      var toSave = {};
      for (var k in ctx) {
        if (ctx.hasOwnProperty(k) && k.charAt(0) !== '$' && !(letKeys && letKeys[k])) toSave[k] = ctx[k];
      }
      try { localStorage.setItem('mn-' + persistKey, JSON.stringify(toSave)); }
      catch (e) { /* localStorage full or unavailable */ }
    }

    // ── Phase 5: Sync mn-ctx attribute ───────────────────────
    // The markup IS the state. Keep mn-ctx in sync so the
    // element's outerHTML is always a portable machine snapshot.
    var ctxSync = {};
    for (var k in ctx) {
      if (ctx.hasOwnProperty(k) && k.charAt(0) !== '$' && k.indexOf('__mn') !== 0 && !(letKeys && letKeys[k])) {
        ctxSync[k] = ctx[k];
      }
    }
    try { machineEl.setAttribute('mn-ctx', JSON.stringify(ctxSync)); }
    catch (e) { /* circular reference or similar */ }
  }


  // ── Post-init wiring ──────────────────────────────────────────────────
  //
  // After the inst object is created, wire up event receivers, scan for
  // bind attributes, attach DOM event listeners, init nested machines,
  // run the first render, evaluate temporal transitions, set up routing,
  // and run mn-init.

  function _wireInstance(el, inst, setup, evalTemporal) {
    _regReceive(inst);
    _scanBindAttrs(el, el);
    _attachDomEvents(el, inst);
    if (setup.initial && setup.stateMap[setup.initial]) {
      _initNested(setup.stateMap[setup.initial]);
      var initTransitions = _parseTransitions(setup.stateMap[setup.initial], el);
      if (!inst._transitions) inst._transitions = {};
      inst._transitions[setup.initial] = initTransitions;
    }
    inst.update();
    if (setup.initial && setup.stateMap[setup.initial]) evalTemporal(setup.stateMap[setup.initial], setup.initial);
    var initExpr = el._mnInit;
    if (initExpr) {
      setTimeout(function () { _exec(initExpr, setup.ctx, inst.state, el, null, inst); }, 0);
    }
    // Fire mn-init on the initial state (same as when to() enters a state)
    if (setup.initial && setup.stateMap[setup.initial] && setup.stateMap[setup.initial]._mnInit) {
      var stateInitExpr = setup.stateMap[setup.initial]._mnInit;
      setTimeout(function () { _exec(stateInitExpr, setup.ctx, inst.state, el, null, inst); }, 0);
    }
    // If the initial state has mn-where, trigger capability routing.
    // Wait for the route table to be available before routing.
    if (setup.initial && setup.stateMap[setup.initial] && setup.stateMap[setup.initial]._mnWhere) {
      var triggerRoute = function () {
        if (engine.debug) console.log('[mn-debug] initial mn-where: ' + inst.name + '/' + setup.initial + ' (' + _routeTable.length + ' nodes in route table)');
        inst.to(setup.initial);
      };
      if (_routeTableReady) {
        _routeTableReady.then(triggerRoute);
      } else {
        setTimeout(triggerRoute, 0);
      }
    }

    // ── URL routing: collect mn-url map, wire popstate, match initial URL ──
    // Iterate discovered states and check _mnUrlRaw property (set during
    // _discoverStates from mn-url attribute or <mn-url> element).
    var hasUrlStates = false;
    for (var usi = 0; usi < setup.stateNames.length; usi++) {
      if (setup.stateMap[setup.stateNames[usi]]._mnUrlRaw) { hasUrlStates = true; break; }
    }
    // Check if the current URL owner is still alive (in the document)
    if (_urlOwner && !document.contains(_urlOwner.el)) _urlOwner = null;
    if (hasUrlStates && !_urlOwner) {
      inst._urlMap = {};
      for (var ui = 0; ui < setup.stateNames.length; ui++) {
        var urlStateName = setup.stateNames[ui];
        var urlRaw = setup.stateMap[urlStateName]._mnUrlRaw;
        if (!urlRaw) continue;
        var urlParsed = _parseUrlAttr(urlRaw);
        if (urlParsed) inst._urlMap[urlStateName] = urlParsed;
      }
      _urlOwner = inst;

      // popstate: back/forward → match URL → transition
      var popHandler = function () {
        if (_urlOwner !== inst) return;
        var path = window.location.pathname;
        for (var state in inst._urlMap) {
          if (!inst._urlMap.hasOwnProperty(state)) continue;
          var entry = inst._urlMap[state];
          var matched = _matchUrl(path, entry.pattern, entry.params);
          if (matched) {
            for (var mk in matched) { if (matched.hasOwnProperty(mk)) inst.ctx[mk] = matched[mk]; }
            inst.to(state);
            return;
          }
        }
      };
      window.addEventListener('popstate', popHandler);
      if (!el._mnCleanups) el._mnCleanups = [];
      el._mnCleanups.push(function () {
        window.removeEventListener('popstate', popHandler);
        if (_urlOwner === inst) _urlOwner = null;
      });

      // Initial page load: match current URL to a state
      var loadPath = window.location.pathname;
      for (var state in inst._urlMap) {
        if (!inst._urlMap.hasOwnProperty(state)) continue;
        var entry = inst._urlMap[state];
        var matched = _matchUrl(loadPath, entry.pattern, entry.params);
        if (matched && state !== inst.state) {
          for (var mk in matched) { if (matched.hasOwnProperty(mk)) inst.ctx[mk] = matched[mk]; }
          // Defer so mn-where routing can use the route table
          (function (targetState) {
            var doNav = function () { inst.to(targetState); };
            if (_routeTableReady) _routeTableReady.then(doNav);
            else setTimeout(doNav, 0);
          })(state);
          break;
        }
      }

      // Push URL for the initial state if it has mn-url
      if (inst._urlMap[inst.state]) {
        var initEntry = inst._urlMap[inst.state];
        var initUrl = _resolveUrl(initEntry.pattern, initEntry.params, inst.ctx);
        if (window.history && window.history.replaceState) history.replaceState({ mpState: inst.state }, '', initUrl);
      }
    }
  }


  function _createInstance(el) {
    var name = el.getAttribute('mn');
    var setup = _initMachine(el, name);
    var ctx = setup.ctx;
    var stateMap = setup.stateMap;
    var stateNames = setup.stateNames;
    var stateTmpls = setup.stateTmpls;
    var compoundChromes = setup.compoundChromes;
    var persistKey = setup.persistKey;
    var initial = setup.initial;
    var afterTimer = null;
    var stateIntervals = [];
    // Expose for cleanup on machine destruction
    el._mnTimers = {
      getAfter: function () { return afterTimer; },
      clearAfter: function () { if (afterTimer) { clearTimeout(afterTimer); afterTimer = null; } },
      clearIntervals: function () { for (var i = 0; i < stateIntervals.length; i++) clearInterval(stateIntervals[i]); stateIntervals = []; }
    };

    // Evaluate mn-temporal s-expressions: (animate), (after ms expr), (every ms expr).
    // Defined here so it closes over afterTimer/stateIntervals/ctx/el/inst.
    // Called from to() on state entry and from post-init for the initial state.
    function _evalTemporal(stateEl, stateName) {
      var transVal = stateEl._mnTemporal;
      if (!transVal) return;
      var tScope = _makeScope(ctx, stateName, el);
      tScope.__mnAfterTimer = function (ms, bodyNode) {
        afterTimer = setTimeout(function () {
          afterTimer = null;
          var scope = _makeScope(inst.ctx, inst.state, el);
          scope.__mnInst = inst;
          _seval(bodyNode, scope);
          _applyScope(scope, inst.ctx, inst);
          if (scope.__mnEmit) inst.emit(scope.__mnEmit, scope.__mnEmitPayload);
          if (scope.__mnTo) inst.to(scope.__mnTo);
          else inst.update();
        }, ms);
      };
      tScope.__mnEveryInterval = function (ms, bodyNode) {
        var id = setInterval(function () {
          var scope = _makeScope(inst.ctx, inst.state, el);
          scope.__mnInst = inst;
          _seval(bodyNode, scope);
          _applyScope(scope, inst.ctx, inst);
          if (scope.__mnEmit) inst.emit(scope.__mnEmit, scope.__mnEmitPayload);
          if (scope.__mnTo) inst.to(scope.__mnTo);
          else inst.update();
        }, ms);
        stateIntervals.push(id);
      };
      tScope.__mnAnimate = function () {
        _transitionEnter(stateEl);
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
      // rebuilds $refs, calls update(), fires mn-state-change event,
      // evaluates mn-temporal temporal expressions.
      to: function (target, contentHtml) {

        // Resolve target: try as-is, then relative to current compound parent
        var resolvedTarget = null;
        if (stateNames.indexOf(target) !== -1) {
          resolvedTarget = target;
        } else {
          // Walk up from current state checking parent.target
          var parts = inst.state.split('.');
          for (var ri = parts.length - 1; ri >= 0; ri--) {
            var candidate = parts.slice(0, ri).concat(target).join('.');
            if (candidate && stateNames.indexOf(candidate) !== -1) {
              resolvedTarget = candidate;
              break;
            }
          }
        }
        if (!resolvedTarget) {
          console.warn('[mn] unknown state "' + target + '" in "' + name + '"');
          return false;
        }
        target = resolvedTarget;

        // If target is compound, descend to its initial atomic child
        while (compoundChromes[target]) {
          var childPrefix = target + '.';
          var firstChild = null;
          for (var fi = 0; fi < stateNames.length; fi++) {
            if (stateNames[fi].indexOf(childPrefix) === 0 && stateNames[fi].indexOf('.', childPrefix.length) === -1) {
              firstChild = stateNames[fi];
              break;
            }
          }
          if (!firstChild) break;
          target = firstChild;
        }

        // Clear timers from current state before any routing or transition
        if (afterTimer) { clearTimeout(afterTimer); afterTimer = null; }
        for (var ci = 0; ci < stateIntervals.length; ci++) clearInterval(stateIntervals[ci]);
        stateIntervals = [];

        // ── State-level mn-where: capability routing ────────────────
        if (!contentHtml && stateMap[target] && stateMap[target]._mnWhere) {
          var whereExpr = stateMap[target]._mnWhere;
          var required = _eval(whereExpr, ctx, inst.state, el);
          if (Array.isArray(required) && required.length > 0) {
            var hasAll = true;
            for (var wi = 0; wi < required.length; wi++) {
              if (_hostCapabilities.indexOf(required[wi]) === -1) { hasAll = false; break; }
            }
            if (!hasAll) {
              var node = _findCapableNode(required);
              if (!node) {
                if (!_registry) {
                  console.warn('[mn] mn-where="' + whereExpr + '" requires capabilities [' + required.join(', ') + '] but no registry is configured. Call MachineNative.init({ registry: url }) to set one.');
                } else if (_routeTable.length === 0) {
                  console.warn('[mn] mn-where requires [' + required.join(', ') + '] but the route table is empty. Check that the registry at ' + _registry + ' is running and nodes are registered.');
                } else {
                  console.warn('[mn] no registered node has capabilities [' + required.join(', ') + ']. Available nodes: ' + _routeTable.map(function (n) { return n.id + '=[' + n.capabilities.join(',') + ']'; }).join(', '));
                }
                return false;
              }
              var routeTarget = target;
              if (engine.debug) console.log('[mn-debug] routing to ' + node.id + ' for ' + name + '/' + routeTarget);
              _sendMachineToNode(el, node, routeTarget)
                .then(function (html) {
                  if (engine.debug) console.log('[mn-debug] received ' + html.length + ' bytes for ' + name + '/' + routeTarget);
                  inst.to(routeTarget, html);
                })
                .catch(function (err) {
                  console.warn('[mn] routing to ' + node.id + ' failed: ' + (err && err.message ? err.message : String(err)));
                });
              return true;
            }
          }
        }

        var prev = inst.state;
        inst.state = target;
        if (engine.debug) console.log('[mn-debug] ' + name + ': ' + prev + ' → ' + target);
        if (prev !== target) inst._mnBindCache = null;

        // Self-transition with contentHtml: destroy and re-stamp without full exit/enter
        if (prev === target && contentHtml && stateMap[target]) {
          var selfEl = stateMap[target];
          if (selfEl._mnExit) _exec(selfEl._mnExit, ctx, target, el, null, inst);
          var selfNested = selfEl.querySelectorAll('[mn]');
          for (var sni = 0; sni < selfNested.length; sni++) _cleanupInstance(selfNested[sni]);
          selfEl.innerHTML = contentHtml;
          _scanBindAttrs(selfEl, el);
          _attachDomEvents(selfEl, inst);
          _initNested(selfEl);
          selfEl.hidden = false;
          ctx.$refs = _buildRefs(el);
          inst.update();
          if (selfEl._mnInit) {
            var siExpr = selfEl._mnInit;
            setTimeout(function () { _exec(siExpr, ctx, inst.state, el, null, inst); }, 0);
          }
          el.dispatchEvent(new CustomEvent('mn-state-change', { bubbles: true, detail: { machine: name, prev: prev, next: target, ctx: ctx } }));
          if (inst._urlMap && inst._urlMap[target]) {
            var urlEntry = inst._urlMap[target];
            if (window.history && window.history.pushState) history.pushState({ mpState: target }, '', _resolveUrl(urlEntry.pattern, urlEntry.params, ctx));
          }
          if (stateMap[target]) _evalTemporal(stateMap[target], target);
          return true;
        }

        var paths = _transitionPaths(prev, target);
        var exitPath = paths.exitPath;
        var enterPath = paths.enterPath;

        // ── Exit states (innermost first) ───────────────────────────
        for (var xi = 0; xi < exitPath.length; xi++) {
          var exitState = exitPath[xi];
          if (!stateMap[exitState]) continue;
          var leaveEl = stateMap[exitState];
          if (leaveEl._mnExit) {
            _exec(leaveEl._mnExit, ctx, exitState, el, null, inst);
          }
          var nested = leaveEl.querySelectorAll('[mn]');
          for (var ni2 = 0; ni2 < nested.length; ni2++) _cleanupInstance(nested[ni2]);
          // For compound states, also clear chrome
          if (compoundChromes[exitState]) {
            // Remove chrome nodes (not child mn-state elements)
            var chromeNodes = [];
            for (var cn = 0; cn < leaveEl.childNodes.length; cn++) {
              var node = leaveEl.childNodes[cn];
              if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('mn-state')) continue;
              chromeNodes.push(node);
            }
            for (var cn2 = 0; cn2 < chromeNodes.length; cn2++) leaveEl.removeChild(chromeNodes[cn2]);
          } else {
            leaveEl.innerHTML = '';
          }
          leaveEl.hidden = true;
        }

        // ── Enter states (outermost first) ──────────────────────────
        for (var eni = 0; eni < enterPath.length; eni++) {
          var enterState = enterPath[eni];
          if (!stateMap[enterState]) continue;
          var enterEl = stateMap[enterState];
          enterEl.hidden = false;
          if (compoundChromes[enterState]) {
            // Compound state: stamp chrome
            enterEl.appendChild(compoundChromes[enterState].content.cloneNode(true));
            _scanBindAttrs(enterEl, el);
            _attachDomEvents(enterEl, inst);
          } else if (enterState === target) {
            // Atomic target state: stamp content
            if (contentHtml) {
              enterEl.innerHTML = contentHtml;
            } else if (stateTmpls[enterState]) {
              enterEl.appendChild(stateTmpls[enterState].content.cloneNode(true));
            }
            _scanBindAttrs(enterEl, el);
            _attachDomEvents(enterEl, inst);
            _initNested(enterEl);
            // Parse <mn-transition> elements and store on instance
            var parsed = _parseTransitions(enterEl, el);
            if (!inst._transitions) inst._transitions = {};
            inst._transitions[enterState] = parsed;
          }
        }

        ctx.$refs = _buildRefs(el);
        inst.update();

        // Run mn-init on each entered state (outermost first).
        // Deferred via setTimeout(0) so the DOM is fully stamped and bindings
        // are evaluated before init runs — ensures $refs and focus targets exist.
        for (var ini = 0; ini < enterPath.length; ini++) {
          var initState = enterPath[ini];
          if (stateMap[initState] && stateMap[initState]._mnInit && initState !== prev) {
            var stateInit = stateMap[initState]._mnInit;
            (function (expr) {
              setTimeout(function () { _exec(expr, ctx, inst.state, el, null, inst); }, 0);
            })(stateInit);
          }
        }

        el.dispatchEvent(new CustomEvent('mn-state-change', {
          bubbles: true,
          detail: { machine: name, prev: prev, next: target, ctx: ctx }
        }));

        // URL routing: push URL for the new state
        if (inst._urlMap && inst._urlMap[target]) {
          var urlEntry = inst._urlMap[target];
          var resolvedUrl = _resolveUrl(urlEntry.pattern, urlEntry.params, ctx);
          if (window.history && window.history.pushState) history.pushState({ mpState: target }, '', resolvedUrl);
        }

        if (stateMap[target]) _evalTemporal(stateMap[target], target);
        return true;
      },

      emit: function (eventName, payload) {
        document.dispatchEvent(new CustomEvent('mn-' + eventName, {
          detail: { source: el, payload: payload }
        }));
      },

      // ── update — delegates to _applyBindings ─────────────────────
      update: function () {
        _applyBindings(el, inst, persistKey);
      }
    };

    // Parse <mn-let name="x">expr</mn-let> elements — computed bindings
    var letEls = el.querySelectorAll('mn-let');
    for (var lei = 0; lei < letEls.length; lei++) {
      if (letEls[lei].closest('[mn]') !== el) continue;
      var letName = letEls[lei].getAttribute('name');
      var letExpr = letEls[lei].textContent.trim();
      if (letName && letExpr) {
        if (!inst._mnLet) inst._mnLet = [];
        inst._mnLet.push({ name: letName, ast: _parse(letExpr) });
      }
      letEls[lei].remove();
    }

    el._mn = inst;
    _wireInstance(el, inst, setup, _evalTemporal);
    return inst;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Global event delegation                                                ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  var _listening = false;

  function _setupListeners() {
    if (_listening) return;
    _listening = true;

    // mn-to: click → transition
    //
    // mn-to="name" fires event name. If a <mn-transition event="name">
    // exists in the current state, it handles the event (guard, action,
    // emit, target). Otherwise, treated as a direct state transition.
    document.addEventListener('click', function (e) {
      var toEl = e.target.closest('[mn-to]');
      if (!toEl) return;
      e.preventDefault();
      var machineEl = toEl.closest('[mn]');
      if (!machineEl || !machineEl._mn) {
        console.warn('[mn] mn-to="' + toEl.getAttribute('mn-to') + '" is not inside a machine element ([mn]). Wrap it in a <div mn="name">.');
        return;
      }
      var inst = machineEl._mn;
      var value = toEl.getAttribute('mn-to');

      {
        // Find <mn-transition event="value"> — check pre-parsed transitions first,
        // then template-level transitions (from mn-each), then live DOM fallback.
        var transDefs = null;
        var stateTransitions = inst._transitions && inst._transitions[inst.state];
        if (stateTransitions && stateTransitions[value]) {
          transDefs = stateTransitions[value];
        }
        // Check template-level transitions from mn-each items
        if (!transDefs) {
          var tmplEl = toEl.closest('template') || (function () {
            // The button is a sibling of template, not inside it.
            // Walk up to find the nearest template[mn-each] with stored transitions.
            var cur = toEl.parentElement;
            while (cur && cur !== machineEl) {
              var tpls = cur.querySelectorAll('template[mn-each]');
              for (var ti = 0; ti < tpls.length; ti++) {
                if (tpls[ti]._mnTransitions && tpls[ti]._mnTransitions[value]) return tpls[ti];
              }
              cur = cur.parentElement;
            }
            return null;
          })();
          if (tmplEl && tmplEl._mnTransitions && tmplEl._mnTransitions[value]) {
            transDefs = tmplEl._mnTransitions[value];
          }
        }
        if (!transDefs) {
          // Live DOM search — find <mn-transition> near the clicked element
          var container = toEl.closest('[mn-state]') || machineEl;
          var liveTrans = container.querySelectorAll('mn-transition[event="' + value + '"]');
          if (liveTrans.length > 0) {
            transDefs = [];
            for (var lti = 0; lti < liveTrans.length; lti++) {
              if (liveTrans[lti].closest('[mn]') !== machineEl) continue;
              var ltd = { target: liveTrans[lti].getAttribute('to') || null, guard: null, action: null, emit: null };
              var lg = liveTrans[lti].querySelector('mn-guard');
              if (lg) ltd.guard = lg.textContent.trim();
              var la = liveTrans[lti].querySelector('mn-action');
              if (la) ltd.action = la.textContent.trim();
              var le = liveTrans[lti].querySelector('mn-emit');
              if (le) ltd.emit = le.textContent.trim();
              transDefs.push(ltd);
            }
          }
        }
        if (transDefs && transDefs.length > 0) {
          var itemScope = _scopeFor(toEl, machineEl, inst.ctx);
          for (var ti = 0; ti < transDefs.length; ti++) {
            var td = transDefs[ti];
            // Evaluate guard
            if (td.guard) {
              var guardResult = _eval(td.guard, itemScope, inst.state, toEl);
              if (!guardResult) continue;
            }
            // Execute action — merge item scope so $item/$index are available
            if (td.action) {
              var actionCtx = itemScope;
              if (itemScope !== inst.ctx) {
                actionCtx = Object.create(inst.ctx);
                for (var ak in itemScope) { if (itemScope.hasOwnProperty(ak)) actionCtx[ak] = itemScope[ak]; }
              }
              var actionResult = _exec(td.action, actionCtx, inst.state, machineEl, e, inst);
              if (itemScope !== inst.ctx) _applyScope(actionCtx, inst.ctx, inst);
              if (actionResult && actionResult.emit) inst.emit(actionResult.emit, actionResult.emitPayload);
            }
            // Explicit <mn-emit> element
            if (td.emit) inst.emit(td.emit);
            // Transition
            if (td.target) inst.to(td.target);
            else inst.update();
            break;
          }
        } else {
          // No mn-transition found — treat as direct state transition
          inst.to(value);
        }
      }
    });

    // mn-model: input → context
    // When inside an mn-each item, also updates the original $item so
    // changes persist through re-renders.
    function _modelSet(m, machineEl) {
      var inst = machineEl._mn;
      var scope = _scopeFor(m, machineEl, inst.ctx);
      var path = m.getAttribute('mn-model');
      var val = m.type === 'checkbox' ? m.checked : m.value;
      _set(scope, path, val);
      if (!inst._mnDirty) inst._mnDirty = {};
      inst._mnDirty[_depKey(path)] = true;
      // If inside an mn-each item, also write to the original array item
      // so the change survives re-renders
      if (scope.$item && typeof scope.$item === 'object') {
        _set(scope.$item, path, val);
      }
      inst.update();
    }

    document.addEventListener('input', function (e) {
      var modelEl = e.target.closest('[mn-model]');
      if (!modelEl) return;
      var machineEl = modelEl.closest('[mn]');
      if (!machineEl || !machineEl._mn) return;
      _modelSet(modelEl, machineEl);
    });

    // mn-model on <select>, <input type="radio">, <input type="file">
    // These fire 'change' not 'input'
    document.addEventListener('change', function (e) {
      var modelEl = e.target.closest('[mn-model]');
      if (!modelEl) return;
      var tag = modelEl.tagName.toLowerCase();
      if (tag !== 'select' && !(tag === 'input' && (modelEl.type === 'radio' || modelEl.type === 'file' || modelEl.type === 'checkbox'))) return;
      var machineEl = modelEl.closest('[mn]');
      if (!machineEl || !machineEl._mn) return;
      _modelSet(modelEl, machineEl);
    });
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  CSS injection                                                          ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function _injectCSS() {
    if (document.getElementById('mn-css')) return;
    var styleEl = document.createElement('style');
    styleEl.id = 'mn-css';
    styleEl.textContent =
      '[mn-state][hidden],[mn-show][hidden],[data-mn-bind][hidden]{display:none!important}';
    document.head.appendChild(styleEl);
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Init                                                                   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function init(root) {
    _injectCSS();
    _setupListeners();
    root = root || document;

    // If root itself is an [mn] element, init it directly
    if (root.nodeType === 1 && root.hasAttribute && root.hasAttribute('mn')) {
      if (!root._mn) _createInstance(root);
      return;
    }

    // Process stores first (global shared state)
    _processStores(root);

    // Process inline templates
    var tmplEls = root.querySelectorAll('template[mn-define]');
    for (var i = 0; i < tmplEls.length; i++) {
      _templates[tmplEls[i].getAttribute('mn-define')] = tmplEls[i];
    }

    // Init all machines that are still in the live DOM. A parent machine's
    // _discoverStates may have moved nested machines into a <template>
    // DocumentFragment. Those are no longer in the document and will be
    // initialized by _initNested when their parent state is entered.
    var els = root.querySelectorAll('[mn]');
    for (var i = 0; i < els.length; i++) {
      if (!els[i]._mn && document.contains(els[i])) _createInstance(els[i]);
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Auto-init + MutationObserver                                           ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // On page load: scan and initialize all [mn] elements.
  // After load: a MutationObserver watches for new [mn] elements added to
  // the DOM — by HTMX swaps, mn-each, server push, or any other mechanism.
  // New machines are initialized automatically. No manual init() calls needed.
  //
  // This is what makes integration seamless: HTMX swaps in new HTML,
  // the observer sees new [mn] elements, machine_native initializes them.
  // mn-import files are fetched and parsed before any machines are initialized.

  function _cleanupInstance(el) {
    if (!el._mn) return;
    // Remove from inter-machine event registry, clean up empty channels
    for (var name in _events) {
      var handler = _events[name]._handler;
      _events[name] = _events[name].filter(function (e) { return e.inst.el !== el; });
      _events[name]._handler = handler;
      if (_events[name].length === 0 && handler) {
        document.removeEventListener('mn-' + name, handler);
        delete _events[name];
      }
    }
    // Run tracked cleanups (outside listeners, popstate handlers)
    if (el._mnCleanups) {
      for (var i = 0; i < el._mnCleanups.length; i++) el._mnCleanups[i]();
      delete el._mnCleanups;
    }
    // Clear active timers to prevent ghost callbacks on dead machines
    if (el._mnTimers) {
      el._mnTimers.clearAfter();
      el._mnTimers.clearIntervals();
      delete el._mnTimers;
    }
    delete el._mn;
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
          if (node.hasAttribute('mn') && !node._mn) {
            _createInstance(node);
          }
          var nested = _querySafe(node, '[mn]');
          for (var k = 0; k < nested.length; k++) {
            if (!nested[k]._mn) _createInstance(nested[k]);
          }
          var tmpls = _querySafe(node, 'template[mn-define]');
          for (var k = 0; k < tmpls.length; k++) {
            _templates[tmpls[k].getAttribute('mn-define')] = tmpls[k];
          }
        }
        // Handle removed nodes — cleanup dead machines (prevents memory leaks
        // when HTMX swaps out content containing machines)
        var removed = mutations[i].removedNodes;
        for (var j = 0; j < removed.length; j++) {
          var node = removed[j];
          if (node.nodeType !== 1) continue;
          // Skip nodes that were moved (e.g. by mn-each reorder), not actually removed.
          // insertBefore on an existing child generates remove+add mutations, but the
          // node is still connected after the move completes. Only clean up truly
          // detached nodes.
          if (node.isConnected) continue;
          if (node._mn) _cleanupInstance(node);
          var dead = _querySafe(node, '[mn]');
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

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Capability-based routing                                               ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // The browser is a capability host. It declares what it can do and what
  // formats it accepts. When a transition has mn-where and the browser can't
  // satisfy the required capabilities, it looks up the route table and sends
  // the machine to a capable node.

  var _registry = null;
  var _routeTable = [];
  var _hostCapabilities = ['dom', 'user-input', 'localstorage', 'css-transition'];
  var _defaultLoading = '<div class="mn-loading" style="display:flex;align-items:center;justify-content:center;padding:2rem;opacity:0.5">Loading\u2026</div>';


  var _routeTableReady = null; // promise that resolves when route table is loaded

  function _fetchRouteTable() {
    if (!_registry) return Promise.resolve();
    _routeTableReady = fetch(_registry + '/routes')
      .then(function (res) { return res.json(); })
      .then(function (nodes) {
        _routeTable = nodes;
        if (engine.debug) console.log('[mn-debug] route table loaded: ' + nodes.length + ' nodes');
      })
      .catch(function () {
        if (engine.debug) console.log('[mn-debug] registry not available');
      });
    return _routeTableReady;
  }

  function _findCapableNode(requires) {
    for (var i = 0; i < _routeTable.length; i++) {
      var node = _routeTable[i];
      var hasAll = true;
      for (var j = 0; j < requires.length; j++) {
        if (node.capabilities.indexOf(requires[j]) === -1) { hasAll = false; break; }
      }
      if (hasAll) return node;
    }
    return null;
  }

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  URL routing                                                            ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // mn-url on state elements maps machine state to browser URL.
  // Plain string: mn-url="/orders"
  // S-expression:  mn-url="(path '/orders/:id' _actionId)"
  //   — :id placeholder bound to _actionId in context.
  //
  // One machine owns the URL. States without mn-url don't touch it.

  var _urlOwner = null; // the inst that owns the URL bar

  // Parse a mn-url value into { pattern, params }.
  // params maps placeholder name → context key.
  function _parseUrlAttr(value) {
    if (!value) return null;
    if (value.charAt(0) !== '(') {
      return { pattern: value, params: {} };
    }
    // S-expression: (path '/orders/:id' contextKey1 contextKey2 ...)
    var parsed = _parse(value);
    if (!Array.isArray(parsed) || !parsed[0] || parsed[0].v !== 'path') return null;
    var pattern = parsed[1] && parsed[1].t === 'S' ? parsed[1].v : String(parsed[1].v);
    var placeholders = pattern.match(/:([a-zA-Z_]\w*)/g) || [];
    var params = {};
    for (var pi = 0; pi < placeholders.length; pi++) {
      var paramName = placeholders[pi].substring(1);
      var contextKey = parsed[pi + 2] ? parsed[pi + 2].v : paramName;
      params[paramName] = contextKey;
    }
    return { pattern: pattern, params: params };
  }

  // Resolve a URL pattern with context values.
  function _resolveUrl(pattern, params, ctx) {
    return pattern.replace(/:([a-zA-Z_]\w*)/g, function (m, name) {
      var key = params[name] || name;
      return encodeURIComponent(ctx[key] != null ? ctx[key] : '');
    });
  }

  // Match a pathname against a URL pattern. Returns extracted params or null.
  function _matchUrl(pathname, pattern, params) {
    var regex = '^' + pattern.replace(/:([a-zA-Z_]\w*)/g, '([^/]+)') + '$';
    var match = pathname.match(new RegExp(regex));
    if (!match) return null;
    var placeholders = pattern.match(/:([a-zA-Z_]\w*)/g) || [];
    var extracted = {};
    for (var i = 0; i < placeholders.length; i++) {
      var paramName = placeholders[i].substring(1);
      var contextKey = params[paramName] || paramName;
      extracted[contextKey] = decodeURIComponent(match[i + 1]);
    }
    return extracted;
  }


  function _sendMachineToNode(machineEl, node, targetState) {
    if (!machineEl || !machineEl._mn) return Promise.reject(new Error('no machine'));

    // Sync context to markup
    machineEl._mn.update();

    var body = machineEl.outerHTML;
    var targetUrl = node.address + '/api/machine';

    var headers = { 'Content-Type': 'text/html' };
    if (targetState) headers['X-MN-Target'] = targetState;
    var machineName = machineEl.getAttribute('mn');
    if (machineName) headers['X-MN-Machine'] = machineName;

    return fetch(targetUrl, {
      method: 'POST',
      headers: headers,
      body: body
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + targetUrl);
      return res.text();
    });
  }

  return {
    init: function (rootOrConfig) {
      if (rootOrConfig && typeof rootOrConfig === 'object' && !rootOrConfig.nodeType) {
        // Config mode — set registry and capabilities. Don't re-run init().
        // _boot() handles init() after imports load.
        var config = rootOrConfig;
        if (config.registry) {
          _registry = config.registry;
          _fetchRouteTable();
        }
        if (config.debug) engine.debug = true;
        if (config.capabilities) _hostCapabilities = config.capabilities;
        if (config.loading) _defaultLoading = config.loading;
      } else {
        init(rootOrConfig);
      }
    },
    fn: function (name, func) { _userFns[name] = func; },
    store: _store,
    get debug() { return engine.debug; },
    set debug(v) { engine.debug = !!v; }
  };
});
