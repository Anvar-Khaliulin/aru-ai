/*
---ARU-LAB.SPACE---ALMATY---2026---
Three-way SQLite merge: base (last synced snapshot) + local + remote.
Rows are matched by uid or natural key; fields are merged individually and
concurrent edits are ordered by a hybrid logical clock. Deletions travel as
tombstones, so an offline device cannot silently resurrect removed data.
---chat.aru-lab.space---PWA---
*/
import { SYNC_TABLES, TABLE_BY_NAME, SYNC_META_COLUMNS, LOCAL_ONLY_SETTINGS, rowIdentity } from './syncRegistry.js';
import { SyncCore, randomId } from './syncCore.js';

const LEGACY_REV = '0000000000001-000000-legacy';

function query(db, sql, params = []) {
    const stmt = db.prepare(sql);
    try {
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
    } finally {
        stmt.free();
    }
}

function tableColumns(db, table) {
    try {
        return query(db, `PRAGMA table_info(${table})`).map(r => r.name);
    } catch (e) {
        return [];
    }
}

function tableExists(db, table) {
    return query(db, "SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table]).length > 0;
}

function readRows(db, table) {
    if (!tableExists(db, table)) return [];
    try {
        return query(db, `SELECT * FROM ${table}`);
    } catch (e) {
        return [];
    }
}

function readTombstones(db) {
    if (!tableExists(db, '_sync_tombstones')) return new Map();
    const map = new Map();
    for (const row of query(db, 'SELECT * FROM _sync_tombstones')) {
        map.set(`${row.table_name}\u0000${row.row_uid}`, row);
    }
    return map;
}

function valueEqual(a, b) {
    if (a === b) return true;
    if (a === null || a === undefined) return b === null || b === undefined;
    if (b === null || b === undefined) return false;
    return String(a) === String(b);
}

function dataColumns(columns) {
    return columns.filter(c => !SYNC_META_COLUMNS.has(c));
}

function rowsEqual(columns, a, b) {
    for (const col of columns) {
        if (!valueEqual(a[col], b[col])) return false;
    }
    return true;
}

function rowRev(row) {
    return row?.rev || LEGACY_REV;
}

function compareRows(a, b) {
    const cmp = SyncCore.compareRev(rowRev(a), rowRev(b));
    if (cmp !== 0) return cmp;
    const da = a?.rev_device || '';
    const db = b?.rev_device || '';
    if (da !== db) return da > db ? 1 : -1;
    // Fully identical clocks: keep the comparison deterministic across devices.
    const sa = SyncCore.stableStringify(a || {});
    const sb = SyncCore.stableStringify(b || {});
    return sa === sb ? 0 : (sa > sb ? 1 : -1);
}

function maxRev(...revs) {
    let best = '';
    for (const rev of revs) {
        if (rev && SyncCore.compareRev(rev, best) > 0) best = rev;
    }
    return best;
}

function tombstoneRev(tomb) {
    return tomb?.rev || '';
}

function parseIdentity(reg) {
    return Array.isArray(reg.identity) ? reg.identity : null;
}

function buildMaps(reg, rows) {
    const map = new Map();
    const idToUid = new Map();
    for (const row of rows) {
        const key = rowIdentity(reg.name, row);
        if (key == null) continue;
        map.set(key, row);
        if (row.id != null && row.uid) idToUid.set(row.id, row.uid);
    }
    return { map, idToUid };
}

function localIdFor(db, table, uid) {
    if (!uid) return null;
    const rows = query(db, `SELECT id FROM ${table} WHERE uid = ? LIMIT 1`, [uid]);
    return rows.length ? rows[0].id : null;
}

function resolveRefValue(reg, col, parent, remoteId, remoteIdToUid, localIdByUid) {
    if (remoteId === null || remoteId === undefined) return { value: null };
    const parentUid = remoteIdToUid[parent]?.get(remoteId);
    const localId = parentUid ? localIdByUid[parent]?.get(parentUid) : null;
    if (localId === null || localId === undefined) {
        if ((reg.requiredRefs || []).includes(col)) return null;
        return { value: null };
    }
    return { value: localId };
}

function resolveRefs(row, reg, remoteIdToUid, localIdByUid) {
    const out = { ...row };
    for (const [col, parent] of Object.entries(reg.refs || {})) {
        const resolved = resolveRefValue(reg, col, parent, row[col], remoteIdToUid, localIdByUid);
        if (!resolved) return null;
        out[col] = resolved.value;
    }
    return out;
}

function applyRowUpdate(db, reg, columns, values, local) {
    const sets = columns.map(c => `"${c}" = ?`).join(', ');
    const params = columns.map(c => (values[c] === undefined ? null : values[c]));
    const where = rowWhere(reg, local);
    db.run(`UPDATE ${reg.name} SET ${sets} WHERE ${where.sql}`, [...params, ...where.params]);
}

function applyRowDelete(db, reg, row) {
    const where = rowWhere(reg, row);
    db.run(`DELETE FROM ${reg.name} WHERE ${where.sql}`, where.params);
}

// Natural-key tables (settings, personality_state, fit_*) have no id column,
// so they must be addressed by their identity instead of rowid.
function rowWhere(reg, row) {
    const identity = parseIdentity(reg);
    if (identity && !identity.includes('id')) {
        return {
            sql: identity.map(c => `"${c}" = ?`).join(' AND '),
            params: identity.map(c => row[c])
        };
    }
    return { sql: 'id = ?', params: [row.id] };
}

// Device-local settings must never travel: they differ on every save and would
// otherwise show up as endless conflicts and push noise.
function stripLocalOnly(reg, map) {
    if (reg.name !== 'settings') return map;
    for (const [key, row] of map) {
        if (LOCAL_ONLY_SETTINGS.has(row.key)) map.delete(key);
    }
    return map;
}

function applyRowInsert(db, table, columns, values) {
    const cols = columns.map(c => `"${c}"`).join(', ');
    const marks = columns.map(() => '?').join(', ');
    const params = columns.map(c => (values[c] === undefined ? null : values[c]));
    db.run(`INSERT INTO ${table} (${cols}) VALUES (${marks})`, params);
    const res = db.exec('SELECT last_insert_rowid() AS id');
    return res.length && res[0].values.length ? res[0].values[0][0] : null;
}

function upsertTombstone(db, table, uid, rev, device) {
    db.run(`INSERT INTO _sync_tombstones (table_name, row_uid, rev, device)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(table_name, row_uid) DO UPDATE SET
                rev = CASE WHEN excluded.rev > rev THEN excluded.rev ELSE rev END,
                device = excluded.device,
                deleted_at = CURRENT_TIMESTAMP`,
        [table, uid, rev || LEGACY_REV, device || '']);
}

function dropTombstone(db, table, uid) {
    db.run('DELETE FROM _sync_tombstones WHERE table_name = ? AND row_uid = ?', [table, uid]);
}

function logConflict(db, table, uid, kind, localRev, remoteRev, resolution) {
    db.run(`INSERT INTO _sync_conflicts (table_name, row_uid, kind, local_rev, remote_rev, resolution)
            VALUES (?, ?, ?, ?, ?, ?)`, [table, uid || '', kind, localRev || '', remoteRev || '', resolution || '']);
    db.run(`DELETE FROM _sync_conflicts
             WHERE id NOT IN (SELECT id FROM _sync_conflicts ORDER BY id DESC LIMIT 200)`);
}

function mergeChangedRows(reg, columns, cols, base, local, remote) {
    const out = { ...local };
    const conflicts = [];
    const winnerIsRemote = compareRows(local, remote) < 0;
    for (const col of cols) {
        const bv = base ? base[col] : undefined;
        const lv = local[col];
        const rv = remote[col];
        const localChanged = !valueEqual(lv, bv);
        const remoteChanged = !valueEqual(rv, bv);
        if (!localChanged) {
            out[col] = rv;
        } else if (!remoteChanged) {
            out[col] = lv;
        } else if (!valueEqual(lv, rv)) {
            out[col] = winnerIsRemote ? rv : lv;
            conflicts.push(col);
        }
    }
    out.rev = maxRev(rowRev(local), rowRev(remote));
    out.rev_device = winnerIsRemote ? (remote.rev_device || '') : (local.rev_device || '');
    return { row: out, conflicts, winnerIsRemote };
}

function cleanupOrphans(db) {
    for (const reg of SYNC_TABLES) {
        if (!reg.refs) continue;
        for (const [col, parent] of Object.entries(reg.refs)) {
            const required = (reg.requiredRefs || []).includes(col);
            try {
                if (required) {
                    db.run(`DELETE FROM ${reg.name}
                             WHERE "${col}" IS NOT NULL
                               AND "${col}" NOT IN (SELECT id FROM ${parent})`);
                } else {
                    db.run(`UPDATE ${reg.name} SET "${col}" = NULL
                             WHERE "${col}" IS NOT NULL
                               AND "${col}" NOT IN (SELECT id FROM ${parent})`);
                }
            } catch (e) {
                console.warn('Sync merge: orphan cleanup failed for', reg.name, col, e);
            }
        }
    }
}

function purgeOldTombstones(db) {
    try {
        db.run("DELETE FROM _sync_tombstones WHERE deleted_at < datetime('now', '-90 days')");
    } catch (e) { /* ignore */ }
}

/**
 * Merges three SQLite images. Returns a NEW open sql.js database plus its bytes.
 * The caller owns the returned db and must save/swap it.
 */
export function mergeDatabases({ SQL, baseBytes, localBytes, remoteBytes }) {
    if (!SQL) throw new Error('Sync merge: SQL.js is not ready');
    if (!localBytes || !remoteBytes) throw new Error('Sync merge: missing local or remote snapshot');

    const baseDb = baseBytes ? new SQL.Database(baseBytes) : null;
    const remoteDb = new SQL.Database(remoteBytes);
    const localDb = new SQL.Database(localBytes);

    const stats = { inserted: 0, updated: 0, deleted: 0, merged: 0, conflicts: 0, skipped: 0, changed: false };

    try {
        localDb.run('UPDATE _sync_flags SET capture = 0 WHERE id = 1');

        const remoteIdToUid = {};
        const localIdByUid = {};

        for (const reg of SYNC_TABLES) {
            if (!tableExists(localDb, reg.name)) continue;
            const remoteRows = readRows(remoteDb, reg.name);
            remoteIdToUid[reg.name] = new Map();
            for (const row of remoteRows) {
                if (row.id != null && row.uid) remoteIdToUid[reg.name].set(row.id, row.uid);
            }
            localIdByUid[reg.name] = new Map();
            for (const row of readRows(localDb, reg.name)) {
                if (row.uid) localIdByUid[reg.name].set(row.uid, row.id);
            }
        }

        const remoteTombs = readTombstones(remoteDb);
        const localTombs = readTombstones(localDb);
        const maxTomb = (table, uid) => {
            const a = remoteTombs.get(`${table}\u0000${uid}`);
            const b = localTombs.get(`${table}\u0000${uid}`);
            if (!a) return b || null;
            if (!b) return a;
            return SyncCore.compareRev(a.rev, b.rev) >= 0 ? a : b;
        };

        for (const reg of SYNC_TABLES) {
            if (!tableExists(localDb, reg.name)) continue;
            const columns = tableColumns(localDb, reg.name);
            if (!columns.length) continue;
            const cols = dataColumns(columns);
            const natural = parseIdentity(reg);

            const localMap = stripLocalOnly(reg, buildMaps(reg, readRows(localDb, reg.name)).map);
            const remoteMap = stripLocalOnly(reg, buildMaps(reg, readRows(remoteDb, reg.name)).map);
            const baseMap = baseDb && tableExists(baseDb, reg.name)
                ? stripLocalOnly(reg, buildMaps(reg, readRows(baseDb, reg.name)).map)
                : new Map();

            const keys = new Set([...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()]);
            for (const key of keys) {
                const local = localMap.get(key);
                const remote = remoteMap.get(key);
                const base = baseMap.get(key);
                const remoteUid = remote?.uid || local?.uid || base?.uid || '';

                if (local && remote) {
                    if (rowsEqual(cols, local, remote)) continue;
                    if (base && rowsEqual(cols, local, base)) {
                        // Remote-only change
                        const resolved = resolveRefs(remote, reg, remoteIdToUid, localIdByUid);
                        if (!resolved) { stats.skipped++; logConflict(localDb, reg.name, remoteUid, 'missing_parent', rowRev(local), rowRev(remote), 'skipped'); continue; }
                        const values = { ...resolved };
                        if (natural) values.uid = local.uid; // keep local identity for natural keys
                        applyRowUpdate(localDb, reg, columns.filter(c => c !== 'id'), values, local);
                        stats.updated++;
                        stats.changed = true;
                        continue;
                    }
                    if (base && rowsEqual(cols, remote, base)) continue; // Local-only change

                    if (!base) {
                        // Created on both sides independently: whole-row LWW.
                        if (compareRows(local, remote) >= 0) continue;
                        const resolved = resolveRefs(remote, reg, remoteIdToUid, localIdByUid);
                        if (!resolved) { stats.skipped++; logConflict(localDb, reg.name, remoteUid, 'insert_collision', rowRev(local), rowRev(remote), 'skipped'); continue; }
                        const values = { ...resolved };
                        if (natural) values.uid = local.uid;
                        applyRowUpdate(localDb, reg, columns.filter(c => c !== 'id'), values, local);
                        stats.updated++;
                        stats.changed = true;
                        stats.conflicts++;
                        logConflict(localDb, reg.name, remoteUid, 'created_both', rowRev(local), rowRev(remote), 'lww');
                        continue;
                    }

                    // Both sides edited the same row: field-level merge.
                    const { row: merged, conflicts, winnerIsRemote } = mergeChangedRows(reg, columns, cols, base, local, remote);
                    const resolved = {};
                    for (const col of columns) resolved[col] = merged[col];
                    for (const [col, parent] of Object.entries(reg.refs || {})) {
                        if (valueEqual(merged[col], local[col])) {
                            resolved[col] = local[col];
                        } else {
                            const remapped = resolveRefValue(reg, col, parent, merged[col], remoteIdToUid, localIdByUid);
                            if (!remapped) {
                                resolved[col] = local[col];
                            } else {
                                resolved[col] = remapped.value;
                            }
                        }
                    }
                    resolved.rev = merged.rev;
                    resolved.rev_device = merged.rev_device;
                    if (natural) resolved.uid = local.uid;
                    if (!rowsEqual(cols, resolved, local)) {
                        applyRowUpdate(localDb, reg, columns.filter(c => c !== 'id'), resolved, local);
                        stats.updated++;
                        stats.merged++;
                        stats.changed = true;
                    }
                    if (conflicts.length) {
                        stats.conflicts += conflicts.length;
                        logConflict(localDb, reg.name, remoteUid, 'fields:' + conflicts.join(','), rowRev(local), rowRev(remote), winnerIsRemote ? 'remote' : 'local');
                    }
                    continue;
                }

                if (local && !remote) {
                    if (!base) continue; // Created locally only
                    if (rowsEqual(cols, local, base)) {
                        // Deleted remotely, untouched locally.
                        applyRowDelete(localDb, reg, local);
                        localIdByUid[reg.name]?.delete(local.uid);
                        stats.deleted++;
                        stats.changed = true;
                        if (local.uid) upsertTombstone(localDb, reg.name, local.uid, tombstoneRev(maxTomb(reg.name, local.uid)) || rowRev(base), base?.rev_device);
                        continue;
                    }
                    // Delete vs update: the newer revision wins; without a tombstone keep the data.
                    const tomb = local.uid ? maxTomb(reg.name, local.uid) : null;
                    if (tomb && SyncCore.compareRev(tomb.rev, rowRev(local)) > 0) {
                        applyRowDelete(localDb, reg, local);
                        localIdByUid[reg.name]?.delete(local.uid);
                        stats.deleted++;
                        stats.changed = true;
                        if (local.uid) upsertTombstone(localDb, reg.name, local.uid, tomb.rev, tomb.device);
                        stats.conflicts++;
                        logConflict(localDb, reg.name, local.uid, 'delete_vs_update', rowRev(local), tomb.rev, 'deleted');
                    } else {
                        stats.conflicts++;
                        logConflict(localDb, reg.name, local.uid, 'delete_vs_update', rowRev(local), tombstoneRev(tomb), 'kept');
                    }
                    continue;
                }

                if (!local && remote) {
                    if (base && rowsEqual(cols, remote, base)) continue; // Deleted locally, remote untouched
                    if (base) {
                        const tomb = remote.uid ? maxTomb(reg.name, remote.uid) : null;
                        if (tomb && SyncCore.compareRev(tomb.rev, rowRev(remote)) > 0) {
                            stats.conflicts++;
                            logConflict(localDb, reg.name, remote.uid, 'delete_vs_update', tomb.rev, rowRev(remote), 'deleted');
                            continue;
                        }
                    }
                    const resolved = resolveRefs(remote, reg, remoteIdToUid, localIdByUid);
                    if (!resolved) {
                        stats.skipped++;
                        logConflict(localDb, reg.name, remote.uid, 'missing_parent', '', rowRev(remote), 'skipped');
                        continue;
                    }
                    const values = { ...resolved };
                    if (!values.uid) values.uid = remote.uid || randomId(16);
                    const newId = applyRowInsert(localDb, reg.name, columns.filter(c => c !== 'id'), values);
                    if (newId != null) {
                        localIdByUid[reg.name]?.set(values.uid, newId);
                        if (reg.identity === 'uid' && remote.uid) dropTombstone(localDb, reg.name, remote.uid);
                        stats.inserted++;
                        stats.changed = true;
                        if (base) {
                            stats.conflicts++;
                            logConflict(localDb, reg.name, remote.uid, 'delete_vs_update', '', rowRev(remote), 'resurrected');
                        }
                    }
                    continue;
                }

                // Row missing on both sides: nothing to apply. Remaining tombstones are imported below.
            }
        }

        // Import tombstones created on the remote device for rows that do not exist here.
        for (const reg of SYNC_TABLES) {
            if (!tableExists(localDb, reg.name)) continue;
            if (reg.identity !== 'uid') continue;
            for (const [key, tomb] of remoteTombs) {
                if (!key.startsWith(reg.name + '\u0000')) continue;
                const uid = tomb.row_uid;
                if (!uid) continue;
                const exists = query(localDb, `SELECT id FROM ${reg.name} WHERE uid = ? LIMIT 1`, [uid]).length > 0;
                if (exists) { dropTombstone(localDb, reg.name, uid); continue; }
                const existing = localTombs.get(`${reg.name}\u0000${uid}`);
                if (!existing || SyncCore.compareRev(tomb.rev, existing.rev) > 0) {
                    upsertTombstone(localDb, reg.name, uid, tomb.rev, tomb.device);
                }
            }
        }

        cleanupOrphans(localDb);
        purgeOldTombstones(localDb);

        localDb.run('UPDATE _sync_flags SET capture = 1 WHERE id = 1');
        // Remote changes are now part of the local state; local writes during the
        // merge set dirty again through their own triggers.
        localDb.run('UPDATE _sync_state SET dirty = 0 WHERE id = 1');

        const bytes = localDb.export();
        return { db: localDb, bytes, stats };
    } catch (e) {
        try { localDb.close(); } catch (err) { /* ignore */ }
        throw e;
    } finally {
        try { baseDb?.close(); } catch (e) { /* ignore */ }
        try { remoteDb.close(); } catch (e) { /* ignore */ }
    }
}

export function countConflicts(db) {
    try {
        const rows = query(db, 'SELECT COUNT(*) AS n FROM _sync_conflicts');
        return rows.length ? Number(rows[0].n) || 0 : 0;
    } catch (e) {
        return 0;
    }
}
