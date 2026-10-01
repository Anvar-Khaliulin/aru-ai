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

    init() {
        console.log("Task Plugin: Initialized");
        this.loadFromDB();
        this.applyI18n();
        this.renderProjects();
        const root = document.getElementById('task-plugin-root');
        if (root) root.classList.toggle('sidebar-collapsed', !this.state.isSidebarOpen);
        if (window.lucide) lucide.createIcons();
    },

    applyI18n() {
        const root = document.getElementById('task-plugin-root');
        if (!root) return;
        root.querySelectorAll('[data-task-i18n]').forEach(el => {
            const key = el.getAttribute('data-task-i18n');
            el.innerText = this.getT(key);
        });
    },

    loadFromDB() {
        if (window.DB) {
            const saved = window.DB.getPluginData('task');
            if (saved && saved.projects) {
                this.state.projects = saved.projects;
                this.state.activeProjectId = saved.activeProjectId || (saved.projects.length > 0 ? saved.projects[0].id : null);
                console.log("Task Plugin: Loaded from DB", this.state);
                return;
            }
        }

        // Default if empty or DB not ready
        if (this.state.projects.length === 0) {
            this.state.projects = [
                {
                    id: 'p-initial',
                    name: 'My First Project',
                    columns: [
                        { id: 'c1', title: 'To Do', tasks: [{ id: 't1', title: 'Explore Aru', desc: 'Try opening the library and setting a custom model.' }] },
                        { id: 'c2', title: 'In Progress', tasks: [] },
                        { id: 'c3', title: 'Done', tasks: [] }
                    ]
                }
            ];
            this.state.activeProjectId = 'p-initial';
        }
    },

    getT(key) {
        return window.PluginManager ?
            (window.PluginManager.getTranslation(key) || key) :
            key;
    },

    addProject() {
        const name = prompt(this.getT('task_new_project') + ":");
        if (!name) return;

        const project = {
            id: 'p-' + Date.now(),
            name: name,
            columns: [] // New projects start with no columns
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
            <div class="project-node group ${p.id === this.state.activeProjectId ? 'active' : ''}" onclick="TaskPlugin.selectProject('${p.id}')">
                <i data-lucide="${p.id === this.state.activeProjectId ? 'folder-open' : 'folder'}" class="w-4 h-4"></i>
                <span class="flex-1 truncate">${p.name}</span>
                <button class="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition" onclick="event.stopPropagation(); TaskPlugin.deleteProject('${p.id}')">
                    <i data-lucide="trash-2" class="w-3 h-3"></i>
                </button>
            </div>
        `).join('');

        if (window.lucide) lucide.createIcons();
    },

    renderBoard() {
        const container = document.getElementById('board-columns');
        if (!container) return; // Headless mode or UI not loaded

        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        if (!project) {
            container.innerHTML = `
                <div class="flex-1 flex flex-col items-center justify-center text-gray-400 opacity-50 p-8 text-center">
                    <i data-lucide="clipboard-check" class="w-16 h-16 mb-4"></i>
                    <p>${this.getT('task_empty_board')}</p>
                </div>`;
            if (window.lucide) lucide.createIcons();
            return;
        }

        // Destroy old sortables
        this.sortables.forEach(s => s.destroy());
        this.sortables = [];

        container.innerHTML = project.columns.map(col => `
            <div class="task-column flex flex-col h-full bg-gray-100 dark:bg-gray-900/40 rounded-2xl border border-gray-200 dark:border-gray-800" data-col-id="${col.id}">
                <div class="column-header p-4 flex justify-between items-center">
                    <span class="font-bold text-sm tracking-tight">${col.title}</span>
                    <button class="p-1.5 text-gray-400 hover:text-red-500 transition" onclick="TaskPlugin.deleteColumn('${col.id}')">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
                
                <div class="cards-list flex-1 p-3 overflow-y-auto min-h-[50px] space-y-3" id="list-${col.id}">
                    ${col.tasks.map(t => `
                        <div class="task-card bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm cursor-grab active:cursor-grabbing hover:border-purple-300 transition-colors" 
                             data-id="${t.id}" onclick="TaskPlugin.openTaskModal('${col.id}', '${t.id}')">
                            <div class="flex justify-between items-start gap-2">
                                <h4 class="font-bold text-sm text-gray-800 dark:text-gray-100">${t.title}</h4>
                            </div>
                            ${t.desc ? `<p class="text-[11px] text-gray-500 mt-2 line-clamp-3">${t.desc}</p>` : ''}
                            ${t.deadline ? `
                                <div class="mt-3 py-1 px-2 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 rounded-lg text-[10px] font-bold inline-flex items-center gap-1.5">
                                    <i data-lucide="clock" class="w-3 h-3"></i>
                                    ${new Date(t.deadline).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
                
                <button class="m-3 p-3 bg-white dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl text-xs font-bold text-gray-400 hover:text-purple-500 hover:border-purple-400 transition-all flex items-center justify-center gap-2" onclick="TaskPlugin.addTask('${col.id}')">
                    <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                    ${this.getT('task_new_card')}
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

        const taskIndex = fromCol.tasks.findIndex(t => t.id === taskId);
        const [task] = fromCol.tasks.splice(taskIndex, 1);

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
            id: 'c-' + Date.now(),
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
        const col = project.columns.find(c => c.id === colId);
        const task = taskId ? col.tasks.find(t => t.id === taskId) : { title: '', desc: '', deadline: '' };

        const modal = document.getElementById('task-detail-modal');
        const content = document.getElementById('task-modal-content');
        if (!modal || !content) return;

        content.innerHTML = `
            <div class="space-y-5">
                <div class="task-modal-field">
                    <label class="task-modal-label">${this.getT('task_title')}</label>
                    <input type="text" id="task-edit-title" class="task-modal-input" value="${task.title}" placeholder="What needs to be done?">
                </div>
                <div class="task-modal-field">
                    <label class="task-modal-label">${this.getT('task_desc')}</label>
                    <textarea id="task-edit-desc" class="task-modal-input min-h-[100px] resize-none" placeholder="Add more details...">${task.desc}</textarea>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="task-modal-field">
                        <label class="task-modal-label">${this.getT('task_deadline')}</label>
                        <input type="datetime-local" id="task-edit-deadline" class="task-modal-input" value="${task.deadline || ''}">
                    </div>
                </div>
                <div class="flex flex-wrap gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
                    <button onclick="TaskPlugin.saveTask('${colId}', ${taskId ? `'${taskId}'` : 'null'})" class="flex-1 py-2.5 bg-[#f97316] hover:bg-[#ea580c] text-white rounded-xl font-bold transition text-sm">
                        ${taskId ? this.getT('task_save') : this.getT('task_create')}
                    </button>
                    ${taskId ? `
                    <button onclick="TaskPlugin.deleteTask('${colId}', '${taskId}')" class="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl font-bold transition" title="${this.getT('task_delete')}">
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
        const title = document.getElementById('task-edit-title').value.trim();
        if (!title) return alert('Title is required');
        const desc = document.getElementById('task-edit-desc').value;
        const deadline = document.getElementById('task-edit-deadline').value;

        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        const col = project.columns.find(c => c.id === colId);

        if (taskId) {
            const task = col.tasks.find(t => t.id === taskId);
            task.title = title;
            task.desc = desc;
            task.deadline = deadline;
        } else {
            col.tasks.push({
                id: 't-' + Date.now(),
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
        if (!confirm('Delete task?')) return;
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        const col = project.columns.find(c => c.id === colId);
        col.tasks = col.tasks.filter(t => t.id !== taskId);

        this.closeTaskModal();
        this.renderBoard();
        this.saveState();
    },

    deleteColumn(colId) {
        if (!confirm('Delete column with all tasks?')) return;
        const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
        project.columns = project.columns.filter(c => c.id !== colId);
        this.renderBoard();
        this.saveState();
    },

    deleteProject(id) {
        if (!confirm('Delete project?')) return;
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
