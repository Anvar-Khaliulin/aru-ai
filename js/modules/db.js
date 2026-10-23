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

                    // Self-healing forward migration: upgrades existing databases in place (folders, favorites, chapters)
                    try {
                        if (this.migrateSchema()) {
                            let canPersist = !this.fileHandle;
                            if (this.fileHandle) {
                                try { canPersist = (await this.fileHandle.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch (permErr) { canPersist = false; }
                            }
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
        this.migrateSchema();
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
            attachments TEXT,
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

        this.run(`CREATE TABLE IF NOT EXISTS chat_artifacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER,
            title TEXT,
            type TEXT,
            code TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(chat_id, title)
        )`);
        this.run(`CREATE INDEX IF NOT EXISTS idx_chat_artifacts_chat ON chat_artifacts(chat_id)`);

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

    // --- Schema Migration (forward compatible with older databases) ---

    tableExists(name) {
        const rows = this.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]);
        return rows.length > 0;
    },

    hasColumn(table, column) {
        try {
            const rows = this.query(`PRAGMA table_info(${table})`);
            return rows.some(r => r.name === column);
        } catch (e) {
            return false;
        }
    },

    // Idempotent upgrade of any existing database file. Adds only new structures,
    // never alters or drops existing ones, so older app versions keep working.
    migrateSchema() {
        let changed = false;
        try {
            // Baseline tables: introduced at different app versions, may be missing in old files
            if (!this.tableExists('settings')) {
                this.run(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`, [], false);
                changed = true;
            }
            if (!this.tableExists('chats')) {
                this.run(`CREATE TABLE chats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT,
                    sort_order INTEGER DEFAULT 0,
                    folder_id INTEGER DEFAULT NULL,
                    is_favorite INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('messages')) {
                this.run(`CREATE TABLE messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER,
                    role TEXT,
                    content TEXT,
                    emotion TEXT,
                    is_html INTEGER DEFAULT 0,
                    attachments TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('memory_facts')) {
                this.run(`CREATE TABLE memory_facts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    content TEXT,
                    category TEXT,
                    embedding TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('modules_data')) {
                this.run(`CREATE TABLE modules_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT,
                    name TEXT,
                    content TEXT,
                    tags TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('personality_state')) {
                this.run(`CREATE TABLE personality_state (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT UNIQUE,
                    mood INTEGER DEFAULT 50,
                    sarcasm INTEGER DEFAULT 0,
                    humor INTEGER DEFAULT 50,
                    affinity INTEGER DEFAULT 0,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (!this.hasColumn('chats', 'sort_order')) {
                this.run("ALTER TABLE chats ADD COLUMN sort_order INTEGER DEFAULT 0", [], false);
                changed = true;
            }
            if (!this.hasColumn('messages', 'is_html')) {
                this.run("ALTER TABLE messages ADD COLUMN is_html INTEGER DEFAULT 0", [], false);
                changed = true;
            }
            if (!this.hasColumn('messages', 'attachments')) {
                this.run("ALTER TABLE messages ADD COLUMN attachments TEXT", [], false);
                changed = true;
            }
            if (!this.hasColumn('chats', 'folder_id')) {
                this.run("ALTER TABLE chats ADD COLUMN folder_id INTEGER DEFAULT NULL", [], false);
                changed = true;
            }
            if (!this.hasColumn('chats', 'is_favorite')) {
                this.run("ALTER TABLE chats ADD COLUMN is_favorite INTEGER DEFAULT 0", [], false);
                changed = true;
            }
            if (!this.tableExists('folders')) {
                this.run(`CREATE TABLE folders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT,
                    sort_order INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('chat_sections')) {
                this.run(`CREATE TABLE chat_sections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER,
                    title TEXT,
                    sort_order INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('chat_chapters')) {
                this.run(`CREATE TABLE chat_chapters (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER,
                    section_id INTEGER,
                    title TEXT,
                    anchor_message_id INTEGER,
                    sort_order INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('chat_artifacts')) {
                this.run(`CREATE TABLE chat_artifacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER,
                    title TEXT,
                    type TEXT,
                    code TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(chat_id, title)
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_chat_artifacts_chat ON chat_artifacts(chat_id)`, [], false);
                changed = true;
            }
            // Aru Skills: user-built skill library, projects, relay pipelines and run history
            if (!this.tableExists('skills')) {
                this.run(`CREATE TABLE skills (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT,
                    system_prompt TEXT,
                    llm_type TEXT DEFAULT 'gemini',
                    api_key TEXT DEFAULT '',
                    base_url TEXT DEFAULT '',
                    model_name TEXT DEFAULT '',
                    temperature REAL DEFAULT 0.9,
                    input_limit INTEGER DEFAULT 4096,
                    max_output INTEGER DEFAULT 2048,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('skill_projects')) {
                this.run(`CREATE TABLE skill_projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT,
                    context_limit INTEGER DEFAULT 16384,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('skill_project_items')) {
                this.run(`CREATE TABLE skill_project_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER,
                    kind TEXT DEFAULT 'file',
                    name TEXT,
                    content TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_skill_items_project ON skill_project_items(project_id)`, [], false);
                changed = true;
            }
            if (!this.tableExists('skill_pipeline_steps')) {
                this.run(`CREATE TABLE skill_pipeline_steps (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER,
                    skill_id INTEGER,
                    sort_order INTEGER DEFAULT 0,
                    enabled INTEGER DEFAULT 1,
                    is_final INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_skill_steps_project ON skill_pipeline_steps(project_id)`, [], false);
                changed = true;
            }
            if (!this.tableExists('skill_runs')) {
                this.run(`CREATE TABLE skill_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER,
                    input_text TEXT,
                    status TEXT DEFAULT 'pending',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_skill_runs_project ON skill_runs(project_id)`, [], false);
                changed = true;
            }
            if (!this.tableExists('skill_run_steps')) {
                this.run(`CREATE TABLE skill_run_steps (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id INTEGER,
                    step_id INTEGER,
                    step_order INTEGER,
                    skill_id INTEGER,
                    skill_title TEXT,
                    provider TEXT,
                    model TEXT,
                    input_text TEXT,
                    output_text TEXT,
                    status TEXT DEFAULT 'pending',
                    error TEXT,
                    tokens_est INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_skill_run_steps_run ON skill_run_steps(run_id)`, [], false);
                changed = true;
            }
            // Relay steps record whether the model hit its output cap, so the next step
            // can be told to finish the work instead of restarting it
            if (this.tableExists('skill_run_steps') && !this.hasColumn('skill_run_steps', 'truncated')) {
                this.run("ALTER TABLE skill_run_steps ADD COLUMN truncated INTEGER DEFAULT 0", [], false);
                changed = true;
            }
            if (!this.tableExists('skill_artifacts')) {
                this.run(`CREATE TABLE skill_artifacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER,
                    run_id INTEGER,
                    title TEXT,
                    type TEXT DEFAULT 'doc',
                    code TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(project_id, title)
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_skill_artifacts_project ON skill_artifacts(project_id)`, [], false);
                changed = true;
            }
            // The chat thread of a project: user requests, relay runs and answers.
            // `meta` carries the JSON side-data (run id, artifact ids, file names).
            if (!this.tableExists('skill_project_messages')) {
                this.run(`CREATE TABLE skill_project_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER,
                    kind TEXT DEFAULT 'user',
                    content TEXT,
                    meta TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_skill_messages_project ON skill_project_messages(project_id)`, [], false);
                changed = true;
            }
            // Aru Fit & Care: locally stored daily wellbeing and activity log.
            // Health data intentionally stays in this device database; no external
            // service is required for the first version of the plugin.
            if (!this.tableExists('fit_profiles')) {
                this.run(`CREATE TABLE fit_profiles (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    display_name TEXT DEFAULT '',
                    target_weight REAL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('fit_daily_logs')) {
                this.run(`CREATE TABLE fit_daily_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    log_date TEXT NOT NULL UNIQUE,
                    weight REAL,
                    workout_status TEXT DEFAULT '',
                    workout_note TEXT DEFAULT '',
                    meal_note TEXT DEFAULT '',
                    sleep_hours REAL,
                    energy INTEGER,
                    note TEXT DEFAULT '',
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_fit_daily_logs_date ON fit_daily_logs(log_date)`, [], false);
                changed = true;
            }
            if (this.tableExists('fit_daily_logs') && !this.hasColumn('fit_daily_logs', 'meal_note')) {
                this.run("ALTER TABLE fit_daily_logs ADD COLUMN meal_note TEXT DEFAULT ''", [], false);
                changed = true;
            }

            // Fit & Care 2.0: goals, body composition, plans, protocols, cycle tracking.
            // All additions are forward-compatible: old rows keep working because every
            // new column has a default and every table is created only when missing.
            const profileColumns = [
                ['sex', "TEXT DEFAULT ''"],
                ['birth_year', 'INTEGER'],
                ['height_cm', 'REAL'],
                ['activity_level', "TEXT DEFAULT 'moderate'"],
                ['goal', "TEXT DEFAULT 'maintain'"],
                ['target_date', "TEXT DEFAULT ''"],
                ['calorie_min', 'INTEGER'],
                ['calorie_max', 'INTEGER'],
                ['aru_tone', "TEXT DEFAULT 'supportive'"],
                ['aru_notes', "TEXT DEFAULT ''"],
                ['cycle_tracking', 'INTEGER DEFAULT 0'],
                ['cycle_length', 'INTEGER DEFAULT 28'],
                ['period_length', 'INTEGER DEFAULT 5'],
                ['luteal_length', 'INTEGER DEFAULT 14'],
                ['disclaimer_accepted', 'INTEGER DEFAULT 0'],
                ['intimacy_tracking', 'INTEGER DEFAULT 0']
            ];
            for (const [col, def] of profileColumns) {
                if (!this.hasColumn('fit_profiles', col)) {
                    this.run(`ALTER TABLE fit_profiles ADD COLUMN ${col} ${def}`, [], false);
                    changed = true;
                }
            }

            const dailyColumns = [
                ['body_fat', 'REAL'],
                ['muscle_mass', 'REAL'],
                ['water_pct', 'REAL'],
                ['bone_mass', 'REAL'],
                ['visceral_fat', 'REAL'],
                ['steps', 'INTEGER'],
                ['calories', 'INTEGER'],
                ['protein', 'REAL'],
                ['carbs', 'REAL'],
                ['fat', 'REAL'],
                ['mood', 'INTEGER'],
                ['stress', 'INTEGER'],
                ['symptoms', "TEXT DEFAULT '[]'"],
                ['water_ml', 'INTEGER'],
                ['measurement_note', "TEXT DEFAULT ''"]
            ];
            for (const [col, def] of dailyColumns) {
                if (!this.hasColumn('fit_daily_logs', col)) {
                    this.run(`ALTER TABLE fit_daily_logs ADD COLUMN ${col} ${def}`, [], false);
                    changed = true;
                }
            }

            if (!this.tableExists('fit_plans')) {
                this.run(`CREATE TABLE fit_plans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT DEFAULT '',
                    goal TEXT DEFAULT '',
                    start_date TEXT DEFAULT '',
                    weeks INTEGER DEFAULT 4,
                    status TEXT DEFAULT 'active',
                    notes TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('fit_plan_days')) {
                this.run(`CREATE TABLE fit_plan_days (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    plan_id INTEGER NOT NULL,
                    week_index INTEGER DEFAULT 0,
                    weekday INTEGER DEFAULT 1,
                    title TEXT DEFAULT '',
                    focus TEXT DEFAULT '',
                    exercises TEXT DEFAULT '[]',
                    notes TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_fit_plan_days_plan ON fit_plan_days(plan_id)`, [], false);
                changed = true;
            }
            if (!this.tableExists('fit_workouts')) {
                this.run(`CREATE TABLE fit_workouts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    log_date TEXT NOT NULL,
                    log_time TEXT DEFAULT '',
                    plan_day_id INTEGER,
                    title TEXT DEFAULT '',
                    exercises TEXT DEFAULT '[]',
                    duration_min INTEGER,
                    volume_kg REAL,
                    rpe INTEGER,
                    status TEXT DEFAULT 'done',
                    note TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_fit_workouts_date ON fit_workouts(log_date)`, [], false);
                changed = true;
            }
            if (!this.tableExists('fit_meals')) {
                this.run(`CREATE TABLE fit_meals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    log_date TEXT NOT NULL,
                    meal_time TEXT DEFAULT '',
                    title TEXT DEFAULT '',
                    tags TEXT DEFAULT '[]',
                    calories INTEGER,
                    protein REAL,
                    carbs REAL,
                    fat REAL,
                    note TEXT DEFAULT '',
                    estimated INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_fit_meals_date ON fit_meals(log_date)`, [], false);
                changed = true;
            }
            if (this.tableExists('fit_meals') && !this.hasColumn('fit_meals', 'estimated')) {
                this.run('ALTER TABLE fit_meals ADD COLUMN estimated INTEGER DEFAULT 0', [], false);
                changed = true;
            }
            if (!this.tableExists('fit_protocols')) {
                this.run(`CREATE TABLE fit_protocols (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT DEFAULT '',
                    kind TEXT DEFAULT 'medication',
                    dosage TEXT DEFAULT '',
                    schedule TEXT DEFAULT '{"times":[],"days":[]}',
                    rules TEXT DEFAULT '{}',
                    notes TEXT DEFAULT '',
                    active INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('fit_health_logs')) {
                this.run(`CREATE TABLE fit_health_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    log_date TEXT NOT NULL,
                    log_time TEXT DEFAULT '',
                    protocol_id INTEGER,
                    type TEXT DEFAULT 'measurement',
                    name TEXT DEFAULT '',
                    value REAL,
                    value2 REAL,
                    unit TEXT DEFAULT '',
                    status TEXT DEFAULT 'logged',
                    tags TEXT DEFAULT '[]',
                    note TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_fit_health_logs_date ON fit_health_logs(log_date)`, [], false);
                changed = true;
            }
            if (!this.tableExists('fit_cycles')) {
                this.run(`CREATE TABLE fit_cycles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    start_date TEXT NOT NULL,
                    end_date TEXT DEFAULT '',
                    cycle_length INTEGER,
                    period_length INTEGER,
                    notes TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_fit_cycles_start ON fit_cycles(start_date)`, [], false);
                changed = true;
            }
            if (!this.tableExists('fit_cycle_logs')) {
                this.run(`CREATE TABLE fit_cycle_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    log_date TEXT NOT NULL UNIQUE,
                    flow TEXT DEFAULT '',
                    note TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('fit_intimacy_logs')) {
                this.run(`CREATE TABLE fit_intimacy_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    log_date TEXT NOT NULL,
                    protection TEXT DEFAULT '',
                    note TEXT DEFAULT '',
                    log_time TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_fit_intimacy_date ON fit_intimacy_logs(log_date)`, [], false);
                changed = true;
            }
            if (this.tableExists('fit_intimacy_logs') && !this.hasColumn('fit_intimacy_logs', 'log_time')) {
                this.run("ALTER TABLE fit_intimacy_logs ADD COLUMN log_time TEXT DEFAULT ''", [], false);
                changed = true;
            }
            if (!this.tableExists('fit_chat_messages')) {
                this.run(`CREATE TABLE fit_chat_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    log_date TEXT NOT NULL,
                    role TEXT DEFAULT 'user',
                    content TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_fit_chat_date ON fit_chat_messages(log_date)`, [], false);
                changed = true;
            }
            if (changed) console.log('DB: schema migrated (folders/favorites/chapters/skills/fit-care ready)');
        } catch (e) {
            console.warn('DB.migrateSchema failed', e);
        }
        return changed;
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
        this.run("DELETE FROM skill_run_steps WHERE run_id = ?", [id], false);
        this.run("DELETE FROM skill_runs WHERE id = ?", [id]);
    },

    // Keeps only the newest `keep` runs of a project (auto-cleanup of bulky run history)
    trimSkillRuns(projectId, keep = 15) {
        const rows = this.query("SELECT id FROM skill_runs WHERE project_id = ? ORDER BY id DESC", [projectId]);
        const stale = rows.slice(keep);
        for (const r of stale) {
            this.run("DELETE FROM skill_run_steps WHERE run_id = ?", [r.id], false);
            this.run("DELETE FROM skill_runs WHERE id = ?", [r.id], false);
        }
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

    // --- Aru Fit & Care ---

    _fitDateKey(date) {
        const d = date instanceof Date ? date : new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    _fitDateFromKey(key) {
        return new Date(`${key}T12:00:00`);
    },

    _fitAddDays(key, days) {
        const d = this._fitDateFromKey(key);
        d.setDate(d.getDate() + Number(days || 0));
        return this._fitDateKey(d);
    },

    _fitDiffDays(fromKey, toKey) {
        const a = this._fitDateFromKey(fromKey).getTime();
        const b = this._fitDateFromKey(toKey).getTime();
        return Math.round((b - a) / 86400000);
    },

    _fitProfileDefaults() {
        return {
            id: 1, display_name: '', target_weight: null, sex: '', birth_year: null,
            height_cm: null, activity_level: 'moderate', goal: 'maintain', target_date: '',
            calorie_min: null, calorie_max: null, aru_tone: 'supportive', aru_notes: '',
            cycle_tracking: 0, cycle_length: 28, period_length: 5, luteal_length: 14,
            disclaimer_accepted: 0, intimacy_tracking: 0
        };
    },

    getFitProfile() {
        const rows = this.query("SELECT * FROM fit_profiles WHERE id = 1 LIMIT 1");
        const p = Object.assign(this._fitProfileDefaults(), rows.length ? rows[0] : {});
        p.cycle_tracking = Number(p.cycle_tracking) || 0;
        p.disclaimer_accepted = Number(p.disclaimer_accepted) || 0;
        p.intimacy_tracking = Number(p.intimacy_tracking) || 0;
        p.cycle_length = Math.min(60, Math.max(15, Number(p.cycle_length) || 28));
        p.period_length = Math.min(15, Math.max(1, Number(p.period_length) || 5));
        p.luteal_length = Math.min(20, Math.max(7, Number(p.luteal_length) || 14));
        return p;
    },

    saveFitProfile(data, autoSave = true) {
        const d = Object.assign(this.getFitProfile(), data || {});
        try {
            this.run(`INSERT INTO fit_profiles (id, display_name, target_weight, sex, birth_year, height_cm,
                activity_level, goal, target_date, calorie_min, calorie_max, aru_tone, aru_notes,
                cycle_tracking, cycle_length, period_length, luteal_length, disclaimer_accepted,
                intimacy_tracking, updated_at)
                VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    display_name = excluded.display_name, target_weight = excluded.target_weight,
                    sex = excluded.sex, birth_year = excluded.birth_year, height_cm = excluded.height_cm,
                    activity_level = excluded.activity_level, goal = excluded.goal, target_date = excluded.target_date,
                    calorie_min = excluded.calorie_min, calorie_max = excluded.calorie_max,
                    aru_tone = excluded.aru_tone, aru_notes = excluded.aru_notes,
                    cycle_tracking = excluded.cycle_tracking, cycle_length = excluded.cycle_length,
                    period_length = excluded.period_length, luteal_length = excluded.luteal_length,
                    disclaimer_accepted = excluded.disclaimer_accepted,
                    intimacy_tracking = excluded.intimacy_tracking, updated_at = CURRENT_TIMESTAMP`,
            [d.display_name || '', d.target_weight ?? null, d.sex || '', d.birth_year ?? null, d.height_cm ?? null,
                d.activity_level || 'moderate', d.goal || 'maintain', d.target_date || '',
                d.calorie_min ?? null, d.calorie_max ?? null, d.aru_tone || 'supportive', d.aru_notes || '',
                Number(d.cycle_tracking) || 0, Number(d.cycle_length) || 28, Number(d.period_length) || 5,
                Number(d.luteal_length) || 14, Number(d.disclaimer_accepted) || 0,
                Number(d.intimacy_tracking) || 0], false);
            if (autoSave) this.save();
        } catch (e) {
            // Extremely old schema without the 2.0 columns: keep the legacy write working.
            console.warn('DB.saveFitProfile: extended write failed, using legacy columns', e);
            this.run(`INSERT INTO fit_profiles (id, display_name, target_weight, updated_at) VALUES (1, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, target_weight = excluded.target_weight, updated_at = CURRENT_TIMESTAMP`,
            [d.display_name || '', d.target_weight ?? null], autoSave);
        }
    },

    _fitDailyDefaults() {
        return {
            weight: null, workout_status: '', workout_note: '', meal_note: '', sleep_hours: null,
            energy: null, note: '', body_fat: null, muscle_mass: null, water_pct: null,
            bone_mass: null, visceral_fat: null, steps: null, calories: null, protein: null,
            carbs: null, fat: null, mood: null, stress: null, symptoms: '[]', water_ml: null,
            measurement_note: ''
        };
    },

    getFitDailyLogs(fromDate, toDate) {
        return this.query("SELECT * FROM fit_daily_logs WHERE log_date >= ? AND log_date <= ? ORDER BY log_date ASC", [fromDate, toDate]);
    },

    getFitDailyLog(date) {
        const rows = this.query("SELECT * FROM fit_daily_logs WHERE log_date = ? LIMIT 1", [date]);
        return rows.length ? rows[0] : null;
    },

    saveFitDailyLog(data, autoSave = true) {
        const d = data || {};
        if (!d.log_date) return null;
        const merged = Object.assign(this._fitDailyDefaults(), this.getFitDailyLog(d.log_date) || {}, d);
        const symptoms = Array.isArray(merged.symptoms) ? JSON.stringify(merged.symptoms) : (merged.symptoms || '[]');
        this.run(`INSERT INTO fit_daily_logs (log_date, weight, workout_status, workout_note, meal_note, sleep_hours,
            energy, note, body_fat, muscle_mass, water_pct, bone_mass, visceral_fat, steps, calories, protein,
            carbs, fat, mood, stress, symptoms, water_ml, measurement_note, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(log_date) DO UPDATE SET
                weight = excluded.weight, workout_status = excluded.workout_status, workout_note = excluded.workout_note,
                meal_note = excluded.meal_note, sleep_hours = excluded.sleep_hours, energy = excluded.energy,
                note = excluded.note, body_fat = excluded.body_fat, muscle_mass = excluded.muscle_mass,
                water_pct = excluded.water_pct, bone_mass = excluded.bone_mass, visceral_fat = excluded.visceral_fat,
                steps = excluded.steps, calories = excluded.calories, protein = excluded.protein,
                carbs = excluded.carbs, fat = excluded.fat, mood = excluded.mood, stress = excluded.stress,
                symptoms = excluded.symptoms, water_ml = excluded.water_ml, measurement_note = excluded.measurement_note,
                updated_at = CURRENT_TIMESTAMP`,
        [merged.log_date, merged.weight ?? null, merged.workout_status || '', merged.workout_note || '',
            merged.meal_note || '', merged.sleep_hours ?? null, merged.energy ?? null, merged.note || '',
            merged.body_fat ?? null, merged.muscle_mass ?? null, merged.water_pct ?? null,
            merged.bone_mass ?? null, merged.visceral_fat ?? null, merged.steps ?? null,
            merged.calories ?? null, merged.protein ?? null, merged.carbs ?? null, merged.fat ?? null,
            merged.mood ?? null, merged.stress ?? null, symptoms, merged.water_ml ?? null,
            merged.measurement_note || ''], false);
        if (autoSave) this.save();
        return merged;
    },

    patchFitDailyLog(date, changes) {
        const next = Object.assign(this._fitDailyDefaults(), this.getFitDailyLog(date) || {}, changes || {}, { log_date: date });
        this.saveFitDailyLog(next);
        return next;
    },

    // --- Fit & Care: training plans (week_index = 0 is the repeating template) ---

    getFitPlans(status = '') {
        if (status) return this.query("SELECT * FROM fit_plans WHERE status = ? ORDER BY start_date DESC, id DESC", [status]);
        return this.query("SELECT * FROM fit_plans ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, start_date DESC, id DESC");
    },

    getFitPlan(id) {
        const rows = this.query("SELECT * FROM fit_plans WHERE id = ? LIMIT 1", [Number(id)]);
        return rows.length ? rows[0] : null;
    },

    saveFitPlan(data, autoSave = true) {
        const d = data || {};
        let id = Number(d.id) || null;
        if (d.status === 'active') {
            this.run("UPDATE fit_plans SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE status = 'active' AND id <> ?", [id || 0], false);
        }
        if (id) {
            this.run(`UPDATE fit_plans SET title = ?, goal = ?, start_date = ?, weeks = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [d.title || '', d.goal || '', d.start_date || '', Number(d.weeks) || 4, d.status || 'active', d.notes || '', id], false);
        } else {
            this.run(`INSERT INTO fit_plans (title, goal, start_date, weeks, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`,
            [d.title || '', d.goal || '', d.start_date || '', Number(d.weeks) || 4, d.status || 'active', d.notes || ''], false);
            id = this._lastInsertId('fit_plans');
        }
        if (autoSave) this.save();
        return id;
    },

    deleteFitPlan(id) {
        this.run("DELETE FROM fit_plan_days WHERE plan_id = ?", [Number(id)], false);
        this.run("DELETE FROM fit_plans WHERE id = ?", [Number(id)], false);
        this.save();
    },

    getFitPlanDays(planId) {
        return this.query("SELECT * FROM fit_plan_days WHERE plan_id = ? ORDER BY week_index ASC, weekday ASC, id ASC", [Number(planId)]);
    },

    getFitPlanDay(id) {
        const rows = this.query("SELECT * FROM fit_plan_days WHERE id = ? LIMIT 1", [Number(id)]);
        return rows.length ? rows[0] : null;
    },

    getFitPlanDayForDate(planId, weekIndex, weekday) {
        const rows = this.query(`SELECT * FROM fit_plan_days
            WHERE plan_id = ? AND weekday = ? AND week_index IN (?, 0)
            ORDER BY CASE WHEN week_index = ? THEN 0 ELSE 1 END, id DESC LIMIT 1`,
        [Number(planId), Number(weekday), Number(weekIndex), Number(weekIndex)]);
        return rows.length ? rows[0] : null;
    },

    saveFitPlanDay(data, autoSave = true) {
        const d = data || {};
        const planId = Number(d.plan_id);
        if (!planId || !d.weekday) return null;
        const weekIndex = Number(d.week_index) || 0;
        let id = Number(d.id) || null;
        if (!id) {
            const existing = this.query("SELECT id FROM fit_plan_days WHERE plan_id = ? AND week_index = ? AND weekday = ? LIMIT 1",
                [planId, weekIndex, Number(d.weekday)]);
            if (existing.length) id = existing[0].id;
        }
        const exercises = Array.isArray(d.exercises) ? JSON.stringify(d.exercises) : (d.exercises || '[]');
        if (id) {
            this.run(`UPDATE fit_plan_days SET week_index = ?, weekday = ?, title = ?, focus = ?, exercises = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [weekIndex, Number(d.weekday), d.title || '', d.focus || '', exercises, d.notes || '', id], false);
        } else {
            this.run(`INSERT INTO fit_plan_days (plan_id, week_index, weekday, title, focus, exercises, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [planId, weekIndex, Number(d.weekday), d.title || '', d.focus || '', exercises, d.notes || ''], false);
            id = this._lastInsertId('fit_plan_days');
        }
        if (autoSave) this.save();
        return id;
    },

    deleteFitPlanDay(id) {
        this.run("DELETE FROM fit_plan_days WHERE id = ?", [Number(id)]);
    },

    // --- Fit & Care: workouts, meals, protocols and health events ---

    getFitWorkouts(fromDate, toDate) {
        return this.query("SELECT * FROM fit_workouts WHERE log_date >= ? AND log_date <= ? ORDER BY log_date ASC, log_time ASC, id ASC", [fromDate, toDate]);
    },

    getFitWorkout(id) {
        const rows = this.query("SELECT * FROM fit_workouts WHERE id = ? LIMIT 1", [Number(id)]);
        return rows.length ? rows[0] : null;
    },

    saveFitWorkout(data, autoSave = true) {
        const d = data || {};
        if (!d.log_date) return null;
        const exercises = Array.isArray(d.exercises) ? JSON.stringify(d.exercises) : (d.exercises || '[]');
        let id = Number(d.id) || null;
        if (id) {
            this.run(`UPDATE fit_workouts SET log_date = ?, log_time = ?, plan_day_id = ?, title = ?, exercises = ?,
                duration_min = ?, volume_kg = ?, rpe = ?, status = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [d.log_date, d.log_time || '', d.plan_day_id ?? null, d.title || '', exercises,
                d.duration_min ?? null, d.volume_kg ?? null, d.rpe ?? null, d.status || 'done', d.note || '', id], false);
        } else {
            this.run(`INSERT INTO fit_workouts (log_date, log_time, plan_day_id, title, exercises, duration_min, volume_kg, rpe, status, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [d.log_date, d.log_time || '', d.plan_day_id ?? null, d.title || '', exercises,
                d.duration_min ?? null, d.volume_kg ?? null, d.rpe ?? null, d.status || 'done', d.note || ''], false);
            id = this._lastInsertId('fit_workouts');
        }
        if (autoSave) this.save();
        return id;
    },

    deleteFitWorkout(id) {
        this.run("DELETE FROM fit_workouts WHERE id = ?", [Number(id)]);
    },

    getFitMeals(fromDate, toDate) {
        return this.query("SELECT * FROM fit_meals WHERE log_date >= ? AND log_date <= ? ORDER BY log_date ASC, meal_time ASC, id ASC", [fromDate, toDate]);
    },

    saveFitMeal(data, autoSave = true) {
        const d = data || {};
        if (!d.log_date) return null;
        const tags = Array.isArray(d.tags) ? JSON.stringify(d.tags) : (d.tags || '[]');
        const estimated = Number(d.estimated) ? 1 : 0;
        let id = Number(d.id) || null;
        if (id) {
            this.run(`UPDATE fit_meals SET log_date = ?, meal_time = ?, title = ?, tags = ?, calories = ?, protein = ?, carbs = ?, fat = ?, note = ?, estimated = ? WHERE id = ?`,
                [d.log_date, d.meal_time || '', d.title || '', tags, d.calories ?? null, d.protein ?? null,
                    d.carbs ?? null, d.fat ?? null, d.note || '', estimated, id], false);
        } else {
            this.run(`INSERT INTO fit_meals (log_date, meal_time, title, tags, calories, protein, carbs, fat, note, estimated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [d.log_date, d.meal_time || '', d.title || '', tags, d.calories ?? null, d.protein ?? null,
                d.carbs ?? null, d.fat ?? null, d.note || '', estimated], false);
            id = this._lastInsertId('fit_meals');
        }
        if (autoSave) this.save();
        return id;
    },

    deleteFitMeal(id) {
        this.run("DELETE FROM fit_meals WHERE id = ?", [Number(id)]);
    },

    getFitProtocols(activeOnly = false) {
        return activeOnly
            ? this.query("SELECT * FROM fit_protocols WHERE active = 1 ORDER BY name COLLATE NOCASE ASC, id ASC")
            : this.query("SELECT * FROM fit_protocols ORDER BY active DESC, name COLLATE NOCASE ASC, id ASC");
    },

    getFitProtocol(id) {
        const rows = this.query("SELECT * FROM fit_protocols WHERE id = ? LIMIT 1", [Number(id)]);
        return rows.length ? rows[0] : null;
    },

    getFitProtocolByName(name) {
        const wanted = String(name || '').trim().toLowerCase();
        if (!wanted) return null;
        const rows = this.query("SELECT * FROM fit_protocols WHERE lower(name) = ? LIMIT 1", [wanted]);
        return rows.length ? rows[0] : null;
    },

    saveFitProtocol(data, autoSave = true) {
        const d = data || {};
        const schedule = Array.isArray(d.schedule) || (d.schedule && typeof d.schedule === 'object') ? JSON.stringify(d.schedule) : (d.schedule || '{"times":[],"days":[]}');
        const rules = Array.isArray(d.rules) || (d.rules && typeof d.rules === 'object') ? JSON.stringify(d.rules) : (d.rules || '{}');
        let id = Number(d.id) || null;
        if (id) {
            this.run(`UPDATE fit_protocols SET name = ?, kind = ?, dosage = ?, schedule = ?, rules = ?, notes = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [d.name || '', d.kind || 'medication', d.dosage || '', schedule, rules, d.notes || '', Number(d.active ?? 1) ? 1 : 0, id], false);
        } else {
            this.run(`INSERT INTO fit_protocols (name, kind, dosage, schedule, rules, notes, active)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [d.name || '', d.kind || 'medication', d.dosage || '', schedule, rules, d.notes || '', Number(d.active ?? 1) ? 1 : 0], false);
            id = this._lastInsertId('fit_protocols');
        }
        if (autoSave) this.save();
        return id;
    },

    deleteFitProtocol(id) {
        this.run("UPDATE fit_health_logs SET protocol_id = NULL WHERE protocol_id = ?", [Number(id)], false);
        this.run("DELETE FROM fit_protocols WHERE id = ?", [Number(id)], false);
        this.save();
    },

    getFitHealthLogs(fromDate, toDate) {
        return this.query("SELECT * FROM fit_health_logs WHERE log_date >= ? AND log_date <= ? ORDER BY log_date ASC, log_time ASC, id ASC", [fromDate, toDate]);
    },

    saveFitHealthLog(data, autoSave = true) {
        const d = data || {};
        if (!d.log_date) return null;
        let id = Number(d.id) || null;
        const tags = Array.isArray(d.tags) ? JSON.stringify(d.tags) : (d.tags || '[]');
        if (id) {
            this.run(`UPDATE fit_health_logs SET log_date = ?, log_time = ?, protocol_id = ?, type = ?, name = ?, value = ?, value2 = ?, unit = ?, status = ?, tags = ?, note = ? WHERE id = ?`,
                [d.log_date, d.log_time || '', d.protocol_id ?? null, d.type || 'measurement', d.name || '',
                    d.value ?? null, d.value2 ?? null, d.unit || '', d.status || 'logged', tags, d.note || '', id], false);
        } else {
            this.run(`INSERT INTO fit_health_logs (log_date, log_time, protocol_id, type, name, value, value2, unit, status, tags, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [d.log_date, d.log_time || '', d.protocol_id ?? null, d.type || 'measurement', d.name || '',
                d.value ?? null, d.value2 ?? null, d.unit || '', d.status || 'logged', tags, d.note || ''], false);
            id = this._lastInsertId('fit_health_logs');
        }
        if (autoSave) this.save();
        return id;
    },

    deleteFitHealthLog(id) {
        this.run("DELETE FROM fit_health_logs WHERE id = ?", [Number(id)]);
    },

    // --- Fit & Care: menstrual cycle and private logs ---

    getFitCycles() {
        return this.query("SELECT * FROM fit_cycles ORDER BY start_date ASC, id ASC");
    },

    getFitCycle(id) {
        const rows = this.query("SELECT * FROM fit_cycles WHERE id = ? LIMIT 1", [Number(id)]);
        return rows.length ? rows[0] : null;
    },

    saveFitCycle(data, autoSave = true) {
        const d = data || {};
        if (!d.start_date) return null;
        let id = Number(d.id) || null;
        if (id) {
            this.run("UPDATE fit_cycles SET start_date = ?, end_date = ?, cycle_length = ?, period_length = ?, notes = ? WHERE id = ?",
                [d.start_date, d.end_date || '', d.cycle_length ?? null, d.period_length ?? null, d.notes || '', id], false);
        } else {
            this.run("INSERT INTO fit_cycles (start_date, end_date, cycle_length, period_length, notes) VALUES (?, ?, ?, ?, ?)",
                [d.start_date, d.end_date || '', d.cycle_length ?? null, d.period_length ?? null, d.notes || ''], false);
            id = this._lastInsertId('fit_cycles');
        }
        if (autoSave) this.save();
        return id;
    },

    startFitCycle(date) {
        const key = date || this._fitDateKey(new Date());
        const same = this.query("SELECT id FROM fit_cycles WHERE start_date = ? LIMIT 1", [key]);
        if (same.length) return same[0].id;
        const previous = this.query("SELECT * FROM fit_cycles WHERE start_date < ? ORDER BY start_date DESC LIMIT 1", [key]);
        if (previous.length) {
            const length = this._fitDiffDays(previous[0].start_date, key);
            this.run("UPDATE fit_cycles SET end_date = ?, cycle_length = ? WHERE id = ?",
                [this._fitAddDays(key, -1), length > 0 ? length : null, previous[0].id], false);
        }
        const profile = this.getFitProfile();
        this.run("INSERT INTO fit_cycles (start_date, end_date, period_length) VALUES (?, '', ?)",
            [key, profile.period_length], false);
        const id = this._lastInsertId('fit_cycles');
        this.save();
        return id;
    },

    endFitCycle(date, cycleId = null) {
        const key = date || this._fitDateKey(new Date());
        let cycle = cycleId ? this.getFitCycle(cycleId) : null;
        if (!cycle) {
            const rows = this.query("SELECT * FROM fit_cycles WHERE start_date <= ? ORDER BY start_date DESC LIMIT 1", [key]);
            cycle = rows.length ? rows[0] : null;
        }
        if (!cycle) return null;
        const end = key < cycle.start_date ? cycle.start_date : key;
        const periodLength = this._fitDiffDays(cycle.start_date, end) + 1;
        this.run("UPDATE fit_cycles SET end_date = ?, period_length = ? WHERE id = ?",
            [end, periodLength, cycle.id]);
        this.save();
        return cycle.id;
    },

    deleteFitCycle(id) {
        this.run("DELETE FROM fit_cycles WHERE id = ?", [Number(id)]);
    },

    getFitCycleLogs(fromDate, toDate) {
        return this.query("SELECT * FROM fit_cycle_logs WHERE log_date >= ? AND log_date <= ? ORDER BY log_date ASC", [fromDate, toDate]);
    },

    getFitCycleLog(date) {
        const rows = this.query("SELECT * FROM fit_cycle_logs WHERE log_date = ? LIMIT 1", [date]);
        return rows.length ? rows[0] : null;
    },

    saveFitCycleLog(data, autoSave = true) {
        const d = data || {};
        if (!d.log_date) return null;
        this.run(`INSERT INTO fit_cycle_logs (log_date, flow, note) VALUES (?, ?, ?)
            ON CONFLICT(log_date) DO UPDATE SET flow = excluded.flow, note = excluded.note`,
        [d.log_date, d.flow || '', d.note || ''], false);
        if (autoSave) this.save();
    },

    deleteFitCycleLog(date) {
        this.run("DELETE FROM fit_cycle_logs WHERE log_date = ?", [date]);
    },

    getFitIntimacyLogs(fromDate, toDate) {
        return this.query("SELECT * FROM fit_intimacy_logs WHERE log_date >= ? AND log_date <= ? ORDER BY log_date ASC, log_time ASC, id ASC", [fromDate, toDate]);
    },

    saveFitIntimacyLog(data, autoSave = true) {
        const d = data || {};
        if (!d.log_date) return null;
        let id = Number(d.id) || null;
        if (id) {
            this.run("UPDATE fit_intimacy_logs SET log_date = ?, protection = ?, note = ?, log_time = ? WHERE id = ?",
                [d.log_date, d.protection || '', d.note || '', d.log_time || '', id], false);
        } else {
            this.run("INSERT INTO fit_intimacy_logs (log_date, protection, note, log_time) VALUES (?, ?, ?, ?)",
                [d.log_date, d.protection || '', d.note || '', d.log_time || ''], false);
            id = this._lastInsertId('fit_intimacy_logs');
        }
        if (autoSave) this.save();
        return id;
    },

    deleteFitIntimacyLog(id) {
        this.run("DELETE FROM fit_intimacy_logs WHERE id = ?", [Number(id)]);
    },

    getFitLatestWeight() {
        const rows = this.query("SELECT weight, log_date FROM fit_daily_logs WHERE weight IS NOT NULL ORDER BY log_date DESC, id DESC LIMIT 1");
        return rows.length ? rows[0] : null;
    },

    // --- Fit & Care: per-day Aru chat ---

    getFitChatMessages(date, limit = 40) {
        return this.query("SELECT * FROM fit_chat_messages WHERE log_date = ? ORDER BY id ASC LIMIT ?", [date, Number(limit) || 40]);
    },

    saveFitChatMessage(date, role, content) {
        this.run("INSERT INTO fit_chat_messages (log_date, role, content) VALUES (?, ?, ?)", [date, role || 'user', content || '']);
        return this._lastInsertId('fit_chat_messages');
    },

    clearFitChatMessages(date) {
        this.run("DELETE FROM fit_chat_messages WHERE log_date = ?", [date]);
    },

    // Local rule checker: compares a meal with medication doses logged on the same day.
    // Returns factual conflicts from the user's own protocol rules, never medical advice.
    getFitMealConflicts(meal) {
        const m = meal || {};
        if (!m.log_date) return [];
        const timeToMin = (value) => {
            const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
            return match ? (Number(match[1]) * 60 + Number(match[2])) : null;
        };
        const mealMin = timeToMin(m.meal_time);
        const tags = Array.isArray(m.tags) ? m.tags : (() => {
            try { return JSON.parse(m.tags || '[]'); } catch (e) { return String(m.tags || '').split(',').map(s => s.trim()).filter(Boolean); }
        })();
        const normalizedTags = tags.map(t => String(t).trim().toLowerCase()).filter(Boolean);
        const protocols = new Map(this.getFitProtocols().map(p => [Number(p.id), p]));
        const logs = this.query(`SELECT * FROM fit_health_logs
            WHERE log_date = ? AND protocol_id IS NOT NULL AND type = 'medication' AND status = 'taken'`,
        [m.log_date]);
        const conflicts = [];
        for (const log of logs) {
            const protocol = protocols.get(Number(log.protocol_id));
            if (!protocol || !Number(protocol.active)) continue;
            let rules = {};
            try { rules = JSON.parse(protocol.rules || '{}') || {}; } catch (e) { rules = {}; }
            const doseMin = timeToMin(log.log_time);
            if (mealMin !== null && doseMin !== null) {
                const gap = Math.abs(mealMin - doseMin);
                const delay = Number(rules.min_delay_min) || 0;
                if (delay > 0 && gap < delay) {
                    conflicts.push({
                        kind: 'delay',
                        protocol_id: Number(protocol.id),
                        protocol: protocol.name,
                        minutes: gap,
                        required: delay,
                        dose_time: log.log_time,
                        meal_time: m.meal_time,
                        note: rules.note || ''
                    });
                }
            }
            const avoid = Array.isArray(rules.avoid_tags) ? rules.avoid_tags.map(t => String(t).toLowerCase()) : [];
            const windowMin = Number(rules.tag_window_min) || 240;
            if (avoid.length && normalizedTags.length) {
                const hit = normalizedTags.find(tag => avoid.some(a => tag.includes(a) || a.includes(tag)));
                const withinWindow = mealMin === null || doseMin === null || Math.abs(mealMin - doseMin) <= windowMin;
                if (hit && withinWindow) {
                    conflicts.push({
                        kind: 'tag',
                        tag: hit,
                        protocol_id: Number(protocol.id),
                        protocol: protocol.name,
                        minutes: mealMin !== null && doseMin !== null ? Math.abs(mealMin - doseMin) : null,
                        dose_time: log.log_time,
                        meal_time: m.meal_time,
                        note: rules.note || ''
                    });
                }
            }
        }
        return conflicts;
    },

    getFitAllData() {
        return {
            app: 'aru-fit-care',
            version: 2,
            exported_at: new Date().toISOString(),
            profile: this.getFitProfile(),
            daily_logs: this.query("SELECT * FROM fit_daily_logs ORDER BY log_date ASC"),
            plans: this.query("SELECT * FROM fit_plans ORDER BY id ASC"),
            plan_days: this.query("SELECT * FROM fit_plan_days ORDER BY id ASC"),
            workouts: this.query("SELECT * FROM fit_workouts ORDER BY id ASC"),
            meals: this.query("SELECT * FROM fit_meals ORDER BY id ASC"),
            protocols: this.query("SELECT * FROM fit_protocols ORDER BY id ASC"),
            health_logs: this.query("SELECT * FROM fit_health_logs ORDER BY id ASC"),
            cycles: this.query("SELECT * FROM fit_cycles ORDER BY id ASC"),
            cycle_logs: this.query("SELECT * FROM fit_cycle_logs ORDER BY id ASC"),
            intimacy_logs: this.query("SELECT * FROM fit_intimacy_logs ORDER BY id ASC"),
            chat_messages: this.query("SELECT * FROM fit_chat_messages ORDER BY id ASC")
        };
    },

    clearFitData(autoSave = true) {
        const tables = ['fit_chat_messages', 'fit_intimacy_logs', 'fit_cycle_logs', 'fit_cycles',
            'fit_health_logs', 'fit_protocols', 'fit_meals', 'fit_workouts', 'fit_plan_days',
            'fit_plans', 'fit_daily_logs', 'fit_profiles'];
        for (const table of tables) this.run(`DELETE FROM ${table}`, [], false);
        if (autoSave) this.save();
    },

    replaceFitData(data, autoSave = true) {
        const d = data || {};
        this.clearFitData(false);
        this.saveFitProfile(d.profile || {}, false);
        const insert = (sql, params) => this.run(sql, params, false);
        for (const row of d.daily_logs || []) this.saveFitDailyLog(row, false);
        for (const row of d.plans || []) {
            insert(`INSERT OR REPLACE INTO fit_plans (id, title, goal, start_date, weeks, status, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.id ?? null, row.title || '', row.goal || '', row.start_date || '', row.weeks ?? 4,
                row.status || 'active', row.notes || '', row.created_at || null, row.updated_at || null]);
        }
        for (const row of d.plan_days || []) {
            insert(`INSERT OR REPLACE INTO fit_plan_days (id, plan_id, week_index, weekday, title, focus, exercises, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.id ?? null, row.plan_id ?? null, row.week_index ?? 0, row.weekday ?? 1, row.title || '',
                row.focus || '', row.exercises || '[]', row.notes || '', row.created_at || null, row.updated_at || null]);
        }
        for (const row of d.workouts || []) {
            insert(`INSERT OR REPLACE INTO fit_workouts (id, log_date, log_time, plan_day_id, title, exercises, duration_min, volume_kg, rpe, status, note, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.id ?? null, row.log_date, row.log_time || '', row.plan_day_id ?? null, row.title || '',
                row.exercises || '[]', row.duration_min ?? null, row.volume_kg ?? null, row.rpe ?? null,
                row.status || 'done', row.note || '', row.created_at || null, row.updated_at || null]);
        }
        for (const row of d.meals || []) {
            insert(`INSERT OR REPLACE INTO fit_meals (id, log_date, meal_time, title, tags, calories, protein, carbs, fat, note, estimated, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.id ?? null, row.log_date, row.meal_time || '', row.title || '', row.tags || '[]',
                row.calories ?? null, row.protein ?? null, row.carbs ?? null, row.fat ?? null,
                row.note || '', Number(row.estimated) ? 1 : 0, row.created_at || null]);
        }
        for (const row of d.protocols || []) {
            insert(`INSERT OR REPLACE INTO fit_protocols (id, name, kind, dosage, schedule, rules, notes, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.id ?? null, row.name || '', row.kind || 'medication', row.dosage || '',
                row.schedule || '{"times":[],"days":[]}', row.rules || '{}', row.notes || '',
                Number(row.active ?? 1) ? 1 : 0, row.created_at || null, row.updated_at || null]);
        }
        for (const row of d.health_logs || []) {
            insert(`INSERT OR REPLACE INTO fit_health_logs (id, log_date, log_time, protocol_id, type, name, value, value2, unit, status, tags, note, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.id ?? null, row.log_date, row.log_time || '', row.protocol_id ?? null, row.type || 'measurement',
                row.name || '', row.value ?? null, row.value2 ?? null, row.unit || '', row.status || 'logged',
                row.tags || '[]', row.note || '', row.created_at || null]);
        }
        for (const row of d.cycles || []) {
            insert(`INSERT OR REPLACE INTO fit_cycles (id, start_date, end_date, cycle_length, period_length, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [row.id ?? null, row.start_date, row.end_date || '', row.cycle_length ?? null,
                row.period_length ?? null, row.notes || '', row.created_at || null]);
        }
        for (const row of d.cycle_logs || []) {
            insert(`INSERT OR REPLACE INTO fit_cycle_logs (id, log_date, flow, note, created_at) VALUES (?, ?, ?, ?, ?)`,
                [row.id ?? null, row.log_date, row.flow || '', row.note || '', row.created_at || null]);
        }
        for (const row of d.intimacy_logs || []) {
            insert(`INSERT OR REPLACE INTO fit_intimacy_logs (id, log_date, protection, note, log_time, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
                [row.id ?? null, row.log_date, row.protection || '', row.note || '', row.log_time || '', row.created_at || null]);
        }
        for (const row of d.chat_messages || []) {
            insert(`INSERT OR REPLACE INTO fit_chat_messages (id, log_date, role, content, created_at) VALUES (?, ?, ?, ?, ?)`,
                [row.id ?? null, row.log_date, row.role || 'user', row.content || '', row.created_at || null]);
        }
        if (autoSave) this.save();
    },

    // Compact, privacy-conscious snapshot used by the main chat system prompt.
    // Intimate logs and free-form notes are deliberately excluded here.
    getFitAruSnapshot(detailed = false) {
        try {
            const p = this.getFitProfile();
            const today = this._fitDateKey(new Date());
            const from = this._fitAddDays(today, detailed ? -13 : -6);
            const logs = this.getFitDailyLogs(from, today);
            const workouts = this.getFitWorkouts(from, today);
            const meals = this.getFitMeals(today, today);
            const plans = this.getFitPlans('active');
            const protocols = this.getFitProtocols(true);
            const cycles = this.getFitCycles();
            const hasData = p.display_name || p.target_weight != null || p.goal !== 'maintain' || logs.length || workouts.length || plans.length || protocols.length || cycles.length;
            if (!hasData) return '';

            const lines = [];
            const goalLabels = { lose: 'lose weight', maintain: 'maintain weight', gain: 'gain weight', health: 'general health', performance: 'performance' };
            const profileBits = [];
            if (p.goal) profileBits.push(`goal: ${goalLabels[p.goal] || p.goal}`);
            if (p.target_weight != null) profileBits.push(`target weight: ${p.target_weight} kg${p.target_date ? ` by ${p.target_date}` : ''}`);
            if (p.height_cm) profileBits.push(`height: ${p.height_cm} cm`);
            if (p.sex) profileBits.push(`sex: ${p.sex}`);
            if (p.birth_year) profileBits.push(`born ${p.birth_year}`);
            if (p.activity_level) profileBits.push(`activity: ${p.activity_level}`);
            const toneLabels = { supportive: 'supportive', neutral: 'neutral and factual', coach: 'concise coaching' };
            if (p.aru_tone && p.aru_tone !== 'supportive') profileBits.push(`preferred Aru tone: ${toneLabels[p.aru_tone] || p.aru_tone}`);
            if (p.calorie_min != null || p.calorie_max != null) {
                profileBits.push(`calorie corridor: ${p.calorie_min != null ? p.calorie_min : '—'}–${p.calorie_max != null ? p.calorie_max : '—'} kcal`);
            }
            if (profileBits.length) lines.push(`Profile: ${profileBits.join(', ')}.`);

            const span = detailed ? 14 : 7;
            const avgOf = (rows, field) => {
                const values = rows
                    .map(r => r[field])
                    .filter(v => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v)))
                    .map(Number);
                return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
            };

            const weighted = logs.filter(l => l.weight != null);
            if (weighted.length) {
                const first = weighted[0];
                const last = weighted[weighted.length - 1];
                const delta = Number(last.weight) - Number(first.weight);
                lines.push(`Weight (last ${span} days): latest ${last.weight} kg on ${last.log_date}, ${weighted.length} entries, change ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} kg.`);
            }

            const doneWorkouts = workouts.filter(w => w.status === 'done');
            if (workouts.length) {
                const minutes = doneWorkouts.reduce((s, w) => s + (Number(w.duration_min) || 0), 0);
                const volume = doneWorkouts.reduce((s, w) => s + (Number(w.volume_kg) || 0), 0);
                const rpeAvg = avgOf(doneWorkouts, 'rpe');
                const bits = [
                    `${doneWorkouts.length} done`,
                    `${workouts.filter(w => w.status === 'planned').length} planned`,
                    `${workouts.filter(w => w.status === 'skipped').length} skipped`
                ];
                if (minutes) bits.push(`${minutes} min total`);
                if (volume) bits.push(`volume ${Math.round(volume)} kg`);
                if (rpeAvg != null) bits.push(`avg RPE ${rpeAvg.toFixed(1)}`);
                lines.push(`Training (last ${span} days): ${bits.join(', ')}.`);
                if (detailed && doneWorkouts.length) {
                    lines.push(`Recent sessions: ${doneWorkouts.slice(-6).map(w => `${w.log_date} "${w.title}"${w.duration_min ? ` ${w.duration_min}min` : ''}${w.rpe ? ` RPE${w.rpe}` : ''}`).join('; ')}.`);
                }
            }

            const nutritionBits = [];
            const calorieAvg = avgOf(logs, 'calories');
            if (calorieAvg != null) nutritionBits.push(`avg ${Math.round(calorieAvg)} kcal`);
            const proteinAvg = avgOf(logs, 'protein');
            if (proteinAvg != null) nutritionBits.push(`protein ${Math.round(proteinAvg)} g`);
            const waterAvg = avgOf(logs, 'water_ml');
            if (waterAvg != null) nutritionBits.push(`water ${Math.round(waterAvg)} ml`);
            const todayKcal = meals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
            if (meals.length) nutritionBits.push(`today ${meals.length} meal(s)${todayKcal ? ` ~${Math.round(todayKcal)} kcal` : ''}`);
            if (nutritionBits.length) lines.push(`Nutrition (last ${span} days): ${nutritionBits.join(', ')}.`);

            const recoveryBits = [];
            const sleepAvg = avgOf(logs, 'sleep_hours');
            if (sleepAvg != null) recoveryBits.push(`sleep ${sleepAvg.toFixed(1)} h`);
            const energyAvg = avgOf(logs, 'energy');
            if (energyAvg != null) recoveryBits.push(`energy ${energyAvg.toFixed(1)}/5`);
            const moodAvg = avgOf(logs, 'mood');
            if (moodAvg != null) recoveryBits.push(`mood ${moodAvg.toFixed(1)}/5`);
            const stressAvg = avgOf(logs, 'stress');
            if (stressAvg != null) recoveryBits.push(`stress ${stressAvg.toFixed(1)}/5`);
            const symptomCounts = new Map();
            for (const log of logs) {
                let list = [];
                try { list = JSON.parse(log.symptoms || '[]') || []; } catch (e) { list = []; }
                if (Array.isArray(list)) for (const item of list) symptomCounts.set(item, (symptomCounts.get(item) || 0) + 1);
            }
            if (symptomCounts.size) {
                recoveryBits.push(`symptoms: ${[...symptomCounts.entries()].slice(0, 5).map(([name, count]) => `${name} ×${count}`).join(', ')}`);
            }
            if (recoveryBits.length) lines.push(`Recovery (last ${span} days): ${recoveryBits.join(', ')}.`);

            if (plans.length) {
                const plan = plans[0];
                let planLine = `Active plan: "${plan.title}" (${plan.weeks} weeks, started ${plan.start_date})`;
                if (plan.start_date) {
                    const diff = this._fitDiffDays(plan.start_date, today);
                    if (diff >= 0 && diff < Number(plan.weeks) * 7) {
                        const week = Math.floor(diff / 7) + 1;
                        const weekday = ((this._fitDateFromKey(today).getDay() + 6) % 7) + 1;
                        const day = this.getFitPlanDayForDate(plan.id, week, weekday);
                        planLine += `, week ${week}/${plan.weeks}`;
                        if (day) planLine += `, today: "${day.title || day.focus || 'session'}"`;
                    }
                }
                lines.push(planLine + '.');
            }

            const todayLog = logs.find(l => l.log_date === today);
            const todayBits = [];
            if (todayLog) {
                if (todayLog.weight != null) todayBits.push(`weight ${todayLog.weight} kg`);
                if (todayLog.workout_status) todayBits.push(`workout ${todayLog.workout_status}`);
                if (todayLog.sleep_hours != null) todayBits.push(`sleep ${todayLog.sleep_hours} h`);
                if (todayLog.energy != null) todayBits.push(`energy ${todayLog.energy}/5`);
                if (detailed && todayLog.mood != null) todayBits.push(`mood ${todayLog.mood}/5`);
                if (detailed && todayLog.stress != null) todayBits.push(`stress ${todayLog.stress}/5`);
            }
            if (detailed && meals.length) todayBits.push(`meals: ${meals.map(m => m.title).filter(Boolean).slice(0, 6).join('; ')}`);
            if (todayBits.length) lines.push(`Today: ${todayBits.join('; ')}.`);

            const scheduled = [];
            const todayHealth = this.query("SELECT * FROM fit_health_logs WHERE log_date = ? AND type = 'medication'", [today]);
            const weekday = ((this._fitDateFromKey(today).getDay() + 6) % 7) + 1;
            for (const protocol of protocols) {
                let sched = {};
                try { sched = JSON.parse(protocol.schedule || '{}') || {}; } catch (e) {}
                const days = Array.isArray(sched.days) ? sched.days : [];
                if (days.length && !days.includes(weekday)) continue;
                const times = Array.isArray(sched.times) ? sched.times : [];
                const taken = todayHealth.filter(l => Number(l.protocol_id) === Number(protocol.id) && l.status === 'taken').length;
                scheduled.push(`${protocol.name || 'medication'}${protocol.dosage ? ' ' + protocol.dosage : ''}${times.length ? ' at ' + times.join('/') : ''}${taken ? ` (taken ${taken})` : ' (not taken yet)'}`);
            }
            if (scheduled.length) lines.push(`Medications today: ${scheduled.join('; ')}.`);

            if (Number(p.cycle_tracking) && cycles.length) {
                const last = cycles.filter(c => c.start_date <= today).pop();
                if (last) {
                    const len = Number(p.cycle_length) || 28;
                    const since = this._fitDiffDays(last.start_date, today);
                    const bits = [`last period started ${last.start_date}`, `typical cycle ${len} days`];
                    if (since >= 0) {
                        bits.push(`current cycle day ${(since % len) + 1}`);
                        bits.push(`next period expected around ${this._fitAddDays(last.start_date, (Math.floor(since / len) + 1) * len)} (estimate, not contraception)`);
                    }
                    lines.push(`Cycle tracking: ${bits.join(', ')}.`);
                }
            }
            if (p.aru_notes) lines.push(`User's instructions for Aru in Fit & Care: ${String(p.aru_notes).slice(0, 1200)}`);
            return lines.join('\n');
        } catch (e) {
            console.warn('DB.getFitAruSnapshot failed', e);
            return '';
        }
    },

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
            this.run("INSERT INTO skill_run_steps (run_id, step_id, step_order, skill_id, skill_title, provider, model, input_text, output_text, status, error, tokens_est, truncated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
            this.migrateSchema(); // Forward migration for databases created by older app versions
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
        this.migrateSchema(); // Forward migration for databases created by older app versions
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

                    this.migrateSchema(); // Forward migration for databases created by older app versions
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
                    for (const m of data.messages) tempDb.run("INSERT INTO messages (id, chat_id, role, content, emotion, is_html, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [m.id, m.chat_id, m.role || 'user', m.content || '', m.emotion !== undefined ? m.emotion : null, m.is_html || 0, m.attachments || null, m.created_at || null]);
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
                    for (const p of data.personality) tempDb.run("INSERT INTO personality_state (key, mood, sarcasm, humor, affinity, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [p.key, p.mood || 50, p.sarcasm || 0, p.humor || 50, p.affinity || 0, p.updated_at || null]);
                    for (const m of data.memory) tempDb.run("INSERT INTO memory_facts (id, content, category, embedding, created_at) VALUES (?, ?, ?, ?, ?)", [m.id, m.content || '', m.category || '', m.embedding || '', m.created_at || null]);
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
                    this.run("DELETE FROM messages", [], false); this.run("DELETE FROM chat_chapters", [], false); this.run("DELETE FROM chat_sections", [], false); this.run("DELETE FROM chats"); 
                    for (const chat of data.chats) this.run("INSERT INTO chats (id, title, sort_order, created_at, updated_at, folder_id, is_favorite) VALUES (?, ?, ?, ?, ?, ?, ?)", [chat.id, chat.title || 'Chat', chat.sort_order || 0, chat.created_at || null, chat.updated_at || null, chat.folder_id !== undefined ? chat.folder_id : null, chat.is_favorite || 0], false);
                    for (const m of data.messages) this.run("INSERT INTO messages (id, chat_id, role, content, emotion, is_html, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [m.id, m.chat_id, m.role || 'user', m.content || '', m.emotion !== undefined ? m.emotion : null, m.is_html || 0, m.created_at || null], false);
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
                        this.run("DELETE FROM chat_artifacts", [], false);
                        for (const a of data.chat_artifacts) this.run("INSERT INTO chat_artifacts (id, chat_id, title, type, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [a.id, a.chat_id, a.title || '', a.type || '', a.code || '', a.created_at || null, a.updated_at || null], false);
                    }
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
                if (data.skills) {
                    this.run("DELETE FROM skill_run_steps", [], false);
                    this.run("DELETE FROM skill_runs", [], false);
                    this.run("DELETE FROM skill_pipeline_steps", [], false);
                    this.run("DELETE FROM skill_project_items", [], false);
                    if (this.tableExists('skill_artifacts')) this.run("DELETE FROM skill_artifacts", [], false);
                    if (this.tableExists('skill_project_messages')) this.run("DELETE FROM skill_project_messages", [], false);
                    this.run("DELETE FROM skill_projects", [], false);
                    this.run("DELETE FROM skills");
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

                        const messages = data.messages.filter(m => String(m.chat_id) === String(oldId));
                        for (const m of messages) {
                            this.run("INSERT INTO messages (chat_id, role, content, emotion, is_html, created_at) VALUES (?, ?, ?, ?, ?, ?)", [newId, m.role || 'user', m.content || '', m.emotion !== undefined ? m.emotion : null, m.is_html || 0, m.created_at || null], false);
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
                            this.run("INSERT INTO chat_chapters (chat_id, section_id, title, anchor_message_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)", [newId, mappedSection, c.title || '', c.anchor_message_id !== undefined ? c.anchor_message_id : null, c.sort_order || 0, c.created_at || null], false);
                        }
                        const artifacts = (data.chat_artifacts || []).filter(a => String(a.chat_id) === String(oldId));
                        for (const a of artifacts) {
                            this.run("INSERT INTO chat_artifacts (chat_id, title, type, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [newId, a.title || '', a.type || '', a.code || '', a.created_at || null, a.updated_at || null], false);
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
                if (data.skills) {
                    this._mergeSkillData(data);
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
