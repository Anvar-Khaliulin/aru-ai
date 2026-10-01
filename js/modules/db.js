/*
---ARU-LAB.SPACE---ALMATY---2026---
Local database client powered by SQL.js and IndexedDB for persistent storage of chat and vector data.
---chat.aru-lab.space---PWA---
*/
export const DB = {
    db: null,
    SQL: null,
    dbPath: 'aru_db_v1', // Key for IndexedDB (default)
    fileHandle: null, // Handle for File System Access API

    async init() {
        console.log("DB: Initializing...");

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
                        if (window.app && window.app.updateSyncStatus) window.app.updateSyncStatus('error');
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

                    // Flush any pending plugin saves that were queued before DB was ready
                    try {
                        const pending = localStorage.getItem('task_plugin_pending');
                        if (pending) {
                            const parsed = JSON.parse(pending);
                            this.savePluginData('task', parsed);
                            await this.save();
                            localStorage.removeItem('task_plugin_pending');
                            console.log('DB: flushed pending plugin data for task plugin');
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
                    alert(t.alert_corrupt_db_backup || "Attention: Database is corrupt. A backup has been created (corrupt_backup) and a new database will be initialized.");

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
        if (!this.SQL) {
            console.log("DB: SQL not ready, re-initializing...");
            await this.init();
        }
        this.db = new this.SQL.Database();
        this.initSchema();
        // Persists root database settings utilizing UPSERT operations to bypass schema collisions
        this.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['db_password', passwordHash], false);
        this.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['rules', '0'], false);
        this.save();
        return true;
    },

    /**
     * Create DB with explicit key (optional). If dbKey provided, set active DB to it.
     */
    async createDBWithKey(passwordHash, dbKey) {
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

    initSchema() {
        // Core Tables
        this.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
        this.run(`CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        this.run(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            chat_id INTEGER, 
            role TEXT, 
            content TEXT, 
            emotion TEXT, 
            is_html INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
        )`);
        this.run(`CREATE TABLE IF NOT EXISTS memory_facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            content TEXT, 
            category TEXT, 
            embedding TEXT, 
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        this.run(`CREATE TABLE IF NOT EXISTS modules_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            type TEXT, 
            name TEXT, 
            content TEXT, 
            tags TEXT, 
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Personality state: persistent mood/sarcasm/humor
        this.run(`CREATE TABLE IF NOT EXISTS personality_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE,
            mood INTEGER DEFAULT 50,
            sarcasm INTEGER DEFAULT 0,
            humor INTEGER DEFAULT 50,
            affinity INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Executes incremental database structure migrations tracking operational schema rules

        // Verifies base setting configurations exist dynamically
        const hasRules = this.query("SELECT key FROM settings WHERE key = 'rules'");
        if (hasRules.length === 0) {
            this.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", ['rules', '0']);
        }

        // Resolves structural dependencies implicitly missing from earlier implementations
        try {
            this.run(`ALTER TABLE messages ADD COLUMN is_html INTEGER DEFAULT 0`);
        } catch (e) {
            // Suppresses conflicts for pre-existing modifications
        }

        try {
            this.run(`ALTER TABLE chats ADD COLUMN sort_order INTEGER DEFAULT 0`);
        } catch (e) {
            // Suppresses conflicts for pre-existing modifications
        }
    },

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
        stmt.bind(params);
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    },

    savePluginData(pluginId, data) {
        try {
            const content = JSON.stringify(data);
            const existing = this.query("SELECT id FROM modules_data WHERE type = 'plugin' AND name = ?", [pluginId]);
            if (existing && existing.length > 0) {
                this.run("UPDATE modules_data SET content = ?, created_at = CURRENT_TIMESTAMP WHERE type = 'plugin' AND name = ?", [content, pluginId]);
            } else {
                this.run("INSERT INTO modules_data (type, name, content) VALUES ('plugin', ?, ?)", [pluginId, content]);
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
        this.run("DELETE FROM chats WHERE id = ?", [id]);
    },

    getMessages(chatId) {
        return this.query("SELECT * FROM messages WHERE chat_id = ? ORDER BY id ASC", [chatId]);
    },

    saveMessage(chatId, role, content, emotion = '', isHTML = false) {
        const isHtmlVal = isHTML ? 1 : 0;
        this.run("INSERT INTO messages (chat_id, role, content, emotion, is_html) VALUES (?, ?, ?, ?, ?)", [chatId, role, content, emotion, isHtmlVal]);
        this.run("UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [chatId]);
    },

    updateChatTitle(id, title) {
        this.run("UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [title, id]);
        this.save();
    },

    updateChatOrder(id, order, autoSave = true) {
        this.run("UPDATE chats SET sort_order = ? WHERE id = ?", [order, id], autoSave);
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
        this.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value], autoSave);
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
                if (window.app && window.app.updateSyncStatus) window.app.updateSyncStatus('syncing');

                this.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['last_save_ts', Date.now().toString()], false);
                const data = this.db.export();

                await localforage.setItem(this.dbPath, data);

                if (this.fileHandle) {
                    try {
                        const writable = await this.fileHandle.createWritable();
                        await writable.write(data);
                        await writable.close();
                    } catch (fileErr) {
                        console.error('DB.save: file write failed', fileErr);
                        window.app?.updateSyncStatus('error');
                    }
                }

                // Debounced push to the configured remote storage (no-op when locked)
                try {
                    if (window.RemoteStorage && RemoteStorage.isUnlocked()) {
                        RemoteStorage.schedulePush(data);
                    }
                } catch (remoteErr) {
                    console.warn('DB.save: remote scheduling failed', remoteErr);
                }

                if (window.app && window.app.updateSyncStatus) {
                    setTimeout(() => window.app.updateSyncStatus('synced'), 500);
                }
            } catch (e) {
                console.error("DB: Auto-save failed", e);
                if (window.app && window.app.updateSyncStatus) window.app.updateSyncStatus('error');
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
            const success = await this.smartLoad(handle);
            if (success) {
                await this.setFileHandle(handle);
                return true;
            }
            return false;
        } catch (e) {
            console.warn("Open picker cancelled or failed", e);
            return false;
        }
    },

    // Smartly compare file content with local DB to prevent overwriting newer data
    async smartLoad(handle) {
        try {
            const file = await handle.getFile();
            // Migrates external blob data to an isolated WebAssembly buffer layer
            const arrayBuffer = await file.arrayBuffer();
            const u8 = new Uint8Array(arrayBuffer);
            const tempSQL = await window.initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
            const tempDB = new tempSQL.Database(u8);

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

                const loadFile = confirm(msg);

                if (!loadFile) {
                    // Keep local, but attach handle and SAVE current to it
                    console.log("DB: Keeping local data, overwriting stale file.");
                    return true; // We return true so setFileHandle proceeds, then we save.
                }
            }

            // If we are here, we load the file (either it's newer, or user insisted)

            // Create a unique key for this file if it's a new import context
            // But actually, for "Open", we usually want to replace the current context.
            // We'll keep the logic simple: overwrite current DB instance.
            const name = (file.name || 'import').replace(/[^a-z0-9\.\-_]/gi, '_');
            const key = `aru_db_file_${name}_${Date.now()}`;
            this.dbPath = key;
            this.handleKey = `aru_handle_${this.dbPath}`; 
            localStorage.setItem('aru_active_db', key);

            this.SQL = tempSQL; // Ensure we use the same SQL instance
            this.db = tempDB;
            await this.save(); // Save the loaded data to IndexedDB
            return true;

        } catch (e) {
            console.error("DB: smartLoad failed", e);
            const t = window.aruState?.translations || {};
            alert((t.alert_load_file_error || "Error loading file: ") + e.message);
            return false;
        }
    },

    // Loads a DB image from raw bytes (remote storage) with the same freshness guard as smartLoad.
    // force=true skips the guard (user explicitly chose "take remote").
    async smartLoadFromBytes(u8, { force = false } = {}) {
        const tempSQL = await window.initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
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

        this.SQL = tempSQL;
        this.db = tempDB;
        await this.save();
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
                    const a = document.createElement('a');
                    document.body.appendChild(a);
                    a.href = window.URL.createObjectURL(blob);
                    a.download = 'aru_remote_copy.sqlite';
                    a.onclick = () => { setTimeout(() => { document.body.removeChild(a); }, 1500); };
                    a.click();
                }
            }
        } catch (e) {
            console.warn('DB.syncWithRemoteOnStart failed', e);
            window.app?.updateSyncStatus('cloud-error');
        }
    },

    // Handler for poll-detected external changes: asks unless the user configured an automatic rule
    async handleRemoteNewer(info) {
        const settings = this.getSettings();
        const mode = settings.remote_conflict || 'ask';
        const t = window.aruState?.translations || {};
        try {
            if (mode === 'remote') {
                await this.applyRemoteBytes(await RemoteStorage.pullBytes());
            } else if (mode === 'local') {
                await RemoteStorage.pushNow(this.db.export());
            } else {
                const ok = confirm(t.remote_newer_confirm || 'The remote database copy was changed from another device. Download it now? (Cancel = keep local and upload)');
                if (ok) {
                    await this.applyRemoteBytes(await RemoteStorage.pullBytes());
                } else {
                    await RemoteStorage.pushNow(this.db.export());
                }
            }
        } catch (e) {
            console.warn('DB.handleRemoteNewer failed', e);
            window.app?.updateSyncStatus('cloud-error');
        }
    },

    async exportToFile(filenamePrefix = 'aru_backup') {
        if (!this.db) return;
        await this.save(); // Ensure latest is saved
        const data = this.db.export();
        const blob = new Blob([data], { type: 'application/x-sqlite3' });
        const a = document.createElement('a');
        document.body.appendChild(a);
        a.href = window.URL.createObjectURL(blob);
        const name = filenamePrefix.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `${name}_${new Date().toISOString().slice(0, 10)}.sqlite`;
        a.onclick = () => { setTimeout(() => { document.body.removeChild(a); }, 1500); };
        a.click();
    },

    // Import from file input (Drag & Drop or Manual Import Modal)
    async importFromFile(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = async () => {
                try {
                    if (!this.SQL) await this.init();
                    const u8 = new Uint8Array(r.result);
                    this.db = new this.SQL.Database(u8);

                    // Reset File Handle on manual import as it breaks the link to previous file
                    this.fileHandle = null;
                    if (this.handleKey) await localforage.removeItem(this.handleKey);

                    await this.save();
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
    getExportData(types, filters = {}) {
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
                } else {
                    const ids = filters.chats.join(',');
                    result.data.chats = this.query(`SELECT * FROM chats WHERE id IN (${ids})`);
                    result.data.messages = this.query(`SELECT * FROM messages WHERE chat_id IN (${ids})`);
                }
            } else {
                result.data.chats = this.query("SELECT * FROM chats");
                result.data.messages = this.query("SELECT * FROM messages");
            }
        }

        if (types.includes('settings')) {
            result.data.settings = this.query("SELECT * FROM settings");
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
                tempDb.run(`CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, sort_order INTEGER DEFAULT 0)`);
                tempDb.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, role TEXT, content TEXT, emotion TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, is_html INTEGER DEFAULT 0)`);
                tempDb.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
                tempDb.run(`CREATE TABLE IF NOT EXISTS personality_state (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, mood INTEGER DEFAULT 50, sarcasm INTEGER DEFAULT 0, humor INTEGER DEFAULT 50, affinity INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
                tempDb.run(`CREATE TABLE IF NOT EXISTS memory_facts (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, category TEXT, embedding TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
                tempDb.run(`CREATE TABLE IF NOT EXISTS modules_data (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, name TEXT, content TEXT, tags TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

                const data = imported.data;
                if (data.chats) {
                    for (const chat of data.chats) tempDb.run("INSERT INTO chats (id, title, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [chat.id, chat.title || 'Chat', chat.sort_order || 0, chat.created_at || null, chat.updated_at || null]);
                    for (const m of data.messages) tempDb.run("INSERT INTO messages (id, chat_id, role, content, emotion, is_html, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [m.id, m.chat_id, m.role || 'user', m.content || '', m.emotion !== undefined ? m.emotion : null, m.is_html || 0, m.created_at || null]);
                }
                if (data.settings) {
                    for (const s of data.settings) tempDb.run("INSERT INTO settings (key, value) VALUES (?, ?)", [s.key, s.value || '']);
                    for (const p of data.personality) tempDb.run("INSERT INTO personality_state (key, mood, sarcasm, humor, affinity, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [p.key, p.mood || 50, p.sarcasm || 0, p.humor || 50, p.affinity || 0, p.updated_at || null]);
                    for (const m of data.memory) tempDb.run("INSERT INTO memory_facts (id, content, category, embedding, created_at) VALUES (?, ?, ?, ?, ?)", [m.id, m.content || '', m.category || '', m.embedding || '', m.created_at || null]);
                }
                if (data.artifacts) {
                    for (const a of data.artifacts) tempDb.run("INSERT INTO modules_data (id, type, name, content, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)", [a.id, a.type || '', a.name || '', a.content || '', a.tags || '', a.created_at || null]);
                }
                if (data.tasks) {
                    for (const t of data.tasks) tempDb.run("INSERT INTO modules_data (id, type, name, content, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)", [t.id, t.type || '', t.name || '', t.content || '', t.tags || '', t.created_at || null]);
                }
                exportU8 = tempDb.export();
            }

            const blob = new Blob([exportU8], { type: 'application/x-sqlite3' });
            const a = document.createElement('a');
            document.body.appendChild(a);
            a.href = window.URL.createObjectURL(blob);
            const prefix = isFullDb ? 'full' : 'partial';
            a.download = `aru_transfer_${prefix}_${Date.now()}.sqlite`;
            a.onclick = () => { setTimeout(() => { document.body.removeChild(a); }, 1500); };
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

            if (mode === 'overwrite') {
                if (data.chats) { 
                    this.run("DELETE FROM messages"); this.run("DELETE FROM chats"); 
                    for (const chat of data.chats) this.run("INSERT INTO chats (id, title, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [chat.id, chat.title || 'Chat', chat.sort_order || 0, chat.created_at || null, chat.updated_at || null]);
                    for (const m of data.messages) this.run("INSERT INTO messages (id, chat_id, role, content, emotion, is_html, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [m.id, m.chat_id, m.role || 'user', m.content || '', m.emotion !== undefined ? m.emotion : null, m.is_html || 0, m.created_at || null]);
                }
                if (data.settings) { 
                    this.run("DELETE FROM settings"); this.run("DELETE FROM personality_state"); this.run("DELETE FROM memory_facts"); 
                    for (const s of data.settings) this.run("INSERT INTO settings (key, value) VALUES (?, ?)", [s.key, s.value]);
                    for (const p of data.personality) this.run("INSERT INTO personality_state (key, mood, sarcasm, humor, affinity, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [p.key, p.mood, p.sarcasm, p.humor, p.affinity, p.updated_at]);
                    for (const m of data.memory) this.run("INSERT INTO memory_facts (id, content, category, embedding, created_at) VALUES (?, ?, ?, ?, ?)", [m.id, m.content, m.category, m.embedding, m.created_at]);
                }
                if (data.artifacts) { 
                    this.run("DELETE FROM modules_data WHERE type != 'plugin'"); 
                    for (const a of data.artifacts) this.run("INSERT INTO modules_data (id, type, name, content, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)", [a.id, a.type, a.name, a.content, a.tags, a.created_at]);
                }
                if (data.tasks) { 
                    this.run("DELETE FROM modules_data WHERE type = 'plugin' AND name = 'task'"); 
                    for (const t of data.tasks) this.run("INSERT INTO modules_data (id, type, name, content, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)", [t.id, t.type, t.name, t.content, t.tags, t.created_at]);
                }
            } else if (mode === 'merge') {
                if (data.chats) {
                    for (const chat of data.chats) {
                        const oldId = chat.id;
                        this.run("INSERT INTO chats (title, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?)", [chat.title || 'Chat', chat.sort_order || 0, chat.created_at || null, chat.updated_at || null]);
                        const res = this.exec("SELECT last_insert_rowid() as id");
                        const newId = (res && res[0] && res[0].values && res[0].values[0]) ? res[0].values[0][0] : null;

                        const messages = data.messages.filter(m => String(m.chat_id) === String(oldId));
                        for (const m of messages) {
                            this.run("INSERT INTO messages (chat_id, role, content, emotion, is_html, created_at) VALUES (?, ?, ?, ?, ?, ?)", [newId, m.role || 'user', m.content || '', m.emotion !== undefined ? m.emotion : null, m.is_html || 0, m.created_at || null]);
                        }
                    }
                }
                if (data.settings) {
                    for (const s of data.settings) this.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [s.key, s.value]);
                    for (const p of data.personality) this.run("INSERT OR REPLACE INTO personality_state (key, mood, sarcasm, humor, affinity, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [p.key, p.mood, p.sarcasm, p.humor, p.affinity, p.updated_at]);
                    for (const m of data.memory) this.run("INSERT INTO memory_facts (content, category, embedding, created_at) VALUES (?, ?, ?, ?)", [m.content, m.category, m.embedding, m.created_at]);
                }
                if (data.artifacts) {
                    for (const a of data.artifacts) this.run("INSERT INTO modules_data (type, name, content, tags, created_at) VALUES (?, ?, ?, ?, ?)", [a.type, a.name, a.content, a.tags, a.created_at]);
                }
                if (data.tasks) {
                    for (const t of data.tasks) {
                        const existing = this.query("SELECT id, content FROM modules_data WHERE name = 'task' AND type = 'plugin' LIMIT 1");
                        if (existing.length === 0) {
                            this.run("INSERT INTO modules_data (type, name, content, tags, created_at) VALUES (?, ?, ?, ?, ?)", [t.type, t.name, t.content, t.tags, t.created_at]);
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
                                    this.run("UPDATE modules_data SET content = ? WHERE id = ?", [JSON.stringify(oldParsed), existing[0].id]);
                                }
                            } catch(e) {}
                        }
                    }
                }
            }

            await this.save();
            return true;
        } catch (e) {
            console.error("applyTransferData partial failed:", e);
            throw e;
        }
    }
};
