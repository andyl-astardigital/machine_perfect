/**
 * Persist adapter — snapshots a machine to durable storage.
 *
 * GENERIC — copy to any app. Never touch.
 *
 * The machine is persisted as SCXML. The adapter receives the
 * current pipeline format string (the SCXML being executed),
 * extracts name and state, stores it. Loading a record later
 * IS loading a machine.
 */

var db = require('../db');
var transforms = require('../../../mn/transforms');

function persist(input, context) {
  var machine = transforms.extractMachine(input);
  var id = db.insert(machine.name, machine.state, input);
  console.log('[effect:persist] ' + machine.name + '/' + machine.state + ' → ' + id);
  return { id: id };
}

module.exports = persist;
