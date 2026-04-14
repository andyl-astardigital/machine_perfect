/**
 * Log adapter.
 *
 * Synchronous side effect — writes to console.
 * No return value. Fire and forget.
 */

function log(input) {
  console.log('[effect:log] ' + input);
}

module.exports = log;
