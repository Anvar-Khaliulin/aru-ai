/*
---ARU-LAB.SPACE---ALMATY---2026---
Plugin Manager handling the registration, local loading, and lifecycle of Aru AI extensions.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { UI } from './ui.js';

export const PluginManager = {
    registry: [
        {
            id: 'task',
            nameKey: 'plugin_task_name',
            descKey: 'plugin_task_desc',
            icon: 'clipboard-check',
            color: 'text-purple-600 bg-purple-100',
            entry: 'plugins/task/task.js',
            globalName: 'TaskPlugin'
        },
        {
            id: 'skills',
            nameKey: 'plugin_skills_name',
            descKey: 'plugin_skills_desc',
            icon: 'blocks',
            color: 'text-indigo-600 bg-indigo-100',
            entry: 'plugins/skills/skills.js',
            globalName: 'SkillsPlugin',
            singleton: true,
            adultOnly: true
        },
        {
            id: 'fit-care',
            nameKey: 'plugin_fit_care_name',
            descKey: 'plugin_fit_care_desc',
            icon: 'heart-pulse',
            color: 'text-rose-600 bg-rose-100',
            entry: 'plugins/fit-care/fit-care.js',
            globalName: 'FitCarePlugin',
            singleton: true,
            allowedModes: ['teen', 'adult'],
            lockKey: 'fit_care_locked'
        }
    ],

    async init() {
        try {
            const resp = await fetch('lang/plugins.json');
            state.pluginsTranslations = await resp.json();
            console.log("Plugin Manager: Translations loaded", state.pluginsTranslations);
        } catch (e) {
            console.error("Plugin Manager: Failed to load translations", e);
        }

        // Restricted plugins must close immediately when the profile mode changes.
        window.addEventListener('aru-user-mode-changed', (e) => {
            const mode = e.detail && e.detail.mode;
            if (mode === 'adult') return;
            const indices = [];
            state.tabs.forEach((tab, idx) => {
                if (tab.type !== 'plugin') return;
                const def = this.getPluginDefinition(tab.pluginId);
                if (def && this.isPluginLocked(def)) indices.push(idx);
            });
            for (let i = indices.length - 1; i >= 0; i--) {
                if (window.app && window.app.closeTab) window.app.closeTab(indices[i]);
            }
        });
    },

    isPluginLocked(plugin) {
        const mode = state.userSettings.user_mode || 'adult';
        if (Array.isArray(plugin.allowedModes)) return !plugin.allowedModes.includes(mode);
        return !!(plugin.adultOnly && mode !== 'adult');
    },

    getTranslation(key) {
        let lang = state.lang || 'en';
        if (lang.includes('-')) lang = lang.split('-')[0]; // Normalize ru-RU -> ru

        const dict = state.pluginsTranslations[lang] || state.pluginsTranslations['en'] || {};
        const result = dict[key] || key;
        console.debug(`Plugin Manager: Translate "${key}" [${lang}] -> "${result}"`);
        return result;
    },

    getPluginDefinition(id) {
        return this.registry.find(plugin => plugin.id === id) || null;
    },

    getPluginAPI(id) {
        const plugin = this.getPluginDefinition(id);
        if (!plugin || !plugin.globalName) return null;
        return window[plugin.globalName] || null;
    },

    handleLifecycle(id, action, payload = {}) {
        const api = this.getPluginAPI(id);
        if (!api) return;

        const methodMap = {
            activate: 'onActivate',
            deactivate: 'onDeactivate',
            close: 'onClose'
        };

        const methodName = methodMap[action];
        if (!methodName || typeof api[methodName] !== 'function') return;

        try {
            api[methodName](payload);
        } catch (e) {
            console.error(`Plugin Manager: Lifecycle "${action}" failed for ${id}`, e);
        }
    },

    openPluginsModal() {
        const t = state.translations || {};
        const pt = (key) => this.getTranslation(key);

        const html = `
            <div id="modal-plugins" class="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-fade-in">
                <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onclick="app.closeModal()"></div>
                <div class="bg-white dark:bg-gray-800 w-full max-w-md rounded-3xl shadow-2xl relative overflow-hidden border border-gray-100 dark:border-gray-700">
                    <div class="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
                        <div>
                            <h3 class="text-xl font-bold text-gray-800 dark:text-gray-100">${pt('plugins_title')}</h3>
                            <p class="text-xs text-gray-500 mt-1">${pt('plugins_desc')}</p>
                        </div>
                        <button onclick="app.closeModal()" class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition">
                            <i data-lucide="x" class="w-5 h-5"></i>
                        </button>
                    </div>
                    
                    <div class="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar space-y-3">
                        ${this.registry.map(plugin => {
                            const locked = this.isPluginLocked(plugin);
                            const iconCls = locked
                                ? 'bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                                : plugin.color;
                            return `
                            <div class="group p-4 bg-gray-50 dark:bg-gray-900/50 border border-transparent ${locked ? 'border-gray-200 dark:border-gray-700 opacity-60 cursor-not-allowed' : 'hover:border-purple-200 dark:hover:border-purple-800 cursor-pointer'} rounded-2xl transition flex items-center gap-4" onclick="app.launchPlugin('${plugin.id}')">
                                <div class="w-12 h-12 ${iconCls} rounded-xl flex items-center justify-center shrink-0 ${locked ? '' : 'group-hover:scale-110'} transition-transform">
                                    <i data-lucide="${plugin.icon}" class="w-6 h-6"></i>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <h4 class="font-bold text-gray-800 dark:text-gray-100 truncate">${pt(plugin.nameKey)}</h4>
                                    <p class="text-xs text-gray-500 line-clamp-2 mt-0.5">${pt(plugin.descKey)}</p>
                                    ${locked ? `<p class="text-[10px] text-gray-400 mt-1 flex items-center gap-1"><i data-lucide="lock" class="w-3 h-3"></i>${pt(plugin.lockKey || 'skills_locked')}</p>` : ''}
                                </div>
                                <div class="w-8 h-8 flex items-center justify-center rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 ${locked ? 'text-gray-300 dark:text-gray-600' : 'group-hover:bg-purple-500 group-hover:text-white'} transition-colors">
                                    <i data-lucide="${locked ? 'lock' : 'arrow-right'}" class="w-4 h-4"></i>
                                </div>
                            </div>
                        `;
                        }).join('')}
                    </div>
                    
                    <div class="p-4 bg-gray-50 dark:bg-gray-900/30 text-center">
                        <p class="text-[10px] text-gray-400 uppercase tracking-widest font-bold">More plugins coming soon</p>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('modal-container').innerHTML = html;
        lucide.createIcons();
    },

    launchPlugin(id) {
        const plugin = this.getPluginDefinition(id);
        if (!plugin) return;

        if (this.isPluginLocked(plugin)) {
            UI.showToast(this.getTranslation(plugin.lockKey || 'skills_locked'), 'lock');
            return;
        }

        UI.closeModal();

        if (plugin.singleton) {
            const existingTabIndex = state.tabs.findIndex(tab => tab.type === 'plugin' && tab.pluginId === id);
            if (existingTabIndex !== -1) {
                window.app.switchTab(existingTabIndex);
                return;
            }
        }

        // Check if plugin already open? Maybe allow multiple instances or just one per tab.
        // For now, let's open a new tab.

        const newTab = {
            type: 'plugin',
            pluginId: plugin.id,
            title: this.getTranslation(plugin.nameKey),
            icon: plugin.icon,
            isPrivate: false,
            isSending: false,
            isCanvasOpen: false,
            messages: [],
            attachments: [],
            isSearchEnabled: false
        };

        state.tabs.push(newTab);
        const newTabIndex = state.tabs.length - 1;

        // Render UI
        window.app.renderTabs();
        window.app.switchTab(newTabIndex);

        // Hide messages container and welcome placeholder
        document.getElementById('messages-container').classList.add('hidden');
        document.getElementById('chat-placeholder').classList.add('hidden');

        // Create or show plugin container
        let pluginContainer = document.getElementById('plugin-viewport');
        if (!pluginContainer) {
            pluginContainer = document.createElement('div');
            pluginContainer.id = 'plugin-viewport';
            document.getElementById('messages-container').parentNode.insertBefore(pluginContainer, document.getElementById('messages-container'));
        }
        pluginContainer.className = 'flex-1 min-h-0 min-w-0 overflow-hidden relative z-10';
        pluginContainer.classList.remove('hidden');

        // Load the plugin entry
        this.loadPluginContent(plugin, pluginContainer);
    },

    async loadPluginContent(plugin, container) {
        container.dataset.pluginId = plugin.id;
        container.innerHTML = `<div class="h-full flex flex-col items-center justify-center gap-4 text-gray-400">
            <i data-lucide="loader-2" class="w-10 h-10 animate-spin text-purple-500"></i>
            <span class="text-sm font-medium">Loading ${this.getTranslation(plugin.nameKey)}...</span>
        </div>`;
        lucide.createIcons();

        try {
            const resp = await fetch(`plugins/${plugin.id}/${plugin.id}.html`);
            const html = await resp.text();

            // Inject raw HTML (including <link> and <style> tags)
            container.innerHTML = html;

            if (window.lucide) window.lucide.createIcons();

            // Execute scripts if any (manual execution needed for injected HTML)
            const scripts = container.querySelectorAll('script');
            const scriptLoads = Array.from(scripts).map(oldScript => new Promise(resolve => {
                const newScript = document.createElement('script');
                Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));

                if (oldScript.src) {
                    newScript.onload = () => resolve();
                    newScript.onerror = () => resolve();
                    newScript.src = oldScript.src;
                } else {
                    newScript.appendChild(document.createTextNode(oldScript.innerHTML));
                }

                oldScript.parentNode.replaceChild(newScript, oldScript);

                if (!oldScript.src) resolve();
            }));

            await Promise.all(scriptLoads);
            this.handleLifecycle(plugin.id, 'activate', { container });

        } catch (e) {
            console.error("Plugin Manager: Load failed", e);
            container.innerHTML = `<div class="p-8 text-center text-red-500 font-bold">Failed to load plugin: ${plugin.id}</div>`;
        }
    }
};
