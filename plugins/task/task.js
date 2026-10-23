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

    init() {
        console.log("Task Plugin: Initialized");
        this._dbReady = !!(window.DB && window.DB.db);
        this.loadFromDB();
        this.applyI18n();
        this.selectProject(this.state.activeProjectId);
        const root = document.getElementById('task-plugin-root');
        if (root) root.classList.toggle('sidebar-collapsed', !this.state.isSidebarOpen);
        if (window.lucide) lucide.createIcons();

        if (!this._dbReady) {
            // One-shot: re-read state once the database reports it is ready,
            // otherwise seeded defaults would overwrite real stored data.
            window.addEventListener('aru-db-initialized', () => {
                if (!(window.DB && window.DB.db)) return;
                this._dbReady = true;
                this.loadFromDB();
                this.selectProject(this.state.activeProjectId);
                if (window.lucide) lucide.createIcons();
                console.log("Task Plugin: DB ready, state re-loaded", this.state);
            }, { once: true });
        }
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

    loadFromDB() {
        if (window.DB) {
            const saved = window.DB.getPluginData('task');
            if (saved && saved.projects) {
                this.state.projects = saved.projects;
                this.state.activeProjectId = saved.activeProjectId || (saved.projects.length > 0 ? saved.projects[0].id : null);
                const activeExists = saved.projects.some(p => p.id === this.state.activeProjectId);
                if (!activeExists) {
                    this.state.activeProjectId = saved.projects.length > 0 ? saved.projects[0].id : null;
                }
                console.log("Task Plugin: Loaded from DB", this.state);
                return;
            }
        }

        // Default if empty or DB not ready
        if (this.state.projects.length === 0) {
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
        }
    },

    addProject() {
        const name = prompt(this.getT('task_new_project') + ":");
        if (!name) return;

        const project = {
            id: this._uid('p'),
            name: name,
            columns: this.getDefaultColumns()
        };

        this.state.projects.push(project);
        this.renderProjects();
        this.selectProject(project.id);
        this.saveState();
    },

    selectProject(id) {
        this.state.activeProjectId = id;
        const project = this.state.projects.find(p => p.id === id);
        const nameEl = document.getElementById('active-project-name');
        if (nameEl) nameEl.innerText = project ? project.name : this.getT('task_empty_board');

        this.renderProjects();
        this.renderBoard();
    },

    renderProjects() {
        const list = document.getElementById('task-projects-list');
        if (!list) return; // Headless mode or UI not loaded

        list.innerHTML = this.state.projects.map(p => `
            <div class="project-node group ${p.id === this.state.activeProjectId ? 'active' : ''}" onclick="TaskPlugin.selectProject('${this.esc(p.id)}')">
                <i data-lucide="${p.id === this.state.activeProjectId ? 'folder-open' : 'folder'}" class="w-4 h-4"></i>
                <span class="flex-1 truncate">${this.esc(p.name)}</span>
                <button class="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition" onclick="event.stopPropagation(); TaskPlugin.deleteProject('${this.esc(p.id)}')">
                    <i data-lucide="trash-2" class="w-3 h-3"></i>
                </button>
            </div>
        `).join('');

        if (window.lucide) lucide.createIcons();
    },

    renderDeadlineBadge(t) {
        if (!t.deadline) return '';
        const d = this.parseDeadline(t.deadline);
        if (!d) return '';
        const overdue = d.getTime() < Date.now();
        const cls = overdue
            ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
            : 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400';
        return `
            <div class="mt-3 py-1 px-2 rounded-lg text-[10px] font-bold inline-flex items-center gap-1.5 ${cls}">
                <i data-lucide="clock" class="w-3 h-3"></i>
                ${this.esc(this.formatDeadline(t.deadline))}
            </div>`;
    },

    renderBoard() {
        const container = document.getElementById('board-columns');
        if (!container) return; // Headless mode or UI not loaded

        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) {
            container.innerHTML = `
                <div class="flex-1 flex flex-col items-center justify-center text-gray-400 opacity-50 p-8 text-center">
                    <i data-lucide="clipboard-check" class="w-16 h-16 mb-4"></i>
                    <p>${this.esc(this.getT('task_empty_board'))}</p>
                </div>`;
            if (window.lucide) lucide.createIcons();
            return;
        }

        // Destroy old sortables
        this.sortables.forEach(s => s.destroy());
        this.sortables = [];

        container.innerHTML = project.columns.map(col => `
            <div class="task-column flex flex-col h-full bg-gray-100 dark:bg-gray-900/40 rounded-2xl border border-gray-200 dark:border-gray-800" data-col-id="${this.esc(col.id)}">
                <div class="column-header p-4 flex justify-between items-center">
                    <span class="font-bold text-sm tracking-tight">${this.esc(col.title)}</span>
                    <button class="p-1.5 text-gray-400 hover:text-red-500 transition" onclick="TaskPlugin.deleteColumn('${this.esc(col.id)}')">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
                
                <div class="cards-list flex-1 p-3 overflow-y-auto min-h-[50px] space-y-3" id="list-${this.esc(col.id)}">
                    ${col.tasks.map(t => `
                        <div class="task-card bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm cursor-grab active:cursor-grabbing hover:border-purple-300 transition-colors" 
                             data-id="${this.esc(t.id)}" onclick="TaskPlugin.openTaskModal('${this.esc(col.id)}', '${this.esc(t.id)}')">
                            <div class="flex justify-between items-start gap-2">
                                <h4 class="font-bold text-sm text-gray-800 dark:text-gray-100">${this.esc(t.title)}</h4>
                            </div>
                            ${t.desc ? `<p class="text-[11px] text-gray-500 mt-2 line-clamp-3">${this.esc(t.desc)}</p>` : ''}
                            ${this.renderDeadlineBadge(t)}
                        </div>
                    `).join('')}
                </div>
                
                <button class="m-3 p-3 bg-white dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl text-xs font-bold text-gray-400 hover:text-purple-500 hover:border-purple-400 transition-all flex items-center justify-center gap-2" onclick="TaskPlugin.addTask('${this.esc(col.id)}')">
                    <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                    ${this.esc(this.getT('task_new_card'))}
                </button>
            </div>
        `).join('');

        // Initialize Sortable.js for each column
        project.columns.forEach(col => {
            const listEl = document.getElementById(`list-${col.id}`);
            if (listEl) {
                const s = new Sortable(listEl, {
                    group: 'tasks',
                    animation: 150,
                    ghostClass: 'opacity-20',
                    onEnd: (evt) => {
                        this.handleTaskMove(evt);
                    }
                });
                this.sortables.push(s);
            }
        });

        if (window.lucide) lucide.createIcons();
    },

    handleTaskMove(evt) {
        const fromColId = evt.from.id.replace('list-', '');
        const toColId = evt.to.id.replace('list-', '');
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

        this.saveState();
        console.log(`Task ${taskId} moved from ${fromColId} to ${toColId}`);
    },

    addColumn() {
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return;

        const title = prompt(this.getT('task_new_column') + ":");
        if (!title) return;

        project.columns.push({
            id: this._uid('c'),
            title: title,
            tasks: []
        });
        this.renderBoard();
        this.saveState();
    },

    addTask(colId) {
        this.openTaskModal(colId);
    },

    openTaskModal(colId, taskId = null) {
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return;
        const col = project.columns.find(c => c.id === colId);
        if (!col) return;
        const task = taskId ? col.tasks.find(t => t.id === taskId) : { title: '', desc: '', deadline: '' };
        if (!task) return;

        const modal = document.getElementById('task-detail-modal');
        const content = document.getElementById('task-modal-content');
        if (!modal || !content) return;

        content.innerHTML = `
            <div class="space-y-5">
                <div class="task-modal-field">
                    <label class="task-modal-label">${this.esc(this.getT('task_title'))}</label>
                    <input type="text" id="task-edit-title" class="task-modal-input" value="${this.esc(task.title)}" placeholder="${this.esc(this.getT('task_placeholder_title', 'What needs to be done?'))}">
                </div>
                <div class="task-modal-field">
                    <label class="task-modal-label">${this.esc(this.getT('task_desc'))}</label>
                    <textarea id="task-edit-desc" class="task-modal-input min-h-[100px] resize-none" placeholder="${this.esc(this.getT('task_placeholder_desc', 'Add more details...'))}">${this.esc(task.desc)}</textarea>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="task-modal-field">
                        <label class="task-modal-label">${this.esc(this.getT('task_deadline'))}</label>
                        <input type="datetime-local" id="task-edit-deadline" class="task-modal-input" value="${this.esc(this.toInputValue(task.deadline))}">
                    </div>
                </div>
                <div class="flex flex-wrap gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
                    <button onclick="TaskPlugin.saveTask('${this.esc(colId)}', ${taskId ? `'${this.esc(taskId)}'` : 'null'})" class="flex-1 py-2.5 bg-[#f97316] hover:bg-[#ea580c] text-white rounded-xl font-bold transition text-sm">
                        ${this.esc(taskId ? this.getT('task_save') : this.getT('task_create'))}
                    </button>
                    ${taskId ? `
                    <button onclick="TaskPlugin.deleteTask('${this.esc(colId)}', '${this.esc(taskId)}')" class="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl font-bold transition" title="${this.esc(this.getT('task_delete'))}">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>` : ''}
                </div>
            </div>
        `;

        modal.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    },

    closeTaskModal() {
        const modal = document.getElementById('task-detail-modal');
        if (modal) modal.classList.add('hidden');
    },

    saveTask(colId, taskId) {
        const titleEl = document.getElementById('task-edit-title');
        if (!titleEl) return;
        const title = titleEl.value.trim();
        if (!title) return alert(this.getT('task_title_required', 'Title is required'));
        const desc = document.getElementById('task-edit-desc').value;
        const deadline = document.getElementById('task-edit-deadline').value;

        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return;
        const col = project.columns.find(c => c.id === colId);
        if (!col) return;

        if (taskId) {
            const task = col.tasks.find(t => t.id === taskId);
            if (!task) return;
            task.title = title;
            task.desc = desc;
            task.deadline = deadline;
        } else {
            col.tasks.push({
                id: this._uid('t'),
                title: title,
                desc: desc,
                deadline: deadline
            });
        }

        this.closeTaskModal();
        this.renderBoard();
        this.saveState();
    },

    deleteTask(colId, taskId) {
        if (!confirm(this.getT('task_confirm_delete', 'Delete this task?'))) return;
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return;
        const col = project.columns.find(c => c.id === colId);
        if (!col) return;
        col.tasks = col.tasks.filter(t => t.id !== taskId);

        this.closeTaskModal();
        this.renderBoard();
        this.saveState();
    },

    deleteColumn(colId) {
        if (!confirm(this.getT('task_confirm_delete_column', 'Delete column with all tasks?'))) return;
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) return;
        project.columns = project.columns.filter(c => c.id !== colId);
        this.renderBoard();
        this.saveState();
    },

    deleteProject(id) {
        if (!confirm(this.getT('task_confirm_delete_project', 'Delete project with all tasks?'))) return;
        this.state.projects = this.state.projects.filter(p => p.id !== id);
        if (this.state.activeProjectId === id) {
            this.state.activeProjectId = this.state.projects.length > 0 ? this.state.projects[0].id : null;
        }
        this.selectProject(this.state.activeProjectId);
        this.saveState();
    },

    toggleSidebar() {
        const root = document.getElementById('task-plugin-root');
        const backdrop = document.getElementById('task-sidebar-backdrop');
        if (!root) return;

        this.state.isSidebarOpen = !this.state.isSidebarOpen;
        root.classList.toggle('sidebar-collapsed', !this.state.isSidebarOpen);

        if (backdrop) {
            backdrop.classList.toggle('hidden', !this.state.isSidebarOpen);
        }
    },

    saveState() {
        if (!this._dbReady) {
            // The wizard may create the DB later in this session (empty -> created),
            // so adopt it as soon as it truly exists; otherwise skip persistence.
            if (window.DB && window.DB.db) {
                this._dbReady = true;
                this.loadFromDB();
            } else {
                console.warn('Task Plugin: save skipped — DB not initialized yet');
                return;
            }
        }

        // Decouple state from any runtime references and strip potential circularities
        const projectsClean = JSON.parse(JSON.stringify(this.state.projects, (key, value) => {
            if (value && value.nodeType) return undefined; // Skip DOM nodes
            return value;
        }));
        const stateToSave = {
            projects: projectsClean,
            activeProjectId: this.state.activeProjectId
        };

        // If DB is ready — persist immediately and trigger DB.save()
        try {
            if (window.DB && window.DB.db) {
                try {
                    window.DB.savePluginData('task', stateToSave);
                    // ensure DB backend persists to storage/file
                    if (typeof window.DB.save === 'function') window.DB.save();
                    console.log("Task Plugin: Saved to DB");
                } catch (e) {
                    console.error("Task Plugin: DB save failed", e);
                    // Fallback: queue for later flush
                    try { localStorage.setItem('task_plugin_pending', JSON.stringify(stateToSave)); console.log('Task Plugin: queued pending save (DB error)'); } catch (ee) {}
                }
            } else {
                // DB not available yet — queue in localStorage for flush after DB init
                try {
                    localStorage.setItem('task_plugin_pending', JSON.stringify(stateToSave));
                    console.log('Task Plugin: queued pending save (DB not ready)');
                } catch (e) {
                    console.error('Task Plugin: failed to queue pending save', e);
                }
            }
        } catch (e) {
            console.error('Task Plugin: unexpected saveState error', e);
        }

        // Dispatch event for Aru to know state changed
        window.dispatchEvent(new CustomEvent('task-plugin-update', { detail: this.state }));
    }
};

TaskPlugin.init();
