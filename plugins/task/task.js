/*
---ARU-LAB.SPACE---ALMATY---2026---
Task Manager Plugin
---chat.aru-lab.space---PWA---
*/

window.TaskPlugin = {
    state: {
        projects: [],
        activeProjectId: null,
        isSidebarOpen: true
    },
    sortables: [], // Runtime only, not in state
    // This script runs before js/app.js (and therefore before DB.init()), so
    // persistence must wait until the real database has been read at least once.
    _dbReady: false,
    _domMounted: false,
    _globalListenersBound: false,

    bindGlobalListeners() {
        if (this._globalListenersBound) return;
        this._globalListenersBound = true;
        window.addEventListener('aru-db-initialized', () => {
            if (!(window.DB && window.DB.db)) return;
            this._dbReady = true;
            this.loadFromDB();
            if (this._domMounted && document.getElementById('task-plugin-root')) {
                this.selectProject(this.state.activeProjectId);
                this._refreshIcons();
            }
        });
        window.addEventListener('aru-sync-applied', () => {
            if (!(window.DB && window.DB.db)) return;
            this.loadFromDB();
            if (this._domMounted && document.getElementById('task-plugin-root')) {
                this.selectProject(this.state.activeProjectId);
                this._refreshIcons();
            }
        });
        window.addEventListener('aru-lang-changed', () => {
            if (this._domMounted && document.getElementById('task-plugin-root')) {
                this.applyI18n();
                this.renderProjects();
                this.renderBoard();
                this._refreshIcons();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (document.querySelector('#aru-dialog-host .aru-dialog-root')) return;
            const modal = document.getElementById('task-detail-modal');
            if (modal && !modal.classList.contains('hidden')) {
                e.stopPropagation();
                this.closeTaskModal();
            }
        });
    },

    bindDomListeners(root) {
        if (!root || root._taskDomBound) return;
        root._taskDomBound = true;
        root.addEventListener('click', (e) => {
            const modal = document.getElementById('task-detail-modal');
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
                case 'select-project':
                    this.selectProject(projectId);
                    if (window.innerWidth <= 768 && this.state.isSidebarOpen) {
                        this.state.isSidebarOpen = false;
                        this.syncSidebarDOM();
                    }
                    break;
                case 'rename-project':
                    e.stopPropagation();
                    this.renameProject(projectId);
                    break;
                case 'delete-project':
                    e.stopPropagation();
                    this.deleteProject(projectId);
                    break;
                case 'rename-column':
                    e.stopPropagation();
                    this.renameColumn(colId);
                    break;
                case 'delete-column':
                    e.stopPropagation();
                    this.deleteColumn(colId);
                    break;
                case 'add-column':
                    e.stopPropagation();
                    this.addColumn();
                    break;
                case 'add-task':
                    e.stopPropagation();
                    this.addTask(colId);
                    break;
                case 'open-task':
                    this.openTaskModal(colId, taskId || null);
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
    },

    _refreshIcons() {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    },

    syncSidebarDOM() {
        const root = document.getElementById('task-plugin-root');
        const backdrop = document.getElementById('task-sidebar-backdrop');
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
        const root = document.getElementById('task-plugin-root');
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
        if (!this._domMounted || !document.getElementById('task-plugin-root')) {
            this.init();
            return;
        }
        this.applyI18n();
        this.renderProjects();
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

    // Local-time parse: date-only values default to 12:00 so they are not
    // shifted by UTC interpretation (new Date('2026-10-08') => 05:00 in UTC+5).
    parseDeadline(raw) {
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(raw || ''));
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0);
    },

    formatDeadline(raw) {
        const d = this.parseDeadline(raw);
        return d ? d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '';
    },

    toInputValue(raw) {
        const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(raw || ''));
        if (!m) return '';
        return m[1] + 'T' + (m[2] || '12') + ':' + (m[3] || '00');
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
        const root = document.getElementById('task-plugin-root');
        if (!root) return;
        root.querySelectorAll('[data-task-i18n]').forEach(el => {
            const key = el.getAttribute('data-task-i18n');
            el.innerText = this.getT(key, el.innerText.trim() || undefined);
        });
        root.querySelectorAll('[data-task-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-task-i18n-title');
            el.setAttribute('title', this.getT(key, el.getAttribute('title') || undefined));
        });
    },

    _seedStarterProject() {
        const columns = this.getDefaultColumns();
        columns[0].tasks.push({
            id: this._uid('t'),
            title: this.getT('task_seed_task', 'Explore Aru'),
            desc: this.getT('task_seed_task_desc', 'Try opening the library and setting a custom model.'),
            deadline: ''
        });
        this.state.projects = [
            {
                id: this._uid('p'),
                name: this.getT('task_seed_project', 'My First Project'),
                columns
            }
        ];
        this.state.activeProjectId = this.state.projects[0].id;
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

    _findProjectAndColumn(colId, taskId) {
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return { project: null, col: null, task: null };
        let col = colId ? project.columns.find(c => c.id === colId) : null;
        if (!taskId) return { project, col, task: null };
        let task = col ? col.tasks.find(t => t.id === taskId) : null;
        if (!task) {
            for (const candidate of project.columns) {
                const found = candidate.tasks.find(t => t.id === taskId);
                if (found) {
                    col = candidate;
                    task = found;
                    break;
                }
            }
        }
        return { project, col, task };
    },

    async addProject() {
        const raw = await window.UI.prompt(this.getT('task_new_project') + ':');
        const name = raw ? raw.trim() : '';
        if (!name) return;

        const project = {
            id: this._uid('p'),
            name,
            columns: this.getDefaultColumns()
        };

        this.state.projects.push(project);
        this.renderProjects();
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

    selectProject(id) {
        this.state.activeProjectId = id;
        const project = this.state.projects.find(p => p.id === id);
        const nameEl = document.getElementById('active-project-name');
        if (nameEl) nameEl.innerText = project ? project.name : this.getT('plugin_task_name', 'Task Manager');

        const addColBtn = document.getElementById('btn-add-column');
        if (addColBtn) addColBtn.disabled = !project;

        this.renderProjects();
        this.renderBoard();
    },

    renderProjects() {
        const list = document.getElementById('task-projects-list');
        if (!list) return;

        list.innerHTML = this.state.projects.map(p => `
            <div class="project-node group ${p.id === this.state.activeProjectId ? 'active' : ''}" data-task-action="select-project" data-project-id="${this.esc(p.id)}">
                <i data-lucide="${p.id === this.state.activeProjectId ? 'folder-open' : 'folder'}" class="w-4 h-4 shrink-0"></i>
                <span class="flex-1 truncate">${this.esc(p.name)}</span>
                <div class="project-actions shrink-0">
                    <button type="button" class="p-1 hover:text-purple-500 transition" title="${this.esc(this.getT('task_rename_project', 'Rename project'))}" data-task-action="rename-project" data-project-id="${this.esc(p.id)}">
                        <i data-lucide="pencil" class="w-3 h-3"></i>
                    </button>
                    <button type="button" class="p-1 hover:text-red-500 transition" title="${this.esc(this.getT('task_delete', 'Delete'))}" data-task-action="delete-project" data-project-id="${this.esc(p.id)}">
                        <i data-lucide="trash-2" class="w-3 h-3"></i>
                    </button>
                </div>
            </div>
        `).join('');

        this._refreshIcons();
    },

    renderDeadlineBadge(t) {
        if (!t.deadline) return '';
        const d = this.parseDeadline(t.deadline);
        if (!d) return '';
        const overdue = d.getTime() < Date.now();
        const cls = overdue
            ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
            : 'bg-purple-50 dark:bg-purple-900/25 text-purple-600 dark:text-purple-300';
        return `
            <div class="mt-3 py-1 px-2 rounded-lg text-[10px] font-bold inline-flex items-center gap-1.5 ${cls}">
                <i data-lucide="clock" class="w-3 h-3"></i>
                ${this.esc(this.formatDeadline(t.deadline))}
            </div>`;
    },

    renderBoard() {
        const container = document.getElementById('board-columns');
        if (!container) return;

        // Destroy old sortables before DOM swap
        this.sortables.forEach(s => { try { s.destroy(); } catch (_) {} });
        this.sortables = [];

        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) {
            container.innerHTML = `
                <div class="flex-1 flex flex-col items-center justify-center text-gray-400 opacity-75 p-8 text-center gap-4">
                    <i data-lucide="clipboard-check" class="w-16 h-16 opacity-60"></i>
                    <p>${this.esc(this.getT('task_empty_board'))}</p>
                </div>`;
            this._refreshIcons();
            return;
        }

        if (!project.columns || project.columns.length === 0) {
            container.innerHTML = `
                <div class="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center gap-4">
                    <i data-lucide="columns" class="w-12 h-12 opacity-60"></i>
                    <p class="text-sm">${this.esc(this.getT('task_empty_columns', 'No columns yet. Add one to organize tasks.'))}</p>
                    <button type="button" class="btn-task btn-task-primary flex items-center gap-2" data-task-action="add-column">
                        <i data-lucide="plus" class="w-4 h-4"></i>
                        ${this.esc(this.getT('task_add_first_column', 'Add Column'))}
                    </button>
                </div>`;
            this._refreshIcons();
            return;
        }

        container.innerHTML = project.columns.map(col => `
            <div class="task-column" data-col-id="${this.esc(col.id)}">
                <div class="column-header">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="font-bold text-sm tracking-tight truncate">${this.esc(col.title)}</span>
                        <span class="column-count" data-col-count="${this.esc(col.id)}">${col.tasks.length}</span>
                    </div>
                    <div class="flex items-center gap-0.5 shrink-0">
                        <button type="button" class="p-1.5 text-gray-400 hover:text-purple-500 transition rounded-lg" title="${this.esc(this.getT('task_rename_column', 'Rename column'))}" data-task-action="rename-column" data-col-id="${this.esc(col.id)}">
                            <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
                        </button>
                        <button type="button" class="p-1.5 text-gray-400 hover:text-red-500 transition rounded-lg" title="${this.esc(this.getT('task_delete', 'Delete'))}" data-task-action="delete-column" data-col-id="${this.esc(col.id)}">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </div>

                <div class="cards-list flex-1 p-3 overflow-y-auto min-h-[50px] space-y-3" id="list-${this.esc(col.id)}" data-list-col-id="${this.esc(col.id)}">
                    ${col.tasks.map(t => `
                        <div class="task-card" data-id="${this.esc(t.id)}" data-task-action="open-task" data-col-id="${this.esc(col.id)}" data-task-id="${this.esc(t.id)}">
                            <div class="flex justify-between items-start gap-2">
                                <h4 class="font-bold text-sm text-gray-800 dark:text-gray-100 break-words">${this.esc(t.title)}</h4>
                            </div>
                            ${t.desc ? `<p class="text-[11px] text-gray-500 dark:text-gray-400 mt-2 line-clamp-3 break-words">${this.esc(t.desc)}</p>` : ''}
                            ${this.renderDeadlineBadge(t)}
                        </div>
                    `).join('')}
                </div>

                <button type="button" class="task-col-add-btn" data-task-action="add-task" data-col-id="${this.esc(col.id)}">
                    <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                    ${this.esc(this.getT('task_new_card'))}
                </button>
            </div>
        `).join('');

        if (typeof Sortable !== 'undefined') {
            project.columns.forEach(col => {
                const listEl = document.getElementById(`list-${col.id}`);
                if (listEl) {
                    const s = new Sortable(listEl, {
                        group: 'tasks',
                        animation: 150,
                        delay: 250,
                        delayOnTouchOnly: true,
                        touchStartThreshold: 5,
                        filter: 'button',
                        preventOnFilter: false,
                        ghostClass: 'task-ghost',
                        onEnd: (evt) => {
                            this.handleTaskMove(evt);
                        }
                    });
                    this.sortables.push(s);
                }
            });
        }

        this._refreshIcons();
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

        const fromBadge = document.querySelector(`[data-col-count="${fromColId}"]`);
        if (fromBadge) fromBadge.textContent = String(fromCol.tasks.length);
        const toBadge = document.querySelector(`[data-col-count="${toColId}"]`);
        if (toBadge) toBadge.textContent = String(toCol.tasks.length);

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

    addTask(colId) {
        this.openTaskModal(colId);
    },

    openTaskModal(colId, taskId = null) {
        const { project, col, task } = this._findProjectAndColumn(colId, taskId);
        if (!project || !col) return;
        const item = task || { title: '', desc: '', deadline: '' };

        const modal = document.getElementById('task-detail-modal');
        const content = document.getElementById('task-modal-content');
        if (!modal || !content) return;

        const colOptions = project.columns.map(c =>
            `<option value="${this.esc(c.id)}" ${c.id === col.id ? 'selected' : ''}>${this.esc(c.title)}</option>`
        ).join('');

        content.innerHTML = `
            <div class="space-y-4">
                <div class="task-modal-field">
                    <label class="task-modal-label" for="task-edit-title">${this.esc(this.getT('task_title'))}</label>
                    <input type="text" id="task-edit-title" class="task-modal-input" value="${this.esc(item.title)}" placeholder="${this.esc(this.getT('task_placeholder_title', 'What needs to be done?'))}">
                </div>
                <div class="task-modal-field">
                    <label class="task-modal-label" for="task-edit-desc">${this.esc(this.getT('task_desc'))}</label>
                    <textarea id="task-edit-desc" class="task-modal-input min-h-[100px] resize-none" placeholder="${this.esc(this.getT('task_placeholder_desc', 'Add more details...'))}">${this.esc(item.desc)}</textarea>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="task-modal-field">
                        <label class="task-modal-label" for="task-edit-deadline">${this.esc(this.getT('task_deadline'))}</label>
                        <input type="datetime-local" id="task-edit-deadline" class="task-modal-input" value="${this.esc(this.toInputValue(item.deadline))}">
                    </div>
                    <div class="task-modal-field">
                        <label class="task-modal-label" for="task-edit-column">${this.esc(this.getT('task_column_label', 'Column'))}</label>
                        <select id="task-edit-column" class="task-modal-input">${colOptions}</select>
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
                    <button type="button" class="px-3.5 py-2 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/60 text-red-600 dark:text-red-400 rounded-xl font-bold transition" title="${this.esc(this.getT('task_delete'))}" data-task-action="delete-task" data-col-id="${this.esc(col.id)}" data-task-id="${this.esc(taskId)}">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>` : ''}
                </div>
            </div>
        `;

        modal.classList.remove('hidden');
        const titleInput = document.getElementById('task-edit-title');
        if (titleInput) {
            titleInput.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && !ev.isComposing) {
                    ev.preventDefault();
                    this.saveTask(col.id, taskId);
                }
            });
            setTimeout(() => { try { titleInput.focus({ preventScroll: true }); } catch (_) {} }, 30);
        }
        this._refreshIcons();
    },

    closeTaskModal() {
        const modal = document.getElementById('task-detail-modal');
        if (modal) modal.classList.add('hidden');
    },

    saveTask(colId, taskId) {
        const titleEl = document.getElementById('task-edit-title');
        if (!titleEl) return;
        const title = titleEl.value.trim();
        if (!title) return window.UI.showToast(this.getT('task_title_required', 'Title is required'), 'alert-circle');
        const descEl = document.getElementById('task-edit-desc');
        const deadlineEl = document.getElementById('task-edit-deadline');
        const colSelectEl = document.getElementById('task-edit-column');
        const desc = descEl ? descEl.value : '';
        const deadline = deadlineEl ? deadlineEl.value : '';

        const { project, col, task } = this._findProjectAndColumn(colId, taskId || null);
        if (!project || !col) return;

        const targetColId = (colSelectEl && colSelectEl.value) ? colSelectEl.value : col.id;
        const targetCol = project.columns.find(c => c.id === targetColId) || col;

        if (taskId) {
            if (!task) return;
            task.title = title;
            task.desc = desc;
            task.deadline = deadline;
            if (targetCol !== col) {
                col.tasks = col.tasks.filter(t => t.id !== task.id);
                targetCol.tasks.push(task);
            }
        } else {
            targetCol.tasks.push({
                id: this._uid('t'),
                title,
                desc,
                deadline
            });
        }

        this.closeTaskModal();
        this.renderBoard();
        this.saveState();
    },

    async deleteTask(colId, taskId) {
        if (!(await window.UI.confirm(this.getT('task_confirm_delete', 'Delete this task?')))) return;
        const { col, task } = this._findProjectAndColumn(colId, taskId);
        if (!col || !task) return;
        col.tasks = col.tasks.filter(t => t.id !== task.id);

        this.closeTaskModal();
        this.renderBoard();
        this.saveState();
    },

    async deleteColumn(colId) {
        if (!(await window.UI.confirm(this.getT('task_confirm_delete_column', 'Delete column with all tasks?')))) return;
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return;
        project.columns = project.columns.filter(c => c.id !== colId);
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

    toggleSidebar() {
        const root = document.getElementById('task-plugin-root');
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
                try {
                    window.DB.savePluginData('task', stateToSave);
                    if (typeof window.DB.save === 'function') window.DB.save();
                    try { localStorage.removeItem('task_plugin_pending'); } catch (_) {}
                } catch (e) {
                    console.error('Task Plugin: DB save failed', e);
                    try { localStorage.setItem('task_plugin_pending', JSON.stringify(stateToSave)); } catch (ee) {}
                }
            } else {
                try { localStorage.setItem('task_plugin_pending', JSON.stringify(stateToSave)); } catch (e) {}
            }
        } catch (e) {
            console.error('Task Plugin: unexpected saveState error', e);
        }

        window.dispatchEvent(new CustomEvent('task-plugin-update', { detail: this.state }));
    }
};

TaskPlugin.init();
