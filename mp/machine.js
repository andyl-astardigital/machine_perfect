/**
 * machine_perfect — canonical machine execution.
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
    // Check top-level
    if (stateTree[target]) return target;
    return null;
  }

  function _descendToAtomic(statePath, stateTree) {
    var spec = stateTree[statePath].spec;
    while (spec.states) {
      var childName = spec.initial || Object.keys(spec.states)[0];
      statePath = statePath + '.' + childName;
      spec = stateTree[statePath].spec;
    }
    return statePath;
  }

  function _getAncestors(statePath, stateTree) {
    var ancestors = [];
    var path = statePath;
    while (path) {
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

  function _validateTransitions(states, parentPath, allNames, stateTree, defId) {
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
                throw new Error('[mp] transition target "' + target + '" does not exist in "' + defId + '" (from state "' + fullPath + '" on event "' + eventName + '")');
              }
              if (resolved === fullPath) {
                console.warn('[mp] self-transition in "' + defId + '": state "' + fullPath + '" targets itself on event "' + eventName + '". Consider decomposing into substates.');
              }
            }
          }
          states[stateName].on[eventName] = transitions;
        }
      }
      // Recurse into compound states
      if (state.states) {
        _validateTransitions(state.states, fullPath, allNames, stateTree, defId);
      }
    }
  }

  function createDefinition(spec) {
    if (!spec || !spec.id) throw new Error('[mp] definition requires an id');
    if (!spec.states || Object.keys(spec.states).length === 0) throw new Error('[mp] definition "' + spec.id + '" has no states');

    var stateNames = Object.keys(spec.states);
    var initial = spec.initial || stateNames[0];

    if (stateNames.indexOf(initial) === -1) {
      throw new Error('[mp] initial state "' + initial + '" does not exist in "' + spec.id + '"');
    }

    // Build state tree (recursive, handles compound states)
    var stateTree = {};
    _buildStateTree(spec.states, null, 0, stateTree);

    // All fully-qualified state names for target validation
    var allStateNames = Object.keys(stateTree);

    // Validate transitions recursively
    _validateTransitions(spec.states, null, allStateNames, stateTree, spec.id);

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
      states: spec.states,
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
      for (var key in options.context) {
        if (options.context.hasOwnProperty(key)) context[key] = options.context[key];
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
      _mpDirty: null
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

    // Check mp-where on initial atomic state
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
      console.warn('[mp] sendEvent reentrancy detected (event: ' + eventName + '). Queued events are not supported.');
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

    // ── mp-where: distributed transition routing ──
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
      instance._mpDirty = {};
      var targetlessEffects = [];
      if (taken.action) {
        var targetlessResult = engine.exec(taken.action, instance.context, fromState, null, null, instance);
        if (targetlessResult && targetlessResult.effects) targetlessEffects = targetlessResult.effects;
      }
      var dirty = instance._mpDirty;
      instance._mpDirty = null;
      var result = createResult(instance, fromState, fromState, eventName, false, null);
      result.targetless = true;
      result.changed = Object.keys(dirty);
      result.effects = targetlessEffects;
      result.emits = taken.emit ? [taken.emit] : [];
      instance.history.push({ timestamp: instance._host.now(), event: eventName, data: eventData || null, from: fromState, to: fromState, changed: result.changed });
      if (instance._host.persist) instance._host.persist(snapshot(instance));
      return result;
    }

    // ── Resolve target to fully-qualified path ──
    var toState = _resolveTarget(taken.target, transitionSource, tree);
    // If target is compound, descend to its initial atomic child
    var atomicTarget = _descendToAtomic(toState, tree);

    // Track dirty keys
    instance._mpDirty = {};
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
        engine.exec(exitSpec.exit, instance.context, exitPath[ei], null, null, instance);
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
    var autoLimit = 100;
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
        if (aeSpec.exit) engine.exec(aeSpec.exit, instance.context, autoExit[aei], null, null, instance);
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
    if (autoLimit <= 0) console.warn('[mp] eventless transition loop limit reached in "' + definition.id + '" at state "' + instance.state + '"');

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
    var dirty = instance._mpDirty;
    instance._mpDirty = null;

    var result = createResult(instance, fromState, toState, eventName, true, null);
    result.changed = Object.keys(dirty);
    result.emits = emits;
    result.effects = effects;

    // ── Record history ──
    var historyEntry = {
      timestamp: instance._host.now(),
      event: eventName,
      data: eventData || null,
      from: fromState,
      to: toState,
      changed: result.changed
    };
    instance.history.push(historyEntry);

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
      history: instance.history,
      // Pending timers — stored so they survive persistence/restart.
      // The host re-establishes them on restore.
      pendingTimers: instance._pendingTimers || null
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
      _mpDirty: null
    };

    // Re-establish durable timers from snapshot, adjusting for elapsed time
    if (snap.pendingTimers && snap.pendingTimers.length > 0) {
      var now = host.now();
      for (var i = 0; i < snap.pendingTimers.length; i++) {
        var timer = snap.pendingTimers[i];
        if (timer.type === 'after') {
          var elapsed = now - timer.createdAt;
          var remaining = Math.max(0, timer.ms - elapsed);
          var afterMeta = { type: 'after', ms: timer.ms, target: timer.target, createdAt: timer.createdAt };
          instance._pendingTimers.push(afterMeta);
          (function (meta) {
            var id = host.scheduleAfter(remaining, function () {
              instance._pendingTimers = instance._pendingTimers.filter(function (t) { return t !== meta; });
              sendEvent(instance, '__timeout', null);
            });
            instance._timers.push(id);
          })(afterMeta);
        } else if (timer.type === 'every') {
          var everyMeta = { type: 'every', ms: timer.ms, action: timer.action, createdAt: timer.createdAt };
          instance._pendingTimers.push(everyMeta);
          (function (action) {
            var id = host.scheduleEvery(timer.ms, function () {
              if (action) {
                engine.exec(action, instance.context, instance.state, null, null, instance);
                if (host.persist) host.persist(snapshot(instance));
              }
            });
            instance._timers.push(id);
          })(timer.action);
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

      // Timer validation
      if (state.after && state.after.target) {
        var afterResolved = _resolveTarget(state.after.target, stateName, tree);
        if (!afterResolved) {
          issues.push({ type: 'invalid-target', state: stateName, message: 'mp-after target "' + state.after.target + '" does not exist in state "' + stateName + '"' });
        }
      }
      if (state.after && (typeof state.after.ms !== 'number' || state.after.ms <= 0)) {
        issues.push({ type: 'invalid-timer', state: stateName, message: 'mp-after ms must be a positive number in state "' + stateName + '", got: ' + state.after.ms });
      }
      if (state.every) {
        if (typeof state.every.ms !== 'number' || state.every.ms <= 0) {
          issues.push({ type: 'invalid-timer', state: stateName, message: 'mp-every ms must be a positive number in state "' + stateName + '", got: ' + state.every.ms });
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
        for (var name in walkSpec.on) { if (!seen[name]) { enabled.push(name); seen[name] = true; } }
      }
      walkPath = tree[walkPath].parent;
    }
    return {
      instanceId: instance.id,
      event: eventName,
      from: fromState,
      to: toState,
      transitioned: transitioned,
      reason: reason,
      changed: [],
      emits: [],
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
      if (obj.hasOwnProperty(key)) copy[key] = deepCopy(obj[key]);
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

  function unwatch(instance) {
    instance._watchers = [];
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

    // Initial state may require routing (mp-where on initial state)
    if (inst.route) {
      return {
        instance: inst, format: format, history: inst.history,
        effects: effectLog, route: inst.route, blocked: false
      };
    }

    var step = 0;

    while (step < maxSteps) {
      step++;

      var tree = definition._stateTree;
      var currentSpec = tree[inst.state] ? tree[inst.state].spec : null;
      if (!currentSpec || currentSpec.final) break;

      // Collect events from current state (skip internal events).
      // Sorted alphabetically for deterministic execution order.
      // When multiple events are available, the default eventSelector picks
      // the first (alphabetically). If that event's guard blocks, the pipeline
      // tries remaining events in order. Override eventSelector to change this.
      var allEvents = currentSpec.on ? Object.keys(currentSpec.on) : [];
      var events = [];
      for (var ei = 0; ei < allEvents.length; ei++) {
        if (allEvents[ei] !== '.' && allEvents[ei] !== '__timeout' && allEvents[ei] !== '__auto') {
          events.push(allEvents[ei]);
        }
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
          if (result.transitioned) { advanced = true; break; }
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

    return {
      instance: inst, format: format, history: inst.history,
      effects: effectLog, blocked: step >= maxSteps,
      reason: step >= maxSteps ? 'maxSteps exceeded' : null
    };
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
    version: '0.5.0'
  };
});
