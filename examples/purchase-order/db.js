/**
 * Machine store — SQLite persistence for machines.
 *
 * GENERIC — copy this to any new app. Never touch it.
 *
 * One table. Machines stored as SCXML strings. The database knows
 * nothing about your domain — it stores machines by name, state, and ID.
 * Loading a record IS loading a machine. The SCXML IS the data.
 */

var Database = require('better-sqlite3');
var path = require('path');

var DB_PATH = process.env.DB_PATH || path.join(__dirname, 'app.db');
var db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec('CREATE TABLE IF NOT EXISTS machines (id TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, scxml TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
db.exec('CREATE INDEX IF NOT EXISTS idx_machines_name ON machines(name)');
db.exec('CREATE INDEX IF NOT EXISTS idx_machines_name_state ON machines(name, state)');

db.exec('CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL)');

db.exec('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES users(username), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');


// ── Machine statements ──────────────────────────────────────────
var stmtInsert = db.prepare('INSERT INTO machines (id, name, state, scxml, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
var stmtUpdate = db.prepare('UPDATE machines SET state = ?, scxml = ?, updated_at = ? WHERE id = ?');
var stmtOne = db.prepare('SELECT * FROM machines WHERE id = ?');
var stmtByName = db.prepare('SELECT * FROM machines WHERE name = ? ORDER BY created_at');
var stmtByNameState = db.prepare('SELECT * FROM machines WHERE name = ? AND state = ? ORDER BY created_at');
var stmtDelete = db.prepare('DELETE FROM machines WHERE id = ?');
var stmtDeleteAll = db.prepare('DELETE FROM machines');

// ── User statements ─────────────────────────────────────────────
var crypto = require('crypto');

function hashPassword(password) {
  var salt = crypto.randomBytes(16).toString('hex');
  var hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  var parts = stored.split(':');
  var salt = parts[0];
  var hash = parts[1];
  var check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

var stmtCreateUser = db.prepare('INSERT OR IGNORE INTO users (username, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?)');
var stmtGetUser = db.prepare('SELECT * FROM users WHERE username = ?');
var stmtAllUsers = db.prepare('SELECT username, name, role, created_at FROM users ORDER BY created_at');

function createUser(username, password, name, role) {
  var now = Date.now();
  stmtCreateUser.run(username, hashPassword(password), name, role, now);
}

function authenticateUser(username, password) {
  var row = stmtGetUser.get(username);
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return { username: row.username, name: row.name, role: row.role };
}

function allUsers() {
  return stmtAllUsers.all();
}


// ── Session statements ──────────────────────────────────────────
var SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

var stmtCreateSession = db.prepare('INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)');
var stmtGetSession = db.prepare('SELECT s.*, u.name, u.role FROM sessions s JOIN users u ON s.username = u.username WHERE s.token = ? AND s.expires_at > ?');
var stmtDestroySession = db.prepare('DELETE FROM sessions WHERE token = ?');
var stmtCleanSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

function createSession(username) {
  var token = crypto.randomBytes(32).toString('hex');
  var now = Date.now();
  stmtCreateSession.run(token, username, now, now + SESSION_TTL);
  return token;
}

function getSession(token) {
  if (!token) return null;
  var row = stmtGetSession.get(token, Date.now());
  if (!row) return null;
  return { username: row.username, name: row.name, role: row.role };
}

function destroySession(token) {
  stmtDestroySession.run(token);
}

function cleanExpiredSessions() {
  stmtCleanSessions.run(Date.now());
}


// ── Seed data ───────────────────────────────────────────────────
function seed() {
  createUser('alice',   'alice',   'Alice Chen',    'requester');
  createUser('bob',     'bob',     'Bob Martinez',  'director');
  createUser('charlie', 'charlie', 'Charlie Park',  'admin');
  console.log('[db] seeded ' + allUsers().length + ' users');
}

seed();


// ── Machine helpers ─────────────────────────────────────────────
function generateId(name) {
  return name.substring(0, 3) + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function insert(name, state, scxml) {
  var id = generateId(name);
  var now = Date.now();
  stmtInsert.run(id, name, state, scxml, now, now);
  return id;
}

function one(id) {
  return stmtOne.get(id) || null;
}

function byName(name) {
  return stmtByName.all(name);
}

function byNameState(name, state) {
  return stmtByNameState.all(name, state);
}

function remove(id) {
  stmtDelete.run(id);
}

function reset() {
  stmtDeleteAll.run();
}


module.exports = {
  insert: insert,
  one: one,
  byName: byName,
  byNameState: byNameState,
  remove: remove,
  reset: reset,
  generateId: generateId,
  authenticateUser: authenticateUser,
  createUser: createUser,
  allUsers: allUsers,
  createSession: createSession,
  getSession: getSession,
  destroySession: destroySession,
  cleanExpiredSessions: cleanExpiredSessions,
  db: db
};
