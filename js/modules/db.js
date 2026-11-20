/*
---ARU-LAB.SPACE---ALMATY---2026---
Local database client powered by SQL.js and IndexedDB for persistent storage of chat and vector data.
---chat.aru-lab.space---PWA---
*/
import { UI } from './ui.js';
import { SyncCore } from './sync/syncCore.js';
import { ensureSyncSchema, readDirtyState } from './sync/syncSchema.js';
import { DBSchemaMethods } from './dbSchema.js';
import { DBFitMethods } from './dbFit.js';
// Never leave the device through P2P transfer; the receiver enters their own.
const TRANSFER_SECRET_SETTINGS = new Set([
    'db_password',
    'gemini_key',
    'openrouter_key',
    'custom_key',
    'tavily_key'
]);

export const DB = {
    db: null,
    SQL: null,
    dbPath: 'aru_db_v1', // Key for IndexedDB (default)
    fileHandle: null, // Handle for File System Access API


    async init() {
        console.log("DB: Initializing...");
        this._syncReady = false;

        // Loads the SQL.js WebAssembly environment layer
        if (!window.initSqlJs) {
            console.error("SQL.js not loaded!");
            return false;
        }

        this.SQL = await window.initSqlJs({
            // Points the assembly reference to localized or CDN structures
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });

        try {
            // Determine active DB key (allow multiple DBs)
            const activeKey = localStorage.getItem('aru_active_db') || this.dbPath;
            this.dbPath = activeKey;

            // Restores existing configuration structures from IndexedDB utilizing the requested state key
            const savedData = await localforage.getItem(this.dbPath);
            this.handleKey = `aru_handle_${this.dbPath}`;
            this.fileHandle = await localforage.getItem(this.handleKey);
            // Validate file handle: only clear if permanently invalid or denied. 
            // Do NOT clear if it just needs a user gesture ('prompt').
            if (this.fileHandle) {
                try {
                    const status = await this.fileHandle.queryPermission({ mode: 'readwrite' });
                    if (status === 'denied') {
                        console.warn('DB.init: stored file handle permission denied, clearing');
                        await localforage.removeItem(this.handleKey);
                        this.fileHandle = null;
                        const deniedMsg = window.aruState?.translations?.sync_error_file_denied || 'Database file access permission was denied';
                        if (window.app && window.app.updateSyncStatus) window.app.updateSyncStatus('error', deniedMsg);
                    } else if (status === 'prompt') {
                        console.log('DB.init: file handle exists but needs re-authorization');
                        // Exposes unresolved handle dependencies to UI layer for authorization
                        if (window.app && window.app.updateSyncStatus) window.app.updateSyncStatus('needs-auth');
                    }
                } catch (e) {
                    console.warn('DB.init: error while validating file handle', e);
                    // Suppresses critical handle purges to bypass transient DOM operational errors
                }
            }

            if (savedData) {
                console.log("DB: Found existing data. Loading... (key=", this.dbPath, ")");
                try {
                    this.db = new this.SQL.Database(new Uint8Array(savedData));

                    let canPersist = !this.fileHandle;
                    if (this.fileHandle) {
                        try { canPersist = (await this.fileHandle.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch (permErr) { canPersist = false; }
                    }

                    // Self-healing forward migration: upgrades existing databases in place (folders, favorites, chapters)
                    try {
                        if (this.migrateSchema()) {
                            if (canPersist) {
                                await this.save();
                            } else {
                                console.log('DB: schema migrated in memory; file write deferred until access is authorized');
                            }
                        }
                    } catch (migErr) {
                        console.warn('DB: forward migration on load failed', migErr);
                    }

                    // Flush any pending plugin saves that were queued before DB was ready
                    try {
                        const pending = localStorage.getItem('task_plugin_pending');
                        if (pending) {
                            const parsed = JSON.parse(pending);
                            this.savePluginData('task', parsed, false);
                            if (canPersist) {
                                await this.save();
                                localStorage.removeItem('task_plugin_pending');
                                console.log('DB: flushed pending plugin data for task plugin');
                            } else {
                                console.log('DB: pending plugin data applied in memory; file write deferred until access is authorized');
                            }
                        }
                    } catch (e) {
                        console.warn('DB: failed to flush pending plugin data', e);
                    }

                    // Notify other modules that DB is initialized
                    try { window.dispatchEvent(new CustomEvent('aru-db-initialized', { detail: { status: 'loaded' } })); } catch (e) {}

                    return 'loaded';
                } catch (sqlErr) {
                    console.error("DB: Corrupt database detected", sqlErr);
                    // Secures a localized snapshot backup of the compromised database architecture
                    await localforage.setItem(this.dbPath + '_corrupt_backup', savedData);
                    const t = window.aruState?.translations || {};
                    await UI.alert(t.alert_corrupt_db_backup || "Attention: Database is corrupt. A backup has been created (corrupt_backup) and a new database will be initialized.");

                    try { window.dispatchEvent(new CustomEvent('aru-db-initialized', { detail: { status: 'empty' } })); } catch (e) {}
                    return 'empty';
                }
            } else {
                console.log("DB: No data found for key", this.dbPath, ". Waiting for creation.");
                try { window.dispatchEvent(new CustomEvent('aru-db-initialized', { detail: { status: 'empty' } })); } catch (e) {}
                return 'empty';
            }
        } catch (e) {
            console.error("DB: Init failed", e);
            return 'error';
        }
    },

    async createDB(passwordHash) {
        console.log("DB: Creating new database...");
        this._syncReady = false;
        this.fileHandle = null;
        if (!this.SQL) {
            console.log("DB: SQL not ready, re-initializing...");
            await this.init();
        }
        if (this.db) {
            try { this.db.close(); } catch (_) {}
        }
        this.db = new this.SQL.Database();
        this.initSchema();
        this.migrateSchema();
        // Persists root database settings utilizing UPSERT operations to bypass schema collisions
        this.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ['db_password', passwordHash], false);
        this.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ['rules', '0'], false);
        await this.save();
        try { window.dispatchEvent(new CustomEvent('aru-db-initialized', { detail: { status: 'loaded' } })); } catch (e) {}
        return true;
    },

    /**
     * Create DB with explicit key (optional). If dbKey provided, set active DB to it.
     */
    async createDBWithKey(passwordHash, dbKey) {
        try { window.SyncEngine?.stop?.(); } catch (_) {}
        try { window.RemoteStorage?.lock?.(); } catch (_) {}
        this.fileHandle = null;
        if (dbKey) {
            this.dbPath = dbKey;
            localStorage.setItem('aru_active_db', dbKey);
        } else {
            if (!this.dbPath || this.dbPath === 'aru_db_v1') this.dbPath = 'aru_db_' + Date.now();
            localStorage.setItem('aru_active_db', this.dbPath);
        }
        this.handleKey = `aru_handle_${this.dbPath}`;
        return await this.createDB(passwordHash);
    },

    ...DBSchemaMethods,

    // --- Personality State Helpers ---
    getPersonalityState(key = 'global') {
        try {
            const rows = this.query("SELECT * FROM personality_state WHERE key = ? LIMIT 1", [key]);
            if (rows && rows.length > 0) {
                const r = rows[0];
                return { mood: parseInt(r.mood), sarcasm: parseInt(r.sarcasm), humor: parseInt(r.humor), affinity: parseInt(r.affinity || 0), updated_at: r.updated_at };
            }
            return null;
        } catch (e) {
            console.error('DB.getPersonalityState failed', e);
            return null;
        }
    },

    savePersonalityState(key = 'global', { mood = 50, sarcasm = 0, humor = 50, affinity = 0 } = {}) {
        try {
            const existing = this.query("SELECT id FROM personality_state WHERE key = ?", [key]);
            if (existing && existing.length > 0) {
                this.run("UPDATE personality_state SET mood = ?, sarcasm = ?, humor = ?, affinity = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?", [mood, sarcasm, humor, affinity, key]);
            } else {
                this.run("INSERT INTO personality_state (key, mood, sarcasm, humor, affinity) VALUES (?, ?, ?, ?, ?)", [key, mood, sarcasm, humor, affinity]);
            }
        } catch (e) {
            console.error('DB.savePersonalityState failed', e);
        }
    },

    // --- Core Operations ---

    run(sql, params = [], autoSave = true) {
        if (!this.db) return;
        // Stamp the hybrid logical clock before every write so triggers can
        // label the changed rows without calling back into JS.
        if (this._syncReady) {
            const head = sql.trimStart().slice(0, 6).toUpperCase();
            if (head.startsWith('INSERT') || head.startsWith('UPDATE') || head.startsWith('DELETE') || head.startsWith('REPLACE')) {
                try {
                    this.db.run('UPDATE _sync_ctx SET hlc = ?, device = ? WHERE id = 1', [SyncCore.nextRev(), SyncCore.deviceId()]);
                } catch (e) { /* sync schema is optional */ }
            }
        }
        this.db.run(sql, params);
        // Auto-save on modification (except selects)
        if (autoSave && !sql.trim().toUpperCase().startsWith("SELECT")) {
            this.save();
        }
    },

    exec(sql) {
        if (!this.db) return [];
        return this.db.exec(sql);
    },

    // Simplified Query Helper: returns array of objects
    query(sql, params = []) {
        if (!this.db) return [];
        const stmt = this.db.prepare(sql);
        try {
            stmt.bind(params);
            const results = [];
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            return results;
        } finally {
            stmt.free();
        }
    },

    savePluginData(pluginId, data, autoSave = true) {
        try {
            const content = JSON.stringify(data);
            const existing = this.query("SELECT id FROM modules_data WHERE type = 'plugin' AND name = ?", [pluginId]);
            if (existing && existing.length > 0) {
                this.run("UPDATE modules_data SET content = ?, created_at = CURRENT_TIMESTAMP WHERE type = 'plugin' AND name = ?", [content, pluginId], autoSave);
            } else {
                this.run("INSERT INTO modules_data (type, name, content) VALUES ('plugin', ?, ?)", [pluginId, content], autoSave);
            }
        } catch (e) {
            console.error(`DB.savePluginData failed for ${pluginId}`, e);
        }
    },

    getPluginData(pluginId) {
        try {
            const rows = this.query("SELECT content FROM modules_data WHERE type = 'plugin' AND name = ? LIMIT 1", [pluginId]);
            if (rows && rows.length > 0) {
                return JSON.parse(rows[0].content);
            }
            return null;
        } catch (e) {
            console.error(`DB.getPluginData failed for ${pluginId}`, e);
            return null;
        }
    },

    // --- Aru Skills: skill library, projects, relay pipelines and run history ---
    // FK constraints are not enforced by sql.js, so deletions cascade manually.

    _skillTableFields: {
        skills: ['title', 'system_prompt', 'llm_type', 'api_key', 'base_url', 'model_name', 'temperature', 'input_limit', 'max_output'],
        skill_projects: ['title', 'context_limit'],
        skill_project_items: ['kind', 'name', 'content'],
        skill_pipeline_steps: ['skill_id', 'sort_order', 'enabled', 'is_final'],
        skill_runs: ['input_text', 'status'],
        skill_run_steps: ['step_id', 'step_order', 'skill_id', 'skill_title', 'provider', 'model', 'input_text', 'output_text', 'status', 'error', 'tokens_est', 'truncated'],
        skill_artifacts: ['project_id', 'run_id', 'title', 'type', 'code'],
        skill_project_messages: ['project_id', 'kind', 'content', 'meta'],
    },

    _lastInsertId(fallbackTable) {
        const res = this.exec("SELECT last_insert_rowid() as id");
        let id = (res && res[0] && res[0].values && res[0].values[0]) ? res[0].values[0][0] : null;
        if (id === null || id === 0) {
            const fallback = this.query(`SELECT id FROM ${fallbackTable} ORDER BY id DESC LIMIT 1`);
            id = fallback.length > 0 ? fallback[0].id : null;
        }
        return id;
    },

    // Updates only whitelisted columns; values are bound, table/columns come from fixed lists
    _skillUpdate(table, id, data) {
        const allowed = this._skillTableFields[table] || [];
        const sets = [];
        const values = [];
        for (const key of allowed) {
            if (data[key] !== undefined) {
                sets.push(`${key} = ?`);
                values.push(data[key]);
            }
        }
        if (!sets.length) return false;
        const touch = (table === 'skills' || table === 'skill_projects' || table === 'skill_runs' || table === 'skill_artifacts') ? ', updated_at = CURRENT_TIMESTAMP' : '';
        values.push(id);
        this.run(`UPDATE ${table} SET ${sets.join(', ')}${touch} WHERE id = ?`, values);
        return true;
    },

    createSkill(data) {
        const d = data || {};
        this.run(`INSERT INTO skills (title, system_prompt, llm_type, api_key, base_url, model_name, temperature, input_limit, max_output)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [d.title || 'Skill', d.system_prompt || '', d.llm_type || 'gemini', d.api_key || '', d.base_url || '', d.model_name || '', d.temperature ?? 0.9, d.input_limit ?? 4096, d.max_output ?? 2048]);
        return this._lastInsertId('skills');
    },

    getSkills() {
        return this.query("SELECT * FROM skills ORDER BY title COLLATE NOCASE ASC");
    },

    getSkill(id) {
        const rows = this.query("SELECT * FROM skills WHERE id = ? LIMIT 1", [id]);
        return rows.length > 0 ? rows[0] : null;
    },

    updateSkill(id, data) { return this._skillUpdate('skills', id, data); },

    deleteSkill(id) {
        this.run("UPDATE skill_run_steps SET skill_id = NULL WHERE skill_id = ?", [id], false);
        this.run("DELETE FROM skill_pipeline_steps WHERE skill_id = ?", [id], false);
        this.run("DELETE FROM skills WHERE id = ?", [id]);
    },

    createSkillProject(title, contextLimit = 16384) {
        this.run("INSERT INTO skill_projects (title, context_limit) VALUES (?, ?)", [title || 'Project', contextLimit]);
        return this._lastInsertId('skill_projects');
    },

    getSkillProjects() {
        return this.query("SELECT * FROM skill_projects ORDER BY updated_at DESC");
    },

    getSkillProject(id) {
        const rows = this.query("SELECT * FROM skill_projects WHERE id = ? LIMIT 1", [id]);
        return rows.length > 0 ? rows[0] : null;
    },

    updateSkillProject(id, data) { return this._skillUpdate('skill_projects', id, data); },

    deleteSkillProject(id) {
        if (this.tableExists('artifact_storage')) {
            const escLike = (v) => String(v).replace(/[\\%_]/g, '\\$&');
            const uid = this.getSkillProjectUid(id);
            this.run(
                "DELETE FROM artifact_storage WHERE scope_key LIKE ? ESCAPE '\\' OR scope_key LIKE ? ESCAPE '\\'",
                [`skill:${escLike(uid)}:%`, `skill:id:${escLike(id)}:%`],
                false
            );
        }
        this.run("DELETE FROM skill_project_items WHERE project_id = ?", [id], false);
        this.run("DELETE FROM skill_pipeline_steps WHERE project_id = ?", [id], false);
        this.run("DELETE FROM skill_artifacts WHERE project_id = ?", [id], false);
        this.run("DELETE FROM skill_project_messages WHERE project_id = ?", [id], false);
        const runs = this.query("SELECT id FROM skill_runs WHERE project_id = ?", [id]);
        for (const r of runs) {
            this.run("DELETE FROM skill_run_steps WHERE run_id = ?", [r.id], false);
        }
        this.run("DELETE FROM skill_runs WHERE project_id = ?", [id], false);
        this.run("DELETE FROM skill_projects WHERE id = ?", [id]);
    },

    addSkillProjectItem(projectId, item) {
        const d = item || {};
        this.run("INSERT INTO skill_project_items (project_id, kind, name, content) VALUES (?, ?, ?, ?)",
            [projectId, d.kind || 'file', d.name || '', d.content || '']);
        return this._lastInsertId('skill_project_items');
    },

    getSkillProjectItems(projectId) {
        return this.query("SELECT * FROM skill_project_items WHERE project_id = ? ORDER BY id ASC", [projectId]);
    },

    updateSkillProjectItem(id, data) { return this._skillUpdate('skill_project_items', id, data); },

    deleteSkillProjectItem(id) {
        this.run("DELETE FROM skill_project_items WHERE id = ?", [id]);
    },

    addPipelineStep(projectId, skillId) {
        const max = this.query("SELECT MAX(sort_order) AS m FROM skill_pipeline_steps WHERE project_id = ?", [projectId]);
        const order = (max.length > 0 && max[0].m !== null) ? max[0].m + 1 : 0;
        this.run("INSERT INTO skill_pipeline_steps (project_id, skill_id, sort_order) VALUES (?, ?, ?)", [projectId, skillId, order]);
        return this._lastInsertId('skill_pipeline_steps');
    },

    getPipelineSteps(projectId) {
        return this.query(`SELECT s.*, k.title AS skill_title, k.llm_type AS skill_llm_type, k.model_name AS skill_model_name
            FROM skill_pipeline_steps s LEFT JOIN skills k ON k.id = s.skill_id
            WHERE s.project_id = ? ORDER BY s.sort_order ASC, s.id ASC`, [projectId]);
    },

    updatePipelineStep(id, data) {
        if (data.is_final === 1 || data.is_final === '1') {
            const rows = this.query("SELECT project_id FROM skill_pipeline_steps WHERE id = ?", [id]);
            if (rows.length > 0) {
                this.run("UPDATE skill_pipeline_steps SET is_final = 0 WHERE project_id = ? AND id != ?", [rows[0].project_id, id], false);
            }
        }
        return this._skillUpdate('skill_pipeline_steps', id, data);
    },

    deletePipelineStep(id) {
        this.run("UPDATE skill_run_steps SET step_id = NULL WHERE step_id = ?", [id], false);
        this.run("DELETE FROM skill_pipeline_steps WHERE id = ?", [id]);
    },

    // orderedIds: array of step ids in the new relay order
    setPipelineOrder(projectId, orderedIds) {
        if (!Array.isArray(orderedIds)) return;
        orderedIds.forEach((stepId, idx) => {
            this.run("UPDATE skill_pipeline_steps SET sort_order = ? WHERE id = ? AND project_id = ?", [idx, stepId, projectId], false);
        });
        this.save();
    },

    createSkillRun(projectId, inputText) {
        this.run("INSERT INTO skill_runs (project_id, input_text, status) VALUES (?, ?, 'pending')", [projectId, inputText || '']);
        return this._lastInsertId('skill_runs');
    },

    getSkillRuns(projectId, limit = 20) {
        return this.query("SELECT * FROM skill_runs WHERE project_id = ? ORDER BY id DESC LIMIT ?", [projectId, limit]);
    },

    getSkillRun(id) {
        const rows = this.query("SELECT * FROM skill_runs WHERE id = ? LIMIT 1", [id]);
        return rows.length > 0 ? rows[0] : null;
    },

    updateSkillRun(id, data) { return this._skillUpdate('skill_runs', id, data); },

    deleteSkillRun(id) {
        if (this.tableExists('skill_artifacts')) {
            this.run("UPDATE skill_artifacts SET run_id = NULL WHERE run_id = ?", [id], false);
        }
        this.run("DELETE FROM skill_run_steps WHERE run_id = ?", [id], false);
        this.run("DELETE FROM skill_runs WHERE id = ?", [id]);
    },

    // Keeps only the newest `keep` runs of a project (auto-cleanup of bulky run history)
    trimSkillRuns(projectId, keep = 15) {
        const rows = this.query("SELECT id FROM skill_runs WHERE project_id = ? ORDER BY id DESC", [projectId]);
        const stale = rows.slice(keep);
        const hasArtifacts = stale.length > 0 && this.tableExists('skill_artifacts');
        for (const r of stale) {
            if (hasArtifacts) {
                this.run("UPDATE skill_artifacts SET run_id = NULL WHERE run_id = ?", [r.id], false);
            }
            this.run("DELETE FROM skill_run_steps WHERE run_id = ?", [r.id], false);
            this.run("DELETE FROM skill_runs WHERE id = ?", [r.id], false);
        }
        if (stale.length > 0) this.save();
        return stale.length;
    },

    addSkillRunStep(runId, data) {
        const d = data || {};
        this.run(`INSERT INTO skill_run_steps (run_id, step_id, step_order, skill_id, skill_title, provider, model, input_text, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [runId, d.step_id ?? null, d.step_order ?? 0, d.skill_id ?? null, d.skill_title || '', d.provider || '', d.model || '', d.input_text || '', d.status || 'pending']);
        return this._lastInsertId('skill_run_steps');
    },

    getSkillRunSteps(runId) {
        return this.query("SELECT * FROM skill_run_steps WHERE run_id = ? ORDER BY step_order ASC, id ASC", [runId]);
    },

    getSkillRunStep(id) {
        const rows = this.query("SELECT * FROM skill_run_steps WHERE id = ? LIMIT 1", [id]);
        return rows.length > 0 ? rows[0] : null;
    },

    updateSkillRunStep(id, data) { return this._skillUpdate('skill_run_steps', id, data); },

    // Artifacts produced by a relay run; titles are unique per project so a re-run
    // of the same deliverable updates the row instead of piling up copies
    saveSkillArtifact(projectId, runId, title, type, code) {
        const existing = this.query("SELECT id FROM skill_artifacts WHERE project_id = ? AND title = ?", [projectId, title]);
        if (existing.length > 0) {
            this.run("UPDATE skill_artifacts SET run_id = ?, type = ?, code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                [runId ?? null, type || 'doc', code || '', existing[0].id]);
            return existing[0].id;
        }
        this.run("INSERT INTO skill_artifacts (project_id, run_id, title, type, code) VALUES (?, ?, ?, ?, ?)",
            [projectId, runId ?? null, title || 'Artifact', type || 'doc', code || '']);
        return this._lastInsertId('skill_artifacts');
    },

    getSkillArtifacts(projectId) {
        return this.query("SELECT * FROM skill_artifacts WHERE project_id = ? ORDER BY updated_at DESC, id DESC", [projectId]);
    },

    getSkillArtifact(id) {
        const rows = this.query("SELECT * FROM skill_artifacts WHERE id = ? LIMIT 1", [id]);
        return rows.length > 0 ? rows[0] : null;
    },

    getSkillArtifactByTitle(projectId, title) {
        const rows = this.query("SELECT * FROM skill_artifacts WHERE project_id = ? AND title = ? LIMIT 1", [projectId, title]);
        return rows.length > 0 ? rows[0] : null;
    },

    deleteSkillArtifact(id) {
        this.run("DELETE FROM skill_artifacts WHERE id = ?", [id]);
    },

    // --- Skill project chat thread ---

    // Threads are capped so a long-lived project cannot grow the sync payload without
    // bound; the oldest messages go first, the relay history itself stays in skill_runs.
    addSkillProjectMessage(projectId, kind, content, meta) {
        this.run("INSERT INTO skill_project_messages (project_id, kind, content, meta) VALUES (?, ?, ?, ?)",
            [projectId, kind || 'user', content || '', meta ? JSON.stringify(meta) : null]);
        const id = this._lastInsertId('skill_project_messages');
        const rows = this.query("SELECT id FROM skill_project_messages WHERE project_id = ? ORDER BY id ASC", [projectId]);
        if (rows.length > 300) {
            const cut = rows.slice(0, rows.length - 300).map(r => r.id);
            this.run(`DELETE FROM skill_project_messages WHERE id IN (${cut.map(() => '?').join(',')})`, cut, false);
            this.save();
        }
        return id;
    },

    getSkillProjectMessages(projectId, limit = 300) {
        return this.query("SELECT * FROM skill_project_messages WHERE project_id = ? ORDER BY id DESC LIMIT ?", [projectId, limit]).reverse();
    },

    getSkillProjectMessage(id) {
        const rows = this.query("SELECT * FROM skill_project_messages WHERE id = ? LIMIT 1", [id]);
        return rows.length > 0 ? rows[0] : null;
    },

    updateSkillProjectMessage(id, data) {
        const d = Object.assign({}, data);
        if (d.meta !== undefined && typeof d.meta !== 'string') d.meta = d.meta ? JSON.stringify(d.meta) : null;
        return this._skillUpdate('skill_project_messages', id, d);
    },

    deleteSkillProjectMessage(id) {
        this.run("DELETE FROM skill_project_messages WHERE id = ?", [id]);
    },

    clearSkillProjectMessages(projectId) {
        this.run("DELETE FROM skill_project_messages WHERE project_id = ?", [projectId]);
    },

    ...DBFitMethods,

    // --- Skills export/import helpers ---

    _skillDdl() {
        return [
            `CREATE TABLE IF NOT EXISTS skills (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, system_prompt TEXT, llm_type TEXT DEFAULT 'gemini', api_key TEXT DEFAULT '', base_url TEXT DEFAULT '', model_name TEXT DEFAULT '', temperature REAL DEFAULT 0.9, input_limit INTEGER DEFAULT 4096, max_output INTEGER DEFAULT 2048, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
            `CREATE TABLE IF NOT EXISTS skill_projects (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, context_limit INTEGER DEFAULT 16384, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
            `CREATE TABLE IF NOT EXISTS skill_project_items (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, kind TEXT DEFAULT 'file', name TEXT, content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
            `CREATE TABLE IF NOT EXISTS skill_pipeline_steps (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, skill_id INTEGER, sort_order INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, is_final INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
            `CREATE TABLE IF NOT EXISTS skill_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, input_text TEXT, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
            `CREATE TABLE IF NOT EXISTS skill_run_steps (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, step_id INTEGER, step_order INTEGER, skill_id INTEGER, skill_title TEXT, provider TEXT, model TEXT, input_text TEXT, output_text TEXT, status TEXT DEFAULT 'pending', error TEXT, tokens_est INTEGER DEFAULT 0, truncated INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
            `CREATE TABLE IF NOT EXISTS skill_artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, run_id INTEGER, title TEXT, type TEXT DEFAULT 'doc', code TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, title))`,
            `CREATE TABLE IF NOT EXISTS skill_project_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, kind TEXT DEFAULT 'user', content TEXT, meta TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
        ];
    },

    // Inserts skill payload keeping original ids. `target` is this DB or a raw sql.js Database (transfer tempDb)
    _insertSkillDataRaw(target, data) {
        if (!data) return;
        const runSql = (target === this) ? (sql, p) => this.run(sql, p, false) : (sql, p) => target.run(sql, p);
        const num = (v) => (v === undefined || v === null) ? null : Number(v);
        for (const s of data.skills || []) {
            runSql("INSERT INTO skills (id, title, system_prompt, llm_type, api_key, base_url, model_name, temperature, input_limit, max_output, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [num(s.id), s.title || 'Skill', s.system_prompt || '', s.llm_type || 'gemini', s.api_key || '', s.base_url || '', s.model_name || '', num(s.temperature ?? 0.9), num(s.input_limit ?? 4096), num(s.max_output ?? 2048), s.created_at || null, s.updated_at || null]);
        }
        for (const p of data.skill_projects || []) {
            runSql("INSERT INTO skill_projects (id, title, context_limit, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                [num(p.id), p.title || 'Project', num(p.context_limit ?? 16384), p.created_at || null, p.updated_at || null]);
        }
        for (const it of data.skill_project_items || []) {
            runSql("INSERT INTO skill_project_items (id, project_id, kind, name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                [num(it.id), num(it.project_id), it.kind || 'file', it.name || '', it.content || '', it.created_at || null]);
        }
        for (const st of data.skill_pipeline_steps || []) {
            runSql("INSERT INTO skill_pipeline_steps (id, project_id, skill_id, sort_order, enabled, is_final, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [num(st.id), num(st.project_id), num(st.skill_id), num(st.sort_order ?? 0), num(st.enabled ?? 1), num(st.is_final ?? 0), st.created_at || null]);
        }
        for (const r of data.skill_runs || []) {
            runSql("INSERT INTO skill_runs (id, project_id, input_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                [num(r.id), num(r.project_id), r.input_text || '', r.status || 'pending', r.created_at || null, r.updated_at || null]);
        }
        for (const rs of data.skill_run_steps || []) {
            runSql("INSERT INTO skill_run_steps (id, run_id, step_id, step_order, skill_id, skill_title, provider, model, input_text, output_text, status, error, tokens_est, truncated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [num(rs.id), num(rs.run_id), num(rs.step_id), num(rs.step_order ?? 0), num(rs.skill_id), rs.skill_title || '', rs.provider || '', rs.model || '', rs.input_text || '', rs.output_text || '', rs.status || 'pending', rs.error ?? null, num(rs.tokens_est ?? 0), num(rs.truncated ?? 0), rs.created_at || null]);
        }
        for (const a of data.skill_artifacts || []) {
            runSql("INSERT INTO skill_artifacts (id, project_id, run_id, title, type, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [num(a.id), num(a.project_id), num(a.run_id), a.title || 'Artifact', a.type || 'doc', a.code || '', a.created_at || null, a.updated_at || null]);
        }
        for (const m of data.skill_project_messages || []) {
            runSql("INSERT INTO skill_project_messages (id, project_id, kind, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                [num(m.id), num(m.project_id), m.kind || 'user', m.content || '', m.meta ?? null, m.created_at || null]);
        }
    },

    // Merge-mode import: re-inserts with fresh ids and remaps every cross-reference
    _mergeSkillData(data) {
        if (!data) return;
        const num = (v) => (v === undefined || v === null) ? null : Number(v);
        const mapSkill = new Map(), mapProject = new Map(), mapStep = new Map(), mapRun = new Map(), mapArtifact = new Map();
        for (const s of data.skills || []) {
            this.run("INSERT INTO skills (title, system_prompt, llm_type, api_key, base_url, model_name, temperature, input_limit, max_output, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [s.title || 'Skill', s.system_prompt || '', s.llm_type || 'gemini', s.api_key || '', s.base_url || '', s.model_name || '', num(s.temperature ?? 0.9), num(s.input_limit ?? 4096), num(s.max_output ?? 2048), s.created_at || null, s.updated_at || null], false);
            mapSkill.set(Number(s.id), this._lastInsertId('skills'));
        }
        for (const p of data.skill_projects || []) {
            this.run("INSERT INTO skill_projects (title, context_limit, created_at, updated_at) VALUES (?, ?, ?, ?)",
                [p.title || 'Project', num(p.context_limit ?? 16384), p.created_at || null, p.updated_at || null], false);
            mapProject.set(Number(p.id), this._lastInsertId('skill_projects'));
        }
        for (const it of data.skill_project_items || []) {
            const pid = mapProject.get(Number(it.project_id));
            if (pid === undefined) continue;
            this.run("INSERT INTO skill_project_items (project_id, kind, name, content, created_at) VALUES (?, ?, ?, ?, ?)",
                [pid, it.kind || 'file', it.name || '', it.content || '', it.created_at || null], false);
        }
        for (const st of data.skill_pipeline_steps || []) {
            const pid = mapProject.get(Number(st.project_id));
            if (pid === undefined) continue;
            this.run("INSERT INTO skill_pipeline_steps (project_id, skill_id, sort_order, enabled, is_final, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                [pid, mapSkill.get(Number(st.skill_id)) ?? null, num(st.sort_order ?? 0), num(st.enabled ?? 1), num(st.is_final ?? 0), st.created_at || null], false);
            mapStep.set(Number(st.id), this._lastInsertId('skill_pipeline_steps'));
        }
        for (const r of data.skill_runs || []) {
            const pid = mapProject.get(Number(r.project_id));
            if (pid === undefined) continue;
            this.run("INSERT INTO skill_runs (project_id, input_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                [pid, r.input_text || '', r.status || 'pending', r.created_at || null, r.updated_at || null], false);
            mapRun.set(Number(r.id), this._lastInsertId('skill_runs'));
        }
        for (const rs of data.skill_run_steps || []) {
            const rid = mapRun.get(Number(rs.run_id));
            if (rid === undefined) continue;
            this.run("INSERT INTO skill_run_steps (run_id, step_id, step_order, skill_id, skill_title, provider, model, input_text, output_text, status, error, tokens_est, truncated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [rid, mapStep.get(Number(rs.step_id)) ?? null, num(rs.step_order ?? 0), mapSkill.get(Number(rs.skill_id)) ?? null, rs.skill_title || '', rs.provider || '', rs.model || '', rs.input_text || '', rs.output_text || '', rs.status || 'pending', rs.error ?? null, num(rs.tokens_est ?? 0), num(rs.truncated ?? 0), rs.created_at || null], false);
        }
        for (const a of data.skill_artifacts || []) {
            const pid = mapProject.get(Number(a.project_id));
            if (pid === undefined) continue;
            // UNIQUE(project_id, title): imported duplicates get a numeric suffix instead of failing
            const base = a.title || 'Artifact';
            let title = base, n = 2;
            while (this.query("SELECT id FROM skill_artifacts WHERE project_id = ? AND title = ?", [pid, title]).length > 0) {
                title = `${base} ${n++}`;
            }
            const rid = (a.run_id === undefined || a.run_id === null) ? null : (mapRun.get(Number(a.run_id)) ?? null);
            this.run("INSERT INTO skill_artifacts (project_id, run_id, title, type, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [pid, rid, title, a.type || 'doc', a.code || '', a.created_at || null, a.updated_at || null], false);
            mapArtifact.set(Number(a.id), this._lastInsertId('skill_artifacts'));
        }
        for (const m of data.skill_project_messages || []) {
            const pid = mapProject.get(Number(m.project_id));
            if (pid === undefined) continue;
            // meta points at runs and artifacts by id; remap what survived the merge and
            // drop the rest so a Thinking block never opens a run that does not exist
            let meta = m.meta ?? null;
            if (meta) {
                try {
                    const obj = JSON.parse(meta);
                    if (obj && typeof obj === 'object') {
                        if (obj.runId !== undefined && obj.runId !== null) obj.runId = mapRun.get(Number(obj.runId)) ?? null;
                        if (Array.isArray(obj.artifacts)) {
                            obj.artifacts = obj.artifacts.map(id => mapArtifact.get(Number(id))).filter(v => v !== undefined);
                        }
                        meta = JSON.stringify(obj);
                    }
                } catch (e) { /* keep the raw string when meta is not JSON */ }
            }
            this.run("INSERT INTO skill_project_messages (project_id, kind, content, meta, created_at) VALUES (?, ?, ?, ?, ?)",
                [pid, m.kind || 'user', m.content || '', meta, m.created_at || null], false);
        }
    },

    // --- Chat Operations ---

    createChat(title = 'Новый чат') {
        this.run("INSERT INTO chats (title) VALUES (?)", [title]);
        const res = this.exec("SELECT last_insert_rowid() as id");
        let id = (res && res[0] && res[0].values && res[0].values[0]) ? res[0].values[0][0] : null;

        if (id === null || id === 0) {
            // Implements a query-based boundary fallback to retrieve identifier targets safely
            const fallback = this.query("SELECT id FROM chats ORDER BY id DESC LIMIT 1");
            id = fallback.length > 0 ? fallback[0].id : 1;
            console.log("DB: createChat used fallback ID:", id);
        }

        return id;
    },

    getChats() {
        return this.query("SELECT * FROM chats ORDER BY sort_order ASC, updated_at DESC");
    },

    deleteChat(id) {
        if (this.tableExists('artifact_storage')) {
            const escLike = (v) => String(v).replace(/[\\%_]/g, '\\$&');
            const uid = this.getChatUid(id);
            this.run(
                "DELETE FROM artifact_storage WHERE scope_key LIKE ? ESCAPE '\\' OR scope_key LIKE ? ESCAPE '\\'",
                [`chat:${escLike(uid)}:%`, `chat:id:${escLike(id)}:%`],
                false
            );
        }
        this.run("DELETE FROM chat_chapters WHERE chat_id = ?", [id], false);
        this.run("DELETE FROM chat_sections WHERE chat_id = ?", [id], false);
        this.run("DELETE FROM chat_artifacts WHERE chat_id = ?", [id], false);
        this.run("DELETE FROM messages WHERE chat_id = ?", [id], false);
        this.run("DELETE FROM chats WHERE id = ?", [id]);
    },

    // --- Chat Artifacts (latest version per chat+title) ---

    saveChatArtifact(chatId, title, type, code) {
        try {
            const existing = this.query("SELECT id FROM chat_artifacts WHERE chat_id = ? AND title = ?", [chatId, title]);
            if (existing && existing.length > 0) {
                this.run("UPDATE chat_artifacts SET type = ?, code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [type, code, existing[0].id]);
            } else {
                this.run("INSERT INTO chat_artifacts (chat_id, title, type, code) VALUES (?, ?, ?, ?)", [chatId, title, type, code]);
            }
            return true;
        } catch (e) {
            console.error('DB.saveChatArtifact failed', e);
            return false;
        }
    },

    getChatArtifact(chatId, title) {
        try {
            const rows = this.query("SELECT * FROM chat_artifacts WHERE chat_id = ? AND title = ? LIMIT 1", [chatId, title]);
            return (rows && rows.length > 0) ? rows[0] : null;
        } catch (e) {
            console.error('DB.getChatArtifact failed', e);
            return null;
        }
    },

    getLatestChatArtifact(chatId) {
        try {
            const rows = this.query("SELECT * FROM chat_artifacts WHERE chat_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1", [chatId]);
            return (rows && rows.length > 0) ? rows[0] : null;
        } catch (e) {
            console.error('DB.getLatestChatArtifact failed', e);
            return null;
        }
    },

    // --- Per-Artifact Sandbox Storage ---

    ARTIFACT_STORAGE_LIMITS: {
        maxKeys: 100,
        maxKeyBytes: 256,
        maxValueBytes: 262144,
        maxScopeBytes: 2097152
    },

    _utf8ByteLength(str) {
        const s = String(str ?? '');
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
        try { return unescape(encodeURIComponent(s)).length; } catch (_) { return s.length * 2; }
    },

    getChatUid(chatId) {
        if (chatId === null || chatId === undefined) return '';
        try {
            if (this.hasColumn('chats', 'uid')) {
                const rows = this.query("SELECT uid FROM chats WHERE id = ? LIMIT 1", [chatId]);
                if (rows.length > 0 && rows[0].uid) return String(rows[0].uid);
            }
        } catch (_) {}
        return `id:${chatId}`;
    },

    getSkillProjectUid(projectId) {
        if (projectId === null || projectId === undefined) return '';
        try {
            if (this.hasColumn('skill_projects', 'uid')) {
                const rows = this.query("SELECT uid FROM skill_projects WHERE id = ? LIMIT 1", [projectId]);
                if (rows.length > 0 && rows[0].uid) return String(rows[0].uid);
            }
        } catch (_) {}
        return `id:${projectId}`;
    },

    getArtifactScopeKey({ source, type, title, chatId, projectId, isPrivate } = {}) {
        if (isPrivate || type === 'doc' || !title) return null;
        const cleanTitle = String(title);
        if (source === 'module') return `module:${type || 'app'}:${cleanTitle}`;
        if (source === 'skill' && projectId !== null && projectId !== undefined) {
            return `skill:${this.getSkillProjectUid(projectId)}:${cleanTitle}`;
        }
        if (source === 'chat' && chatId !== null && chatId !== undefined) {
            return `chat:${this.getChatUid(chatId)}:${cleanTitle}`;
        }
        return null;
    },

    getArtifactStorage(scopeKey) {
        if (!scopeKey || !this.db || !this.tableExists('artifact_storage')) return {};
        try {
            const rows = this.query("SELECT key, value FROM artifact_storage WHERE scope_key = ? ORDER BY id ASC", [scopeKey]);
            const out = {};
            for (const r of rows) out[r.key] = r.value === null || r.value === undefined ? '' : String(r.value);
            return out;
        } catch (e) {
            console.warn('DB.getArtifactStorage failed', e);
            return {};
        }
    },

    hasArtifactStorage(scopeKey) {
        if (!scopeKey || !this.db || !this.tableExists('artifact_storage')) return false;
        try {
            return this.query("SELECT 1 FROM artifact_storage WHERE scope_key = ? LIMIT 1", [scopeKey]).length > 0;
        } catch (_) {
            return false;
        }
    },

    getArtifactStorageScopes() {
        if (!this.db || !this.tableExists('artifact_storage')) return new Set();
        try {
            const rows = this.query("SELECT DISTINCT scope_key FROM artifact_storage");
            return new Set(rows.map(r => r.scope_key).filter(Boolean));
        } catch (_) {
            return new Set();
        }
    },

    setArtifactStorageItem(scopeKey, key, value, autoSave = false) {
        if (!scopeKey || typeof scopeKey !== 'string') throw new Error('Invalid storage scope');
        if (!this.db || !this.tableExists('artifact_storage')) throw new Error('Artifact storage table missing');

        const lim = this.ARTIFACT_STORAGE_LIMITS;
        const k = String(key ?? '');
        const v = String(value ?? '');
        const keyBytes = this._utf8ByteLength(k);
        const valBytes = this._utf8ByteLength(v);

        if (keyBytes === 0 || keyBytes > lim.maxKeyBytes) {
            throw new Error('QuotaExceededError: invalid key length');
        }
        if (valBytes > lim.maxValueBytes) {
            throw new Error('QuotaExceededError: value exceeds 256 KB limit');
        }

        const rows = this.query("SELECT key, value FROM artifact_storage WHERE scope_key = ?", [scopeKey]);
        let exists = false;
        let otherBytes = 0;
        for (const r of rows) {
            if (r.key === k) {
                exists = true;
                continue;
            }
            otherBytes += this._utf8ByteLength(r.key) + this._utf8ByteLength(r.value || '');
        }
        if (!exists && rows.length >= lim.maxKeys) {
            throw new Error('QuotaExceededError: too many keys');
        }
        if (otherBytes + keyBytes + valBytes > lim.maxScopeBytes) {
            throw new Error('QuotaExceededError: storage limit exceeded');
        }

        this.run(
            `INSERT INTO artifact_storage (scope_key, key, value, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(scope_key, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
            [scopeKey, k, v],
            autoSave
        );
        return true;
    },

    removeArtifactStorageItem(scopeKey, key, autoSave = false) {
        if (!scopeKey || !this.db || !this.tableExists('artifact_storage')) return false;
        this.run("DELETE FROM artifact_storage WHERE scope_key = ? AND key = ?", [scopeKey, String(key ?? '')], autoSave);
        return true;
    },

    clearArtifactStorage(scopeKey, autoSave = true) {
        if (!scopeKey || !this.db || !this.tableExists('artifact_storage')) return false;
        this.run("DELETE FROM artifact_storage WHERE scope_key = ?", [scopeKey], autoSave);
        return true;
    },

    copyArtifactStorage(fromScopeKey, toScopeKey, { overwrite = false } = {}) {
        if (!fromScopeKey || !toScopeKey || fromScopeKey === toScopeKey) return false;
        if (!this.db || !this.tableExists('artifact_storage')) return false;
        if (!overwrite && this.hasArtifactStorage(toScopeKey)) return false;

        const rows = this.query("SELECT key, value FROM artifact_storage WHERE scope_key = ? ORDER BY id ASC", [fromScopeKey]);
        if (rows.length === 0) return false;

        if (overwrite) {
            this.run("DELETE FROM artifact_storage WHERE scope_key = ?", [toScopeKey], false);
        }
        for (const r of rows) {
            this.run(
                `INSERT INTO artifact_storage (scope_key, key, value, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(scope_key, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
                [toScopeKey, r.key, r.value ?? ''],
                false
            );
        }
        this.save();
        return true;
    },

    getMessages(chatId) {
        return this.query("SELECT * FROM messages WHERE chat_id = ? ORDER BY id ASC", [chatId]);
    },

    saveMessage(chatId, role, content, emotion = '', isHTML = false, fileNames = null) {
        const isHtmlVal = isHTML ? 1 : 0;
        const attachmentsVal = (Array.isArray(fileNames) && fileNames.length > 0) ? JSON.stringify(fileNames) : null;
        // autoSave=false keeps last_insert_rowid() reliable for the id read below
        this.run("INSERT INTO messages (chat_id, role, content, emotion, is_html, attachments) VALUES (?, ?, ?, ?, ?, ?)", [chatId, role, content, emotion, isHtmlVal, attachmentsVal], false);
        const res = this.exec("SELECT last_insert_rowid() as id");
        const id = (res && res[0] && res[0].values && res[0].values[0]) ? res[0].values[0][0] : null;
        this.run("UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [chatId], false);
        this.save();
        return id;
    },

    updateChatTitle(id, title) {
        this.run("UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [title, id]);
        this.save();
    },

    updateChatOrder(id, order, autoSave = true) {
        this.run("UPDATE chats SET sort_order = ? WHERE id = ?", [order, id], autoSave);
    },

    // --- Folders & Favorites ---

    createFolder(title = '') {
        this.run("INSERT INTO folders (title, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM folders))", [title], false);
        const res = this.exec("SELECT last_insert_rowid() as id");
        const id = (res && res[0] && res[0].values && res[0].values[0]) ? res[0].values[0][0] : null;
        this.save();
        return id;
    },

    getFolders() {
        return this.query("SELECT * FROM folders ORDER BY sort_order ASC, id ASC");
    },

    renameFolder(id, title) {
        this.run("UPDATE folders SET title = ? WHERE id = ?", [title, id]);
    },

    updateFolderOrder(id, order, autoSave = true) {
        this.run("UPDATE folders SET sort_order = ? WHERE id = ?", [order, id], autoSave);
    },

    deleteFolder(id) {
        this.run("UPDATE chats SET folder_id = NULL WHERE folder_id = ?", [id], false);
        this.run("DELETE FROM folders WHERE id = ?", [id]);
    },

    setChatFolder(chatId, folderId, autoSave = true) {
        this.run("UPDATE chats SET folder_id = ? WHERE id = ?", [folderId, chatId], autoSave);
    },

    setChatFavorite(chatId, isFavorite) {
        this.run("UPDATE chats SET is_favorite = ? WHERE id = ?", [isFavorite ? 1 : 0, chatId]);
    },

    // --- Sections & Chapters (in-chat navigation) ---

    createSection(chatId, title = '') {
        this.run("INSERT INTO chat_sections (chat_id, title, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM chat_sections WHERE chat_id = ?))", [chatId, title, chatId], false);
        const res = this.exec("SELECT last_insert_rowid() as id");
        const id = (res && res[0] && res[0].values && res[0].values[0]) ? res[0].values[0][0] : null;
        this.save();
        return id;
    },

    getSections(chatId) {
        return this.query("SELECT * FROM chat_sections WHERE chat_id = ? ORDER BY sort_order ASC, id ASC", [chatId]);
    },

    renameSection(id, title) {
        this.run("UPDATE chat_sections SET title = ? WHERE id = ?", [title, id]);
    },

    deleteSection(id) {
        this.run("DELETE FROM chat_chapters WHERE section_id = ?", [id], false);
        this.run("DELETE FROM chat_sections WHERE id = ?", [id]);
    },

    createChapter(chatId, sectionId, title = '', anchorMessageId = null) {
        this.run("INSERT INTO chat_chapters (chat_id, section_id, title, anchor_message_id, sort_order) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM chat_chapters WHERE section_id = ?))", [chatId, sectionId, title, anchorMessageId, sectionId], false);
        const res = this.exec("SELECT last_insert_rowid() as id");
        const id = (res && res[0] && res[0].values && res[0].values[0]) ? res[0].values[0][0] : null;
        this.save();
        return id;
    },

    getChaptersByChat(chatId) {
        return this.query("SELECT * FROM chat_chapters WHERE chat_id = ? ORDER BY section_id ASC, sort_order ASC, id ASC", [chatId]);
    },

    renameChapter(id, title) {
        this.run("UPDATE chat_chapters SET title = ? WHERE id = ?", [title, id]);
    },

    updateChapterAnchor(id, anchorMessageId) {
        this.run("UPDATE chat_chapters SET anchor_message_id = ? WHERE id = ?", [anchorMessageId, id]);
    },

    deleteChapter(id) {
        this.run("DELETE FROM chat_chapters WHERE id = ?", [id]);
    },

    // --- Memory & Vector Search ---

    saveFact(content, category, embeddingArray) {
        try {
            // Normalizes arbitrary semantic embedding structures to isolated numeric arrays
            let arr = [];
            if (Array.isArray(embeddingArray)) arr = embeddingArray;
            else if (embeddingArray && embeddingArray.data) arr = Array.from(embeddingArray.data);
            else if (embeddingArray && embeddingArray[0] && Array.isArray(embeddingArray[0])) arr = embeddingArray[0];

            if (!arr || arr.length === 0) {
                console.warn('DB.saveFact: empty or invalid embedding for fact:', content);
            }

            const embeddingStr = JSON.stringify(arr);
            this.run("INSERT INTO memory_facts (content, category, embedding) VALUES (?, ?, ?)", [content, category, embeddingStr]);
            // Attempt to flush save to storage to persist memory immediately
            // (do not await in performance-sensitive paths, but here it's useful)
            let savePromise = null;
            if (this.save) {
                savePromise = this.save().catch(e => { console.warn('DB.saveFact: save() failed', e); });
            }
            console.debug('DB.saveFact: saved memory', { content, category, embeddingLen: arr.length });
            return savePromise;
        } catch (e) {
            console.error('DB.saveFact failed', e, { content, category });
        }
    },

    deleteFact(id) {
        this.run("DELETE FROM memory_facts WHERE id = ?", [id]);
    },

    updateFact(id, content, embeddingArray) {
        try {
            let arr = [];
            if (Array.isArray(embeddingArray)) arr = embeddingArray;
            else if (embeddingArray && embeddingArray.data) arr = Array.from(embeddingArray.data);
            else if (embeddingArray && embeddingArray[0] && Array.isArray(embeddingArray[0])) arr = embeddingArray[0];

            const embeddingStr = JSON.stringify(arr);
            this.run("UPDATE memory_facts SET content = ?, embedding = ? WHERE id = ?", [content, embeddingStr, id]);
            let savePromise = null;
            if (this.save) {
                savePromise = this.save().catch(e => { console.warn('DB.updateFact: save() failed', e); });
            }
            console.debug('DB.updateFact: updated memory', { id, content });
            return savePromise;
        } catch (e) {
            console.error('DB.updateFact failed', e, { id, content });
        }
    },

    getMemories() {
        return this.query("SELECT * FROM memory_facts ORDER BY id DESC");
    },

    async searchFacts(queryEmbedding, threshold = 0.4, limit = 5) {
        const facts = this.query("SELECT * FROM memory_facts");
        const results = [];

        for (const fact of facts) {
            try {
                const factEmbedding = JSON.parse(fact.embedding || '[]');
                if (!Array.isArray(factEmbedding) || !Array.isArray(queryEmbedding) || factEmbedding.length === 0 || queryEmbedding.length === 0) {
                    continue; // skip invalid embeddings
                }
                if (factEmbedding.length !== queryEmbedding.length) {
                    // Detects dimension misalignment explicitly bypassing incompatible vectors
                    console.warn('DB.searchFacts: embedding dimension mismatch', { factId: fact.id, factLen: factEmbedding.length, queryLen: queryEmbedding.length });
                    continue;
                }
                const similarity = this._cosineSimilarity(queryEmbedding, factEmbedding);
                if (similarity >= threshold) {
                    results.push({ ...fact, similarity });
                }
            } catch (e) {
                console.warn('DB.searchFacts: failed to parse/compare embedding for fact', fact.id, e);
                continue;
            }
        }

        return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
    },

    _cosineSimilarity(vecA, vecB) {
        try {
            let dotProduct = 0;
            let normA = 0;
            let normB = 0;
            const n = Math.min((vecA || []).length, (vecB || []).length);
            if (n === 0) return 0;
            for (let i = 0; i < n; i++) {
                dotProduct += vecA[i] * vecB[i];
                normA += vecA[i] * vecA[i];
                normB += vecB[i] * vecB[i];
            }
            if (normA === 0 || normB === 0) return 0;
            return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        } catch (e) {
            console.error('DB._cosineSimilarity error', e);
            return 0;
        }
    },

    // --- Dashboard Stats ---

    getStats() {
        const count = (sql, params = []) => {
            try {
                const rows = this.query(sql, params);
                return rows.length ? Number(rows[0].c) || 0 : 0;
            } catch (e) {
                console.warn('DB.getStats: query failed', e);
                return 0;
            }
        };

        return {
            facts: count("SELECT COUNT(*) AS c FROM memory_facts"),
            chats: count("SELECT COUNT(*) AS c FROM chats"),
            messagesSent: count("SELECT COUNT(*) AS c FROM messages WHERE role = 'user'"),
            messagesReceived: count("SELECT COUNT(*) AS c FROM messages WHERE role = 'model'")
        };
    },

    getDesktopNotes() {
        return this.query('SELECT * FROM desktop_notes ORDER BY updated_at DESC, id DESC');
    },

    saveDesktopNote(id, title, content) {
        const now = new Date().toISOString();
        if (id !== null && id !== undefined) {
            this.run('UPDATE desktop_notes SET title = ?, content = ?, updated_at = ? WHERE id = ?', [title, content, now, id]);
            return id;
        }
        this.run('INSERT INTO desktop_notes (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)', [title, content, now, now]);
        return this._lastInsertId('desktop_notes');
    },

    deleteDesktopNote(id) {
        this.run('DELETE FROM desktop_notes WHERE id = ?', [id]);
    },

    // --- Settings & Modules ---

    getSettings() {
        const rows = this.query("SELECT * FROM settings");
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        return settings;
    },

    saveSetting(key, value, autoSave = true) {
        // Secures systemic parameters preventing arbitrary manipulation via general mutation interfaces
        if (typeof key === 'string' && /(^personality$|^personality[_\.]|(^mood$)|(^sarcasm$)|(^humor$))/i.test(key)) {
            console.warn('Blocked attempt to set personality-related setting via saveSetting():', key);
            return;
        }
        this.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value], autoSave);
    },

    getModules(type) {
        return this.query("SELECT * FROM modules_data WHERE type = ? ORDER BY id DESC", [type]);
    },

    moduleExists(type, name) {
        const existing = this.query("SELECT id FROM modules_data WHERE type = ? AND name = ?", [type, name]);
        return existing.length > 0;
    },

    saveModule(type, name, content, tags) {
        // Validates existing internal structural components
        const existing = this.query("SELECT id FROM modules_data WHERE type = ? AND name = ?", [type, name]);
        if (existing.length > 0) {
            this.run("UPDATE modules_data SET content = ?, tags = ? WHERE id = ?", [content, tags, existing[0].id]);
        } else {
            this.run("INSERT INTO modules_data (type, name, content, tags) VALUES (?, ?, ?, ?)", [type, name, content, tags]);
        }
    },

    deleteModule(id) {
        if (this.tableExists('artifact_storage')) {
            const rows = this.query("SELECT type, name FROM modules_data WHERE id = ? LIMIT 1", [id]);
            if (rows.length > 0 && rows[0].type && rows[0].type !== 'plugin' && rows[0].name) {
                const scopeKey = this.getArtifactScopeKey({
                    source: 'module',
                    type: rows[0].type,
                    title: rows[0].name
                });
                if (scopeKey) {
                    this.run("DELETE FROM artifact_storage WHERE scope_key = ?", [scopeKey], false);
                }
            }
        }
        this.run("DELETE FROM modules_data WHERE id = ?", [id]);
    },

    // --- Persistence ---

    onStatusChange: null, // Callback function (status) => {}

    _notify(status) {
        if (this.onStatusChange) this.onStatusChange(status);
    },

    async save() {
        if (!this.db) return;

        // Ensure serialization to avoid overlapping write operations on fileHandle
        if (this._isSaving) {
            // Queue the save request if one is already in progress
            if (!this._nextSavePromise) {
                this._nextSavePromise = (async () => {
                    await this._savePromise;
                    this._nextSavePromise = null;
                    return await this.save();
                })();
            }
            return this._nextSavePromise;
        }

        this._isSaving = true;
        this._savePromise = (async () => {
            try {
                if (this.fileHandle && window.app && window.app.updateSyncStatus) window.app.updateSyncStatus('syncing');

                // Local-only freshness marker. Written directly so it neither ticks
                // the sync clock nor wakes the merge triggers.
                this.db.run("INSERT INTO settings (key, value) VALUES ('last_save_ts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [Date.now().toString()]);
                const data = this.db.export();

                await localforage.setItem(this.dbPath, data);

                let fileWriteFailed = false;
                if (this.fileHandle) {
                    let writable = null;
                    try {
                        writable = await this.fileHandle.createWritable();
                        await writable.write(data);
                        await writable.close();
                        writable = null;
                    } catch (fileErr) {
                        fileWriteFailed = true;
                        if (writable) {
                            try { await writable.abort(); } catch (_) {}
                        }
                        console.error('DB.save: file write failed', fileErr);
                        window.app?.updateSyncStatus('error', fileErr?.message || String(fileErr || ''));
                    }
                }

                // Cloud sync: v2 merges snapshots, legacy pushes the file. Never both.
                let cloudActive = false;
                try {
                    if (!this._syncApplying && window.RemoteStorage && RemoteStorage.isUnlocked()) {
                        cloudActive = true;
                        if (window.SyncEngine?.isEnabled?.()) {
                            window.SyncEngine.onLocalSave();
                        } else {
                            RemoteStorage.schedulePush(data);
                        }
                    }
                } catch (remoteErr) {
                    console.warn('DB.save: remote scheduling failed', remoteErr);
                }

                if (!fileWriteFailed && window.app && window.app.updateSyncStatus) {
                    if (this.fileHandle && !cloudActive) {
                        setTimeout(() => window.app.updateSyncStatus('synced'), 500);
                    } else if (!this.fileHandle && !cloudActive) {
                        window.app.updateSyncStatus('cache');
                    }
                }
            } catch (e) {
                console.error("DB: Auto-save failed", e);
                if (window.app && window.app.updateSyncStatus) window.app.updateSyncStatus('error', e?.message || String(e || ''));
            } finally {
                this._isSaving = false;
            }
        })();

        return this._savePromise;
    },

    async setFileHandle(handle) {
        this.fileHandle = handle;
        if (!this.handleKey) this.handleKey = `aru_handle_${this.dbPath}`;
        await localforage.setItem(this.handleKey, handle);
        console.log("DB: File handle updated and saved for", this.dbPath);
    },

    // Set active DB key (for multiple DB support)
    async setActiveKey(key) {
        if (!key) return;
        this.dbPath = key;
        this.handleKey = `aru_handle_${this.dbPath}`;
        localStorage.setItem('aru_active_db', key);
        console.log('DB: Active DB key set and handleKey synced to', key);
    },

    async checkFilePermission(request = true) {
        if (!this.fileHandle) return false;
        try {
            const status = await this.fileHandle.queryPermission({ mode: 'readwrite' });
            if (status === 'granted') return true;

            if (request) {
                const result = await this.fileHandle.requestPermission({ mode: 'readwrite' });
                return result === 'granted';
            }
            return false;
        } catch (e) {
            console.error("DB: Error checking permissions", e);
            return false;
        }
    },

    async saveToSelectedFile() {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: 'aru_database.sqlite',
                types: [{ description: 'SQLite Database', accept: { 'application/x-sqlite3': ['.sqlite', '.db'] } }]
            });
            await this.setFileHandle(handle);
            await this.save();
            return true;
        } catch (e) {
            console.warn("Save picker cancelled or failed", e);
            return false;
        }
    },

    async openFromFilePicker() {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'SQLite Database', accept: { 'application/x-sqlite3': ['.sqlite', '.db'] } }],
                multiple: false
            });

            // Executes heuristic analysis preventing accidental operational data loss during import sequences
            return await this.smartLoad(handle);
        } catch (e) {
            console.warn("Open picker cancelled or failed", e);
            return false;
        }
    },

    // Smartly compare file content with local DB to prevent overwriting newer data
    async smartLoad(handle) {
        let tempDB = null;
        try {
            const file = await handle.getFile();
            // Migrates external blob data to an isolated WebAssembly buffer layer
            const arrayBuffer = await file.arrayBuffer();
            const u8 = new Uint8Array(arrayBuffer);
            const tempSQL = this.SQL || await window.initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
            tempDB = new tempSQL.Database(u8);

            // Checks synchronization intervals validating operational safety constraints
            let fileTS = 0;
            let localTS = 0;

            try {
                const resF = tempDB.exec("SELECT value FROM settings WHERE key='last_save_ts'");
                if (resF.length && resF[0].values.length) fileTS = parseInt(resF[0].values[0][0]) || 0;
            } catch (e) { }

            try {
                const resL = this.exec("SELECT value FROM settings WHERE key='last_save_ts'");
                if (resL.length && resL[0].values.length) localTS = parseInt(resL[0].values[0][0]) || 0;
            } catch (e) { }

            console.log(`DB SmartLoad: LocalTS=${localTS}, FileTS=${fileTS}`);

            // 3. Decision Logic
            // If Local is significantly newer (> 1 sec), warn user
            if (localTS > fileTS + 1000) {
                const t = window.aruState?.translations || {};
                const msg = t.confirm_overwrite_stale || "⚠️ LOCAL DATA IS NEWER!\n\nYour browser cache has newer messages than the selected file.\nLoad file and LOSE local changes?\n\n(Cancel = Keep local data and sync it TO file)";

                const loadFile = await UI.confirm(msg);

                if (!loadFile) {
                    // Keep local, attach new handle and save current DB to it
                    console.log("DB: Keeping local data, overwriting stale file.");
                    try { tempDB.close(); } catch (_) {}
                    tempDB = null;
                    await this.setFileHandle(handle);
                    await this.save();
                    return true;
                }
            }

            // If we are here, we load the file (either it's newer, or user insisted)
            window.SyncEngine?.stop?.();
            window.RemoteStorage?.lock?.();
            const name = (file.name || 'import').replace(/[^a-z0-9\.\-_]/gi, '_');
            const key = `aru_db_file_${name}_${Date.now()}`;
            this.dbPath = key;
            this.handleKey = `aru_handle_${this.dbPath}`;
            localStorage.setItem('aru_active_db', key);

            if (this.db && this.db !== tempDB) {
                try { this.db.close(); } catch (_) {}
            }
            this.SQL = tempSQL; // Ensure we use the same SQL instance
            this._syncReady = false;
            this.db = tempDB;
            tempDB = null;
            this.migrateSchema(); // Forward migration for databases created by older app versions
            await this.setFileHandle(handle); // Update handle BEFORE saving so old disk file is never overwritten
            await this.save(); // Save the loaded data to IndexedDB and new handle
            return true;

        } catch (e) {
            if (tempDB) {
                try { tempDB.close(); } catch (_) {}
            }
            console.error("DB: smartLoad failed", e);
            const t = window.aruState?.translations || {};
            await UI.alert((t.alert_load_file_error || "Error loading file: ") + e.message);
            return false;
        }
    },

    // Loads a DB image from raw bytes (remote storage) with the same freshness guard as smartLoad.
    // force=true skips the guard (user explicitly chose "take remote").
    async smartLoadFromBytes(u8, { force = false } = {}) {
        const tempSQL = this.SQL || await window.initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
        const tempDB = new tempSQL.Database(u8);

        let fileTS = 0;
        let localTS = 0;
        try {
            const resF = tempDB.exec("SELECT value FROM settings WHERE key='last_save_ts'");
            if (resF.length && resF[0].values.length) fileTS = parseInt(resF[0].values[0][0]) || 0;
        } catch (e) { }
        try {
            const resL = this.exec("SELECT value FROM settings WHERE key='last_save_ts'");
            if (resL.length && resL[0].values.length) localTS = parseInt(resL[0].values[0][0]) || 0;
        } catch (e) { }

        if (!force && localTS > fileTS + 1000) {
            tempDB.close();
            return false;
        }

        if (this.db && this.db !== tempDB) {
            try { this.db.close(); } catch (_) {}
        }
        this.fileHandle = null;
        this.SQL = tempSQL;
        this._syncReady = false;
        this.db = tempDB;
        this.migrateSchema(); // Forward migration for databases created by older app versions
        await this.save();
        return true;
    },

    // Replaces the live database with the result of a three-way merge.
    // The merged image already went through the sync schema, so triggers are
    // ready; saving here must not schedule another cloud push (the engine owns it).
    // expectedSeq aborts the swap when a local write landed after the merge was
    // built, so in-flight rows are never dropped by the replaced image.
    async applySyncDatabase(newDb, bytes, { expectedSeq = null } = {}) {
        let db = newDb;
        if (!db) {
            if (!this.SQL) {
                this.SQL = await window.initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
            }
            db = new this.SQL.Database(bytes);
        }

        if (expectedSeq !== null && readDirtyState(this.db).seq !== expectedSeq) {
            try { db.close(); } catch (e) { }
            return false;
        }

        const previous = this.db;
        this._syncApplying = true;
        try {
            this.db = db;
            this._syncReady = false;
            try { ensureSyncSchema(this.db); } catch (e) { console.warn('DB.applySyncDatabase: schema ensure failed', e); }
            this._syncReady = true;
            await this.save();
        } finally {
            this._syncApplying = false;
        }

        if (previous && previous !== db) {
            try { previous.close(); } catch (e) { }
        }

        const st = window.aruState || {};
        try { st.userSettings = this.getSettings(); } catch (e) { }

        if (st.tabs) {
            const prevActive = (st.activeTabIndex >= 0 && st.activeTabIndex < st.tabs.length) ? st.tabs[st.activeTabIndex] : null;
            const alive = new Set(this.getChats().map(c => String(c.id)));
            st.tabs = st.tabs.filter(t => t.type === 'plugin' || t.isPrivate || alive.has(String(t.chatId)));
            if (prevActive && st.tabs.includes(prevActive)) {
                st.activeTabIndex = st.tabs.indexOf(prevActive);
            } else {
                st.activeTabIndex = st.tabs.length ? st.tabs.length - 1 : -1;
            }
            const activeTab = st.activeTabIndex >= 0 ? st.tabs[st.activeTabIndex] : null;
            st.currentChatId = (activeTab && activeTab.type !== 'plugin') ? activeTab.chatId : null;
        }

        if (window.app) {
            try { window.app.loadChatsList(); } catch (e) { }
            try { window.app.renderTabs?.(); } catch (e) { }
            // Reloading the open chat while any reply is still generating would
            // wipe the visible answer and look like the generation was interrupted.
            const generating = !!(st.tabs && st.tabs.some(t => t && t.isSending));
            const activeTab = (st.tabs && st.activeTabIndex >= 0) ? st.tabs[st.activeTabIndex] : null;
            if (activeTab && activeTab.type !== 'plugin' && !activeTab.isPrivate && st.currentChatId != null && !generating) {
                try { await window.app.loadChat(st.currentChatId); } catch (e) { }
            }
            try { window.app.updateSearchUI?.(); } catch (e) { }
        }

        try { window.dispatchEvent(new CustomEvent('aru-sync-applied')); } catch (e) { }
        return true;
    },

    // Replaces the current DB with remote bytes and refreshes the session UI
    async applyRemoteBytes(u8) {
        const ok = await this.smartLoadFromBytes(u8, { force: true });
        if (ok && window.app) {
            try { window.app.startSession(true); } catch (e) { console.warn('applyRemoteBytes: session refresh failed', e); }
        }
        return ok;
    },

    // One-shot reconciliation with the remote copy, honoring the remote_conflict setting
    async syncWithRemoteOnStart() {
        if (window.SyncEngine?.isEnabled?.()) return; // v2 has its own merge pass
        if (!window.RemoteStorage || !RemoteStorage.isUnlocked()) return;
        try {
            const settings = this.getSettings();
            const localTS = parseInt(settings.last_save_ts) || 0;
            const cmp = await RemoteStorage.compareWithRemote(localTS);

            if (cmp === 'equal' || cmp === 'unknown') return;

            if (cmp === 'local') {
                await RemoteStorage.pushNow(this.db.export());
                return;
            }

            // Remote is newer
            const mode = settings.remote_conflict || 'ask';
            if (mode === 'local') {
                await RemoteStorage.pushNow(this.db.export());
            } else if (mode === 'remote') {
                await this.applyRemoteBytes(await RemoteStorage.pullBytes());
            } else {
                const info = await RemoteStorage.getRemoteInfo();
                const choice = await RemoteStorage.showConflictDialog(info);
                if (choice === 'local') {
                    await RemoteStorage.pushNow(this.db.export());
                } else if (choice === 'remote') {
                    await this.applyRemoteBytes(await RemoteStorage.pullBytes());
                } else if (choice === 'copy') {
                    const bytes = await RemoteStorage.pullBytes();
                    const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    document.body.appendChild(a);
                    a.href = url;
                    a.download = 'aru_remote_copy.sqlite';
                    a.onclick = () => {
                        setTimeout(() => {
                            document.body.removeChild(a);
                            window.URL.revokeObjectURL(url);
                        }, 1500);
                    };
                    a.click();
                }
            }
        } catch (e) {
            console.warn('DB.syncWithRemoteOnStart failed', e);
            window.app?.updateSyncStatus('cloud-error', e?.message || String(e || ''));
        }
    },

    // Handler for poll-detected external changes: asks unless the user configured an automatic rule
    async handleRemoteNewer(info) {
        if (window.SyncEngine?.isEnabled?.()) return; // v2 merges instead of replacing
        const settings = this.getSettings();
        const mode = settings.remote_conflict || 'ask';
        const t = window.aruState?.translations || {};
        try {
            if (mode === 'remote') {
                await this.applyRemoteBytes(await RemoteStorage.pullBytes());
            } else if (mode === 'local') {
                await RemoteStorage.pushNow(this.db.export());
            } else {
                const ok = await UI.confirm(t.remote_newer_confirm || 'The remote database copy was changed from another device. Download it now? (Cancel = keep local and upload)');
                if (ok) {
                    await this.applyRemoteBytes(await RemoteStorage.pullBytes());
                } else {
                    await RemoteStorage.pushNow(this.db.export());
                }
            }
        } catch (e) {
            console.warn('DB.handleRemoteNewer failed', e);
            window.app?.updateSyncStatus('cloud-error', e?.message || String(e || ''));
        }
    },

    async exportToFile(filenamePrefix = 'aru_backup') {
        if (!this.db) return;
        await this.save(); // Ensure latest is saved
        const data = this.db.export();
        const blob = new Blob([data], { type: 'application/x-sqlite3' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        document.body.appendChild(a);
        a.href = url;
        const name = filenamePrefix.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `${name}_${new Date().toISOString().slice(0, 10)}.sqlite`;
        a.onclick = () => {
            setTimeout(() => {
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }, 1500);
        };
        a.click();
    },

    // Import from file input (Drag & Drop or Manual Import Modal)
    // Reads only the password hash from a candidate DB file, so the current
    // database is not replaced until the password has been verified.
    async readPasswordHashFromFile(file) {
        if (!this.SQL) await this.init();
        const data = new Uint8Array(await file.arrayBuffer());
        const probe = new this.SQL.Database(data);
        try {
            const res = probe.exec("SELECT value FROM settings WHERE key='db_password'");
            return (res.length && res[0].values.length) ? res[0].values[0][0] : null;
        } finally {
            probe.close();
        }
    },

    async importFromFile(file) {
        return new Promise((resolve, reject) => {            const r = new FileReader();
            r.onload = async () => {
                try {
                    if (!this.SQL) await this.init();
                    window.SyncEngine?.stop?.();
                    window.RemoteStorage?.lock?.();
                    const u8 = new Uint8Array(r.result);
                    if (this.db) {
                        try { this.db.close(); } catch (_) {}
                    }
                    this._syncReady = false;
                    this.db = new this.SQL.Database(u8);

                    // Reset File Handle on manual import as it breaks the link to previous file
                    this.fileHandle = null;
                    if (this.handleKey) await localforage.removeItem(this.handleKey);

                    this.migrateSchema(); // Forward migration for databases created by older app versions
                    await this.save();
                    try { window.dispatchEvent(new CustomEvent('aru-db-initialized', { detail: { status: 'loaded' } })); } catch (e) {}
                    resolve(true);
                } catch (e) {
                    reject(e);
                }
            };
            r.readAsArrayBuffer(file);
        });
    },

    // --- WebRTC Transfer Helpers ---

    /**
     * Extracts requested data as a plain object for transfer.
     * @param {string[]} types - Array of types: 'chats', 'settings', 'artifacts', 'tasks', 'full_db'
     * @param {Object} filters - Dictionary of item IDs to transfer map {chats: [], artifacts: []}
     */
    getExportData(types, filters = {}, options = {}) {
        if (!this.db) return null;
        const result = { version: '1.0', timestamp: Date.now(), data: {} };

        if (types.includes('full_db')) {
            result.data.full_db = this.db.export(); // Uint8Array
            return result;
        }

        if (types.includes('chats')) {
            if (filters.chats && Array.isArray(filters.chats)) {
                if (filters.chats.length === 0) {
                    result.data.chats = [];
                    result.data.messages = [];
                    result.data.folders = [];
                    result.data.sections = [];
                    result.data.chapters = [];
                    result.data.chat_artifacts = [];
                } else {
                    const ids = filters.chats.join(',');
                    result.data.chats = this.query(`SELECT * FROM chats WHERE id IN (${ids})`);
                    result.data.messages = this.query(`SELECT * FROM messages WHERE chat_id IN (${ids})`);
                    result.data.folders = this.query("SELECT * FROM folders");
                    result.data.sections = this.query(`SELECT * FROM chat_sections WHERE chat_id IN (${ids})`);
                    result.data.chapters = this.query(`SELECT * FROM chat_chapters WHERE chat_id IN (${ids})`);
                    result.data.chat_artifacts = this.query(`SELECT * FROM chat_artifacts WHERE chat_id IN (${ids})`);
                }
            } else {
                result.data.chats = this.query("SELECT * FROM chats");
                result.data.messages = this.query("SELECT * FROM messages");
                result.data.folders = this.query("SELECT * FROM folders");
                result.data.sections = this.query("SELECT * FROM chat_sections");
                result.data.chapters = this.query("SELECT * FROM chat_chapters");
                result.data.chat_artifacts = this.query("SELECT * FROM chat_artifacts");
            }
        }

        if (types.includes('settings')) {
            let settingsRows = this.query("SELECT * FROM settings");
            // P2P transfer never carries credentials to another device.
            if (options.stripSecrets) {
                settingsRows = settingsRows.filter(row => !TRANSFER_SECRET_SETTINGS.has(row.key));
            }
            result.data.settings = settingsRows;
            result.data.personality = this.query("SELECT * FROM personality_state");
            result.data.memory = this.query("SELECT * FROM memory_facts");
        }

        if (types.includes('artifacts')) {
            if (filters.artifacts && Array.isArray(filters.artifacts)) {
                if (filters.artifacts.length === 0) {
                    result.data.artifacts = [];
                } else {
                    const ids = filters.artifacts.join(',');
                    result.data.artifacts = this.query(`SELECT * FROM modules_data WHERE type != 'plugin' AND id IN (${ids})`);
                }
            } else {
                result.data.artifacts = this.query("SELECT * FROM modules_data WHERE type != 'plugin'");
            }
        }

        if (types.includes('tasks')) {
            const row = this.query("SELECT * FROM modules_data WHERE type = 'plugin' AND name = 'task' LIMIT 1");
            if (row && row.length > 0) {
                if (filters.tasks && Array.isArray(filters.tasks)) {
                    if (filters.tasks.length === 0) {
                        result.data.tasks = [];
                    } else {
                        try {
                            const parsed = JSON.parse(row[0].content);
                            if (parsed && parsed.projects) {
                                parsed.projects = parsed.projects.filter(p => filters.tasks.includes(p.id));
                                row[0].content = JSON.stringify(parsed);
                            }
                            result.data.tasks = [row[0]];
                        } catch(e) { result.data.tasks = []; }
                    }
                } else {
                    result.data.tasks = [row[0]];
                }
            } else {
                result.data.tasks = [];
            }
        }

        if (types.includes('skills')) {
            result.data.skills = this.query("SELECT * FROM skills");
            result.data.skill_projects = this.query("SELECT * FROM skill_projects");
            result.data.skill_project_items = this.query("SELECT * FROM skill_project_items");
            result.data.skill_pipeline_steps = this.query("SELECT * FROM skill_pipeline_steps");
            result.data.skill_runs = this.query("SELECT * FROM skill_runs");
            result.data.skill_run_steps = this.query("SELECT * FROM skill_run_steps");
            result.data.skill_artifacts = this.tableExists('skill_artifacts') ? this.query("SELECT * FROM skill_artifacts") : [];
            result.data.skill_project_messages = this.tableExists('skill_project_messages') ? this.query("SELECT * FROM skill_project_messages") : [];
        }

        return result;
    },

    async applyTransferData(dataU8, mode, isFullDb) {
        if (!dataU8 || !dataU8.length) throw new Error('Empty transfer data');
        if (!this.SQL) await this.init();

        // 1. Separate Mode: Download as a new SQLite file
        if (mode === 'separate') {
            let exportU8;
            if (isFullDb) {
                exportU8 = dataU8; // already sqlite format
            } else {
                const dataStr = new TextDecoder().decode(dataU8);
                const imported = JSON.parse(dataStr);
                
                const tempDb = new this.SQL.Database();
                try {
                    tempDb.run(`CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, sort_order INTEGER DEFAULT 0, folder_id INTEGER DEFAULT NULL, is_favorite INTEGER DEFAULT 0)`);
                    tempDb.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, role TEXT, content TEXT, emotion TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, is_html INTEGER DEFAULT 0, attachments TEXT)`);
                    tempDb.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
                    tempDb.run(`CREATE TABLE IF NOT EXISTS personality_state (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, mood INTEGER DEFAULT 50, sarcasm INTEGER DEFAULT 0, humor INTEGER DEFAULT 50, affinity INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
                    tempDb.run(`CREATE TABLE IF NOT EXISTS memory_facts (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, category TEXT, embedding TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
                    tempDb.run(`CREATE TABLE IF NOT EXISTS modules_data (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, name TEXT, content TEXT, tags TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
                    tempDb.run(`CREATE TABLE IF NOT EXISTS folders (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
                    tempDb.run(`CREATE TABLE IF NOT EXISTS chat_sections (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, title TEXT, sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
                    tempDb.run(`CREATE TABLE IF NOT EXISTS chat_chapters (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, section_id INTEGER, title TEXT, anchor_message_id INTEGER, sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
                    tempDb.run(`CREATE TABLE IF NOT EXISTS chat_artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, title TEXT, type TEXT, code TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(chat_id, title))`);
                    for (const ddl of this._skillDdl()) tempDb.run(ddl);

                    const data = imported.data;
                    if (data.chats) {
                        for (const chat of data.chats) tempDb.run("INSERT INTO chats (id, title, sort_order, created_at, updated_at, folder_id, is_favorite) VALUES (?, ?, ?, ?, ?, ?, ?)", [chat.id, chat.title || 'Chat', chat.sort_order || 0, chat.created_at || null, chat.updated_at || null, chat.folder_id !== undefined ? chat.folder_id : null, chat.is_favorite || 0]);
                        for (const m of data.messages || []) tempDb.run("INSERT INTO messages (id, chat_id, role, content, emotion, is_html, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [m.id, m.chat_id, m.role || 'user', m.content || '', m.emotion !== undefined ? m.emotion : null, m.is_html || 0, m.attachments || null, m.created_at || null]);
                        if (data.folders) {
                            for (const f of data.folders) tempDb.run("INSERT INTO folders (id, title, sort_order, created_at) VALUES (?, ?, ?, ?)", [f.id, f.title || '', f.sort_order || 0, f.created_at || null]);
                        }
                        if (data.sections) {
                            for (const s of data.sections) tempDb.run("INSERT INTO chat_sections (id, chat_id, title, sort_order, created_at) VALUES (?, ?, ?, ?, ?)", [s.id, s.chat_id, s.title || '', s.sort_order || 0, s.created_at || null]);
                        }
                        if (data.chapters) {
                            for (const c of data.chapters) tempDb.run("INSERT INTO chat_chapters (id, chat_id, section_id, title, anchor_message_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [c.id, c.chat_id, c.section_id !== undefined ? c.section_id : null, c.title || '', c.anchor_message_id !== undefined ? c.anchor_message_id : null, c.sort_order || 0, c.created_at || null]);
                        }
                        if (data.chat_artifacts) {
                            for (const a of data.chat_artifacts) tempDb.run("INSERT INTO chat_artifacts (id, chat_id, title, type, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [a.id, a.chat_id, a.title || '', a.type || '', a.code || '', a.created_at || null, a.updated_at || null]);
                        }
                    }
                    if (data.settings) {
                        for (const s of data.settings) tempDb.run("INSERT INTO settings (key, value) VALUES (?, ?)", [s.key, s.value || '']);
                        for (const p of data.personality || []) tempDb.run("INSERT INTO personality_state (key, mood, sarcasm, humor, affinity, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [p.key, p.mood || 50, p.sarcasm || 0, p.humor || 50, p.affinity || 0, p.updated_at || null]);
                        for (const m of data.memory || []) tempDb.run("INSERT INTO memory_facts (id, content, category, embedding, created_at) VALUES (?, ?, ?, ?, ?)", [m.id, m.content || '', m.category || '', m.embedding || '', m.created_at || null]);
                    }
                    if (data.artifacts) {
                        for (const a of data.artifacts) tempDb.run("INSERT INTO modules_data (id, type, name, content, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)", [a.id, a.type || '', a.name || '', a.content || '', a.tags || '', a.created_at || null]);
                    }
                    if (data.tasks) {
                        for (const t of data.tasks) tempDb.run("INSERT INTO modules_data (id, type, name, content, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)", [t.id, t.type || '', t.name || '', t.content || '', t.tags || '', t.created_at || null]);
                    }
                    if (data.skills) {
                        this._insertSkillDataRaw(tempDb, data);
                    }
                    exportU8 = tempDb.export();
                } finally {
                    try { tempDb.close(); } catch (_) {}
                }
            }

            const blob = new Blob([exportU8], { type: 'application/x-sqlite3' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            document.body.appendChild(a);
            a.href = url;
            const prefix = isFullDb ? 'full' : 'partial';
            a.download = `aru_transfer_${prefix}_${Date.now()}.sqlite`;
            a.onclick = () => {
                setTimeout(() => {
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                }, 1500);
            };
            a.click();
            return 'downloaded';
        }

        // 2. Overwrite Mode for Full DB
        if (mode === 'overwrite' && isFullDb) {
            const blob = new Blob([dataU8], { type: 'application/x-sqlite3' });
            const file = new File([blob], `transfer_${Date.now()}.sqlite`);
            return await this.importFromFile(file);
        }

        // 3. Merge or Overwrite Mode for Partial Data
        try {
            const dataStr = new TextDecoder().decode(dataU8);
            const imported = JSON.parse(dataStr);
            const data = imported.data;
            // The DB password is a local UI gate; an imported backup must not
            // silently lock the user out of their own device.
            const localPasswordRow = this.query("SELECT value FROM settings WHERE key='db_password'")[0];

            this.db.run('BEGIN TRANSACTION');
            try {
                if (mode === 'overwrite') {
                    if (data.chats) {
                        this.run("DELETE FROM messages", [], false);
                        this.run("DELETE FROM chat_chapters", [], false);
                        this.run("DELETE FROM chat_sections", [], false);
                        this.run("DELETE FROM chat_artifacts", [], false);
                        this.run("DELETE FROM chats", [], false);
                        for (const chat of data.chats) {
                            this.run("INSERT INTO chats (id, title, sort_order, created_at, updated_at, folder_id, is_favorite) VALUES (?, ?, ?, ?, ?, ?, ?)", [chat.id, chat.title || 'Chat', chat.sort_order || 0, chat.created_at || null, chat.updated_at || null, chat.folder_id !== undefined ? chat.folder_id : null, chat.is_favorite || 0], false);
                        }
                        for (const m of data.messages || []) {
                            this.run("INSERT INTO messages (id, chat_id, role, content, emotion, is_html, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [m.id, m.chat_id, m.role || 'user', m.content || '', m.emotion !== undefined ? m.emotion : null, m.is_html || 0, m.attachments !== undefined ? m.attachments : null, m.created_at || null], false);
                        }
                        // Folders/sections/chapters exist only in payloads from newer app versions; keep local ones otherwise
                        if (data.folders) {
                            this.run("DELETE FROM folders", [], false);
                            for (const f of data.folders) this.run("INSERT INTO folders (id, title, sort_order, created_at) VALUES (?, ?, ?, ?)", [f.id, f.title || '', f.sort_order || 0, f.created_at || null], false);
                        }
                        if (data.sections) {
                            for (const s of data.sections) this.run("INSERT INTO chat_sections (id, chat_id, title, sort_order, created_at) VALUES (?, ?, ?, ?, ?)", [s.id, s.chat_id, s.title || '', s.sort_order || 0, s.created_at || null], false);
                        }
                        if (data.chapters) {
                            for (const c of data.chapters) this.run("INSERT INTO chat_chapters (id, chat_id, section_id, title, anchor_message_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [c.id, c.chat_id, c.section_id !== undefined ? c.section_id : null, c.title || '', c.anchor_message_id !== undefined ? c.anchor_message_id : null, c.sort_order || 0, c.created_at || null], false);
                        }
                        if (data.chat_artifacts) {
                            for (const a of data.chat_artifacts) this.run("INSERT INTO chat_artifacts (id, chat_id, title, type, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [a.id, a.chat_id, a.title || '', a.type || '', a.code || '', a.created_at || null, a.updated_at || null], false);
                        }
                    }
                    if (data.settings) {
                        this.run("DELETE FROM settings", [], false);
                        this.run("DELETE FROM personality_state", [], false);
                        this.run("DELETE FROM memory_facts", [], false);
                        for (const s of data.settings) {
                            if (s.key === 'last_save_ts' || s.key === 'db_password') continue;
                            this.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [s.key, s.value], false);
                        }
                        if (localPasswordRow) this.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['db_password', localPasswordRow.value], false);
                        for (const p of data.personality || []) this.run("INSERT INTO personality_state (key, mood, sarcasm, humor, affinity, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [p.key, p.mood, p.sarcasm, p.humor, p.affinity, p.updated_at], false);
                        for (const m of data.memory || []) this.run("INSERT INTO memory_facts (id, content, category, embedding, created_at) VALUES (?, ?, ?, ?, ?)", [m.id, m.content, m.category, m.embedding, m.created_at], false);
                    }
                    if (data.artifacts) {
                        this.run("DELETE FROM modules_data WHERE type != 'plugin'", [], false);
                        for (const a of data.artifacts) this.run("INSERT INTO modules_data (id, type, name, content, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)", [a.id, a.type, a.name, a.content, a.tags, a.created_at], false);
                    }
                    if (data.tasks) {
                        this.run("DELETE FROM modules_data WHERE type = 'plugin' AND name = 'task'", [], false);
                        for (const t of data.tasks) this.run("INSERT INTO modules_data (id, type, name, content, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)", [t.id, t.type, t.name, t.content, t.tags, t.created_at], false);
                    }
                    if (data.skills) {
                        this.run("DELETE FROM skill_run_steps", [], false);
                        this.run("DELETE FROM skill_runs", [], false);
                        this.run("DELETE FROM skill_pipeline_steps", [], false);
                        this.run("DELETE FROM skill_project_items", [], false);
                        if (this.tableExists('skill_artifacts')) this.run("DELETE FROM skill_artifacts", [], false);
                        if (this.tableExists('skill_project_messages')) this.run("DELETE FROM skill_project_messages", [], false);
                        this.run("DELETE FROM skill_projects", [], false);
                        this.run("DELETE FROM skills", [], false);
                        this._insertSkillDataRaw(this, data);
                    }
                } else if (mode === 'merge') {
                    if (data.chats) {
                        for (const chat of data.chats) {
                            const oldId = chat.id;
                            // Folder references are not carried over on merge (folder ids would collide with local ones)
                            this.run("INSERT INTO chats (title, sort_order, created_at, updated_at, is_favorite) VALUES (?, ?, ?, ?, ?)", [chat.title || 'Chat', chat.sort_order || 0, chat.created_at || null, chat.updated_at || null, chat.is_favorite || 0], false);
                            const res = this.exec("SELECT last_insert_rowid() as id");
                            const newId = (res && res[0] && res[0].values && res[0].values[0]) ? res[0].values[0][0] : null;

                            const messages = (data.messages || []).filter(m => String(m.chat_id) === String(oldId));
                            const msgIdMap = {};
                            for (const m of messages) {
                                this.run("INSERT INTO messages (chat_id, role, content, emotion, is_html, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [newId, m.role || 'user', m.content || '', m.emotion !== undefined ? m.emotion : null, m.is_html || 0, m.attachments !== undefined ? m.attachments : null, m.created_at || null], false);
                                const mres = this.exec("SELECT last_insert_rowid() as id");
                                const newMsgId = (mres && mres[0] && mres[0].values && mres[0].values[0]) ? mres[0].values[0][0] : null;
                                if (m.id !== undefined && m.id !== null && newMsgId !== null) {
                                    msgIdMap[String(m.id)] = newMsgId;
                                }
                            }

                            // Re-create sections/chapters under the merged chat with remapped ids
                            const sections = (data.sections || []).filter(s => String(s.chat_id) === String(oldId));
                            const sectionMap = {};
                            for (const s of sections) {
                                this.run("INSERT INTO chat_sections (chat_id, title, sort_order, created_at) VALUES (?, ?, ?, ?)", [newId, s.title || '', s.sort_order || 0, s.created_at || null], false);
                                const sres = this.exec("SELECT last_insert_rowid() as id");
                                sectionMap[s.id] = (sres && sres[0] && sres[0].values && sres[0].values[0]) ? sres[0].values[0][0] : null;
                            }
                            const chapters = (data.chapters || []).filter(c => String(c.chat_id) === String(oldId));
                            for (const c of chapters) {
                                const mappedSection = (c.section_id !== undefined && c.section_id !== null && sectionMap[c.section_id] !== undefined) ? sectionMap[c.section_id] : null;
                                const mappedAnchor = (c.anchor_message_id !== undefined && c.anchor_message_id !== null) ? (msgIdMap[String(c.anchor_message_id)] ?? null) : null;
                                this.run("INSERT INTO chat_chapters (chat_id, section_id, title, anchor_message_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)", [newId, mappedSection, c.title || '', mappedAnchor, c.sort_order || 0, c.created_at || null], false);
                            }
                            const artifacts = (data.chat_artifacts || []).filter(a => String(a.chat_id) === String(oldId));
                            for (const a of artifacts) {
                                this.run("INSERT INTO chat_artifacts (chat_id, title, type, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [newId, a.title || '', a.type || '', a.code || '', a.created_at || null, a.updated_at || null], false);
                            }
                        }
                    }
                    if (data.settings) {
                        for (const s of data.settings) {
                            if (s.key === 'db_password' || s.key === 'last_save_ts') continue;
                            this.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [s.key, s.value], false);
                        }
                        for (const p of data.personality || []) this.run("INSERT INTO personality_state (key, mood, sarcasm, humor, affinity, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET mood = excluded.mood, sarcasm = excluded.sarcasm, humor = excluded.humor, affinity = excluded.affinity, updated_at = excluded.updated_at", [p.key, p.mood, p.sarcasm, p.humor, p.affinity, p.updated_at], false);
                        for (const m of data.memory || []) this.run("INSERT INTO memory_facts (content, category, embedding, created_at) VALUES (?, ?, ?, ?)", [m.content, m.category, m.embedding, m.created_at], false);
                    }
                    if (data.artifacts) {
                        for (const a of data.artifacts) this.run("INSERT INTO modules_data (type, name, content, tags, created_at) VALUES (?, ?, ?, ?, ?)", [a.type, a.name, a.content, a.tags, a.created_at], false);
                    }
                    if (data.tasks) {
                        for (const t of data.tasks) {
                            const existing = this.query("SELECT id, content FROM modules_data WHERE name = 'task' AND type = 'plugin' LIMIT 1");
                            if (existing.length === 0) {
                                this.run("INSERT INTO modules_data (type, name, content, tags, created_at) VALUES (?, ?, ?, ?, ?)", [t.type, t.name, t.content, t.tags, t.created_at], false);
                            } else {
                                try {
                                    const newParsed = JSON.parse(t.content);
                                    const oldParsed = JSON.parse(existing[0].content);

                                    if (newParsed && newParsed.projects) {
                                        if (!oldParsed.projects) oldParsed.projects = [];
                                        for (const np of newParsed.projects) {
                                            const idx = oldParsed.projects.findIndex(op => op.id === np.id);
                                            if (idx !== -1) oldParsed.projects[idx] = np;
                                            else oldParsed.projects.push(np);
                                        }
                                        this.run("UPDATE modules_data SET content = ? WHERE id = ?", [JSON.stringify(oldParsed), existing[0].id], false);
                                    }
                                } catch (e) {}
                            }
                        }
                    }
                    if (data.skills) {
                        this._mergeSkillData(data);
                    }
                }
                this.db.run('COMMIT');
            } catch (txErr) {
                try { this.db.run('ROLLBACK'); } catch (_) {}
                throw txErr;
            }

            await this.save();
            return true;
        } catch (e) {
            console.error("applyTransferData partial failed:", e);
            throw e;
        }
    }
};
