/*
---ARU-LAB.SPACE---ALMATY---2026---
Task Manager Plugin v2 — Trello-style Kanban & List workspace, filters, priorities,
tags, subtasks, inline quick-add, export/import, and Aru AI planning helpers.
---chat.aru-lab.space---PWA---
*/

window.TaskPlugin = {
    DONE_COL_RX: /готов|done|выполнен(?:о|ы|а|ные|ный|ная)|заверш|сделан|дайын|аяқтал|complete|finish/i,
    PROJECT_COLORS: ['violet', 'blue', 'emerald', 'amber', 'rose', 'slate'],
    PRIORITIES: ['none', 'low', 'medium', 'high', 'urgent'],

    state: {
        projects: [],
        activeProjectId: null,
        isSidebarOpen: true
    },
    ui: {
        viewMode: 'board', // 'board' | 'list'
        search: '',
        filter: 'all', // 'all' | 'today' | 'overdue' | 'high'
        hideDone: false,
        tagFilter: '',
        inlineAddColId: null,
        aiBusy: false
    },
    _modalDraft: null,
    sortables: [], // Runtime only, not in state
    // This script runs before js/app.js (and therefore before DB.init()), so
    // persistence must wait until the real database has been read at least once.
    _dbReady: false,
    _domMounted: false,
    _globalListenersBound: false,

    _rootEl() {
        const all = document.querySelectorAll ? document.querySelectorAll('#task-plugin-root') : [];
        for (const el of all) {
            if (!el.closest || !el.closest('.wd-chat-snapshot')) return el;
        }
        return null;
    },

    _byId(id) {
        const root = this._rootEl();
        if (!root) return null;
        const safe = String(id).replace(/"/g, '');
        return root.querySelector(`[id="${safe}"]`);
    },

    _q(selector) {
        const root = this._rootEl();
        return root ? root.querySelector(selector) : null;
    },

    bindGlobalListeners() {
        if (this._globalListenersBound) return;
        this._globalListenersBound = true;
        window.addEventListener('aru-db-initialized', () => {
            if (!(window.DB && window.DB.db)) return;
            this._dbReady = true;
            this.loadFromDB();
            if (this._domMounted && this._rootEl()) {
                this.selectProject(this.state.activeProjectId);
                this._refreshIcons();
            }
        });
        window.addEventListener('aru-sync-applied', () => {
            if (!(window.DB && window.DB.db)) return;
            this.loadFromDB();
            if (this._domMounted && this._rootEl()) {
                this.selectProject(this.state.activeProjectId);
                this._refreshIcons();
            }
        });
        window.addEventListener('aru-lang-changed', () => {
            if (this._domMounted && this._rootEl()) {
                this.applyI18n();
                this.syncHeader();
                this.renderProjects();
                this.renderToolbar();
                this.renderBoard();
                this._refreshIcons();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (document.querySelector('#aru-dialog-host .aru-dialog-root')) return;
            const modal = this._byId('task-detail-modal');
            if (modal && !modal.classList.contains('hidden')) {
                e.stopPropagation();
                this.closeTaskModal();
            }
        });
        // Delegated actions for interactive [[TOOL:tasks]] cards inside main chat
        document.addEventListener('click', (e) => {
            const btn = e.target && e.target.closest ? e.target.closest('[data-task-card-action]') : null;
            if (!btn) return;
            const card = btn.closest ? btn.closest('[data-tasks-card]') : null;
            if (!card) return;
            e.preventDefault();
            const act = btn.dataset.taskCardAction;
            const projId = btn.dataset.projectId || '';
            const colId = btn.dataset.colId || '';
            const taskId = btn.dataset.taskId || '';
            if (act === 'open-board') {
                if (projId && this.state.projects.some(p => String(p.id) === String(projId))) {
                    this.state.activeProjectId = projId;
                }
                if (window.app && typeof window.app.launchPlugin === 'function') {
                    window.app.launchPlugin('task');
                }
            } else if (act === 'toggle-done' && colId && taskId) {
                const nowDone = this.toggleTaskDone(colId, taskId, projId || null);
                if (nowDone !== null) {
                    const row = btn.closest('[data-task-row]');
                    btn.classList.toggle('is-checked', !!nowDone);
                    if (row) row.classList.toggle('is-done', !!nowDone);
                }
            }
        });
    },

    bindDomListeners(root) {
        if (!root || root._taskDomBound) return;
        root._taskDomBound = true;

        root.addEventListener('click', (e) => {
            const modal = this._byId('task-detail-modal');
            if (modal && e.target === modal) {
                this.closeTaskModal();
                return;
            }
            const actionEl = e.target.closest('[data-task-action]');
            if (!actionEl || !root.contains(actionEl)) return;
            const action = actionEl.dataset.taskAction;
            const projectId = actionEl.dataset.projectId || '';
            const colId = actionEl.dataset.colId || '';
            const taskId = actionEl.dataset.taskId || '';

            switch (action) {
                case 'add-project':
                    this.addProject();
                    break;
                case 'open-backup':
                    this.openBackupModal();
                    break;
                case 'export-md':
                    this.exportMarkdown();
                    break;
                case 'export-json':
                    this.exportJson();
                    break;
                case 'trigger-import': {
                    const inp = this._byId('task-import-file');
                    if (inp) inp.click();
                    break;
                }
                case 'select-project':
                    this.selectProject(projectId);
                    if (window.innerWidth <= 768 && this.state.isSidebarOpen) {
                        this.state.isSidebarOpen = false;
                        this.syncSidebarDOM();
                    }
                    break;
                case 'cycle-color':
                    e.stopPropagation();
                    this.cycleProjectColor(projectId || this.state.activeProjectId);
                    break;
                case 'rename-project':
                    e.stopPropagation();
                    this.renameProject(projectId);
                    break;
                case 'delete-project':
                    e.stopPropagation();
                    this.deleteProject(projectId);
                    break;
                case 'set-view':
                    this.setViewMode(actionEl.dataset.view || 'board');
                    break;
                case 'ai-plan':
                    this.openAiPlannerModal();
                    break;
                case 'set-filter':
                    this.ui.filter = actionEl.dataset.filter || 'all';
                    this.renderToolbar();
                    this.renderBoard();
                    break;
                case 'toggle-hide-done':
                    this.ui.hideDone = !this.ui.hideDone;
                    this.renderToolbar();
                    this.renderBoard();
                    break;
                case 'toggle-tag-filter': {
                    const tag = actionEl.dataset.tag || '';
                    this.ui.tagFilter = this.ui.tagFilter === tag ? '' : tag;
                    this.renderToolbar();
                    this.renderBoard();
                    break;
                }
                case 'clear-search':
                    this.ui.search = '';
                    this.renderToolbar();
                    this.renderBoard();
                    break;
                case 'clear-filters':
                    this.ui.search = '';
                    this.ui.filter = 'all';
                    this.ui.hideDone = false;
                    this.ui.tagFilter = '';
                    this.renderToolbar();
                    this.renderBoard();
                    break;
                case 'scroll-board':
                    this.scrollBoard(Number(actionEl.dataset.dir) || 1);
                    break;
                case 'rename-column':
                    e.stopPropagation();
                    this.renameColumn(colId);
                    break;
                case 'delete-column':
                    e.stopPropagation();
                    this.deleteColumn(colId);
                    break;
                case 'clear-done-col':
                    e.stopPropagation();
                    this.clearDoneColumn(colId);
                    break;
                case 'add-column':
                    e.stopPropagation();
                    this.addColumn();
                    break;
                case 'add-task':
                    e.stopPropagation();
                    this.startInlineAdd(colId);
                    break;
                case 'inline-save':
                    e.stopPropagation();
                    this.submitInlineAdd(colId);
                    break;
                case 'inline-details': {
                    e.stopPropagation();
                    const inp = this._q('[data-inline-input]');
                    const draftTitle = inp ? inp.value.trim() : '';
                    this.ui.inlineAddColId = null;
                    this.openTaskModal(colId, null, { title: draftTitle });
                    break;
                }
                case 'inline-cancel':
                    e.stopPropagation();
                    this.ui.inlineAddColId = null;
                    this.renderBoard();
                    break;
                case 'toggle-done':
                    e.stopPropagation();
                    this.toggleTaskDone(colId, taskId);
                    break;
                case 'open-task':
                    this.openTaskModal(colId, taskId || null);
                    break;
                case 'modal-toggle-done':
                    if (this._modalDraft) {
                        this._modalDraft.done = !this._modalDraft.done;
                        this._syncModalHeaderToggle();
                    }
                    break;
                case 'modal-set-prio':
                    if (this._modalDraft) {
                        this._modalDraft.priority = actionEl.dataset.prio || 'none';
                        this._renderModalPrio();
                    }
                    break;
                case 'modal-deadline-preset': {
                    const dlInput = this._byId('task-edit-deadline');
                    if (dlInput) dlInput.value = this._presetDeadlineValue(actionEl.dataset.preset);
                    break;
                }
                case 'modal-add-tag':
                    this._commitModalTagInput();
                    break;
                case 'modal-remove-tag':
                    if (this._modalDraft) {
                        const idx = Number(actionEl.dataset.idx);
                        if (Number.isInteger(idx)) this._modalDraft.tags.splice(idx, 1);
                        this._renderModalTags();
                    }
                    break;
                case 'modal-add-subtask':
                    this._commitModalSubtaskInput();
                    break;
                case 'modal-toggle-subtask':
                    if (this._modalDraft) {
                        const idx = Number(actionEl.dataset.idx);
                        const item = this._modalDraft.subtasks[idx];
                        if (item) item.done = !item.done;
                        this._renderModalSubtasks();
                    }
                    break;
                case 'modal-remove-subtask':
                    if (this._modalDraft) {
                        const idx = Number(actionEl.dataset.idx);
                        if (Number.isInteger(idx)) this._modalDraft.subtasks.splice(idx, 1);
                        this._renderModalSubtasks();
                    }
                    break;
                case 'modal-ai-breakdown':
                    this.aiBreakDownTask();
                    break;
                case 'duplicate-task':
                    this.duplicateTask(colId, taskId);
                    break;
                case 'save-task':
                    this.saveTask(colId, taskId || null);
                    break;
                case 'delete-task':
                    this.deleteTask(colId, taskId);
                    break;
                case 'close-modal':
                    this.closeTaskModal();
                    break;
            }
        });

        root.addEventListener('input', (e) => {
            if (e.target && e.target.id === 'task-search-input') {
                this.ui.search = e.target.value || '';
                const clearBtn = this._byId('btn-task-search-clear');
                if (clearBtn) clearBtn.classList.toggle('hidden', !this.ui.search);
                this.renderBoard();
            }
        });

        root.addEventListener('change', (e) => {
            const sel = e.target && e.target.closest ? e.target.closest('[data-task-move-col]') : null;
            if (sel && root.contains(sel)) {
                const taskId = sel.dataset.taskId;
                const fromColId = sel.dataset.fromColId;
                const toColId = sel.value;
                if (taskId && fromColId && toColId && fromColId !== toColId) {
                    this.moveTaskToColumn(fromColId, taskId, toColId);
                }
                return;
            }
            if (e.target && e.target.id === 'task-import-file') {
                const file = e.target.files && e.target.files[0];
                e.target.value = '';
                if (file) void this.importJsonFile(file);
            }
        });

        root.addEventListener('keydown', (e) => {
            const inlineInp = e.target && e.target.closest ? e.target.closest('[data-inline-input]') : null;
            if (inlineInp) {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    this.submitInlineAdd(inlineInp.dataset.colId);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    this.ui.inlineAddColId = null;
                    this.renderBoard();
                }
            }
        });

        const colsEl = this._byId('board-columns');
        if (colsEl && !colsEl._scrollBound) {
            colsEl._scrollBound = true;
            colsEl.addEventListener('scroll', () => this.updateScrollArrows(), { passive: true });
        }
    },

    _refreshIcons() {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    },

    syncSidebarDOM() {
        const root = this._rootEl();
        const backdrop = this._byId('task-sidebar-backdrop');
        if (!root) return;
        root.classList.toggle('sidebar-collapsed', !this.state.isSidebarOpen);
        if (backdrop) {
            backdrop.classList.toggle('hidden', !this.state.isSidebarOpen);
        }
    },

    init() {
        this._dbReady = !!(window.DB && window.DB.db);
        this.bindGlobalListeners();
        this.loadFromDB();
        const root = this._rootEl();
        this._domMounted = !!root;
        if (root) {
            this.state.isSidebarOpen = window.innerWidth > 768;
            this.bindDomListeners(root);
            this.applyI18n();
            this.selectProject(this.state.activeProjectId);
            this.syncSidebarDOM();
            this._refreshIcons();
        }
    },

    onActivate() {
        if (!this._domMounted || !this._rootEl()) {
            this.init();
            return;
        }
        this.applyI18n();
        this.syncHeader();
        this.renderProjects();
        this.renderToolbar();
        this.renderBoard();
        this.syncSidebarDOM();
        this._refreshIcons();
    },

    onDeactivate() {
        this.closeTaskModal();
    },

    onClose() {
        this.closeTaskModal();
        this.sortables.forEach(s => { try { s.destroy(); } catch (_) {} });
        this.sortables = [];
        this._domMounted = false;
    },

    getT(key, fallback) {
        const raw = window.PluginManager ? window.PluginManager.getTranslation(key) : key;
        return (raw && raw !== key) ? raw : (fallback || key);
    },

    _uid(prefix) {
        return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },

    esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    // Unified local-time deadline parser:
    // - Date-only ("YYYY-MM-DD") defaults to 23:59:59 local time (matching Dashboard).
    // - Date + time ("YYYY-MM-DDTHH:MM") uses exact local hours/minutes.
    parseDeadline(raw) {
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(raw || '').trim());
        if (!m) return null;
        const hasTime = m[4] !== undefined;
        return new Date(
            +m[1],
            +m[2] - 1,
            +m[3],
            hasTime ? +m[4] : 23,
            hasTime ? +m[5] : 59,
            hasTime ? 0 : 59,
            hasTime ? 0 : 999
        );
    },

    hasDeadlineTime(raw) {
        return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(String(raw || '').trim());
    },

    formatDeadline(raw) {
        const d = this.parseDeadline(raw);
        if (!d) return '';
        if (this.hasDeadlineTime(raw)) {
            return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
        }
        return d.toLocaleDateString([], { dateStyle: 'short' });
    },

    toInputValue(raw) {
        const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(raw || '').trim());
        if (!m) return '';
        return m[1] + 'T' + (m[2] || '18') + ':' + (m[3] || '00');
    },

    _presetDeadlineValue(preset) {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const fmt = (d, hm) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hm}`;
        if (preset === 'clear') return '';
        if (preset === 'today') return fmt(now, '18:00');
        if (preset === 'tomorrow') {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            return fmt(d, '12:00');
        }
        if (preset === 'week') {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
            return fmt(d, '12:00');
        }
        return '';
    },

    isDoneColumn(col, project) {
        if (!col || !project || !Array.isArray(project.columns) || project.columns.length <= 1) return false;
        return this.DONE_COL_RX.test(String(col.title || ''));
    },

    isTaskDone(task, col, project) {
        return Boolean(task && task.done) || this.isDoneColumn(col, project);
    },

    isTaskOverdue(task, col, project, nowMs = Date.now()) {
        if (!task || !task.deadline || this.isTaskDone(task, col, project)) return false;
        const d = this.parseDeadline(task.deadline);
        return !!(d && d.getTime() < nowMs);
    },

    isTaskDueToday(task, col, project, now = new Date()) {
        if (!task || !task.deadline || this.isTaskDone(task, col, project)) return false;
        const d = this.parseDeadline(task.deadline);
        return !!(d && d.getTime() >= now.getTime() && d.toDateString() === now.toDateString());
    },

    normalizeTask(raw) {
        const t = raw || {};
        const tags = Array.isArray(t.tags) ? t.tags.map(s => String(s || '').trim()).filter(Boolean) : [];
        const subtasks = Array.isArray(t.subtasks)
            ? t.subtasks.filter(s => s && String(s.title || '').trim()).map(s => ({
                id: s.id || this._uid('s'),
                title: String(s.title).trim(),
                done: Boolean(s.done)
            }))
            : [];
        const prio = this.PRIORITIES.includes(String(t.priority || '').toLowerCase())
            ? String(t.priority).toLowerCase()
            : 'none';
        return {
            id: t.id || this._uid('t'),
            title: String(t.title || ''),
            desc: String(t.desc || ''),
            deadline: String(t.deadline || ''),
            priority: prio,
            tags,
            subtasks,
            done: Boolean(t.done),
            completedAt: t.completedAt || ''
        };
    },

    getProjectColor(project) {
        return (project && this.PROJECT_COLORS.includes(project.color)) ? project.color : 'violet';
    },

    getProjectStats(project) {
        let total = 0;
        let done = 0;
        let overdue = 0;
        const nowMs = Date.now();
        if (!project || !Array.isArray(project.columns)) return { total, done, overdue };
        for (const col of project.columns) {
            for (const task of (col.tasks || [])) {
                total++;
                if (this.isTaskDone(task, col, project)) done++;
                else if (this.isTaskOverdue(task, col, project, nowMs)) overdue++;
            }
        }
        return { total, done, overdue };
    },

    getDefaultColumns() {
        return [
            { id: this._uid('c'), title: this.getT('task_col_todo', 'To Do'), tasks: [] },
            { id: this._uid('c'), title: this.getT('task_col_progress', 'In Progress'), tasks: [] },
            { id: this._uid('c'), title: this.getT('task_col_done', 'Done'), tasks: [] }
        ];
    },

    getDefaultTaskTitle() {
        return this.getT('task_default_title', 'New Task');
    },

    applyI18n() {
        const root = this._rootEl();
        if (!root) return;
        root.querySelectorAll('[data-task-i18n]').forEach(el => {
            const key = el.getAttribute('data-task-i18n');
            el.innerText = this.getT(key, el.innerText.trim() || undefined);
        });
        root.querySelectorAll('[data-task-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-task-i18n-title');
            el.setAttribute('title', this.getT(key, el.getAttribute('title') || undefined));
        });
        root.querySelectorAll('[data-task-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-task-i18n-placeholder');
            el.setAttribute('placeholder', this.getT(key, el.getAttribute('placeholder') || undefined));
        });
    },

    // Deterministic starter IDs prevent Cloud Sync v2 from duplicating the default
    // board when two fresh devices sync for the first time.
    _seedStarterProject() {
        this.state.projects = [
            {
                id: 'p-starter',
                name: this.getT('task_seed_project', 'My First Project'),
                color: 'violet',
                columns: [
                    {
                        id: 'c-starter-todo',
                        title: this.getT('task_col_todo', 'To Do'),
                        tasks: [{
                            id: 't-starter-1',
                            title: this.getT('task_seed_task', 'Explore Aru'),
                            desc: this.getT('task_seed_task_desc', 'Meet the assistant, try chats, plugins and artifacts.'),
                            deadline: '',
                            priority: 'medium',
                            tags: ['Aru'],
                            subtasks: [],
                            done: false
                        }]
                    },
                    { id: 'c-starter-progress', title: this.getT('task_col_progress', 'In Progress'), tasks: [] },
                    { id: 'c-starter-done', title: this.getT('task_col_done', 'Done'), tasks: [] }
                ]
            }
        ];
        this.state.activeProjectId = 'p-starter';
    },

    loadFromDB() {
        if (window.DB && window.DB.db) {
            this.state.projects = [];
            this.state.activeProjectId = null;
            const saved = window.DB.getPluginData('task');
            if (saved && Array.isArray(saved.projects)) {
                this.state.projects = saved.projects;
                const activeExists = saved.projects.some(p => p.id === saved.activeProjectId);
                this.state.activeProjectId = activeExists
                    ? saved.activeProjectId
                    : (saved.projects.length > 0 ? saved.projects[0].id : null);
                return;
            }
            this._seedStarterProject();
            return;
        }

        // Default before DB initialization (pre-auth / wizard)
        if (this.state.projects.length === 0) {
            this._seedStarterProject();
        }
    },

    _findProjectAndColumn(colId, taskId, projectIdOverride = null) {
        const pid = projectIdOverride || this.state.activeProjectId;
        const project = this.state.projects.find(p => String(p.id) === String(pid));
        if (!project) return { project: null, col: null, task: null };
        let col = colId ? project.columns.find(c => String(c.id) === String(colId)) : null;
        if (!taskId) return { project, col, task: null };
        let task = col ? col.tasks.find(t => String(t.id) === String(taskId)) : null;
        if (!task) {
            for (const candidate of project.columns) {
                const found = candidate.tasks.find(t => String(t.id) === String(taskId));
                if (found) {
                    col = candidate;
                    task = found;
                    break;
                }
            }
        }
        return { project, col, task };
    },

    syncHeader() {
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        const nameEl = this._byId('active-project-name');
        if (nameEl) {
            nameEl.innerText = project ? project.name : this.getT('task_empty_board', 'Select a project');
        }
        const dotEl = this._byId('active-project-dot');
        if (dotEl) {
            dotEl.className = `task-project-dot is-${this.getProjectColor(project)} ${project ? '' : 'hidden'}`;
        }
        const progEl = this._byId('active-project-progress');
        if (progEl) {
            const st = this.getProjectStats(project);
            if (project && st.total > 0) {
                progEl.innerText = this.getT('task_progress_summary', '{done}/{total}')
                    .replace('{done}', st.done)
                    .replace('{total}', st.total);
                progEl.classList.remove('hidden');
            } else {
                progEl.classList.add('hidden');
            }
        }
        const addColBtn = this._byId('btn-add-column');
        if (addColBtn) addColBtn.disabled = !project;
        const aiBtn = this._byId('btn-task-ai-plan');
        if (aiBtn) aiBtn.disabled = !project;

        const bTab = this._byId('btn-view-board');
        const lTab = this._byId('btn-view-list');
        if (bTab && lTab) {
            const isBoard = this.ui.viewMode !== 'list';
            bTab.classList.toggle('is-active', isBoard);
            bTab.setAttribute('aria-selected', isBoard ? 'true' : 'false');
            lTab.classList.toggle('is-active', !isBoard);
            lTab.setAttribute('aria-selected', !isBoard ? 'true' : 'false');
        }
    },

    setViewMode(mode) {
        this.ui.viewMode = mode === 'list' ? 'list' : 'board';
        this.ui.inlineAddColId = null;
        this.syncHeader();
        this.renderBoard();
        this._refreshIcons();
    },

    async addProject() {
        const raw = await window.UI.prompt(this.getT('task_new_project') + ':');
        const name = raw ? raw.trim() : '';
        if (!name) return;

        const color = this.PROJECT_COLORS[this.state.projects.length % this.PROJECT_COLORS.length];
        const project = {
            id: this._uid('p'),
            name,
            color,
            columns: this.getDefaultColumns()
        };

        this.state.projects.push(project);
        this.selectProject(project.id);
        this.saveState();
    },

    async renameProject(id) {
        const project = this.state.projects.find(p => p.id === id);
        if (!project) return;
        const raw = await window.UI.prompt(this.getT('task_rename_project', 'Rename project') + ':', project.name);
        const name = raw ? raw.trim() : '';
        if (!name || name === project.name) return;
        project.name = name;
        this.selectProject(project.id);
        this.saveState();
    },

    cycleProjectColor(id) {
        const project = this.state.projects.find(p => p.id === id);
        if (!project) return;
        const cur = this.getProjectColor(project);
        const next = this.PROJECT_COLORS[(this.PROJECT_COLORS.indexOf(cur) + 1) % this.PROJECT_COLORS.length];
        project.color = next;
        this.syncHeader();
        this.renderProjects();
        this.saveState();
    },

    selectProject(id) {
        this.state.activeProjectId = id;
        this.ui.inlineAddColId = null;
        this.ui.tagFilter = '';
        this.syncHeader();
        this.renderProjects();
        this.renderToolbar();
        this.renderBoard();
    },

    renderProjects() {
        const list = this._byId('task-projects-list');
        if (!list) return;

        list.innerHTML = this.state.projects.map(p => {
            const st = this.getProjectStats(p);
            const activeCount = Math.max(0, st.total - st.done);
            const color = this.getProjectColor(p);
            const badge = st.overdue > 0
                ? `<span class="task-proj-badge is-overdue">${st.overdue}</span>`
                : (activeCount > 0 ? `<span class="task-proj-badge">${activeCount}</span>` : '');
            return `
            <div class="project-node group ${p.id === this.state.activeProjectId ? 'active' : ''}" data-task-action="select-project" data-project-id="${this.esc(p.id)}">
                <button type="button" class="task-project-dot is-${color}" data-task-action="cycle-color" data-project-id="${this.esc(p.id)}" title="${this.esc(this.getT('task_project_color', 'Project color'))}" aria-label="${this.esc(this.getT('task_project_color', 'Project color'))}"></button>
                <span class="flex-1 truncate">${this.esc(p.name)}</span>
                ${badge}
                <div class="project-actions shrink-0">
                    <button type="button" class="p-1 hover:text-purple-500 transition" title="${this.esc(this.getT('task_rename_project', 'Rename project'))}" data-task-action="rename-project" data-project-id="${this.esc(p.id)}">
                        <i data-lucide="pencil" class="w-3 h-3"></i>
                    </button>
                    <button type="button" class="p-1 hover:text-red-500 transition" title="${this.esc(this.getT('task_delete', 'Delete'))}" data-task-action="delete-project" data-project-id="${this.esc(p.id)}">
                        <i data-lucide="trash-2" class="w-3 h-3"></i>
                    </button>
                </div>
            </div>`;
        }).join('');

        this._refreshIcons();
    },

    renderToolbar() {
        const toolbar = this._byId('task-toolbar');
        if (!toolbar) return;
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) {
            toolbar.classList.add('hidden');
            return;
        }
        toolbar.classList.remove('hidden');

        const searchInp = this._byId('task-search-input');
        if (searchInp && searchInp.value !== this.ui.search) searchInp.value = this.ui.search;
        const clearBtn = this._byId('btn-task-search-clear');
        if (clearBtn) clearBtn.classList.toggle('hidden', !this.ui.search);

        toolbar.querySelectorAll('[data-task-action="set-filter"]').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.filter === this.ui.filter);
        });
        const hideBtn = this._byId('btn-hide-done');
        if (hideBtn) hideBtn.classList.toggle('is-active', !!this.ui.hideDone);

        const tagWrap = this._byId('task-tag-filters');
        if (tagWrap) {
            const tags = [];
            const seen = new Set();
            for (const col of (project.columns || [])) {
                for (const t of (col.tasks || [])) {
                    for (const tag of (Array.isArray(t.tags) ? t.tags : [])) {
                        const clean = String(tag || '').trim();
                        if (clean && !seen.has(clean.toLowerCase())) {
                            seen.add(clean.toLowerCase());
                            tags.push(clean);
                        }
                    }
                }
            }
            if (tags.length) {
                tagWrap.classList.remove('hidden');
                tagWrap.innerHTML = tags.slice(0, 10).map(tag => `
                    <button type="button" class="task-filter-pill ${this.ui.tagFilter.toLowerCase() === tag.toLowerCase() ? 'is-active' : ''}" data-task-action="toggle-tag-filter" data-tag="${this.esc(tag)}">#${this.esc(tag)}</button>
                `).join('');
            } else {
                tagWrap.classList.add('hidden');
                tagWrap.innerHTML = '';
            }
        }
    },

    hasActiveFilters() {
        return !!(this.ui.search.trim() || this.ui.filter !== 'all' || this.ui.hideDone || this.ui.tagFilter);
    },

    taskMatchesFilters(task, col, project) {
        const done = this.isTaskDone(task, col, project);
        if (this.ui.hideDone && done) return false;
        if (this.ui.filter === 'today' && !this.isTaskDueToday(task, col, project)) return false;
        if (this.ui.filter === 'overdue' && !this.isTaskOverdue(task, col, project)) return false;
        if (this.ui.filter === 'high' && !(task.priority === 'high' || task.priority === 'urgent')) return false;
        if (this.ui.tagFilter) {
            const want = this.ui.tagFilter.toLowerCase();
            const hasTag = Array.isArray(task.tags) && task.tags.some(t => String(t || '').trim().toLowerCase() === want);
            if (!hasTag) return false;
        }
        const q = this.ui.search.trim().toLowerCase();
        if (q) {
            const haystack = [
                task.title || '',
                task.desc || '',
                ...(Array.isArray(task.tags) ? task.tags : []),
                ...(Array.isArray(task.subtasks) ? task.subtasks.map(s => s.title || '') : [])
            ].join(' ').toLowerCase();
            if (!haystack.includes(q)) return false;
        }
        return true;
    },

    renderDeadlineBadge(t, col, project) {
        if (!t.deadline) return '';
        const d = this.parseDeadline(t.deadline);
        if (!d) return '';
        const done = this.isTaskDone(t, col, project);
        const overdue = !done && d.getTime() < Date.now();
        const today = !done && !overdue && d.toDateString() === new Date().toDateString();
        const cls = done ? 'is-done' : (overdue ? 'is-overdue' : (today ? 'is-today' : ''));
        return `
            <span class="task-meta-chip ${cls}">
                <i data-lucide="clock" class="w-3 h-3"></i>
                ${this.esc(this.formatDeadline(t.deadline))}
            </span>`;
    },

    renderCardHTML(rawTask, col, project) {
        const t = Object.assign({ priority: 'none', tags: [], subtasks: [], done: false }, rawTask);
        const done = this.isTaskDone(t, col, project);
        const prioClass = (t.priority && t.priority !== 'none') ? `prio-${this.esc(t.priority)}` : '';
        const prioBadge = (t.priority === 'urgent' || t.priority === 'high')
            ? `<span class="task-meta-chip ${t.priority === 'urgent' ? 'is-overdue' : 'is-today'}">${this.esc(this.getT(`task_prio_${t.priority}`, t.priority))}</span>`
            : '';
        const deadlineBadge = this.renderDeadlineBadge(t, col, project);
        const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
        const subDone = subs.filter(s => s && s.done).length;
        const subBadge = subs.length > 0
            ? `<span class="task-meta-chip ${subDone === subs.length ? 'is-done' : ''}"><i data-lucide="check-square" class="w-3 h-3"></i>${subDone}/${subs.length}</span>`
            : '';
        const tagChips = (Array.isArray(t.tags) ? t.tags.slice(0, 3) : [])
            .map(tag => `<span class="task-tag-chip">#${this.esc(tag)}</span>`).join('');
        const subBar = subs.length > 0
            ? `<div class="task-subtask-bar"><div class="task-subtask-fill ${subDone === subs.length ? 'is-complete' : ''}" style="width:${Math.round((subDone / subs.length) * 100)}%"></div></div>`
            : '';
        const hasMeta = !!(prioBadge || deadlineBadge || subBadge || tagChips);
        return `
            <div class="task-card ${prioClass} ${done ? 'is-done' : ''}" data-id="${this.esc(t.id)}" data-task-action="open-task" data-col-id="${this.esc(col.id)}" data-task-id="${this.esc(t.id)}">
                <div class="task-card-top">
                    <button type="button" class="task-check-btn ${done ? 'is-checked' : ''}" data-task-action="toggle-done" data-col-id="${this.esc(col.id)}" data-task-id="${this.esc(t.id)}" title="${this.esc(this.getT(done ? 'task_mark_undone' : 'task_mark_done', 'Toggle done'))}" aria-label="${this.esc(this.getT(done ? 'task_mark_undone' : 'task_mark_done', 'Toggle done'))}">
                        <i data-lucide="check" class="w-3 h-3"></i>
                    </button>
                    <h4 class="task-card-title">${this.esc(t.title)}</h4>
                </div>
                ${t.desc ? `<p class="task-card-desc">${this.esc(t.desc)}</p>` : ''}
                ${hasMeta ? `<div class="task-card-meta">${prioBadge}${deadlineBadge}${subBadge}${tagChips}</div>` : ''}
                ${subBar}
            </div>`;
    },

    renderBoard() {
        const container = this._byId('board-columns');
        if (!container) return;

        // Destroy old sortables before DOM swap
        this.sortables.forEach(s => { try { s.destroy(); } catch (_) {} });
        this.sortables = [];

        this.syncHeader();
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) {
            container.classList.remove('is-list-mode');
            container.innerHTML = `
                <div class="flex-1 flex flex-col items-center justify-center text-gray-400 opacity-75 p-8 text-center gap-4">
                    <i data-lucide="clipboard-check" class="w-16 h-16 opacity-60"></i>
                    <p>${this.esc(this.getT('task_empty_board'))}</p>
                </div>`;
            this.updateScrollArrows();
            this._refreshIcons();
            return;
        }

        if (!project.columns || project.columns.length === 0) {
            container.classList.remove('is-list-mode');
            container.innerHTML = `
                <div class="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center gap-4">
                    <i data-lucide="columns" class="w-12 h-12 opacity-60"></i>
                    <p class="text-sm">${this.esc(this.getT('task_empty_columns', 'No columns yet. Add one to organize tasks.'))}</p>
                    <button type="button" class="btn-task btn-task-primary flex items-center gap-2" data-task-action="add-column">
                        <i data-lucide="plus" class="w-4 h-4"></i>
                        ${this.esc(this.getT('task_add_first_column', 'Add Column'))}
                    </button>
                </div>`;
            this.updateScrollArrows();
            this._refreshIcons();
            return;
        }

        if (this.ui.viewMode === 'list') {
            container.classList.add('is-list-mode');
            this.renderListView(container, project);
            this.updateScrollArrows();
            this._refreshIcons();
            return;
        }

        container.classList.remove('is-list-mode');
        const filtering = this.hasActiveFilters();
        let totalVisible = 0;

        const colsHtml = project.columns.map(col => {
            const isDoneCol = this.isDoneColumn(col, project);
            const allTasks = Array.isArray(col.tasks) ? col.tasks : [];
            const visibleTasks = filtering ? allTasks.filter(t => this.taskMatchesFilters(t, col, project)) : allTasks;
            totalVisible += visibleTasks.length;
            const inlineActive = this.ui.inlineAddColId === col.id;
            const countText = filtering && visibleTasks.length !== allTasks.length
                ? `${visibleTasks.length}/${allTasks.length}`
                : `${allTasks.length}`;

            return `
            <div class="task-column ${isDoneCol ? 'is-done-col' : ''}" data-col-id="${this.esc(col.id)}">
                <div class="column-header">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="col-drag-handle" title="Move"><i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i></span>
                        <span class="font-bold text-sm tracking-tight truncate">${this.esc(col.title)}</span>
                        <span class="column-count" data-col-count="${this.esc(col.id)}">${this.esc(countText)}</span>
                    </div>
                    <div class="flex items-center gap-0.5 shrink-0">
                        ${isDoneCol && allTasks.length > 0 ? `
                        <button type="button" class="p-1.5 text-gray-400 hover:text-emerald-500 transition rounded-lg" title="${this.esc(this.getT('task_clear_done', 'Clear done'))}" data-task-action="clear-done-col" data-col-id="${this.esc(col.id)}">
                            <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
                        </button>` : ''}
                        <button type="button" class="p-1.5 text-gray-400 hover:text-purple-500 transition rounded-lg" title="${this.esc(this.getT('task_rename_column', 'Rename column'))}" data-task-action="rename-column" data-col-id="${this.esc(col.id)}">
                            <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
                        </button>
                        <button type="button" class="p-1.5 text-gray-400 hover:text-red-500 transition rounded-lg" title="${this.esc(this.getT('task_delete', 'Delete'))}" data-task-action="delete-column" data-col-id="${this.esc(col.id)}">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </div>

                <div class="cards-list" id="list-${this.esc(col.id)}" data-list-col-id="${this.esc(col.id)}">
                    ${visibleTasks.map(t => this.renderCardHTML(t, col, project)).join('')}
                </div>

                ${inlineActive ? `
                <div class="task-inline-add">
                    <input type="text" class="task-inline-input" data-inline-input data-col-id="${this.esc(col.id)}" placeholder="${this.esc(this.getT('task_quick_placeholder', 'Enter card title...'))}">
                    <div class="task-inline-actions">
                        <div class="flex items-center gap-1.5">
                            <button type="button" class="btn-task btn-task-primary" style="padding:5px 10px;font-size:0.72rem" data-task-action="inline-save" data-col-id="${this.esc(col.id)}">${this.esc(this.getT('task_quick_add', 'Add'))}</button>
                            <button type="button" class="btn-task btn-task-outline" style="padding:5px 8px;font-size:0.72rem" data-task-action="inline-cancel">${this.esc(this.getT('task_cancel', 'Cancel'))}</button>
                        </div>
                        <button type="button" class="task-preset-btn" data-task-action="inline-details" data-col-id="${this.esc(col.id)}">${this.esc(this.getT('task_more_details', 'Details'))}</button>
                    </div>
                </div>` : `
                <button type="button" class="task-col-add-btn" data-task-action="add-task" data-col-id="${this.esc(col.id)}">
                    <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                    ${this.esc(this.getT('task_new_card'))}
                </button>`}
            </div>`;
        }).join('');

        container.innerHTML = colsHtml;

        if (typeof Sortable !== 'undefined') {
            if (!filtering) {
                const colSort = new Sortable(container, {
                    animation: 160,
                    handle: '.col-drag-handle',
                    draggable: '.task-column',
                    ghostClass: 'task-ghost',
                    onEnd: (evt) => this.handleColumnReorder(evt)
                });
                this.sortables.push(colSort);
            }
            project.columns.forEach(col => {
                const listEl = this._byId(`list-${col.id}`);
                if (listEl) {
                    const s = new Sortable(listEl, {
                        group: 'tasks',
                        animation: 150,
                        delay: 250,
                        delayOnTouchOnly: true,
                        touchStartThreshold: 5,
                        filter: 'button, input',
                        preventOnFilter: false,
                        ghostClass: 'task-ghost',
                        onEnd: (evt) => this.handleTaskMove(evt)
                    });
                    this.sortables.push(s);
                }
            });
        }

        this.updateScrollArrows();
        this._refreshIcons();
    },

    renderListView(container, project) {
        const filtering = this.hasActiveFilters();
        const groupsHtml = project.columns.map(col => {
            const isDoneCol = this.isDoneColumn(col, project);
            const allTasks = Array.isArray(col.tasks) ? col.tasks : [];
            const tasks = filtering ? allTasks.filter(t => this.taskMatchesFilters(t, col, project)) : allTasks;
            if (filtering && tasks.length === 0) return '';
            return `
            <section class="task-list-group" data-col-id="${this.esc(col.id)}">
                <header class="task-list-group-head">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-sm ${isDoneCol ? 'text-emerald-500' : ''}">${this.esc(col.title)}</span>
                        <span class="column-count">${tasks.length}</span>
                    </div>
                    <button type="button" class="btn-task btn-task-outline" style="padding:4px 9px;font-size:0.7rem" data-task-action="add-task" data-col-id="${this.esc(col.id)}">
                        <i data-lucide="plus" class="w-3 h-3 inline"></i> ${this.esc(this.getT('task_new_card'))}
                    </button>
                </header>
                <div>
                    ${tasks.length ? tasks.map(raw => {
                        const t = Object.assign({ priority: 'none', tags: [], subtasks: [], done: false }, raw);
                        const done = this.isTaskDone(t, col, project);
                        const dlBadge = this.renderDeadlineBadge(t, col, project);
                        const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
                        const subBadge = subs.length ? `<span class="task-meta-chip">${subs.filter(s => s && s.done).length}/${subs.length}</span>` : '';
                        const colOpts = project.columns.map(c => `<option value="${this.esc(c.id)}" ${c.id === col.id ? 'selected' : ''}>${this.esc(c.title)}</option>`).join('');
                        return `
                        <div class="task-list-row ${done ? 'is-done' : ''}" data-task-action="open-task" data-col-id="${this.esc(col.id)}" data-task-id="${this.esc(t.id)}">
                            <button type="button" class="task-check-btn ${done ? 'is-checked' : ''}" data-task-action="toggle-done" data-col-id="${this.esc(col.id)}" data-task-id="${this.esc(t.id)}">
                                <i data-lucide="check" class="w-3 h-3"></i>
                            </button>
                            <div class="flex-1 min-w-0">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="task-card-title truncate">${this.esc(t.title)}</span>
                                    ${(t.priority === 'urgent' || t.priority === 'high') ? `<span class="task-meta-chip ${t.priority === 'urgent' ? 'is-overdue' : 'is-today'}">${this.esc(this.getT(`task_prio_${t.priority}`, t.priority))}</span>` : ''}
                                    ${dlBadge}${subBadge}
                                    ${(t.tags || []).slice(0, 2).map(tag => `<span class="task-tag-chip">#${this.esc(tag)}</span>`).join('')}
                                </div>
                            </div>
                            <select class="task-list-col-select" data-task-move-col data-task-id="${this.esc(t.id)}" data-from-col-id="${this.esc(col.id)}" onclick="event.stopPropagation()">${colOpts}</select>
                        </div>`;
                    }).join('') : `<div class="p-4 text-xs text-gray-400 italic">${this.esc(this.getT('task_show_no_tasks', 'No tasks yet.'))}</div>`}
                </div>
            </section>`;
        }).filter(Boolean).join('');

        container.innerHTML = groupsHtml || `
            <div class="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center gap-3">
                <i data-lucide="search-x" class="w-10 h-10 opacity-60"></i>
                <p class="text-sm">${this.esc(this.getT('task_no_matches', 'No matching tasks.'))}</p>
                <button type="button" class="btn-task btn-task-outline" data-task-action="clear-filters">${this.esc(this.getT('task_filter_clear', 'Reset filters'))}</button>
            </div>`;
    },

    updateScrollArrows() {
        const colsEl = this._byId('board-columns');
        const leftBtn = this._byId('task-scroll-left');
        const rightBtn = this._byId('task-scroll-right');
        if (!colsEl || !leftBtn || !rightBtn) return;
        if (this.ui.viewMode === 'list') {
            leftBtn.classList.add('hidden');
            rightBtn.classList.add('hidden');
            return;
        }
        const maxScroll = Math.max(0, (colsEl.scrollWidth || 0) - (colsEl.clientWidth || 0));
        leftBtn.classList.toggle('hidden', (colsEl.scrollLeft || 0) <= 6);
        rightBtn.classList.toggle('hidden', maxScroll <= 6 || (colsEl.scrollLeft || 0) >= maxScroll - 6);
    },

    scrollBoard(dir = 1) {
        const colsEl = this._byId('board-columns');
        if (!colsEl) return;
        if (typeof colsEl.scrollBy === 'function') {
            colsEl.scrollBy({ left: dir * 310, behavior: 'smooth' });
        } else {
            colsEl.scrollLeft = (colsEl.scrollLeft || 0) + dir * 310;
        }
    },

    startInlineAdd(colId) {
        if (this.ui.viewMode === 'list') {
            this.openTaskModal(colId);
            return;
        }
        this.ui.inlineAddColId = colId;
        this.renderBoard();
        const inp = this._q('[data-inline-input]');
        if (inp) setTimeout(() => { try { inp.focus({ preventScroll: true }); } catch (_) {} }, 20);
    },

    submitInlineAdd(colId) {
        const inp = this._q('[data-inline-input]');
        const title = inp ? inp.value.trim() : '';
        if (!title) {
            if (inp) inp.focus();
            return;
        }
        const { project, col } = this._findProjectAndColumn(colId);
        if (!project || !col) return;
        col.tasks.push({
            id: this._uid('t'),
            title,
            desc: '',
            deadline: '',
            priority: 'none',
            tags: [],
            subtasks: [],
            done: this.isDoneColumn(col, project)
        });
        this.ui.inlineAddColId = null;
        this.renderBoard();
        this.renderProjects();
        this.saveState();
    },

    toggleTaskDone(colId, taskId, projectIdOverride = null) {
        const { project, col, task } = this._findProjectAndColumn(colId, taskId, projectIdOverride);
        if (!project || !col || !task) return null;
        const currentlyDone = this.isTaskDone(task, col, project);
        const nextDone = !currentlyDone;
        task.done = nextDone;
        task.completedAt = nextDone ? new Date().toISOString() : '';

        if (project.columns.length > 1) {
            const doneCol = project.columns.find(c => this.isDoneColumn(c, project));
            const todoCol = project.columns.find(c => !this.isDoneColumn(c, project)) || project.columns[0];
            if (nextDone && doneCol && doneCol !== col) {
                col.tasks = col.tasks.filter(t => t.id !== task.id);
                doneCol.tasks.unshift(task);
            } else if (!nextDone && this.isDoneColumn(col, project) && todoCol && todoCol !== col) {
                col.tasks = col.tasks.filter(t => t.id !== task.id);
                todoCol.tasks.push(task);
            }
        }

        this.renderProjects();
        this.renderBoard();
        this.saveState();
        return nextDone;
    },

    moveTaskToColumn(fromColId, taskId, toColId) {
        const { project, col, task } = this._findProjectAndColumn(fromColId, taskId);
        if (!project || !col || !task) return;
        const toCol = project.columns.find(c => String(c.id) === String(toColId));
        if (!toCol || toCol === col) return;
        col.tasks = col.tasks.filter(t => t.id !== task.id);
        toCol.tasks.push(task);
        if (this.isDoneColumn(toCol, project)) {
            task.done = true;
            task.completedAt = task.completedAt || new Date().toISOString();
        } else if (this.isDoneColumn(col, project)) {
            task.done = false;
            task.completedAt = '';
        }
        this.renderProjects();
        this.renderBoard();
        this.saveState();
    },

    handleColumnReorder(evt) {
        if (!evt || evt.oldIndex === evt.newIndex) return;
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project || !Array.isArray(project.columns)) return;
        const [moved] = project.columns.splice(evt.oldIndex, 1);
        if (!moved) return;
        project.columns.splice(evt.newIndex, 0, moved);
        this.renderBoard();
        this.saveState();
    },

    handleTaskMove(evt) {
        if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
        const fromColId = (evt.from.dataset && evt.from.dataset.listColId) || evt.from.id.replace('list-', '');
        const toColId = (evt.to.dataset && evt.to.dataset.listColId) || evt.to.id.replace('list-', '');
        const taskId = evt.item.getAttribute('data-id');
        const newIndex = evt.newIndex;

        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return;

        const fromCol = project.columns.find(c => c.id === fromColId);
        const toCol = project.columns.find(c => c.id === toColId);
        if (!fromCol || !toCol) return;

        const taskIndex = fromCol.tasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) return;

        const [task] = fromCol.tasks.splice(taskIndex, 1);
        if (!task) return;

        toCol.tasks.splice(newIndex, 0, task);
        evt.item.dataset.colId = toColId;

        if (this.isDoneColumn(toCol, project)) {
            task.done = true;
            task.completedAt = task.completedAt || new Date().toISOString();
        } else if (this.isDoneColumn(fromCol, project)) {
            task.done = false;
            task.completedAt = '';
        }

        // Scoped inside live root (avoids mutating Desktop Mode cloned snapshots)
        const fromBadge = this._q(`[data-col-count="${fromColId}"]`);
        if (fromBadge) fromBadge.textContent = String(fromCol.tasks.length);
        const toBadge = this._q(`[data-col-count="${toColId}"]`);
        if (toBadge) toBadge.textContent = String(toCol.tasks.length);

        this.renderProjects();
        this.renderBoard();
        this.saveState();
    },

    async addColumn() {
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return;

        const raw = await window.UI.prompt(this.getT('task_new_column') + ':');
        const title = raw ? raw.trim() : '';
        if (!title) return;

        project.columns.push({
            id: this._uid('c'),
            title,
            tasks: []
        });
        this.renderBoard();
        this.saveState();
    },

    async renameColumn(colId) {
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return;
        const col = project.columns.find(c => c.id === colId);
        if (!col) return;
        const raw = await window.UI.prompt(this.getT('task_rename_column', 'Rename column') + ':', col.title);
        const title = raw ? raw.trim() : '';
        if (!title || title === col.title) return;
        col.title = title;
        this.renderBoard();
        this.saveState();
    },

    async clearDoneColumn(colId) {
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return;
        const col = project.columns.find(c => c.id === colId);
        if (!col || !col.tasks.length) return;
        if (!(await window.UI.confirm(this.getT('task_confirm_clear_done', 'Remove all completed tasks in this column?')))) return;
        col.tasks = [];
        this.renderProjects();
        this.renderBoard();
        this.saveState();
    },

    addTask(colId) {
        this.openTaskModal(colId);
    },

    _syncModalHeaderToggle() {
        const box = this._byId('task-modal-head-action');
        if (!box) return;
        if (!this._modalDraft) {
            box.innerHTML = '';
            return;
        }
        const done = !!this._modalDraft.done;
        box.innerHTML = `
            <button type="button" class="task-check-btn ${done ? 'is-checked' : ''}" data-task-action="modal-toggle-done" title="${this.esc(this.getT(done ? 'task_mark_undone' : 'task_mark_done', 'Toggle done'))}" aria-label="${this.esc(this.getT(done ? 'task_mark_undone' : 'task_mark_done', 'Toggle done'))}">
                <i data-lucide="check" class="w-3 h-3"></i>
            </button>`;
        this._refreshIcons();
    },

    _renderModalPrio() {
        const host = this._byId('task-modal-prio-pills');
        if (!host || !this._modalDraft) return;
        host.innerHTML = this.PRIORITIES.map(p => `
            <button type="button" class="task-prio-pill is-${p} ${this._modalDraft.priority === p ? 'is-active' : ''}" data-task-action="modal-set-prio" data-prio="${p}">
                ${this.esc(this.getT(`task_prio_${p}`, p))}
            </button>
        `).join('');
    },

    _renderModalTags() {
        const host = this._byId('task-modal-tags-list');
        if (!host || !this._modalDraft) return;
        host.innerHTML = this._modalDraft.tags.map((tag, i) => `
            <span class="task-tag-chip" style="gap:4px">
                #${this.esc(tag)}
                <button type="button" data-task-action="modal-remove-tag" data-idx="${i}" style="border:0;background:transparent;color:inherit;cursor:pointer;padding:0;line-height:1" aria-label="Remove">&times;</button>
            </span>
        `).join('');
    },

    _commitModalTagInput() {
        const inp = this._byId('task-edit-tag-input');
        if (!inp || !this._modalDraft) return;
        const parts = String(inp.value || '').split(/[,;]+/).map(s => s.trim().replace(/^#+/, '')).filter(Boolean);
        for (const p of parts) {
            if (!this._modalDraft.tags.some(t => t.toLowerCase() === p.toLowerCase())) {
                this._modalDraft.tags.push(p);
            }
        }
        inp.value = '';
        this._renderModalTags();
    },

    _renderModalSubtasks() {
        const host = this._byId('task-modal-subtasks-list');
        if (!host || !this._modalDraft) return;
        const subs = this._modalDraft.subtasks || [];
        const doneCount = subs.filter(s => s.done).length;
        const progEl = this._byId('task-modal-subtasks-count');
        if (progEl) progEl.textContent = subs.length ? `${doneCount}/${subs.length}` : '';

        host.innerHTML = subs.map((s, i) => `
            <div class="task-subtask-item">
                <button type="button" class="task-check-btn ${s.done ? 'is-checked' : ''}" data-task-action="modal-toggle-subtask" data-idx="${i}">
                    <i data-lucide="check" class="w-3 h-3"></i>
                </button>
                <span class="task-subtask-text ${s.done ? 'is-done' : ''}">${this.esc(s.title)}</span>
                <button type="button" class="task-icon-btn" data-task-action="modal-remove-subtask" data-idx="${i}" aria-label="Remove"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
            </div>
        `).join('');
        this._refreshIcons();
    },

    _commitModalSubtaskInput() {
        const inp = this._byId('task-edit-subtask-input');
        if (!inp || !this._modalDraft) return;
        const title = String(inp.value || '').trim();
        if (!title) return;
        this._modalDraft.subtasks.push({ id: this._uid('s'), title, done: false });
        inp.value = '';
        this._renderModalSubtasks();
    },

    openTaskModal(colId, taskId = null, prefill = null) {
        const { project, col, task } = this._findProjectAndColumn(colId, taskId);
        if (!project || !col) return;
        const base = task ? this.normalizeTask(task) : this.normalizeTask(Object.assign({ done: this.isDoneColumn(col, project) }, prefill || {}));

        this._modalDraft = {
            colId: col.id,
            taskId: task ? task.id : null,
            projectId: project.id,
            priority: base.priority,
            tags: [...base.tags],
            subtasks: base.subtasks.map(s => ({ ...s })),
            done: this.isTaskDone(base, col, project)
        };

        const modal = this._byId('task-detail-modal');
        const content = this._byId('task-modal-content');
        const titleHead = this._byId('task-modal-title');
        if (!modal || !content) return;
        if (titleHead) titleHead.textContent = this.getT('task_modal_header', 'Task');

        const projOptions = this.state.projects.map(p =>
            `<option value="${this.esc(p.id)}" ${p.id === project.id ? 'selected' : ''}>${this.esc(p.name)}</option>`
        ).join('');
        const colOptions = project.columns.map(c =>
            `<option value="${this.esc(c.id)}" ${c.id === col.id ? 'selected' : ''}>${this.esc(c.title)}</option>`
        ).join('');

        content.innerHTML = `
            <div>
                <label class="task-modal-label" for="task-edit-title">${this.esc(this.getT('task_title'))}</label>
                <input type="text" id="task-edit-title" class="task-modal-input" value="${this.esc(base.title)}" placeholder="${this.esc(this.getT('task_placeholder_title', 'What needs to be done?'))}">
            </div>

            <div>
                <label class="task-modal-label" for="task-edit-desc">${this.esc(this.getT('task_desc'))}</label>
                <textarea id="task-edit-desc" class="task-modal-input min-h-[82px] resize-none" placeholder="${this.esc(this.getT('task_placeholder_desc', 'Add more details...'))}">${this.esc(base.desc)}</textarea>
            </div>

            <div>
                <span class="task-modal-label">${this.esc(this.getT('task_priority', 'Priority'))}</span>
                <div id="task-modal-prio-pills" class="task-prio-pills"></div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label class="task-modal-label" for="task-edit-deadline">${this.esc(this.getT('task_deadline'))}</label>
                    <input type="datetime-local" id="task-edit-deadline" class="task-modal-input" value="${this.esc(this.toInputValue(base.deadline))}">
                    <div class="task-preset-row">
                        <button type="button" class="task-preset-btn" data-task-action="modal-deadline-preset" data-preset="today">${this.esc(this.getT('task_dl_today', 'Today 18:00'))}</button>
                        <button type="button" class="task-preset-btn" data-task-action="modal-deadline-preset" data-preset="tomorrow">${this.esc(this.getT('task_dl_tomorrow', 'Tomorrow'))}</button>
                        <button type="button" class="task-preset-btn" data-task-action="modal-deadline-preset" data-preset="week">${this.esc(this.getT('task_dl_week', '+7d'))}</button>
                        <button type="button" class="task-preset-btn" data-task-action="modal-deadline-preset" data-preset="clear">${this.esc(this.getT('task_dl_clear', 'Clear'))}</button>
                    </div>
                </div>
                <div class="space-y-2.5">
                    <div>
                        <label class="task-modal-label" for="task-edit-column">${this.esc(this.getT('task_column_label', 'Column'))}</label>
                        <select id="task-edit-column" class="task-modal-input">${colOptions}</select>
                    </div>
                    ${this.state.projects.length > 1 ? `
                    <div>
                        <label class="task-modal-label" for="task-edit-project">${this.esc(this.getT('task_project_label', 'Project'))}</label>
                        <select id="task-edit-project" class="task-modal-input">${projOptions}</select>
                    </div>` : ''}
                </div>
            </div>

            <div>
                <label class="task-modal-label" for="task-edit-tag-input">${this.esc(this.getT('task_tags', 'Tags'))}</label>
                <div id="task-modal-tags-list" class="flex flex-wrap gap-1.5 mb-2"></div>
                <div class="flex gap-2">
                    <input type="text" id="task-edit-tag-input" class="task-modal-input" placeholder="${this.esc(this.getT('task_tags_placeholder', 'work, study'))}">
                    <button type="button" class="btn-task btn-task-outline shrink-0" data-task-action="modal-add-tag">+</button>
                </div>
            </div>

            <div>
                <div class="flex items-center justify-between mb-1.5">
                    <span class="task-modal-label" style="margin:0">${this.esc(this.getT('task_subtasks', 'Subtasks'))} <span id="task-modal-subtasks-count" class="ml-1 opacity-75"></span></span>
                    <button type="button" id="btn-task-ai-breakdown" class="btn-task btn-task-soft" style="padding:4px 9px;font-size:0.7rem" data-task-action="modal-ai-breakdown">
                        <i data-lucide="sparkles" class="w-3 h-3 inline mr-1"></i>${this.esc(this.getT('task_ai_breakdown', 'Break down with Aru'))}
                    </button>
                </div>
                <div id="task-modal-subtasks-list" class="space-y-1.5 mb-2"></div>
                <div class="flex gap-2">
                    <input type="text" id="task-edit-subtask-input" class="task-modal-input" placeholder="${this.esc(this.getT('task_subtask_placeholder', 'Add step...'))}">
                    <button type="button" class="btn-task btn-task-outline shrink-0" data-task-action="modal-add-subtask">+</button>
                </div>
            </div>

            <div class="flex flex-wrap gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
                <button type="button" class="btn-task btn-task-primary flex-1" data-task-action="save-task" data-col-id="${this.esc(col.id)}" data-task-id="${this.esc(taskId || '')}">
                    ${this.esc(taskId ? this.getT('task_save') : this.getT('task_create'))}
                </button>
                <button type="button" class="btn-task btn-task-outline" data-task-action="close-modal">
                    ${this.esc(this.getT('task_cancel', 'Cancel'))}
                </button>
                ${taskId ? `
                <button type="button" class="btn-task btn-task-outline" title="${this.esc(this.getT('task_duplicate', 'Duplicate'))}" data-task-action="duplicate-task" data-col-id="${this.esc(col.id)}" data-task-id="${this.esc(taskId)}">
                    <i data-lucide="copy" class="w-4 h-4"></i>
                </button>
                <button type="button" class="px-3 py-2 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/60 text-red-600 dark:text-red-400 rounded-xl font-bold transition" title="${this.esc(this.getT('task_delete'))}" data-task-action="delete-task" data-col-id="${this.esc(col.id)}" data-task-id="${this.esc(taskId)}">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>` : ''}
            </div>
        `;

        this._syncModalHeaderToggle();
        this._renderModalPrio();
        this._renderModalTags();
        this._renderModalSubtasks();

        modal.classList.remove('hidden');

        const titleInput = this._byId('task-edit-title');
        if (titleInput) {
            titleInput.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && !ev.isComposing) {
                    ev.preventDefault();
                    this.saveTask(col.id, taskId);
                }
            });
            setTimeout(() => { try { titleInput.focus({ preventScroll: true }); } catch (_) {} }, 30);
        }
        const tagInput = this._byId('task-edit-tag-input');
        if (tagInput) {
            tagInput.addEventListener('keydown', (ev) => {
                if ((ev.key === 'Enter' || ev.key === ',') && !ev.isComposing) {
                    ev.preventDefault();
                    this._commitModalTagInput();
                }
            });
        }
        const subInput = this._byId('task-edit-subtask-input');
        if (subInput) {
            subInput.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && !ev.isComposing) {
                    ev.preventDefault();
                    this._commitModalSubtaskInput();
                }
            });
        }
        this._refreshIcons();
    },

    closeTaskModal() {
        this._modalDraft = null;
        this._syncModalHeaderToggle();
        const modal = this._byId('task-detail-modal');
        if (modal) modal.classList.add('hidden');
    },

    saveTask(colId, taskId) {
        const titleEl = this._byId('task-edit-title');
        if (!titleEl) return;
        const title = titleEl.value.trim();
        if (!title) return window.UI.showToast(this.getT('task_title_required', 'Title is required'), 'alert-circle');

        // Commit any unsubmitted tag/subtask text still typed in the inputs
        this._commitModalTagInput();
        this._commitModalSubtaskInput();

        const descEl = this._byId('task-edit-desc');
        const deadlineEl = this._byId('task-edit-deadline');
        const colSelectEl = this._byId('task-edit-column');
        const projSelectEl = this._byId('task-edit-project');
        const desc = descEl ? descEl.value : '';
        const deadline = deadlineEl ? deadlineEl.value : '';

        const { project, col, task } = this._findProjectAndColumn(colId, taskId || null);
        if (!project || !col) return;

        const targetProjectId = (projSelectEl && projSelectEl.value) ? projSelectEl.value : project.id;
        const targetProject = this.state.projects.find(p => String(p.id) === String(targetProjectId)) || project;
        if (!targetProject.columns || targetProject.columns.length === 0) {
            targetProject.columns = this.getDefaultColumns();
        }

        let targetCol = col;
        if (targetProject !== project) {
            const draftDone = this._modalDraft ? !!this._modalDraft.done : false;
            targetCol = (draftDone && targetProject.columns.find(c => this.isDoneColumn(c, targetProject)))
                || targetProject.columns.find(c => !this.isDoneColumn(c, targetProject))
                || targetProject.columns[0];
        } else {
            const targetColId = (colSelectEl && colSelectEl.value) ? colSelectEl.value : col.id;
            targetCol = project.columns.find(c => String(c.id) === String(targetColId)) || col;
        }

        const draft = this._modalDraft || { priority: 'none', tags: [], subtasks: [], done: false };
        let finalDone = !!draft.done;
        if (targetCol !== col) {
            if (this.isDoneColumn(targetCol, targetProject)) finalDone = true;
            else if (this.isDoneColumn(col, project)) finalDone = false;
        } else if (this.isDoneColumn(targetCol, targetProject) && !finalDone && targetProject.columns.length > 1) {
            // Reopened inside a Done column -> move back to first active column automatically
            const todoCol = targetProject.columns.find(c => !this.isDoneColumn(c, targetProject));
            if (todoCol) targetCol = todoCol;
        }

        const completedAt = finalDone ? ((task && task.completedAt) || new Date().toISOString()) : '';

        if (taskId) {
            if (!task) return;
            task.title = title;
            task.desc = desc;
            task.deadline = deadline;
            task.priority = draft.priority || 'none';
            task.tags = [...draft.tags];
            task.subtasks = draft.subtasks.map(s => ({ ...s }));
            task.done = finalDone;
            task.completedAt = completedAt;
            if (targetCol !== col) {
                col.tasks = col.tasks.filter(t => t.id !== task.id);
                targetCol.tasks.push(task);
            }
        } else {
            targetCol.tasks.push({
                id: this._uid('t'),
                title,
                desc,
                deadline,
                priority: draft.priority || 'none',
                tags: [...draft.tags],
                subtasks: draft.subtasks.map(s => ({ ...s })),
                done: finalDone,
                completedAt
            });
        }

        this.closeTaskModal();
        this.renderProjects();
        this.renderToolbar();
        this.renderBoard();
        this.saveState();
    },

    duplicateTask(colId, taskId) {
        const { col, task } = this._findProjectAndColumn(colId, taskId);
        if (!col || !task) return;
        const copy = this.normalizeTask(task);
        copy.id = this._uid('t');
        copy.title = `${copy.title} (2)`;
        copy.done = false;
        copy.completedAt = '';
        copy.subtasks = copy.subtasks.map(s => ({ ...s, id: this._uid('s'), done: false }));
        const idx = col.tasks.findIndex(t => t.id === task.id);
        col.tasks.splice(idx >= 0 ? idx + 1 : col.tasks.length, 0, copy);
        this.closeTaskModal();
        this.renderProjects();
        this.renderBoard();
        this.saveState();
    },

    async deleteTask(colId, taskId) {
        if (!(await window.UI.confirm(this.getT('task_confirm_delete', 'Delete this task?')))) return;
        const { col, task } = this._findProjectAndColumn(colId, taskId);
        if (!col || !task) return;
        col.tasks = col.tasks.filter(t => t.id !== task.id);

        this.closeTaskModal();
        this.renderProjects();
        this.renderToolbar();
        this.renderBoard();
        this.saveState();
    },

    async deleteColumn(colId) {
        if (!(await window.UI.confirm(this.getT('task_confirm_delete_column', 'Delete column with all tasks?')))) return;
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return;
        project.columns = project.columns.filter(c => c.id !== colId);
        this.renderProjects();
        this.renderToolbar();
        this.renderBoard();
        this.saveState();
    },

    async deleteProject(id) {
        if (!(await window.UI.confirm(this.getT('task_confirm_delete_project', 'Delete project with all tasks?')))) return;
        this.state.projects = this.state.projects.filter(p => p.id !== id);
        if (this.state.activeProjectId === id) {
            this.state.activeProjectId = this.state.projects.length > 0 ? this.state.projects[0].id : null;
        }
        this.selectProject(this.state.activeProjectId);
        this.saveState();
    },

    // ---------- AI Actions (Task Breakdown & Project Planner) ----------

    /** Strip Aru chat protocol tags (suggestions, tool cards, task/fit/memory/artifact tags) from modal AI outputs. */
    _stripChatTags(raw) {
        return String(raw || '')
            .replace(/\[\[\s*ARU_SUGGESTIONS\s*\]\][\s\S]*?\[\[\s*\/\s*ARU_SUGGESTIONS\s*\]\]/gi, '')
            .replace(/\[\[\s*ARU_SUGGESTIONS\s*\]\][\s\S]*$/gi, '')
            .replace(/\[\[\s*ARU_ARTIFACT\b[\s\S]*?\[\[?\s*\/ARU_ARTIFACT\s*\]?\]/gi, '')
            .replace(/\[\[\s*(?:TOOL|TASK|FIT|MEMORY|CHAPTER|SKILL|CANVAS)\s*:[\s\S]*?\]\]/gi, '')
            .replace(/\[\[\s*\/?\s*ARU_[A-Z0-9_]+\s*\]\]/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    },

    _parseAiSubtasks(raw) {
        let text = this._stripChatTags(raw);
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const bracketMatch = /\[[\s\S]*\]/.exec(text);
        let list = null;
        if (bracketMatch) {
            try {
                const parsed = JSON.parse(bracketMatch[0]);
                if (Array.isArray(parsed)) list = parsed;
            } catch (_) { list = null; }
        }
        if (!list) {
            list = text.split(/\r?\n/)
                .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
                .filter(Boolean);
        }
        return list
            .map(s => (typeof s === 'string' ? s : (s && s.title ? String(s.title) : '')).trim())
            .filter(s => s.length >= 2 && s.length <= 160)
            .slice(0, 6);
    },

    async aiBreakDownTask() {
        if (this.ui.aiBusy || !this._modalDraft) return;
        const titleEl = this._byId('task-edit-title');
        const descEl = this._byId('task-edit-desc');
        const title = titleEl ? titleEl.value.trim() : '';
        const desc = descEl ? descEl.value.trim() : '';
        if (!title) {
            window.UI?.showToast?.(this.getT('task_ai_empty_title', 'Enter a task title first.'), 'alert-circle');
            return;
        }
        const safety = window.Safety;
        if (safety && typeof safety.isChildMode === 'function' && safety.isChildMode()) {
            const hit = typeof safety.checkInput === 'function' ? safety.checkInput(`${title} ${desc}`) : null;
            if (hit) {
                window.UI?.showToast?.(this.getT('task_ai_blocked_child', safety.getRefusal(hit)), 'shield');
                return;
            }
        }
        const llm = window.app && window.app.llm;
        if (!llm || (llm.llmType !== 'custom' && !llm.apiKey)) {
            window.UI?.showToast?.(this.getT('task_ai_need_key', 'Configure API key first.'), 'alert-circle');
            return;
        }

        const btn = this._byId('btn-task-ai-breakdown');
        this.ui.aiBusy = true;
        if (btn) btn.disabled = true;

        try {
            const lang = (window.aruState && window.aruState.lang) || 'ru';
            const sys = window.app && typeof window.app.updateSystemPrompt === 'function'
                ? window.app.updateSystemPrompt({ type: 'plugin', pluginId: 'task', isPrivate: false })
                : null;
            const prompt = `Break the following task into 3 to 6 short, actionable checklist subtasks in language "${lang}". Return ONLY a valid JSON array of concise strings, with no extra prose or tags.\nTask: ${title}${desc ? `\nDetails: ${desc}` : ''}`;
            const raw = await llm.sendMessage([], prompt, sys && sys.prompt ? { systemInstruction: sys.prompt, ageMode: sys.mode } : {});
            const steps = this._parseAiSubtasks(raw);
            if (!steps.length) throw new Error('No subtasks parsed');
            for (const step of steps) {
                if (!this._modalDraft.subtasks.some(s => s.title.toLowerCase() === step.toLowerCase())) {
                    this._modalDraft.subtasks.push({ id: this._uid('s'), title: step, done: false });
                }
            }
            this._renderModalSubtasks();
            window.UI?.showToast?.(this.getT('task_ai_apply', 'Subtasks added'), 'sparkles');
        } catch (err) {
            console.error('TaskPlugin: aiBreakDownTask failed', err);
            window.UI?.showToast?.(this.getT('task_ai_error', 'AI request failed.'), 'alert-circle');
        } finally {
            this.ui.aiBusy = false;
            if (btn) btn.disabled = false;
        }
    },

    async openAiPlannerModal() {
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return;
        const llm = window.app && window.app.llm;
        if (!llm || (llm.llmType !== 'custom' && !llm.apiKey)) {
            window.UI?.showToast?.(this.getT('task_ai_need_key', 'Configure API key first.'), 'alert-circle');
            return;
        }

        this._modalDraft = null;
        this._syncModalHeaderToggle();
        const modal = this._byId('task-detail-modal');
        const content = this._byId('task-modal-content');
        const titleHead = this._byId('task-modal-title');
        if (!modal || !content) return;
        if (titleHead) titleHead.textContent = this.getT('task_ai_plan_title', 'Smart Project Plan');

        content.innerHTML = `
            <p class="text-xs text-gray-500 m-0">${this.esc(this.getT('task_ai_plan_hint', 'Aru is analyzing your tasks...'))}</p>
            <div class="flex items-center gap-2.5 py-6 justify-center text-sm font-medium text-purple-600 dark:text-purple-300">
                <i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>
                <span>${this.esc(this.getT('task_ai_loading', 'Aru is thinking...'))}</span>
            </div>`;
        modal.classList.remove('hidden');
        this._refreshIcons();

        try {
            const activeTasks = [];
            for (const col of (project.columns || [])) {
                for (const t of (col.tasks || [])) {
                    if (this.isTaskDone(t, col, project)) continue;
                    const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
                    activeTasks.push(`- [${col.title}] "${t.title}"${t.priority && t.priority !== 'none' ? ` [prio:${t.priority}]` : ''}${t.deadline ? ` [due:${t.deadline}]` : ''}${subs.length ? ` [sub:${subs.filter(s => s.done).length}/${subs.length}]` : ''}`);
                }
            }
            const lang = (window.aruState && window.aruState.lang) || 'ru';
            const sys = window.app && typeof window.app.updateSystemPrompt === 'function'
                ? window.app.updateSystemPrompt({ type: 'plugin', pluginId: 'task', isPrivate: false })
                : null;
            const prompt = `Review active tasks in project "${project.name}" and write a short, practical plan in language "${lang}" (1. Top 3 priorities for today, 2. Overdue triage if any, 3. Quick next wins). Output ONLY clean Markdown prose/lists. Do NOT include any [[TOOL:...]], [[TASK:...]], [[ARU_SUGGESTIONS]], or other [[...]] system tags.\nTasks:\n${activeTasks.slice(0, 40).join('\n') || '(no active tasks)'}`;
            const raw = await llm.sendMessage([], prompt, sys && sys.prompt ? { systemInstruction: sys.prompt, ageMode: sys.mode } : {});
            const cleaned = this._stripChatTags(raw);
            const rendered = (window.UI && typeof window.UI.parseMarkdownWithMath === 'function')
                ? window.UI.parseMarkdownWithMath(cleaned)
                : `<pre class="whitespace-pre-wrap text-xs">${this.esc(cleaned)}</pre>`;
            if (!this._byId('task-detail-modal') || this._byId('task-detail-modal').classList.contains('hidden')) return;
            content.innerHTML = `
                <div class="prose prose-sm dark:prose-invert max-w-none break-words">${rendered}</div>
                <div class="flex justify-end pt-2 border-t border-gray-100 dark:border-gray-700">
                    <button type="button" class="btn-task btn-task-outline" data-task-action="close-modal">${this.esc(this.getT('task_cancel', 'Close'))}</button>
                </div>`;
        } catch (err) {
            console.error('TaskPlugin: openAiPlannerModal failed', err);
            content.innerHTML = `
                <p class="text-xs text-red-500 m-0">${this.esc(this.getT('task_ai_error', 'AI request failed.'))}</p>
                <div class="flex justify-end pt-2">
                    <button type="button" class="btn-task btn-task-outline" data-task-action="close-modal">${this.esc(this.getT('task_cancel', 'Close'))}</button>
                </div>`;
        }
    },

    // ---------- Backup: Export (Markdown / JSON) & Import ----------

    openBackupModal() {
        this._modalDraft = null;
        this._syncModalHeaderToggle();
        const modal = this._byId('task-detail-modal');
        const content = this._byId('task-modal-content');
        const titleHead = this._byId('task-modal-title');
        if (!modal || !content) return;
        if (titleHead) titleHead.textContent = this.getT('task_export_import', 'Backup');
        const hasProject = !!this.state.projects.find(p => p.id === this.state.activeProjectId);

        content.innerHTML = `
            <div class="flex flex-col gap-2.5">
                <button type="button" class="btn-task btn-task-outline flex items-center gap-2 justify-start" data-task-action="export-md" ${hasProject ? '' : 'disabled'}>
                    <i data-lucide="file-text" class="w-4 h-4"></i>${this.esc(this.getT('task_export_md', 'Export Markdown'))}
                </button>
                <button type="button" class="btn-task btn-task-outline flex items-center gap-2 justify-start" data-task-action="export-json">
                    <i data-lucide="download" class="w-4 h-4"></i>${this.esc(this.getT('task_export_json', 'Export JSON'))}
                </button>
                <button type="button" class="btn-task btn-task-primary flex items-center gap-2 justify-start" data-task-action="trigger-import">
                    <i data-lucide="upload" class="w-4 h-4"></i>${this.esc(this.getT('task_import_json', 'Import JSON'))}
                </button>
            </div>
            <div class="flex justify-end pt-2 border-t border-gray-100 dark:border-gray-700">
                <button type="button" class="btn-task btn-task-outline" data-task-action="close-modal">${this.esc(this.getT('task_cancel', 'Cancel'))}</button>
            </div>`;
        modal.classList.remove('hidden');
        this._refreshIcons();
    },

    _downloadFile(name, content, mime) {
        const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1200);
    },

    buildMarkdownExport(project) {
        const p = project || this.state.projects.find(item => item.id === this.state.activeProjectId);
        if (!p) return '';
        const lines = [`# ${p.name}`, ''];
        for (const col of (p.columns || [])) {
            lines.push(`## ${col.title}`);
            if (!col.tasks || col.tasks.length === 0) {
                lines.push('_—_');
            } else {
                for (const t of col.tasks) {
                    const mark = this.isTaskDone(t, col, p) ? 'x' : ' ';
                    const tags = Array.isArray(t.tags) && t.tags.length ? ` (${t.tags.map(x => `#${x}`).join(' ')})` : '';
                    const dl = t.deadline ? ` [${t.deadline}]` : '';
                    lines.push(`- [${mark}] ${t.title}${dl}${tags}`);
                    if (t.desc) lines.push(`  > ${t.desc.replace(/\r?\n/g, ' ')}`);
                    if (Array.isArray(t.subtasks)) {
                        for (const s of t.subtasks) {
                            lines.push(`  - [${s.done ? 'x' : ' '}] ${s.title}`);
                        }
                    }
                }
            }
            lines.push('');
        }
        return lines.join('\n');
    },

    exportMarkdown() {
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return;
        const safeName = String(project.name || 'tasks').toLowerCase().replace(/[^a-z0-9а-яё\-]+/gi, '-').replace(/^-|-$/g, '') || 'tasks';
        this._downloadFile(`aru-tasks-${safeName}.md`, this.buildMarkdownExport(project), 'text/markdown;charset=utf-8');
        this.closeTaskModal();
        window.UI?.showToast?.(this.getT('task_export_ok', 'Exported'), 'check');
    },

    exportJson() {
        const payload = {
            app: 'aru-tasks',
            version: 2,
            exported_at: new Date().toISOString(),
            activeProjectId: this.state.activeProjectId,
            projects: JSON.parse(JSON.stringify(this.state.projects))
        };
        this._downloadFile('aru-tasks-backup.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
        this.closeTaskModal();
        window.UI?.showToast?.(this.getT('task_export_ok', 'Exported'), 'check');
    },

    async importJsonFile(file) {
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.projects)) {
                throw new Error('Invalid tasks backup');
            }
            if (!(await window.UI.confirm(this.getT('task_import_confirm', 'Replace current boards?')))) return;
            const projects = parsed.projects.filter(p => p && typeof p.name === 'string').map(p => ({
                id: String(p.id || this._uid('p')),
                name: p.name,
                color: this.PROJECT_COLORS.includes(p.color) ? p.color : 'violet',
                columns: Array.isArray(p.columns) ? p.columns.map(c => ({
                    id: String(c.id || this._uid('c')),
                    title: String(c.title || 'Column'),
                    tasks: Array.isArray(c.tasks) ? c.tasks.map(t => this.normalizeTask(t)) : []
                })) : this.getDefaultColumns()
            }));
            this.state.projects = projects;
            const activeExists = projects.some(p => p.id === parsed.activeProjectId);
            this.state.activeProjectId = activeExists ? parsed.activeProjectId : (projects[0] ? projects[0].id : null);
            this.closeTaskModal();
            this.selectProject(this.state.activeProjectId);
            this.saveState();
            window.UI?.showToast?.(this.getT('task_import_ok', 'Imported'), 'check');
        } catch (err) {
            console.warn('TaskPlugin: import failed', err);
            window.UI?.showToast?.(this.getT('task_import_error', 'Invalid backup file'), 'alert-circle');
        }
    },

    toggleSidebar() {
        const root = this._rootEl();
        if (!root) return;
        this.state.isSidebarOpen = !this.state.isSidebarOpen;
        this.syncSidebarDOM();
    },

    saveState() {
        if (!this._dbReady) {
            if (window.DB && window.DB.db) {
                this._dbReady = true;
            } else {
                console.warn('Task Plugin: save skipped — DB not initialized yet');
                return;
            }
        }

        const projectsClean = JSON.parse(JSON.stringify(this.state.projects, (key, value) => {
            if (value && value.nodeType) return undefined;
            return value;
        }));
        const stateToSave = {
            projects: projectsClean,
            activeProjectId: this.state.activeProjectId
        };

        try {
            if (window.DB && window.DB.db) {
                const ok = window.DB.savePluginData('task', stateToSave);
                if (ok !== false) {
                    try { localStorage.removeItem('task_plugin_pending'); } catch (_) {}
                } else {
                    try { localStorage.setItem('task_plugin_pending', JSON.stringify(stateToSave)); } catch (_) {}
                }
            } else {
                try { localStorage.setItem('task_plugin_pending', JSON.stringify(stateToSave)); } catch (_) {}
            }
        } catch (e) {
            console.error('Task Plugin: unexpected saveState error', e);
            try { localStorage.setItem('task_plugin_pending', JSON.stringify(stateToSave)); } catch (_) {}
        }

        window.dispatchEvent(new CustomEvent('task-plugin-update', { detail: this.state }));
    }
};

TaskPlugin.init();
