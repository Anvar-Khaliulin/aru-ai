/*
---ARU-LAB.SPACE---ALMATY---2026---
Settings controller handling application configurations, interface preferences, and user profile management.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { DB } from './db.js';
import { RemoteStorage, RemoteAdapters } from './remoteStorage.js';
import { Auth } from './auth.js';

export const SettingsController = {
    app: null,
    _storageProvider: 'gdrive',
    init(appInstance) {
        SettingsController.app = appInstance;
    },

    switchTab: (tabName) => {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
        const target = document.getElementById(`tab-${tabName}`);
        if (target) target.classList.remove('hidden');

        document.querySelectorAll('.tab-btn').forEach(el => {
            el.classList.remove('border-aru-500', 'text-aru-600', 'dark:text-aru-400');
            el.classList.add('border-transparent', 'text-gray-500');
        });
        const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
        if (activeBtn) {
            activeBtn.classList.remove('border-transparent', 'text-gray-500');
            activeBtn.classList.add('border-aru-500', 'text-aru-600', 'dark:text-aru-400');
        }
        if (tabName === 'storage') SettingsController.renderStorageTab();
        if (tabName === 'state') SettingsController.renderStateTab();
    },

    updateProviderParams: () => {
        const typeSelect = document.getElementById('inp-llm-type');
        if (!typeSelect) return;
        const type = typeSelect.value;
        const geminiBlock = document.getElementById('params-gemini');
        const orBlock = document.getElementById('params-openrouter');
        const customBlock = document.getElementById('params-custom');

        if (geminiBlock) geminiBlock.classList.toggle('hidden', type !== 'gemini');
        if (orBlock) orBlock.classList.toggle('hidden', type !== 'openrouter');
        if (customBlock) customBlock.classList.toggle('hidden', type !== 'custom');
    },

    updateSearchProviderParams() {
        const val = document.getElementById('inp-search-provider').value;
        const tavily = document.getElementById('params-tavily');
        const searxng = document.getElementById('params-searxng');
        if (tavily) tavily.classList.toggle('hidden', val !== 'tavily');
        if (searxng) searxng.classList.toggle('hidden', val !== 'searxng');
    },

    updateTransferParams() {
        const stunS = document.getElementById('inp-stun-strategy').value;
        const stunI = document.getElementById('inp-stun-custom');
        if (stunI) stunI.classList.toggle('hidden', stunS !== 'custom');

        const sigS = document.getElementById('inp-signaling-strategy').value;
        const sigI = document.getElementById('inp-signaling-custom');
        if (sigI) sigI.classList.toggle('hidden', sigS !== 'custom');
    },

    deleteMemory: async (id, el) => {
        const t = state.translations || {};
        if (!confirm(t.confirm_forget_fact || 'Забыть этот факт?')) return;
        DB.deleteFact(id);
        const row = el.closest('tr');
        if (row) row.remove();
        if (document.querySelectorAll('#memory-table-body tr').length === 0) {
            document.getElementById('memory-table-body').innerHTML = `<tr><td colspan="2" class="py-10 text-center text-gray-400 italic">${t.empty_memory || 'У Ару пока нет записей в памяти.'}</td></tr>`;
        }
    },

    editMemory: async (id, el) => {
        const t = state.translations || {};
        const row = el.closest('tr');
        const contentEl = row.querySelector('.fact-content');
        const oldContent = contentEl.textContent || '';
        const newContent = prompt(t.prompt_edit_fact || 'Edit memory fact:', oldContent);
        if (newContent !== null && newContent.trim() && newContent !== oldContent) {
            DB.updateFact(id, newContent.trim());
            contentEl.textContent = newContent.trim();
        }
    },

    saveAllSettings: async () => {
        const typeSelect = document.getElementById('inp-llm-type');
        const llmType = typeSelect?.value || state.userSettings.llm_type || 'gemini';

        const getVal = (id, fallback = '') => {
            const el = document.getElementById(id);
            if (!el) return fallback;
            if (el.type === 'checkbox') return el.checked.toString();
            return el.value;
        };

        const settings = {
            llm_type: llmType,
            gemini_key: getVal('inp-gemini-key', state.userSettings.gemini_key || ''),
            gemini_model: getVal('inp-gemini-model', state.userSettings.gemini_model || ''),
            openrouter_key: getVal('inp-openrouter-key', state.userSettings.openrouter_key || ''),
            openrouter_model: getVal('inp-openrouter-model', state.userSettings.openrouter_model || ''),
            openrouter_url: getVal('inp-openrouter-url', state.userSettings.openrouter_url || ''),
            custom_key: getVal('inp-custom-key', state.userSettings.custom_key || ''),
            custom_model: getVal('inp-custom-model', state.userSettings.custom_model || ''),
            custom_url: getVal('inp-custom-url', state.userSettings.custom_url || ''),

            user_name: getVal('inp-user-name', state.userSettings.user_name || 'User'),
            user_mode: getVal('inp-user-mode', state.userSettings.user_mode || 'adult'),
            token_limit: getVal('inp-token-limit', state.userSettings.token_limit || 2048),
            max_output_tokens: getVal('inp-max-output', state.userSettings.max_output_tokens || 2048),
            show_stickers: getVal('inp-show-stickers', state.userSettings.show_stickers ?? 'true'),
            ai_temp: getVal('inp-ai-temp', state.userSettings.ai_temp ?? 0.9),
            rss_urls: document.getElementById('inp-rss-urls')?.value || state.userSettings.rss_urls || '',
            search_provider: getVal('inp-search-provider', state.userSettings.search_provider || 'none'),
            tavily_key: getVal('inp-tavily-key', state.userSettings.tavily_key || ''),
            searxng_url: getVal('inp-searxng-url', state.userSettings.searxng_url || ''),
            proxy_strategy: getVal('inp-proxy-strategy', state.userSettings.proxy_strategy || 'auto'),
            proxy_custom_url: getVal('inp-proxy-custom-url', state.userSettings.proxy_custom_url || ''),
            localhost_priority: getVal('inp-localhost-priority', state.userSettings.localhost_priority ?? 'true'),
            remote_sync_mode: getVal('inp-remote-sync-mode', state.userSettings.remote_sync_mode || 'auto'),
            remote_conflict: getVal('inp-remote-conflict', state.userSettings.remote_conflict || 'ask'),
            remote_poll: getVal('inp-remote-poll', state.userSettings.remote_poll || '0'),
        };

        // Transfer WebRTC
        const stunS = document.getElementById('inp-stun-strategy')?.value;
        const stunC = document.getElementById('inp-stun-custom')?.value;
        settings.stun_server = (stunS === 'custom' && stunC) ? stunC : 'stun:stun.l.google.com:19302';

        const sigS = document.getElementById('inp-signaling-strategy')?.value;
        const sigC = document.getElementById('inp-signaling-custom')?.value;
        settings.signaling_server = (sigS === 'custom' && sigC) ? sigC : 'peerjs-default';

        for (let k in settings) {
            DB.saveSetting(k, settings[k], false); // Batch mode: no auto-save
        }

        await DB.save(); // Single disk write

        state.userSettings = { ...state.userSettings, ...settings };

        // Re-init LLM
        let config = {
            llmType: settings.llm_type,
            aiTemp: settings.ai_temp,
            contextLimit: settings.token_limit,
            maxOutputTokens: settings.max_output_tokens
        };
        if (settings.llm_type === 'gemini') {
            config.apiKey = settings.gemini_key; config.modelName = settings.gemini_model;
        } else if (settings.llm_type === 'openrouter') {
            config.apiKey = settings.openrouter_key; config.modelName = settings.openrouter_model; config.baseUrl = settings.openrouter_url;
        } else if (settings.llm_type === 'custom') {
            config.apiKey = settings.custom_key; config.modelName = settings.custom_model; config.baseUrl = settings.custom_url;
        }
        SettingsController.app.llm.setLLMConfig(config);

        SettingsController.app.updateSystemPrompt();

        // Apply remote polling changes immediately if cloud sync is active
        try {
            if (RemoteStorage.isUnlocked()) {
                RemoteStorage.startPolling(parseInt(settings.remote_poll) || 0);
            }
        } catch (e) { }

        document.getElementById('modal-container').innerHTML = '';
    },

    checkMixedContent: (url) => {
        if (!url) return false;
        return window.location.protocol === 'https:' && url.startsWith('http:');
    },

    openSettings: () => {
        SettingsController.app.promptPassword(() => SettingsController.app._openSettings());
    },

    _openSettings: () => {
        const s = state.userSettings;
        const t = state.translations || {};
        const modalContainer = document.getElementById('modal-container');
        const memories = DB.getMemories();

        const isSel = (curr, val) => (curr === val ? 'selected' : '');
        const isOpt = (curr, val) => (curr === val ? 'selected' : '');

        const html = `
        <div class="fixed top-[60px] md:top-[72px] inset-x-0 bottom-0 z-[100] flex items-center justify-center bg-white/5 dark:bg-black/5 backdrop-blur-md fade-in p-2 md:p-4">
            <div class="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-2xl h-[85vh] flex flex-col shadow-2xl relative overflow-hidden">
                <!-- Header -->
                <div class="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-900/50">
                    <h3 class="text-xl font-bold dark:text-white flex items-center gap-2">
                        <i data-lucide="settings" class="w-6 h-6 text-aru-500"></i>
                        <span>${t.settings_title || 'Настройки'}</span>
                    </h3>
                    <button onclick="document.getElementById('modal-container').innerHTML=''" class="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-400 transition">
                        <i data-lucide="x" class="w-6 h-6"></i>
                    </button>
                </div>

                <!-- Tabs Header -->
                <div class="flex border-b border-gray-100 dark:border-gray-800 px-4 overflow-x-auto no-scrollbar">
                     <button onclick="app.switchTab('state')" data-tab="state" class="tab-btn py-3 px-4 text-sm font-bold border-b-2 border-aru-500 text-aru-600 dark:text-aru-400 transition-colors whitespace-nowrap">${t.settings_tab_state || 'Состояние'}</button>
                     <button onclick="app.switchTab('general')" data-tab="general" class="tab-btn py-3 px-4 text-sm font-bold border-b-2 border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors whitespace-nowrap">${t.settings_tab_general || 'Общее'}</button>
                     <button onclick="app.switchTab('memory')" data-tab="memory" class="tab-btn py-3 px-4 text-sm font-bold border-b-2 border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors whitespace-nowrap">${t.settings_tab_memory || 'Память'}</button>
                     <button onclick="app.switchTab('rss')" data-tab="rss" class="tab-btn py-3 px-4 text-sm font-bold border-b-2 border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors whitespace-nowrap">${t.settings_tab_rss || 'Новости (RSS)'}</button>
                     <button onclick="app.switchTab('network')" data-tab="network" class="tab-btn py-3 px-4 text-sm font-bold border-b-2 border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors whitespace-nowrap">${t.settings_tab_network || 'Сеть'}</button>
                     <button onclick="app.switchTab('storage')" data-tab="storage" class="tab-btn py-3 px-4 text-sm font-bold border-b-2 border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors whitespace-nowrap">${t.settings_tab_storage || 'Хранилище'}</button>
                     <button onclick="app.switchTab('security')" data-tab="security" class="tab-btn py-3 px-4 text-sm font-bold border-b-2 border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors whitespace-nowrap">${t.settings_tab_security || 'Безопасность'}</button>
                </div>

                <!-- Content Area -->
                <div class="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar bg-white dark:bg-gray-950">
                    
                    <!-- State Dashboard Tab -->
                    <div id="tab-state" class="tab-content space-y-6 animate-fade-in">
                        <!-- Filled dynamically by SettingsController.renderStateTab() -->
                    </div>

                    <!-- General Tab -->
                    <div id="tab-general" class="tab-content hidden space-y-6 animate-fade-in">
                         <div class="space-y-6">
                            <!-- AI Provider Card -->
                            <div class="p-5 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-4">
                                <div class="flex items-center justify-between gap-3">
                                    <div class="flex items-center gap-2">
                                        <div class="w-8 h-8 rounded-lg bg-aru-100 dark:bg-aru-900/40 flex items-center justify-center text-aru-600">
                                            <i data-lucide="cpu" class="w-4 h-4"></i>
                                        </div>
                                        <label class="text-sm font-bold text-gray-700 dark:text-gray-200">${t.settings_ai_provider || 'AI Core & Provider'}</label>
                                    </div>
                                </div>
                                
                                <select id="inp-llm-type" onchange="SettingsController.updateProviderParams()"
                                    class="w-full p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-aru-500 outline-none transition-all shadow-sm">
                                    <option value="gemini" ${isOpt(s.llm_type, 'gemini')}>Google Gemini</option>
                                    <option value="openrouter" ${isOpt(s.llm_type, 'openrouter')}>OpenRouter</option>
                                    <option value="custom" ${isOpt(s.llm_type, 'custom')}>Custom API (Ollama/LM Studio)</option>
                                </select>
                            </div>

                            <!-- Provider Specific Parameters -->
                            <div id="provider-params-container" class="space-y-4">
                                <!-- Gemini Params -->
                                <div id="params-gemini" class="p-5 bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-4 ${s.llm_type === 'gemini' ? '' : 'hidden'}">
                                    <div class="flex items-center gap-2 mb-2">
                                        <i data-lucide="sparkles" class="w-4 h-4 text-aru-500"></i>
                                        <span class="text-xs font-bold uppercase tracking-wider text-gray-400">Google Gemini</span>
                                    </div>
                                    <div class="space-y-3">
                                        <div>
                                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">${t.label_gemini_key || 'Gemini Key'}</label>
                                            <input type="password" id="inp-gemini-key" value="${s.gemini_key || ''}" class="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:border-aru-400">
                                        </div>
                                        <div>
                                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">${t.label_gemini_model || 'Gemini Model'}</label>
                                            <input type="text" id="inp-gemini-model" value="${s.gemini_model || 'gemini-1.5-flash'}" placeholder="gemini-1.5-flash" class="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:border-aru-400">
                                        </div>
                                    </div>
                                </div>

                                <!-- OpenRouter Params -->
                                <div id="params-openrouter" class="p-5 bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-4 ${s.llm_type === 'openrouter' ? '' : 'hidden'}">
                                    <div class="flex items-center gap-2 mb-2">
                                        <i data-lucide="shuffle" class="w-4 h-4 text-blue-500"></i>
                                        <span class="text-xs font-bold uppercase tracking-wider text-gray-400">OpenRouter</span>
                                    </div>
                                    <div class="space-y-3">
                                        <div>
                                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">${t.label_openrouter_key || 'Key'}</label>
                                            <input type="password" id="inp-openrouter-key" value="${s.openrouter_key || ''}" class="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:border-aru-400">
                                        </div>
                                        <div>
                                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">${t.label_openrouter_model || 'Model'}</label>
                                            <input type="text" id="inp-openrouter-model" value="${s.openrouter_model || ''}" placeholder="google/gemini-2.0-flash-exp:free" class="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:border-aru-400">
                                        </div>
                                        <div>
                                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">${t.label_openrouter_url || 'Base URL'}</label>
                                            <input type="text" id="inp-openrouter-url" value="${s.openrouter_url || 'https://openrouter.ai/api/v1/chat/completions'}" class="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:border-aru-400">
                                        </div>
                                    </div>
                                </div>

                                <!-- Custom Params -->
                                <div id="params-custom" class="p-5 bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-4 ${s.llm_type === 'custom' ? '' : 'hidden'}">
                                    <div class="flex items-center gap-2 mb-2">
                                        <i data-lucide="server" class="w-4 h-4 text-gray-500"></i>
                                        <span class="text-xs font-bold uppercase tracking-wider text-gray-400">Custom OpenAI Compatible</span>
                                    </div>
                                    <div class="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs rounded-xl border border-blue-100 dark:border-blue-800/30">
                                        <i data-lucide="info" class="w-4 h-4 inline-block mr-1 align-text-bottom"></i> ${t.hint_custom_api_cors || 'Чтобы локальная модель работала в браузере, необходимо включить CORS в настройках самого сервера (например, задать OLLAMA_ORIGINS=\"*\").'}
                                    </div>
                                    <div id="mixed-content-warning" class="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs rounded-xl border border-red-100 dark:border-red-800/30 hidden">
                                        <i data-lucide="alert-triangle" class="w-4 h-4 inline-block mr-1 align-text-bottom"></i> 
                                        ${t.label_mixed_content_warning || 'Mixed Content Warning'}
                                    </div>
                                    <div class="space-y-3">
                                        <div>
                                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">${t.label_custom_url || 'Base URL'}</label>
                                            <input type="text" id="inp-custom-url" oninput="SettingsController.validateCustomUrl(this.value)" value="${s.custom_url || ''}" placeholder="http://localhost:1234/v1" class="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:border-aru-400">
                                        </div>
                                        <div>
                                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">${t.label_custom_model || 'Model Name'}</label>
                                            <input type="text" id="inp-custom-model" value="${s.custom_model || ''}" class="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:border-aru-400">
                                        </div>
                                        <div>
                                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">${t.label_custom_key || 'API Key'}</label>
                                            <input type="password" id="inp-custom-key" value="${s.custom_key || ''}" placeholder="${t.hint_custom_key_optional || 'Optional'}" class="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:border-aru-400">
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- User Profile Card -->
                            <div class="p-5 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-4">
                                <div class="flex items-center gap-2 text-xs font-bold text-aru-500 uppercase tracking-widest">
                                    <i data-lucide="user" class="w-4 h-4"></i>
                                    ${t.label_user_profile || 'User Profile & Mode'}
                                </div>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.settings_user_name || 'Ваше Имя'}</label>
                                        <input type="text" id="inp-user-name" value="${s.user_name || 'User'}" class="w-full p-3 bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-xl text-xs outline-none focus:border-aru-500">
                                    </div>
                                    <div>
                                        <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.settings_user_mode || 'Возрастной режим'}</label>
                                        <select id="inp-user-mode" class="w-full p-3 bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-xl text-xs outline-none focus:border-aru-500">
                                            <option value="child" ${isOpt(s.user_mode, 'child')}>${t.wiz_profile_child_title || 'Ребенок'}</option>
                                            <option value="teen" ${isOpt(s.user_mode, 'teen')}>${t.wiz_profile_teen_title || 'Подросток'}</option>
                                            <option value="adult" ${isOpt(s.user_mode, 'adult')}>${t.wiz_profile_adult_title || 'Взрослый'}</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <!-- Limits Card -->
                            <div class="p-5 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-4">
                                <div class="flex items-center gap-2 text-xs font-bold text-aru-500 uppercase tracking-widest">
                                    <i data-lucide="gauge" class="w-4 h-4"></i>
                                    ${t.label_context_creativity || 'Context & Creativity'}
                                </div>
                                <div class="grid grid-cols-2 gap-4">
                                    <div><label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.settings_context_limit || 'Контекст'}</label><input type="number" id="inp-token-limit" value="${s.token_limit || 2048}" class="w-full p-3 bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-xl text-xs outline-none focus:border-aru-500"></div>
                                    <div><label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.settings_ai_tokens || 'Ответ'}</label><input type="number" id="inp-max-output" value="${s.max_output_tokens || 2048}" class="w-full p-3 bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-xl text-xs outline-none focus:border-aru-500"></div>
                                </div>
                                
                                <div class="space-y-2">
                                    <div class="flex justify-between items-center"><label class="text-[10px] font-bold text-gray-500 uppercase">${t.settings_ai_temp || 'Температура'}</label><span class="text-[10px] font-mono font-bold text-aru-500 mt-1" id="val-ai-temp">${s.ai_temp || 0.9}</span></div>
                                    <input type="range" id="inp-ai-temp" min="0" max="2" step="0.1" value="${s.ai_temp || 0.9}" class="w-full accent-aru-500" oninput="document.getElementById('val-ai-temp').innerText = this.value">
                                </div>

                                <div class="flex flex-wrap items-center gap-4 pt-2">
                                    <label class="flex items-center gap-2 cursor-pointer p-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800">
                                        <input type="checkbox" id="inp-show-stickers" ${s.show_stickers !== 'false' ? 'checked' : ''} class="accent-aru-500">
                                        <span class="text-xs font-bold text-gray-500">${t.settings_show_stickers || 'Стикеры'}</span>
                                    </label>
                                </div>
                            </div>
                         </div>
                    </div>

                    <!-- Memory Tab -->
                    <div id="tab-memory" class="tab-content hidden space-y-4 animate-fade-in">
                         <div class="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-800">
                            <h4 class="text-sm font-bold mb-2 flex items-center gap-2"><i data-lucide="brain" class="w-4 h-4 text-aru-500"></i> ${t.settings_tab_memory || 'Память'}</h4>
                            <div class="overflow-x-auto">
                                <table class="w-full text-left text-xs">
                                    <thead class="text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800">
                                        <tr>
                                            <th class="py-2 px-1">${t.table_memory_fact || 'Факт'}</th>
                                            <th class="py-2 px-1 w-20 text-right">${t.table_memory_action || 'Действие'}</th>
                                        </tr>
                                    </thead>
                                    <tbody id="memory-table-body" class="divide-y divide-gray-50 dark:divide-gray-800">
                                        ${memories.length === 0 ? `<tr><td colspan="2" class="py-10 text-center text-gray-400 italic">${t.empty_memory || 'У Ару пока нет записей в памяти.'}</td></tr>` :
                memories.map(m => `
                                            <tr data-id="${m.id}">
                                                <td class="py-3 px-1 dark:text-gray-300 pr-4 fact-content">${m.content}</td>
                                                <td class="py-3 px-1 text-right flex items-center justify-end gap-1">
                                                    <button onclick="app.editMemory(${m.id}, this)" class="p-1.5 text-gray-400 hover:text-aru-500 transition-colors">
                                                        <i data-lucide="edit-3" class="w-4 h-4"></i>
                                                    </button>
                                                    <button onclick="app.deleteMemory(${m.id}, this)" class="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                                                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                                                    </button>
                                                </td>
                                            </tr>`).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <!-- RSS Tab -->
                    <div id="tab-rss" class="tab-content hidden space-y-4 animate-fade-in">
                        <div class="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-800">
                            <h4 class="text-sm font-bold mb-2 flex items-center gap-2"><i data-lucide="rss" class="w-4 h-4 text-aru-500"></i> ${t.settings_tab_rss || 'Новости (RSS)'}</h4>
                            <p class="text-xs text-gray-500 mb-4">${t.settings_rss_urls_hint || 'Ару будет использовать эти ссылки для поиска новостей.'}</p>
                            <label class="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-2">${t.settings_rss_urls_label || 'RSS ленты (одна на строку)'}</label>
                            <textarea id="inp-rss-urls" rows="6" class="w-full p-3 bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-xl text-xs outline-none focus:border-aru-500 dark:text-gray-200" placeholder="https://example.com/rss.xml">${s.rss_urls || ''}</textarea>
                        </div>
                    </div>

                    <!-- Network Tab -->
                    <div id="tab-network" class="tab-content hidden space-y-6 animate-fade-in">
                        <div class="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-800">
                            <h4 class="text-sm font-bold mb-4 flex items-center gap-2"><i data-lucide="globe" class="w-4 h-4 text-aru-500"></i> ${t.settings_tab_network || 'Сеть'}</h4>
                            <div class="space-y-6">
                                <div class="p-4 bg-white dark:bg-gray-800 rounded-xl border border-aru-100 dark:border-aru-900/30 space-y-4">
                                    <div class="flex items-center gap-2 text-xs font-bold text-aru-500 uppercase tracking-widest">
                                        <i data-lucide="shield" class="w-4 h-4"></i>
                                    ${t.label_connectivity_privacy || 'Connectivity & Privacy'}
                                </div>
                                    <div>
                                        <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.label_proxy_strategy || 'Стратегия подключения'}</label>
                                        <select id="inp-proxy-strategy" class="w-full p-2 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                                            <option value="none" ${isOpt(s.proxy_strategy, 'none')}>${t.label_proxy_none || 'Прямое (Без прокси)'}</option>
                                            <option value="auto" ${isOpt(s.proxy_strategy, 'auto')}>${t.label_proxy_auto || 'Авто (Публичные прокси)'}</option>
                                            <option value="custom" ${isOpt(s.proxy_strategy, 'custom')}>${t.label_proxy_custom || 'Свой прокси'}</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.label_custom_proxy_url || 'URL кастомного прокси'}</label>
                                        <input type="text" id="inp-proxy-custom-url" value="${s.proxy_custom_url || ''}" placeholder="https://myproxy.com/?url=" class="w-full p-2 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                                        <p class="text-[9px] text-gray-400 mt-1">${t.hint_custom_proxy || 'Используйте %URL% для подстановки адреса.'}</p>
                                    </div>
                                    <div class="flex items-center gap-2 pt-2">
                                        <input type="checkbox" id="inp-localhost-priority" ${s.localhost_priority !== 'false' ? 'checked' : ''} class="accent-aru-500">
                                        <label for="inp-localhost-priority" class="text-xs font-bold text-gray-600 dark:text-gray-400 cursor-pointer">${t.label_localhost_priority || 'Приоритет Localhost'}</label>
                                    </div>
                                </div>
                                <div class="h-px bg-gray-100 dark:bg-gray-800"></div>
                                <div>
                                    <label class="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-2">${t.label_search_provider || 'Поисковый провайдер'}</label>
                                    <select id="inp-search-provider" onchange="SettingsController.updateSearchProviderParams()" class="w-full p-2 bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                                        <option value="none" ${isOpt(s.search_provider, 'none')}>${t.label_provider_none || 'Отключено'}</option>
                                        <option value="tavily" ${isOpt(s.search_provider, 'tavily')}>${t.label_provider_tavily || 'Tavily API'}</option>
                                        <option value="searxng" ${isOpt(s.search_provider, 'searxng')}>${t.label_provider_searxng || 'SearXNG'}</option>
                                    </select>
                                </div>
                                <div id="search-params-container" class="space-y-4 pt-2">
                                    <div id="params-tavily" class="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 space-y-4 ${s.search_provider === 'tavily' ? '' : 'hidden'}">
                                        <div class="flex items-center gap-2 text-xs font-bold text-aru-500"><i data-lucide="key" class="w-4 h-4"></i> Tavily</div>
                                        <div class="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-[10px] rounded-lg border border-blue-100 dark:border-blue-800/30">
                                            <i data-lucide="info" class="w-3 h-3 inline-block mr-1 align-text-bottom"></i> ${t.hint_tavily_limit || 'Облачный API. В бесплатном тарифе 1000 запросов.'}
                                        </div>
                                        <div>
                                            <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.label_tavily_key || 'Tavily API Key'}</label>
                                            <input type="password" id="inp-tavily-key" value="${s.tavily_key || ''}" class="w-full p-2 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                                        </div>
                                    </div>
                                    <div id="params-searxng" class="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 space-y-4 ${s.search_provider === 'searxng' ? '' : 'hidden'}">
                                        <div class="flex items-center gap-2 text-xs font-bold text-aru-500"><i data-lucide="server" class="w-4 h-4"></i> SearXNG</div>
                                        <div class="p-2 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 text-[10px] rounded-lg border border-yellow-100 dark:border-yellow-800/30">
                                            <i data-lucide="info" class="w-3 h-3 inline-block mr-1 align-text-bottom"></i> ${t.hint_searxng_cors || 'Убедитесь, что ваш инстанс SearXNG отправляет заголовки CORS и возвращает формат JSON.'}
                                        </div>
                                        <div>
                                            <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.label_searxng_url || 'Instance URL'}</label>
                                            <input type="text" id="inp-searxng-url" value="${s.searxng_url || ''}" placeholder="https://searx.be" class="w-full p-2 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                                        </div>
                                    </div>
                                </div>
                                <div class="h-px bg-gray-100 dark:bg-gray-800"></div>
                                <div class="p-4 bg-white dark:bg-gray-800 rounded-xl border border-orange-100 dark:border-orange-900/30 space-y-4">
                                    <div class="flex items-center gap-2 text-xs font-bold text-orange-500 uppercase tracking-widest">
                                        <i data-lucide="share-2" class="w-4 h-4"></i>
                                        ${t.label_transfer_settings || 'Data Transfer (WebRTC)'}
                                    </div>
                                    <div>
                                        <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.label_stun_server || 'STUN Server'}</label>
                                        <select id="inp-stun-strategy" onchange="SettingsController.updateTransferParams()" class="w-full p-2 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                                            <option value="default" ${!s.stun_server || s.stun_server.includes('google') ? 'selected' : ''}>${t.label_stun_default || 'Google (По умолчанию)'}</option>
                                            <option value="custom" ${s.stun_server && !s.stun_server.includes('google') ? 'selected' : ''}>${t.label_stun_custom || 'Свой STUN сервер'}</option>
                                        </select>
                                        <input type="text" id="inp-stun-custom" value="${s.stun_server || ''}" placeholder="stun:myserver.com:3478" class="w-full mt-2 p-2 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200 ${!s.stun_server || s.stun_server.includes('google') ? 'hidden' : ''}">
                                    </div>
                                    <div>
                                        <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.label_signaling_server || 'Signaling Server'}</label>
                                        <select id="inp-signaling-strategy" onchange="SettingsController.updateTransferParams()" class="w-full p-2 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                                            <option value="default" ${!s.signaling_server || s.signaling_server === 'peerjs-default' ? 'selected' : ''}>${t.label_signaling_default || 'PeerJS Cloud (По умолчанию)'}</option>
                                            <option value="custom" ${s.signaling_server && s.signaling_server !== 'peerjs-default' ? 'selected' : ''}>${t.label_signaling_custom || 'Свой сервер'}</option>
                                        </select>
                                        <input type="text" id="inp-signaling-custom" value="${s.signaling_server || ''}" placeholder="my-signaling-id" class="w-full mt-2 p-2 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200 ${!s.signaling_server || s.signaling_server === 'peerjs-default' ? 'hidden' : ''}">
                                        <p class="text-[9px] text-gray-400 mt-1">${t.hint_signaling_server || 'PeerJS Cloud (peerjs-default) or custom server.'}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Storage Tab -->
                    <div id="tab-storage" class="tab-content hidden space-y-4 animate-fade-in">
                        <!-- Filled dynamically by SettingsController.renderStorageTab() -->
                    </div>

                    <!-- Security & Biometrics Tab -->
                    <div id="tab-security" class="tab-content hidden space-y-6 animate-fade-in">
                        <div class="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-6 border border-gray-100 dark:border-gray-800 space-y-5">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-xl bg-aru-100 dark:bg-aru-900/40 text-aru-600 dark:text-aru-400 flex items-center justify-center">
                                    <i data-lucide="fingerprint" class="w-6 h-6"></i>
                                </div>
                                <div>
                                    <h4 class="text-base font-bold text-gray-800 dark:text-white">${t.settings_security_biometrics_title || 'Вход по биометрии'}</h4>
                                    <p class="text-xs text-gray-400">${t.settings_security_biometrics_desc || 'Используйте Touch ID, Face ID или системный сканер для быстрого входа в базу и доступа к настройкам.'}</p>
                                </div>
                            </div>

                            ${Auth.isWebAuthnSupported() ? `
                            <div class="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 flex items-center justify-between gap-4">
                                <div class="space-y-0.5">
                                    <label class="text-xs font-bold text-gray-700 dark:text-gray-200 block">${t.settings_security_biometrics_toggle || 'Разрешить биометрию на этом устройстве'}</label>
                                    <p class="text-[11px] text-gray-400">${Auth.hasBiometrics(DB.dbPath || 'default') ? (t.toast_biometrics_enabled || 'Биометрия активна') : (t.toast_biometrics_disabled || 'Биометрия не настроена')}</p>
                                </div>
                                <label class="relative inline-flex items-center cursor-pointer flex-shrink-0">
                                    <input type="checkbox" id="inp-biometrics-toggle" onchange="SettingsController.toggleBiometrics(this.checked)" ${Auth.hasBiometrics(DB.dbPath || 'default') ? 'checked' : ''} class="sr-only peer">
                                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-aru-500"></div>
                                </label>
                            </div>
                            ` : `
                            <div class="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 text-xs flex gap-2.5">
                                <i data-lucide="alert-triangle" class="w-4 h-4 flex-shrink-0 mt-0.5"></i>
                                <span>${t.settings_security_not_supported || 'Биометрическая аутентификация (WebAuthn) не поддерживается в этом браузере или отключена на устройстве.'}</span>
                            </div>
                            `}
                        </div>

                        <!-- Master Password Card -->
                        <div class="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-6 border border-gray-100 dark:border-gray-800 space-y-5">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-xl bg-aru-100 dark:bg-aru-900/40 text-aru-600 dark:text-aru-400 flex items-center justify-center">
                                    <i data-lucide="key-round" class="w-6 h-6"></i>
                                </div>
                                <div>
                                    <h4 class="text-base font-bold text-gray-800 dark:text-white">${t.settings_security_password_title || 'Пароль базы'}</h4>
                                    <p class="text-xs text-gray-400">${t.settings_security_password_desc || 'Мастер-пароль используется для входа в базу, доступа к настройкам и шифрования облачного профиля.'}</p>
                                </div>
                            </div>

                            <div class="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 space-y-3">
                                <div>
                                    <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.settings_security_password_current || 'Текущий пароль'}</label>
                                    <input type="password" id="inp-pwd-current" autocomplete="current-password" class="w-full p-2 bg-gray-50 dark:bg-gray-950 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                                </div>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                        <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.settings_security_password_new || 'Новый пароль'}</label>
                                        <input type="password" id="inp-pwd-new" autocomplete="new-password" class="w-full p-2 bg-gray-50 dark:bg-gray-950 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                                    </div>
                                    <div>
                                        <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.settings_security_password_repeat || 'Повторите новый пароль'}</label>
                                        <input type="password" id="inp-pwd-confirm" autocomplete="new-password" class="w-full p-2 bg-gray-50 dark:bg-gray-950 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                                    </div>
                                </div>
                                <div class="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 text-[11px] flex gap-2.5">
                                    <i data-lucide="alert-triangle" class="w-4 h-4 flex-shrink-0 mt-0.5"></i>
                                    <span>${t.settings_security_password_hint || 'Пароль нельзя восстановить. После смены потребуется заново подтвердить биометрию, а облачный профиль будет перешифрован новым паролем.'}</span>
                                </div>
                                <button onclick="SettingsController.changeDbPassword()" class="w-full py-3 rounded-xl bg-aru-500 hover:bg-aru-600 text-white font-bold text-sm transition flex items-center justify-center gap-2 active:scale-95">
                                    <i data-lucide="key" class="w-4 h-4"></i> ${t.settings_security_password_change || 'Изменить пароль'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="p-4 border-t border-gray-100 dark:border-gray-800 flex justify-end bg-gray-50 dark:bg-gray-900/50">
                    <button onclick="app.saveAllSettings()" class="px-6 py-2 bg-aru-500 hover:bg-aru-600 text-white rounded-xl font-bold transition shadow-lg shadow-aru-500/20 active:scale-95">
                        ${t.btn_save_settings_short || 'Сохранить'}
                    </button>
                </div>
            </div>
        </div>`;

        modalContainer.innerHTML = html;
        SettingsController.app.applyTranslations(modalContainer);
        lucide.createIcons();
        SettingsController.renderStateTab();
    },

    // --- State dashboard tab ---

    // Single source of truth for the mascot image and its caption, thresholds match Heuristics.getPersonalityPrompt()
    _moodProfile(mood) {
        const m = Number.isFinite(mood) ? mood : 50;
        if (m > 90) return { mascot: 'wow', caption: 'state_mood_elated', fallback: 'В восторге' };
        if (m > 70) return { mascot: 'happy', caption: 'state_mood_happy', fallback: 'Весёлое' };
        if (m < 20) return { mascot: 'sad', caption: 'state_mood_angry', fallback: 'Раздражённое' };
        if (m < 40) return { mascot: 'please', caption: 'state_mood_sad', fallback: 'Грустное' };
        return { mascot: 'normal', caption: 'state_mood_normal', fallback: 'Спокойное' };
    },

    renderStateTab: async () => {
        const el = document.getElementById('tab-state');
        if (!el) return;

        const t = state.translations || {};
        const s = state.userSettings;
        const p = state.personality;
        const stats = DB.getStats();
        const profile = SettingsController._moodProfile(p.mood);
        const num = (n) => Number(n || 0).toLocaleString(state.lang || undefined);

        const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

        const metricRow = (label, value, color) => `
            <div class="space-y-1.5">
                <div class="flex items-center justify-between text-[11px]">
                    <span class="font-bold text-gray-500 dark:text-gray-400">${label}</span>
                    <b class="text-gray-700 dark:text-gray-200">${clamp(value)}</b>
                </div>
                <div class="h-1.5 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div class="h-full ${color} transition-all duration-500" style="width: ${clamp(value)}%"></div>
                </div>
            </div>`;

        const tile = (icon, value, label) => `
            <div class="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 space-y-1.5">
                <i data-lucide="${icon}" class="w-4 h-4 text-aru-500"></i>
                <div class="text-xl font-bold text-gray-800 dark:text-white">${value}</div>
                <div class="text-[10px] font-bold uppercase tracking-wider text-gray-400 leading-tight">${label}</div>
            </div>`;

        const onOff = (isOn, onLabel, offLabel) => isOn
            ? `<span class="text-emerald-600 dark:text-emerald-400">${onLabel}</span>`
            : `<span class="text-gray-400">${offLabel}</span>`;

        const infoRow = (icon, label, value) => `
            <div class="flex items-center justify-between gap-3 py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                <span class="flex items-center gap-2.5 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                    <i data-lucide="${icon}" class="w-4 h-4 text-aru-500"></i>
                    ${label}
                </span>
                <b class="text-xs text-gray-800 dark:text-gray-200 text-right truncate">${value}</b>
            </div>`;

        // Resolves the active model label from the selected provider
        const llmType = s.llm_type || 'gemini';
        const providerName = llmType === 'gemini' ? 'Google Gemini' : (llmType === 'openrouter' ? 'OpenRouter' : 'Custom API');
        const modelName = (llmType === 'gemini' ? s.gemini_model : llmType === 'openrouter' ? s.openrouter_model : s.custom_model) || '';
        const isConfigured = llmType === 'custom' ? !!s.custom_url : !!(llmType === 'gemini' ? s.gemini_key : s.openrouter_key);
        const modelLabel = !isConfigured
            ? `<span class="text-gray-400">${t.state_model_not_set || 'Не настроена'}</span>`
            : (modelName ? `${providerName} · ${modelName}` : providerName);

        const searchProvider = s.search_provider || 'none';
        const searchOn = searchProvider !== 'none';
        const searchName = searchProvider === 'tavily' ? 'Tavily' : (searchProvider === 'searxng' ? 'SearXNG' : searchProvider);
        const searchLabel = searchOn
            ? `<span class="text-emerald-600 dark:text-emerald-400">${t.state_on || 'Вкл'} · ${searchName}</span>`
            : onOff(false, '', t.state_off || 'Выкл');

        const bioOn = s.biometrics_enabled === 'true' && Auth.hasBiometrics(DB.dbPath || 'default');

        // Storage locations stack: the DB always lives in the browser cache, a local file and a cloud copy are additive
        const RS = window.RemoteStorage;
        const cloudConfigured = RS ? await RS.isConfigured() : false;
        const locations = [`<i data-lucide="hard-drive" class="w-3.5 h-3.5 inline-block text-gray-400"></i> ${t.state_storage_cache || 'Кэш браузера'}`];
        if (DB.fileHandle) locations.push(`<i data-lucide="file" class="w-3.5 h-3.5 inline-block text-gray-400"></i> ${t.state_storage_file || 'Файл'}`);
        if (cloudConfigured) {
            const cloudName = RS.isUnlocked() ? (RS.displayName() || t.state_storage_cloud || 'Облако') : (t.state_storage_cloud_locked || 'Облако (заблокировано)');
            locations.push(`<i data-lucide="cloud" class="w-3.5 h-3.5 inline-block text-gray-400"></i> ${cloudName}`);
        }

        el.innerHTML = `
            <div class="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-6 border border-gray-100 dark:border-gray-800 space-y-5">
                <div class="flex items-center gap-5">
                    <img src="media/emotions/${profile.mascot}.png" alt="Aru" class="w-24 h-24 object-contain flex-shrink-0 drop-shadow-sm">
                    <div class="min-w-0">
                        <div class="text-[10px] font-bold uppercase tracking-widest text-gray-400">${t.state_mood_title || 'Настроение Ару'}</div>
                        <div class="text-3xl font-bold text-gray-800 dark:text-white leading-tight">${clamp(p.mood)}<span class="text-sm font-bold text-gray-400">/100</span></div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">${t[profile.caption] || profile.fallback}</div>
                    </div>
                </div>
                <div class="space-y-3">
                    ${metricRow(t.personality_mood || 'Настроение', p.mood, 'bg-aru-500')}
                    ${metricRow(t.personality_sarcasm || 'Сарказм', p.sarcasm, 'bg-purple-500')}
                    ${metricRow(t.personality_humor || 'Юмор', p.humor, 'bg-amber-500')}
                    ${metricRow(t.personality_affinity || 'Привязанность', p.affinity, 'bg-pink-500')}
                </div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                ${tile('brain', num(stats.facts), t.state_stat_facts || 'Фактов в памяти')}
                ${tile('messages-square', num(stats.chats), t.state_stat_chats || 'Чатов в базе')}
                ${tile('send', num(stats.messagesSent), t.state_stat_sent || 'Отправлено')}
                ${tile('inbox', num(stats.messagesReceived), t.state_stat_received || 'Получено')}
            </div>

            <div class="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-5 border border-gray-100 dark:border-gray-800">
                <h4 class="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2 mb-2">
                    <i data-lucide="activity" class="w-4 h-4 text-aru-500"></i>
                    ${t.state_system_title || 'Система'}
                </h4>
                ${infoRow('cpu', t.state_label_model || 'Модель', modelLabel)}
                ${infoRow('search', t.state_label_search || 'Поиск в интернете', searchLabel)}
                ${infoRow('fingerprint', t.state_label_biometrics || 'Биометрия', onOff(bioOn, t.state_on || 'Вкл', t.state_off || 'Выкл'))}
                <div class="py-2.5">
                    <div class="flex items-center gap-2.5 text-xs text-gray-500 dark:text-gray-400 mb-2">
                        <i data-lucide="database" class="w-4 h-4 text-aru-500"></i>
                        ${t.state_label_storage || 'Где хранится база'}
                    </div>
                    <div class="flex flex-wrap gap-2">
                        ${locations.map(l => `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg text-[11px] font-bold text-gray-700 dark:text-gray-300">${l}</span>`).join('')}
                    </div>
                </div>
            </div>`;

        if (window.lucide) lucide.createIcons();
    },

    // --- Remote Storage tab ---

    renderStorageTab: async () => {
        const el = document.getElementById('tab-storage');
        if (!el) return;
        const t = state.translations || {};
        const s = state.userSettings;
        const RS = window.RemoteStorage;
        const isOpt = (curr, val) => (curr === val ? 'selected' : '');
        const p = SettingsController._storageProvider;

        const privacyNote = `
            <div class="p-3 bg-aru-50 dark:bg-aru-900/20 rounded-xl text-[11px] text-aru-700 dark:text-aru-300 border border-aru-100 dark:border-aru-900/40 flex gap-2">
                <i data-lucide="shield-check" class="w-4 h-4 flex-shrink-0 mt-0.5"></i>
                <span>${t.storage_privacy_note || 'Ключи шифруются на этом устройстве мастер-паролем и никуда не отправляются в открытом виде. Сам файл базы ключей не содержит - его можно копировать, переносить и переподключать свободно.'}</span>
            </div>`;

        const gdriveFields = `
            <div class="space-y-3">
                <div class="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-[11px] rounded-xl border border-blue-100 dark:border-blue-800/40 space-y-1.5">
                    <div class="font-bold flex items-center gap-1.5"><i data-lucide="info" class="w-3.5 h-3.5 text-blue-500"></i> ${t.remote_gdrive_hint_title || 'Подключение Google Drive (BYOK):'}</div>
                    <ol class="list-decimal list-inside space-y-1 text-[10px] text-blue-600 dark:text-blue-300/80">
                        <li>${t.remote_gdrive_step1 || 'В <a href="https://console.cloud.google.com/" target="_blank" class="underline font-semibold">Google Cloud Console</a> создайте проект и включите <b>Google Drive API</b>.'}</li>
                        <li>${t.remote_gdrive_step2 || 'В <b>OAuth consent screen</b> добавьте область <code>.../auth/drive.file</code> (или тестового пользователя).'}</li>
                        <li>${t.remote_gdrive_step3 || 'В <b>Credentials</b> создайте <b>OAuth Client ID</b> (тип <b>Web application</b>).'}</li>
                        <li>${t.remote_gdrive_step4 || 'В поле <b>Authorized JavaScript origins</b> добавьте адрес ниже:'}</li>
                    </ol>
                    <div class="flex items-center justify-between bg-white dark:bg-gray-900 px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 text-[10px]">
                        <span class="font-mono text-gray-700 dark:text-gray-300 select-all">${window.location.origin}</span>
                        <button type="button" onclick="navigator.clipboard.writeText(window.location.origin); UI.showToast(window.aruState?.translations?.copied || 'Скопировано');" class="text-blue-600 dark:text-blue-400 font-bold hover:underline ml-2">${t.action_copy || 'Copy'}</button>
                    </div>
                </div>
                <div>
                    <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.remote_label_client_id || 'Client ID'}</label>
                    <input type="text" id="st-gdrive-client" placeholder="xxxxxxxx.apps.googleusercontent.com" class="w-full p-2 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                </div>
                <button onclick="SettingsController.storageAuthorizeGdrive()" class="w-full py-3 rounded-xl bg-aru-500 hover:bg-aru-600 text-white font-bold text-sm transition flex items-center justify-center gap-2">
                    <i data-lucide="key" class="w-4 h-4"></i> ${t.remote_btn_google || 'Авторизовать Google Drive'}
                </button>
            </div>`;

        const webdavFields = `
            <div class="space-y-3">
                <div class="p-3 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 text-[11px] rounded-xl border border-purple-100 dark:border-purple-800/40 space-y-1.5">
                    <div class="font-bold flex items-center gap-1.5"><i data-lucide="info" class="w-3.5 h-3.5 text-purple-500"></i> ${t.remote_webdav_hint_title || 'Подключение WebDAV:'}</div>
                    <p class="text-[10px] leading-relaxed text-purple-600 dark:text-purple-300/80">${t.remote_webdav_hint || 'Поддерживается Nextcloud, ownCloud, Synology или любой WebDAV. В браузере (PWA) сервер WebDAV должен иметь включённый CORS (методы PROPFIND, MKCOL, заголовок Depth), либо используйте обратный прокси на своём сервере (напр. /webdav).'}</p>
                </div>
                <div>
                    <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.remote_label_webdav_url || 'URL сервера'}</label>
                    <input type="text" id="st-webdav-url" placeholder="https://cloud.example.com/remote.php/dav/files/me" class="w-full p-2 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.remote_label_webdav_user || 'Пользователь'}</label>
                        <input type="text" id="st-webdav-user" class="w-full p-2 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                    </div>
                    <div>
                        <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.remote_label_webdav_pass || 'Пароль / app-пароль'}</label>
                        <input type="password" id="st-webdav-pass" class="w-full p-2 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                    </div>
                </div>
                <div>
                    <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.remote_label_webdav_path || 'Папка (необязательно)'}</label>
                    <input type="text" id="st-webdav-path" placeholder="aru" class="w-full p-2 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                </div>
                <button onclick="SettingsController.storageConnectWebdav()" class="w-full py-3 rounded-xl bg-aru-500 hover:bg-aru-600 text-white font-bold text-sm transition flex items-center justify-center gap-2">
                    <i data-lucide="plug" class="w-4 h-4"></i> ${t.remote_btn_connect || 'Подключить'}
                </button>
            </div>`;

        let body = '';
        const configured = await RS.isConfigured();

        if (!configured) {
            body = `
                <div class="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-800 space-y-4">
                    <h4 class="text-sm font-bold flex items-center gap-2"><i data-lucide="cloud-off" class="w-4 h-4 text-gray-400"></i> ${t.storage_status_off || 'Облачное хранилище не подключено'}</h4>
                    <p class="text-xs text-gray-500">${t.storage_not_connected_desc || 'Подключите Google Drive или WebDAV, чтобы файл базы автоматически синхронизировался между устройствами. Подключение можно изменить или убрать в любой момент.'}</p>
                    <div class="flex p-1 bg-gray-100 dark:bg-gray-900 rounded-xl">
                        <button onclick="SettingsController.storageSetProvider('gdrive')" class="flex-1 py-2 px-1 rounded-lg text-[10px] font-bold transition ${p === 'webdav' ? 'text-gray-500' : 'bg-white dark:bg-aru-600 shadow-sm text-aru-600 dark:text-white'}">Google Drive</button>
                        <button onclick="SettingsController.storageSetProvider('webdav')" class="flex-1 py-2 px-1 rounded-lg text-[10px] font-bold transition ${p === 'webdav' ? 'bg-white dark:bg-aru-600 shadow-sm text-aru-600 dark:text-white' : 'text-gray-500'}">WebDAV</button>
                    </div>
                    ${p === 'gdrive' ? gdriveFields : webdavFields}
                </div>
                ${privacyNote}`;
        } else if (!RS.isUnlocked()) {
            body = `
                <div class="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-800 space-y-4">
                    <h4 class="text-sm font-bold flex items-center gap-2"><i data-lucide="lock" class="w-4 h-4 text-amber-500"></i> ${RS.displayName() || 'Хранилище'}</h4>
                    <p class="text-xs text-gray-500">${t.storage_locked_desc || 'Профиль хранилища зашифрован мастер-паролем на этом устройстве. Разблокируйте его, чтобы включить синхронизацию.'}</p>
                    <div class="flex gap-2">
                        <button onclick="SettingsController.storageUnlock()" class="flex-1 py-3 rounded-xl bg-aru-500 hover:bg-aru-600 text-white font-bold text-sm transition flex items-center justify-center gap-2">
                            <i data-lucide="unlock" class="w-4 h-4"></i> ${t.storage_unlock || 'Разблокировать'}
                        </button>
                        <button onclick="SettingsController.storageDisconnect()" class="px-4 py-3 rounded-xl border border-red-200 dark:border-red-900/40 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 font-bold text-sm transition flex items-center gap-2">
                            <i data-lucide="unplug" class="w-4 h-4"></i> ${t.storage_disconnect || 'Отключить'}
                        </button>
                    </div>
                </div>
                ${privacyNote}`;
        } else {
            const lastSync = RS.getLastSyncAt();
            const syncLabel = lastSync ? new Date(lastSync).toLocaleString() : (t.storage_never_synced || 'ещё не синхронизировано');
            body = `
                <div class="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-800 space-y-3">
                    <div class="flex items-center justify-between">
                        <h4 class="text-sm font-bold flex items-center gap-2"><i data-lucide="cloud" class="w-4 h-4 text-sky-500"></i> ${RS.displayName()}</h4>
                        <span class="text-[10px] font-bold text-sky-500 uppercase tracking-widest">${t.storage_status_on || 'Активно'}</span>
                    </div>
                    <div class="text-xs text-gray-500 space-y-1">
                        <div class="flex justify-between"><span>${t.storage_label_file || 'Файл'}</span><b class="text-gray-700 dark:text-gray-300">${RS.profile?.fileName || '—'}</b></div>
                        <div class="flex justify-between"><span>${t.storage_label_last_sync || 'Последняя синхронизация'}</span><b class="text-gray-700 dark:text-gray-300">${syncLabel}</b></div>
                    </div>
                </div>

                <div class="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-800 space-y-4">
                    <h4 class="text-sm font-bold flex items-center gap-2"><i data-lucide="refresh-cw" class="w-4 h-4 text-aru-500"></i> ${t.storage_sync_settings || 'Параметры синхронизации'}</h4>
                    <div>
                        <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.storage_label_sync_mode || 'Режим синхронизации'}</label>
                        <select id="inp-remote-sync-mode" class="w-full p-2 bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                            <option value="auto" ${isOpt(s.remote_sync_mode, 'auto')}>${t.storage_mode_auto || 'Авто (при каждом сохранении)'}</option>
                            <option value="manual" ${isOpt(s.remote_sync_mode, 'manual')}>${t.storage_mode_manual || 'Вручную'}</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.storage_label_conflict || 'При конфликте версий'}</label>
                        <select id="inp-remote-conflict" class="w-full p-2 bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                            <option value="ask" ${isOpt(s.remote_conflict, 'ask')}>${t.storage_conflict_ask || 'Спрашивать'}</option>
                            <option value="local" ${isOpt(s.remote_conflict, 'local')}>${t.storage_conflict_local || 'Локальная версия важнее'}</option>
                            <option value="remote" ${isOpt(s.remote_conflict, 'remote')}>${t.storage_conflict_remote || 'Удалённая версия важнее'}</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold text-gray-500 uppercase block mb-1">${t.storage_label_poll || 'Проверка изменений (минут, 0 - выкл.)'}</label>
                        <input type="number" min="0" id="inp-remote-poll" value="${s.remote_poll || '0'}" class="w-full p-2 bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-lg text-xs outline-none focus:border-aru-500 dark:text-gray-200">
                    </div>
                    <p class="text-[10px] text-gray-400">${t.storage_conflict_hint || 'Блокировки базы между устройствами нет: побеждает версия, сохранённая позже. При сомнениях скачивайте удалённую копию отдельным файлом.'}</p>
                </div>

                <div class="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-800 space-y-3">
                    <div class="grid grid-cols-2 gap-2">
                        <button onclick="SettingsController.storageSyncNow()" class="py-3 rounded-xl bg-aru-500 hover:bg-aru-600 text-white font-bold text-xs transition flex items-center justify-center gap-2">
                            <i data-lucide="upload-cloud" class="w-4 h-4"></i> ${t.storage_sync_now || 'Синхронизировать'}
                        </button>
                        <button onclick="SettingsController.storageCheckRemote()" class="py-3 rounded-xl bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 hover:border-aru-400 font-bold text-xs text-gray-600 dark:text-gray-300 transition flex items-center justify-center gap-2">
                            <i data-lucide="download-cloud" class="w-4 h-4"></i> ${t.storage_check_remote || 'Проверить удалённо'}
                        </button>
                    </div>
                    <button onclick="SettingsController.storageDisconnect()" class="w-full py-3 rounded-xl border border-red-200 dark:border-red-900/40 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 font-bold text-xs transition flex items-center justify-center gap-2">
                        <i data-lucide="unplug" class="w-4 h-4"></i> ${t.storage_disconnect || 'Отключить хранилище'}
                    </button>
                </div>
                ${privacyNote}`;
        }

        el.innerHTML = body;
        if (window.lucide) lucide.createIcons();
    },

    storageSetProvider: (p) => {
        SettingsController._storageProvider = p;
        SettingsController.renderStorageTab();
    },

    storageAuthorizeGdrive: async () => {
        const t = state.translations || {};
        const clientId = document.getElementById('st-gdrive-client')?.value.trim();
        if (!clientId) return alert(t.remote_alert_client_id || 'Введите Client ID вашего Google Cloud проекта');
        try {
            const tokens = await RemoteAdapters.gdrive.authorize(clientId);
            const profile = {
                type: 'gdrive',
                clientId,
                accessToken: tokens.accessToken,
                accessTokenExp: Date.now() + (tokens.expiresIn || 3600) * 1000,
                fileName: 'aru_database.sqlite',
                createdAt: Date.now()
            };
            SettingsController.app.promptPassword(async (pwd) => {
                try {
                    await RemoteStorage.saveProfile(profile, pwd);
                    await SettingsController.app.refreshRemoteSync();
                    await SettingsController.app.completeRemoteLink();
                    SettingsController.renderStorageTab();
                } catch (e) {
                    alert((t.remote_error_setup || 'Не удалось настроить облачное хранилище') + ': ' + e.message);
                }
            });
        } catch (e) {
            console.error('Google authorization error:', e);
            alert((t.remote_error_setup || 'Ошибка авторизации Google') + ': ' + e.message);
        }
    },

    storageConnectWebdav: () => {
        const t = state.translations || {};
        const url = document.getElementById('st-webdav-url')?.value.trim();
        const username = document.getElementById('st-webdav-user')?.value.trim();
        const password = document.getElementById('st-webdav-pass')?.value;
        const davPath = document.getElementById('st-webdav-path')?.value.trim();
        if (!url || !username || !password) return alert(t.remote_alert_webdav_fields || 'Заполните URL, имя пользователя и пароль');
        const profile = { type: 'webdav', url, username, password, davPath, fileName: 'aru_database.sqlite', createdAt: Date.now() };
        SettingsController.app.promptPassword(async (pwd) => {
            try {
                await RemoteStorage.saveProfile(profile, pwd);
                await SettingsController.app.refreshRemoteSync();
                await SettingsController.app.completeRemoteLink();
                SettingsController.renderStorageTab();
            } catch (e) {
                alert((t.remote_error_setup || 'Не удалось настроить облачное хранилище') + ': ' + e.message);
            }
        });
    },

    storageUnlock: () => {
        const t = state.translations || {};
        SettingsController.app.promptPassword(async (pwd) => {
            try {
                await RemoteStorage.unlock(pwd);
                await SettingsController.app.refreshRemoteSync();
            } catch (e) {
                console.warn('storageUnlock failed', e);
                alert(t.storage_unlock_failed || 'Не удалось разблокировать хранилище. Используется тот же пароль, что и у базы данных.');
            }
            SettingsController.renderStorageTab();
        });
    },

    storageSyncNow: async () => {
        try {
            await RemoteStorage.pushNow(DB.db.export());
        } catch (e) {
            alert(e.message);
        }
        SettingsController.renderStorageTab();
    },

    storageCheckRemote: async () => {
        const t = state.translations || {};
        try {
            const localTS = parseInt((DB.getSettings() || {}).last_save_ts) || 0;
            const cmp = await RemoteStorage.compareWithRemote(localTS);
            if (cmp === 'remote') {
                const info = await RemoteStorage.getRemoteInfo();
                const choice = await RemoteStorage.showConflictDialog(info);
                if (choice === 'remote') {
                    await DB.applyRemoteBytes(await RemoteStorage.pullBytes());
                } else if (choice === 'local') {
                    await RemoteStorage.pushNow(DB.db.export());
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
            } else {
                alert(t.storage_check_ok || 'Удалённая копия актуальна, расхождений нет.');
            }
        } catch (e) {
            alert(e.message);
        }
        SettingsController.renderStorageTab();
    },

    storageDisconnect: async () => {
        const t = state.translations || {};
        if (!confirm(t.storage_disconnect_confirm || 'Отключить облачное хранилище? Локальная база останется на этом устройстве, файл на сервере не удаляется.')) return;
        await RemoteStorage.disconnect();
        SettingsController.app.updateSyncStatus('synced');
        SettingsController.renderStorageTab();
    },

    toggleBiometrics: async (enable) => {
        const t = state.translations || {};
        const dbKey = DB.dbPath || 'default';
        if (enable) {
            SettingsController.app.promptPassword(async (pwd) => {
                try {
                    await Auth.registerBiometrics(pwd, dbKey, state.userSettings?.user_name || 'Aru User');
                    DB.saveSetting('biometrics_enabled', 'true');
                    alert(t.toast_biometrics_enabled || 'Биометрия успешно подключена!');
                } catch (e) {
                    console.error('Error enabling biometrics', e);
                    const toggle = document.getElementById('inp-biometrics-toggle');
                    if (toggle) toggle.checked = false;
                    if (e.name !== 'NotAllowedError') {
                        alert((t.alert_biometrics_failed || 'Ошибка биометрии: ') + e.message);
                    }
                }
                SettingsController.switchTab('security');
            });
        } else {
            Auth.removeBiometrics(dbKey);
            DB.saveSetting('biometrics_enabled', 'false');
            alert(t.toast_biometrics_disabled || 'Биометрия отключена на этом устройстве.');
            SettingsController.switchTab('security');
        }
    },

    changeDbPassword: async () => {
        const t = state.translations || {};
        const dbKey = DB.dbPath || 'default';
        const currentEl = document.getElementById('inp-pwd-current');
        const newEl = document.getElementById('inp-pwd-new');
        const confirmEl = document.getElementById('inp-pwd-confirm');
        if (!currentEl || !newEl || !confirmEl) return;

        const current = currentEl.value;
        const next = newEl.value;

        if (!current || !next || !confirmEl.value) {
            alert(t.alert_password_fields_required || 'Заполните все поля пароля.');
            return;
        }
        if (next !== confirmEl.value) {
            alert(t.alert_password_mismatch || 'Новый пароль и подтверждение не совпадают.');
            return;
        }
        if (next.length < 6) {
            alert(t.alert_password_short || 'Пароль слишком короткий - минимум 6 символов.');
            return;
        }
        if (next === current) {
            alert(t.alert_password_same || 'Новый пароль совпадает с текущим.');
            return;
        }

        const valid = await Auth.verifyPassword(current, state.userSettings.db_password);
        if (!valid) {
            alert(t.alert_wrong_password || 'Неверный пароль');
            currentEl.value = '';
            currentEl.focus();
            return;
        }

        // A locked cloud profile is sealed with the old password and becomes undecryptable after the change
        const RS = window.RemoteStorage;
        const cloudConfigured = RS ? await RS.isConfigured() : false;
        if (cloudConfigured && !RS.isUnlocked()) {
            if (!confirm(t.alert_password_cloud_locked || 'Облачное хранилище подключено, но заблокировано. После смены пароля разблокировать его не получится - придётся подключить заново. Продолжить?')) return;
        }

        try {
            const hash = await Auth.hashPassword(next);
            DB.saveSetting('db_password', hash);
            await DB.save();
            state.userSettings = { ...state.userSettings, db_password: hash };

            if (cloudConfigured && RS.isUnlocked() && RS.profile) {
                try {
                    await RS.saveProfile(RS.profile, next);
                } catch (e) {
                    console.error('Failed to re-encrypt remote profile', e);
                    alert(t.alert_password_remote_failed || 'Пароль изменён, но облачный профиль не удалось перешифровать. Переподключите хранилище.');
                }
            }

            // The biometric record holds the old password encrypted, so it is re-registered with the new one
            if (Auth.hasBiometrics(dbKey)) {
                try {
                    await Auth.registerBiometrics(next, dbKey, state.userSettings?.user_name || 'Aru User');
                } catch (e) {
                    if (e.name !== 'NotAllowedError') console.error('Biometrics re-registration failed', e);
                    Auth.removeBiometrics(dbKey);
                    DB.saveSetting('biometrics_enabled', 'false');
                    alert(t.alert_password_bio_reset || 'Биометрию не удалось перерегистрировать - она отключена. Включите её заново.');
                }
            }

            alert(t.toast_password_changed || 'Пароль базы успешно изменён.');
            currentEl.value = '';
            newEl.value = '';
            confirmEl.value = '';
        } catch (e) {
            console.error('changeDbPassword failed', e);
            alert((t.alert_password_change_failed || 'Не удалось изменить пароль: ') + e.message);
        }
    },

    validateCustomUrl: (val) => {
        const warn = document.getElementById('mixed-content-warning');
        if (!warn) return;
        if (SettingsController.checkMixedContent(val)) {
            warn.classList.remove('hidden');
        } else {
            warn.classList.add('hidden');
        }
    },
};
