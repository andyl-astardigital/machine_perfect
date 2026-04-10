/**
 * engine.js — deep unit tests.
 *
 * Run: node mn/tests/engine.test.js
 * Tests every public function, every stdlib function,
 * every special form, every error path.
 */

var engine = require('../engine.js');

var passed = 0;
var failed = 0;
var group = '';

function describe(name) { group = name; console.log('\n' + name); }
function assert(condition, message) {
  if (condition) { passed++; console.log('  \u2713 ' + message); }
  else { failed++; console.log('  \u2717 ' + message); }
}
function eq(actual, expected, message) {
  assert(actual === expected, message + ' (got ' + JSON.stringify(actual) + ')');
}
function deepEq(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message + ' (got ' + JSON.stringify(actual) + ')');
}
function throws(fn, substring, message) {
  try { fn(); assert(false, message + ' — did not throw'); }
  catch (err) { assert(err.message.indexOf(substring) !== -1, message); }
}
function evalExpr(expr, ctx) { return engine.eval(expr, ctx || {}, null, null); }
function execExpr(expr, ctx) { engine.exec(expr, ctx, null, null, null, null); return ctx; }


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Parser                                                                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('parse — atoms');
deepEq(engine.parse('42'), { t: '#', v: 42 }, 'number');
deepEq(engine.parse("'hello'"), { t: 'S', v: 'hello' }, 'string');
deepEq(engine.parse('true'), { t: 'B', v: true }, 'true');
deepEq(engine.parse('false'), { t: 'B', v: false }, 'false');
deepEq(engine.parse('nil'), { t: 'N', v: null }, 'nil');
deepEq(engine.parse(':name'), { t: 'K', v: 'name' }, 'keyword');
deepEq(engine.parse('foo'), { t: 'Y', v: 'foo' }, 'symbol');

describe('parse — lists');
var list = engine.parse('(+ 1 2)');
eq(list.length, 3, 'list has 3 elements');
eq(list[0].v, '+', 'head is +');
eq(list[1].v, 1, 'arg 1');
eq(list[2].v, 2, 'arg 2');

describe('parse — vectors');
var vec = engine.parse('[1 2 3]');
eq(vec.t, 'V', 'vector type');
eq(vec.v.length, 3, 'vector length');

describe('parse — nested');
var nested = engine.parse('(if (> x 0) (str x) nil)');
eq(nested.length, 4, 'if has 4 elements');
eq(nested[1].length, 3, 'condition is a list');

describe('parse — #() shorthand');
var short = engine.parse('#(> % 0)');
eq(short[0].v, 'fn', 'desugars to fn');
eq(short[1].t, 'V', 'params is vector');
eq(short[1].v[0].v, '%1', 'first param is %1 (% is bound as alias at call time)');
eq(short[1].v[1].v, '%2', 'second param is %2');

describe('parse — multiple expressions become do');
var multi = engine.parse('(inc! x) (dec! y)');
eq(multi[0].v, 'do', 'wrapped in do');
eq(multi.length, 3, 'do + 2 expressions');

describe('parse — malformed expressions throw');
throws(function () { engine.parse('(+ 1'); }, 'missing ")"', 'unclosed paren');
throws(function () { engine.parse('[1 2'); }, 'missing "]"', 'unclosed bracket');
throws(function () { engine.parse('#(> %'); }, 'missing ")"', 'unclosed #()');

describe('parse — cache');
var parsed1 = engine.parse('(+ 1 2)');
var parsed2 = engine.parse('(+ 1 2)');
assert(parsed1 === parsed2, 'same string returns cached AST');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Special forms                                                          ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('special — if');
eq(evalExpr('(if true 1 2)'), 1, 'true branch');
eq(evalExpr('(if false 1 2)'), 2, 'false branch');
eq(evalExpr('(if false 1)'), null, 'missing else returns null');

describe('special — when / unless');
eq(evalExpr('(when true 42)'), 42, 'when true');
eq(evalExpr('(when false 42)'), null, 'when false');
eq(evalExpr('(unless false 42)'), 42, 'unless false');
eq(evalExpr('(unless true 42)'), null, 'unless true');

describe('special — cond');
eq(evalExpr('(cond false 1 true 2 true 3)'), 2, 'first true branch');
eq(evalExpr('(cond false 1 false 2)'), null, 'no match returns null');

describe('special — and / or');
eq(evalExpr('(and 1 2 3)'), 3, 'and returns last truthy');
eq(evalExpr('(and 1 false 3)'), false, 'and short-circuits on false');
eq(evalExpr('(or false nil 42)'), 42, 'or returns first truthy');
eq(evalExpr('(or false nil)'), null, 'or returns last falsy');

describe('special — do');
var doCtx = { x: 0 };
execExpr('(do (inc! x) (inc! x) (inc! x))', doCtx);
eq(doCtx.x, 3, 'do runs all expressions sequentially');

describe('special — let');
eq(evalExpr('(let [x 10 y 20] (+ x y))'), 30, 'let binds and evaluates body');
eq(evalExpr('(let [x 5 y (* x 2)] y)'), 10, 'let bindings can reference previous');

describe('special — fn');
eq(evalExpr('((fn [x] (* x x)) 7)'), 49, 'lambda applied inline');

describe('special — threading');
eq(evalExpr('(-> 5 (+ 3) (* 2))'), 16, '-> threads as first arg: (* (+ 5 3) 2)');
eq(evalExpr('(->> [1 2 3 4] (filter #(> % 2)) (count))'), 2, '->> threads as last arg');

describe('special — set!');
var setCtx = { x: 0 };
execExpr('(set! x 42)', setCtx);
eq(setCtx.x, 42, 'set! mutates context');

describe('special — set! dotted path');
var dotCtx = { user: { name: 'old' } };
execExpr("(set! user.name 'new')", dotCtx);
eq(dotCtx.user.name, 'new', 'set! mutates nested path');

describe('special — inc! / dec! / toggle!');
var mutCtx = { n: 0, flag: false };
execExpr('(inc! n)', mutCtx);
eq(mutCtx.n, 1, 'inc!');
execExpr('(dec! n)', mutCtx);
eq(mutCtx.n, 0, 'dec!');
execExpr('(toggle! flag)', mutCtx);
eq(mutCtx.flag, true, 'toggle!');

describe('special — inc!/dec!/toggle! with dot-paths');
var dotMutCtx = { player: { score: 10, active: true } };
execExpr('(inc! player.score)', dotMutCtx);
eq(dotMutCtx.player.score, 11, 'inc! on dot-path');
execExpr('(dec! player.score)', dotMutCtx);
eq(dotMutCtx.player.score, 10, 'dec! on dot-path');
execExpr('(toggle! player.active)', dotMutCtx);
eq(dotMutCtx.player.active, false, 'toggle! on dot-path');

describe('special — inc!/dec!/toggle! record dirty keys');
var dirtyMutCtx = { count: 0, __mnInst: { _mnDirty: {} } };
execExpr('(inc! count)', dirtyMutCtx);
eq(dirtyMutCtx.count, 1, 'inc! mutated');
eq(dirtyMutCtx.__mnInst._mnDirty['count'], true, 'inc! recorded dirty key');
dirtyMutCtx.__mnInst._mnDirty = {};
execExpr('(dec! count)', dirtyMutCtx);
eq(dirtyMutCtx.__mnInst._mnDirty['count'], true, 'dec! recorded dirty key');
dirtyMutCtx.__mnInst._mnDirty = {};
dirtyMutCtx.flag = true;
execExpr('(toggle! flag)', dirtyMutCtx);
eq(dirtyMutCtx.__mnInst._mnDirty['flag'], true, 'toggle! recorded dirty key');

describe('special — push!');
var pushCtx = { items: [1, 2] };
execExpr('(push! items 3)', pushCtx);
deepEq(pushCtx.items, [1, 2, 3], 'push! appends');

describe('special — remove-where!');
var rmCtx = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] };
execExpr("(remove-where! items :id 2)", rmCtx);
eq(rmCtx.items.length, 2, 'remove-where! removes matching');
eq(rmCtx.items[1].id, 3, 'correct item remains');

describe('special — splice!');
var spliceCtx = { items: ['a', 'b', 'c', 'd'] };
execExpr('(splice! items 1 2)', spliceCtx);
deepEq(spliceCtx.items, ['a', 'd'], 'splice! removes by index');

describe('special — to / emit signals');
var scope = engine.makeScope({}, 'idle', null);
engine.seval(engine.parse("(to active)"), scope);
eq(scope.__mnTo, 'active', 'to sets __mnTo');
engine.seval(engine.parse("(emit saved)"), scope);
eq(scope.__mnEmit, 'saved', 'emit sets __mnEmit');
eq(scope.__mnEmitPayload, undefined, 'emit without payload sets no payload');

engine.seval(engine.parse("(emit info (obj :id 42 :name 'test'))"), scope);
eq(scope.__mnEmit, 'info', 'emit with payload sets __mnEmit');
eq(scope.__mnEmitPayload.id, 42, 'emit payload .id');
eq(scope.__mnEmitPayload.name, 'test', 'emit payload .name');

describe('emit payload — exec() returns emitPayload');
var emitResult = engine.exec("(emit saved (obj :x 99))", { x: 99 }, null, null, null, null);
eq(emitResult.emit, 'saved', 'exec returns emit name');
deepEq(emitResult.emitPayload, { x: 99 }, 'exec returns emitPayload');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Stdlib — every function                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('stdlib — math');
eq(evalExpr('(+ 2 3)'), 5, '+');
eq(evalExpr('(+ 1 2 3 4)'), 10, '+ variadic');
eq(evalExpr('(- 10 3)'), 7, '-');
eq(evalExpr('(- 5)'), -5, '- unary');
eq(evalExpr('(* 4 5)'), 20, '*');
eq(evalExpr('(/ 10 2)'), 5, '/');
eq(evalExpr('(mod 7 3)'), 1, 'mod');
eq(evalExpr('(inc 5)'), 6, 'inc');
eq(evalExpr('(dec 5)'), 4, 'dec');
eq(evalExpr('(abs -7)'), 7, 'abs');
eq(evalExpr('(min 3 1 2)'), 1, 'min');
eq(evalExpr('(max 3 1 2)'), 3, 'max');
eq(evalExpr('(round 3.7)'), 4, 'round');
eq(evalExpr('(floor 3.9)'), 3, 'floor');
eq(evalExpr('(ceil 3.1)'), 4, 'ceil');

describe('stdlib — comparison');
eq(evalExpr('(= 1 1)'), true, '= true');
eq(evalExpr('(= 1 2)'), false, '= false');
eq(evalExpr('(= [1 2] [1 2])'), true, '= arrays structural');
eq(evalExpr('(= [1 2] [1 3])'), false, '= arrays differ');
eq(evalExpr('(= (obj :a 1 :b 2) (obj :a 1 :b 2))'), true, '= objects structural');
eq(evalExpr('(= (obj :a 1) (obj :a 2))'), false, '= objects differ');
eq(evalExpr('(= nil nil)'), true, '= nil nil');
eq(evalExpr('(= [] [])'), true, '= empty arrays');
eq(evalExpr('(not= [1] [2])'), true, 'not= arrays');
eq(evalExpr('(not= [1] [1])'), false, 'not= same arrays');
eq(evalExpr('(!= 1 2)'), true, '!=');
eq(evalExpr('(> 3 2)'), true, '>');
eq(evalExpr('(< 2 3)'), true, '<');
eq(evalExpr('(>= 3 3)'), true, '>=');
eq(evalExpr('(<= 2 3)'), true, '<=');

describe('stdlib — logic');
eq(evalExpr('(not true)'), false, 'not');
eq(evalExpr('(nil? nil)'), true, 'nil? true');
eq(evalExpr('(nil? 0)'), false, 'nil? false');
eq(evalExpr('(some? 0)'), true, 'some?');
eq(evalExpr('(true? true)'), true, 'true?');
eq(evalExpr('(false? false)'), true, 'false?');
eq(evalExpr("(empty? '')"), true, 'empty? string');
eq(evalExpr('(empty? [])'), true, 'empty? array');
eq(evalExpr("(empty? 'x')"), false, 'empty? non-empty');

describe('stdlib — strings');
eq(evalExpr("(str 'a' 'b' 'c')"), 'abc', 'str');
eq(evalExpr("(str 1 nil 'x')"), '1x', 'str coerces nil to empty');
eq(evalExpr("(upper 'hello')"), 'HELLO', 'upper');
eq(evalExpr("(lower 'HELLO')"), 'hello', 'lower');
eq(evalExpr("(trim '  hi  ')"), 'hi', 'trim');
deepEq(evalExpr("(split 'a-b-c' '-')"), ['a', 'b', 'c'], 'split');
eq(evalExpr("(join [1 2 3] '-')"), '1-2-3', 'join');
eq(evalExpr("(starts? 'hello' 'he')"), true, 'starts?');
eq(evalExpr("(ends? 'hello' 'lo')"), true, 'ends?');
eq(evalExpr("(contains? 'hello world' 'world')"), true, 'contains?');
eq(evalExpr("(replace 'aXbXc' 'X' '-')"), 'a-b-c', 'replace');
eq(evalExpr("(subs 'hello' 1 3)"), 'el', 'subs');

describe('stdlib — collections');
eq(evalExpr('(count [1 2 3])'), 3, 'count array');
eq(evalExpr("(count 'abc')"), 3, 'count string');
eq(evalExpr('(first [10 20 30])'), 10, 'first');
eq(evalExpr('(last [10 20 30])'), 30, 'last');
eq(evalExpr('(nth [10 20 30] 1)'), 20, 'nth');
deepEq(evalExpr('(rest [1 2 3])'), [2, 3], 'rest');
deepEq(evalExpr('(take 2 [1 2 3 4])'), [1, 2], 'take');
deepEq(evalExpr('(drop 2 [1 2 3 4])'), [3, 4], 'drop');
deepEq(evalExpr('(concat [1 2] [3 4])'), [1, 2, 3, 4], 'concat');
deepEq(evalExpr('(reverse [1 2 3])'), [3, 2, 1], 'reverse');
eq(evalExpr('(includes? [1 2 3] 2)'), true, 'includes?');
eq(evalExpr('(index-of [10 20 30] 20)'), 1, 'index-of');
eq(evalExpr("(has-key? (obj :a 1 :b 2) :a)"), true, 'has-key? on object');
eq(evalExpr("(has-key? (obj :a 1) :z)"), false, 'has-key? missing key');
eq(evalExpr("(has-key? nil :a)"), false, 'has-key? on nil');
deepEq(evalExpr('(uniq [1 2 2 3 1])'), [1, 2, 3], 'uniq');
deepEq(evalExpr('(range 0 5)'), [0, 1, 2, 3, 4], 'range');

describe('stdlib — higher-order');
deepEq(evalExpr('(map inc [1 2 3])'), [2, 3, 4], 'map');
deepEq(evalExpr('(filter #(> % 2) [1 2 3 4])'), [3, 4], 'filter');
eq(evalExpr('(find #(> % 2) [1 2 3])'), 3, 'find');
eq(evalExpr('(every? #(> % 0) [1 2 3])'), true, 'every?');
eq(evalExpr('(some #(> % 2) [1 2 3])'), true, 'some returns first truthy predicate result (boolean pred)');
eq(evalExpr('(some #(> % 10) [1 2 3])'), null, 'some returns null when no match');
eq(evalExpr('(some #(when (> % 2) (* % 10)) [1 2 5])'), 50, 'some returns transformed value');
eq(evalExpr('(reduce + 0 [1 2 3 4])'), 10, 'reduce');
deepEq(evalExpr('(sort-by #(get % :v) [(obj :v 3) (obj :v 1) (obj :v 2)])'), [{ v: 1 }, { v: 2 }, { v: 3 }], 'sort-by');

describe('stdlib — objects');
deepEq(evalExpr("(obj :a 1 :b 2)"), { a: 1, b: 2 }, 'obj');
eq(evalExpr("(get (obj :x 42) :x)"), 42, 'get');
deepEq(evalExpr("(keys (obj :a 1 :b 2))"), ['a', 'b'], 'keys');
deepEq(evalExpr("(vals (obj :a 1 :b 2))"), [1, 2], 'vals');
deepEq(evalExpr("(assoc (obj :a 1) :b 2)"), { a: 1, b: 2 }, 'assoc');
deepEq(evalExpr("(dissoc (obj :a 1 :b 2) :b)"), { a: 1 }, 'dissoc');
deepEq(evalExpr("(merge (obj :a 1) (obj :b 2))"), { a: 1, b: 2 }, 'merge');

describe('stdlib — type');
eq(evalExpr('(type nil)'), 'nil', 'type nil');
eq(evalExpr('(type 42)'), 'number', 'type number');
eq(evalExpr("(type 'x')"), 'string', 'type string');
eq(evalExpr('(type [1])'), 'list', 'type list');
eq(evalExpr('(num 42)'), 42, 'num');
eq(evalExpr("(int '42')"), 42, 'int');
eq(evalExpr("(float '3.14')"), 3.14, 'float');
eq(evalExpr('(bool 1)'), true, 'bool');

describe('stdlib — time');
var nowBefore = Date.now();
var nowResult = evalExpr('(now)');
var nowAfter = Date.now();
assert(nowResult >= nowBefore && nowResult <= nowAfter, 'now returns timestamp within expected range');

describe('stdlib — uuid');
var id1 = evalExpr('(uuid)');
var id2 = evalExpr('(uuid)');
eq(typeof id1, 'string', 'uuid returns string');
assert(id1.length >= 18, 'uuid length >= 18 (got ' + id1.length + ')');
assert(id1 !== id2, 'uuid returns unique values (got ' + id1 + ' vs ' + id2 + ')');

describe('stdlib — date-fmt');
var ts = new Date(2026, 0, 15, 14, 30).getTime();
var formatted = evalExpr('(date-fmt ts)', { ts: ts });
eq(typeof formatted, 'string', 'date-fmt returns string');
assert(formatted.indexOf('15') !== -1, 'date-fmt contains day 15 (got ' + formatted + ')');
assert(formatted.indexOf('2026') !== -1 || formatted.indexOf('26') !== -1, 'date-fmt contains year (got ' + formatted + ')');
eq(evalExpr('(date-fmt nil)', {}), '', 'date-fmt of nil returns empty string');
eq(evalExpr('(date-fmt 0)', {}), '', 'date-fmt of 0 returns empty string');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Context vs firstClass resolution                                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('resolution — context shadows firstClass');
eq(evalExpr('count', { count: 7 }), 7, 'count as context var returns 7, not function');
eq(evalExpr('get', { get: 'value' }), 'value', 'get as context var returns value');
eq(evalExpr('str', { str: 'hello' }), 'hello', 'str as context var returns string');
eq(evalExpr('max', { max: 99 }), 99, 'max as context var returns 99');

describe('resolution — firstClass still works as function in head position');
eq(evalExpr('(count [1 2 3])'), 3, 'count still works as function');
eq(evalExpr('(+ 1 2)'), 3, '+ still works as function');

describe('resolution — firstClass used as value when not in context');
eq(evalExpr('(reduce + 0 [1 2 3])'), 6, '+ as value for reduce');
deepEq(evalExpr('(map inc [1 2])'), [2, 3], 'inc as first-class value for map');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Purity enforcement                                                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('purity — eval rejects mutations');
throws(function () { evalExpr('(set! x 1)', { x: 0 }); }, 'not allowed', 'set! in eval throws');
throws(function () { evalExpr('(inc! x)', { x: 0 }); }, 'not allowed', 'inc! in eval throws');
throws(function () { evalExpr('(toggle! x)', { x: false }); }, 'not allowed', 'toggle! in eval throws');
throws(function () { evalExpr('(do (set! x 1) x)', { x: 0 }); }, 'not allowed', 'nested set! in eval throws');

describe('purity — exec allows mutations');
var pureCtx = { x: 0 };
execExpr('(set! x 42)', pureCtx);
eq(pureCtx.x, 42, 'set! in exec works');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Dependency tracking                                                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('deps — tracks simple reads');
engine.startTracking();
evalExpr('(str name age)', { name: 'A', age: 30 });
var deps = engine.stopTracking();
eq(deps.name, true, 'tracks name');
eq(deps.age, true, 'tracks age');

describe('deps — tracks dotted paths');
engine.startTracking();
evalExpr('$store.user.name', { $store: { user: { name: 'A' } } });
var deps2 = engine.stopTracking();
eq(deps2['$store.user'], true, '$store.user tracked at store level');

describe('deps — depKey normalisation');
eq(engine.depKey('name'), 'name', 'simple key unchanged');
eq(engine.depKey('user.name'), 'user', 'dotted path → root');
eq(engine.depKey('$store.filters.country'), '$store.filters', '$store path → two segments');
eq(engine.depKey('$store.resorts'), '$store.resorts', '$store without sub → full path');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Path utilities                                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('get — paths');
eq(engine.get({ a: { b: { c: 42 } } }, 'a.b.c'), 42, 'nested get');
eq(engine.get({ a: 1 }, 'b.c'), null, 'missing path returns null');
eq(engine.get(null, 'a'), null, 'null object returns null');

describe('set — paths');
var setObj = {};
engine.set(setObj, 'a.b.c', 42);
eq(setObj.a.b.c, 42, 'creates nested structure');

describe('set — prototype pollution blocked');
var target = {};
engine.set(target, '__proto__.polluted', true);
assert(!({}).polluted, '__proto__ path rejected');
engine.set(target, 'constructor.prototype.polluted', true);
assert(!({}).polluted, 'constructor.prototype path rejected');

describe('assoc! — prototype pollution blocked');
var assocTarget = { obj: {} };
execExpr("(assoc! obj '__proto__' 'hacked')", assocTarget);
eq(({}).hacked, undefined, 'assoc! rejects __proto__ — Object.prototype clean');
execExpr("(assoc! obj 'constructor' 'bad')", assocTarget);
eq(typeof assocTarget.obj.constructor, 'function', 'assoc! rejects constructor — still a function');
execExpr("(assoc! obj 'prototype' 'bad')", assocTarget);
eq(assocTarget.obj.prototype, undefined, 'assoc! rejects prototype');
execExpr("(assoc! obj 'safe' 42)", assocTarget);
eq(assocTarget.obj.safe, 42, 'assoc! allows safe keys');

describe('mutation forms — prototype pollution blocked on simple keys');
var ppCtx = { safe: 0 };
execExpr("(set! __proto__ 'hacked')", ppCtx);
eq(({}).hacked, undefined, 'set! rejects __proto__ — Object.prototype clean');
execExpr("(set! constructor 'hacked')", ppCtx);
eq(typeof ppCtx.constructor, 'function', 'set! rejects constructor — still a function');
execExpr("(inc! __proto__)", ppCtx);
eq(({}).hacked, undefined, 'inc! rejects __proto__ — Object.prototype clean');
execExpr("(dec! __proto__)", ppCtx);
eq(({}).hacked, undefined, 'dec! rejects __proto__ — Object.prototype clean');
execExpr("(toggle! __proto__)", ppCtx);
eq(({}).hacked, undefined, 'toggle! rejects __proto__ — Object.prototype clean');
execExpr("(swap! __proto__ inc)", ppCtx);
eq(({}).hacked, undefined, 'swap! rejects __proto__ — Object.prototype clean');
execExpr("(set! safe 42)", ppCtx);
eq(ppCtx.safe, 42, 'set! allows safe keys');
execExpr("(inc! safe)", ppCtx);
eq(ppCtx.safe, 43, 'inc! allows safe keys');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  User functions                                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('fn — registration and use');
engine.fn('triple', function (x) { return x * 3; });
eq(evalExpr('(triple 7)'), 21, 'user function works');

describe('fn — context variable shadows user function');
eq(evalExpr('triple', { triple: 'shadowed' }), 'shadowed', 'context wins over user fn');
eq(evalExpr('(triple 5)'), 15, 'but user fn still works in head position');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Depth limit                                                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('depth — recursion limit');
var deep = '1';
for (var i = 0; i < 600; i++) deep = '(+ ' + deep + ' 1)';
throws(function () { evalExpr(deep); }, 'deeply nested', 'throws on excessive nesting');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Debug mode                                                             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('debug — warns on undefined variable');
var warnings = [];
var origWarn = console.warn;
console.warn = function () { warnings.push(Array.prototype.slice.call(arguments).join(' ')); };
engine.debug = true;
evalExpr('nonexistent', {});
engine.debug = false;
console.warn = origWarn;
eq(warnings.length, 1, 'exactly one warning for undefined var');
eq(warnings[0], '[mn-debug] undefined variable "nonexistent"', 'warning message is exact');

describe('debug — no warning when variable exists');
warnings = [];
console.warn = function () { warnings.push(Array.prototype.slice.call(arguments).join(' ')); };
engine.debug = true;
evalExpr('x', { x: 1 });
engine.debug = false;
console.warn = origWarn;
eq(warnings.filter(function (w) { return w.indexOf('mn-debug') !== -1; }).length, 0, 'no warning for defined var');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Bug fixes — hand-computed regression tests                             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('fix — let with multiple body expressions (implicit do)');
eq(evalExpr('(let [x 1] (+ x 1) (+ x 2))'), 3, 'let evaluates last body expression');
eq(evalExpr('(let [x 10] x)'), 10, 'let single body still works');

describe('fix — fn with multiple body expressions (implicit do)');
eq(evalExpr('((fn [x] (+ x 1) (+ x 10)) 5)'), 15, 'fn evaluates last body expression');

describe('fix — when with multiple body expressions (implicit do)');
eq(evalExpr('(when true 1 2 3)'), 3, 'when evaluates last body expression');
eq(evalExpr('(when false 1 2 3)'), null, 'when false returns nil');

describe('fix — (and) with zero args returns true');
eq(evalExpr('(and)'), true, '(and) → true');

describe('fix — (or) with zero args returns false');
eq(evalExpr('(or)'), false, '(or) → false');

describe('fix — (or) with all falsy returns last value');
eq(evalExpr('(or false nil)'), null, '(or false nil) → nil');

describe('fix — range single-arg');
deepEq(evalExpr('(range 5)'), [0,1,2,3,4], '(range 5) → [0..4]');
deepEq(evalExpr('(range 0)'), [], '(range 0) → []');
deepEq(evalExpr('(range 2 5)'), [2,3,4], '(range 2 5) → [2..4]');

describe('fix — subtract is variadic');
eq(evalExpr('(- 10 3 2)'), 5, '(- 10 3 2) → 5');
eq(evalExpr('(- 10 3 2 1)'), 4, '(- 10 3 2 1) → 4');
eq(evalExpr('(- 5)'), -5, '(- 5) → -5 (unary)');

describe('fix — divide is variadic');
eq(evalExpr('(/ 100 5 4)'), 5, '(/ 100 5 4) → 5');
eq(evalExpr('(/ 100 5)'), 20, '(/ 100 5) → 20');

describe('fix — empty? does not treat 0 and false as empty');
eq(evalExpr('(empty? 0)'), false, '(empty? 0) → false (number is not empty)');
eq(evalExpr('(empty? false)'), false, '(empty? false) → false (boolean is not empty)');
eq(evalExpr('(empty? "")'), true, '(empty? "") → true');
eq(evalExpr('(empty? [])'), true, '(empty? []) → true');
eq(evalExpr('(empty? nil)'), true, '(empty? nil) → true');
eq(evalExpr("(empty? 'hello')"), false, "(empty? 'hello') → false");
eq(evalExpr('(empty? [1 2])'), false, '(empty? [1 2]) → false');

describe('fix — unterminated string throws');
throws(function () { evalExpr("(str 'hello)"); }, 'unterminated', 'unterminated string throws');

describe('fix — assoc is variadic');
deepEq(evalExpr('(assoc (obj :a 1) :b 2 :c 3)'), {a:1,b:2,c:3}, '(assoc m :b 2 :c 3)');

describe('fix — dissoc is variadic');
deepEq(evalExpr('(dissoc (obj :a 1 :b 2 :c 3) :b :c)'), {a:1}, '(dissoc m :b :c)');

describe('fix — concat is variadic');
deepEq(evalExpr('(concat [1] [2] [3])'), [1,2,3], '(concat [1] [2] [3])');

describe('fix — inc!/dec!/toggle! record dirty keys');
var dirtyCtx = { n: 5, flag: true, __mnInst: { _mnDirty: null } };
engine.exec('(inc! n)', dirtyCtx, null, null, null, { _mnDirty: null });
// inc! should have recorded dirty key — check ctx was mutated
eq(dirtyCtx.n, 6, 'inc! mutated value');

describe('fix — sevalPure catches mutations inside let');
throws(function () { evalExpr('(let [x 1] (set! x 2))', { x: 0 }); }, 'not allowed', 'set! inside let blocked in pure eval');

describe('fix — sevalPure catches mutations inside fn body');
throws(function () { evalExpr('(let [f (fn [x] (set! x 2))] (f 1))', { x: 0 }); }, 'not allowed', 'set! inside fn blocked in pure eval');

describe('fix — requires warns on non-string args');
var reqWarnings = [];
var origW = console.warn;
console.warn = function () { reqWarnings.push(Array.prototype.slice.call(arguments).join(' ')); };
evalExpr('(requires persist)', { persist: undefined });
console.warn = origW;
eq(reqWarnings.length, 1, 'requires with unquoted symbol warns exactly once');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Stdlib additions                                                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('stdlib — identity');
eq(evalExpr('(identity 42)'), 42, 'identity returns its argument');
eq(evalExpr('(identity nil)'), null, 'identity nil');

describe('stdlib — not=');
eq(evalExpr('(not= 1 2)'), true, '(not= 1 2) → true');
eq(evalExpr('(not= 1 1)'), false, '(not= 1 1) → false');

describe('stdlib — distinct (alias for uniq)');
deepEq(evalExpr('(distinct [1 2 2 3 3])'), [1,2,3], 'distinct removes duplicates');

describe('stdlib — mapcat (alias for flat-map)');
deepEq(evalExpr('(mapcat #(list % %) [1 2 3])'), [1,1,2,2,3,3], 'mapcat flattens');

describe('stdlib — get-in');
eq(evalExpr('(get-in (obj :a (obj :b 42)) [:a :b])'), 42, 'get-in nested');
eq(evalExpr('(get-in (obj :a 1) [:x :y])'), null, 'get-in missing returns nil');

describe('stdlib — update');
deepEq(evalExpr('(update (obj :n 5) :n inc)'), {n:6}, 'update applies fn to key');

describe('stdlib — apply');
eq(evalExpr('(apply + [1 2 3])'), 6, 'apply + over list');
eq(evalExpr("(apply str ['a' 'b' 'c'])"), 'abc', 'apply str over list');


describe('stdlib — conj');
deepEq(evalExpr('(conj [1 2] 3)'), [1, 2, 3], 'conj appends');
deepEq(evalExpr('(conj [] 1)'), [1], 'conj to empty');

describe('stdlib — type predicates');
eq(evalExpr('(number? 42)'), true, 'number? true');
eq(evalExpr("(number? 'x')"), false, 'number? false');
eq(evalExpr("(string? 'x')"), true, 'string? true');
eq(evalExpr('(string? 42)'), false, 'string? false');
eq(evalExpr('(map? (obj :a 1))'), true, 'map? true');
eq(evalExpr('(map? [1])'), false, 'map? false on array');
eq(evalExpr('(coll? [1 2])'), true, 'coll? true for array');
eq(evalExpr('(coll? 42)'), false, 'coll? false');
eq(evalExpr('(fn? inc)'), true, 'fn? true');
eq(evalExpr('(fn? 42)'), false, 'fn? false');
eq(evalExpr('(boolean? true)'), true, 'boolean? true');
eq(evalExpr('(boolean? 0)'), false, 'boolean? false');

describe('stdlib — keywords as functions in HOFs');
deepEq(evalExpr("(map :name [(obj :name 'a') (obj :name 'b')])"), ['a', 'b'], 'map :keyword');
deepEq(evalExpr("(filter :active [(obj :active true :n 1) (obj :active false :n 2)])"), [{ active: true, n: 1 }], 'filter :keyword');
deepEq(evalExpr("(find :done [(obj :done false) (obj :done true)])"), { done: true }, 'find :keyword');
deepEq(evalExpr("(sort-by :v [(obj :v 3) (obj :v 1) (obj :v 2)])"), [{ v: 1 }, { v: 2 }, { v: 3 }], 'sort-by :keyword');
eq(evalExpr("(every? :ok [(obj :ok true) (obj :ok true)])"), true, 'every? :keyword');
eq(evalExpr("(some :val [(obj :val nil) (obj :val 5)])"), 5, 'some :keyword');

describe('stdlib — group-by');
deepEq(evalExpr("(group-by :cat [(obj :cat 'a' :v 1) (obj :cat 'b' :v 2) (obj :cat 'a' :v 3)])"),
  { a: [{ cat: 'a', v: 1 }, { cat: 'a', v: 3 }], b: [{ cat: 'b', v: 2 }] }, 'group-by :keyword');

describe('stdlib — assoc-in / update-in');
deepEq(evalExpr("(assoc-in (obj :a (obj :b 1)) [:a :b] 99)"), { a: { b: 99 } }, 'assoc-in nested');
deepEq(evalExpr("(assoc-in (obj) [:a :b :c] 1)"), { a: { b: { c: 1 } } }, 'assoc-in creates path');
deepEq(evalExpr("(update-in (obj :a (obj :b 1)) [:a :b] inc)"), { a: { b: 2 } }, 'update-in nested');

describe('stdlib — comp / partial');
eq(evalExpr('((comp inc inc) 0)'), 2, 'comp chains');
eq(evalExpr('((partial + 10) 5)'), 15, 'partial applies');

describe('mutation — swap!');
var swapCtx = { count: 5, items: [1, 2], __mnInst: { _mnDirty: {} } };
engine.exec("(swap! count inc)", swapCtx, 'test', null, null, swapCtx.__mnInst);
eq(swapCtx.count, 6, 'swap! applies inc to count');
eq(swapCtx.__mnInst._mnDirty.count, true, 'swap! marks dirty');
swapCtx.__mnInst._mnDirty = {};
engine.exec("(swap! items conj 3)", swapCtx, 'test', null, null, swapCtx.__mnInst);
deepEq(swapCtx.items, [1, 2, 3], 'swap! with conj appends');
eq(swapCtx.__mnInst._mnDirty.items, true, 'swap! conj marks dirty');

describe('mutation — dirty tracking');
var dirtyInst = { _mnDirty: {} };
var dirtyCtx = { items: [1, 2], tags: [{id:1},{id:2}], arr: [10,20,30], __mnInst: dirtyInst };
engine.exec("(push! items 3)", dirtyCtx, 'test', null, null, dirtyInst);
eq(dirtyInst._mnDirty.items, true, 'push! marks dirty');
dirtyInst._mnDirty = {};
engine.exec("(remove-where! tags :id 1)", dirtyCtx, 'test', null, null, dirtyInst);
eq(dirtyInst._mnDirty.tags, true, 'remove-where! marks dirty');
dirtyInst._mnDirty = {};
engine.exec("(splice! arr 0 1)", dirtyCtx, 'test', null, null, dirtyInst);
eq(dirtyInst._mnDirty.arr, true, 'splice! marks dirty');

describe('special — in-state?');
var isCtx1 = { $state: 'running.filling' };
eq(engine.eval("(in-state? 'running')", isCtx1, 'running.filling', null), true, 'in-state? matches compound ancestor');
eq(engine.eval("(in-state? 'running.filling')", isCtx1, 'running.filling', null), true, 'in-state? matches exact');
eq(engine.eval("(in-state? 'idle')", isCtx1, 'running.filling', null), false, 'in-state? rejects non-ancestor');
eq(engine.eval("(in-state? 'run')", isCtx1, 'running.filling', null), false, 'in-state? rejects partial prefix');
var isCtx2 = { $state: 'editing.name' };
eq(engine.eval("(in-state? 'edit')", isCtx2, 'editing.name', null), false, 'in-state? rejects edit when in editing.name');

describe('stdlib — select-keys');
deepEq(evalExpr("(select-keys (obj :a 1 :b 2 :c 3) [:a :c])"), { a: 1, c: 3 }, 'select-keys picks specified keys');
deepEq(evalExpr("(select-keys (obj :a 1) [:a :z])"), { a: 1 }, 'select-keys ignores missing keys');
deepEq(evalExpr("(select-keys (obj :a 1 :b 2) [])"), {}, 'select-keys with empty key list');

describe('stdlib — zipmap');
deepEq(evalExpr("(zipmap [:a :b :c] [1 2 3])"), { a: 1, b: 2, c: 3 }, 'zipmap creates object from keys and vals');
deepEq(evalExpr("(zipmap [:a :b] [1])"), { a: 1, b: null }, 'zipmap with fewer vals than keys');
deepEq(evalExpr("(zipmap [] [])"), {}, 'zipmap empty');

describe('stdlib — polymorphic conj');
deepEq(evalExpr("(conj [1 2] 3)"), [1, 2, 3], 'conj array appends');
deepEq(evalExpr("(conj (obj :a 1) [:b 2])"), { a: 1, b: 2 }, 'conj object adds key-value pair');
deepEq(evalExpr("(conj (obj) [:x 99])"), { x: 99 }, 'conj empty object');

describe('stdlib — variadic comparisons');
eq(evalExpr('(= 1 1 1)'), true, '= variadic all equal');
eq(evalExpr('(= 1 1 2)'), false, '= variadic not all equal');
eq(evalExpr('(< 1 2 3)'), true, '< variadic ascending');
eq(evalExpr('(< 1 3 2)'), false, '< variadic not ascending');
eq(evalExpr('(> 3 2 1)'), true, '> variadic descending');
eq(evalExpr('(> 3 1 2)'), false, '> variadic not descending');
eq(evalExpr('(<= 1 1 2)'), true, '<= variadic non-descending');
eq(evalExpr('(>= 3 3 1)'), true, '>= variadic non-ascending');

describe('stdlib — hasOwnProperty guards');
var protoObj = Object.create({ inherited: true });
protoObj.own = 1;
var mergeResult = engine.eval("(merge a (obj :added 2))", { a: protoObj }, null, null);
eq(mergeResult.own, 1, 'merge copies own property');
eq(mergeResult.added, 2, 'merge copies second object');
eq(mergeResult.inherited, undefined, 'merge does not copy inherited property');
var assocInResult = engine.eval("(assoc-in a [:x] 5)", { a: protoObj }, null, null);
eq(assocInResult.own, 1, 'assoc-in preserves own property');
eq(assocInResult.x, 5, 'assoc-in sets new key');
eq(assocInResult.inherited, undefined, 'assoc-in does not copy inherited property');

describe('stdlib — aliases');
deepEq(evalExpr("(starts-with? 'hello' 'he')"), true, 'starts-with? alias');
deepEq(evalExpr("(ends-with? 'hello' 'lo')"), true, 'ends-with? alias');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Bug fixes                                                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('#() lambda shorthand — body IS the s-expression');
eq(evalExpr('(#(%) 42)'), 42, '#(x) single atom returns x');
eq(evalExpr('(#(+ % 1) 5)'), 6, '#(fn arg...) body is the function call expression');
eq(evalExpr('(#(> % 2) 5)'), true, '#() predicate: (> 5 2)');
deepEq(evalExpr('(map #(+ % 10) [1 2 3])'), [11, 12, 13], '#() works in map');

describe('Bug 2 — parseCache prototype collision');
eq(engine.parse('constructor').t, 'Y', 'parse "constructor" returns symbol node, not Object.constructor');
eq(engine.parse('toString').t, 'Y', 'parse "toString" returns symbol node');
eq(engine.parse('valueOf').t, 'Y', 'parse "valueOf" returns symbol node');

describe('Bug 3 — mutationForms completeness');
throws(function () { evalExpr('(then! nil)'); }, 'mutation', 'then! blocked in pure eval');
throws(function () { evalExpr('(focus! nil)'); }, 'mutation', 'focus! blocked in pure eval');
throws(function () { evalExpr('(prevent! nil)'); }, 'mutation', 'prevent! blocked in pure eval');
throws(function () { evalExpr('(stop! nil)'); }, 'mutation', 'stop! blocked in pure eval');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Quality check — new bugs                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('M1 — first/last/nth/find return null not undefined for empty/no-match');
eq(evalExpr('(first [])'), null, '(first []) → nil');
eq(evalExpr('(last [])'), null, '(last []) → nil');
eq(evalExpr('(nth [] 0)'), null, '(nth [] 0) → nil');
eq(evalExpr('(find #(> % 10) [1 2 3])'), null, '(find …) no match → nil');
eq(evalExpr('(= (first []) nil)'), true, '(= (first []) nil) → true');

describe('M2 — ends-with? does not crash on nil needle');
eq(evalExpr("(ends-with? 'hello' nil)"), false, "(ends-with? 'hello' nil) → false");
eq(evalExpr("(ends-with? nil nil)"), false, "(ends-with? nil nil) → false");

describe('M3 — distinct does not crash on nil input');
deepEq(evalExpr('(distinct nil)'), [], '(distinct nil) → []');
deepEq(evalExpr('(distinct [])'), [], '(distinct []) → []');

describe('M4 — bare-symbol lookup returns null for undefined keys');
eq(evalExpr('undefinedVar', {}), null, 'undefined bare symbol → nil');
eq(evalExpr('$item', {}), null, '$item not in ctx → nil');

describe('M9 — to and emit blocked in pure eval (guard context)');
throws(function () { evalExpr('(to someState)', {}); }, 'mutation', 'to blocked in pure eval');
throws(function () { evalExpr('(emit someEvent)', {}); }, 'mutation', 'emit blocked in pure eval');

describe('L1 — #() shorthand supports %1 and %2 for multi-arg lambdas');
eq(evalExpr('(#(%1) 42)'), 42, '#(%1) → first arg');
eq(evalExpr('(reduce #(+ %1 %2) 0 [1 2 3])'), 6, '#(%1 %2) → two-arg reduce');
eq(evalExpr('(#(%) 42)'), 42, '#(%) still works (backward compat)');

describe('L2 — division and mod by zero');
throws(function () { evalExpr('(/ 5 0)'); }, 'zero', '(/ 5 0) throws');
throws(function () { evalExpr('(mod 5 0)'); }, 'zero', '(mod 5 0) throws');


describe('H1 — missing dotted path returns null, not undefined');
// get() returns undefined for missing paths; seval passes it through.
// Arithmetic like (+ user.score 10) then produces NaN instead of erroring cleanly.
// All missing-path lookups must return null, consistent with bare-symbol behaviour.
eq(evalExpr('user.score', {}), null, 'missing dotted path in empty ctx returns null');
eq(evalExpr('user.score', { user: {} }), null, 'missing nested key returns null');
eq(evalExpr('(some? user.score)', { user: {} }), false, 'missing nested key is nil? false');


describe('H2 — index-of returns null (not -1) when item not found');
// -1 is truthy in JS. (if (index-of lst 99) "found" "not found") would wrongly return
// "found" when 99 is absent. Must return null to match nil-for-not-found convention.
eq(evalExpr('(index-of [1 2 3] 99)'), null, 'index-of not-found returns null');
eq(evalExpr('(if (index-of [1 2 3] 99) true false)'), false, 'index-of null is falsy in conditionals');
eq(evalExpr('(index-of [1 2 3] 2)'), 1, 'index-of found still returns correct index');


describe('get — missing key returns null, not undefined');
eq(evalExpr('(get (obj :a 1) :missing)'), null, 'get missing key returns null');
eq(evalExpr('(= (get (obj :a 1) :missing) nil)'), true, 'get missing key equals nil');
eq(evalExpr('(nil? (get (obj :a 1) :missing))'), true, 'get missing key is nil?');

describe('zipmap — missing values are null, not undefined');
deepEq(evalExpr("(zipmap [:a :b] [1])"), { a: 1, b: null }, 'zipmap with fewer vals: missing val is null');
eq(evalExpr('(= (get (zipmap [:a :b] [1]) :b) nil)'), true, 'zipmap missing val equals nil');

describe('in-state? — null input returns false, not crash');
eq(evalExpr('(in-state? undefinedVar)', { $state: 'active' }), false, 'in-state? with undefined var returns false');

describe('evalExpr — empty/null input returns null, not undefined');
eq(evalExpr('', {}), null, 'empty string returns null');
eq(evalExpr(null, {}), null, 'null returns null');
eq(evalExpr(undefined, {}), null, 'undefined returns null');

describe('L5 — parse cache uses `str in parseCache` for explicit presence check');
// Object.create(null) prevents prototype pollution, but `if (parseCache[str])` would
// still miss falsy values (impossible with AST nodes, but wrong idiom).
// Verify the cache is hit correctly for any expression.
var p1 = engine.parse('(+ 1 2)');
var p2 = engine.parse('(+ 1 2)');
assert(p1 === p2, 'parse cache returns same object reference (cache hit confirmed)');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Summary                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
process.exit(failed > 0 ? 1 : 0);
