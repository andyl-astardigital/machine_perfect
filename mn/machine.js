/**
 * machine_native — canonical machine execution.
 *
 * Pure machine logic on top of the shared engine. No DOM, no HTTP,
 * no platform dependencies. Both browser and Node hosts compile their
 * markup into canonical definitions and execute through this module.
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
    root.MPMachine = factory(root.MPEngine);
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (engine) {


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Machine definition                                                     ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // A definition is a validated, frozen description of a machine's structure.
  // States, transitions, guards, actions — all declared. S-expressions stay
  // as strings until evaluation. The definition is the canonical format that
  // both HTML and SCXML compile into.

  // ── Hierarchy helpers ──

  function _buildStateTree(states, parentPath, depth, tree) {
    for (var name in states) {
      var fullPath = parentPath ? parentPath + '.' + name : name;
      tree[fullPath] = { spec: states[name], parent: parentPath, depth: depth };
      if (states[name].states) {
        _buildStateTree(states[name].states, fullPath, depth + 1, tree);
      }
    }
  }

  function _resolveTarget(target, sourcePath, stateTree) {
    // Absolute dot-path: use as-is
    if (target.indexOf('.') !== -1 && stateTree[target]) return target;
    // Walk up from source: check siblings at each level
    var path = sourcePath;
    while (path) {
      var parent = stateTree[path].parent;
      var candidate = parent ? parent + '.' + target : target;
      if (stateTree[candidate]) return candidate;
      path = parent;
    }
    return null;
  }

  function _descendToAtomic(statePath, stateTree) {
    if (!stateTree[statePath]) return statePath;
    var spec = stateTree[statePath].spec;
    while (spec.states) {
      var childName = spec.initial || Object.keys(spec.states)[0];
      statePath = statePath + '.' + childName;
      if (!stateTree[statePath]) return statePath;
      spec = stateTree[statePath].spec;
    }
    return statePath;
  }

  function _getAncestors(statePath, stateTree) {
    var ancestors = [];
    var path = statePath;
    while (path && stateTree[path]) {
      ancestors.push(path);
      path = stateTree[path].parent;
    }
    return ancestors;
  }

  function _computeLCA(pathA, pathB, stateTree) {
    var ancestorsA = _getAncestors(pathA, stateTree);
    var ancestorsB = _getAncestors(pathB, stateTree);
    for (var i = 0; i < ancestorsA.length; i++) {
      if (ancestorsB.indexOf(ancestorsA[i]) !== -1) return ancestorsA[i];
    }
    return null; // no common ancestor (top-level siblings)
  }

  function _validateTransitions(states, parentPath, stateTree, defId) {
    for (var stateName in states) {
      var fullPath = parentPath ? parentPath + '.' + stateName : stateName;
      var state = states[stateName];
      if (state.on) {
        for (var eventName in state.on) {
          var transitions = state.on[eventName];
          if (!Array.isArray(transitions)) transitions = [transitions];
          for (var i = 0; i < transitions.length; i++) {
            var target = transitions[i].target;
            if (target) {
              var resolved = _resolveTarget(target, fullPath, stateTree);
              if (!resolved) {
                throw new Error('[mn] transition target "' + target + '" does not exist in "' + defId + '" (from state "' + fullPath + '" on event "' + eventName + '")');
              }
              if (resolved === fullPath) {
                console.warn('[mn] self-transition in "' + defId + '": state "' + fullPath + '" targets itself on event "' + eventName + '". Consider decomposing into substates.');
              }
            }
          }
          states[stateName].on[eventName] = transitions;
        }
      }
      // Recurse into compound states
      if (state.states) {
        _validateTransitions(state.states, fullPath, stateTree, defId);
      }
    }
  }

  function createDefinition(spec) {
    if (!spec || !spec.id) throw new Error('[mn] definition requires an id');
    if (!spec.states || Object.keys(spec.states).length === 0) throw new Error('[mn] definition "' + spec.id + '" has no states');

    var stateNames = Object.keys(spec.states);
    var initial = spec.initial || stateNames[0];

    if (stateNames.indexOf(initial) === -1) {
      throw new Error('[mn] initial state "' + initial + '" does not exist in "' + spec.id + '"');
    }

    // Deep-clone caller's states so _validateTransitions' array normalisation
    // never mutates the spec object the caller holds a reference to.
    var states = JSON.parse(JSON.stringify(spec.states));

    // Build state tree (recursive, handles compound states)
    var stateTree = {};
    _buildStateTree(states, null, 0, stateTree);

    // Validate transitions recursively (mutates cloned states — safe)
    _validateTransitions(states, null, stateTree, spec.id);

    // Register __timeout transitions for states with `after` timers.
    // Done at definition time so the definition is never mutated at runtime.
    // Placed after validation so invalid after targets are caught by validate(),
    // not by _validateTransitions throwing during construction.
    for (var sn in stateTree) {
      var ss = stateTree[sn].spec;
      if (ss.after && ss.after.target) {
        if (!ss.on) ss.on = {};
        if (!ss.on.__timeout) ss.on.__timeout = [{ target: ss.after.target }];
      }
    }

    return {
      id: spec.id,
      initial: initial,
      context: spec.context || {},
      maxHistory: spec.maxHistory != null ? spec.maxHistory : 200,
      states: states,
      stateNames: stateNames,
      _stateTree: stateTree
    };
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Machine instance                                                       ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // An instance is a running machine: current state, context data, and the
  // host adapter for platform capabilities. Created from a definition.

  function createInstance(definition, options) {
    options = options || {};

    // Deep-copy default context so instances don't share mutable state
    var context = deepCopy(definition.context);
    if (options.context) {
      var optCtx = deepCopy(options.context);
      for (var key in optCtx) {
        if (optCtx.hasOwnProperty(key)) context[key] = optCtx[key];
      }
    }

    var host = options.host || defaultHost;
    var timers = [];

    var instance = {
      id: options.id || definition.id + '_' + host.now(),
      definitionId: definition.id,
      state: definition.initial,
      context: context,
      history: [],
      _definition: definition,
      _host: host,
      _timers: timers,
      _mnDirty: null
    };

    // Descend to atomic initial state (handles compound states)
    var tree = definition._stateTree;
    var initialPath = _descendToAtomic(definition.initial, tree);
    instance.state = initialPath;

    // Run entry hooks from outermost to innermost
    var initAncestors = [];
    var ip = initialPath;
    while (ip) { initAncestors.unshift(ip); ip = tree[ip].parent; }
    for (var ii = 0; ii < initAncestors.length; ii++) {
      var initSpec = tree[initAncestors[ii]].spec;
      if (initSpec.init) {
        engine.exec(initSpec.init, context, instance.state, null, null, instance);
      }
      setupTimers(instance, initSpec, initAncestors[ii]);
    }

    // Check mn-where on initial atomic state
    var initialSpec = tree[initialPath].spec;
    if (initialSpec && initialSpec.where) {
      var required = engine.eval(initialSpec.where, context, instance.state, null) || [];
      var hostCaps = host.capabilities || [];
      var canSatisfy = true;
      for (var wi = 0; wi < required.length; wi++) {
        if (hostCaps.indexOf(required[wi]) === -1) { canSatisfy = false; break; }
      }
      if (!canSatisfy) {
        instance.route = { requires: required, state: initialPath, where: initialSpec.where };
      }
    }

    return instance;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Event processing                                                       ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // The core execution loop. Receives an event, evaluates guards, executes
  // actions, transitions state, runs entry/exit hooks, records history.
  // Returns a result describing what happened.
  // eventData is optional metadata recorded in the history trail (not used in guards/actions).

  function sendEvent(instance, eventName, eventData) {
    // Reentrancy guard: prevent sendEvent during sendEvent (e.g. synchronous timer)
    if (instance._processing) {
      console.warn('[mn] sendEvent reentrancy detected (event: ' + eventName + '). Queued events are not supported.');
      return createResult(instance, instance.state, instance.state, eventName, false, 'reentrant');
    }
    instance._processing = true;
    try {

    var definition = instance._definition;
    var tree = definition._stateTree;
    var fromState = instance.state;

    if (!tree[fromState]) {
      return createResult(instance, fromState, fromState, eventName, false, 'unknown current state');
    }

    // ── Find matching transition (walk up hierarchy) ──
    var taken = null;
    var transitionSource = null;
    var searchPath = fromState;
    while (searchPath != null) {
      var searchSpec = tree[searchPath].spec;
      var transitions = (searchSpec.on && searchSpec.on[eventName]) || [];
      for (var i = 0; i < transitions.length; i++) {
        if (transitions[i].guard) {
          if (!engine.eval(transitions[i].guard, instance.context, instance.state, null)) continue;
        }
        taken = transitions[i];
        transitionSource = searchPath;
        break;
      }
      if (taken) break;
      searchPath = tree[searchPath].parent;
    }

    if (!taken) {
      return createResult(instance, fromState, fromState, eventName, false, 'no matching transition');
    }

    // ── mn-where: distributed transition routing ──
    if (taken.where) {
      var required = engine.eval(taken.where, instance.context, instance.state, null) || [];
      var hostCaps = instance._host.capabilities || [];
      var canExecuteLocally = true;
      for (var ci = 0; ci < required.length; ci++) {
        if (hostCaps.indexOf(required[ci]) === -1) { canExecuteLocally = false; break; }
      }
      if (!canExecuteLocally) {
        var result = createResult(instance, fromState, fromState, eventName, false, 'routed');
        result.route = { requires: required, event: eventName, target: taken.target, guard: taken.guard || null, action: taken.action || null, where: taken.where };
        return result;
      }
    }

    // ── Targetless transition: run action, no state change, no lifecycle ──
    if (!taken.target) {
      var oldCtxTargetless = instance._watchers && instance._watchers.length > 0 ? deepCopy(instance.context) : null;
      instance._mnDirty = {};
      var targetlessEffects = [];
      if (taken.action) {
        var targetlessResult = engine.exec(taken.action, instance.context, fromState, null, null, instance);
        if (targetlessResult && targetlessResult.effects) targetlessEffects = targetlessResult.effects;
      }
      var dirty = instance._mnDirty;
      instance._mnDirty = null;
      var result = createResult(instance, fromState, fromState, eventName, false, null);
      result.targetless = true;
      result.changed = Object.keys(dirty);
      result.effects = targetlessEffects;
      result.emits = taken.emit ? [taken.emit] : [];
      instance.history.push({ timestamp: instance._host.now(), event: eventName, data: eventData != null ? eventData : null, from: fromState, to: fromState, changed: result.changed });
      var maxHistTargetless = definition.maxHistory;
      if (instance.history.length > maxHistTargetless) instance.history.shift();
      if (instance._host.persist) instance._host.persist(snapshot(instance));
      _notifyWatchers(instance, result.changed, oldCtxTargetless);
      return result;
    }

    // ── Resolve target to fully-qualified path ──
    var toState = _resolveTarget(taken.target, transitionSource, tree);
    // If target is compound, descend to its initial atomic child
    var atomicTarget = _descendToAtomic(toState, tree);

    // Track dirty keys
    instance._mnDirty = {};
    // Snapshot old context for watchers
    var oldCtx = instance._watchers && instance._watchers.length > 0 ? deepCopy(instance.context) : null;

    // ── Compute exit/enter paths via LCA ──
    var lca = _computeLCA(fromState, atomicTarget, tree);
    // Exit: from current up to (not including) LCA, innermost first
    var exitPath = [];
    var ep = fromState;
    while (ep && ep !== lca) { exitPath.push(ep); ep = tree[ep].parent; }
    // Enter: from LCA down to atomic target, outermost first
    var enterAncestors = [];
    var np = atomicTarget;
    while (np && np !== lca) { enterAncestors.unshift(np); np = tree[np].parent; }

    // ── Exit states (innermost first) ──
    var effects = [];
    for (var ei = 0; ei < exitPath.length; ei++) {
      var exitSpec = tree[exitPath[ei]].spec;
      clearTimersForState(instance, exitPath[ei]);
      if (exitSpec.exit) {
        var exitResult = engine.exec(exitSpec.exit, instance.context, exitPath[ei], null, null, instance);
        if (exitResult && exitResult.effects) effects = effects.concat(exitResult.effects);
      }
    }

    // ── Execute transition action ──
    if (taken.action) {
      var actionResult = engine.exec(taken.action, instance.context, fromState, null, null, instance);
      if (actionResult && actionResult.effects) effects = effects.concat(actionResult.effects);
    }

    // ── Enter states (outermost first) ──
    for (var ni = 0; ni < enterAncestors.length; ni++) {
      var enterSpec = tree[enterAncestors[ni]].spec;
      if (enterSpec.init) {
        var initResult = engine.exec(enterSpec.init, instance.context, enterAncestors[ni], null, null, instance);
        if (initResult && initResult.effects) effects = effects.concat(initResult.effects);
      }
      setupTimers(instance, enterSpec, enterAncestors[ni]);
    }

    // ── Change state ──
    instance.state = atomicTarget;
    toState = atomicTarget;

    // ── Eventless transitions on the final atomic state ──
    var emitsAuto;
    // 101 iterations: up to 100 real transitions plus one final stability check.
    // The extra pass lets the machine confirm the new state has no more auto
    // transitions before declaring the limit exceeded. Without it, a machine
    // that takes exactly 100 steps would trigger a spurious warning.
    var autoLimit = 101;
    while (autoLimit-- > 0) {
      var autoSpec = tree[instance.state] ? tree[instance.state].spec : null;
      var autoTransitions = (autoSpec && autoSpec.on && autoSpec.on.__auto) || [];
      var autoTaken = null;
      for (var ai = 0; ai < autoTransitions.length; ai++) {
        if (autoTransitions[ai].guard) {
          if (!engine.eval(autoTransitions[ai].guard, instance.context, instance.state, null)) continue;
        }
        autoTaken = autoTransitions[ai];
        break;
      }
      if (!autoTaken) break;
      var autoTo = autoTaken.target ? _resolveTarget(autoTaken.target, instance.state, tree) : instance.state;
      if (autoTo === instance.state) break;

      var autoAtomicTo = _descendToAtomic(autoTo, tree);
      var autoLca = _computeLCA(instance.state, autoAtomicTo, tree);
      var autoExit = [];
      var aep = instance.state;
      while (aep && aep !== autoLca) { autoExit.push(aep); aep = tree[aep].parent; }
      var autoEnter = [];
      var anp = autoAtomicTo;
      while (anp && anp !== autoLca) { autoEnter.unshift(anp); anp = tree[anp].parent; }

      for (var aei = 0; aei < autoExit.length; aei++) {
        var aeSpec = tree[autoExit[aei]].spec;
        clearTimersForState(instance, autoExit[aei]);
        if (aeSpec.exit) { var aeResult = engine.exec(aeSpec.exit, instance.context, autoExit[aei], null, null, instance); if (aeResult && aeResult.effects) effects = effects.concat(aeResult.effects); }
      }
      if (autoTaken.action) {
        var aar = engine.exec(autoTaken.action, instance.context, instance.state, null, null, instance);
        if (aar && aar.effects) effects = effects.concat(aar.effects);
      }
      for (var ani = 0; ani < autoEnter.length; ani++) {
        var anSpec = tree[autoEnter[ani]].spec;
        if (anSpec.init) {
          var anir = engine.exec(anSpec.init, instance.context, autoEnter[ani], null, null, instance);
          if (anir && anir.effects) effects = effects.concat(anir.effects);
        }
        setupTimers(instance, anSpec, autoEnter[ani]);
      }
      instance.state = autoAtomicTo;
      toState = autoAtomicTo;
      if (autoTaken.emit) { if (!emitsAuto) emitsAuto = []; emitsAuto.push(autoTaken.emit); }
    }
    if (autoLimit < 0) console.warn('[mn] eventless transition loop limit reached in "' + definition.id + '" at state "' + instance.state + '"');

    // ── Collect emitted events ──
    var emits = [];
    if (taken.emit) emits.push(taken.emit);
    if (emitsAuto) emits = emits.concat(emitsAuto);

    // ── done.state.* on final state entry ──
    var finalSpec = tree[instance.state] ? tree[instance.state].spec : null;
    if (finalSpec && finalSpec.final) {
      var doneParent = tree[instance.state].parent;
      if (doneParent) emits.push('done.state.' + doneParent);
      else emits.push('done.state.' + instance.state);
    }

    // ── Build result ──
    var dirty = instance._mnDirty;
    instance._mnDirty = null;

    var result = createResult(instance, fromState, toState, eventName, true, null);
    result.changed = Object.keys(dirty);
    result.emits = emits;
    result.effects = effects;

    // ── Record history ──
    var historyEntry = {
      timestamp: instance._host.now(),
      event: eventName,
      data: eventData != null ? eventData : null,
      from: fromState,
      to: toState,
      changed: result.changed
    };
    instance.history.push(historyEntry);
    var maxHist = definition.maxHistory;
    if (instance.history.length > maxHist) instance.history.shift();

    // ── Notify host ──
    if (instance._host.persist) {
      instance._host.persist(snapshot(instance));
    }

    // ── Notify watchers ──
    if (oldCtx && result.changed.length > 0) {
      _notifyWatchers(instance, result.changed, oldCtx);
    }

    return result;

    } finally { instance._processing = false; }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Inspection                                                             ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Query a machine instance for its current capabilities.
  // No side effects. Pure reads.

  function inspect(instance) {
    var definition = instance._definition;
    var tree = definition._stateTree;
    var enabled = [];
    var seen = {}; // avoid duplicate event names from parent overrides

    // Walk up hierarchy collecting enabled transitions
    var searchPath = instance.state;
    while (searchPath != null) {
      var spec = tree[searchPath].spec;
      if (spec.on) {
        for (var eventName in spec.on) {
          if (seen[eventName]) continue; // child takes priority
          if (eventName === '.' || eventName.charAt(0) === '_') continue; // internal
          var transitions = spec.on[eventName];
          for (var i = 0; i < transitions.length; i++) {
            var transition = transitions[i];
            var guardPasses = true;
            if (transition.guard) {
              guardPasses = !!engine.eval(transition.guard, instance.context, instance.state, null);
            }
            if (guardPasses) {
              enabled.push({
                event: eventName,
                target: transition.target,
                guard: transition.guard || null
              });
              seen[eventName] = true;
              break;
            }
          }
        }
      }
      searchPath = tree[searchPath].parent;
    }

    // Active states: current atomic state + all ancestors
    var activeStates = _getAncestors(instance.state, tree);

    var currentSpec = tree[instance.state] ? tree[instance.state].spec : null;

    return {
      id: instance.id,
      definitionId: instance.definitionId,
      state: instance.state,
      activeStates: activeStates,
      context: deepCopy(instance.context),
      enabled: enabled,
      isFinal: !!(currentSpec && currentSpec.final),
      history: deepCopy(instance.history)
    };
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Snapshot / restore                                                     ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Serialise an instance to a plain object for persistence or transport.
  // Restore recreates a running instance from a snapshot + definition.

  function snapshot(instance) {
    return {
      id: instance.id,
      definitionId: instance.definitionId,
      state: instance.state,
      context: deepCopy(instance.context),
      history: deepCopy(instance.history),
      // Pending timers — stored so they survive persistence/restart.
      // The host re-establishes them on restore.
      pendingTimers: instance._pendingTimers ? deepCopy(instance._pendingTimers) : null
    };
  }

  function restore(definition, snap, host) {
    host = host || defaultHost;
    var instance = {
      id: snap.id,
      definitionId: snap.definitionId,
      state: snap.state,
      context: deepCopy(snap.context),
      history: snap.history ? deepCopy(snap.history) : [],
      _definition: definition,
      _host: host,
      _timers: [],
      _pendingTimers: [],
      _stateTimers: {},
      _mnDirty: null
    };

    // Re-establish durable timers from snapshot, adjusting for elapsed time
    if (snap.pendingTimers && snap.pendingTimers.length > 0) {
      var now = host.now();
      for (var i = 0; i < snap.pendingTimers.length; i++) {
        var timer = snap.pendingTimers[i];
        if (timer.type === 'after') {
          var elapsed = now - timer.createdAt;
          var remaining = Math.max(0, timer.ms - elapsed);
          var afterMeta = { type: 'after', ms: timer.ms, target: timer.target, createdAt: timer.createdAt, _statePath: timer._statePath || null };
          instance._pendingTimers.push(afterMeta);
          (function (meta, statePath) {
            var id = host.scheduleAfter(remaining, function () {
              instance._pendingTimers = instance._pendingTimers.filter(function (t) { return t !== meta; });
              sendEvent(instance, '__timeout', null);
            });
            instance._timers.push(id);
            if (statePath) {
              if (!instance._stateTimers[statePath]) instance._stateTimers[statePath] = [];
              instance._stateTimers[statePath].push(id);
            }
          })(afterMeta, timer._statePath || null);
        } else if (timer.type === 'every') {
          var everyMeta = { type: 'every', ms: timer.ms, action: timer.action, createdAt: timer.createdAt, _statePath: timer._statePath || null };
          instance._pendingTimers.push(everyMeta);
          (function (action, statePath) {
            var id = host.scheduleEvery(timer.ms, function () {
              if (action) {
                engine.exec(action, instance.context, instance.state, null, null, instance);
                if (host.persist) host.persist(snapshot(instance));
              }
            });
            instance._timers.push(id);
            if (statePath) {
              if (!instance._stateTimers[statePath]) instance._stateTimers[statePath] = [];
              instance._stateTimers[statePath].push(id);
            }
          })(timer.action, timer._statePath || null);
        }
      }
    } else {
      // No saved timers — set up from definition
      var currentStateEntry2 = definition._stateTree[instance.state];
      setupTimers(instance, currentStateEntry2 ? currentStateEntry2.spec : null, instance.state);
    }

    return instance;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Validation                                                             ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Structural checks on a definition. No execution needed.
  // Returns an array of issues (empty = valid).

  function validate(definition) {
    var issues = [];
    var tree = definition._stateTree;
    var allNames = Object.keys(tree);

    // Check for unreachable states (walk from initial through all transitions)
    var reachable = {};
    var initialAtomic = _descendToAtomic(definition.initial, tree);
    var queue = _getAncestors(initialAtomic, tree);
    while (queue.length > 0) {
      var current = queue.shift();
      if (reachable[current]) continue;
      reachable[current] = true;
      var spec = tree[current].spec;
      if (spec.on) {
        for (var eventName in spec.on) {
          var transitions = spec.on[eventName];
          for (var i = 0; i < transitions.length; i++) {
            var target = transitions[i].target;
            if (target) {
              var resolved = _resolveTarget(target, current, tree);
              if (resolved && !reachable[resolved]) {
                queue.push(resolved);
                var atomic = _descendToAtomic(resolved, tree);
                if (atomic !== resolved) queue.push(atomic);
                var anc = _getAncestors(resolved, tree);
                for (var ai = 0; ai < anc.length; ai++) { if (!reachable[anc[ai]]) queue.push(anc[ai]); }
              }
            }
          }
        }
      }
      // Compound state: initial child is reachable
      if (spec.states) {
        var childInitial = current + '.' + (spec.initial || Object.keys(spec.states)[0]);
        if (!reachable[childInitial]) queue.push(childInitial);
      }
    }
    for (var si = 0; si < allNames.length; si++) {
      if (!reachable[allNames[si]]) {
        issues.push({ type: 'unreachable', state: allNames[si], message: 'State "' + allNames[si] + '" is not reachable from initial state "' + definition.initial + '"' });
      }
    }

    // Check all states in the tree
    for (var si2 = 0; si2 < allNames.length; si2++) {
      var stateName = allNames[si2];
      var state = tree[stateName].spec;

      // Non-final atomic states must have outbound transitions (or inherit from parent)
      if (!state.final && !state.states) {
        var hasTransitions = false;
        var checkPath = stateName;
        while (checkPath) {
          var checkSpec = tree[checkPath].spec;
          if (checkSpec.on) { for (var en in checkSpec.on) { hasTransitions = true; break; } }
          if (checkSpec.after) hasTransitions = true;
          if (hasTransitions) break;
          checkPath = tree[checkPath].parent;
        }
        if (!hasTransitions) {
          issues.push({ type: 'deadlock', state: stateName, message: 'Non-final state "' + stateName + '" has no outbound transitions (including inherited)' });
        }
      }

      // Final states should not have transitions
      if (state.final && state.on) {
        for (var en2 in state.on) {
          issues.push({ type: 'final-has-transitions', state: stateName, message: 'Final state "' + stateName + '" has outbound transition on event "' + en2 + '"' });
        }
      }

      // Compound state initial validation
      if (state.states) {
        var childInitialName = state.initial || Object.keys(state.states)[0];
        var fullChildPath = stateName + '.' + childInitialName;
        if (!tree[fullChildPath]) {
          issues.push({ type: 'invalid-initial', state: stateName, message: 'Compound state "' + stateName + '" has initial "' + childInitialName + '" which does not exist as a child state' });
        }
      }

      // Timer validation
      if (state.after && state.after.target) {
        var afterResolved = _resolveTarget(state.after.target, stateName, tree);
        if (!afterResolved) {
          issues.push({ type: 'invalid-target', state: stateName, message: 'mn-after target "' + state.after.target + '" does not exist in state "' + stateName + '"' });
        }
      }
      if (state.after && (typeof state.after.ms !== 'number' || state.after.ms <= 0)) {
        issues.push({ type: 'invalid-timer', state: stateName, message: 'mn-after ms must be a positive number in state "' + stateName + '", got: ' + state.after.ms });
      }
      if (state.every) {
        if (typeof state.every.ms !== 'number' || state.every.ms <= 0) {
          issues.push({ type: 'invalid-timer', state: stateName, message: 'mn-every ms must be a positive number in state "' + stateName + '", got: ' + state.every.ms });
        }
        if (state.every.action) {
          try { engine.parse(state.every.action); } catch (err) { issues.push({ type: 'parse', state: stateName, expression: state.every.action, message: 'Every action parse error: ' + err.message }); }
        }
      }

      // Guard and action parse validation
      if (state.on) {
        for (var en3 in state.on) {
          var trans = state.on[en3];
          for (var ti = 0; ti < trans.length; ti++) {
            if (trans[ti].guard) {
              try { engine.parse(trans[ti].guard); } catch (err) { issues.push({ type: 'parse', state: stateName, event: en3, expression: trans[ti].guard, message: 'Guard parse error: ' + err.message }); }
            }
            if (trans[ti].action) {
              try { engine.parse(trans[ti].action); } catch (err) { issues.push({ type: 'parse', state: stateName, event: en3, expression: trans[ti].action, message: 'Action parse error: ' + err.message }); }
            }
          }
        }
      }
    }

    // Check for undefined context key references in guards and actions.
    // Walk each expression's AST and collect bare symbol references. Warn on
    // any symbol not in definition context, not a $ variable, not in stdlib.
    var knownSymbols = Object.create(null);
    for (var ck in definition.context) { if (definition.context.hasOwnProperty(ck)) knownSymbols[ck] = true; }
    for (var sk in engine.stdlib) { if (engine.stdlib.hasOwnProperty(sk)) knownSymbols[sk] = true; }
    // Special forms handled by the evaluator's switch, not in stdlib
    var specialForms = ['if','when','unless','cond','do','let','fn','set!','inc!','dec!','toggle!',
      'push!','remove-where!','splice!','assoc!','swap!','to','emit','invoke!','prevent!','stop!',
      'focus!','then!','in-state?','when-state','and','or','not','->','->>','#'];
    for (var sfi = 0; sfi < specialForms.length; sfi++) knownSymbols[specialForms[sfi]] = true;

    function _collectUndefinedRefs(node, refs) {
      if (!node) return;
      if (node.t === 'Y' && node.v.charAt(0) !== '$' && node.v.indexOf('.') === -1 && !knownSymbols[node.v]) {
        refs[node.v] = true;
      }
      if (Array.isArray(node)) {
        for (var ri = 0; ri < node.length; ri++) _collectUndefinedRefs(node[ri], refs);
      }
      if (node.t === 'V' && Array.isArray(node.v)) {
        for (var vi = 0; vi < node.v.length; vi++) _collectUndefinedRefs(node.v[vi], refs);
      }
    }

    for (var si3 = 0; si3 < allNames.length; si3++) {
      var sName = allNames[si3];
      var sSpec = tree[sName].spec;
      if (!sSpec.on) continue;
      for (var en4 in sSpec.on) {
        var sTrans = sSpec.on[en4];
        for (var sti = 0; sti < sTrans.length; sti++) {
          var guardExpr = sTrans[sti].guard;
          var actionExpr = sTrans[sti].action;
          if (guardExpr) {
            var gRefs = {};
            _collectUndefinedRefs(engine.parse(guardExpr), gRefs);
            for (var gr in gRefs) {
              issues.push({ type: 'undefined-reference', state: sName, symbol: gr, expression: guardExpr,
                message: 'Symbol "' + gr + '" in state "' + sName + '" is not in the definition context' });
            }
          }
          if (actionExpr) {
            var aRefs = {};
            _collectUndefinedRefs(engine.parse(actionExpr), aRefs);
            for (var ar in aRefs) {
              issues.push({ type: 'undefined-reference', state: sName, symbol: ar, expression: actionExpr,
                message: 'Symbol "' + ar + '" in state "' + sName + '" is not in the definition context' });
            }
          }
        }
      }
    }

    return issues;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Internal helpers                                                       ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function clearTimersForState(instance, statePath) {
    var host = instance._host;
    var stateTimers = instance._stateTimers && instance._stateTimers[statePath];
    if (stateTimers) {
      for (var i = 0; i < stateTimers.length; i++) host.cancelTimer(stateTimers[i]);
      delete instance._stateTimers[statePath];
    }
    // Also remove pending timer metadata for this state
    if (instance._pendingTimers) {
      instance._pendingTimers = instance._pendingTimers.filter(function (t) { return t._statePath !== statePath; });
    }
  }

  function createResult(instance, fromState, toState, eventName, transitioned, reason) {
    var definition = instance._definition;
    var tree = definition._stateTree;
    var currentSpec = tree && tree[instance.state] ? tree[instance.state].spec : null;
    var enabled = [];
    var seen = {};
    var walkPath = instance.state;
    while (walkPath && tree && tree[walkPath]) {
      var walkSpec = tree[walkPath].spec;
      if (walkSpec.on) {
        for (var name in walkSpec.on) {
          if (name === '.' || name.charAt(0) === '_') continue;
          if (seen[name]) continue;
          var transitions = walkSpec.on[name];
          for (var ti = 0; ti < transitions.length; ti++) {
            var guardPasses = true;
            if (transitions[ti].guard) {
              guardPasses = !!engine.eval(transitions[ti].guard, instance.context, instance.state, null);
            }
            if (guardPasses) { enabled.push(name); seen[name] = true; break; }
          }
        }
      }
      walkPath = tree[walkPath].parent;
    }
    return {
      id: instance.id,
      event: eventName,
      from: fromState,
      to: toState,
      transitioned: transitioned,
      targetless: false,
      reason: reason,
      changed: [],
      emits: [],
      effects: [],
      enabled: enabled,
      isFinal: !!(currentSpec && currentSpec.final),
      context: deepCopy(instance.context),
      route: null
    };
  }

  function setupTimers(instance, stateSpec, statePath) {
    if (!stateSpec) return;
    var host = instance._host;

    if (!instance._pendingTimers) instance._pendingTimers = [];
    if (!instance._stateTimers) instance._stateTimers = {};

    function _trackTimer(id) {
      instance._timers.push(id);
      if (statePath) {
        if (!instance._stateTimers[statePath]) instance._stateTimers[statePath] = [];
        instance._stateTimers[statePath].push(id);
      }
    }

    if (stateSpec.after) {
      var afterMeta = {
        type: 'after',
        ms: stateSpec.after.ms,
        target: stateSpec.after.target,
        createdAt: host.now(),
        _statePath: statePath || null
      };
      instance._pendingTimers.push(afterMeta);

      var timerId = host.scheduleAfter(stateSpec.after.ms, function () {
        instance._pendingTimers = (instance._pendingTimers || []).filter(function (t) { return t !== afterMeta; });
        sendEvent(instance, '__timeout', null);
      });
      _trackTimer(timerId);
    }

    if (stateSpec.every) {
      var everyMeta = {
        type: 'every',
        ms: stateSpec.every.ms,
        action: stateSpec.every.action,
        createdAt: host.now(),
        _statePath: statePath || null
      };
      instance._pendingTimers.push(everyMeta);

      var intervalId = host.scheduleEvery(stateSpec.every.ms, function () {
        if (stateSpec.every.action) {
          engine.exec(stateSpec.every.action, instance.context, instance.state, null, null, instance);
          if (instance._host.persist) {
            instance._host.persist(snapshot(instance));
          }
        }
      });
      _trackTimer(intervalId);
    }
  }

  function clearTimers(instance) {
    var host = instance._host;
    for (var i = 0; i < instance._timers.length; i++) {
      host.cancelTimer(instance._timers[i]);
    }
    instance._timers = [];
    instance._pendingTimers = [];
  }

  function deepCopy(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      var arr = [];
      for (var i = 0; i < obj.length; i++) arr.push(deepCopy(obj[i]));
      return arr;
    }
    var copy = {};
    for (var key in obj) {
      if (obj.hasOwnProperty(key) && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') copy[key] = deepCopy(obj[key]);
    }
    return copy;
  }

  var defaultHost = {
    now: function () { return Date.now(); },
    scheduleAfter: function (ms, callback) { return setTimeout(callback, ms); },
    scheduleEvery: function (ms, callback) { return setInterval(callback, ms); },
    cancelTimer: function (id) { clearTimeout(id); clearInterval(id); },
    emit: function () {},
    persist: null,
    log: function () {},
    capabilities: []
  };


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Public API                                                             ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function watch(instance, callback) {
    if (!instance._watchers) instance._watchers = [];
    instance._watchers.push(callback);
  }

  function unwatch(instance, callback) {
    if (callback) {
      instance._watchers = (instance._watchers || []).filter(function (w) { return w !== callback; });
    } else {
      instance._watchers = [];
    }
  }

  function _notifyWatchers(instance, changedKeys, oldCtx) {
    if (!instance._watchers || instance._watchers.length === 0) return;
    for (var i = 0; i < changedKeys.length; i++) {
      var key = changedKeys[i];
      var oldVal = oldCtx[key];
      var newVal = instance.context[key];
      for (var j = 0; j < instance._watchers.length; j++) {
        instance._watchers[j](key, oldVal, newVal, instance.state);
      }
    }
  }

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Pipeline execution                                                     ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Advance a machine from its initial state to a final state (or until
  // blocked). This is the server-side pipeline pattern extracted from
  // application code: compile, create instance, loop sendEvent + dispatch
  // effects, stop at final/route/block.
  //
  // The machine routes itself. The executor is domain-agnostic.
  //   - effects:        { typeName: function(input, context) }
  //   - eventSelector:  function(events, context, state) → eventName
  //   - format:         optional markup string (SCXML/HTML) being processed
  //   - formatUpdater:  function(format, newState, newContext) → updatedFormat

  function executePipeline(definition, options) {
    options = options || {};
    var maxSteps = options.maxSteps || 10;
    var effectAdapters = options.effects || {};
    var eventSelector = options.eventSelector || function (events) { return events[0]; };
    var formatUpdater = options.formatUpdater || null;
    var format = options.format || null;
    var effectLog = [];

    var host = {
      now: function () { return Date.now(); },
      scheduleAfter: function (ms, cb) { return setTimeout(cb, ms); },
      scheduleEvery: function (ms, cb) { return setInterval(cb, ms); },
      cancelTimer: function (id) { clearTimeout(id); clearInterval(id); },
      emit: function () {},
      persist: null,
      log: function () {},
      capabilities: options.capabilities || Object.keys(effectAdapters)
    };

    var inst = createInstance(definition, { host: host, context: options.context });

    // Initial state may require routing (mn-where on initial state)
    if (inst.route) {
      clearTimers(inst);
      return {
        instance: inst, format: format, history: inst.history,
        effects: effectLog, route: inst.route, blocked: false
      };
    }

    var step = 0;

    try {

    while (step < maxSteps) {
      step++;

      var tree = definition._stateTree;
      var currentSpec = tree[inst.state] ? tree[inst.state].spec : null;
      if (!currentSpec || currentSpec.final) break;

      // Collect events from current state AND all ancestor states (hierarchy
      // means child inherits parent events). Skip internal events. Child takes
      // priority over parent — duplicates from ancestors are ignored.
      // Sorted alphabetically for deterministic execution order.
      var seenEvents = {};
      var events = [];
      var walkPath = inst.state;
      while (walkPath && tree[walkPath]) {
        var walkSpec = tree[walkPath].spec;
        if (walkSpec.on) {
          for (var ev in walkSpec.on) {
            if (!seenEvents[ev] && ev !== '.' && ev !== '__timeout' && ev !== '__auto') {
              seenEvents[ev] = true;
              events.push(ev);
            }
          }
        }
        walkPath = tree[walkPath].parent;
      }
      events.sort();
      if (events.length === 0) break;

      var eventToSend = eventSelector(events, inst.context, inst.state);
      if (!eventToSend) break;

      var result = sendEvent(inst, eventToSend);

      // Route signal — transition needs capabilities this host lacks
      if (result.route) {
        if (formatUpdater && format) format = formatUpdater(format, inst.state, inst.context);
        return {
          instance: inst, format: format, history: inst.history,
          effects: effectLog, route: result.route, blocked: false
        };
      }

      // Targetless transition — action ran, context mutated, continue pipeline
      if (result.targetless) {
        if (result.effects && result.effects.length > 0) effectLog = effectLog.concat(result.effects);
        continue;
      }

      // Guard blocked — try remaining events before giving up
      if (!result.transitioned) {
        var advanced = false;
        for (var ri = 0; ri < events.length; ri++) {
          if (events[ri] === eventToSend) continue;
          result = sendEvent(inst, events[ri]);
          if (result.route) {
            if (formatUpdater && format) format = formatUpdater(format, inst.state, inst.context);
            return {
              instance: inst, format: format, history: inst.history,
              effects: effectLog, route: result.route, blocked: false
            };
          }
          if (result.transitioned || result.targetless) { advanced = true; break; }
        }
        if (!advanced) {
          return {
            instance: inst, format: format, history: inst.history,
            effects: effectLog, blocked: true, reason: 'no matching transition'
          };
        }
      }

      // Dispatch effects through adapters
      if (result.effects) {
        for (var fi = 0; fi < result.effects.length; fi++) {
          var effect = result.effects[fi];
          var adapter = effectAdapters[effect.type];
          if (adapter) {
            adapter(effect.input, inst.context);
            effectLog.push({ type: effect.type, input: effect.input, service: 'host' });
          } else {
            effectLog.push({ type: effect.type, input: effect.input, service: 'no-adapter' });
          }
        }
      }

      if (formatUpdater && format) format = formatUpdater(format, inst.state, inst.context);
    }

    var inFinalState = definition._stateTree[inst.state] && definition._stateTree[inst.state].spec.final;
    var exhausted = step >= maxSteps && !inFinalState;
    return {
      instance: inst, format: format, history: inst.history,
      effects: effectLog, blocked: exhausted,
      reason: exhausted ? 'maxSteps exceeded' : null
    };

    } finally { clearTimers(inst); }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Async pipeline — awaits effect adapters                                ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Same structure as executePipeline but awaits each effect adapter's return
  // value. The result is injected back into context via the `bind` field on
  // invoke!. on-success / on-error events are sent after each effect resolves.
  //
  // Usage:
  //   var result = await machine.executePipelineAsync(def, {
  //     effects: { solver: async function (input) { return await solve(input); } },
  //     maxSteps: 10
  //   });

  async function executePipelineAsync(definition, options) {
    options = options || {};
    var maxSteps = options.maxSteps || 10;
    var effectAdapters = options.effects || {};
    var eventSelector = options.eventSelector || function (events) { return events[0]; };
    var formatUpdater = options.formatUpdater || null;
    var format = options.format || null;
    var effectTimeout = options.effectTimeout || 0;
    var effectLog = [];

    var host = {
      now: function () { return Date.now(); },
      scheduleAfter: function (ms, cb) { return setTimeout(cb, ms); },
      scheduleEvery: function (ms, cb) { return setInterval(cb, ms); },
      cancelTimer: function (id) { clearTimeout(id); clearInterval(id); },
      emit: function () {},
      persist: null,
      log: function () {},
      capabilities: options.capabilities || Object.keys(effectAdapters)
    };

    var inst = createInstance(definition, { host: host, context: options.context });

    if (inst.route) {
      clearTimers(inst);
      return {
        instance: inst, format: format, history: inst.history,
        effects: effectLog, route: inst.route, blocked: false
      };
    }

    var step = 0;

    try {

    while (step < maxSteps) {
      step++;

      var tree = definition._stateTree;
      var currentSpec = tree[inst.state] ? tree[inst.state].spec : null;
      if (!currentSpec || currentSpec.final) break;

      var seenEvents = {};
      var events = [];
      var walkPath = inst.state;
      while (walkPath && tree[walkPath]) {
        var walkSpec = tree[walkPath].spec;
        if (walkSpec.on) {
          for (var ev in walkSpec.on) {
            if (!seenEvents[ev] && ev !== '.' && ev !== '__timeout' && ev !== '__auto') {
              seenEvents[ev] = true;
              events.push(ev);
            }
          }
        }
        walkPath = tree[walkPath].parent;
      }
      events.sort();
      if (events.length === 0) break;

      var eventToSend = eventSelector(events, inst.context, inst.state);
      if (!eventToSend) break;

      var result = sendEvent(inst, eventToSend);

      if (result.route) {
        if (formatUpdater && format) format = formatUpdater(format, inst.state, inst.context);
        return {
          instance: inst, format: format, history: inst.history,
          effects: effectLog, route: result.route, blocked: false
        };
      }

      if (result.targetless) {
        if (result.effects && result.effects.length > 0) {
          await _dispatchEffectsAsync(result.effects, effectAdapters, inst, effectLog, 0, effectTimeout);
        }
        continue;
      }

      if (!result.transitioned) {
        var advanced = false;
        for (var ri = 0; ri < events.length; ri++) {
          if (events[ri] === eventToSend) continue;
          result = sendEvent(inst, events[ri]);
          if (result.route) {
            if (formatUpdater && format) format = formatUpdater(format, inst.state, inst.context);
            return {
              instance: inst, format: format, history: inst.history,
              effects: effectLog, route: result.route, blocked: false
            };
          }
          if (result.transitioned || result.targetless) { advanced = true; break; }
        }
        if (!advanced) {
          return {
            instance: inst, format: format, history: inst.history,
            effects: effectLog, blocked: true, reason: 'no matching transition'
          };
        }
      }

      // Await each effect adapter — inject results into context via bind
      if (result.effects) {
        await _dispatchEffectsAsync(result.effects, effectAdapters, inst, effectLog, 0, effectTimeout);
      }

      if (formatUpdater && format) format = formatUpdater(format, inst.state, inst.context);
    }

    var inFinalState = definition._stateTree[inst.state] && definition._stateTree[inst.state].spec.final;
    var exhausted = step >= maxSteps && !inFinalState;
    return {
      instance: inst, format: format, history: inst.history,
      effects: effectLog, blocked: exhausted,
      reason: exhausted ? 'maxSteps exceeded' : null
    };

    } finally { clearTimers(inst); }
  }

  async function _dispatchEffectsAsync(effects, adapters, inst, effectLog, depth, timeout) {
    if (!depth) depth = 0;
    if (depth > 8) return; // prevent infinite effect chains
    for (var i = 0; i < effects.length; i++) {
      var effect = effects[i];
      var adapter = adapters[effect.type];
      if (!adapter) {
        effectLog.push({ type: effect.type, input: effect.input, service: 'no-adapter' });
        continue;
      }
      try {
        var adapterPromise = adapter(effect.input, deepCopy(inst.context));
        // Wrap with timeout if configured
        if (timeout > 0) {
          adapterPromise = Promise.race([
            adapterPromise,
            new Promise(function (_, reject) {
              setTimeout(function () { reject(new Error('effect adapter "' + effect.type + '" timed out after ' + timeout + 'ms')); }, timeout);
            })
          ]);
        }
        var value = await adapterPromise;
        if (effect.bind) inst.context[effect.bind] = value;
        effectLog.push({ type: effect.type, input: effect.input, service: 'host' });
        if (effect['on-success']) {
          var successResult = sendEvent(inst, effect['on-success'], value);
          if (successResult.effects && successResult.effects.length > 0) {
            await _dispatchEffectsAsync(successResult.effects, adapters, inst, effectLog, depth + 1, timeout);
          }
        }
      } catch (err) {
        effectLog.push({ type: effect.type, input: effect.input, service: 'error', error: String(err) });
        if (effect['on-error']) {
          var errorResult = sendEvent(inst, effect['on-error'], { error: err && err.message ? err.message : String(err) });
          if (errorResult.effects && errorResult.effects.length > 0) {
            await _dispatchEffectsAsync(errorResult.effects, adapters, inst, effectLog, depth + 1, timeout);
          }
        }
      }
    }
  }


  return {
    createDefinition: createDefinition,
    createInstance: createInstance,
    sendEvent: sendEvent,
    inspect: inspect,
    snapshot: snapshot,
    restore: restore,
    validate: validate,
    watch: watch,
    unwatch: unwatch,
    executePipeline: executePipeline,
    executePipelineAsync: executePipelineAsync,
    version: '0.5.0'
  };
});
