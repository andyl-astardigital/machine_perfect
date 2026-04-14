#!/usr/bin/env node
/**
 * machine_native REPL — interactive s-expression evaluator and machine inspector.
 *
 * Evaluates s-expressions against the shared engine. Loads SCXML machines,
 * inspects definitions, runs pipelines through real adapters, tests projections.
 *
 * Usage:
 *   node mn/repl.js                           (standalone expression evaluator)
 *   node mn/repl.js --app examples/purchase-order  (connected to an app's adapters)
 *
 * Commands:
 *   :load <file.scxml>      Load and compile a machine definition
 *   :inspect                 Show current machine states, transitions, guards
 *   :pipeline <context-json> Run the loaded machine through executePipelineAsync
 *   :project <context-json>  Evaluate mn:project against the loaded machine
 *   :states                  List all states in the loaded machine
 *   :ctx                     Show pipeline result context
 *   :history                 Show pipeline transition history
 *   :reset                   Clear the loaded machine
 *   :help                    Show this help
 *   :quit                    Exit
 *
 * Bare s-expressions evaluate against the current context (or an empty one).
 *
 * @version 0.8.0
 */

var readline = require('readline');
var path = require('path');
var fs = require('fs');
var engine = require('./engine');
var machine = require('./machine');
var scxml = require('./scxml');
var transforms = require('./transforms');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  State                                                                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

var loadedDef = null;
var loadedFile = null;
var lastResult = null;
var evalContext = {};
var appPath = null;
var services = null;


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  App connection                                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// --app flag: load the app's services.js for pipeline execution with real adapters

var args = process.argv.slice(2);
for (var i = 0; i < args.length; i++) {
  if (args[i] === '--app' && args[i + 1]) {
    appPath = path.resolve(args[i + 1]);
    try {
      services = require(path.join(appPath, 'services'));
      console.log('  connected to ' + appPath);
      console.log('  capabilities: ' + (services.capabilities || []).join(', '));
    } catch (e) {
      console.log('  could not load services from ' + appPath + ': ' + e.message);
    }
  }
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Formatting                                                             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

var CYAN = '\x1b[36m';
var GREEN = '\x1b[32m';
var YELLOW = '\x1b[33m';
var RED = '\x1b[31m';
var DIM = '\x1b[2m';
var BOLD = '\x1b[1m';
var RESET = '\x1b[0m';

function dim(s) { return DIM + s + RESET; }
function cyan(s) { return CYAN + s + RESET; }
function green(s) { return GREEN + s + RESET; }
function yellow(s) { return YELLOW + s + RESET; }
function red(s) { return RED + s + RESET; }
function bold(s) { return BOLD + s + RESET; }

function formatValue(val) {
  if (val === null || val === undefined) return dim('nil');
  if (typeof val === 'string') return green('"' + val + '"');
  if (typeof val === 'number') return cyan(String(val));
  if (typeof val === 'boolean') return yellow(String(val));
  if (Array.isArray(val)) return JSON.stringify(val, null, 2);
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Commands                                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

function doLoad(arg) {
  var filePath = arg.trim();
  if (!filePath) { console.log(red('  usage: :load <file.scxml>')); return; }

  // Resolve relative to app path or cwd
  var resolved = filePath;
  if (appPath && !path.isAbsolute(filePath)) {
    var appFile = path.join(appPath, 'machines', filePath);
    if (fs.existsSync(appFile)) resolved = appFile;
    else resolved = path.resolve(filePath);
  } else {
    resolved = path.resolve(filePath);
  }

  try {
    var raw = fs.readFileSync(resolved, 'utf8');
    loadedDef = scxml.compile(raw, {});
    loadedFile = path.basename(resolved);
    evalContext = JSON.parse(JSON.stringify(loadedDef.context || {}));
    console.log(green('  loaded ') + bold(loadedDef.id) + dim(' (' + loadedDef.stateNames.length + ' states)'));
  } catch (e) {
    console.log(red('  error: ') + e.message);
  }
}

function doInspect() {
  if (!loadedDef) { console.log(dim('  no machine loaded. use :load <file.scxml>')); return; }

  console.log(bold('  ' + loadedDef.id));
  console.log(dim('  initial: ') + cyan(loadedDef.initial));
  console.log('');

  var tree = loadedDef._stateTree;
  for (var sn in tree) {
    if (sn === 'error' && tree[sn].spec.final && !loadedDef.states[sn]) continue; // skip implicit error
    var spec = tree[sn].spec;
    var label = spec.final ? dim(' (final)') : '';
    var where = spec.where ? yellow(' mn:where=' + spec.where) : '';
    console.log('  ' + (sn === loadedDef.initial ? bold('● ' + sn) : '  ' + sn) + label + where);

    if (spec.on) {
      for (var ev in spec.on) {
        if (ev.charAt(0) === '_') continue;
        var transitions = spec.on[ev];
        for (var ti = 0; ti < transitions.length; ti++) {
          var t = transitions[ti];
          var target = t.target ? ' → ' + cyan(t.target) : dim(' (self)');
          var guard = t.guard ? yellow(' when ' + t.guard) : '';
          console.log(dim('    ') + ev + target + guard);
        }
      }
    }
  }

  if (loadedDef.projects) {
    console.log('');
    for (var pi = 0; pi < loadedDef.projects.length; pi++) {
      var proj = loadedDef.projects[pi];
      var asLabel = proj.as ? bold(proj.as) : dim('(same machine)');
      var whenLabel = proj.when ? yellow(' when ' + proj.when) : dim(' (always)');
      console.log('  mn:project → ' + asLabel + whenLabel);
    }
  }
}

function doStates() {
  if (!loadedDef) { console.log(dim('  no machine loaded')); return; }
  console.log('  ' + loadedDef.stateNames.filter(function(s) { return s !== 'error'; }).join(', '));
}

function doCtx() {
  if (lastResult) {
    console.log(formatValue(lastResult.instance ? lastResult.instance.context : evalContext));
  } else {
    console.log(formatValue(evalContext));
  }
}

function doHistory() {
  if (!lastResult || !lastResult.history) { console.log(dim('  no pipeline result')); return; }
  for (var i = 0; i < lastResult.history.length; i++) {
    var h = lastResult.history[i];
    console.log('  ' + dim(h.from) + ' → ' + cyan(h.to) + dim(' [' + h.event + ']'));
  }
}

function doReset() {
  loadedDef = null;
  loadedFile = null;
  lastResult = null;
  evalContext = {};
  console.log(dim('  cleared'));
}

async function doPipeline(arg) {
  if (!loadedDef) { console.log(dim('  no machine loaded')); return; }

  var ctx = loadedDef.context || {};
  if (arg.trim()) {
    try { ctx = JSON.parse(arg.trim()); }
    catch (e) { console.log(red('  invalid JSON: ') + e.message); return; }
  }

  // Merge with definition defaults
  var merged = {};
  var defaults = loadedDef.context || {};
  for (var dk in defaults) { if (defaults.hasOwnProperty(dk)) merged[dk] = defaults[dk]; }
  for (var ck in ctx) { if (ctx.hasOwnProperty(ck)) merged[ck] = ctx[ck]; }

  try {
    var raw = fs.readFileSync(
      appPath ? path.join(appPath, 'machines', loadedFile) : loadedFile, 'utf8'
    );

    // Stamp the test context
    raw = raw.replace(/mn-ctx='[^']*'/, "mn-ctx='" + JSON.stringify(merged).replace(/'/g, '&apos;') + "'");

    if (services && services.executeAsync) {
      lastResult = await services.executeAsync(raw);
    } else {
      var def = scxml.compile(raw, {});
      lastResult = machine.executePipeline(def, {
        maxSteps: 10,
        format: raw,
        formatUpdater: transforms.updateScxmlState,
        compiler: scxml.compile
      });
    }

    // Display result
    var meta = transforms.extractMachine(lastResult.scxml || lastResult.format || '');
    if (lastResult.route) {
      console.log(yellow('  → routed: requires ' + lastResult.route.requires.join(', ')));
    } else {
      console.log(green('  → ' + (meta.state || 'unknown')));
    }

    if (lastResult.history) {
      for (var i = 0; i < lastResult.history.length; i++) {
        var h = lastResult.history[i];
        console.log(dim('    ' + h.from + ' → ' + h.to + ' [' + h.event + ']'));
      }
    }

    if (lastResult.effects && lastResult.effects.length > 0) {
      for (var ei = 0; ei < lastResult.effects.length; ei++) {
        var eff = lastResult.effects[ei];
        console.log(dim('    effect: ') + cyan(eff.type));
      }
    }
  } catch (e) {
    console.log(red('  error: ') + e.message);
  }
}

function doProject(arg) {
  if (!loadedDef || !loadedDef.projects) {
    console.log(dim('  no machine loaded or no mn:project declarations'));
    return;
  }

  var parentCtx = {};
  if (arg.trim()) {
    try { parentCtx = JSON.parse(arg.trim()); }
    catch (e) { console.log(red('  invalid JSON: ') + e.message); return; }
  }

  var childCtx = loadedDef.context || {};
  for (var pi = 0; pi < loadedDef.projects.length; pi++) {
    var proj = loadedDef.projects[pi];
    var whenLabel = proj.when || '(always)';

    try {
      var matches = !proj.when || engine.eval(proj.when, parentCtx);
      if (matches) {
        var result = engine.eval(proj.expr, childCtx, loadedDef.initial);
        var asLabel = proj.as ? ' as ' + bold(proj.as) : '';
        console.log(green('  matched: ') + dim(whenLabel) + asLabel);
        console.log(formatValue(result));
        return;
      } else {
        console.log(dim('  skip: ' + whenLabel));
      }
    } catch (e) {
      console.log(red('  error: ') + e.message);
    }
  }
  console.log(dim('  no projection matched — full context travels'));
}

function doHelp() {
  console.log('');
  console.log(bold('  Commands:'));
  console.log('  :load <file.scxml>       Load a machine definition');
  console.log('  :inspect                  Show states, transitions, guards, projections');
  console.log('  :states                   List state names');
  console.log('  :pipeline <json>          Run pipeline with context (uses app adapters if connected)');
  console.log('  :project <json>           Test mn:project with a parent context');
  console.log('  :ctx                      Show last pipeline result context');
  console.log('  :history                  Show last pipeline transition history');
  console.log('  :reset                    Clear loaded machine');
  console.log('  :help                     This help');
  console.log('  :quit                     Exit');
  console.log('');
  console.log(bold('  Expressions:'));
  console.log('  (+ 1 2)                   Evaluate s-expression');
  console.log('  (> amount 50000)          Evaluate against loaded machine context');
  console.log('  (filter #(> (get % :qty) 0) items)');
  console.log('');
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  REPL loop                                                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

console.log('');
console.log(bold('  machine_native REPL') + dim(' v' + engine.version));
console.log(dim('  type :help for commands, :quit to exit'));
if (loadedDef) console.log(dim('  machine: ' + loadedDef.id));
console.log('');

var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: cyan('mn> ')
});

rl.prompt();

rl.on('line', function (line) {
  var input = line.trim();
  if (!input) { rl.prompt(); return; }

  // Commands
  if (input === ':quit' || input === ':q') { rl.close(); return; }
  if (input === ':help' || input === ':h') { doHelp(); rl.prompt(); return; }
  if (input === ':inspect' || input === ':i') { doInspect(); rl.prompt(); return; }
  if (input === ':states') { doStates(); rl.prompt(); return; }
  if (input === ':ctx') { doCtx(); rl.prompt(); return; }
  if (input === ':history') { doHistory(); rl.prompt(); return; }
  if (input === ':reset') { doReset(); rl.prompt(); return; }
  if (input.indexOf(':load ') === 0) { doLoad(input.substring(6)); rl.prompt(); return; }
  if (input.indexOf(':pipeline') === 0) {
    doPipeline(input.substring(9)).then(function () { rl.prompt(); });
    return;
  }
  if (input.indexOf(':project') === 0) { doProject(input.substring(8)); rl.prompt(); return; }

  // S-expression evaluation
  try {
    var result = engine.eval(input, evalContext);
    console.log(formatValue(result));
  } catch (e) {
    console.log(red('  ' + e.message));
  }
  rl.prompt();
});

rl.on('close', function () {
  console.log('');
  process.exit(0);
});
