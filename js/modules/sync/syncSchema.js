/*
---ARU-LAB.SPACE---ALMATY---2026---
Additive sync schema: uid/rev identity, write capture and tombstones.
Only adds columns, tables and triggers; never alters or drops application data.
---chat.aru-lab.space---PWA---
*/
import { SYNC_TABLES, LOCAL_ONLY_SETTINGS } from './syncRegistry.js';

export const SYNC_SCHEMA_VERSION = 1;
const LEGACY_REV = '0000000000001-000000-legacy';
const META_COLUMNS = [
    ['uid', 'TEXT'],
    ['rev', 'TEXT'],
    ['rev_device', 'TEXT']
];

function tableExists(db, name) {
    const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]);
    return !!(res && res.length && res[0].values.length);
}

function hasColumn(db, table, column) {
    try {
        const res = db.exec(`PRAGMA table_info(${table})`);
        if (!res.length) return false;
        const nameIdx = res[0].columns.indexOf('name');
        return res[0].values.some(row => row[nameIdx] === column);
    } catch (e) {
        return false;
    }
}

function getMeta(db, key) {
    try {
        const res = db.exec('SELECT value FROM _sync_meta WHERE key = ?', [key]);
        return res && res.length && res[0].values.length ? res[0].values[0][0] : null;
    } catch (e) {
        return null;
    }
}

function setMeta(db, key, value) {
    db.run('INSERT INTO _sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);
}

function ensureMetaTables(db) {
    db.run(`CREATE TABLE IF NOT EXISTS _sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS _sync_flags (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        capture INTEGER DEFAULT 1
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS _sync_ctx (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        hlc TEXT DEFAULT '',
        device TEXT DEFAULT ''
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS _sync_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        dirty INTEGER DEFAULT 0,
        seq INTEGER DEFAULT 0
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS _sync_tombstones (
        table_name TEXT NOT NULL,
        row_uid TEXT NOT NULL,
        rev TEXT NOT NULL,
        device TEXT DEFAULT '',
        deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (table_name, row_uid)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS _sync_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        row_uid TEXT,
        kind TEXT DEFAULT '',
        local_rev TEXT DEFAULT '',
        remote_rev TEXT DEFAULT '',
        resolution TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run('INSERT OR IGNORE INTO _sync_flags (id, capture) VALUES (1, 1)');
    db.run('INSERT OR IGNORE INTO _sync_ctx (id, hlc, device) VALUES (1, ?, ?)', [LEGACY_REV, 'legacy']);
    db.run('INSERT OR IGNORE INTO _sync_state (id, dirty, seq) VALUES (1, 0, 0)');
}

function settingsGuard(table, alias) {
    if (table !== 'settings') return '';
    const keys = Array.from(LOCAL_ONLY_SETTINGS).map(k => `'${k.replace(/'/g, "''")}'`).join(', ');
    return ` AND NOT (${alias}.key IN (${keys}))`;
}

function triggerPrefix(table) {
    return `trg_${table.replace(/[^a-z0-9_]/gi, '_')}`;
}

function dropTriggers(db, table) {
    const p = triggerPrefix(table);
    for (const suffix of ['ai', 'au', 'ad']) {
        db.run(`DROP TRIGGER IF EXISTS ${p}_${suffix}`);
    }
}

function createTriggers(db, table) {
    const p = triggerPrefix(table);
    const ctxHlc = '(SELECT hlc FROM _sync_ctx WHERE id = 1)';
    const ctxDevice = '(SELECT device FROM _sync_ctx WHERE id = 1)';
    const capture = '(SELECT capture FROM _sync_flags WHERE id = 1) = 1';

    db.run(`CREATE TRIGGER ${p}_ai AFTER INSERT ON ${table}
        FOR EACH ROW WHEN ${capture}${settingsGuard(table, 'NEW')}
        BEGIN
            UPDATE ${table}
               SET uid = COALESCE(uid, lower(hex(randomblob(16)))),
                   rev = COALESCE(rev, ${ctxHlc}),
                   rev_device = COALESCE(rev_device, ${ctxDevice})
             WHERE rowid = NEW.rowid;
            UPDATE _sync_state SET dirty = 1, seq = seq + 1 WHERE id = 1;
            DELETE FROM _sync_tombstones
             WHERE table_name = '${table}'
               AND row_uid = (SELECT uid FROM ${table} WHERE rowid = NEW.rowid);
        END`);

    // The first metadata UPDATE inside the trigger must not re-trigger itself.
    // The rev comparison provides that guard even if recursive triggers are on.
    db.run(`CREATE TRIGGER ${p}_au AFTER UPDATE ON ${table}
        FOR EACH ROW WHEN ${capture}${settingsGuard(table, 'NEW')}
            AND (SELECT rev FROM ${table} WHERE rowid = NEW.rowid) IS NOT ${ctxHlc}
        BEGIN
            UPDATE ${table}
               SET uid = COALESCE(uid, lower(hex(randomblob(16)))),
                   rev = ${ctxHlc},
                   rev_device = ${ctxDevice}
             WHERE rowid = NEW.rowid;
            UPDATE _sync_state SET dirty = 1, seq = seq + 1 WHERE id = 1;
        END`);

    db.run(`CREATE TRIGGER ${p}_ad AFTER DELETE ON ${table}
        FOR EACH ROW WHEN ${capture} AND OLD.uid IS NOT NULL
        BEGIN
            INSERT INTO _sync_tombstones (table_name, row_uid, rev, device)
            VALUES ('${table}', OLD.uid, ${ctxHlc}, ${ctxDevice})
            ON CONFLICT(table_name, row_uid) DO UPDATE SET
                rev = excluded.rev,
                device = excluded.device,
                deleted_at = CURRENT_TIMESTAMP;
            UPDATE _sync_state SET dirty = 1, seq = seq + 1 WHERE id = 1;
        END`);
}

function addIdentityColumns(db, table) {
    let changed = false;
    for (const [col, type] of META_COLUMNS) {
        if (!hasColumn(db, table, col)) {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
            changed = true;
        }
    }
    return changed;
}

function backfillIdentity(db, table, reg) {
    const keyExpr = Array.isArray(reg.identity) && reg.identity.length === 1
        ? reg.identity[0]
        : 'id';
    const suffix = Array.isArray(reg.identity)
        ? `substr('00000000' || ${keyExpr}, -8)`
        : `substr('00000000' || id, -8)`;
    db.run(`UPDATE ${table}
               SET uid = lower(hex(randomblob(8))) || ${suffix}
             WHERE uid IS NULL OR uid = ''`);
    db.run(`UPDATE ${table} SET rev = ? WHERE rev IS NULL OR rev = ''`, [LEGACY_REV]);
    db.run(`UPDATE ${table} SET rev_device = 'legacy' WHERE rev_device IS NULL OR rev_device = ''`);
}

// Returns true when the on-disk schema was changed and should be persisted.
export function ensureSyncSchema(db) {
    if (!db) return false;

    let version = 0;
    try {
        version = parseInt(getMeta(db, 'schema_version')) || 0;
    } catch (e) { /* _sync_meta does not exist yet */ }

    if (version >= SYNC_SCHEMA_VERSION && tableExists(db, '_sync_state')) return false;

    ensureMetaTables(db);
    db.run('UPDATE _sync_flags SET capture = 0 WHERE id = 1');
    db.run('PRAGMA recursive_triggers = OFF');

    let changed = false;
    for (const reg of SYNC_TABLES) {
        if (!tableExists(db, reg.name)) continue;
        dropTriggers(db, reg.name);
        if (addIdentityColumns(db, reg.name)) changed = true;
        backfillIdentity(db, reg.name, reg);
        createTriggers(db, reg.name);
    }

    db.run('UPDATE _sync_flags SET capture = 1 WHERE id = 1');
    db.run('UPDATE _sync_state SET dirty = 0 WHERE id = 1');
    setMeta(db, 'schema_version', SYNC_SCHEMA_VERSION);
    setMeta(db, 'configured_at', Date.now());
    return true;
}

export function readDirtyState(db) {
    try {
        const res = db.exec('SELECT dirty, seq FROM _sync_state WHERE id = 1');
        if (!res.length || !res[0].values.length) return { dirty: false, seq: 0 };
        const [dirty, seq] = res[0].values[0];
        return { dirty: !!dirty, seq: Number(seq) || 0 };
    } catch (e) {
        return { dirty: false, seq: 0 };
    }
}

// Clears the dirty flag only when no local write happened after `observedSeq`.
export function clearDirtyIfUnchanged(db, observedSeq) {
    try {
        db.run('UPDATE _sync_state SET dirty = CASE WHEN seq = ? THEN 0 ELSE 1 END WHERE id = 1', [Number(observedSeq) || 0]);
    } catch (e) { /* ignore */ }
}

export function markDirty(db) {
    try {
        db.run('UPDATE _sync_state SET dirty = 1 WHERE id = 1');
    } catch (e) { /* ignore */ }
}
