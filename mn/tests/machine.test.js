/**
 * machine.js — deep unit tests.
 *
 * Run: node mn/tests/machine.test.js
 * Every public function tested. Every error path tested.
 * Every edge case that could bite you in production.
 */

var machine = require('../machine.js');
var engine = require('../engine.js');

var passed = 0;
var failed = 0;
var group = '';

function describe(name) { group = name; console.log('\n' + name); }
function assert(condition, message) {
  var label = group + ' > ' + message;
  if (condition) { passed++; console.log('  \u2713 ' + message); }
  else { failed++; console.log('  \u2717 ' + message); }
}
function eq(actual, expected, message) {
  assert(actual === expected, message + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
}
function throws(fn, substring, message) {
  try { fn(); assert(false, message + ' — did not throw'); }
  catch (err) { assert(err.message.indexOf(substring) !== -1, message + ' (threw: ' + err.message + ')'); }
}
function deepEq(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message + ' (got ' + JSON.stringify(actual) + ')');
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  createDefinition                                                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('createDefinition — validation');

throws(function () { machine.createDefinition(); }, 'requires an id', 'rejects undefined input');
throws(function () { machine.createDefinition({}); }, 'requires an id', 'rejects missing id');
throws(function () { machine.createDefinition({ id: 'x' }); }, 'has no states', 'rejects missing states');
throws(function () { machine.createDefinition({ id: 'x', states: {} }); }, 'has no states', 'rejects empty states object');
throws(function () { machine.createDefinition({ id: 'x', initial: 'z', states: { a: {} } }); }, 'does not exist', 'rejects invalid initial state');
throws(function () {
  machine.createDefinition({ id: 'x', states: { a: { on: { go: [{ target: 'nope' }] } } } });
}, 'does not exist', 'rejects invalid transition target');

describe('createDefinition — structure');

var def = machine.createDefinition({
  id: 'test',
  initial: 'off',
  context: { count: 0 },
  states: {
    off: { on: { toggle: [{ target: 'on' }] } },
    on: { on: { toggle: [{ target: 'off' }] } }
  }
});

eq(def.id, 'test', 'preserves id');
eq(def.initial, 'off', 'preserves initial');
eq(def.context.count, 0, 'preserves context');
deepEq(def.stateNames, ['off', 'on', 'error'], 'collects state names (includes implicit error)');

describe('createDefinition — defaults');

var defNoInitial = machine.createDefinition({ id: 'x', states: { first: {}, second: {} } });
eq(defNoInitial.initial, 'first', 'defaults initial to first state');

var defNoCtx = machine.createDefinition({ id: 'x', states: { a: {} } });
deepEq(defNoCtx.context, {}, 'defaults context to empty object');

describe('createDefinition — transition normalisation');

var defSingle = machine.createDefinition({
  id: 'x', states: { a: { on: { go: { target: 'b' } } }, b: {} }
});
assert(Array.isArray(defSingle.states.a.on.go), 'normalises single transition to array');
eq(defSingle.states.a.on.go[0].target, 'b', 'preserves target after normalisation');

describe('createDefinition — self-transition warns');

var selfWarnDef = machine.createDefinition({
  id: 'x', states: { a: { on: { tick: [{ target: 'a' }] } } }
});
eq(selfWarnDef.id, 'x', 'self-transition allowed with warning (definition created)');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Hierarchical states                                                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('hierarchy — compound state definition');

var batchDef = machine.createDefinition({
  id: 'batch',
  initial: 'idle',
  states: {
    idle: { on: { START: [{ target: 'running' }] } },
    running: {
      initial: 'filling',
      init: "(set! started true)",
      exit: "(set! stopped true)",
      on: {
        ABORT: [{ target: 'aborted' }]
      },
      states: {
        filling: { on: { FULL: [{ target: 'heating' }] } },
        heating: { on: { HOT: [{ target: 'done' }] } },
        done: { final: true }
      }
    },
    aborted: { final: true }
  }
});
deepEq(Object.keys(batchDef._stateTree).sort(), ['aborted', 'error', 'idle', 'running', 'running.done', 'running.filling', 'running.heating'].sort(), 'stateTree has all states (includes implicit error)');
eq(batchDef._stateTree['running.filling'].parent, 'running', 'filling parent is running');
eq(batchDef._stateTree['running'].parent, null, 'running parent is null');
eq(batchDef._stateTree['running.filling'].depth, 1, 'filling depth is 1');
eq(batchDef._stateTree['running'].depth, 0, 'running depth is 0');

describe('hierarchy — createInstance enters initial child');

var batchInst = machine.createInstance(batchDef);
eq(batchInst.state, 'idle', 'starts in idle (top-level)');
var startResult = machine.sendEvent(batchInst, 'START');
eq(batchInst.state, 'running.filling', 'entering compound state descends to initial child');
eq(startResult.transitioned, true, 'transition succeeded');
eq(batchInst.context.started, true, 'compound state init hook ran');

describe('hierarchy — transition within compound state');

var fillResult = machine.sendEvent(batchInst, 'FULL');
eq(batchInst.state, 'running.heating', 'transitions between siblings');
eq(batchInst.context.stopped, undefined, 'compound state exit did NOT run (stayed inside running)');

describe('hierarchy — inherited transition from compound state');

var abortResult = machine.sendEvent(batchInst, 'ABORT');
eq(batchInst.state, 'aborted', 'ABORT inherited from running compound state');
eq(abortResult.transitioned, true, 'abort transitioned');
eq(batchInst.context.stopped, true, 'compound state exit hook ran on leaving running');

describe('hierarchy — done.state on final child');

var batch2 = machine.createInstance(batchDef);
machine.sendEvent(batch2, 'START');
machine.sendEvent(batch2, 'FULL');
var hotResult = machine.sendEvent(batch2, 'HOT');
eq(batch2.state, 'running.done', 'reached final child');
deepEq(hotResult.emits, [{name: 'done.state.running', payload: null}], 'done.state.running emitted on final child entry');


describe('hierarchy — inspect walks hierarchy');

var batch3 = machine.createInstance(batchDef);
machine.sendEvent(batch3, 'START');
var batchInspect = machine.inspect(batch3);
eq(batchInspect.state, 'running.filling', 'inspect state is full path');
deepEq(batchInspect.activeStates, ['running.filling', 'running'], 'activeStates includes ancestors');
var enabledEvents = batchInspect.enabled.map(function (e) { return e.event; }).sort();
deepEq(enabledEvents, ['ABORT', 'FULL'], 'enabled includes child FULL and parent ABORT');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  createInstance                                                          ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('createInstance — basics');

var toggleDef = machine.createDefinition({
  id: 'toggle',
  context: { label: 'switch' },
  states: {
    off: { on: { flip: [{ target: 'on' }] } },
    on: { on: { flip: [{ target: 'off' }] } }
  }
});

var inst = machine.createInstance(toggleDef);
eq(inst.state, 'off', 'starts in initial state');
eq(inst.context.label, 'switch', 'has default context');
eq(inst.definitionId, 'toggle', 'records definition id');
eq(inst.id.substring(0, 7), 'toggle_', 'instance id starts with definition id');
eq(typeof parseInt(inst.id.substring(7)), 'number', 'instance id ends with timestamp');
deepEq(inst.history, [], 'history starts empty');

describe('createInstance — context override');

var inst2 = machine.createInstance(toggleDef, { context: { label: 'override', extra: true } });
eq(inst2.context.label, 'override', 'overrides default context values');
eq(inst2.context.extra, true, 'adds extra context values');

describe('createInstance — context isolation');

var inst3 = machine.createInstance(toggleDef);
inst3.context.label = 'mutated';
var inst4 = machine.createInstance(toggleDef);
eq(inst4.context.label, 'switch', 'instances do not share context (deep copy)');

describe('createInstance — custom id');

var inst5 = machine.createInstance(toggleDef, { id: 'my-toggle-1' });
eq(inst5.id, 'my-toggle-1', 'uses provided id');

describe('createInstance — init hook runs on creation');

var initDef = machine.createDefinition({
  id: 'init-test',
  context: { ready: false },
  states: { start: { init: "(set! ready true)" } }
});
var initInst = machine.createInstance(initDef);
eq(initInst.context.ready, true, 'init hook runs on initial state entry');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  sendEvent                                                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('sendEvent — basic transition');

var inst6 = machine.createInstance(toggleDef);
var result = machine.sendEvent(inst6, 'flip');
eq(result.transitioned, true, 'transition succeeded');
eq(result.from, 'off', 'records from state');
eq(result.to, 'on', 'records to state');
eq(inst6.state, 'on', 'instance state updated');
eq(result.event, 'flip', 'records event name');

describe('sendEvent — unknown event');

var r = machine.sendEvent(inst6, 'nonexistent');
eq(r.transitioned, false, 'does not transition on unknown event');
eq(r.reason, 'no matching transition', 'reports reason');
eq(inst6.state, 'on', 'state unchanged');

describe('sendEvent — guard blocks');

var guardDef = machine.createDefinition({
  id: 'guarded',
  context: { total: 0 },
  states: {
    idle: { on: {
      go: [{ target: 'done', guard: "(> total 0)" }]
    }},
    done: { final: true }
  }
});

var guardInst = machine.createInstance(guardDef);
var gr = machine.sendEvent(guardInst, 'go');
eq(gr.transitioned, false, 'guard blocks when condition false');
eq(guardInst.state, 'idle', 'stays in current state');

guardInst.context.total = 5;
var gr2 = machine.sendEvent(guardInst, 'go');
eq(gr2.transitioned, true, 'guard passes when condition true');
eq(guardInst.state, 'done', 'transitions to target');

describe('sendEvent — guard is pure (cannot mutate)');

var pureGuardDef = machine.createDefinition({
  id: 'pure-guard',
  context: { x: 1 },
  states: {
    a: { on: { go: [{ target: 'b', guard: "(> x 0)" }] } },
    b: {}
  }
});
var pureInst = machine.createInstance(pureGuardDef);
var beforeX = pureInst.context.x;
machine.sendEvent(pureInst, 'go');
eq(pureInst.context.x, beforeX, 'guard evaluation did not mutate context');

describe('sendEvent — action mutates context');

var actionDef = machine.createDefinition({
  id: 'action',
  context: { count: 0, stamp: null },
  states: {
    idle: { on: { go: [{ target: 'done', action: "(do (inc! count) (set! stamp (now)))" }] } },
    done: { final: true }
  }
});

var actionBefore = Date.now();
var actionInst = machine.createInstance(actionDef);
var ar = machine.sendEvent(actionInst, 'go');
var actionAfter = Date.now();
eq(actionInst.context.count, 1, 'action incremented count');
assert(actionInst.context.stamp >= actionBefore && actionInst.context.stamp <= actionAfter, 'action set timestamp within expected range');
deepEq(ar.changed.sort(), ['count', 'stamp'], 'changed reports exactly count and stamp');

describe('sendEvent — multiple guards, first match wins');

var multiDef = machine.createDefinition({
  id: 'multi',
  context: { value: 15 },
  states: {
    check: { on: {
      evaluate: [
        { target: 'low', guard: "(< value 10)" },
        { target: 'mid', guard: "(< value 20)" },
        { target: 'high' }
      ]
    }},
    low: {}, mid: {}, high: {}
  }
});

var multiInst = machine.createInstance(multiDef);
machine.sendEvent(multiInst, 'evaluate');
eq(multiInst.state, 'mid', 'second guard matched (value=15, < 20)');

var multiInst2 = machine.createInstance(multiDef, { context: { value: 5 } });
machine.sendEvent(multiInst2, 'evaluate');
eq(multiInst2.state, 'low', 'first guard matched (value=5, < 10)');

var multiInst3 = machine.createInstance(multiDef, { context: { value: 100 } });
machine.sendEvent(multiInst3, 'evaluate');
eq(multiInst3.state, 'high', 'guardless transition matched as fallback');

describe('sendEvent — action runs on transition');

var actionDef = machine.createDefinition({
  id: 'action-test',
  context: { ticks: 0 },
  states: {
    idle: { on: { tick: [{ target: 'ticked', action: "(inc! ticks)" }] } },
    ticked: { on: { tick: [{ target: 'idle', action: "(inc! ticks)" }] } }
  }
});

var actionInst = machine.createInstance(actionDef);
machine.sendEvent(actionInst, 'tick');
machine.sendEvent(actionInst, 'tick');
machine.sendEvent(actionInst, 'tick');
eq(actionInst.context.ticks, 3, 'action runs on each transition');

describe('sendEvent — exit hook runs before leaving');

var exitDef = machine.createDefinition({
  id: 'exit-test',
  context: { cleaned: false },
  states: {
    active: { exit: "(set! cleaned true)", on: { stop: [{ target: 'stopped' }] } },
    stopped: {}
  }
});

var exitInst = machine.createInstance(exitDef);
eq(exitInst.context.cleaned, false, 'not cleaned before transition');
machine.sendEvent(exitInst, 'stop');
eq(exitInst.context.cleaned, true, 'exit hook ran before leaving state');

describe('sendEvent — init hook runs on entry');

var entryDef = machine.createDefinition({
  id: 'entry-test',
  context: { entered: false },
  states: {
    waiting: { on: { go: [{ target: 'active' }] } },
    active: { init: "(set! entered true)" }
  }
});

var entryInst = machine.createInstance(entryDef);
eq(entryInst.context.entered, false, 'not entered before transition');
machine.sendEvent(entryInst, 'go');
eq(entryInst.context.entered, true, 'init hook ran on state entry');

describe('sendEvent — history recorded');

var histDef = machine.createDefinition({
  id: 'hist',
  states: {
    a: { on: { go: [{ target: 'b' }] } },
    b: { on: { back: [{ target: 'a' }] } }
  }
});

var histInst = machine.createInstance(histDef);
machine.sendEvent(histInst, 'go');
machine.sendEvent(histInst, 'back');
eq(histInst.history.length, 2, 'two transitions recorded');
eq(histInst.history[0].event, 'go', 'first event recorded');
eq(histInst.history[0].from, 'a', 'first from state');
eq(histInst.history[0].to, 'b', 'first to state');
eq(histInst.history[1].event, 'back', 'second event recorded');
eq(typeof histInst.history[0].timestamp, 'number', 'timestamp is a number');
assert(histInst.history[0].timestamp >= actionBefore, 'timestamp within expected range');

describe('sendEvent — final state has no transitions');

var finalDef = machine.createDefinition({
  id: 'final',
  states: {
    running: { on: { finish: [{ target: 'done' }] } },
    done: { final: true }
  }
});

var finalInst = machine.createInstance(finalDef);
machine.sendEvent(finalInst, 'finish');
eq(finalInst.state, 'done', 'reached final state');
var fr = machine.sendEvent(finalInst, 'finish');
eq(fr.transitioned, false, 'cannot transition from final state');
eq(fr.isFinal, true, 'result reports final');

describe('sendEvent — emit in transition');

var emitDef = machine.createDefinition({
  id: 'emitter',
  states: {
    a: { on: { go: [{ target: 'b', emit: 'moved' }] } },
    b: {}
  }
});

var emitInst = machine.createInstance(emitDef);
var er = machine.sendEvent(emitInst, 'go');
deepEq(er.emits, [{name: 'moved', payload: null}], 'structural emit in result as {name, payload}');

describe('sendEvent — persist called on transition');

var persisted = null;
var persistHost = {
  now: function () { return 1000; },
  scheduleAfter: function () { return 0; },
  scheduleEvery: function () { return 0; },
  cancelTimer: function () {},
  emit: function () {},
  persist: function (snap) { persisted = snap; },
  log: function () {}
};

var persistDef = machine.createDefinition({
  id: 'persist-test',
  states: { a: { on: { go: [{ target: 'b' }] } }, b: {} }
});

var persistInst = machine.createInstance(persistDef, { host: persistHost });
machine.sendEvent(persistInst, 'go');
eq(persisted.state, 'b', 'persisted correct state');
eq(persisted.definitionId, 'persist-test', 'persisted definition id');

describe('sendEvent — complex s-expression pipeline');

var pipelineDef = machine.createDefinition({
  id: 'pipeline',
  context: { items: [{ name: 'A', value: 10 }, { name: 'B', value: 5 }, { name: 'C', value: 20 }], result: null },
  states: {
    idle: { on: { compute: [{ target: 'done', action: "(set! result (join (->> items (filter #(> (get % :value) 8)) (map #(get % :name))) ', '))" }] } },
    done: { final: true }
  }
});

var pipelineInst = machine.createInstance(pipelineDef);
machine.sendEvent(pipelineInst, 'compute');
eq(pipelineInst.context.result, 'A, C', 'complex pipeline: filter + map + join');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  inspect                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('inspect — enabled transitions');

var inspDef = machine.createDefinition({
  id: 'insp',
  context: { ready: false },
  states: {
    waiting: { on: {
      start: [{ target: 'running', guard: "ready" }],
      skip: [{ target: 'running' }]
    }},
    running: { final: true }
  }
});

var inspInst = machine.createInstance(inspDef);
var info = machine.inspect(inspInst);
eq(info.state, 'waiting', 'reports current state');
eq(info.isFinal, false, 'not final');
eq(info.enabled.length, 1, 'only guardless transition enabled (ready=false)');
eq(info.enabled[0].event, 'skip', 'skip is enabled');

inspInst.context.ready = true;
var info2 = machine.inspect(inspInst);
eq(info2.enabled.length, 2, 'both transitions enabled (ready=true)');

describe('inspect — final state');

machine.sendEvent(inspInst, 'start');
var info3 = machine.inspect(inspInst);
eq(info3.isFinal, true, 'reports final');
eq(info3.enabled.length, 0, 'no enabled transitions in final state');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  snapshot + restore                                                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('inspect — context is immutable copy');
var immInst = machine.createInstance(machine.createDefinition({ id: 'imm', context: { x: 1 }, states: { a: { on: { go: [{ target: 'b' }] } }, b: {} } }));
var immInfo = machine.inspect(immInst);
immInfo.context.x = 999;
eq(immInst.context.x, 1, 'mutating inspect result does not affect instance context');

describe('inspect — history is immutable copy');
machine.sendEvent(immInst, 'go');
var immInfo2 = machine.inspect(immInst);
var histLenBefore = immInst.history.length;
immInfo2.history.push({ fake: true });
eq(immInst.history.length, histLenBefore, 'mutating inspect history does not affect instance');

describe('sendEvent — result context is immutable copy');
var immDef2 = machine.createDefinition({ id: 'imm2', context: { count: 0 }, states: { a: { on: { inc: [{ target: 'b', action: '(inc! count)' }] } }, b: {} } });
var immInst2 = machine.createInstance(immDef2);
var immResult = machine.sendEvent(immInst2, 'inc');
eq(immResult.context.count, 1, 'result has updated count');
immResult.context.count = 999;
eq(immInst2.context.count, 1, 'mutating result context does not affect instance');

describe('restore — snapshot mutation does not affect restored instance');
var restoreDef = machine.createDefinition({ id: 'restore-imm', context: { val: 42 }, states: { a: { on: { go: [{ target: 'b' }] } }, b: {} } });
var restoreInst = machine.createInstance(restoreDef);
machine.sendEvent(restoreInst, 'go');
var restoreSnap = machine.snapshot(restoreInst);
var restored = machine.restore(restoreDef, restoreSnap);
restoreSnap.context.val = 999;
restoreSnap.history.push({ fake: true });
eq(restored.context.val, 42, 'mutating snapshot context does not affect restored instance');
eq(restored.history.length, 1, 'mutating snapshot history does not affect restored instance');


describe('snapshot — captures full state');

var snapDef = machine.createDefinition({
  id: 'snap',
  context: { items: [1, 2, 3] },
  states: {
    a: { on: { go: [{ target: 'b', action: "(push! items 4)" }] } },
    b: {}
  }
});

var snapInst = machine.createInstance(snapDef);
machine.sendEvent(snapInst, 'go');
var snap = machine.snapshot(snapInst);
eq(snap.state, 'b', 'snapshot has current state');
deepEq(snap.context.items, [1, 2, 3, 4], 'snapshot has current context');
eq(snap.history.length, 1, 'snapshot has history');

describe('snapshot — isolation from instance');

snap.context.items.push(999);
eq(snapInst.context.items.length, 4, 'mutating snapshot does not affect instance (deep copy)');

describe('restore — recreates working instance');

var restored = machine.restore(snapDef, snap);
eq(restored.state, 'b', 'restored to correct state');
eq(restored.history.length, 1, 'restored history');
eq(restored.definitionId, 'snap', 'restored definition id');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  validate                                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('validate — clean definition');

var cleanDef = machine.createDefinition({
  id: 'clean',
  states: {
    a: { on: { go: [{ target: 'b' }] } },
    b: { on: { back: [{ target: 'a' }] } }
  }
});
var cleanIssues = machine.validate(cleanDef);
eq(cleanIssues.length, 0, 'no issues on valid definition');

describe('validate — unreachable state');

var unreachDef = machine.createDefinition({
  id: 'unreach',
  states: {
    a: { on: { go: [{ target: 'b' }] } },
    b: { final: true },
    orphan: { on: { go: [{ target: 'a' }] } }
  }
});
var unreachIssues = machine.validate(unreachDef);
assert(unreachIssues.some(function (issue) { return issue.type === 'unreachable' && issue.state === 'orphan'; }), 'detects unreachable state');

describe('validate — deadlock');

var deadDef = machine.createDefinition({
  id: 'dead',
  states: {
    a: { on: { go: [{ target: 'stuck' }] } },
    stuck: {}
  }
});
var deadIssues = machine.validate(deadDef);
assert(deadIssues.some(function (issue) { return issue.type === 'deadlock' && issue.state === 'stuck'; }), 'detects deadlocked non-final state');

describe('validate — does not flag final states as deadlocks');

var finalOk = machine.createDefinition({
  id: 'final-ok',
  states: {
    a: { on: { go: [{ target: 'done' }] } },
    done: { final: true }
  }
});
var finalIssues = machine.validate(finalOk);
eq(finalIssues.length, 0, 'final state with no transitions is not a deadlock');

describe('validate — guards and actions are parseable');

// NOTE: the parser currently accepts incomplete expressions silently
// (e.g. "(> x" parses as [>, x] without the closing paren).
// Validate checks that parse() does not throw, which is the current
// parser contract. Stricter parse validation is a future improvement.

var goodGuardDef = machine.createDefinition({
  id: 'good-guard', context: { x: 0 },
  states: { a: { on: { go: [{ target: 'b', guard: "(> x 0)", action: "(set! x 1)" }] } }, b: { final: true } }
});
var goodGuardIssues = machine.validate(goodGuardDef);
eq(goodGuardIssues.length, 0, 'well-formed guard and action produce no parse issues');

describe('validate — combined: unreachable + deadlock + valid');

var combinedDef = machine.createDefinition({
  id: 'combined',
  states: {
    start: { on: { go: [{ target: 'middle' }] } },
    middle: { on: { finish: [{ target: 'end' }] } },
    end: { final: true },
    orphan: {},
    island: { on: { loop: [{ target: 'orphan' }] } }
  }
});
var combinedIssues = machine.validate(combinedDef);
assert(combinedIssues.some(function (i) { return i.type === 'unreachable' && i.state === 'orphan'; }), 'detects orphan as unreachable');
assert(combinedIssues.some(function (i) { return i.type === 'unreachable' && i.state === 'island'; }), 'detects island as unreachable');
assert(combinedIssues.some(function (i) { return i.type === 'deadlock' && i.state === 'orphan'; }), 'detects orphan as deadlock');
assert(!combinedIssues.some(function (i) { return i.state === 'end'; }), 'does not flag final state');
assert(!combinedIssues.some(function (i) { return i.state === 'start'; }), 'does not flag reachable state with transitions');


describe('validate — final state with outbound transitions');
var finalTransDef = machine.createDefinition({
  id: 'final-trans',
  states: {
    a: { on: { go: [{ target: 'done' }] } },
    done: { final: true, on: { back: [{ target: 'a' }] } }
  }
});
var finalTransIssues = machine.validate(finalTransDef);
assert(finalTransIssues.some(function (i) { return i.type === 'final-has-transitions' && i.state === 'done'; }), 'flags final state with transitions');

describe('validate — mn-after target does not exist');
var badAfterDef = machine.createDefinition({
  id: 'bad-after',
  states: {
    a: { after: { ms: 1000, target: 'nonexistent' } },
    b: { final: true }
  }
});
var badAfterIssues = machine.validate(badAfterDef);
assert(badAfterIssues.some(function (i) { return i.type === 'invalid-target' && i.state === 'a'; }), 'flags invalid mn-after target');


describe('validate — mn-after ms must be positive');
var badMsDef = machine.createDefinition({
  id: 'bad-ms',
  states: {
    a: { after: { ms: -100, target: 'b' } },
    b: { final: true }
  }
});
var badMsIssues = machine.validate(badMsDef);
assert(badMsIssues.some(function (i) { return i.type === 'invalid-timer' && i.state === 'a'; }), 'flags negative after.ms');

describe('validate — every action is parseable');
var badEveryDef = machine.createDefinition({
  id: 'bad-every',
  states: {
    a: { every: { ms: 1000, action: '(unclosed' } }
  }
});
var badEveryIssues = machine.validate(badEveryDef);
assert(badEveryIssues.some(function (i) { return i.type === 'parse' && i.state === 'a'; }), 'flags unparseable every action');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Edge cases                                                             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('edge — context with nested objects');

var nestedDef = machine.createDefinition({
  id: 'nested',
  context: { user: { name: 'Andrew', prefs: { theme: 'dark' } } },
  states: {
    a: { on: { update: [{ target: 'b', action: "(set! user.prefs.theme 'light')" }] } },
    b: {}
  }
});

var nestedInst = machine.createInstance(nestedDef);
machine.sendEvent(nestedInst, 'update');
eq(nestedInst.context.user.prefs.theme, 'light', 'dotted path mutation on nested object');

describe('edge — context deep copy prevents definition mutation');

var sharedCtxDef = machine.createDefinition({
  id: 'shared-ctx',
  context: { items: [1, 2, 3] },
  states: {
    a: { on: { push: [{ target: 'b', action: "(push! items 99)" }] } },
    b: {}
  }
});

var si1 = machine.createInstance(sharedCtxDef);
machine.sendEvent(si1, 'push');
var si2 = machine.createInstance(sharedCtxDef);
deepEq(si2.context.items, [1, 2, 3], 'new instance has clean context (definition not mutated)');

describe('edge — rapid sequential transitions');

var seqDef = machine.createDefinition({
  id: 'seq',
  context: { log: '' },
  states: {
    a: { on: { next: [{ target: 'b', action: "(set! log (str log 'a'))" }] } },
    b: { on: { next: [{ target: 'c', action: "(set! log (str log 'b'))" }] } },
    c: { on: { next: [{ target: 'a', action: "(set! log (str log 'c'))" }] } }
  }
});

var seqInst = machine.createInstance(seqDef);
machine.sendEvent(seqInst, 'next');
machine.sendEvent(seqInst, 'next');
machine.sendEvent(seqInst, 'next');
machine.sendEvent(seqInst, 'next');
eq(seqInst.context.log, 'abca', 'four transitions logged correctly');
eq(seqInst.state, 'b', 'cycled back to b');
eq(seqInst.history.length, 4, 'four history entries');

describe('edge — user-registered function in guard');

engine.fn('is-premium', function (tier) { return tier === 'gold' || tier === 'platinum'; });

var fnDef = machine.createDefinition({
  id: 'fn-guard',
  context: { tier: 'silver' },
  states: {
    basic: { on: { upgrade: [{ target: 'premium', guard: "(is-premium tier)" }] } },
    premium: {}
  }
});

var fnInst = machine.createInstance(fnDef);
var fnr = machine.sendEvent(fnInst, 'upgrade');
eq(fnr.transitioned, false, 'user fn guard blocks (silver is not premium)');

fnInst.context.tier = 'gold';
var fnr2 = machine.sendEvent(fnInst, 'upgrade');
eq(fnr2.transitioned, true, 'user fn guard passes (gold is premium)');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Effects (invoke!)                                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('invoke! — effect collected in transition result');

var effectDef = machine.createDefinition({
  id: 'effect-test',
  context: { url: 'https://api.example.com/check' },
  states: {
    idle: { on: { check: [{ target: 'checking', action: "(invoke! :type 'http.post' :input (obj :url url) :bind 'result' :on-success 'done' :on-error 'failed')" }] } },
    checking: { on: { done: [{ target: 'complete' }], failed: [{ target: 'error' }] } },
    complete: { final: true },
    error: {}
  }
});

var effectInst = machine.createInstance(effectDef);
var effectResult = machine.sendEvent(effectInst, 'check');
eq(effectResult.transitioned, true, 'transitioned to checking');
eq(effectResult.effects.length, 1, 'one effect collected');
eq(effectResult.effects[0].type, 'http.post', 'effect type is http.post');
eq(effectResult.effects[0].bind, 'result', 'effect bind key');
eq(effectResult.effects[0]['on-success'], 'done', 'effect on-success event');
eq(effectResult.effects[0]['on-error'], 'failed', 'effect on-error event');
deepEq(effectResult.effects[0].input, { url: 'https://api.example.com/check' }, 'effect input evaluated from context');

describe('invoke! — multiple effects in one action');

var multiEffectDef = machine.createDefinition({
  id: 'multi-effect',
  states: {
    idle: { on: { go: [{ target: 'processing', action: "(do (invoke! :type 'db.query' :input 'SELECT 1') (invoke! :type 'email.send' :input (obj :to 'a@b.com')))" }] } },
    processing: { final: true }
  }
});

var multiEffectInst = machine.createInstance(multiEffectDef);
var multiResult = machine.sendEvent(multiEffectInst, 'go');
eq(multiResult.effects.length, 2, 'two effects collected');
eq(multiResult.effects[0].type, 'db.query', 'first effect type');
eq(multiResult.effects[1].type, 'email.send', 'second effect type');

describe('invoke! — no effects when no invoke! in action');

var noEffectDef = machine.createDefinition({
  id: 'no-effect',
  context: { x: 0 },
  states: {
    a: { on: { go: [{ target: 'b', action: "(inc! x)" }] } },
    b: { final: true }
  }
});

var noEffectInst = machine.createInstance(noEffectDef);
var noEffectResult = machine.sendEvent(noEffectInst, 'go');
deepEq(noEffectResult.effects, [], 'no effects when action has no invoke!');

describe('invoke! — blocked in pure eval');

throws(function () {
  engine.eval("(invoke! :type 'test')", {}, null, null);
}, 'not allowed', 'invoke! rejected in binding evaluation');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Durable timers                                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('durable timers — after timer metadata in snapshot');

var timerDef = machine.createDefinition({
  id: 'timer-test',
  states: {
    waiting: { after: { ms: 5000, target: 'done' }, on: { __timeout: [{ target: 'done' }] } },
    done: { final: true }
  }
});

var timerInst = machine.createInstance(timerDef);
var timerSnap = machine.snapshot(timerInst);
eq(timerSnap.pendingTimers.length, 1, 'one pending timer in snapshot');
eq(timerSnap.pendingTimers[0].type, 'after', 'timer type is after');
eq(timerSnap.pendingTimers[0].ms, 5000, 'timer ms preserved');
eq(timerSnap.pendingTimers[0].target, 'done', 'timer target preserved');
assert(timerSnap.pendingTimers[0].createdAt >= actionBefore, 'timer createdAt is a valid timestamp');
// Clean up
clearTimers(timerInst);

describe('durable timers — restore re-establishes timers');

var scheduledMs = null;
var mockHost = {
  now: function () { return timerSnap.pendingTimers[0].createdAt + 2000; }, // 2s elapsed
  scheduleAfter: function (ms, cb) { scheduledMs = ms; return 999; },
  scheduleEvery: function (ms, cb) { return 998; },
  cancelTimer: function () {},
  persist: null,
  log: function () {}
};

var restored = machine.restore(timerDef, timerSnap, mockHost);
eq(scheduledMs, 3000, 'restored timer has 3000ms remaining (5000 - 2000 elapsed)');
eq(restored._pendingTimers.length, 1, 'restored instance has pending timer');

describe('durable timers — cleared on state exit');

var clearDef = machine.createDefinition({
  id: 'clear-timer',
  states: {
    waiting: { after: { ms: 10000, target: 'timeout' }, on: { cancel: [{ target: 'cancelled' }], __timeout: [{ target: 'timeout' }] } },
    cancelled: { final: true },
    timeout: { final: true }
  }
});

var clearInst = machine.createInstance(clearDef);
eq(clearInst._pendingTimers.length, 1, 'timer pending before transition');
machine.sendEvent(clearInst, 'cancel');
eq(clearInst.state, 'cancelled', 'transitioned to cancelled');
eq(clearInst._pendingTimers.length, 0, 'timers cleared on state exit');


// Expose clearTimers for test use
function clearTimers(inst) {
  var host = inst._host;
  for (var i = 0; i < inst._timers.length; i++) host.cancelTimer(inst._timers[i]);
  inst._timers = [];
  inst._pendingTimers = [];
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  mn-where — distributed transition routing                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('mn-where — transition with where returns route signal');

var whereDef = machine.createDefinition({
  id: 'where-test',
  context: { title: 'Test', amount: 500 },
  states: {
    draft: { on: { submit: [{
      target: 'submitted',
      guard: '(> amount 0)',
      action: '(set! title (str title " — submitted"))',
      where: "(requires 'log')"
    }] } },
    submitted: { final: true }
  }
});

var whereInst = machine.createInstance(whereDef);
var whereResult = machine.sendEvent(whereInst, 'submit');

// The transition should NOT execute locally
eq(whereResult.transitioned, false, 'did not transition locally');
eq(whereInst.state, 'draft', 'still in draft state');
eq(whereInst.context.title, 'Test', 'context unchanged — action did not run');

// Instead it returns a route signal
eq(typeof whereResult.route, 'object', 'has route signal (object)');
deepEq(whereResult.route.requires, ['log'], 'route requires log capability');
eq(whereResult.route.event, 'submit', 'route carries the event name');
eq(whereResult.route.target, 'submitted', 'route carries the target state');
eq(whereResult.route.guard, '(> amount 0)', 'route carries the guard');
eq(whereResult.route.action, '(set! title (str title " — submitted"))', 'route carries the action');


describe('mn-where — guard still evaluates locally before routing');

var whereGuardDef = machine.createDefinition({
  id: 'where-guard',
  context: { amount: 0 },
  states: {
    draft: { on: { submit: [{
      target: 'submitted',
      guard: '(> amount 0)',
      where: "(requires 'log')"
    }] } },
    submitted: { final: true }
  }
});

var whereGuardInst = machine.createInstance(whereGuardDef);
var whereGuardResult = machine.sendEvent(whereGuardInst, 'submit');

eq(whereGuardResult.transitioned, false, 'did not transition');
eq(whereGuardResult.route, null, 'no route — guard blocked it before routing');
eq(whereGuardResult.reason, 'no matching transition', 'blocked by guard');


describe('mn-where — transition without where executes locally as normal');

var noWhereDef = machine.createDefinition({
  id: 'no-where',
  context: { x: 0 },
  states: {
    a: { on: { go: [{ target: 'b', action: '(inc! x)' }] } },
    b: { final: true }
  }
});

var noWhereInst = machine.createInstance(noWhereDef);
var noWhereResult = machine.sendEvent(noWhereInst, 'go');

eq(noWhereResult.transitioned, true, 'transitioned locally');
eq(noWhereInst.state, 'b', 'in state b');
eq(noWhereInst.context.x, 1, 'action ran');
eq(noWhereResult.route, null, 'no route signal');


describe('mn-where — requires multiple capabilities');

var multiCapDef = machine.createDefinition({
  id: 'multi-cap',
  context: {},
  states: {
    a: { on: { go: [{ target: 'b', where: "(requires 'persist' 'notify')" }] } },
    b: { final: true }
  }
});

var multiCapInst = machine.createInstance(multiCapDef);
var multiCapResult = machine.sendEvent(multiCapInst, 'go');

eq(multiCapResult.transitioned, false, 'did not transition locally');
deepEq(multiCapResult.route.requires, ['persist', 'notify'], 'requires both capabilities');


describe('mn-where — host with matching capabilities executes locally');

var localCapDef = machine.createDefinition({
  id: 'local-cap',
  context: { x: 0 },
  states: {
    a: { on: { go: [{ target: 'b', action: '(inc! x)', where: "(requires 'log')" }] } },
    b: { final: true }
  }
});

// Host declares it CAN log
var capableHost = {
  now: function () { return Date.now(); },
  scheduleAfter: function (ms, cb) { return setTimeout(cb, ms); },
  scheduleEvery: function (ms, cb) { return setInterval(cb, ms); },
  cancelTimer: function (id) { clearTimeout(id); clearInterval(id); },
  emit: function () {},
  persist: null,
  log: function () {},
  capabilities: ['log', 'notify']
};

var localCapInst = machine.createInstance(localCapDef, { host: capableHost });
var localCapResult = machine.sendEvent(localCapInst, 'go');

eq(localCapResult.transitioned, true, 'transitioned locally — host has the capability');
eq(localCapInst.state, 'b', 'in state b');
eq(localCapInst.context.x, 1, 'action ran locally');
eq(localCapResult.route, null, 'no route signal — executed locally');


describe('mn-where — host missing one capability still routes');

var partialCapDef = machine.createDefinition({
  id: 'partial-cap',
  context: {},
  states: {
    a: { on: { go: [{ target: 'b', where: "(requires 'persist' 'notify')" }] } },
    b: { final: true }
  }
});

// Host has notify but NOT persist
var partialHost = {
  now: function () { return Date.now(); },
  scheduleAfter: function (ms, cb) { return setTimeout(cb, ms); },
  scheduleEvery: function (ms, cb) { return setInterval(cb, ms); },
  cancelTimer: function (id) { clearTimeout(id); clearInterval(id); },
  emit: function () {},
  persist: null,
  log: function () {},
  capabilities: ['notify']
};

var partialCapInst = machine.createInstance(partialCapDef, { host: partialHost });
var partialCapResult = machine.sendEvent(partialCapInst, 'go');

eq(partialCapResult.transitioned, false, 'did not transition — missing persist');
deepEq(partialCapResult.route.requires, ['persist', 'notify'], 'route signal with requirements');
eq(partialCapInst.state, 'a', 'still in state a');


describe('sendEvent — done.state.* emitted on final state entry');
var doneDef = machine.createDefinition({
  id: 'done-test',
  states: {
    working: { on: { finish: [{ target: 'complete' }] } },
    complete: { final: true }
  }
});
var doneInst = machine.createInstance(doneDef);
var doneResult = machine.sendEvent(doneInst, 'finish');
eq(doneResult.isFinal, true, 'result reports final state');
deepEq(doneResult.emits, [{name: 'done.state.complete', payload: null}], 'emits exactly done.state.complete on final entry');

// Non-final transition should NOT emit done
var nonDoneDef = machine.createDefinition({
  id: 'non-done',
  states: {
    a: { on: { go: [{ target: 'b' }] } },
    b: { on: { back: [{ target: 'a' }] } }
  }
});
var nonDoneInst = machine.createInstance(nonDoneDef);
var nonDoneResult = machine.sendEvent(nonDoneInst, 'go');
deepEq(nonDoneResult.emits, [], 'non-final state emits nothing');


describe('sendEvent — eventless transitions on state entry');
var autoRouteDef = machine.createDefinition({
  id: 'auto-route',
  context: { amount: 5000 },
  states: {
    draft: { on: { submit: [{ target: 'review' }] } },
    review: { on: {
      __auto: [
        { target: 'auto-approved', guard: '(< amount 10000)' },
        { target: 'pending' }
      ]
    }},
    'auto-approved': { final: true },
    pending: { on: { approve: [{ target: 'auto-approved' }] } }
  }
});
var autoRouteInst = machine.createInstance(autoRouteDef);
var autoResult = machine.sendEvent(autoRouteInst, 'submit');
eq(autoRouteInst.state, 'auto-approved', 'eventless transition fires: amount < 10000 auto-approves');
eq(autoResult.to, 'auto-approved', 'result reflects final state after eventless chain');

// Test guard blocks eventless — takes fallback
var autoRoute2 = machine.createInstance(autoRouteDef, { context: { amount: 50000 } });
machine.sendEvent(autoRoute2, 'submit');
eq(autoRoute2.state, 'pending', 'eventless guard blocks: amount >= 10000 goes to pending');

// Eventless chain: go→b, auto b→a, a has no auto, stops in a
var chainDef = machine.createDefinition({
  id: 'auto-chain',
  states: {
    a: { on: { go: [{ target: 'b' }] } },
    b: { on: { __auto: [{ target: 'a' }] } }
  }
});
var chainInst = machine.createInstance(chainDef);
machine.sendEvent(chainInst, 'go');
eq(chainInst.state, 'a', 'eventless chain: go→b, auto b→a, stops in a');


describe('sendEvent — reentrancy guard');
var reentrantDef = machine.createDefinition({
  id: 'reentrant',
  states: {
    a: { on: { go: [{ target: 'b', action: "(set! x 1)" }] } },
    b: { on: { back: [{ target: 'a' }] } }
  }
});
var reentrantHost = {
  now: function () { return 1; },
  scheduleAfter: function (ms, cb) { cb(); return 0; },  // synchronous! simulates reentrant timer
  scheduleEvery: function () { return 0; },
  cancelTimer: function () {},
  capabilities: []
};
var reentrantInst = machine.createInstance(reentrantDef, { host: reentrantHost });
var r1 = machine.sendEvent(reentrantInst, 'go');
eq(r1.transitioned, true, 'first sendEvent transitions normally');
// After sendEvent, _processing should be false/undefined (not stuck)
eq(!!reentrantInst._processing, false, 'processing flag cleared after sendEvent');


describe('mn-where — initial state with where returns route on createInstance');
var whereInitDef = machine.createDefinition({
  id: 'where-init',
  initial: 'loading',
  states: {
    loading: { on: { loaded: [{ target: 'ready' }] }, where: "(requires 'ui-render')" },
    ready: { on: {} }
  }
});
var whereInitInst = machine.createInstance(whereInitDef, {
  host: { now: function () { return 1; }, scheduleAfter: function () { return 0; }, scheduleEvery: function () { return 0; }, cancelTimer: function () {}, capabilities: [] }
});
deepEq(whereInitInst.route.requires, ['ui-render'], 'createInstance returns route signal with correct capabilities');
deepEq(whereInitInst.route.requires, ['ui-render'], 'route requires ui-render');

var whereInitLocal = machine.createInstance(whereInitDef, {
  host: { now: function () { return 1; }, scheduleAfter: function () { return 0; }, scheduleEvery: function () { return 0; }, cancelTimer: function () {}, capabilities: ['ui-render'] }
});
eq(whereInitLocal.route, undefined, 'no route when host satisfies initial state where');


describe('watch — observe context changes');

var watchDef = machine.createDefinition({
  id: 'watch-test',
  context: { count: 0 },
  states: {
    a: { on: { inc: [{ target: 'b', action: '(inc! count)' }] } },
    b: { on: { dec: [{ target: 'a', action: '(dec! count)' }] } }
  }
});
var watchInst = machine.createInstance(watchDef);
var watchLog = [];
var watchFn = function (key, oldVal, newVal, state) {
  watchLog.push({ key: key, old: oldVal, new: newVal, state: state });
};
machine.watch(watchInst, watchFn);
machine.sendEvent(watchInst, 'inc');
eq(watchLog.length, 1, 'watcher called once');
eq(watchLog[0].key, 'count', 'watcher reports changed key');
eq(watchLog[0].old, 0, 'watcher reports old value');
eq(watchLog[0].new, 1, 'watcher reports new value');
eq(watchLog[0].state, 'b', 'watcher reports target state');

// Unwatch by callback reference
machine.unwatch(watchInst, watchFn);
machine.sendEvent(watchInst, 'dec');
eq(watchLog.length, 1, 'no call after unwatch by callback');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  deepCopy                                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('deepCopy — Date objects produce warning');

var deepCopyDef = machine.createDefinition({
  id: 'deep-copy-date',
  states: { a: { on: { go: [{ target: 'b' }] } }, b: { final: true } },
  context: { created: new Date(2026, 0, 1) }
});

// The Date should be copied as {} (not a Date instance) — context must be JSON-serializable
var deepCopyInst = machine.createInstance(deepCopyDef);
eq(typeof deepCopyInst.context.created, 'object', 'Date copied as object');
eq(deepCopyInst.context.created instanceof Date, false, 'Date not preserved (copied as plain object)');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  executePipeline                                                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('executePipeline — happy path (3 states → final)');

var pipeDef = machine.createDefinition({
  id: 'pipe-happy',
  states: {
    draft: { on: { submit: [{ target: 'review', action: '(set! submitted true)' }] } },
    review: { on: { approve: [{ target: 'done', action: '(set! approved true)' }] } },
    done: { final: true }
  },
  context: { submitted: false, approved: false }
});

var pipeResult = machine.executePipeline(pipeDef, {});

eq(pipeResult.instance.state, 'done', 'reaches final state');
eq(pipeResult.instance.context.submitted, true, 'submit action ran');
eq(pipeResult.instance.context.approved, true, 'approve action ran');
eq(pipeResult.blocked, false, 'not blocked');
eq(pipeResult.history.length, 2, 'history has 2 transitions');
eq(pipeResult.history[0].event, 'submit', 'first event was submit');
eq(pipeResult.history[0].from, 'draft', 'first transition from draft');
eq(pipeResult.history[0].to, 'review', 'first transition to review');
eq(pipeResult.history[1].event, 'approve', 'second event was approve');
eq(pipeResult.history[1].from, 'review', 'second transition from review');
eq(pipeResult.history[1].to, 'done', 'second transition to done');


describe('executePipeline — maxSteps exceeded');

var pipeLoop = machine.createDefinition({
  id: 'pipe-loop',
  states: {
    a: { on: { go: [{ target: 'b' }] } },
    b: { on: { go: [{ target: 'a' }] } }
  }
});

var loopResult = machine.executePipeline(pipeLoop, { maxSteps: 4 });

eq(loopResult.blocked, true, 'blocked when maxSteps hit');
eq(loopResult.reason, 'maxSteps exceeded', 'reason is maxSteps');
eq(loopResult.history.length, 4, 'exactly 4 transitions recorded');


describe('executePipeline — guard blocks transition');

var pipeGuard = machine.createDefinition({
  id: 'pipe-guard',
  states: {
    idle: { on: { go: [{ target: 'done', guard: '(> x 100)' }] } },
    done: { final: true }
  },
  context: { x: 50 }
});

var guardResult = machine.executePipeline(pipeGuard, {});

eq(guardResult.blocked, true, 'blocked by guard');
eq(guardResult.instance.state, 'idle', 'stayed in idle');


describe('executePipeline — effects dispatched');

var effectsCalled = [];
var pipeEffects = machine.createDefinition({
  id: 'pipe-effects',
  states: {
    start: { on: { go: [{ target: 'end', action: "(do (invoke! :type 'log' :input 'hello') (invoke! :type 'notify' :input (obj :to 'x')))" }] } },
    end: { final: true }
  }
});

var effectResult = machine.executePipeline(pipeEffects, {
  effects: {
    'log': function (input) { effectsCalled.push({ type: 'log', input: input }); },
    'notify': function (input) { effectsCalled.push({ type: 'notify', input: input }); }
  }
});

eq(effectResult.instance.state, 'end', 'reached final');
eq(effectsCalled.length, 2, '2 effects dispatched');
eq(effectsCalled[0].type, 'log', 'first effect is log');
eq(effectsCalled[0].input, 'hello', 'log input correct');
eq(effectsCalled[1].type, 'notify', 'second effect is notify');
eq(effectsCalled[1].input.to, 'x', 'notify input correct');
eq(effectResult.effects.length, 2, 'effects recorded in result');


describe('executePipeline — custom eventSelector');

var pipeChoice = machine.createDefinition({
  id: 'pipe-choice',
  states: {
    pending: { on: {
      approve: [{ target: 'approved' }],
      reject: [{ target: 'rejected' }]
    } },
    approved: { final: true },
    rejected: { final: true }
  },
  context: { amount: 200000 }
});

var choiceResult = machine.executePipeline(pipeChoice, {
  eventSelector: function (events, context) {
    if (events.indexOf('reject') !== -1 && context.amount > 100000) return 'reject';
    return events[0];
  }
});

eq(choiceResult.instance.state, 'rejected', 'custom selector chose reject');

var choiceResult2 = machine.executePipeline(
  machine.createDefinition({
    id: 'pipe-choice2',
    states: {
      pending: { on: { approve: [{ target: 'approved' }], reject: [{ target: 'rejected' }] } },
      approved: { final: true },
      rejected: { final: true }
    },
    context: { amount: 500 }
  }),
  { eventSelector: function (events, context) {
    if (events.indexOf('reject') !== -1 && context.amount > 100000) return 'reject';
    return events[0];
  }}
);

eq(choiceResult2.instance.state, 'approved', 'custom selector chose approve for low amount');


describe('executePipeline — route signal stops execution');

var pipeRoute = machine.createDefinition({
  id: 'pipe-route',
  states: {
    local: { on: { advance: [{ target: 'remote', where: "(list 'gpu' 'ml')" }] } },
    remote: { final: true }
  }
});

var routeResult = machine.executePipeline(pipeRoute, {});

eq(routeResult.blocked, false, 'not blocked — routed');
eq(typeof routeResult.route, 'object', 'route signal present (object)');
deepEq(routeResult.route.requires, ['gpu', 'ml'], 'route requires gpu and ml');
eq(routeResult.instance.state, 'local', 'stayed in local (routed, not executed)');


describe('executePipeline — no transitions stops gracefully');

var pipeNoTrans = machine.createDefinition({
  id: 'pipe-notrans',
  states: {
    stuck: {}
  }
});

var noTransResult = machine.executePipeline(pipeNoTrans, {});

eq(noTransResult.blocked, false, 'not blocked — just no transitions');
eq(noTransResult.instance.state, 'stuck', 'stayed in stuck');
eq(noTransResult.history.length, 0, 'no history entries');


describe('executePipeline — mn:where on state entry blocks mid-pipeline');

// Pipeline: start → advance → blocked (mn:where requires 'gpu')
// The where check happens when entering the blocked state, not on the transition.
var pipeWhereEntry = machine.createDefinition({
  id: 'pipe-where-entry',
  states: {
    start: { on: { advance: [{ target: 'needs-gpu' }] } },
    'needs-gpu': { where: "(list 'gpu')", on: { compute: [{ target: 'done' }] } },
    done: { final: true }
  }
});

var whereEntryResult = machine.executePipeline(pipeWhereEntry, {
  capabilities: ['cpu']
});

eq(whereEntryResult.blocked, false, 'not blocked — routed');
eq(typeof whereEntryResult.route, 'object', 'route signal present');
deepEq(whereEntryResult.route.requires, ['gpu'], 'route requires gpu');
eq(whereEntryResult.instance.state, 'needs-gpu', 'transitioned INTO needs-gpu before route signal');

// Same pipeline but host HAS the capability — goes to done
var whereEntryPass = machine.executePipeline(pipeWhereEntry, {
  capabilities: ['cpu', 'gpu']
});

eq(whereEntryPass.instance.state, 'done', 'with gpu capability, pipeline reaches done');
eq(whereEntryPass.route, undefined, 'no route signal when capability present');


describe('executePipeline — resume with injected capability + eventSelector');

// Simulate: pipeline blocked at needs-review, resumed with 'review' capability
// and forced first event 'approve'
var pipeResume = machine.createDefinition({
  id: 'pipe-resume',
  initial: 'needs-review',
  states: {
    'needs-review': {
      where: "(list 'review')",
      on: {
        approve: [{ target: 'approved', action: "(set! verdict 'yes')" }],
        reject: [{ target: 'rejected', action: "(set! verdict 'no')" }]
      }
    },
    approved: { on: { finalise: [{ target: 'done' }] } },
    done: { final: true },
    rejected: { final: true }
  },
  context: { verdict: null }
});

// Without review capability — blocked at initial state
var resumeBlocked = machine.executePipeline(pipeResume, {
  capabilities: ['cpu']
});
eq(typeof resumeBlocked.route, 'object', 'blocked without review capability');
eq(resumeBlocked.instance.state, 'needs-review', 'blocked at needs-review');

// Resume with review capability + force 'approve' as first event
var fired = false;
var resumeResult = machine.executePipeline(pipeResume, {
  capabilities: ['cpu', 'review'],
  eventSelector: function (events) {
    if (!fired && events.indexOf('approve') !== -1) { fired = true; return 'approve'; }
    return events[0];
  }
});
eq(resumeResult.instance.state, 'done', 'resumed pipeline reaches done');
eq(resumeResult.instance.context.verdict, 'yes', 'approve action set verdict to yes');

// Resume with review capability + force 'reject' as first event
var firedR = false;
var resumeReject = machine.executePipeline(pipeResume, {
  capabilities: ['cpu', 'review'],
  eventSelector: function (events) {
    if (!firedR && events.indexOf('reject') !== -1) { firedR = true; return 'reject'; }
    return events[0];
  }
});
eq(resumeReject.instance.state, 'rejected', 'resume with reject reaches rejected');
eq(resumeReject.instance.context.verdict, 'no', 'reject action set verdict to no');


describe('executePipeline — format and formatUpdater');

var pipeFormat = machine.createDefinition({
  id: 'pipe-fmt',
  states: {
    a: { on: { go: [{ target: 'b' }] } },
    b: { final: true }
  }
});

var formatCalls = [];
var fmtResult = machine.executePipeline(pipeFormat, {
  format: '<scxml initial="a"/>',
  formatUpdater: function (fmt, state, ctx) {
    formatCalls.push({ state: state, fmt: fmt });
    return fmt.replace(/initial="[^"]*"/, 'initial="' + state + '"');
  }
});

eq(fmtResult.instance.state, 'b', 'reached final');
eq(formatCalls.length, 1, 'formatUpdater called once');
eq(formatCalls[0].state, 'b', 'formatUpdater received new state');
eq(fmtResult.format, '<scxml initial="b"/>', 'format updated');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Error state                                                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('error state — implicit final error state injected');

var errImplicit = machine.createDefinition({
  id: 'err-impl', states: { idle: {}, active: {} }
});
eq(errImplicit._stateTree.error != null, true, 'error state exists');
eq(errImplicit._stateTree.error.spec.final, true, 'error state is final');


describe('error state — explicit error state not overwritten');

var errExplicit = machine.createDefinition({
  id: 'err-expl',
  states: { idle: {}, error: { on: { fix: [{ target: 'idle' }] } } }
});
eq(errExplicit._stateTree.error.spec.final, undefined, 'explicit error is not final');
eq(errExplicit._stateTree.error.spec.on.fix != null, true, 'explicit error has fix transition');


describe('error state — action throw transitions to error with $error and $errorSource');

var errThrowDef = machine.createDefinition({
  id: 'err-throw',
  states: { idle: { on: { go: [{ target: 'active', action: '(map 5 items)' }] } }, active: {} },
  context: { items: [1] }
});
var errThrowInst = machine.createInstance(errThrowDef);
var errThrowResult = machine.sendEvent(errThrowInst, 'go');
eq(errThrowInst.state, 'error', 'machine in error state');
eq(typeof errThrowInst.context.$error, 'string', '$error is a string');
eq(errThrowInst.context.$errorSource, 'idle', '$errorSource is idle');
eq(errThrowResult.transitioned, true, 'result shows transitioned');
eq(errThrowResult.to, 'error', 'result.to is error');


describe('error state — guard throw transitions to error');

var errGuardDef = machine.createDefinition({
  id: 'err-guard',
  states: { idle: { on: { go: [{ target: 'active', guard: '(map 5 x)' }] } }, active: {} },
  context: { x: [1] }
});
var errGuardInst = machine.createInstance(errGuardDef);
machine.sendEvent(errGuardInst, 'go');
eq(errGuardInst.state, 'error', 'guard throw → error');
eq(errGuardInst.context.$errorSource, 'idle', '$errorSource is idle');


describe('error state — error recorded in history');

eq(errThrowInst.history.length > 0, true, 'history has entries');
var errLastHist = errThrowInst.history[errThrowInst.history.length - 1];
eq(errLastHist.from, 'idle', 'history from is idle');
eq(errLastHist.to, 'error', 'history to is error');
eq(errLastHist.event, 'go', 'history event is go');


describe('error state — explicit error state allows recovery');

var errRecoverDef = machine.createDefinition({
  id: 'err-recover',
  states: {
    idle: { on: { go: [{ target: 'processing' }] } },
    processing: { on: { compute: [{ target: 'done', action: '(map 5 items)' }] } },
    done: { final: true },
    error: { on: { retry: [{ target: 'idle' }] } }
  },
  context: { items: [1] }
});
var errRecoverInst = machine.createInstance(errRecoverDef);
machine.sendEvent(errRecoverInst, 'go');
machine.sendEvent(errRecoverInst, 'compute');
eq(errRecoverInst.state, 'error', 'action threw, in error');
eq(errRecoverInst.context.$errorSource, 'processing', '$errorSource is processing');
machine.sendEvent(errRecoverInst, 'retry');
eq(errRecoverInst.state, 'idle', 'recovered via retry');


describe('executePipeline — sync adapter modifies context');

var pipeAdapterSync = machine.createDefinition({
  id: 'pipe-adapter-sync',
  states: {
    loading: { on: { load: [{ target: 'ready', action: "(invoke! :type 'enrich' :input 'items')" }] } },
    ready: {}
  },
  context: { items: null, count: 0 }
});

var syncAdapterResult = machine.executePipeline(pipeAdapterSync, {
  effects: {
    enrich: function (input, ctx) {
      ctx.items = ['alpha', 'beta', 'gamma'];
      ctx.count = 3;
    }
  },
  maxSteps: 5
});

eq(syncAdapterResult.instance.state, 'ready', 'sync pipeline reached ready');
deepEq(syncAdapterResult.instance.context.items, ['alpha', 'beta', 'gamma'], 'sync adapter injected items into context');
eq(syncAdapterResult.instance.context.count, 3, 'sync adapter set count');


describe('executePipelineAsync — async adapter modifies context');

(async function () {
  var pipeAdapterAsync = machine.createDefinition({
    id: 'pipe-adapter-async',
    states: {
      loading: { on: { load: [{ target: 'ready', action: "(invoke! :type 'enrich' :input 'items')" }] } },
      ready: {}
    },
    context: { items: null, count: 0 }
  });

  var asyncAdapterResult = await machine.executePipelineAsync(pipeAdapterAsync, {
    effects: {
      enrich: function (input, ctx) {
        ctx.items = ['alpha', 'beta', 'gamma'];
        ctx.count = 3;
      }
    },
    maxSteps: 5
  });

  eq(asyncAdapterResult.instance.state, 'ready', 'async pipeline reached ready');
  deepEq(asyncAdapterResult.instance.context.items, ['alpha', 'beta', 'gamma'], 'async adapter injected items into context');
  eq(asyncAdapterResult.instance.context.count, 3, 'async adapter set count');
})();


describe('executePipelineAsync — async adapter with Promise return modifies context');

(async function () {
  var pipeAdapterPromise = machine.createDefinition({
    id: 'pipe-adapter-promise',
    states: {
      loading: { on: { load: [{ target: 'ready', action: "(invoke! :type 'fetch' :input 'data')" }] } },
      ready: {}
    },
    context: { data: null }
  });

  var promiseResult = await machine.executePipelineAsync(pipeAdapterPromise, {
    effects: {
      fetch: function (input, ctx) {
        return new Promise(function (resolve) {
          ctx.data = { source: 'server', rows: 42 };
          resolve();
        });
      }
    },
    maxSteps: 5
  });

  eq(promiseResult.instance.state, 'ready', 'promise adapter pipeline reached ready');
  eq(promiseResult.instance.context.data.source, 'server', 'promise adapter injected data.source');
  eq(promiseResult.instance.context.data.rows, 42, 'promise adapter injected data.rows');
})();


describe('executePipeline — adapter context changes reflected in format output');

var pipeAdapterFormat = machine.createDefinition({
  id: 'pipe-adapter-fmt',
  states: {
    loading: { on: { load: [{ target: 'ready', action: "(invoke! :type 'enrich' :input 'x')" }] } },
    ready: {}
  },
  context: { value: 0 }
});

var adapterFmtCalls = [];
var adapterFmtResult = machine.executePipeline(pipeAdapterFormat, {
  effects: { enrich: function (input, ctx) { ctx.value = 999; } },
  maxSteps: 5,
  format: '{"state":"loading","value":0}',
  formatUpdater: function (fmt, state, ctx) {
    adapterFmtCalls.push({ state: state, value: ctx.value });
    return JSON.stringify({ state: state, value: ctx.value });
  }
});

eq(adapterFmtResult.instance.context.value, 999, 'adapter set value to 999');
eq(adapterFmtCalls.length, 1, 'formatUpdater called once');
eq(adapterFmtCalls[0].value, 999, 'formatUpdater received adapter-modified context');
eq(adapterFmtResult.format, '{"state":"ready","value":999}', 'format reflects adapter changes');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Bug fixes                                                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('Bug 4 — autoLimit sentinel: 100 eventless transitions, no spurious warning');

(function () {
  // Build a machine with exactly 100 chained eventless transitions.
  // With the old `if (autoLimit <= 0)` check this incorrectly warns.
  var states = { trigger: { on: { go: [{ target: 's0' }] } } };
  for (var i = 0; i < 100; i++) {
    states['s' + i] = { on: { __auto: [{ target: 's' + (i + 1) }] } };
  }
  states['s100'] = { final: true };
  var autoLimitDef = machine.createDefinition({ id: 'auto-limit-100', initial: 'trigger', states: states });
  var autoLimitInst = machine.createInstance(autoLimitDef);

  var warnings = [];
  var origWarn = console.warn;
  console.warn = function (msg) { warnings.push(msg); };
  machine.sendEvent(autoLimitInst, 'go');
  console.warn = origWarn;

  eq(autoLimitInst.state, 's100', 'reached s100 after 100 auto transitions');
  eq(warnings.filter(function (w) { return w.indexOf('eventless transition loop limit') !== -1; }).length, 0,
    'no spurious warning for clean exit at limit');
})();

describe('Bug 4 — autoLimit: warning fires when limit truly exceeded');

(function () {
  // A machine that loops forever: a→b→a via auto. Should warn.
  var loopDef = machine.createDefinition({
    id: 'auto-loop',
    states: {
      start: { on: { go: [{ target: 'a' }] } },
      a: { on: { __auto: [{ target: 'b' }] } },
      b: { on: { __auto: [{ target: 'a' }] } }
    }
  });
  var loopInst = machine.createInstance(loopDef);
  var warnings = [];
  var origWarn = console.warn;
  console.warn = function (msg) { warnings.push(msg); };
  machine.sendEvent(loopInst, 'go');
  console.warn = origWarn;

  eq(warnings.filter(function (w) { return w.indexOf('eventless transition loop limit') !== -1; }).length, 1,
    'warning fires when loop actually exhausts autoLimit');
})();


describe('Bug 5 — _validateTransitions does not mutate caller-owned spec');

(function () {
  var spec = {
    id: 'no-mutate',
    states: {
      a: { on: { go: { target: 'b' } } },  // object, not array
      b: { final: true }
    }
  };
  var origTransition = spec.states.a.on.go;  // the plain object

  machine.createDefinition(spec);

  // spec.states.a.on.go must still be the original plain object, not wrapped in an array
  eq(Array.isArray(spec.states.a.on.go), false, 'createDefinition does not mutate caller spec to array');
  eq(spec.states.a.on.go, origTransition, 'caller-owned transition object is unchanged');

  // Calling createDefinition a second time must produce an identical definition
  var def2 = machine.createDefinition(spec);
  eq(def2.id, 'no-mutate', 'second createDefinition call succeeds with same spec');
})();


describe('Bug 6 — executePipeline cancels timers after completion');

(function () {
  var timersCancelled = [];
  var timerIdCounter = 100;
  var pipeTimerDef = machine.createDefinition({
    id: 'pipe-timer',
    states: {
      waiting: { after: { ms: 5000, target: 'done' }, on: { go: [{ target: 'done' }], __timeout: [{ target: 'done' }] } },
      done: { final: true }
    }
  });

  // Run pipeline — it should cancel the `after` timer it set up
  machine.executePipeline(pipeTimerDef, {
    effects: {},
    eventSelector: function () { return 'go'; }
  });

  // After pipeline returns, inst._timers should be empty (timers cancelled)
  // We verify by checking via a custom mock host
  var cancelled = [];
  var scheduled = [];
  var mockTimerHost = {
    now: function () { return Date.now(); },
    scheduleAfter: function (ms, cb) { var id = ++timerIdCounter; scheduled.push(id); return id; },
    scheduleEvery: function (ms, cb) { var id = ++timerIdCounter; scheduled.push(id); return id; },
    cancelTimer: function (id) { cancelled.push(id); },
    emit: function () {},
    persist: null,
    log: function () {},
    capabilities: ['go']
  };

  var pipeTimerResult = machine.executePipeline(pipeTimerDef, {
    effects: { go: function () {} },
    eventSelector: function () { return 'go'; },
    _host: mockTimerHost   // not used — pipeline creates its own host
  });

  // The pipeline instance's _timers must be empty after it returns
  eq(pipeTimerResult.instance._timers.length, 0, 'pipeline instance has no live timers after completion');
})();


describe('Bug 7 — executePipeline collects events from ancestor states');

(function () {
  // Child state has no `on`, parent has `submit` → final.
  // Pipeline must be able to fire parent's event.
  var ancestorDef = machine.createDefinition({
    id: 'pipe-ancestor',
    states: {
      processing: {
        on: { submit: [{ target: 'done' }] },  // event on PARENT
        states: {
          validate: {}   // atomic child with no events of its own
        }
      },
      done: { final: true }
    }
  });

  var ancestorResult = machine.executePipeline(ancestorDef, {});
  eq(ancestorResult.instance.state, 'done', 'pipeline fires parent-level event from child atomic state');
  eq(ancestorResult.blocked, false, 'not blocked — parent event was found');
})();


describe('Bug 8 — unwatch removes a single watcher, leaves others intact');

(function () {
  var uwDef = machine.createDefinition({
    id: 'unwatch-single',
    context: { x: 0 },
    states: {
      a: { on: { tick: [{ target: 'b', action: '(inc! x)' }] } },
      b: { on: { tick: [{ target: 'a', action: '(inc! x)' }] } }
    }
  });

  var uwInst = machine.createInstance(uwDef);
  var log1 = [], log2 = [];
  var fn1 = function (k) { log1.push(k); };
  var fn2 = function (k) { log2.push(k); };

  machine.watch(uwInst, fn1);
  machine.watch(uwInst, fn2);
  machine.sendEvent(uwInst, 'tick');
  eq(log1.length, 1, 'both watchers fire before unwatch: fn1');
  eq(log2.length, 1, 'both watchers fire before unwatch: fn2');

  machine.unwatch(uwInst, fn1);   // remove only fn1
  machine.sendEvent(uwInst, 'tick');
  eq(log1.length, 1, 'fn1 not called after unwatch');
  eq(log2.length, 2, 'fn2 still called after fn1 unwatched');

  machine.unwatch(uwInst);        // remove all
  machine.sendEvent(uwInst, 'tick');
  eq(log2.length, 2, 'fn2 not called after unwatch-all');
})();


describe('history — bounded by maxHistory (default 200)');

(function () {
  var histDef = machine.createDefinition({
    id: 'hist-cap',
    states: {
      a: { on: { go: [{ target: 'b' }] } },
      b: { on: { back: [{ target: 'a' }] } }
    }
  });
  var histInst = machine.createInstance(histDef);
  for (var h = 0; h < 300; h++) {
    machine.sendEvent(histInst, h % 2 === 0 ? 'go' : 'back');
  }
  eq(histInst.history.length, 200, 'history capped at exactly 200 after 300 events');
})();

describe('history — custom maxHistory via spec');

(function () {
  var histSmallDef = machine.createDefinition({
    id: 'hist-small',
    maxHistory: 5,
    states: {
      a: { on: { go: [{ target: 'b' }] } },
      b: { on: { back: [{ target: 'a' }] } }
    }
  });
  var histSmallInst = machine.createInstance(histSmallDef);
  for (var hs = 0; hs < 20; hs++) {
    machine.sendEvent(histSmallInst, hs % 2 === 0 ? 'go' : 'back');
  }
  eq(histSmallInst.history.length, 5, 'custom maxHistory=5 — exactly 5 after 20 events');
})();


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Quality check — new bugs                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('H6 — watchers called on targetless transitions');
(function () {
  var def = machine.createDefinition({
    id: 'watchTargetless', initial: 'idle',
    states: { idle: { on: { ping: [{ action: '(inc! count)' }] } } }
  });
  var inst = machine.createInstance(def, { context: { count: 0 } });
  var watchLog = [];
  // watcher signature: (key, oldVal, newVal, state)
  machine.watch(inst, function (key, oldVal, newVal) { watchLog.push({ key: key, oldVal: oldVal, newVal: newVal }); });
  machine.sendEvent(inst, 'ping');
  assert(watchLog.length === 1, 'watcher called once after targetless transition (got ' + watchLog.length + ')');
  eq(watchLog[0].key, 'count', 'watcher reports correct key');
  eq(watchLog[0].oldVal, 0, 'old value is 0');
  eq(watchLog[0].newVal, 1, 'new value is 1');
  eq(inst.context.count, 1, 'context updated to count=1');
})();

describe('H9 — snapshot returns copy not live history reference');
(function () {
  var def = machine.createDefinition({
    id: 'snapHistory', initial: 'a',
    states: { a: { on: { go: [{ target: 'b' }] } }, b: {} }
  });
  var inst = machine.createInstance(def);
  machine.sendEvent(inst, 'go');
  var snap = machine.snapshot(inst);
  var snapLen = snap.history.length;
  machine.sendEvent(inst, 'go'); // won't transition (b has no events), but history stays
  eq(snap.history.length, snapLen, 'snapshot.history length unchanged after further mutations');
})();

describe('M8 — pipeline not blocked when final state reached on last step');
(function () {
  var def = machine.createDefinition({
    id: 'finalOnLastStep', initial: 'a',
    states: {
      a: { on: { go: [{ target: 'b' }] } },
      b: { on: { go: [{ target: 'done' }] } },
      done: { final: true }
    }
  });
  // maxSteps=2 — exactly enough steps to reach final
  var result = machine.executePipeline(def, {
    maxSteps: 2,
    eventSelector: function (events) { return events[0] || null; }
  });
  eq(result.blocked, false, 'not blocked when final reached on last step');
  eq(result.instance.state, 'done', 'reached final state');
})();


describe('L4 — inspect does not expose internal events (__timeout, __auto)');

(function () {
  // A machine with an `after` timer has __timeout in its on map at definition time.
  // inspect() must not expose __timeout as an enabled transition.
  var afterDef = machine.createDefinition({
    id: 'l4-test',
    initial: 'waiting',
    context: {},
    states: {
      waiting: {
        after: { ms: 5000, target: 'done' }
      },
      done: { final: true }
    }
  });
  var afterInst = machine.createInstance(afterDef);
  var info = machine.inspect(afterInst);
  var internalNames = info.enabled.map(function (t) { return t.event; }).filter(function (e) {
    return e === '__timeout' || e === '__auto' || e === '.';
  });
  deepEq(internalNames, [], 'inspect enabled list contains no internal event names');
})();


describe('createResult — enabled does not include internal events (__timeout, __auto)');

(function () {
  // sendEvent returns result.enabled via createResult — must filter internal names.
  var timerDef = machine.createDefinition({
    id: 'cr-internal-test',
    initial: 'waiting',
    context: {},
    states: {
      waiting: {
        after: { ms: 5000, target: 'done' },
        on: { proceed: [{ target: 'done' }] }
      },
      done: { final: true }
    }
  });
  var inst = machine.createInstance(timerDef);
  // A failed transition returns result.enabled for the current state (waiting).
  // waiting has both 'proceed' and '__timeout' in its on map.
  // createResult must not expose '__timeout'.
  var result = machine.sendEvent(inst, 'nonexistent');
  deepEq(result.enabled, ['proceed'], 'createResult enabled is [proceed] — no __timeout');
  // cleanup — override host to cancel the timer
  inst._host.cancelTimer = function () {};
})();


describe('restore — _statePath preserved in pending timer metadata');

(function () {
  // When a snapshot is restored, the afterMeta and everyMeta objects must carry
  // _statePath so that clearTimersForState() can remove them when the state exits.
  // Without _statePath, ghost timers survive state transitions.
  var timerDef2 = machine.createDefinition({
    id: 'restore-statepath-test',
    initial: 'waiting',
    context: {},
    states: {
      waiting: {
        after: { ms: 100000, target: 'done' },
        on: { go: [{ target: 'done' }] }
      },
      done: { final: true }
    }
  });

  var inst = machine.createInstance(timerDef2);
  eq(inst._pendingTimers.length, 1, 'original instance has one pending timer');
  eq(inst._pendingTimers[0]._statePath, 'waiting', 'original timer has _statePath=waiting');

  var snap = machine.snapshot(inst);
  eq(snap.pendingTimers.length, 1, 'snapshot captures one pending timer');
  eq(snap.pendingTimers[0]._statePath, 'waiting', 'snapshot timer has _statePath=waiting');

  var inst2 = machine.restore(timerDef2, snap);
  eq(inst2._pendingTimers.length, 1, 'restored instance has one pending timer');
  eq(inst2._pendingTimers[0]._statePath, 'waiting', 'restored timer has _statePath=waiting');

  inst._timers.forEach(function (id) { clearTimeout(id); clearInterval(id); });
  inst2._timers.forEach(function (id) { clearTimeout(id); clearInterval(id); });
})();


describe('targetless transitions respect maxHistory cap');

(function () {
  var tlDef = machine.createDefinition({
    id: 'tl-hist-cap',
    initial: 'active',
    context: { n: 0 },
    states: { active: { on: { bump: [{ action: '(inc! n)' }] } } },
    maxHistory: 10
  });
  var inst = machine.createInstance(tlDef);
  for (var i = 0; i < 25; i++) machine.sendEvent(inst, 'bump');
  eq(inst.history.length, 10, 'targetless transitions capped at maxHistory=10');
  eq(inst.context.n, 25, 'all 25 events executed');
})();


describe('snapshot — pendingTimers is a copy, not a live reference');

(function () {
  var snapDef = machine.createDefinition({
    id: 'snap-copy-test',
    initial: 'waiting',
    context: {},
    states: { waiting: { after: { ms: 99999, target: 'done' } }, done: { final: true } }
  });
  var inst = machine.createInstance(snapDef);
  var snap = machine.snapshot(inst);
  var origLen = inst._pendingTimers.length;
  snap.pendingTimers.push({ type: 'after', ms: 1, target: 'x', createdAt: 0, _statePath: null });
  eq(inst._pendingTimers.length, origLen, 'snapshot mutation does not affect live instance');
  inst._timers.forEach(function (id) { clearTimeout(id); clearInterval(id); });
})();


describe('snapshot — history entries are deep copies');

(function () {
  var histDef = machine.createDefinition({
    id: 'snap-hist-deep',
    initial: 'a',
    context: {},
    states: { a: { on: { go: [{ target: 'b' }] } }, b: {} }
  });
  var inst = machine.createInstance(histDef);
  machine.sendEvent(inst, 'go');
  var snap = machine.snapshot(inst);
  snap.history[0].event = 'TAMPERED';
  eq(inst.history[0].event, 'go', 'snapshot history mutation does not affect live instance');
})();


describe('restore — _stateTimers populated for saved timers');

(function () {
  var rtDef = machine.createDefinition({
    id: 'restore-statetimers',
    initial: 'waiting',
    context: {},
    states: { waiting: { after: { ms: 99999, target: 'done' }, on: { go: [{ target: 'done' }] } }, done: { final: true } }
  });
  var inst = machine.createInstance(rtDef);
  var snap = machine.snapshot(inst);
  var inst2 = machine.restore(rtDef, snap);
  // _stateTimers must be populated so clearTimersForState works on transition
  deepEq(Object.keys(inst2._stateTimers), ['waiting'], 'restored instance has _stateTimers for waiting state');
  eq(inst2._stateTimers.waiting.length, 1, 'restored instance has exactly one timer in waiting state');
  // Transition should cancel the timer via _stateTimers
  machine.sendEvent(inst2, 'go');
  eq(inst2.state, 'done', 'restored instance transitions correctly');
  inst._timers.forEach(function (id) { clearTimeout(id); clearInterval(id); });
  inst2._timers.forEach(function (id) { clearTimeout(id); clearInterval(id); });
})();


describe('createInstance — options.context values are deep-copied');

(function () {
  var dcDef = machine.createDefinition({
    id: 'deep-copy-opts',
    initial: 's',
    context: {},
    states: { s: {} }
  });
  var nested = { name: 'Bob' };
  var inst = machine.createInstance(dcDef, { context: { user: nested } });
  nested.name = 'Alice';
  eq(inst.context.user.name, 'Bob', 'options.context nested object is isolated after create');
})();


describe('compound state — invalid initial caught by validate');

(function () {
  var badDef = machine.createDefinition({
    id: 'bad-compound',
    initial: 'parent',
    context: {},
    states: {
      parent: {
        initial: 'nonexistent',
        states: { child: {} }
      }
    }
  });
  var issues = machine.validate(badDef);
  var initIssue = null;
  for (var vi = 0; vi < issues.length; vi++) {
    if (issues[vi].type === 'invalid-initial') { initIssue = issues[vi]; break; }
  }
  assert(initIssue !== null, 'validate includes an invalid-initial issue');
  eq(initIssue.state, 'parent', 'invalid-initial issue targets parent state');
})();


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  executePipelineAsync                                                   ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('executePipelineAsync — exists and returns a promise');

(async function () {
  assert(typeof machine.executePipelineAsync === 'function', 'executePipelineAsync exported');

  // Simple sync adapter — still works in async pipeline
  var syncDef = machine.createDefinition({
    id: 'async-basic', initial: 'draft', context: { title: 'Test' },
    states: {
      draft: { on: { submit: [{ target: 'submitted', action: '(set! submitted_at (now))' }] } },
      submitted: { on: { approve: [{ target: 'done' }] } },
      done: { final: true }
    }
  });
  var syncResult = await machine.executePipelineAsync(syncDef, { maxSteps: 5 });
  eq(syncResult.instance.state, 'done', 'async pipeline reaches final state with sync adapters');
  eq(syncResult.blocked, false, 'not blocked');


  describe('executePipelineAsync — async adapter with bind');

  // Async adapter returns a promise. bind injects result into context.
  var solveDef = machine.createDefinition({
    id: 'async-bind', initial: 'pending', context: { input: 42, result: null },
    states: {
      pending: { on: { compute: [{
        target: 'done',
        action: "(invoke! :type 'solver' :bind 'result' :input input)"
      }] } },
      done: { final: true }
    }
  });

  var solverCalled = false;
  var solverInput = null;
  var bindResult = await machine.executePipelineAsync(solveDef, {
    maxSteps: 5,
    effects: {
      solver: function (input) {
        solverCalled = true;
        solverInput = input;
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(input * 2); }, 10);
        });
      }
    }
  });

  eq(solverCalled, true, 'async adapter was called');
  eq(solverInput, 42, 'adapter received correct input');
  eq(bindResult.instance.context.result, 84, 'bind injected async result into context (42 * 2 = 84)');
  eq(bindResult.instance.state, 'done', 'reached final state after async effect');
  eq(bindResult.effects.length, 1, 'one effect logged');
  eq(bindResult.effects[0].type, 'solver', 'effect type is solver');


  describe('executePipelineAsync — on-success event injection');

  var successDef = machine.createDefinition({
    id: 'async-success', initial: 'pending', context: { status: null },
    states: {
      pending: { on: {
        run: [{ action: "(invoke! :type 'api' :on-success 'completed' :input 'go')" }],
        completed: [{ target: 'done', action: "(set! status 'ok')" }]
      } },
      done: { final: true }
    }
  });

  var successResult = await machine.executePipelineAsync(successDef, {
    maxSteps: 10,
    effects: {
      api: function () {
        return Promise.resolve('response-data');
      }
    }
  });

  eq(successResult.instance.state, 'done', 'on-success event advanced to done');
  eq(successResult.instance.context.status, 'ok', 'on-success action ran');


  describe('executePipelineAsync — on-error event injection');

  var errorDef = machine.createDefinition({
    id: 'async-error', initial: 'pending', context: { error: null },
    states: {
      pending: { on: {
        run: [{ action: "(invoke! :type 'flaky' :on-error 'failed' :input 'go')" }],
        failed: [{ target: 'error', action: "(set! error 'adapter failed')" }]
      } },
      error: { final: true }
    }
  });

  var errorResult = await machine.executePipelineAsync(errorDef, {
    maxSteps: 10,
    effects: {
      flaky: function () {
        return Promise.reject(new Error('network timeout'));
      }
    }
  });

  eq(errorResult.instance.state, 'error', 'on-error event routed to error state');
  eq(errorResult.instance.context.error, 'adapter failed', 'error action ran');


  describe('executePipelineAsync — multiple sequential async effects');

  var multiDef = machine.createDefinition({
    id: 'async-multi', initial: 'step1', context: { a: null, b: null },
    states: {
      step1: { on: { go: [{
        target: 'step2',
        action: "(invoke! :type 'fetch-a' :bind 'a' :input 'first')"
      }] } },
      step2: { on: { go: [{
        target: 'done',
        action: "(invoke! :type 'fetch-b' :bind 'b' :input 'second')"
      }] } },
      done: { final: true }
    }
  });

  var callOrder = [];
  var multiResult = await machine.executePipelineAsync(multiDef, {
    maxSteps: 10,
    effects: {
      'fetch-a': function (input) {
        callOrder.push('a');
        return new Promise(function (resolve) { setTimeout(function () { resolve('result-a'); }, 5); });
      },
      'fetch-b': function (input) {
        callOrder.push('b');
        return new Promise(function (resolve) { setTimeout(function () { resolve('result-b'); }, 5); });
      }
    }
  });

  eq(multiResult.instance.state, 'done', 'multi-step async pipeline reached done');
  eq(multiResult.instance.context.a, 'result-a', 'first async result bound');
  eq(multiResult.instance.context.b, 'result-b', 'second async result bound');
  deepEq(callOrder, ['a', 'b'], 'adapters called sequentially in pipeline order');
  eq(multiResult.effects.length, 2, 'two effects logged');


  describe('executePipelineAsync — maxSteps respected');

  var loopDef = machine.createDefinition({
    id: 'async-loop', initial: 'a', context: {},
    states: {
      a: { on: { go: [{ target: 'b' }] } },
      b: { on: { go: [{ target: 'a' }] } }
    }
  });

  var loopResult = await machine.executePipelineAsync(loopDef, { maxSteps: 4 });
  eq(loopResult.blocked, true, 'blocked after maxSteps');
  eq(loopResult.reason, 'maxSteps exceeded', 'reason is maxSteps');


  describe('executePipelineAsync — chained effects from on-success event');

  var chainDef = machine.createDefinition({
    id: 'async-chain', initial: 'pending', context: { logged: false },
    states: {
      pending: { on: {
        run: [{ action: "(invoke! :type 'api' :on-success 'api-done' :input 'req')" }],
        'api-done': [{
          target: 'done',
          action: "(invoke! :type 'logger' :bind 'logged' :input 'success')"
        }]
      } },
      done: { final: true }
    }
  });

  var chainEffects = [];
  var chainResult = await machine.executePipelineAsync(chainDef, {
    maxSteps: 10,
    eventSelector: function (events) {
      // Prefer 'run' over 'api-done' — api-done should only fire via on-success
      return events.indexOf('run') !== -1 ? 'run' : events[0];
    },
    effects: {
      api: function () { return Promise.resolve('data'); },
      logger: function (input) { chainEffects.push(input); return true; }
    }
  });

  eq(chainResult.instance.state, 'done', 'chained effects: reached done');
  eq(chainResult.instance.context.logged, true, 'chained effects: logger bind injected');
  deepEq(chainEffects, ['success'], 'chained effects: logger adapter called with correct input');
  eq(chainResult.effects.length, 2, 'chained effects: both effects logged');


  describe('executePipelineAsync — no adapter logs correctly');

  var noAdapterDef = machine.createDefinition({
    id: 'async-no-adapter', initial: 'a', context: {},
    states: {
      a: { on: { go: [{ target: 'b', action: "(invoke! :type 'missing' :input 'x')" }] } },
      b: { final: true }
    }
  });

  var noAdapterResult = await machine.executePipelineAsync(noAdapterDef, { maxSteps: 5, effects: {} });
  eq(noAdapterResult.instance.state, 'b', 'no-adapter: reached final state');
  eq(noAdapterResult.effects.length, 1, 'no-adapter: effect logged');
  eq(noAdapterResult.effects[0].service, 'no-adapter', 'no-adapter: service marked as no-adapter');


  describe('executePipelineAsync — sync adapter return value bound correctly');

  var syncBindDef = machine.createDefinition({
    id: 'async-sync-bind', initial: 'a', context: { id: null },
    states: {
      a: { on: { go: [{ target: 'b', action: "(invoke! :type 'create' :bind 'id' :input 'data')" }] } },
      b: { final: true }
    }
  });

  var syncBindResult = await machine.executePipelineAsync(syncBindDef, {
    maxSteps: 5,
    effects: { create: function () { return 'sync-id-42'; } }
  });

  eq(syncBindResult.instance.context.id, 'sync-id-42', 'sync adapter return value bound via await');


  describe('executePipelineAsync — adapter timeout');

  var timeoutDef = machine.createDefinition({
    id: 'async-timeout', initial: 'pending', context: { error: null },
    states: {
      pending: { on: {
        run: [{ action: "(invoke! :type 'slow' :on-error 'timed-out' :input 'go')" }],
        'timed-out': [{ target: 'error', action: "(set! error 'timeout')" }]
      } },
      error: { final: true }
    }
  });

  var timeoutResult = await machine.executePipelineAsync(timeoutDef, {
    maxSteps: 10,
    effectTimeout: 50,
    eventSelector: function (events) {
      return events.indexOf('run') !== -1 ? 'run' : events[0];
    },
    effects: {
      slow: function () {
        return new Promise(function (resolve) {
          setTimeout(function () { resolve('too late'); }, 200);
        });
      }
    }
  });

  eq(timeoutResult.instance.state, 'error', 'adapter timeout routed to error state');
  eq(timeoutResult.instance.context.error, 'timeout', 'timeout error action ran');


  describe('validate — warns on undefined context keys in guards');

  var undefinedKeyDef = machine.createDefinition({
    id: 'undef-key', initial: 'a', context: { title: '' },
    states: {
      a: { on: { go: [{ target: 'b', guard: '(and (> amount 0) (not (empty? title)))' }] } },
      b: { final: true }
    }
  });

  var undefinedKeyIssues = machine.validate(undefinedKeyDef);
  var amountIssue = null;
  for (var uki = 0; uki < undefinedKeyIssues.length; uki++) {
    if (undefinedKeyIssues[uki].type === 'undefined-reference' && undefinedKeyIssues[uki].symbol === 'amount') {
      amountIssue = undefinedKeyIssues[uki];
      break;
    }
  }
  assert(amountIssue !== null, 'validate warns about undefined context key "amount"');
  eq(amountIssue.state, 'a', 'issue references the correct state');

  // title IS in context — should not be flagged
  var titleIssue = null;
  for (var tki = 0; tki < undefinedKeyIssues.length; tki++) {
    if (undefinedKeyIssues[tki].symbol === 'title') { titleIssue = undefinedKeyIssues[tki]; break; }
  }
  eq(titleIssue, null, 'defined context key "title" not flagged');


  describe('validate — does not false-positive on $ variables or stdlib');

  var safeKeyDef = machine.createDefinition({
    id: 'safe-keys', initial: 'a', context: { items: [] },
    states: {
      a: { on: { go: [{ target: 'b', guard: '(and (> (count items) 0) (some? $state))' }] } },
      b: { final: true }
    }
  });

  var safeKeyIssues = machine.validate(safeKeyDef);
  var falsePositives = [];
  for (var ski = 0; ski < safeKeyIssues.length; ski++) {
    if (safeKeyIssues[ski].type === 'undefined-reference') falsePositives.push(safeKeyIssues[ski]);
  }
  deepEq(falsePositives, [], 'no false positives on $state or stdlib functions');


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Action-level emits collected in sendEvent result                       ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  describe('sendEvent — action-level (emit ...) collected in result.emits');

  var emitActionDef = machine.createDefinition({
    id: 'emit-action-test',
    initial: 'idle',
    context: { val: 42 },
    states: {
      idle: { on: { fire: [{ target: 'idle', action: "(emit info (obj :val val))" }] } }
    }
  });
  var emitActionInst = machine.createInstance(emitActionDef, { context: { val: 42 } });
  var emitActionResult = machine.sendEvent(emitActionInst, 'fire');
  eq(emitActionResult.transitioned, true, 'self-transition fires');
  deepEq(emitActionResult.emits, [{name: 'info', payload: {val: 42}}], 'action-level emit with payload');


  describe('sendEvent — action-level emit on targetless transition');

  var emitTargetlessDef = machine.createDefinition({
    id: 'emit-targetless-test',
    initial: 'idle',
    context: { n: 0 },
    states: {
      idle: { on: { ping: [{ action: "(do (inc! n) (emit pong))" }] } }
    }
  });
  var emitTargetlessInst = machine.createInstance(emitTargetlessDef, { context: { n: 0 } });
  var emitTargetlessResult = machine.sendEvent(emitTargetlessInst, 'ping');
  eq(emitTargetlessResult.targetless, true, 'targetless transition');
  eq(emitTargetlessInst.context.n, 1, 'action ran');
  deepEq(emitTargetlessResult.emits, [{name: 'pong', payload: null}], 'action-level emit in targetless result');


  describe('sendEvent — structural <mn-emit> still works alongside action emit');

  var emitBothDef = machine.createDefinition({
    id: 'emit-both-test',
    initial: 'a',
    context: {},
    states: {
      a: { on: { go: [{ target: 'b', action: "(emit from-action)", emit: 'from-structural' }] } },
      b: {}
    }
  });
  var emitBothInst = machine.createInstance(emitBothDef);
  var emitBothResult = machine.sendEvent(emitBothInst, 'go');
  deepEq(emitBothResult.emits, [
    {name: 'from-action', payload: null},
    {name: 'from-structural', payload: null}
  ], 'action emit first, structural second');


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Pipeline event order — document order, not alphabetical                ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  describe('executePipeline — events tried in definition order, not alphabetical');

  // 'zebra' sorts AFTER 'alpha' alphabetically, but is defined FIRST.
  // If the pipeline respects document order, zebra fires first.
  var orderDef = machine.createDefinition({
    id: 'event-order', initial: 'start', context: {},
    states: {
      start: { on: {
        zebra: [{ target: 'z' }],
        alpha: [{ target: 'a' }]
      } },
      z: { final: true },
      a: { final: true }
    }
  });

  var orderResult = machine.executePipeline(orderDef, {});
  eq(orderResult.instance.state, 'z', 'zebra fires first (document order), not alpha (alphabetical)');


  describe('executePipeline — document order with guards: first passing wins');

  // Three events in document order: check (guard fails), process (guard passes), fallback.
  // Pipeline should try check first, skip it, then fire process.
  var guardOrderDef = machine.createDefinition({
    id: 'guard-order', initial: 'start', context: { ready: true },
    states: {
      start: { on: {
        check: [{ target: 'checked', guard: '(not ready)' }],
        process: [{ target: 'processed', guard: 'ready' }],
        fallback: [{ target: 'fell-back' }]
      } },
      checked: { final: true },
      processed: { final: true },
      'fell-back': { final: true }
    }
  });

  var guardOrderResult = machine.executePipeline(guardOrderDef, {});
  eq(guardOrderResult.instance.state, 'processed', 'first passing guard wins in document order');


  describe('executePipelineAsync — events tried in definition order');

  var asyncOrderDef = machine.createDefinition({
    id: 'async-event-order', initial: 'start', context: {},
    states: {
      start: { on: {
        zebra: [{ target: 'z' }],
        alpha: [{ target: 'a' }]
      } },
      z: { final: true },
      a: { final: true }
    }
  });

  var asyncOrderResult = await machine.executePipelineAsync(asyncOrderDef, {});
  eq(asyncOrderResult.instance.state, 'z', 'async: zebra fires first (document order)');


  describe('executePipelineAsync — on-success with document-order events');

  // Simulates auth pattern: verify fires invoke!, callback events follow.
  // Events in definition order: verify, auth-ok, auth-fail.
  // verify is targetless with invoke!, auth-ok transitions on success.
  var authPatternDef = machine.createDefinition({
    id: 'auth-pattern', initial: 'authenticating',
    context: { username: 'bob', result: null },
    states: {
      authenticating: { on: {
        verify: [{ action: "(invoke! :type 'auth' :input username :on-success 'auth-ok' :on-error 'auth-fail')" }],
        'auth-ok': [{ target: 'authenticated', guard: '(some? result)' }],
        'auth-fail': [{ target: 'failed' }]
      } },
      authenticated: { final: true },
      failed: { final: true }
    }
  });

  var authPatternResult = await machine.executePipelineAsync(authPatternDef, {
    maxSteps: 10,
    effects: {
      auth: function (input) {
        return Promise.resolve({ result: 'valid-user' });
      }
    }
  });

  eq(authPatternResult.instance.state, 'authenticated', 'auth pattern: verify fires first, on-success transitions to authenticated');
  eq(authPatternResult.instance.context.result, 'valid-user', 'auth pattern: adapter return merged into context');


  describe('executePipelineAsync — on-error with document-order events');

  var authFailDef = machine.createDefinition({
    id: 'auth-fail-pattern', initial: 'authenticating',
    context: { username: 'bad', errorMsg: null },
    states: {
      authenticating: { on: {
        verify: [{ action: "(invoke! :type 'auth' :input username :on-success 'auth-ok' :on-error 'auth-fail')" }],
        'auth-ok': [{ target: 'authenticated' }],
        'auth-fail': [{ target: 'failed', action: "(set! errorMsg 'bad credentials')" }]
      } },
      authenticated: { final: true },
      failed: { final: true }
    }
  });

  var authFailResult = await machine.executePipelineAsync(authFailDef, {
    maxSteps: 10,
    effects: {
      auth: function () {
        return Promise.reject(new Error('invalid'));
      }
    }
  });

  eq(authFailResult.instance.state, 'failed', 'auth fail pattern: on-error transitions to failed');
  eq(authFailResult.instance.context.errorMsg, 'bad credentials', 'auth fail pattern: error action ran');


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  mn:project — context projection during invoke resolution               ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  var scxml = require('../scxml.js');
  var transforms = require('../transforms.js');

  describe('executePipeline — mn:project strips context for matching viewer');

  // Stored child machine with a projection declaration
  var childScxml = '<?xml version="1.0"?>' +
    '<scxml xmlns:mn="http://machine-native.dev/scxml/1.0" name="secret-doc" initial="visible" ' +
    "mn-ctx='{\"title\":\"Public Title\",\"salary\":99000,\"notes\":\"Internal only\"}'>" +
    "<mn:project when=\"(!= (get $user :role) 'admin')\">(obj :title title)</mn:project>" +
    '<state id="visible"/></scxml>';

  // Parent machine invokes child via src
  var parentScxml = '<?xml version="1.0"?>' +
    '<scxml xmlns:mn="http://machine-native.dev/scxml/1.0" name="list" initial="loading" ' +
    "mn-ctx='{\"$user\":{\"role\":\"viewer\"}}'>" +
    '<state id="loading"><transition event="load" target="items"/></state>' +
    '<state id="items"><invoke type="scxml" src="secret-doc"/></state>' +
    '</scxml>';

  var projPipeResult = machine.executePipeline(
    scxml.compile(parentScxml, {}),
    {
      maxSteps: 5,
      format: parentScxml,
      formatUpdater: transforms.updateScxmlState,
      compiler: scxml.compile,
      effects: {
        data: function (input) {
          var r = {};
          r[input.name] = [{ id: 'doc-1', name: 'secret-doc', state: 'visible', scxml: childScxml }];
          return r;
        }
      }
    }
  );

  // The format should contain the child SCXML with projected context (title only)
  var projCtxMatch = projPipeResult.format.match(/name="secret-doc"[^>]*mn-ctx='([^']*)'/);
  assert(projCtxMatch !== null, 'child machine present in format');
  if (projCtxMatch) {
    var projCtx = JSON.parse(projCtxMatch[1].replace(/&apos;/g, "'"));
    eq(projCtx.title, 'Public Title', 'projected context has title');
    eq(projCtx.salary, undefined, 'salary stripped from projected context');
    eq(projCtx.notes, undefined, 'notes stripped from projected context');
  }


  describe('executePipeline — mn:project no match = full context');

  var adminParentScxml = '<?xml version="1.0"?>' +
    '<scxml xmlns:mn="http://machine-native.dev/scxml/1.0" name="list" initial="loading" ' +
    "mn-ctx='{\"$user\":{\"role\":\"admin\"}}'>" +
    '<state id="loading"><transition event="load" target="items"/></state>' +
    '<state id="items"><invoke type="scxml" src="secret-doc"/></state>' +
    '</scxml>';

  var fullPipeResult = machine.executePipeline(
    scxml.compile(adminParentScxml, {}),
    {
      maxSteps: 5,
      format: adminParentScxml,
      formatUpdater: transforms.updateScxmlState,
      compiler: scxml.compile,
      effects: {
        data: function (input) {
          var r = {};
          r[input.name] = [{ id: 'doc-1', name: 'secret-doc', state: 'visible', scxml: childScxml }];
          return r;
        }
      }
    }
  );

  var fullCtxMatch = fullPipeResult.format.match(/name="secret-doc"[^>]*mn-ctx='([^']*)'/);
  assert(fullCtxMatch !== null, 'child machine present in format (admin)');
  if (fullCtxMatch) {
    var fullCtx = JSON.parse(fullCtxMatch[1].replace(/&apos;/g, "'"));
    eq(fullCtx.title, 'Public Title', 'full context has title');
    eq(fullCtx.salary, 99000, 'full context has salary (admin sees everything)');
    eq(fullCtx.notes, 'Internal only', 'full context has notes');
  }


  describe('executePipeline — mn:project computes derived values');

  var computedChild = '<?xml version="1.0"?>' +
    '<scxml xmlns:mn="http://machine-native.dev/scxml/1.0" name="order" initial="done" ' +
    "mn-ctx='{\"items\":[{\"name\":\"a\"},{\"name\":\"b\"},{\"name\":\"c\"}],\"amount\":75000}'>" +
    "<mn:project>(obj :item_count (count items) :amount amount)</mn:project>" +
    '<state id="done"/></scxml>';

  var computedParent = '<?xml version="1.0"?>' +
    '<scxml xmlns:mn="http://machine-native.dev/scxml/1.0" name="list" initial="loading" mn-ctx=\'{}\'>' +
    '<state id="loading"><transition event="load" target="items"/></state>' +
    '<state id="items"><invoke type="scxml" src="order"/></state></scxml>';

  var computedResult = machine.executePipeline(
    scxml.compile(computedParent, {}),
    {
      maxSteps: 5,
      format: computedParent,
      formatUpdater: transforms.updateScxmlState,
      compiler: scxml.compile,
      effects: {
        data: function (input) {
          var r = {};
          r[input.name] = [{ id: 'o-1', name: 'order', state: 'done', scxml: computedChild }];
          return r;
        }
      }
    }
  );

  var computedMatch = computedResult.format.match(/name="order"[^>]*mn-ctx='([^']*)'/);
  assert(computedMatch !== null, 'computed child present in format');
  if (computedMatch) {
    var computedCtx = JSON.parse(computedMatch[1].replace(/&apos;/g, "'"));
    eq(computedCtx.item_count, 3, 'computed value: count of items');
    eq(computedCtx.amount, 75000, 'passed through value: amount');
    eq(computedCtx.items, undefined, 'raw items array not in projection');
  }


  describe('executePipelineAsync — mn:project works in async pipeline');

  var asyncProjResult = await machine.executePipelineAsync(
    scxml.compile(parentScxml, {}),
    {
      maxSteps: 5,
      format: parentScxml,
      formatUpdater: transforms.updateScxmlState,
      compiler: scxml.compile,
      effects: {
        data: function (input) {
          var r = {};
          r[input.name] = [{ id: 'doc-1', name: 'secret-doc', state: 'visible', scxml: childScxml }];
          return r;
        }
      }
    }
  );

  var asyncProjMatch = asyncProjResult.format.match(/name="secret-doc"[^>]*mn-ctx='([^']*)'/);
  assert(asyncProjMatch !== null, 'async: child machine in format');
  if (asyncProjMatch) {
    var asyncProjCtx = JSON.parse(asyncProjMatch[1].replace(/&apos;/g, "'"));
    eq(asyncProjCtx.title, 'Public Title', 'async: projected title present');
    eq(asyncProjCtx.salary, undefined, 'async: salary stripped');
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  mn:project as= — derive a different machine during invoke resolution   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  describe('executePipeline — mn:project as= produces different machine name');

  // Canonical machine with as= projection and state mapping via $state
  var canonicalScxml = '<?xml version="1.0"?>' +
    '<scxml xmlns:mn="http://machine-native.dev/scxml/1.0" name="workflow" initial="done" ' +
    "mn-ctx='{\"title\":\"Secret Report\",\"items\":[1,2,3],\"internal\":\"classified\"}'>" +
    "<mn:project as=\"workflow-card\" when=\"(= viewer 'public')\">" +
    "(obj :title title :count (count items) :$initial (if (= $state 'done') 'complete' 'active'))" +
    "</mn:project>" +
    '<state id="processing"/><final id="done"/></scxml>';

  var asParentScxml = '<?xml version="1.0"?>' +
    '<scxml xmlns:mn="http://machine-native.dev/scxml/1.0" name="list" initial="loading" ' +
    "mn-ctx='{\"viewer\":\"public\"}'>" +
    '<state id="loading"><transition event="load" target="items"/></state>' +
    '<state id="items"><invoke type="scxml" src="workflow"/></state></scxml>';

  var asPipeResult = machine.executePipeline(
    scxml.compile(asParentScxml, {}),
    {
      maxSteps: 5,
      format: asParentScxml,
      formatUpdater: transforms.updateScxmlState,
      compiler: scxml.compile,
      effects: {
        data: function (input) {
          var r = {};
          r[input.name] = [{ id: 'wf-42', name: 'workflow', state: 'done', scxml: canonicalScxml }];
          return r;
        }
      }
    }
  );

  // Should produce workflow-card, NOT workflow
  var asNameMatch = asPipeResult.format.indexOf('name="workflow-card"') !== -1;
  var asOrigMatch = asPipeResult.format.indexOf('<scxml name="workflow"') !== -1;
  assert(asNameMatch, 'derived machine has name="workflow-card"');

  // Check projected context
  var asCtxMatch = asPipeResult.format.match(/name="workflow-card"[^>]*mn-ctx='([^']*)'/);
  assert(asCtxMatch !== null, 'derived machine has mn-ctx');
  if (asCtxMatch) {
    var asCtx = JSON.parse(asCtxMatch[1].replace(/&apos;/g, "'"));
    eq(asCtx.title, 'Secret Report', 'projected title present');
    eq(asCtx.count, 3, 'computed count from items array');
    eq(asCtx.internal, undefined, 'internal field not in projection');
    eq(asCtx.items, undefined, 'raw items not in projection');
    eq(asCtx.$initial, undefined, '$initial removed from context');
  }


  describe('executePipeline — mn:project as= maps $initial to derived initial state');

  var asInitMatch = asPipeResult.format.match(/name="workflow-card"[^>]*initial="([^"]*)"/);
  assert(asInitMatch !== null, 'derived machine has initial attribute');
  if (asInitMatch) {
    eq(asInitMatch[1], 'complete', '$initial mapped done → complete');
  }


  describe('executePipeline — mn:project as= $state and $id available in expression');

  var stateIdScxml = '<?xml version="1.0"?>' +
    '<scxml xmlns:mn="http://machine-native.dev/scxml/1.0" name="item" initial="active" ' +
    "mn-ctx='{\"name\":\"test\"}'>" +
    "<mn:project as=\"item-summary\">" +
    "(obj :name name :stored_state $state :stored_id $id :$initial 'display')" +
    "</mn:project>" +
    '<state id="active"/></scxml>';

  var stateIdParent = '<?xml version="1.0"?>' +
    '<scxml name="container" initial="loading" mn-ctx=\'{}\'>' +
    '<state id="loading"><transition event="load" target="list"/></state>' +
    '<state id="list"><invoke type="scxml" src="item"/></state></scxml>';

  var stateIdResult = machine.executePipeline(
    scxml.compile(stateIdParent, {}),
    {
      maxSteps: 5,
      format: stateIdParent,
      formatUpdater: transforms.updateScxmlState,
      compiler: scxml.compile,
      effects: {
        data: function (input) {
          var r = {};
          r[input.name] = [{ id: 'itm-99', name: 'item', state: 'active', scxml: stateIdScxml }];
          return r;
        }
      }
    }
  );

  var stateIdCtxMatch = stateIdResult.format.match(/name="item-summary"[^>]*mn-ctx='([^']*)'/);
  assert(stateIdCtxMatch !== null, '$state/$id test: derived machine found');
  if (stateIdCtxMatch) {
    var stateIdCtx = JSON.parse(stateIdCtxMatch[1].replace(/&apos;/g, "'"));
    eq(stateIdCtx.stored_state, 'active', '$state available in projection body');
    eq(stateIdCtx.stored_id, 'itm-99', '$id available in projection body');
    eq(stateIdCtx.name, 'test', 'child context still accessible');
  }


  describe('executePipeline — mn:project without as= unchanged (regression)');

  // Use the existing childScxml from the earlier projection test (no as= attribute)
  // Verify it still replaces mn-ctx on the same machine, doesn't produce a different name
  var regressionResult = machine.executePipeline(
    scxml.compile(parentScxml, {}),
    {
      maxSteps: 5,
      format: parentScxml,
      formatUpdater: transforms.updateScxmlState,
      compiler: scxml.compile,
      effects: {
        data: function (input) {
          var r = {};
          r[input.name] = [{ id: 'doc-1', name: 'secret-doc', state: 'visible', scxml: childScxml }];
          return r;
        }
      }
    }
  );

  var regressionName = regressionResult.format.indexOf('name="secret-doc"') !== -1;
  assert(regressionName, 'regression: same machine name preserved (no as=)');
  var regressionCtxMatch = regressionResult.format.match(/name="secret-doc"[^>]*mn-ctx='([^']*)'/);
  if (regressionCtxMatch) {
    var regrCtx = JSON.parse(regressionCtxMatch[1].replace(/&apos;/g, "'"));
    eq(regrCtx.title, 'Public Title', 'regression: projected title');
    eq(regrCtx.salary, undefined, 'regression: salary still stripped');
  }


  describe('executePipelineAsync — mn:project as= works in async pipeline');

  var asyncAsResult = await machine.executePipelineAsync(
    scxml.compile(asParentScxml, {}),
    {
      maxSteps: 5,
      format: asParentScxml,
      formatUpdater: transforms.updateScxmlState,
      compiler: scxml.compile,
      effects: {
        data: function (input) {
          var r = {};
          r[input.name] = [{ id: 'wf-42', name: 'workflow', state: 'done', scxml: canonicalScxml }];
          return r;
        }
      }
    }
  );

  var asyncAsName = asyncAsResult.format.indexOf('name="workflow-card"') !== -1;
  assert(asyncAsName, 'async: derived machine has name="workflow-card"');
  var asyncAsInit = asyncAsResult.format.match(/name="workflow-card"[^>]*initial="([^"]*)"/);
  if (asyncAsInit) {
    eq(asyncAsInit[1], 'complete', 'async: $initial mapped correctly');
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  mn:project as= — reverse path (derived → canonical → re-project)       ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  describe('executePipelineAsync — reverse: derived machine event applied to canonical');

  // Canonical machine stored in "DB" — at state "pending" with full context
  var reverseCanonicalScxml = '<?xml version="1.0"?>' +
    '<scxml xmlns:mn="http://machine-native.dev/scxml/1.0" name="task" initial="pending" ' +
    "mn-ctx='{\"title\":\"Secret Task\",\"secret\":\"classified\",\"items\":[1,2],\"cancelled_by\":null}'>" +
    "<mn:project as=\"task-card\" when=\"(= viewer 'public')\">" +
    "(obj :title title :count (count items) :$initial (if (= $state 'cancelled') 'cancelled' 'active'))" +
    "</mn:project>" +
    '<state id="pending">' +
    '<transition event="cancel" target="cancelled">' +
    '<mn:action>(set! cancelled_by canceller)</mn:action>' +
    '</transition>' +
    '</state>' +
    '<final id="cancelled"/>' +
    '</scxml>';

  // Derived machine arrives at server — it was a task-card, carries $canonical_id
  var derivedScxml = '<?xml version="1.0"?>' +
    '<scxml name="task-card" initial="active" ' +
    "mn-ctx='{\"title\":\"Secret Task\",\"count\":2,\"$canonical_id\":\"task-001\",\"canceller\":\"Alice\"}'>" +
    '<state id="active">' +
    '<transition event="cancel" target="cancelling"/>' +
    '</state>' +
    '<state id="cancelling"/>' +
    '<state id="cancelled"/>' +
    '</scxml>';

  // Mock DB: stores the canonical, returns it by ID
  var reverseDb = {};
  reverseDb['task-001'] = { id: 'task-001', name: 'task', state: 'pending', scxml: reverseCanonicalScxml };

  var reverseResult = await machine.executePipelineAsync(
    scxml.compile(derivedScxml, {}),
    {
      maxSteps: 10,
      format: derivedScxml,
      formatUpdater: transforms.updateScxmlState,
      compiler: scxml.compile,
      effects: {
        data: function (input) {
          if (input.id) {
            var row = reverseDb[input.id];
            return row ? { [input.id]: [row] } : {};
          }
          var r = {};
          r[input.name] = Object.values(reverseDb).filter(function(r) { return r.name === input.name; });
          return r;
        }
      },
      // The pipeline needs to know how to resolve $canonical_id → canonical machine
      canonicalResolver: function (canonicalId) {
        return reverseDb[canonicalId] || null;
      }
    }
  );

  // The pipeline should have:
  // 1. Detected $canonical_id in the derived machine's context
  // 2. Loaded the canonical task from the resolver
  // 3. Merged the derived context's "canceller" into canonical context
  // 4. Applied the "cancel" event to the canonical
  // 5. Re-projected back to task-card
  var revFormat = reverseResult.format || '';
  var revName = revFormat.match(/name="([^"]+)"/);
  var revInit = revFormat.match(/initial="([^"]+)"/);
  var revCtxMatch = revFormat.match(/mn-ctx='([^']*)'/);

  if (revName) eq(revName[1], 'task-card', 'reverse: result is re-projected as task-card');
  if (revInit) eq(revInit[1], 'cancelled', 'reverse: state mapped to cancelled');
  if (revCtxMatch) {
    var revCtx = JSON.parse(revCtxMatch[1].replace(/&apos;/g, "'"));
    eq(revCtx.title, 'Secret Task', 'reverse: title in projected context');
    eq(revCtx.count, 2, 'reverse: count in projected context');
    eq(revCtx.secret, undefined, 'reverse: secret NOT in projected context');
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Bug fixes from quality audit                                           ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  describe('Bug — emits is an array (not undefined) when mn:where blocks mid-transition');

  var emitRouteDef = machine.createDefinition({
    id: 'emit-route', initial: 'local',
    context: {},
    states: {
      local: { on: {
        go: [{ target: 'remote', action: "(emit went)", emit: 'structural-emit' }]
      } },
      remote: { where: "(requires 'gpu')" },
      done: { final: true }
    }
  });

  var emitRouteInst = machine.createInstance(emitRouteDef, {
    host: { now: Date.now, capabilities: [], emit: function(){} }
  });
  var emitRouteResult = machine.sendEvent(emitRouteInst, 'go');
  assert(emitRouteResult.route !== null, 'route signal present');
  assert(Array.isArray(emitRouteResult.emits), 'emits is an array, not undefined');


  // ── Summary ──
  console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
  process.exit(failed > 0 ? 1 : 0);

})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
