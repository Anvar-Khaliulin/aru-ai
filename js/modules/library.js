/*
---ARU-LAB.SPACE---ALMATY---2026---
Artifact library controller managing the display and interaction of saved applications and documents.
---chat.aru-lab.space---PWA---
*/
import { CanvasManager } from './canvas.js';
import { DB } from './db.js';
import { ChatController } from './chatController.js';
import { aruGlobalState as state } from './aruState.js';

export const Library = {
    state: {
        filterType: 'all', // all, app, game, doc, analytics
        searchQuery: '',
        viewMode: 'grid'
    },

    toggleViewMode() {
        this.state.viewMode = this.state.viewMode === 'grid' ? 'list' : 'grid';
        const btn = document.getElementById('lib-view-toggle');
        if (btn) {
            btn.innerHTML = `<i data-lucide="${this.state.viewMode === 'list' ? 'layout-grid' : 'list'}" class="w-5 h-5"></i>`;
            lucide.createIcons();
        }
        this.loadModules();
    },

    open() {
        this.renderModal();
        this.loadModules();
    },

    renderModal() {
        const appState = window.aruState || {};
        const t = appState.translations || {};
        const html = `
        <div class="fixed top-[60px] md:top-[72px] inset-x-0 bottom-0 z-[100] flex items-center justify-center bg-white/5 dark:bg-black/5 backdrop-blur-md fade-in p-2 md:p-4">
            <div class="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl relative overflow-hidden">
                <!-- Header -->
                <div class="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-900/50">
                    <h3 class="text-lg font-bold dark:text-white flex items-center gap-2">
                        <i data-lucide="library" class="w-5 h-5 text-aru-500"></i> ${t.lib_title || 'Aru Library'}
                    </h3>
                    <button onclick="document.getElementById('modal-container').innerHTML=''" class="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-400 transition">
                        <i data-lucide="x" class="w-6 h-6"></i>
                    </button>
                </div>

                <!-- Toolbar -->
                <div class="p-4 border-b border-gray-100 dark:border-gray-800 flex flex-col md:flex-row gap-4 items-center bg-white dark:bg-gray-900">
                    <div class="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                        <button onclick="window.Library.setFilter('all')" id="lib-filter-all" class="px-3 py-2 text-sm font-medium rounded-md bg-white dark:bg-gray-700 shadow-sm transition">${t.lib_filter_all || 'All'}</button>
                        <button onclick="window.Library.setFilter('apps')" id="lib-filter-apps" class="px-3 py-2 text-sm font-medium rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-400 transition">${t.lib_filter_apps || 'Aru Apps'}</button>
                        <button onclick="window.Library.setFilter('docs')" id="lib-filter-docs" class="px-3 py-2 text-sm font-medium rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-400 transition">${t.lib_filter_docs || 'Aru Docs'}</button>
                    </div>
                    <div class="flex items-center gap-2 w-full md:w-auto">
                        <button onclick="window.Library.toggleViewMode()" id="lib-view-toggle" class="w-10 h-10 flex shrink-0 items-center justify-center bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-500 rounded-xl transition-all shadow-sm active:scale-95" title="${t.lib_toggle_view || 'Toggle View'}">
                            <i data-lucide="list" class="w-5 h-5"></i>
                        </button>
                        <button onclick="window.Library.openAddModal()" class="w-10 h-10 flex items-center justify-center bg-aru-500 hover:bg-aru-600 text-white rounded-xl shadow-md transition-all active:scale-95" title="${t.lib_add_artifact || 'Add Artifact'}">
                            <i data-lucide="plus" class="w-5 h-5"></i>
                        </button>
                        <div class="relative flex-1 md:w-64">
                            <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"></i>
                            <input type="text" oninput="window.Library.search(this.value)" placeholder="${t.lib_search_placeholder || 'Search...'}" class="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-aru-500 outline-none dark:text-white">
                        </div>
                    </div>
                </div>

                <!-- Grid -->
                <div id="library-grid" class="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-900 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
                    <!-- Items go here -->
                    <div class="col-span-full flex justify-center py-10"><div class="animate-spin w-8 h-8 border-4 border-aru-500 border-t-transparent rounded-full"></div></div>
                </div>

                <!-- Add Artifact Modal Overlay (hidden by default) -->
                <div id="lib-add-overlay" class="hidden absolute inset-0 z-[101] bg-white/5 dark:bg-black/5 backdrop-blur-md flex items-center justify-center p-2 md:p-4 animate-fade-in">
                    <div class="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-2xl shadow-2xl relative border border-gray-100 dark:border-gray-800 flex flex-col max-h-full overflow-hidden animate-fade-in-up">
                        <div class="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-900/50">
                           <h3 class="text-xl font-bold dark:text-white flex items-center gap-2">
                                <i data-lucide="plus-circle" class="w-6 h-6 text-aru-500"></i> ${t.lib_add_title || 'New Artifact'}
                            </h3>
                            <button onclick="document.getElementById('lib-add-overlay').classList.add('hidden')" class="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-400 transition">
                                <i data-lucide="x" class="w-6 h-6"></i>
                            </button>
                        </div>
                        
                        <div class="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar bg-white dark:bg-gray-950">
                            <form id="lib-add-form" onsubmit="window.Library.handleAddArtifact(event)" class="space-y-4">
                                <div>
                                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.lib_label_name || 'Name'}</label>
                                    <input type="text" name="name" required class="w-full p-3 bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-xl focus:border-aru-500 outline-none dark:text-gray-200 text-xs">
                                </div>
                                <div>
                                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.lib_label_tags || 'Key Words'}</label>
                                    <input type="text" name="tags" placeholder="app, utility, test" class="w-full p-3 bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-xl focus:border-aru-500 outline-none dark:text-gray-200 text-xs">
                                </div>
                                <div>
                                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.lib_label_type || 'Artifact Type'}</label>
                                    <select name="type" required class="w-full p-3 bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-xl focus:border-aru-500 outline-none dark:text-gray-200 text-xs">
                                        <option value="app">${t.lib_type_app || 'Aru App'}</option>
                                        <option value="game">${t.lib_type_game || 'Aru Game'}</option>
                                        <option value="doc">${t.lib_type_doc || 'Aru Doc'}</option>
                                        <option value="analytics">${t.lib_type_analytics || 'AnDoc (Analytics)'}</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.lib_label_file || 'HTML File'}</label>
                                    <div class="relative group">
                                        <input type="file" name="file" id="lib-file-input" accept=".html,.htm" required onchange="this.nextElementSibling.querySelector('span').textContent = this.files[0] ? this.files[0].name : '${t.lib_file_select || 'Select file'}'" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10">
                                        <div class="w-full p-4 bg-gray-50 dark:bg-gray-900 border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-2xl flex items-center justify-center gap-3 group-hover:border-aru-400 transition-all">
                                            <i data-lucide="upload-cloud" class="w-5 h-5 text-gray-400 group-hover:text-aru-500"></i>
                                            <span class="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">${t.lib_file_select || 'Select .html file'}</span>
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>

                        <div class="p-4 border-t border-gray-100 dark:border-gray-800 flex justify-end bg-gray-50 dark:bg-gray-900/50">
                            <button form="lib-add-form" type="submit" class="px-6 py-2 bg-aru-500 hover:bg-aru-600 text-white rounded-xl font-bold transition shadow-lg shadow-aru-500/20 active:scale-95">
                                ${t.btn_save || 'Сохранить'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        document.getElementById('modal-container').innerHTML = html;
        lucide.createIcons();
        window.Library = this; // Exposes library reference to the global object for DOM event bindings
    },

    setFilter(type) {
        this.state.filterType = type;
        // Updates the visual tab states for filtering interaction
        ['all', 'apps', 'docs'].forEach(t => {
            const btn = document.getElementById(`lib-filter-${t}`);
            if (!btn) return;
            if (t === type) {
                btn.classList.add('bg-white', 'dark:bg-gray-700', 'shadow-sm', 'text-gray-900', 'dark:text-white');
                btn.classList.remove('text-gray-500', 'dark:text-gray-400');
            } else {
                btn.classList.remove('bg-white', 'dark:bg-gray-700', 'shadow-sm', 'text-gray-900', 'dark:text-white');
                btn.classList.add('text-gray-500', 'dark:text-gray-400');
            }
        });
        this.loadModules();
    },

    search(query) {
        this.state.searchQuery = query;
        this.loadModules();
    },

    async loadModules() {
        const grid = document.getElementById('library-grid');

        try {
            let modules = [];
            if (this.state.filterType === 'all') {
                const apps = DB.getModules('app');
                const games = DB.getModules('game');
                const docs = DB.getModules('doc');
                const analytics = DB.getModules('analytics');
                modules = [...apps, ...games, ...docs, ...analytics];
            } else if (this.state.filterType === 'apps') {
                const apps = DB.getModules('app');
                const games = DB.getModules('game');
                modules = [...apps, ...games];
            } else if (this.state.filterType === 'docs') {
                const docs = DB.getModules('doc');
                const analytics = DB.getModules('analytics');
                modules = [...docs, ...analytics];
            } else {
                modules = DB.getModules(this.state.filterType);
            }

            if (this.state.searchQuery) {
                const q = this.state.searchQuery.toLowerCase();
                modules = modules.filter(m =>
                    m.name.toLowerCase().includes(q) ||
                    (m.tags && m.tags.toLowerCase().includes(q))
                );
            }

            this.renderGrid(modules);
        } catch (e) {
            console.error("Library load failed", e);
            const appState = window.aruState || {};
            const t = appState.translations || {};
            grid.innerHTML = `<div class="col-span-full text-center text-red-500">${t.lib_error || 'Load Error'}</div>`;
        }
    },

    renderGrid(modules) {
        const grid = document.getElementById('library-grid');
        const appState = window.aruState || {};
        const t = appState.translations || {};

        if (modules.length === 0) {
            grid.innerHTML = `<div class="col-span-full text-center text-gray-400 py-10 flex flex-col items-center gap-2"><i data-lucide="ghost" class="w-8 h-8 opacity-50"></i><p>${t.lib_empty || 'Empty...'}</p></div>`;
            lucide.createIcons();
            return;
        }

        if (this.state.viewMode === 'list') {
            grid.className = "flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-900 flex flex-col gap-2 content-start";
        } else {
            grid.className = "flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-900 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 content-start";
        }

        const config = {
            game: { icon: 'gamepad-2', color: 'bg-orange-100 text-orange-600', label: t.lib_label_game || 'Game' },
            app: { icon: 'layout', color: 'bg-purple-100 text-purple-600', label: t.lib_label_app || 'App' },
            analytics: { icon: 'bar-chart-3', color: 'bg-blue-100 text-blue-600', label: t.lib_label_analytics || 'Analytics' },
            doc: { icon: 'file-text', color: 'bg-emerald-100 text-emerald-600', label: t.lib_label_doc || 'Doc' }
        };

        grid.innerHTML = modules.map(m => {
            const item = config[m.type] || config.doc;
            const rawTags = m.tags || (m.type === 'app' ? 'Web Application' : (m.type === 'game' ? 'Game' : 'Script/Doc'));
            
            if (this.state.viewMode === 'list') {
                const shortName = m.name.length > 30 ? m.name.substring(0, 30) + '...' : m.name;
                const tagsArray = rawTags.split(',').map(t => t.trim()).filter(Boolean);
                const shortTags = tagsArray.slice(0, 2).join(', ') + (tagsArray.length > 2 ? '...' : '');

                return `
                <div class="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-800 hover:border-aru-500 transition-all duration-300 flex flex-nowrap items-center gap-3 group hover:shadow-md cursor-pointer" onclick="window.Library.launch(${m.id})">
                    <div class="w-10 h-10 rounded-lg ${item.color} flex shrink-0 items-center justify-center">
                        <i data-lucide="${item.icon}" class="w-5 h-5"></i>
                    </div>
                    <div class="flex-1 min-w-0 pr-2">
                        <h4 class="font-bold text-gray-800 dark:text-gray-100 text-sm truncate" title="${m.name}">${shortName}</h4>
                        <p class="text-[11px] text-gray-400 dark:text-gray-500 truncate" title="${rawTags}">${shortTags}</p>
                    </div>
                    <div class="hidden sm:block shrink-0 pr-2">
                        <span class="text-[9px] font-black uppercase tracking-widest text-gray-400 border border-gray-100 dark:border-gray-700 px-2 py-1 rounded-lg">${item.label}</span>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        <button onclick="event.stopPropagation(); window.Library.launch(${m.id})" class="p-2 bg-gray-50 dark:bg-gray-700 hover:bg-aru-500 text-gray-500 hover:text-white rounded-lg transition shadow-sm" title="${t.btn_open || 'Open'}">
                            <i data-lucide="play" class="w-4 h-4"></i>
                        </button>
                        <button onclick="event.stopPropagation(); window.Library.deleteItem(${m.id})" class="p-2 bg-gray-50 dark:bg-gray-700 hover:bg-red-500 text-gray-400 hover:text-white rounded-lg transition shadow-sm" title="${t.btn_delete || 'Delete'}">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>`;
            } else {
                const shortName = m.name.length > 15 ? m.name.substring(0, 15) + '...' : m.name;
                const shortTags = rawTags.length > 15 ? rawTags.substring(0, 15) + '...' : rawTags;

                return `
                <div class="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-100 dark:border-gray-800 hover:border-aru-500 dark:hover:border-aru-500 transition-all duration-300 group flex flex-col gap-4 min-h-[12rem] relative shadow-sm hover:shadow-xl hover:-translate-y-1">
                    <div class="flex items-start justify-between gap-3">
                        <div class="w-11 h-11 rounded-xl ${item.color} flex items-center justify-center transition-transform group-hover:scale-110 shadow-inner">
                            <i data-lucide="${item.icon}" class="w-6 h-6"></i>
                        </div>
                        <span class="shrink-0 text-[9px] font-black uppercase tracking-widest text-gray-400 border border-gray-100 dark:border-gray-700 px-2 py-1 rounded-lg">${item.label}</span>
                    </div>
                    <div class="flex-1 min-h-0 flex flex-col">
                        <h4 class="font-bold text-gray-800 dark:text-gray-100 text-sm leading-tight" title="${m.name}">${shortName}</h4>
                        <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed font-medium italic" title="${rawTags}">${shortTags}</p>
                    </div>
                    
                    <div class="mt-auto flex items-center gap-2 border-t border-gray-100 dark:border-gray-700 pt-3 opacity-100 md:opacity-0 transition-all duration-300 translate-y-0 md:translate-y-2 group-hover:opacity-100 group-hover:translate-y-0">
                        <button onclick="window.Library.launch(${m.id})" class="flex-1 min-w-0 h-10 px-3 bg-aru-500 hover:bg-aru-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition shadow-lg shadow-aru-500/20">${t.btn_open || 'Open'}</button>
                        <button onclick="event.stopPropagation(); window.Library.deleteItem(${m.id})" class="w-10 h-10 shrink-0 flex items-center justify-center bg-gray-50 dark:bg-gray-700 text-gray-400 hover:text-red-500 border border-gray-100 dark:border-gray-600 rounded-xl transition shadow-sm" title="${t.btn_delete || 'Delete'}">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>`;
            }
        }).join('');
        lucide.createIcons();
    },

    async launch(id) {
        if (!state.currentChatId || state.tabs.length === 0) {
            await ChatController.newChat();
        }
        
        document.getElementById('modal-container').innerHTML = '';
        const apps = DB.getModules('app');
        const games = DB.getModules('game');
        const docs = DB.getModules('doc');
        const analytics = DB.getModules('analytics');
        const m = [...apps, ...games, ...docs, ...analytics].find(x => x.id == id);

        if (m) {
            CanvasManager.renderArtifact(m.type, m.name, m.content);
        }
    },

    async deleteItem(id) {
        const appState = window.aruState || {};
        const t = appState.translations || {};

        if (!confirm(t.confirm_delete || 'Delete this module from library?')) return;

        try {
            DB.deleteModule(id);
            this.loadModules(); // Triggers a grid regeneration to reflect updated states
        } catch (e) {
            console.error("Failed to delete module", e);
            alert(t.lib_error || 'Delete Error');
        }
    },

    openAddModal() {
        const overlay = document.getElementById('lib-add-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');
            overlay.classList.add('flex');
            lucide.createIcons();
        }
    },

    async handleAddArtifact(event) {
        event.preventDefault();
        const form = event.target;
        const name = form.name.value;
        const tags = form.tags.value;
        const type = form.type.value;
        const fileInput = form.file;

        if (!fileInput.files.length) return;

        const file = fileInput.files[0];
        const reader = new FileReader();

        reader.onload = async (e) => {
            const content = e.target.result;
            try {
                DB.saveModule(type, name, content, tags);
                document.getElementById('lib-add-overlay').classList.add('hidden');
                form.reset();
                this.loadModules(); // Triggers a grid regeneration to reflect updated states
            } catch (err) {
                console.error("Failed to save artifact", err);
                alert(t.lib_save_error || "Error saving artifact");
            }
        };

        reader.onerror = () => {
            alert(t.lib_read_error || "Error reading file");
        };

        reader.readAsText(file);
    }
};
