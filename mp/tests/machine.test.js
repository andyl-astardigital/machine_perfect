/**
 * machine.js — deep unit tests.
 *
 * Run: node mp/tests/machine.test.js
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
deepEq(def.stateNames, ['off', 'on'], 'collects state names');

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
deepEq(Object.keys(batchDef._stateTree).sort(), ['aborted', 'idle', 'running', 'running.done', 'running.filling', 'running.heating'].sort(), 'stateTree has all 6 states');
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
deepEq(hotResult.emits, ['done.state.running'], 'done.state.running emitted on final child entry');


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
deepEq(er.emits, ['moved'], 'emitted event name in result');

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
  id: 'good-guard',
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

describe('validate — mp-after target does not exist');
var badAfterDef = machine.createDefinition({
  id: 'bad-after',
  states: {
    a: { after: { ms: 1000, target: 'nonexistent' } },
    b: { final: true }
  }
});
var badAfterIssues = machine.validate(badAfterDef);
assert(badAfterIssues.some(function (i) { return i.type === 'invalid-target' && i.state === 'a'; }), 'flags invalid mp-after target');


describe('validate — mp-after ms must be positive');
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
// ║  mp-where — distributed transition routing                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('mp-where — transition with where returns route signal');

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
assert(whereResult.route !== null && whereResult.route !== undefined, 'has route signal');
deepEq(whereResult.route.requires, ['log'], 'route requires log capability');
eq(whereResult.route.event, 'submit', 'route carries the event name');
eq(whereResult.route.target, 'submitted', 'route carries the target state');
eq(whereResult.route.guard, '(> amount 0)', 'route carries the guard');
eq(whereResult.route.action, '(set! title (str title " — submitted"))', 'route carries the action');


describe('mp-where — guard still evaluates locally before routing');

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


describe('mp-where — transition without where executes locally as normal');

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


describe('mp-where — requires multiple capabilities');

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


describe('mp-where — host with matching capabilities executes locally');

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


describe('mp-where — host missing one capability still routes');

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
deepEq(doneResult.emits, ['done.state.complete'], 'emits exactly done.state.complete on final entry');

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


describe('mp-where — initial state with where returns route on createInstance');
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
machine.watch(watchInst, function (key, oldVal, newVal, state) {
  watchLog.push({ key: key, old: oldVal, new: newVal, state: state });
});
machine.sendEvent(watchInst, 'inc');
eq(watchLog.length, 1, 'watcher called once');
eq(watchLog[0].key, 'count', 'watcher reports changed key');
eq(watchLog[0].old, 0, 'watcher reports old value');
eq(watchLog[0].new, 1, 'watcher reports new value');
eq(watchLog[0].state, 'b', 'watcher reports target state');

// Unwatch
machine.unwatch(watchInst, watchLog);
machine.sendEvent(watchInst, 'dec');
eq(watchLog.length, 1, 'no call after unwatch');


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
assert(routeResult.route !== null && routeResult.route !== undefined, 'route signal present');
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
// ║  Summary                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
process.exit(failed > 0 ? 1 : 0);
