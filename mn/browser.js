/**
 * machine_native v0.8.0 — Markup-native application runtime.
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
 * @version 0.8.0
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

  // ── Optional modules for SCXML composition ────────────────────────────
  // When scxml.js and machine.js are loaded (via script tags), the browser
  // can pair SCXML behaviour definitions with HTML rendering templates.
  // Without them, HTML-only machines work as before.
  var _scxmlMod = (typeof MPSCXML !== 'undefined') ? MPSCXML : null;
  var _machineMod = (typeof MPMachine !== 'undefined') ? MPMachine : null;
  var _eval = engine.eval;
  var _exec = engine.exec;
  var _makeScope = engine.makeScope;
  var _newContext = engine.newContext;
  var _get = engine.get;
  var _set = engine.set;
  var _depKey = engine.depKey;
  var _userFns = engine.userFns;

  // Static AST dep collector — walks ALL branches of a parsed expression
  // to find every symbol reference. Unlike runtime dep tracking, this is
  // not defeated by short-circuit evaluation in or/and/if/cond. Used by
  // _applyBindings Phase 3 to build accurate binding dep sets.
  function _collectDeps(node, deps) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) _collectDeps(node[i], deps);
    } else if (node.t === 'Y') {
      deps[_depKey(node.v)] = true;
    }
  }

  // ── Module-level state (var-hoisted, declared in their sections) ────
  // _templates, _store, _events, _registry, _routeTable,
  // _hostCapabilities, _defaultLoading, _scxmlDefs, _listening
  // All declared below in their respective sections, referenced earlier
  // via JavaScript var hoisting.

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
  function _stateAncestors(statePath) {
    var ancestors = []; var current = statePath;
    while (current) { ancestors.push(current); var dot = current.lastIndexOf('.'); current = dot === -1 ? null : current.substring(0, dot); }
    return ancestors;
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

  // Find template-level transition definitions for a clicked element.
  // Returns the transition array from tmpl._mnTransitions if found, null otherwise.
  // Template-level transitions come from <mn-transition> inside <template mn-each>.
  // They require item scope ($item, $index) and are never in the compiled def.
  function _findTemplateTrans(toEl, machineEl, eventName) {
    var cur = toEl.parentElement;
    while (cur && cur !== machineEl) {
      var tpls = cur.querySelectorAll('template[mn-each]');
      for (var ti = 0; ti < tpls.length; ti++) {
        if (tpls[ti]._mnTransitions && tpls[ti]._mnTransitions[eventName]) {
          return tpls[ti]._mnTransitions[eventName];
        }
      }
      cur = cur.parentElement;
    }
    return null;
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
    // Body is optional for canonical machines — SCXML transitions handle the event.
    var recEls = inst.el.querySelectorAll('mn-receive');
    for (var ri = 0; ri < recEls.length; ri++) {
      if (recEls[ri].closest('[mn]') !== inst.el) continue;
      var evName = recEls[ri].getAttribute('event');
      var bodyText = recEls[ri].textContent.trim();
      if (!evName) continue;
      recEls[ri].remove();

      var body = bodyText ? _parse(bodyText) : null;

      (function (name, bodyExpr, machine) {
        if (!_events[name]) {
          _events[name] = [];
          var handler = function (e) {
            var list = _events[name];
            for (var j = 0; j < list.length; j++) {
              var entry = list[j];
              if (entry.inst.el === e.detail.source) continue;

              // When the SCXML brain has a transition for this event,
              // route through classified dispatch so guards and actions
              // are evaluated by the canonical engine. If the brain has
              // no matching transition, fall through to the body expression.
              if (entry.inst._canonical && _machineMod) {
                var result = _machineMod.sendEvent(entry.inst._canonical, name);
                if (result.transitioned) {
                  if (result.emits) {
                    for (var ei = 0; ei < result.emits.length; ei++) {
                      entry.inst.emit(result.emits[ei].name, result.emits[ei].payload);
                    }
                  }
                  entry.inst.to(entry.inst._canonical.state);
                  continue;
                }
                if (result.targetless) { entry.inst.update(); continue; }
              }

              // No body and no canonical match — nothing to do
              if (!entry.body) continue;

              var scope = _makeScope(entry.inst.ctx, entry.inst.state, entry.inst.el);
              scope.$detail = e.detail.payload;
              scope.__mnInst = entry.inst;
              _seval(entry.body, scope);
              entry.inst.ctx = _newContext(scope, entry.inst.ctx, entry.inst);
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
      if (el._mnEventsBound && el._mnBoundInst === inst) return;
      if (el.closest('[mn]') !== inst.el) return;
      if (el._mnOnHandlers) {
        for (var i = 0; i < el._mnOnHandlers.length; i++) {
          _bindOneEvent(el, el._mnOnHandlers[i].event, el._mnOnHandlers[i].expr, inst);
        }
      }
      el._mnEventsBound = true;
      el._mnBoundInst = inst;
    };
    for (var i = 0; i < all.length; i++) check(all[i]);
    check(container);
  }

  function _bindOneEvent(el, raw, targetState, inst) {
    var parts = raw.split('.');
    var evName = parts[0];
    var mods = parts.slice(1);
    var isOutside = mods.indexOf('outside') !== -1;

    // Key name modifiers: keydown.enter, keydown.escape, keydown.space, etc.
    // Map modifier names to KeyboardEvent.key values.
    var keyFilter = null;
    var keyMap = { enter: 'Enter', escape: 'Escape', space: ' ', tab: 'Tab', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
    for (var mi = 0; mi < mods.length; mi++) {
      if (keyMap[mods[mi]]) { keyFilter = keyMap[mods[mi]]; break; }
    }

    var handler = function (e) {
      if (keyFilter && e.key !== keyFilter) return;
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
      inst.ctx = _newContext(scope, inst.ctx, inst);
      if (scope.__mnEmit) inst.emit(scope.__mnEmit, scope.__mnEmitPayload);
      if (scope.__mnTo) {
        // Route through classified dispatch when SCXML brain exists,
        // so guards and actions on SCXML transitions are evaluated.
        if (inst._canonical && _machineMod) {
          inst.send(scope.__mnTo);
        } else {
          inst.to(scope.__mnTo);
        }
      } else {
        inst.update();
      }
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
  // Structural element → attribute conversion. Scans for <mn-text>,
  // <mn-show>, <mn-class>, <mn-bind>, <mn-on>, <mn-each>, <mn-transition>
  // elements, stores their expressions on the parent element as properties
  // (_mnBind, _mnOnHandlers, _mnBindAttrs), then removes the structural
  // elements from the DOM. This runs once when content is stamped — the
  // binding cache in _applyBindings reads the stored properties.

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
    el.offsetHeight; // force reflow so browser registers from-state before transitioning
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
    el.offsetHeight; // force reflow so browser registers from-state before transitioning
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
      var duration = parseFloat(trimmed) || 0;
      if (trimmed.indexOf('ms') !== -1) duration = duration / 1000;
      if (duration > max) max = duration;
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
    for (var ti = 0; ti < tmpls.length; ti++) {
      var tmpl = tmpls[ti];
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
          var nestedMachines = _querySafe(el, '[mn]');
          for (var ni = 0; ni < nestedMachines.length; ni++) {
            nestedMachines[ni].setAttribute('mn-ctx', itemJson);
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
    // Already has inline states — nothing to resolve
    if (el.querySelector('[mn-state]')) return;

    // Path 1: mn-define HTML template (may be paired with SCXML definition)
    if (_templates[name]) {
      // fall through to slot injection below
    }
    // No template found
    else {
      if (name) console.warn('[mn] no template for "' + name + '". Available: ' +
        Object.keys(_templates).join(', '));
      return;
    }

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


  // ── State discovery ─────────────────────────────────────────────────
  //
  // Recursively finds mn-state elements, extracts lifecycle properties,
  // templates content for lazy rendering, detects compound states.
  // Module-level for line count. Accumulates into stateMap, stateNames,
  // stateTmpls, compoundChromes (all passed by reference).

  function _discoverStates(machineEl, stateMap, stateNames, stateTmpls, compoundChromes, parentEl, prefix) {
    var children = parentEl.querySelectorAll('[mn-state]');
    var directChildren = [];
    for (var i = 0; i < children.length; i++) {
      if (children[i].closest('[mn]') !== machineEl) continue;
      var parentState = children[i].parentElement ? children[i].parentElement.closest('[mn-state]') : null;
      if (parentState && parentState.closest('[mn]') === machineEl) {
        if (parentState !== parentEl) continue;
      } else if (parentEl !== machineEl) {
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

      // Parse lifecycle elements — stored on element properties, removed from DOM
      var _findOwned = function (tag) {
        var found = childEl.querySelector(tag);
        if (found && found.closest('[mn-state]') === childEl && found.closest('[mn]') === machineEl) return found;
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
      if (childEl.hasAttribute('mn-url')) childEl._mnUrlRaw = childEl.getAttribute('mn-url');
      lcEl = _findOwned('mn-url');
      if (lcEl) { childEl._mnUrlRaw = lcEl.textContent.trim(); lcEl.remove(); }

      // Check for compound state (has child mn-state elements)
      var nestedStates = childEl.querySelectorAll('[mn-state]');
      var hasChildren = false;
      for (var k = 0; k < nestedStates.length; k++) {
        if (nestedStates[k].closest('[mn]') === machineEl) {
          var nsParent = nestedStates[k].parentElement ? nestedStates[k].parentElement.closest('[mn-state]') : null;
          if (nsParent === childEl) { hasChildren = true; break; }
        }
      }

      if (hasChildren) {
        var chromeTmpl = document.createElement('template');
        var childNodes = Array.prototype.slice.call(childEl.childNodes);
        for (var cn = 0; cn < childNodes.length; cn++) {
          var node = childNodes[cn];
          if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('mn-state')) continue;
          chromeTmpl.content.appendChild(node);
        }
        compoundChromes[fullPath] = chromeTmpl;
        stateTmpls[fullPath] = null;
        childEl.hidden = true;
        _discoverStates(machineEl, stateMap, stateNames, stateTmpls, compoundChromes, childEl, fullPath);
      } else {
        var tmpl = document.createElement('template');
        tmpl.setAttribute('mn-state-template', fullPath);
        while (childEl.firstChild) tmpl.content.appendChild(childEl.firstChild);
        stateTmpls[fullPath] = tmpl;
        childEl.after(tmpl);
        if (childEl._mnWhere) {
          childEl.innerHTML = childEl.getAttribute('mn-loading') || _defaultLoading;
        }
        childEl.hidden = true;
      }
    }
  }


  // ── Temporal evaluation ─────────────────────────────────────────────
  //
  // Evaluates mn-temporal s-expressions: (animate), (after ms expr), (every ms expr).
  // Module-level. Reads/writes inst._afterTimer, inst._stateIntervals.

  function _evalTemporal(inst, stateEl, stateName) {
    var transVal = stateEl._mnTemporal;
    if (!transVal) return;
    var tScope = _makeScope(inst.ctx, stateName, inst.el);
    tScope.__mnAfterTimer = function (ms, bodyNode) {
      inst._afterTimer = setTimeout(function () {
        inst._afterTimer = null;
        var scope = _makeScope(inst.ctx, inst.state, inst.el);
        scope.__mnInst = inst;
        _seval(bodyNode, scope);
        inst.ctx = _newContext(scope, inst.ctx, inst);
        if (scope.__mnEmit) inst.emit(scope.__mnEmit, scope.__mnEmitPayload);
        if (scope.__mnTo) inst.to(scope.__mnTo);
        else inst.update();
      }, ms);
    };
    tScope.__mnEveryInterval = function (ms, bodyNode) {
      var id = setInterval(function () {
        var scope = _makeScope(inst.ctx, inst.state, inst.el);
        scope.__mnInst = inst;
        _seval(bodyNode, scope);
        inst.ctx = _newContext(scope, inst.ctx, inst);
        if (scope.__mnEmit) inst.emit(scope.__mnEmit, scope.__mnEmitPayload);
        if (scope.__mnTo) inst.to(scope.__mnTo);
        else inst.update();
      }, ms);
      inst._stateIntervals.push(id);
    };
    tScope.__mnAnimate = function () {
      _transitionEnter(stateEl);
    };
    _seval(_parse(transVal), tScope);
  }


  // ── State entry helper ──────────────────────────────────────────────
  //
  // Stamp state content from template and initialise bindings + events.
  // Clears existing content first — the state may have boot-time content
  // that was already processed by _scanBindAttrs. Fresh template content
  // needs fresh processing.
  // Shared by: normal enter, self-transition, mn-where fulfillment.

  function _stampAndEnter(stateEl, stateName, machineEl, inst, stateTmpls, contentHtml) {
    // Clear before stamping — the state may have content from initial boot
    // that was processed by _scanBindAttrs (mn-text removed, _mnBind set).
    // Re-stamping from template brings fresh unprocessed elements.
    // Without clearing, both old and new content coexist.
    if (contentHtml) {
      stateEl.innerHTML = contentHtml;
    } else if (stateTmpls[stateName]) {
      stateEl.innerHTML = '';
      stateEl.appendChild(stateTmpls[stateName].content.cloneNode(true));
    }
    stateEl.hidden = false;

    // Create child machine elements for <invoke> children on this state.
    // Each invoke embeds a full SCXML machine. The browser creates a DOM
    // element for it, _initNested picks it up and initialises it as a
    // live machine paired with its HTML template.
    var _transforms = (typeof MPTransforms !== 'undefined') ? MPTransforms : null;
    if (inst._def && inst._def._stateTree[stateName]) {
      var invokes = inst._def._stateTree[stateName].spec.invokes;
      if (invokes && _transforms) {
        for (var ivi = 0; ivi < invokes.length; ivi++) {
          var inv = invokes[ivi];
          var invMachine = _transforms.extractMachine(inv.scxml);
          if (!invMachine || !invMachine.name) continue;
          var invCtx = _transforms.extractContext(inv.scxml);
          var childEl = document.createElement('div');
          childEl.setAttribute('mn', invMachine.name);
          if (invMachine.state) childEl.setAttribute('mn-initial', invMachine.state);
          if (invCtx && Object.keys(invCtx).length > 0) {
            childEl.setAttribute('mn-ctx', JSON.stringify(invCtx));
          }
          if (inv.id) childEl.setAttribute('data-invoke-id', inv.id);
          stateEl.appendChild(childEl);
        }
      }
    }

    _scanBindAttrs(stateEl, machineEl);
    _attachDomEvents(stateEl, inst);
    _initNested(stateEl);
    var parsed = _parseTransitions(stateEl, machineEl);
    if (!inst._transitions) inst._transitions = {};
    inst._transitions[stateName] = parsed;
  }


  // ── Unified event dispatch ──────────────────────────────────────────
  //
  // Single entry point for all event-driven transitions. Module-level.
  // Classified dispatch: template-level → canonical engine → DOM-parsed → direct state name.

  function _sendEvent(inst, event, itemScope, templateDefs) {
    var el = inst.el;

    // 1. Template-level transitions (mn-each items with $item scope)
    if (templateDefs) {
      var scope = itemScope || inst.ctx;
      for (var tti = 0; tti < templateDefs.length; tti++) {
        var ttd = templateDefs[tti];
        if (ttd.guard) {
          if (!_eval(ttd.guard, scope, inst.state, el)) continue;
        }
        if (ttd.action) {
          var tac = scope;
          if (scope !== inst.ctx) {
            tac = Object.create(inst.ctx);
            for (var tak in scope) { if (scope.hasOwnProperty(tak)) tac[tak] = scope[tak]; }
          }
          var tar = _exec(ttd.action, tac, inst.state, el, null, inst);
          if (tar && tar.context) inst.ctx = tar.context;
          if (tar && tar.emit) inst.emit(tar.emit, tar.emitPayload);
        }
        if (ttd.emit) inst.emit(ttd.emit);
        if (ttd.target) inst.to(ttd.target);
        else inst.update();
        return true;
      }
      return false;
    }

    // 2. Canonical engine — sendEvent walks the hierarchy
    if (inst._canonical && _machineMod) {
      var result = _machineMod.sendEvent(inst._canonical, event);
      if (result.transitioned || result.targetless) {
        // Transition/update FIRST so $store syncs, THEN emit to other machines
        if (result.transitioned) { inst.to(inst._canonical.state); }
        else { inst.update(); }
        // Only fire emits on stable transitions — NOT on route signals.
        // Route signals mean the machine is mid-flight (waiting for server).
        // Emits fire when the machine reaches a stable state.
        if (!result.route && result.emits) {
          for (var ei = 0; ei < result.emits.length; ei++) {
            inst.emit(result.emits[ei].name, result.emits[ei].payload);
          }
        }
        return result;
      }
    }

    // 3. DOM-parsed transitions (parsed on state entry)
    var transDefs = inst._transitions && inst._transitions[inst.state];
    if (transDefs && transDefs[event]) {
      var scope = itemScope || inst.ctx;
      var candidates = transDefs[event];
      for (var ti = 0; ti < candidates.length; ti++) {
        var td = candidates[ti];
        if (td.guard) {
          if (!_eval(td.guard, scope, inst.state, el)) continue;
        }
        if (td.action) { var tdr = _exec(td.action, scope, inst.state, el, null, inst); if (tdr && tdr.context) inst.ctx = tdr.context; }
        if (td.emit) inst.emit(td.emit);
        if (td.target) inst.to(td.target);
        else inst.update();
        return true;
      }
    }

    // 4. Direct state name — try exact then relative to compound parent
    if (inst.states.indexOf(event) !== -1) { inst.to(event); return true; }
    var parts = inst.state.split('.');
    for (var ri = parts.length - 1; ri >= 0; ri--) {
      var candidate = parts.slice(0, ri).concat(event).join('.');
      if (candidate && inst.states.indexOf(candidate) !== -1) { inst.to(candidate); return true; }
    }

    console.warn('[mn] unknown state "' + event + '" in "' + inst.name + '"');
    return false;
  }


  // ── State transition: resolve → timers → where-check → exit → enter → init → update ──
  //
  // The full DOM lifecycle for a state change. Resolves target (including
  // compound descent), clears timers, checks mn:where for routing, exits
  // old states (innermost first), enters new states (outermost first),
  // runs mn-init, updates bindings, dispatches events, evaluates temporal.

  function _transitionTo(inst, target, contentHtml) {
    if (inst._transitioning) {
      console.warn('[mn] reentrant _transitionTo detected: ' + inst.name + ' → ' + target + ' (already transitioning to ' + inst._transitioning + ')');
      return false;
    }
    inst._transitioning = target;
    try {
    var el = inst.el;
    var name = inst.name;
    var stateMap = inst._stateMap;
    var stateTmpls = inst._stateTmpls;
    var compoundChromes = inst._compoundChromes;
    var stateNames = inst.states;

    // Step 1: resolve target — handle relative names and compound descent
    var resolvedTarget = null;
    if (stateNames.indexOf(target) !== -1) {
      resolvedTarget = target;
    } else {
      var parts = inst.state.split('.');
      for (var ri = parts.length - 1; ri >= 0; ri--) {
        var candidate = parts.slice(0, ri).concat(target).join('.');
        if (candidate && stateNames.indexOf(candidate) !== -1) { resolvedTarget = candidate; break; }
      }
    }
    if (!resolvedTarget) { console.warn('[mn] unknown state "' + target + '" in "' + name + '"'); return false; }
    target = resolvedTarget;

    // Descend into compound initial child
    while (compoundChromes[target]) {
      var childPrefix = target + '.';
      var firstChild = null;
      for (var fi = 0; fi < stateNames.length; fi++) {
        if (stateNames[fi].indexOf(childPrefix) === 0 && stateNames[fi].indexOf('.', childPrefix.length) === -1) { firstChild = stateNames[fi]; break; }
      }
      if (!firstChild) break;
      target = firstChild;
    }

    // Step 2: clear timers from previous state
    if (inst._afterTimer) { clearTimeout(inst._afterTimer); inst._afterTimer = null; }
    for (var ci = 0; ci < inst._stateIntervals.length; ci++) clearInterval(inst._stateIntervals[ci]);
    inst._stateIntervals = [];

    // Step 3: mn-where — route to capable node if host lacks required capabilities
    if (inst._mnWhereGen && inst._mnWhereGen === inst._mnWhereResolved) {
      inst._mnWhereResolved = 0;
      if (inst.state === target && stateMap[target]) {
        stateMap[target].innerHTML = '';
        _stampAndEnter(stateMap[target], target, el, inst, stateTmpls, null);
        inst.ctx.$refs = _buildRefs(el);
        if (stateMap[target]._mnInit) {
          var wiR = _exec(stateMap[target]._mnInit, inst.ctx, inst.state, el, null, inst);
          if (wiR && wiR.context) inst.ctx = wiR.context;
          if (wiR && wiR.emit) inst.emit(wiR.emit, wiR.emitPayload);
          if (wiR && wiR.to) { inst.update(); inst.to(wiR.to); return true; }
        }
        inst.update();
        el.dispatchEvent(new CustomEvent('mn-state-change', { bubbles: true, detail: { machine: name, prev: target, next: target, ctx: inst.ctx } }));
        if (stateMap[target]) _evalTemporal(inst, stateMap[target], target);
        return true;
      }
    } else if (!contentHtml && stateMap[target] && stateMap[target]._mnWhere) {
      var whereExpr = stateMap[target]._mnWhere;
      var required = _eval(whereExpr, inst.ctx, inst.state, el);
      if (Array.isArray(required) && required.length > 0) {
        var hasAll = true;
        for (var wi = 0; wi < required.length; wi++) {
          if (_hostCapabilities.indexOf(required[wi]) === -1) { hasAll = false; break; }
        }
        if (!hasAll) {
          // Hide previous state DOM before routing — the user should see the target state's loading content
          // Machine IS at this state — set it and update DOM before routing.
          var prevState = inst.state;
          inst.state = target;
          if (inst._canonical) inst._canonical.state = target;
          for (var shi = 0; shi < stateNames.length; shi++) {
            if (stateMap[stateNames[shi]]) stateMap[stateNames[shi]].hidden = (stateNames[shi] !== target);
          }

          var node = _findCapableNode(required);
          if (!node) {
            if (!_registry) console.warn('[mn] mn-where requires [' + required.join(', ') + '] but no registry configured.');
            else if (_routeTable.length === 0) console.warn('[mn] mn-where requires [' + required.join(', ') + '] but route table empty.');
            else console.warn('[mn] no node has [' + required.join(', ') + '].');
            return true;
          }
          var routeTarget = target;
          if (!inst._mnWhereGen) inst._mnWhereGen = 0;
          inst._mnWhereGen++;
          if (engine.debug) console.log('[mn-debug] routing to ' + node.id + ' (' + (node.transport ? node.transport.type : '?') + ') for ' + name + '/' + routeTarget);

          // Fire and forget — send the machine and move on.
          // The result comes back via the transport (SSE for browsers, HTTP POST for servers).
          _sendMachineToNode(el, node, routeTarget)
            .catch(function (err) { console.warn('[mn] send failed: ' + (err && err.message ? err.message : String(err))); });
          return true;
        }
      }
    }

    var prev = inst.state;
    inst.state = target;
    if (inst._canonical) inst._canonical.state = target;
    if (engine.debug) console.log('[mn-debug] ' + name + ': ' + prev + ' → ' + target);
    if (prev !== target) inst._mnBindCache = null;

    // Self-transition with contentHtml
    if (prev === target && contentHtml && stateMap[target]) {
      var selfEl = stateMap[target];
      if (selfEl._mnExit) { var selfExitR = _exec(selfEl._mnExit, inst.ctx, target, el, null, inst); if (selfExitR && selfExitR.context) inst.ctx = selfExitR.context; }
      var selfNested = selfEl.querySelectorAll('[mn]');
      for (var sni = 0; sni < selfNested.length; sni++) _cleanupInstance(selfNested[sni]);
      _stampAndEnter(selfEl, target, el, inst, stateTmpls, contentHtml);
      inst.ctx.$refs = _buildRefs(el);
      if (selfEl._mnInit) {
        var siR = _exec(selfEl._mnInit, inst.ctx, inst.state, el, null, inst);
        if (siR && siR.context) inst.ctx = siR.context;
        if (siR && siR.emit) inst.emit(siR.emit, siR.emitPayload);
        if (siR && siR.to) { inst.update(); inst.to(siR.to); return true; }
      }
      inst.update();
      el.dispatchEvent(new CustomEvent('mn-state-change', { bubbles: true, detail: { machine: name, prev: prev, next: target, ctx: inst.ctx } }));
      if (inst._urlMap && inst._urlMap[target]) {
        var urlEntry = inst._urlMap[target];
        if (window.history && window.history.pushState) history.pushState({ mpState: target }, '', _resolveUrl(urlEntry.pattern, urlEntry.params, inst.ctx));
      }
      if (stateMap[target]) _evalTemporal(inst, stateMap[target], target);
      return true;
    }

    var paths = _transitionPaths(prev, target);
    var exitPath = paths.exitPath;
    var enterPath = paths.enterPath;

    // Step 4: exit states (innermost first) — run exit hooks, cleanup nested machines, clear content
    for (var xi = 0; xi < exitPath.length; xi++) {
      var exitState = exitPath[xi];
      if (!stateMap[exitState]) continue;
      var leaveEl = stateMap[exitState];
      if (leaveEl._mnExit) { var leaveExitR = _exec(leaveEl._mnExit, inst.ctx, exitState, el, null, inst); if (leaveExitR && leaveExitR.context) inst.ctx = leaveExitR.context; }
      var nested = leaveEl.querySelectorAll('[mn]');
      for (var ni2 = 0; ni2 < nested.length; ni2++) _cleanupInstance(nested[ni2]);
      if (compoundChromes[exitState]) {
        var chromeNodes = [];
        for (var cn = 0; cn < leaveEl.childNodes.length; cn++) {
          var cnode = leaveEl.childNodes[cn];
          if (cnode.nodeType === 1 && cnode.hasAttribute && cnode.hasAttribute('mn-state')) continue;
          chromeNodes.push(cnode);
        }
        for (var cn2 = 0; cn2 < chromeNodes.length; cn2++) leaveEl.removeChild(chromeNodes[cn2]);
      } else {
        leaveEl.innerHTML = '';
      }
      leaveEl.hidden = true;
    }

    // Step 5: enter states (outermost first) — stamp template, scan bindings, attach events
    for (var eni = 0; eni < enterPath.length; eni++) {
      var enterState = enterPath[eni];
      if (!stateMap[enterState]) continue;
      var enterEl = stateMap[enterState];
      enterEl.hidden = false;
      if (compoundChromes[enterState]) {
        enterEl.appendChild(compoundChromes[enterState].content.cloneNode(true));
        _scanBindAttrs(enterEl, el);
        _attachDomEvents(enterEl, inst);
      } else if (enterState === target) {
        _stampAndEnter(enterEl, enterState, el, inst, stateTmpls, contentHtml);
      }
    }

    inst.ctx.$refs = _buildRefs(el);

    // Step 6: mn-init — run synchronously so $store writes are visible to bindings
    for (var ini = 0; ini < enterPath.length; ini++) {
      var initState = enterPath[ini];
      if (stateMap[initState] && stateMap[initState]._mnInit && initState !== prev) {
        var iniR = _exec(stateMap[initState]._mnInit, inst.ctx, inst.state, el, null, inst);
        if (iniR && iniR.context) inst.ctx = iniR.context;
        if (iniR && iniR.emit) inst.emit(iniR.emit, iniR.emitPayload);
        if (iniR && iniR.to) inst.to(iniR.to);
      }
    }

    // Step 7: update bindings — dep tracking ensures only changed bindings re-evaluate
    inst.update();

    el.dispatchEvent(new CustomEvent('mn-state-change', { bubbles: true, detail: { machine: name, prev: prev, next: target, ctx: inst.ctx } }));

    if (inst._urlMap && inst._urlMap[target]) {
      var urlEntry = inst._urlMap[target];
      if (window.history && window.history.pushState) history.pushState({ mpState: target }, '', _resolveUrl(urlEntry.pattern, urlEntry.params, inst.ctx));
    }

    if (stateMap[target]) _evalTemporal(inst, stateMap[target], target);
    return true;
    } finally { inst._transitioning = null; }
  }


  // ── Canonical definition builder ────────────────────────────────────
  //
  // Walks discovered states and extracts transitions, guards, actions,
  // lifecycle into a canonical definition shape for machine.createDefinition.

  function _buildDefFromStates(machineEl, stateTmpls, compoundChromes, parentEl, prefix, target) {
    var children = parentEl.querySelectorAll('[mn-state]');
    for (var di = 0; di < children.length; di++) {
      var childEl = children[di];
      if (childEl.closest('[mn]') !== machineEl) continue;
      var parentState = childEl.parentElement ? childEl.parentElement.closest('[mn-state]') : null;
      if (parentState && parentState.closest('[mn]') === machineEl) {
        if (parentState !== parentEl) continue;
      } else if (parentEl !== machineEl) {
        continue;
      }
      var shortName = childEl.getAttribute('mn-state');
      var fullPath = prefix ? prefix + '.' + shortName : shortName;
      var stateDef = {};

      if (childEl.hasAttribute('mn-final')) stateDef.final = true;
      if (childEl._mnInit) stateDef.init = childEl._mnInit;
      if (childEl._mnExit) stateDef.exit = childEl._mnExit;
      if (childEl._mnWhere) stateDef.where = childEl._mnWhere;
      if (childEl._mnTemporal) stateDef.temporal = childEl._mnTemporal;

      var tmpl = stateTmpls[fullPath];
      var transSource = tmpl ? tmpl.content : childEl;
      var transEls = transSource.querySelectorAll('mn-transition');
      var transitions = {};
      for (var ti = 0; ti < transEls.length; ti++) {
        var tel = transEls[ti];
        if (tmpl || tel.closest('[mn]') === machineEl) {
          var event = tel.getAttribute('event');
          if (!event) continue;
          var tDef = { target: tel.getAttribute('to') || null };
          var gEl = tel.querySelector('mn-guard');
          if (gEl) tDef.guard = gEl.textContent.trim();
          var aEl = tel.querySelector('mn-action');
          if (aEl) tDef.action = aEl.textContent.trim();
          var eEl = tel.querySelector('mn-emit');
          if (eEl) tDef.emit = eEl.textContent.trim();
          if (!transitions[event]) transitions[event] = [];
          transitions[event].push(tDef);
        }
      }
      if (Object.keys(transitions).length > 0) stateDef.on = transitions;

      if (compoundChromes[fullPath]) {
        var chromeTrans = compoundChromes[fullPath].content.querySelectorAll('mn-transition');
        for (var cti = 0; cti < chromeTrans.length; cti++) {
          var ctel = chromeTrans[cti];
          var cevent = ctel.getAttribute('event');
          if (!cevent) continue;
          var ctDef = { target: ctel.getAttribute('to') || null };
          var cgEl = ctel.querySelector('mn-guard');
          if (cgEl) ctDef.guard = cgEl.textContent.trim();
          var caEl = ctel.querySelector('mn-action');
          if (caEl) ctDef.action = caEl.textContent.trim();
          var ceEl = ctel.querySelector('mn-emit');
          if (ceEl) ctDef.emit = ceEl.textContent.trim();
          if (!transitions[cevent]) transitions[cevent] = [];
          transitions[cevent].push(ctDef);
        }
        if (Object.keys(transitions).length > 0) stateDef.on = transitions;
        stateDef.states = {};
        _buildDefFromStates(machineEl, stateTmpls, compoundChromes, childEl, fullPath, stateDef.states);
        stateDef.initial = Object.keys(stateDef.states)[0] || null;
      }

      target[shortName] = stateDef;
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

    _discoverStates(el, stateMap, stateNames, stateTmpls, compoundChromes, el, null);

    // ── Compile canonical definition from discovered DOM structure ────
    // Same shape as scxml.compile() returns. Enables machine.sendEvent()
    // delegation and SCXML composition.
    var _defStates = {};
    _buildDefFromStates(el, stateTmpls, compoundChromes, el, null, _defStates);

    // Parse context without $store/$refs for the canonical def
    var _defCtx = {};
    if (ctxAttr) { try { _defCtx = JSON.parse(ctxAttr); } catch (e) {} }

    var _compiledDef = null;
    if (_machineMod && Object.keys(_defStates).length > 0) {
      try {
        _compiledDef = _machineMod.createDefinition({
          id: name,
          initial: el.getAttribute('mn-initial') || stateNames[0] || null,
          context: _defCtx,
          states: _defStates
        });
      } catch (err) {
        console.warn('[mn] failed to compile def for "' + name + '": ' + err.message);
      }
    }

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

    return { ctx: ctx, persistKey: persistKey, stateMap: stateMap, stateNames: stateNames, stateTmpls: stateTmpls, compoundChromes: compoundChromes, initial: initial, compiledDef: _compiledDef };
  }


  // ── Binding application: $store broadcast → mn-let → cache build → dep-skip render → persist ──
  //
  // Five phases. Phase 1: propagate $store changes to sibling machines.
  // Phase 2: recompute mn-let derived values. Phase 3: build binding cache
  // (first render or after DOM change). Phase 4: evaluate and apply only
  // bindings whose deps overlap the dirty set. Phase 5: persist context.

  function _applyBindings(machineEl, inst, persistKey) {
    var state = inst.state;
    var ctx = inst.ctx;
    var dirty = inst._mnDirty;
    inst._mnDirty = null;

    // Immutable $store propagation: if this machine wrote to $store,
    // broadcast the new $store to all other machines and re-render them.
    if (ctx.$store && ctx.$store !== _store) {
      _store = ctx.$store;
      var allMachines = document.querySelectorAll('[mn]');
      var toUpdate = [];
      for (var mi = 0; mi < allMachines.length; mi++) {
        var otherInst = allMachines[mi]._mn;
        if (otherInst && otherInst !== inst) {
          var otherCtx = {};
          for (var sk in otherInst.ctx) { if (otherInst.ctx.hasOwnProperty(sk)) otherCtx[sk] = otherInst.ctx[sk]; }
          otherCtx.$store = _store;
          otherInst.ctx = otherCtx;
          toUpdate.push(otherInst);
        }
      }
      for (var ui = 0; ui < toUpdate.length; ui++) toUpdate[ui].update();
    }

    // ── Phase 1: List rendering (may create new DOM) ─────────
    _updateEach(machineEl, inst);

    // ── Phase 1b: Evaluate mn-let computed bindings ─────────
    // Must run before the binding cache is built so computed values
    // are in ctx when dep tracking evaluates expressions like (not valid).
    // Immutable: build new context with computed values merged.
    if (inst._mnLet) {
      var letScope = _makeScope(ctx, state, machineEl);
      var letUpdates = {};
      var letChanged = false;
      for (var li = 0; li < inst._mnLet.length; li++) {
        var lb = inst._mnLet[li];
        var prev = ctx[lb.name];
        var val = _sevalPure(lb.ast, letScope);
        letUpdates[lb.name] = val;
        letScope[lb.name] = val;
        if (val !== prev) { letChanged = true; if (dirty) dirty[_depKey(lb.name)] = true; }
      }
      if (letChanged) {
        var newLetCtx = {};
        for (var lk in ctx) { if (ctx.hasOwnProperty(lk)) newLetCtx[lk] = ctx[lk]; }
        for (var lk in letUpdates) { if (letUpdates.hasOwnProperty(lk)) newLetCtx[lk] = letUpdates[lk]; }
        inst.ctx = newLetCtx;
        ctx = inst.ctx;
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
        // Track deps: static AST walk to discover ALL context keys an
        // expression references. Runtime evaluation would miss keys in
        // short-circuit branches (or, and, if, cond) — a binding like
        // (or (empty? a) (empty? b)) with a="" would track only 'a'
        // because or short-circuits before evaluating b.
        var deps = {};
        if (elem._mnBind.text) _collectDeps(_parse(elem._mnBind.text), deps);
        if (elem._mnBind.show) _collectDeps(_parse(elem._mnBind.show), deps);
        if (elem._mnBind.classExpr) {
          for (var j = 0; j < elem._mnBind.classParsed.length; j++) _collectDeps(elem._mnBind.classParsed[j], deps);
        }
        if (elem._mnBindAttrs) {
          for (var j = 0; j < elem._mnBindAttrs.length; j++) _collectDeps(_parse(elem._mnBindAttrs[j].expr), deps);
        }
        if (elem._mnBind.model) deps[_depKey(elem._mnBind.model)] = true;
        elem._mnBind.deps = deps;
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
    // mn-init on machine element and initial state — run synchronously before update
    if (el._mnInit) {
      var machInitR = _exec(el._mnInit, inst.ctx, inst.state, el, null, inst);
      if (machInitR && machInitR.context) inst.ctx = machInitR.context;
      if (machInitR && machInitR.emit) inst.emit(machInitR.emit, machInitR.emitPayload);
      if (machInitR && machInitR.to) inst.to(machInitR.to);
    }
    if (setup.initial && setup.stateMap[setup.initial] && setup.stateMap[setup.initial]._mnInit) {
      var stInitR = _exec(setup.stateMap[setup.initial]._mnInit, inst.ctx, inst.state, el, null, inst);
      if (stInitR && stInitR.context) inst.ctx = stInitR.context;
      if (stInitR && stInitR.emit) inst.emit(stInitR.emit, stInitR.emitPayload);
      if (stInitR && stInitR.to) inst.to(stInitR.to);
    }
    inst.update();
    if (setup.initial && setup.stateMap[setup.initial]) evalTemporal(setup.stateMap[setup.initial], setup.initial);
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
    // ── Compile SCXML brain ────────────────────────────────────────
    var _compiledDef = null;
    if (_scxmlDefs[name] && _scxmlMod) {
      try { _compiledDef = _scxmlMod.compile(_scxmlDefs[name], { id: name }); }
      catch (err) { console.warn('[mn] failed to compile SCXML for "' + name + '": ' + err.message); }
    }
    if (!_compiledDef && setup.compiledDef) _compiledDef = setup.compiledDef;

    // Merge SCXML context defaults
    if (_compiledDef && _compiledDef.context) {
      for (var dk in _compiledDef.context) {
        if (_compiledDef.context.hasOwnProperty(dk) && !ctx.hasOwnProperty(dk)) ctx[dk] = _compiledDef.context[dk];
      }
    }
    // Overlay SCXML lifecycle onto HTML state elements
    if (_compiledDef && _compiledDef._stateTree) {
      for (var sn in _compiledDef._stateTree) {
        if (!_compiledDef._stateTree.hasOwnProperty(sn)) continue;
        var defSpec = _compiledDef._stateTree[sn].spec;
        var domEl = stateMap[sn];
        if (!domEl) continue;
        if (defSpec.where && !domEl._mnWhere) domEl._mnWhere = defSpec.where;
        if (defSpec.init && !domEl._mnInit) domEl._mnInit = defSpec.init;
        if (defSpec.exit && !domEl._mnExit) domEl._mnExit = defSpec.exit;
        if (defSpec.temporal && !domEl._mnTemporal) domEl._mnTemporal = defSpec.temporal;
      }
    }

    // Canonical instance (shared context, no init hooks)
    var _canonicalInst = null;
    if (_compiledDef && _machineMod) {
      _canonicalInst = {
        id: name + '_browser', definitionId: _compiledDef.id, state: initial,
        history: [], _definition: _compiledDef,
        _host: { now: function () { return Date.now(); }, capabilities: _hostCapabilities,
          emit: function () {}, scheduleAfter: function () { return 0; },
          scheduleEvery: function () { return 0; }, cancelTimer: function () {},
          persist: function () {}, log: function () {} },
        _timers: [], _mnDirty: null
      };
      // context is a live getter — always reads from inst.ctx.
      // Immutable updates to inst.ctx are automatically visible.
      Object.defineProperty(_canonicalInst, 'context', {
        get: function () { return inst.ctx; },
        set: function (v) { inst.ctx = v; },
        enumerable: true
      });
    }

    // ── Build instance ──────────────────────────────────────────
    var inst = {
      el: el, name: name, ctx: ctx, state: initial, states: stateNames,
      _def: _compiledDef, _canonical: _canonicalInst,
      _stateMap: stateMap, _stateTmpls: stateTmpls,
      _compoundChromes: compoundChromes, _persistKey: persistKey,
      _afterTimer: null, _stateIntervals: [],
      send: function (event, itemScope, templateDefs) { return _sendEvent(inst, event, itemScope, templateDefs); },
      to: function (target, contentHtml) { return _transitionTo(inst, target, contentHtml); },
      emit: function (eventName, payload) {
        document.dispatchEvent(new CustomEvent('mn-' + eventName, { detail: { source: el, payload: payload } }));
      },
      update: function () { _applyBindings(el, inst, persistKey); }
    };

    // Timer cleanup accessors
    el._mnTimers = {
      getAfter: function () { return inst._afterTimer; },
      clearAfter: function () { if (inst._afterTimer) { clearTimeout(inst._afterTimer); inst._afterTimer = null; } },
      clearIntervals: function () { for (var i = 0; i < inst._stateIntervals.length; i++) clearInterval(inst._stateIntervals[i]); inst._stateIntervals = []; }
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
    if (_canonicalInst) {
      _canonicalInst._host.emit = function (eventName, payload) { inst.emit(eventName, payload); };
    }
    _wireInstance(el, inst, setup, function (stateEl, stateName) { _evalTemporal(inst, stateEl, stateName); });
    return inst;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Global event delegation                                                ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  var _listening = false;

  function _setupListeners() {
    if (_listening) return;
    _listening = true;

    // mn-to: click → send()
    //
    // Thin handler. Extracts scope, classifies template-level vs state-level,
    // delegates to inst.send() which handles all dispatch paths.
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
      var itemScope = _scopeFor(toEl, machineEl, inst.ctx);
      var templateDefs = _findTemplateTrans(toEl, machineEl, value);
      inst.send(value, itemScope, templateDefs);
    });

    // mn-model: input → context
    // When inside an mn-each item, also updates the original $item so
    // changes persist through re-renders.
    function _modelSet(m, machineEl) {
      var inst = machineEl._mn;
      var scope = _scopeFor(m, machineEl, inst.ctx);
      var path = m.getAttribute('mn-model');
      var val = m.type === 'checkbox' ? m.checked
                : (m.type === 'number' || m.type === 'range') ? (m.value === '' ? 0 : Number(m.value))
                : m.value;
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
  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  SCXML-first boot                                                       ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // <link rel="mn-machine" href="machines/app.scxml" /> declares the app machine.
  // The boot sequence: load XSLT stylesheets → load SCXML machine → apply XSLT
  // → inject resulting HTML into body → init machines as normal.
  //
  // If no mn-machine link exists, boot falls back to the existing HTML-first path:
  // load imports → init machines from existing DOM.

  function _loadMachineLinks() {
    var links = document.querySelectorAll('link[rel="mn-machine"]');
    if (links.length === 0) return Promise.resolve();

    var promises = [];
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href');
      if (!href) continue;
      (function (url) {
        promises.push(
          fetch(url).then(function (res) {
            if (!res.ok) throw new Error('mn-machine fetch failed: ' + res.status + ' for ' + url);
            return res.text();
          }).then(function (scxml) {
            // Extract machine name from SCXML id attribute
            var idMatch = scxml.match(/<scxml[^>]*\bname="([^"]+)"/) || scxml.match(/<scxml[^>]*\bid="([^"]+)"/);
            var machineName = idMatch ? idMatch[1] : null;
            if (!machineName) {
              console.warn('[mn] mn-machine at ' + url + ' has no name or id attribute');
              return;
            }

            // Store the SCXML definition for composition with HTML templates
            _scxmlDefs[machineName] = scxml;
            if (engine.debug) console.log('[mn-debug] SCXML definition loaded: ' + machineName);
          })
        );
      })(href);
    }
    return Promise.all(promises);
  }

  function _boot() {
    Promise.all([_loadImports(), _loadMachineLinks()]).then(function () {
      init();
      _observe();
    }).catch(function (err) {
      console.error('[mn] boot failed:', err && err.message ? err.message : err);
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
  var _sessionId = null;
  var _sseSource = null;


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
  // ║  Browser self-registration + SSE receive                                ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function _generateSessionId() {
    return 'session-' + Math.random().toString(36).substring(2, 10);
  }

  function _openSSE(serverUrl) {
    if (!serverUrl || !_sessionId) return;
    var url = serverUrl + '/sse/' + _sessionId;
    _sseSource = new EventSource(url);
    _sseSource.addEventListener('machine', function (event) {
      var scxmlString;
      try { scxmlString = atob(event.data); }
      catch (e) { scxmlString = event.data; }
      _receiveMachine(scxmlString);
    });
    _sseSource.onerror = function () {
      if (engine.debug) console.log('[mn-debug] SSE connection error — will auto-reconnect');
    };
  }

  function _receiveMachine(scxmlString) {
    try {
    var _transforms = (typeof MPTransforms !== 'undefined') ? MPTransforms : null;
    if (!_transforms) return;
    var incoming = _transforms.extractMachine(scxmlString);
    if (!incoming || !incoming.name) return;

    if (engine.debug) console.log('[mn-debug] received machine: ' + incoming.name + ' state=' + incoming.state);

    var el = document.querySelector('[mn="' + incoming.name + '"]');
    if (el && el._mn) {
      var inst = el._mn;
      if (incoming.context) {
        var newCtx = {};
        for (var k in inst.ctx) { if (inst.ctx.hasOwnProperty(k)) newCtx[k] = inst.ctx[k]; }
        for (var k in incoming.context) { if (incoming.context.hasOwnProperty(k)) newCtx[k] = incoming.context[k]; }
        inst.ctx = newCtx;
      }

      // Recompile response SCXML to pick up embedded invokes
      if (_scxmlMod && incoming.state && inst._def) {
        try {
          var responseDef = _scxmlMod.compile(scxmlString, {});
          if (responseDef._stateTree[incoming.state] && responseDef._stateTree[incoming.state].spec.invokes) {
            if (!inst._def._stateTree[incoming.state]) {
              inst._def._stateTree[incoming.state] = { parent: null, spec: {} };
            }
            inst._def._stateTree[incoming.state].spec.invokes = responseDef._stateTree[incoming.state].spec.invokes;
          }
        } catch (e) { /* response may not be compilable — skip invoke update */ }
      }

      if (incoming.state && incoming.state !== inst.state) {
        inst._mnWhereResolved = inst._mnWhereGen || 0;
        inst.to(incoming.state);
      } else {
        inst.update();
      }
    }
    } catch (err) {
      console.warn('[mn] _receiveMachine error: ' + (err.message || err));
    }
  }

  function _closeSSE() {
    if (_sseSource) { _sseSource.close(); _sseSource = null; }
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


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  DOM → SCXML serialization                                              ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Walks the machine element's DOM and produces an SCXML string.
  // Reads state structure from <template mn-state-template> elements
  // and lifecycle properties stored on state elements by _initMachine.
  // S-expressions are CDATA-wrapped (< and > are illegal in XML text).

  // CDATA-wrap s-expression content for XML serialization.
  // S-expressions may contain < and <= which are illegal bare in XML text.
  // CDATA is standard XML — every parser and tool handles it.
  function _cdata(str) {
    return str ? '<![CDATA[' + str + ']]>' : '';
  }

  function _machineElToScxml(machineEl) {
    var inst = machineEl._mn;
    if (!inst) return null;

    // If we have the original SCXML definition, just update state and context
    if (_scxmlDefs[inst.name]) {
      var ctxObj = {};
      for (var ck in inst.ctx) {
        if (inst.ctx.hasOwnProperty(ck) && ck !== '$store' && ck !== '$refs') ctxObj[ck] = inst.ctx[ck];
      }
      var transforms = (typeof MPTransforms !== 'undefined') ? MPTransforms : null;
      if (transforms) return transforms.updateScxmlState(_scxmlDefs[inst.name], inst.state, ctxObj);
      // Fallback: manual update
      var scxml = _scxmlDefs[inst.name];
      var ctxJson = JSON.stringify(ctxObj).replace(/'/g, '&apos;');
      if (scxml.indexOf('initial="') !== -1) {
        scxml = scxml.replace(/initial="[^"]*"/, 'initial="' + inst.state + '"');
      }
      if (scxml.indexOf("mn-ctx='") !== -1) {
        scxml = scxml.replace(/mn-ctx='[^']*'/, "mn-ctx='" + ctxJson + "'");
      } else {
        scxml = scxml.replace(/(<scxml\b[^>]*?)(\s*>)/, "$1 mn-ctx='" + ctxJson + "'$2");
      }
      return scxml;
    }

    // HTML-only fallback: walk the DOM
    var name = machineEl.getAttribute('mn') || 'unknown';
    var state = inst.state;
    var ctxJson = JSON.stringify(inst.ctx, function (key, val) {
      // Skip internal framework properties
      if (key === '$store' || key === '$refs') return undefined;
      return val;
    }).replace(/'/g, '&apos;');

    var lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push("<scxml id=\"" + name + "\" initial=\"" + state + "\" mn-ctx='" + ctxJson + "'>");

    // Walk state templates and state elements
    var templates = machineEl.querySelectorAll('template[mn-state-template]');
    var stateEls = machineEl.querySelectorAll('[mn-state]');
    var processed = {};

    // Process templates (inactive states — content preserved)
    for (var ti = 0; ti < templates.length; ti++) {
      var tmpl = templates[ti];
      var stateName = tmpl.getAttribute('mn-state-template');
      if (processed[stateName]) continue;
      processed[stateName] = true;

      // Find the corresponding state element for lifecycle properties
      var stateEl = null;
      for (var si = 0; si < stateEls.length; si++) {
        if (stateEls[si].getAttribute('mn-state') === stateName && stateEls[si].closest('[mn]') === machineEl) {
          stateEl = stateEls[si];
          break;
        }
      }

      var isFinal = stateEl && stateEl.hasAttribute('mn-final');
      lines.push('  <' + (isFinal ? 'final' : 'state') + ' id="' + stateName + '">');

      // Lifecycle from element properties (set by _initMachine)
      if (stateEl && stateEl._mnWhere) lines.push('    <mn-where>' + _cdata(stateEl._mnWhere) + '</mn-where>');
      if (stateEl && stateEl._mnInit) lines.push('    <mn-init>' + _cdata(stateEl._mnInit) + '</mn-init>');
      if (stateEl && stateEl._mnExit) lines.push('    <mn-exit>' + _cdata(stateEl._mnExit) + '</mn-exit>');
      if (stateEl && stateEl._mnTemporal) lines.push('    <mn-temporal>' + _cdata(stateEl._mnTemporal) + '</mn-temporal>');

      // Extract transitions from template content
      var transEls = tmpl.content.querySelectorAll('mn-transition');
      for (var tri = 0; tri < transEls.length; tri++) {
        var tr = transEls[tri];
        var event = tr.getAttribute('event') || '';
        var target = tr.getAttribute('to') || '';
        lines.push('    <transition' + (event ? ' event="' + event + '"' : '') + (target ? ' target="' + target + '"' : '') + '>');

        var guardEl = tr.querySelector('mn-guard');
        if (guardEl) lines.push('      <mn-guard>' + _cdata(guardEl.textContent.trim()) + '</mn-guard>');

        var actionEl = tr.querySelector('mn-action');
        if (actionEl) lines.push('      <mn-action>' + _cdata(actionEl.textContent.trim()) + '</mn-action>');

        var emitEl = tr.querySelector('mn-emit');
        if (emitEl) lines.push('      <mn-emit>' + emitEl.textContent.trim() + '</mn-emit>');

        lines.push('    </transition>');
      }

      lines.push('  </' + (isFinal ? 'final' : 'state') + '>');
    }

    // Process active state (content is live in the DOM, not in a template)
    for (var ai = 0; ai < stateEls.length; ai++) {
      var activeEl = stateEls[ai];
      var activeName = activeEl.getAttribute('mn-state');
      if (processed[activeName]) continue;
      if (activeEl.closest('[mn]') !== machineEl) continue;
      processed[activeName] = true;

      var isActiveFinal = activeEl.hasAttribute('mn-final');
      lines.push('  <' + (isActiveFinal ? 'final' : 'state') + ' id="' + activeName + '">');

      if (activeEl._mnWhere) lines.push('    <mn-where>' + _cdata(activeEl._mnWhere) + '</mn-where>');
      if (activeEl._mnInit) lines.push('    <mn-init>' + _cdata(activeEl._mnInit) + '</mn-init>');
      if (activeEl._mnExit) lines.push('    <mn-exit>' + _cdata(activeEl._mnExit) + '</mn-exit>');
      if (activeEl._mnTemporal) lines.push('    <mn-temporal>' + _cdata(activeEl._mnTemporal) + '</mn-temporal>');

      // Active state transitions from parsed instance data
      // inst._transitions[state] is { eventName: [defs] }, not an array
      if (inst._transitions && inst._transitions[activeName]) {
        var parsedTrans = inst._transitions[activeName];
        for (var evName in parsedTrans) {
          if (!parsedTrans.hasOwnProperty(evName)) continue;
          var evDefs = parsedTrans[evName];
          for (var pi = 0; pi < evDefs.length; pi++) {
            var pt = evDefs[pi];
            lines.push('    <transition event="' + evName + '"' + (pt.target ? ' target="' + pt.target + '"' : '') + '>');
            if (pt.guard) lines.push('      <mn-guard>' + _cdata(pt.guard) + '</mn-guard>');
            if (pt.action) lines.push('      <mn-action>' + _cdata(pt.action) + '</mn-action>');
            if (pt.emit) lines.push('      <mn-emit>' + pt.emit + '</mn-emit>');
            lines.push('    </transition>');
          }
        }
      }

      lines.push('  </' + (isActiveFinal ? 'final' : 'state') + '>');
    }

    lines.push('</scxml>');
    return lines.join('\n');
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  SCXML definition cache                                                 ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // SCXML machines loaded via <link rel="mn-machine"> are stored here.
  // When the browser encounters <div mn="foo">, it checks _scxmlDefs[foo]
  // for a compiled definition to pair with the mn-define HTML template.

  var _scxmlDefs = {};  // machine name → SCXML string


  function _sendMachineToNode(machineEl, node, targetState) {
    if (!machineEl || !machineEl._mn) return Promise.reject(new Error('no machine'));

    // Do NOT call update() here — the machine may be mid-transition.
    // Serialize from current state and context directly.
    var body = _machineElToScxml(machineEl);
    var transport = node.transport;

    if (!transport || !transport.type) {
      return Promise.reject(new Error('node ' + node.id + ' has no transport'));
    }

    var headers = { 'Content-Type': 'application/xml' };
    if (_sessionId) headers['X-MN-Session'] = _sessionId;

    return fetch(transport.address, {
      method: 'POST',
      headers: headers,
      body: body
    }).then(function (res) {
      if (!res.ok && res.status !== 202) throw new Error('HTTP ' + res.status + ' from ' + transport.address);
      return '';
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
        if (config.server) {
          _sessionId = config.sessionId || _generateSessionId();
          _openSSE(config.server);
          if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', _closeSSE);
          }
        }
      } else {
        init(rootOrConfig);
      }
    },
    fn: function (name, func) { _userFns[name] = func; },
    get store() { return _store; },
    get _sseSource() { return _sseSource; },
    get _sessionId() { return _sessionId; },
    get debug() { return engine.debug; },
    set debug(v) { engine.debug = !!v; },

    // ── Debug API for devtools ─────────────────────────────────
    // Returns a snapshot of all live machine instances for the devtools panel.
    _debug: function () {
      var all = document.querySelectorAll('[mn]');
      var machines = [];
      for (var i = 0; i < all.length; i++) {
        var inst = all[i]._mn;
        if (!inst) continue;
        var enabled = [];
        if (inst._canonical && _machineMod) {
          try {
            var info = _machineMod.inspect(inst._canonical);
            enabled = info.enabled;
          } catch (e) {}
        }
        machines.push({
          name: inst.name,
          state: inst.state,
          context: JSON.parse(JSON.stringify(inst.ctx)),
          enabled: enabled,
          states: inst.states
        });
      }
      return { machines: machines, store: JSON.parse(JSON.stringify(_store)) };
    },

    // Evaluate an s-expression against a named machine's live context.
    _eval: function (expr, machineName) {
      if (!machineName) return engine.eval(expr, {});
      var el = document.querySelector('[mn="' + machineName + '"]');
      if (!el || !el._mn) return null;
      return engine.eval(expr, el._mn.ctx, el._mn.state, el._mn.el);
    },

    // Send an event to a named machine (fires the transition live).
    _send: function (machineName, event) {
      var el = document.querySelector('[mn="' + machineName + '"]');
      if (!el || !el._mn) return null;
      el._mn.send(event);
      return { state: el._mn.state };
    }
  };
});
