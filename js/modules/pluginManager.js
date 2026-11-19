/*
---ARU-LAB.SPACE---ALMATY---2026---
Plugin Manager handling the registration, local loading, and lifecycle of Aru AI extensions.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { UI } from './ui.js';

export const PluginManager = {
    _loadedStyles: new Set(),
    _loadedScripts: new Set(),
    registry: [
        {
            id: 'task',
            nameKey: 'plugin_task_name',
            descKey: 'plugin_task_desc',
            icon: 'clipboard-check',
            color: 'text-purple-600 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40',
            entry: 'plugins/task/task.js',
            globalName: 'TaskPlugin',
            singleton: true
        },
        {
            id: 'skills',
            nameKey: 'plugin_skills_name',
            descKey: 'plugin_skills_desc',
            icon: 'blocks',
            color: 'text-blue-600 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40',
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
            color: 'text-rose-600 dark:text-rose-300 bg-rose-100 dark:bg-rose-900/40',
            entry: 'plugins/fit-care/fit-care.js',
            globalName: 'FitCarePlugin',
            singleton: true,
            allowedModes: ['teen', 'adult'],
            lockKey: 'fit_care_locked'
        }
    ],

    async init() {
        document.querySelectorAll('link[rel="stylesheet"][href]').forEach((el) => {
            try { this._loadedStyles.add(new URL(el.getAttribute('href'), document.baseURI).href); } catch (_) {}
        });
        document.querySelectorAll('script[src]').forEach((el) => {
            try { this._loadedScripts.add(new URL(el.getAttribute('src'), document.baseURI).href); } catch (_) {}
        });

        try {
            const resp = await fetch('lang/plugins.json');
            state.pluginsTranslations = await resp.json();
            console.log("Plugin Manager: Translations loaded", state.pluginsTranslations);
        } catch (e) {
            console.error("Plugin Manager: Failed to load translations", e);
        }

        // Update plugin tab titles dynamically when interface language changes.
        window.addEventListener('aru-lang-changed', () => {
            let changed = false;
            state.tabs.forEach((tab) => {
                if (tab.type !== 'plugin') return;
                const def = this.getPluginDefinition(tab.pluginId);
                if (!def) return;
                const nextTitle = this.getTranslation(def.nameKey);
                if (nextTitle && nextTitle !== tab.title) {
                    tab.title = nextTitle;
                    changed = true;
                }
            });
            if (changed && window.app && window.app.renderTabs) {
                window.app.renderTabs();
            }
        });

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
        return dict[key] || key;
    },

    ensureViewport() {
        let container = document.getElementById('plugin-viewport');
        if (!container) {
            container = document.createElement('div');
            container.id = 'plugin-viewport';
            container.className = 'flex-1 min-h-0 min-w-0 overflow-hidden relative';
            document.getElementById('messages-container')?.before(container);
        } else {
            container.classList.remove('z-10');
        }
        return container;
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
                <div class="bg-white dark:bg-gray-800 w-full max-w-md rounded-3xl shadow-2xl relative overflow-hidden border border-gray-100 dark:border-gray-700" role="dialog" aria-modal="true" aria-labelledby="modal-plugins-title">
                    <div class="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
                        <div>
                            <h3 id="modal-plugins-title" class="text-xl font-bold text-gray-800 dark:text-gray-100">${UI.escapeHTML(pt('plugins_title'))}</h3>
                            <p class="text-xs text-gray-500 mt-1">${UI.escapeHTML(pt('plugins_desc'))}</p>
                        </div>
                        <button type="button" onclick="app.closeModal()" aria-label="${UI.escapeHTML(t.btn_close || 'Close')}" class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition">
                            <i data-lucide="x" class="w-5 h-5"></i>
                        </button>
                    </div>
                    
                    <div class="p-4 max-h-[60dvh] overflow-y-auto custom-scrollbar space-y-3">
                        ${this.registry.map(plugin => {
                            const locked = this.isPluginLocked(plugin);
                            const iconCls = locked
                                ? 'bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                                : plugin.color;
                            return `
                            <button type="button" class="w-full text-left group p-4 bg-gray-50 dark:bg-gray-900/50 border border-transparent ${locked ? 'border-gray-200 dark:border-gray-700 opacity-60 cursor-not-allowed' : 'hover:border-aru-200 dark:hover:border-aru-800 cursor-pointer'} rounded-2xl transition flex items-center gap-4" onclick="app.launchPlugin('${plugin.id}')">
                                <div class="w-12 h-12 ${iconCls} rounded-xl flex items-center justify-center shrink-0 ${locked ? '' : 'group-hover:scale-110'} transition-transform">
                                    <i data-lucide="${plugin.icon}" class="w-6 h-6"></i>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <h4 class="font-bold text-gray-800 dark:text-gray-100 truncate">${UI.escapeHTML(pt(plugin.nameKey))}</h4>
                                    <p class="text-xs text-gray-500 line-clamp-2 mt-0.5">${UI.escapeHTML(pt(plugin.descKey))}</p>
                                    ${locked ? `<p class="text-[10px] text-gray-400 mt-1 flex items-center gap-1"><i data-lucide="lock" class="w-3 h-3"></i>${UI.escapeHTML(pt(plugin.lockKey || 'skills_locked'))}</p>` : ''}
                                </div>
                                <div class="w-8 h-8 flex items-center justify-center rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 ${locked ? 'text-gray-300 dark:text-gray-600' : 'group-hover:bg-aru-500 group-hover:text-white'} transition-colors">
                                    <i data-lucide="${locked ? 'lock' : 'arrow-right'}" class="w-4 h-4"></i>
                                </div>
                            </button>
                        `;
                        }).join('')}
                    </div>
                    
                    <div class="p-4 bg-gray-50 dark:bg-gray-900/30 text-center">
                        <p class="text-[10px] text-gray-400 uppercase tracking-widest font-bold">${UI.escapeHTML(pt('plugins_more_soon') !== 'plugins_more_soon' ? pt('plugins_more_soon') : 'More plugins coming soon')}</p>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('modal-container').innerHTML = html;
        lucide.createIcons();
        const onPluginsKey = (e) => {
            const modal = document.getElementById('modal-plugins');
            if (!modal || !modal.isConnected) {
                document.removeEventListener('keydown', onPluginsKey);
                return;
            }
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', onPluginsKey);
                UI.closeModal();
            }
        };
        document.addEventListener('keydown', onPluginsKey);
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

        const newTab = {
            type: 'plugin',
            pluginId: plugin.id,
            canvasKey: `plugin:${plugin.id}`,
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
        this.ensureViewport();

        window.app.renderTabs();
        window.app.switchTab(newTabIndex);
    },

    async mountPlugin(plugin, viewport, tab) {
        const request = Symbol();
        viewport.pluginLoadRequest = request;
        const isCurrent = () => viewport.pluginLoadRequest === request && state.tabs[state.activeTabIndex] === tab;

        Array.from(viewport.querySelectorAll('.aru-plugin-pane')).forEach((paneEl) => {
            if (paneEl.dataset.pluginPane !== plugin.id) paneEl.classList.add('hidden');
        });

        let pane = viewport.querySelector(`.aru-plugin-pane[data-plugin-pane="${plugin.id}"]`);
        if (!pane) {
            pane = document.createElement('div');
            pane.className = 'aru-plugin-pane h-full w-full min-h-0 min-w-0 relative';
            pane.dataset.pluginPane = plugin.id;
            viewport.appendChild(pane);
        }
        pane.classList.remove('hidden');

        if (pane.dataset.loaded === '1') {
            viewport.dataset.pluginId = plugin.id;
            return { ok: true, firstMount: false, container: pane };
        }

        const pluginName = this.getTranslation(plugin.nameKey);
        const loadingText = this.getTranslation('plugins_loading').replace('{name}', pluginName);
        pane.innerHTML = `<div class="h-full flex flex-col items-center justify-center gap-4 text-gray-400">
            <i data-lucide="loader-2" class="w-10 h-10 animate-spin text-aru-500"></i>
            <span class="text-sm font-medium">${UI.escapeHTML(loadingText)}</span>
        </div>`;
        if (window.lucide) window.lucide.createIcons();

        try {
            const resp = await fetch(`plugins/${plugin.id}/${plugin.id}.html`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();
            if (!isCurrent()) return { ok: false };

            const tpl = document.createElement('template');
            tpl.innerHTML = html;

            const links = Array.from(tpl.content.querySelectorAll('link[rel="stylesheet"][href]'));
            const scripts = Array.from(tpl.content.querySelectorAll('script'));
            links.forEach((l) => l.remove());
            scripts.forEach((s) => s.remove());

            await Promise.all(links.map((link) => new Promise((resolve) => {
                const rawHref = link.getAttribute('href');
                const absHref = new URL(rawHref, document.baseURI).href;
                if (this._loadedStyles.has(absHref)) return resolve();
                this._loadedStyles.add(absHref);
                const el = document.createElement('link');
                el.rel = 'stylesheet';
                el.href = rawHref;
                let settled = false;
                const done = () => { if (!settled) { settled = true; resolve(); } };
                el.onload = done;
                el.onerror = done;
                document.head.appendChild(el);
                setTimeout(done, 2000);
            })));

            if (!isCurrent()) return { ok: false };

            pane.replaceChildren(tpl.content);
            if (window.lucide) window.lucide.createIcons();

            for (const oldScript of scripts) {
                if (!isCurrent()) return { ok: false };
                const srcAttr = oldScript.getAttribute('src');
                if (srcAttr) {
                    const absSrc = new URL(srcAttr, document.baseURI).href;
                    if (this._loadedScripts.has(absSrc)) continue;
                    await new Promise((resolve, reject) => {
                        const s = document.createElement('script');
                        Array.from(oldScript.attributes).forEach((attr) => s.setAttribute(attr.name, attr.value));
                        s.async = false;
                        s.onload = () => {
                            this._loadedScripts.add(absSrc);
                            resolve();
                        };
                        s.onerror = () => reject(new Error(`Failed to load script: ${srcAttr}`));
                        s.src = srcAttr;
                        document.head.appendChild(s);
                    });
                } else {
                    const s = document.createElement('script');
                    s.textContent = oldScript.textContent || '';
                    pane.appendChild(s);
                }
            }

            if (!isCurrent()) return { ok: false };
            pane.dataset.loaded = '1';
            viewport.dataset.pluginId = plugin.id;
            return { ok: true, firstMount: true, container: pane };
        } catch (e) {
            if (!isCurrent()) return { ok: false };
            console.error("Plugin Manager: Load failed", e);
            delete pane.dataset.loaded;
            const errText = this.getTranslation('plugins_load_error').replace('{name}', pluginName);
            pane.innerHTML = `<div class="p-8 text-center text-red-500 font-bold">${UI.escapeHTML(errText)}</div>`;
            return { ok: false };
        }
    },

    unmountPlugin(pluginId) {
        const viewport = document.getElementById('plugin-viewport');
        if (!viewport) return;
        const pane = viewport.querySelector(`.aru-plugin-pane[data-plugin-pane="${pluginId}"]`);
        if (pane) pane.remove();
        if (viewport.dataset.pluginId === pluginId) delete viewport.dataset.pluginId;
    },

    async loadPluginContent(plugin, container, tab) {
        const res = await this.mountPlugin(plugin, container, tab);
        return !!(res && res.ok);
    }
};
