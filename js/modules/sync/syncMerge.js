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

function lookupUid(map, rawId) {
    if (rawId === null || rawId === undefined || !map) return null;
    if (map.has(rawId)) return map.get(rawId);
    const num = Number(rawId);
    return Number.isFinite(num) && map.has(num) ? map.get(num) : null;
}

function canonicalizeSkillMessageMeta(metaStr, idToUid) {
    if (metaStr === null || metaStr === undefined || metaStr === '') return metaStr;
    try {
        const obj = JSON.parse(String(metaStr));
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return metaStr;
        const copy = { ...obj };
        if ('runId' in copy && copy.runId != null && idToUid?.skill_runs) {
            const u = lookupUid(idToUid.skill_runs, copy.runId);
            copy.runId = u ? `uid:${u}` : null;
        }
        if (Array.isArray(copy.artifacts) && idToUid?.skill_artifacts) {
            copy.artifacts = copy.artifacts.map((aid) => {
                const u = lookupUid(idToUid.skill_artifacts, aid);
                return u ? `uid:${u}` : null;
            }).filter(Boolean);
        }
        return SyncCore.stableStringify(copy);
    } catch (e) {
        return metaStr;
    }
}

export function remapSkillMessageMeta(metaStr, remoteIdToUid, localIdByUid) {
    if (metaStr === null || metaStr === undefined || metaStr === '') return metaStr;
    try {
        const obj = JSON.parse(String(metaStr));
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return metaStr;
        const copy = { ...obj };
        if ('runId' in copy && copy.runId != null) {
            const rUid = lookupUid(remoteIdToUid?.skill_runs, copy.runId);
            const lId = rUid ? localIdByUid?.skill_runs?.get(rUid) : null;
            copy.runId = lId != null ? lId : null;
        }
        if (Array.isArray(copy.artifacts)) {
            copy.artifacts = copy.artifacts.map((aid) => {
                const aUid = lookupUid(remoteIdToUid?.skill_artifacts, aid);
                const lId = aUid ? localIdByUid?.skill_artifacts?.get(aUid) : null;
                return lId != null ? lId : null;
            }).filter(v => v !== null);
        }
        return JSON.stringify(copy);
    } catch (e) {
        return metaStr;
    }
}

function mergeScalar(bv, lv, rv, hasBase, winnerIsRemote) {
    if (hasBase) {
        if (valueEqual(lv, rv)) return lv;
        if (valueEqual(lv, bv)) return rv;
        if (valueEqual(rv, bv)) return lv;
        return winnerIsRemote ? rv : lv;
    }
    return valueEqual(lv, rv) ? lv : (winnerIsRemote ? rv : lv);
}

function mergeListById(baseArr, localArr, remoteArr, hasBase, winnerIsRemote, mergeFn) {
    const bMap = new Map((baseArr || []).filter(x => x && x.id != null).map(x => [x.id, x]));
    const lMap = new Map((localArr || []).filter(x => x && x.id != null).map(x => [x.id, x]));
    const rMap = new Map((remoteArr || []).filter(x => x && x.id != null).map(x => [x.id, x]));
    const ids = [];
    const seen = new Set();
    for (const item of [...(localArr || []), ...(remoteArr || [])]) {
        if (!item || item.id == null || seen.has(item.id)) continue;
        seen.add(item.id);
        ids.push(item.id);
    }
    const out = [];
    for (const id of ids) {
        const bi = bMap.get(id);
        const li = lMap.get(id);
        const ri = rMap.get(id);
        if (li && ri) {
            out.push(mergeFn(bi || null, li, ri));
        } else if (li && !ri) {
            if (!hasBase || !bi) {
                out.push(li);
            } else {
                const mod = SyncCore.stableStringify(li) !== SyncCore.stableStringify(bi);
                if (mod && !winnerIsRemote) out.push(li);
            }
        } else if (!li && ri) {
            if (!hasBase || !bi) {
                out.push(ri);
            } else {
                const mod = SyncCore.stableStringify(ri) !== SyncCore.stableStringify(bi);
                if (mod && winnerIsRemote) out.push(ri);
            }
        }
    }
    return out;
}

export function mergeTaskBoardJson(baseContent, localContent, remoteContent, winnerIsRemote = false) {
    const parseBoard = (raw) => {
        if (!raw) return null;
        try {
            const obj = JSON.parse(String(raw));
            return (obj && typeof obj === 'object' && Array.isArray(obj.projects)) ? obj : null;
        } catch (e) {
            return null;
        }
    };
    const l = parseBoard(localContent);
    const r = parseBoard(remoteContent);
    if (!l && !r) return null;
    if (!l) return JSON.stringify(r);
    if (!r) return JSON.stringify(l);
    const b = parseBoard(baseContent);

    const mergeProject = (bp, lp, rp) => {
        const hasBase = !!bp;
        const baseCols = bp?.columns || [];
        const mergedCols = mergeListById(baseCols, lp.columns || [], rp.columns || [], hasBase, winnerIsRemote, (bc, lc, rc) => ({
            ...lc,
            id: lc.id,
            title: mergeScalar(bc?.title, lc.title, rc.title, !!(hasBase && bc), winnerIsRemote),
            tasks: []
        }));
        const colIds = new Set(mergedCols.map(c => c.id));
        const colMap = new Map(mergedCols.map(c => [c.id, c]));

        const indexTasks = (proj) => {
            const map = new Map();
            const order = [];
            for (const col of (proj?.columns || [])) {
                for (const t of (col.tasks || [])) {
                    if (!t || t.id == null) continue;
                    map.set(t.id, { task: t, colId: col.id });
                    order.push(t.id);
                }
            }
            return { map, order };
        };
        const bi = indexTasks(bp);
        const li = indexTasks(lp);
        const ri = indexTasks(rp);
        const allTaskIds = [];
        const seenTasks = new Set();
        for (const id of [...li.order, ...ri.order]) {
            if (seenTasks.has(id)) continue;
            seenTasks.add(id);
            allTaskIds.push(id);
        }

        const taskChanged = (entry, baseEntry) => (
            entry.colId !== baseEntry.colId ||
            SyncCore.stableStringify(entry.task) !== SyncCore.stableStringify(baseEntry.task)
        );

        for (const tid of allTaskIds) {
            const bt = bi.map.get(tid);
            const lt = li.map.get(tid);
            const rt = ri.map.get(tid);
            let chosen = null;
            let destColId = null;

            if (lt && rt) {
                const hb = !!(hasBase && bt);
                chosen = {
                    ...lt.task,
                    id: tid,
                    title: mergeScalar(bt?.task?.title, lt.task.title, rt.task.title, hb, winnerIsRemote),
                    desc: mergeScalar(bt?.task?.desc, lt.task.desc, rt.task.desc, hb, winnerIsRemote),
                    deadline: mergeScalar(bt?.task?.deadline, lt.task.deadline, rt.task.deadline, hb, winnerIsRemote)
                };
                destColId = mergeScalar(bt?.colId, lt.colId, rt.colId, hb, winnerIsRemote);
                if (!colIds.has(destColId)) {
                    destColId = colIds.has(lt.colId) ? lt.colId : (colIds.has(rt.colId) ? rt.colId : mergedCols[0]?.id);
                }
            } else if (lt && !rt) {
                if (!hasBase || !bt || (taskChanged(lt, bt) && !winnerIsRemote)) {
                    chosen = { ...lt.task };
                    destColId = colIds.has(lt.colId) ? lt.colId : mergedCols[0]?.id;
                }
            } else if (!lt && rt) {
                if (!hasBase || !bt || (taskChanged(rt, bt) && winnerIsRemote)) {
                    chosen = { ...rt.task };
                    destColId = colIds.has(rt.colId) ? rt.colId : mergedCols[0]?.id;
                }
            }
            if (chosen && destColId && colMap.has(destColId)) {
                colMap.get(destColId).tasks.push(chosen);
            }
        }

        return {
            ...lp,
            id: lp.id,
            name: mergeScalar(bp?.name, lp.name, rp.name, hasBase, winnerIsRemote),
            columns: mergedCols
        };
    };

    const mergedProjects = mergeListById(b?.projects || [], l.projects || [], r.projects || [], !!b, winnerIsRemote, mergeProject);
    const aliveProjIds = new Set(mergedProjects.map(p => p.id));
    let activeProjectId = l.activeProjectId;
    if (!aliveProjIds.has(activeProjectId)) {
        activeProjectId = aliveProjIds.has(r.activeProjectId) ? r.activeProjectId : (mergedProjects[0]?.id ?? null);
    }
    return JSON.stringify({ projects: mergedProjects, activeProjectId });
}

function canonicalValue(row, col, reg, idToUid) {
    const val = row[col];
    if (reg.refs && reg.refs[col]) {
        if (val === null || val === undefined) return null;
        const parentUid = lookupUid(idToUid?.[reg.refs[col]], val);
        return parentUid ? `uid:${parentUid}` : `raw:${val}`;
    }
    if (reg.name === 'skill_project_messages' && col === 'meta') {
        return canonicalizeSkillMessageMeta(val, idToUid);
    }
    return val;
}

function canonicalRowsEqual(reg, columns, a, mapA, colsA, b, mapB, colsB) {
    for (const col of columns) {
        if ((colsA && !colsA.has(col)) || (colsB && !colsB.has(col))) continue;
        if (!valueEqual(canonicalValue(a, col, reg, mapA), canonicalValue(b, col, reg, mapB))) return false;
    }
    return true;
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
    const duplicates = [];
    for (const row of rows) {
        const key = rowIdentity(reg.name, row);
        if (key == null) continue;
        const prev = map.get(key);
        if (prev) {
            if (compareRows(row, prev) > 0) {
                if (prev.id != null) duplicates.push(prev.id);
                map.set(key, row);
            } else if (row.id != null) {
                duplicates.push(row.id);
            }
        } else {
            map.set(key, row);
        }
        if (row.id != null && row.uid) idToUid.set(row.id, row.uid);
    }
    return { map, idToUid, duplicates };
}

function resolveRefValue(reg, col, parent, remoteId, remoteIdToUid, localIdByUid) {
    if (remoteId === null || remoteId === undefined) return { value: null };
    const parentUid = lookupUid(remoteIdToUid[parent], remoteId);
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

function findUniqueCollision(db, reg, values, tuple, excludeLocalId) {
    const clauses = tuple.map(c => `"${c}" IS ?`);
    const params = tuple.map(c => (values[c] === undefined ? null : values[c]));
    let sql = `SELECT id FROM ${reg.name} WHERE ${clauses.join(' AND ')}`;
    if (excludeLocalId != null) {
        sql += ' AND id != ?';
        params.push(excludeLocalId);
    }
    sql += ' LIMIT 1';
    return query(db, sql, params).length > 0;
}

function resolveUniqueCollisions(db, reg, values, excludeLocalId = null) {
    if (!Array.isArray(reg.uniqueKeys) || !reg.uniqueKeys.length) return false;
    let collided = false;
    for (const tuple of reg.uniqueKeys) {
        if (!findUniqueCollision(db, reg, values, tuple, excludeLocalId)) continue;
        collided = true;
        if (tuple.includes('title')) {
            const baseTitle = String(values.title || 'Untitled');
            let suffix = 2;
            while (suffix < 1000) {
                values.title = `${baseTitle} (${suffix})`;
                if (!findUniqueCollision(db, reg, values, tuple, excludeLocalId)) break;
                suffix++;
            }
        }
    }
    return collided;
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

// Natural-key tables (settings, personality_state, fit_*, modules_data) are addressed by their identity instead of rowid.
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

function mergeChangedRows({ reg, columns, cols, base, local, remote, remoteCols, baseCols, localIdToUid, remoteIdToUid, baseIdToUid, localIdByUid }) {
    const out = { ...local };
    const conflicts = [];
    const winnerIsRemote = compareRows(local, remote) < 0;
    for (const col of cols) {
        if (!remoteCols.has(col)) continue;
        const lvCanon = canonicalValue(local, col, reg, localIdToUid);
        const rvCanon = canonicalValue(remote, col, reg, remoteIdToUid);
        const hasBaseCol = !!(base && (!baseCols || baseCols.has(col)));
        let pickedRemote = false;

        if (hasBaseCol) {
            const bvCanon = canonicalValue(base, col, reg, baseIdToUid);
            const localChanged = !valueEqual(lvCanon, bvCanon);
            const remoteChanged = !valueEqual(rvCanon, bvCanon);
            if (!localChanged) {
                pickedRemote = true;
            } else if (!remoteChanged) {
                pickedRemote = false;
            } else if (!valueEqual(lvCanon, rvCanon)) {
                pickedRemote = winnerIsRemote;
                conflicts.push(col);
            }
        } else if (!valueEqual(lvCanon, rvCanon)) {
            pickedRemote = winnerIsRemote;
            conflicts.push(col);
        }

        if (pickedRemote) {
            if (reg.refs && reg.refs[col]) {
                const remapped = resolveRefValue(reg, col, reg.refs[col], remote[col], remoteIdToUid, localIdByUid);
                out[col] = remapped ? remapped.value : local[col];
            } else if (reg.name === 'skill_project_messages' && col === 'meta') {
                out[col] = remapSkillMessageMeta(remote[col], remoteIdToUid, localIdByUid);
            } else {
                out[col] = remote[col];
            }
        } else {
            out[col] = local[col];
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

        const localIdToUid = {};
        const localIdByUid = {};
        const remoteIdToUid = {};
        const baseIdToUid = {};

        for (const reg of SYNC_TABLES) {
            if (!tableExists(localDb, reg.name)) continue;
            const localRows = readRows(localDb, reg.name);
            localIdToUid[reg.name] = new Map();
            localIdByUid[reg.name] = new Map();
            for (const row of localRows) {
                if (row.uid) {
                    localIdByUid[reg.name].set(row.uid, row.id);
                    if (row.id != null) localIdToUid[reg.name].set(row.id, row.uid);
                }
            }
            const remoteRows = readRows(remoteDb, reg.name);
            remoteIdToUid[reg.name] = new Map();
            for (const row of remoteRows) {
                if (row.rev) SyncCore.observeRemote(row.rev);
                if (row.id != null && row.uid) remoteIdToUid[reg.name].set(row.id, row.uid);
            }
            if (baseDb && tableExists(baseDb, reg.name)) {
                baseIdToUid[reg.name] = new Map();
                for (const row of readRows(baseDb, reg.name)) {
                    if (row.id != null && row.uid) baseIdToUid[reg.name].set(row.id, row.uid);
                }
            }
        }

        const remoteTombs = readTombstones(remoteDb);
        for (const tomb of remoteTombs.values()) {
            if (tomb.rev) SyncCore.observeRemote(tomb.rev);
        }
        const localTombs = readTombstones(localDb);
        const maxTombFor = (table, ...candidateKeys) => {
            let best = null;
            for (const k of candidateKeys) {
                if (!k) continue;
                for (const source of [remoteTombs, localTombs]) {
                    const t = source.get(`${table}\u0000${k}`);
                    if (t && (!best || SyncCore.compareRev(t.rev, best.rev) > 0)) best = t;
                }
            }
            return best;
        };

        for (const reg of SYNC_TABLES) {
            if (!tableExists(localDb, reg.name)) continue;
            const columns = tableColumns(localDb, reg.name);
            if (!columns.length) continue;
            const localColsSet = new Set(columns);
            const remoteColsList = tableExists(remoteDb, reg.name) ? tableColumns(remoteDb, reg.name) : [];
            const remoteCols = new Set(remoteColsList);
            const hasRemoteTable = remoteColsList.length > 0;
            const baseCols = (baseDb && tableExists(baseDb, reg.name)) ? new Set(tableColumns(baseDb, reg.name)) : null;
            const cols = dataColumns(columns);
            const natural = parseIdentity(reg);

            const localBuilt = buildMaps(reg, readRows(localDb, reg.name));
            if (localBuilt.duplicates.length && reg.name === 'modules_data') {
                for (const dupId of localBuilt.duplicates) {
                    localDb.run('DELETE FROM modules_data WHERE id = ?', [dupId]);
                    stats.changed = true;
                }
            }
            const localMap = stripLocalOnly(reg, localBuilt.map);
            const remoteMap = stripLocalOnly(reg, buildMaps(reg, readRows(remoteDb, reg.name)).map);
            const baseMap = baseDb && tableExists(baseDb, reg.name)
                ? stripLocalOnly(reg, buildMaps(reg, readRows(baseDb, reg.name)).map)
                : new Map();

            const writableUpdateCols = (sourceCols) => columns.filter(c => c !== 'id' && (sourceCols.has(c) || c === 'rev' || c === 'rev_device'));
            const keys = new Set([...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()]);
            for (const key of keys) {
                const local = localMap.get(key);
                const remote = remoteMap.get(key);
                const base = baseMap.get(key);
                const rowUid = remote?.uid || local?.uid || base?.uid || '';
                const tombKey = natural ? key : (local?.uid || remote?.uid || '');

                if (local && remote) {
                    if (hasRemoteTable && canonicalRowsEqual(reg, cols, local, localIdToUid, localColsSet, remote, remoteIdToUid, remoteCols)) continue;

                    const isTaskBoard = reg.name === 'modules_data' && key === 'type=plugin|name=task';
                    if (base && (!baseCols || hasRemoteTable) && canonicalRowsEqual(reg, cols, local, localIdToUid, localColsSet, base, baseIdToUid, baseCols)) {
                        // Remote-only change
                        const resolved = resolveRefs(remote, reg, remoteIdToUid, localIdByUid);
                        if (!resolved) { stats.skipped++; logConflict(localDb, reg.name, rowUid, 'missing_parent', rowRev(local), rowRev(remote), 'skipped'); continue; }
                        const values = { ...resolved };
                        if (reg.name === 'skill_project_messages' && remoteCols.has('meta')) {
                            values.meta = remapSkillMessageMeta(values.meta, remoteIdToUid, localIdByUid);
                        }
                        if (natural) values.uid = local.uid;
                        if (resolveUniqueCollisions(localDb, reg, values, local.id)) {
                            stats.conflicts++;
                            logConflict(localDb, reg.name, rowUid, 'unique_collision', rowRev(local), rowRev(remote), 'renamed');
                        }
                        applyRowUpdate(localDb, reg, writableUpdateCols(remoteCols), values, local);
                        stats.updated++;
                        stats.changed = true;
                        continue;
                    }
                    if (base && (!hasRemoteTable || canonicalRowsEqual(reg, cols, remote, remoteIdToUid, remoteCols, base, baseIdToUid, baseCols))) {
                        continue; // Local-only change
                    }

                    if (!base) {
                        const winnerIsRemote = compareRows(local, remote) < 0;
                        if (isTaskBoard && !valueEqual(local.content, remote.content)) {
                            const mergedJson = mergeTaskBoardJson(null, local.content, remote.content, winnerIsRemote);
                            if (mergedJson !== null) {
                                const values = {
                                    ...(winnerIsRemote ? remote : local),
                                    content: mergedJson,
                                    rev: maxRev(rowRev(local), rowRev(remote)),
                                    rev_device: winnerIsRemote ? (remote.rev_device || '') : (local.rev_device || '')
                                };
                                if (natural) values.uid = local.uid;
                                if (!valueEqual(values.content, local.content)) {
                                    applyRowUpdate(localDb, reg, writableUpdateCols(remoteCols), values, local);
                                    stats.updated++;
                                    stats.merged++;
                                    stats.changed = true;
                                }
                                continue;
                            }
                        }
                        if (!winnerIsRemote) continue;
                        const resolved = resolveRefs(remote, reg, remoteIdToUid, localIdByUid);
                        if (!resolved) { stats.skipped++; logConflict(localDb, reg.name, rowUid, 'insert_collision', rowRev(local), rowRev(remote), 'skipped'); continue; }
                        const values = { ...resolved };
                        if (reg.name === 'skill_project_messages' && remoteCols.has('meta')) {
                            values.meta = remapSkillMessageMeta(values.meta, remoteIdToUid, localIdByUid);
                        }
                        if (natural) values.uid = local.uid;
                        if (resolveUniqueCollisions(localDb, reg, values, local.id)) {
                            stats.conflicts++;
                            logConflict(localDb, reg.name, rowUid, 'unique_collision', rowRev(local), rowRev(remote), 'renamed');
                        }
                        applyRowUpdate(localDb, reg, writableUpdateCols(remoteCols), values, local);
                        stats.updated++;
                        stats.changed = true;
                        stats.conflicts++;
                        logConflict(localDb, reg.name, rowUid, 'created_both', rowRev(local), rowRev(remote), 'lww');
                        continue;
                    }

                    // Both sides edited the same row: field-level merge.
                    const { row: merged, conflicts, winnerIsRemote } = mergeChangedRows({
                        reg, columns, cols, base, local, remote,
                        remoteCols, baseCols, localIdToUid, remoteIdToUid, baseIdToUid, localIdByUid
                    });
                    if (isTaskBoard && !valueEqual(local.content, remote.content)) {
                        const mergedJson = mergeTaskBoardJson(base.content, local.content, remote.content, winnerIsRemote);
                        if (mergedJson !== null) merged.content = mergedJson;
                    }
                    if (natural) merged.uid = local.uid;
                    if (resolveUniqueCollisions(localDb, reg, merged, local.id)) {
                        stats.conflicts++;
                        logConflict(localDb, reg.name, rowUid, 'unique_collision', rowRev(local), rowRev(remote), 'renamed');
                    }
                    const updateCols = writableUpdateCols(remoteCols);
                    const dataUpdateCols = dataColumns(updateCols);
                    if (!rowsEqual(dataUpdateCols, merged, local)) {
                        applyRowUpdate(localDb, reg, updateCols, merged, local);
                        stats.updated++;
                        stats.merged++;
                        stats.changed = true;
                    }
                    if (conflicts.length) {
                        stats.conflicts += conflicts.length;
                        logConflict(localDb, reg.name, rowUid, 'fields:' + conflicts.join(','), rowRev(local), rowRev(remote), winnerIsRemote ? 'remote' : 'local');
                    }
                    continue;
                }

                if (local && !remote) {
                    if (!base) continue; // Created locally only
                    if (canonicalRowsEqual(reg, cols, local, localIdToUid, localColsSet, base, baseIdToUid, baseCols)) {
                        // Deleted remotely, untouched locally.
                        applyRowDelete(localDb, reg, local);
                        localIdByUid[reg.name]?.delete(local.uid);
                        if (local.id != null) localIdToUid[reg.name]?.delete(local.id);
                        stats.deleted++;
                        stats.changed = true;
                        const existingTomb = maxTombFor(reg.name, tombKey, local.uid, base?.uid);
                        if (tombKey) upsertTombstone(localDb, reg.name, tombKey, tombstoneRev(existingTomb) || rowRev(base), existingTomb?.device || base?.rev_device);
                        continue;
                    }
                    const tomb = maxTombFor(reg.name, tombKey, local.uid, base?.uid);
                    if (tomb && SyncCore.compareRev(tomb.rev, rowRev(local)) > 0) {
                        applyRowDelete(localDb, reg, local);
                        localIdByUid[reg.name]?.delete(local.uid);
                        if (local.id != null) localIdToUid[reg.name]?.delete(local.id);
                        stats.deleted++;
                        stats.changed = true;
                        if (tombKey) upsertTombstone(localDb, reg.name, tombKey, tomb.rev, tomb.device);
                        stats.conflicts++;
                        logConflict(localDb, reg.name, tombKey || local.uid, 'delete_vs_update', rowRev(local), tomb.rev, 'deleted');
                    } else {
                        stats.conflicts++;
                        logConflict(localDb, reg.name, tombKey || local.uid, 'delete_vs_update', rowRev(local), tombstoneRev(tomb), 'kept');
                    }
                    continue;
                }

                if (!local && remote) {
                    if (base && canonicalRowsEqual(reg, cols, remote, remoteIdToUid, remoteCols, base, baseIdToUid, baseCols)) continue; // Deleted locally, remote untouched
                    if (base) {
                        const tomb = maxTombFor(reg.name, tombKey, remote.uid, base?.uid);
                        if (tomb && SyncCore.compareRev(tomb.rev, rowRev(remote)) > 0) {
                            stats.conflicts++;
                            logConflict(localDb, reg.name, tombKey || remote.uid, 'delete_vs_update', tomb.rev, rowRev(remote), 'deleted');
                            continue;
                        }
                    }
                    const resolved = resolveRefs(remote, reg, remoteIdToUid, localIdByUid);
                    if (!resolved) {
                        stats.skipped++;
                        logConflict(localDb, reg.name, rowUid, 'missing_parent', '', rowRev(remote), 'skipped');
                        continue;
                    }
                    const values = { ...resolved };
                    if (reg.name === 'skill_project_messages' && remoteCols.has('meta')) {
                        values.meta = remapSkillMessageMeta(values.meta, remoteIdToUid, localIdByUid);
                    }
                    if (!values.uid) values.uid = remote.uid || randomId(16);
                    if (resolveUniqueCollisions(localDb, reg, values, null)) {
                        stats.conflicts++;
                        logConflict(localDb, reg.name, rowUid, 'unique_collision', '', rowRev(remote), 'renamed');
                    }
                    const insertCols = columns.filter(c => c !== 'id' && (remoteCols.has(c) || c === 'uid' || c === 'rev' || c === 'rev_device'));
                    const newId = applyRowInsert(localDb, reg.name, insertCols, values);
                    if (newId != null) {
                        localIdByUid[reg.name]?.set(values.uid, newId);
                        localIdToUid[reg.name]?.set(newId, values.uid);
                        if (tombKey) dropTombstone(localDb, reg.name, tombKey);
                        if (remote.uid && remote.uid !== tombKey) dropTombstone(localDb, reg.name, remote.uid);
                        stats.inserted++;
                        stats.changed = true;
                        if (base) {
                            stats.conflicts++;
                            logConflict(localDb, reg.name, rowUid, 'delete_vs_update', '', rowRev(remote), 'resurrected');
                        }
                    }
                    continue;
                }
            }
        }

        // Import tombstones created on the remote device for rows that do not exist here.
        for (const reg of SYNC_TABLES) {
            if (!tableExists(localDb, reg.name)) continue;
            const natural = parseIdentity(reg);
            const liveRows = readRows(localDb, reg.name);
            const survivingKeys = new Set(liveRows.map(r => rowIdentity(reg.name, r)).filter(Boolean));
            const survivingUids = new Set(liveRows.map(r => r.uid).filter(Boolean));
            const naturalPrefix = natural ? `${natural[0]}=` : '';
            for (const [key, tomb] of remoteTombs) {
                if (!key.startsWith(reg.name + '\u0000')) continue;
                const uid = tomb.row_uid;
                if (!uid) continue;
                if (natural) {
                    if (!uid.startsWith(naturalPrefix)) continue;
                    if (survivingKeys.has(uid)) { dropTombstone(localDb, reg.name, uid); continue; }
                } else if (survivingUids.has(uid)) {
                    dropTombstone(localDb, reg.name, uid);
                    continue;
                }
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
