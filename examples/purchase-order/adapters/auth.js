/**
 * Auth adapter — validates credentials against the users table
 * and creates a durable session in SQLite.
 *
 * Effect adapter interface: auth(input, context) → { $user, $token }
 *
 * On success, returns { $user, $token } which the pipeline merges
 * into the machine's context. On failure, throws — the pipeline's
 * on-error handler catches it.
 *
 * Sessions are stored in SQLite with a 24-hour TTL. The server reads
 * sessions on every incoming machine request to inject $user at the
 * transport boundary.
 */

var db = require('../db');


function auth(input, context) {
  var username = input.username;
  var password = input.password;

  var user = db.authenticateUser(username, password);

  if (!user) {
    throw new Error('Invalid username or password');
  }

  var token = db.createSession(user.username);

  console.log('[effect:auth] ' + user.name + ' (' + user.role + ') → token ' + token.substring(0, 8) + '...');

  return { $user: user, $token: token };
}


module.exports = auth;
