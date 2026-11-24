/*
---ARU-LAB.SPACE---ALMATY---2026---
SQLite base schema creation and additive forward migrations extracted from db.js.
---chat.aru-lab.space---PWA---
*/
import { ensureSyncSchema } from './sync/syncSchema.js';

export const DBSchemaMethods = {
    initSchema() {
        // Core Tables
        this.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`, [], false);
        this.run(`CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`, [], false);
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
        )`, [], false);
        this.run(`CREATE TABLE IF NOT EXISTS memory_facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            content TEXT, 
            category TEXT, 
            embedding TEXT, 
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, [], false);
        this.run(`CREATE TABLE IF NOT EXISTS modules_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT,
            name TEXT,
            content TEXT,
            tags TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, [], false);

        this.run(`CREATE TABLE IF NOT EXISTS chat_artifacts (
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

        // Per-artifact sandbox key-value state (scoped by chat/module/skill)
        this.run(`CREATE TABLE IF NOT EXISTS artifact_storage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scope_key TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(scope_key, key)
        )`, [], false);
        this.run(`CREATE INDEX IF NOT EXISTS idx_artifact_storage_scope ON artifact_storage(scope_key)`, [], false);

        // Personality state: persistent mood/sarcasm/humor
        this.run(`CREATE TABLE IF NOT EXISTS personality_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE,
            mood INTEGER DEFAULT 50,
            sarcasm INTEGER DEFAULT 0,
            humor INTEGER DEFAULT 50,
            affinity INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, [], false);

        // Executes incremental database structure migrations tracking operational schema rules

        // Verifies base setting configurations exist dynamically
        const hasRules = this.query("SELECT key FROM settings WHERE key = 'rules'");
        if (hasRules.length === 0) {
            this.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", ['rules', '0'], false);
        }

        // Resolves structural dependencies implicitly missing from earlier implementations
        try {
            this.run(`ALTER TABLE messages ADD COLUMN is_html INTEGER DEFAULT 0`, [], false);
        } catch (e) {
            // Suppresses conflicts for pre-existing modifications
        }

        try {
            this.run(`ALTER TABLE chats ADD COLUMN sort_order INTEGER DEFAULT 0`, [], false);
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
                    temperature REAL DEFAULT 0.5,
                    input_limit INTEGER DEFAULT 32768,
                    max_output INTEGER DEFAULT 8192,
                    role TEXT DEFAULT 'worker',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                changed = true;
            }
            if (this.tableExists('skills') && !this.hasColumn('skills', 'role')) {
                this.run("ALTER TABLE skills ADD COLUMN role TEXT DEFAULT 'worker'", [], false);
                changed = true;
            }
            if (!this.tableExists('skill_projects')) {
                this.run(`CREATE TABLE skill_projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT,
                    context_limit INTEGER DEFAULT 65536,
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
                    role TEXT DEFAULT '',
                    parallel_with_prev INTEGER DEFAULT 0,
                    pause_after INTEGER DEFAULT 0,
                    max_revisions INTEGER DEFAULT 0,
                    input_mode TEXT DEFAULT 'auto',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_skill_steps_project ON skill_pipeline_steps(project_id)`, [], false);
                changed = true;
            }
            const pipelineStepV2Cols = [
                ['role', "TEXT DEFAULT ''"],
                ['parallel_with_prev', 'INTEGER DEFAULT 0'],
                ['pause_after', 'INTEGER DEFAULT 0'],
                ['max_revisions', 'INTEGER DEFAULT 0'],
                ['input_mode', "TEXT DEFAULT 'auto'"]
            ];
            if (this.tableExists('skill_pipeline_steps')) {
                for (const [col, def] of pipelineStepV2Cols) {
                    if (!this.hasColumn('skill_pipeline_steps', col)) {
                        this.run(`ALTER TABLE skill_pipeline_steps ADD COLUMN ${col} ${def}`, [], false);
                        changed = true;
                    }
                }
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
                    truncated INTEGER DEFAULT 0,
                    stage_index INTEGER DEFAULT 0,
                    role TEXT DEFAULT 'worker',
                    iteration INTEGER DEFAULT 1,
                    duration_ms INTEGER DEFAULT 0,
                    verdict TEXT DEFAULT '',
                    edited_by_user INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_skill_run_steps_run ON skill_run_steps(run_id)`, [], false);
                changed = true;
            }
            // Relay steps record whether the model hit its output cap and Studio v2 telemetry/HITL state
            const runStepV2Cols = [
                ['truncated', 'INTEGER DEFAULT 0'],
                ['stage_index', 'INTEGER DEFAULT 0'],
                ['role', "TEXT DEFAULT 'worker'"],
                ['iteration', 'INTEGER DEFAULT 1'],
                ['duration_ms', 'INTEGER DEFAULT 0'],
                ['verdict', "TEXT DEFAULT ''"],
                ['edited_by_user', 'INTEGER DEFAULT 0']
            ];
            if (this.tableExists('skill_run_steps')) {
                for (const [col, def] of runStepV2Cols) {
                    if (!this.hasColumn('skill_run_steps', col)) {
                        this.run(`ALTER TABLE skill_run_steps ADD COLUMN ${col} ${def}`, [], false);
                        changed = true;
                    }
                }
            }
            if (!this.tableExists('skill_artifacts')) {
                this.run(`CREATE TABLE skill_artifacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER,
                    run_id INTEGER,
                    title TEXT,
                    type TEXT DEFAULT 'doc',
                    code TEXT,
                    version INTEGER DEFAULT 1,
                    step_title TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(project_id, title)
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_skill_artifacts_project ON skill_artifacts(project_id)`, [], false);
                changed = true;
            }
            const artifactV2Cols = [
                ['version', 'INTEGER DEFAULT 1'],
                ['step_title', "TEXT DEFAULT ''"]
            ];
            if (this.tableExists('skill_artifacts')) {
                for (const [col, def] of artifactV2Cols) {
                    if (!this.hasColumn('skill_artifacts', col)) {
                        this.run(`ALTER TABLE skill_artifacts ADD COLUMN ${col} ${def}`, [], false);
                        changed = true;
                    }
                }
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
                ['intimacy_tracking', 'INTEGER DEFAULT 0'],
                ['protein_target', 'INTEGER'],
                ['carbs_target', 'INTEGER'],
                ['fat_target', 'INTEGER'],
                ['water_target_ml', 'INTEGER']
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
            if (this.tableExists('fit_cycles')) {
                // Older builds closed the previous cycle by writing the day before
                // the next start into end_date. Today end_date means "bleeding
                // stopped", so that pattern would read as a month-long period.
                this.run(`UPDATE fit_cycles SET end_date = '' WHERE end_date != '' AND EXISTS (
                    SELECT 1 FROM fit_cycles AS next
                    WHERE date(next.start_date) = date(fit_cycles.end_date, '+1 day')
                )`, [], false);
                if (this.db.getRowsModified && this.db.getRowsModified() > 0) changed = true;
                // Clean up multi-month gap lengths stored as huge single-cycle lengths.
                this.run(`UPDATE fit_cycles SET cycle_length = NULL WHERE cycle_length IS NOT NULL AND (cycle_length < 15 OR cycle_length > 60)`, [], false);
                if (this.db.getRowsModified && this.db.getRowsModified() > 0) changed = true;
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
                    meta TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_fit_chat_date ON fit_chat_messages(log_date)`, [], false);
                changed = true;
            }
            if (this.tableExists('fit_chat_messages') && !this.hasColumn('fit_chat_messages', 'meta')) {
                this.run("ALTER TABLE fit_chat_messages ADD COLUMN meta TEXT DEFAULT ''", [], false);
                changed = true;
            }
            if (!this.tableExists('desktop_notes')) {
                this.run(`CREATE TABLE desktop_notes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )`, [], false);
                changed = true;
            }
            if (!this.tableExists('artifact_storage')) {
                this.run(`CREATE TABLE artifact_storage (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    scope_key TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(scope_key, key)
                )`, [], false);
                this.run(`CREATE INDEX IF NOT EXISTS idx_artifact_storage_scope ON artifact_storage(scope_key)`, [], false);
                changed = true;
            } else {
                this.run(`CREATE INDEX IF NOT EXISTS idx_artifact_storage_scope ON artifact_storage(scope_key)`, [], false);
            }
            // Cloud merge identity: uid/rev columns and write-capture triggers.
            // Purely additive, so databases from older app versions keep working.
            try {
                if (ensureSyncSchema(this.db)) changed = true;
                this._syncReady = true;
            } catch (syncErr) {
                console.warn('DB: sync schema setup failed', syncErr);
            }
            if (changed) console.log('DB: schema migrated (folders/favorites/chapters/skills/fit-care ready)');
        } catch (e) {
            console.warn('DB.migrateSchema failed', e);
        }
        return changed;
    }
};
