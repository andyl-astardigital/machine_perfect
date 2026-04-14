/**
 * Fulfil adapter.
 *
 * Synchronous — marks an order as fulfilled.
 * In a real system this would trigger warehouse dispatch.
 */

function fulfil(input) {
  console.log('[effect:fulfil] ' + input.title + ' (' + input.items.length + ' items)');
}

module.exports = fulfil;
