/**
 * Notify adapter.
 *
 * Async — simulates sending an email via an external API.
 * Returns { sent: true, to: recipient }.
 */

function notify(input) {
  return new Promise(function (resolve) {
    setTimeout(function () {
      console.log('[effect:notify] to=' + input.to + ' subject=' + input.subject);
      resolve({ sent: true, to: input.to });
    }, 2);
  });
}

module.exports = notify;
