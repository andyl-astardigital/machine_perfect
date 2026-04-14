/**
 * Data adapter — loads machines from SQLite.
 *
 * GENERIC — copy to any app. Never touch.
 *
 * Returns raw database rows. Each row has: id, name, state, scxml.
 * The pipeline's invoke resolver uses the .scxml field to embed
 * stored machines as <invoke> children in the response.
 */

var db = require('../db');

function dataAdapter(input, context) {
  var rows;
  if (input.id) {
    var row = db.one(input.id);
    rows = row ? [row] : [];
  } else if (input.state) {
    rows = db.byNameState(input.name, input.state);
  } else {
    rows = db.byName(input.name);
  }
  var result = {};
  result[input.name] = rows;
  return result;
}

module.exports = dataAdapter;
