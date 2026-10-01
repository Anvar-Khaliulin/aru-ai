/*
---ARU-LAB.SPACE---ALMATY---2026---
Wizard and authentication controller managing onboarding, EULA, and database credentials setup.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { DB } from './db.js';
import { Auth } from './auth.js';
import { RemoteStorage, RemoteAdapters } from './remoteStorage.js';

export const WizardController = {
    app: null,
    init(appInstance) {
        WizardController.app = appInstance;
    },

    /**
     * Detect user intent to create artifact (game/app/doc/analytics) and synthesize a starter artifact.
     * Returns true if an artifact was created and rendered (no LLM call needed).
     */
    showEULA: async () => {
        const modalContainer = document.getElementById('modal-container');
        const t = state.translations || {};

        let html = `
        <div class="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4 overflow-hidden">
            <div class="bg-white dark:bg-slate-900 w-full max-w-4xl h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-white/10">
                <div class="flex-1 overflow-y-auto custom-scrollbar p-0" id="eula-content-frame">
                    <div class="flex items-center justify-center h-full">
                        <div class="w-8 h-8 border-4 border-aru-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                </div>
                <div class="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-center bg-slate-50 dark:bg-slate-900/50">
                    <button id="eula-confirm-btn" disabled class="px-8 py-3 bg-gray-300 dark:bg-slate-800 text-gray-500 rounded-xl font-bold transition-all flex items-center gap-3 cursor-not-allowed">
                        <span id="eula-btn-text">${t.eula_wait_prefix || 'Please wait'}... (20)</span>
                    </button>
                </div>
            </div>
        </div>`;

        modalContainer.innerHTML = html;
        const frame = document.getElementById('eula-content-frame');

        const updateUI = (lang) => {
            WizardController.app.updateEULALang(frame, lang);
        };

        try {
            const res = await fetch('rules.html');
            const text = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            const mainContent = doc.querySelector('main');
            if (mainContent) {
                frame.innerHTML = `<div class="p-6 md:p-10">${mainContent.innerHTML}</div>`;
                updateUI('en'); // Default to English content as per user request
                // Replace lucide placeholders with SVG icons inside injected EULA
                try { lucide.createIcons(); } catch (e) { console.warn('lucide.createIcons failed on EULA injection', e); }
            }
        } catch (e) {
            console.error('Failed to load EULA', e);
        }

        let seconds = 20;
        const btn = document.getElementById('eula-confirm-btn');
        const btnText = document.getElementById('eula-btn-text');

        const timer = setInterval(() => {
            seconds--;
            if (seconds > 0) {
                btnText.textContent = `${t.eula_wait_prefix || 'Please wait'}... (${seconds})`;
            } else {
                clearInterval(timer);
                btn.disabled = false;
                btn.classList.remove('bg-gray-300', 'dark:bg-slate-800', 'text-gray-500', 'cursor-not-allowed');
                btn.classList.add('bg-aru-500', 'hover:bg-aru-600', 'text-white', 'shadow-lg', 'shadow-aru-500/30');
                btnText.textContent = t.eula_confirm_btn || 'Confirm';
                btn.onclick = () => {
                    DB.saveSetting('rules', '1');
                    modalContainer.innerHTML = '';
                    WizardController.app.startSession(true);
                };
            }
        }, 1000);
    },

    updateEULALang: (container, forceLang) => {
        let lang = forceLang || state.lang || 'en';
        if (lang === 'kk') lang = 'kz';

        // Toggle text blocks
        container.querySelectorAll('.lang-node').forEach(node => {
            node.classList.remove('lang-active');
            if (node.id === 'lang-' + lang) node.classList.add('lang-active');
        });

        // Style buttons inside the container
        container.querySelectorAll('.eula-tab-btn').forEach(btn => {
            if (btn.id === 'btn-' + lang + '-inner') {
                btn.classList.add('bg-white', 'dark:bg-aru-600', 'shadow-sm', 'text-aru-600', 'dark:text-white');
                btn.classList.remove('text-slate-500');
            } else {
                btn.classList.remove('bg-white', 'dark:bg-aru-600', 'shadow-sm', 'text-aru-600', 'dark:text-white');
                btn.classList.add('text-slate-500');
            }
        });

        // Translate the whole modal if possible
        const modal = container.closest('.fixed');
        if (modal) {
            // Update modal title and confirm button via applyTranslations if they have data-i18n
            // or manually if they don't
            const currentT = state.allTranslations ? state.allTranslations[lang === 'kz' ? 'kk' : lang] : null;
            if (currentT) {
                const btn = modal.querySelector('#eula-confirm-btn');
                const btnText = modal.querySelector('#eula-btn-text');
                if (btn && btnText) {
                    const waitPrefix = currentT.eula_wait_prefix || 'Please wait';
                    const confirmText = currentT.eula_confirm_btn || 'Confirm';
                    // If button is still disabled, it shows timer. If not, it shows confirm.
                    // This is handled by the setInterval in showEULA, but let's update fallbacks.
                }

                // Re-run applyTranslations with forced language if we have it
                if (WizardController.app.applyTranslations) {
                    // Temporarily swap state.lang or pass lang
                    const oldLang = state.lang;
                    state.lang = (lang === 'kz' ? 'kk' : lang);
                    WizardController.app.applyTranslations(modal);
                    try { lucide.createIcons(); } catch (e) { console.warn('lucide.createIcons failed after applyTranslations', e); }
                    state.lang = oldLang;
                }
            }
        }
    },

    wizardData: {
        stage: 1, dbname: '', password: '', profile: 'adult', ai_type: 'gemini', api_key: '', base_url: '',
        storage: 'browser', gdrive_client_id: '', webdav_url: '', webdav_user: '', webdav_pass: '', webdav_path: ''
    },

    // In-memory only: a freshly authorized remote profile awaiting the DB password to be persisted encrypted
    _pendingRemoteProfile: null,
    _pendingLinkAfterLogin: false,

    openModal: (type) => {
        const modalContainer = document.getElementById('modal-container');
        let html = '';
        if (type === 'create') {
            WizardController.wizardData = {
                stage: 1, dbname: '', password: '', allow_biometrics: true, profile: 'adult',
                ai_type: 'gemini',
                gemini_key: '', gemini_model: 'gemini-2.5-flash',
                openrouter_key: '', openrouter_model: '', openrouter_url: 'https://openrouter.ai/api/v1/chat/completions',
                custom_key: '', custom_model: '', custom_url: '',
                storage: 'browser', gdrive_client_id: '', webdav_url: '', webdav_user: '', webdav_pass: '', webdav_path: ''
            };
            return WizardController.app.renderWizard();
        } else if (type === 'remote') {
            html = WizardController._renderRemoteConnect();
        } else if (type === 'login') {
            const hasFile = !!DB.fileHandle;
            const t = state.translations || {};
            html = `
            <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm fade-in p-4">
                <div class="bg-white dark:bg-gray-800 rounded-3xl w-full max-w-md p-8 shadow-2xl relative border border-gray-100 dark:border-gray-700 animate-fade-in-up">
                    <div class="flex flex-col items-center mb-6">
                        <div class="w-16 h-16 bg-aru-50 dark:bg-aru-900/30 rounded-2xl flex items-center justify-center text-aru-500 mb-4 shadow-inner">
                            <i data-lucide="${hasFile ? 'cloud-check' : 'lock'}" class="w-8 h-8"></i>
                        </div>
                        <h3 class="text-2xl font-bold dark:text-white" data-i18n="${hasFile ? 'login_title_continue' : 'login_title_entry'}">${hasFile ? (t.login_title_continue || 'Продолжить сессию') : (t.login_title_entry || 'Вход в систему')}</h3>
                        <p class="text-gray-400 text-xs mt-1 text-center" data-i18n="${hasFile ? 'login_desc_connected' : 'login_desc_enter_pwd'}">${hasFile ? (t.login_desc_connected || 'Ваша база подключена и синхронизирована с диском.') : (t.login_desc_enter_pwd || 'Введите пароль от вашей базы данных')}</p>
                    </div>
                    
                    <form onsubmit="app.handleLogin(event)" class="space-y-5">
                        <div class="space-y-2">
                            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1" data-i18n="label_master_password">${t.label_master_password || 'Мастер-пароль'}</label>
                            <input type="password" name="password" required autofocus class="w-full p-4 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl focus:border-aru-500 outline-none dark:text-white transition-all text-sm" placeholder="••••••••">
                        </div>

                        <button type="submit" class="w-full py-4 bg-aru-500 hover:bg-aru-600 text-white rounded-2xl font-bold transition-all shadow-lg shadow-aru-500/20 flex items-center justify-center gap-2">
                            <span data-i18n="btn_login_aru">${t.btn_login_aru || 'Зайти в Ару'}</span> <i data-lucide="arrow-right" class="w-4 h-4"></i>
                        </button>

                        ${Auth.isWebAuthnSupported() && Auth.hasBiometrics(DB.dbPath || 'default') ? `
                        <button type="button" onclick="app.loginWithBiometrics()" class="w-full py-3.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white rounded-2xl font-bold transition flex items-center justify-center gap-2">
                            <i data-lucide="fingerprint" class="w-5 h-5 text-aru-500"></i>
                            <span data-i18n="btn_login_biometrics">${t.btn_login_biometrics || 'Войти по биометрии'}</span>
                        </button>` : ''}

                        <div class="text-center pt-4 border-t border-gray-50 dark:border-gray-800 flex justify-between">
                                      <button type="button" onclick="app.handleOpenDBPicker()" class="text-[10px] font-bold text-aru-500 hover:underline uppercase tracking-widest transition-opacity">
                                          <i data-lucide="file-search" class="w-3 h-3 inline"></i> <span data-i18n="btn_select_file">${t.btn_select_file || 'Выбрать файл'}</span>
                                      </button>
                                      <button type="button" onclick="app.disconnectDB()" class="text-[10px] font-bold text-red-400 hover:text-red-500 uppercase tracking-widest transition-opacity">
                                          <i data-lucide="log-out" class="w-3 h-3 inline"></i> <span data-i18n="btn_disconnect">${t.btn_disconnect || 'Отключить'}</span>
                                      </button>
                        </div>
                    </form>
                    <button onclick="document.getElementById('modal-container').innerHTML=''" class="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 transition-colors">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </button>
                </div>
            </div>`;
        } else if (type === 'import') {
            const t = state.translations || {};
            html = `
            <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm fade-in p-4">
                <div class="bg-white dark:bg-gray-800 rounded-3xl w-full max-w-md p-8 shadow-2xl relative border border-gray-100 dark:border-gray-700 animate-fade-in-up">
                    <div class="flex flex-col items-center mb-6">
                        <div class="w-16 h-16 bg-aru-50 dark:bg-aru-900/30 rounded-2xl flex items-center justify-center text-aru-500 mb-4 shadow-inner">
                            <i data-lucide="file-up" class="w-8 h-8"></i>
                        </div>
                        <h3 class="text-2xl font-bold dark:text-white" data-i18n="import_title">${t.import_title || 'Импорт базы'}</h3>
                        <p class="text-gray-400 text-xs mt-1" data-i18n="import_desc">${t.import_desc || 'Выберите файл .sqlite и введите его пароль'}</p>
                    </div>
                    
                    <form onsubmit="app.handleImportDB(event)" class="space-y-5">
                        <div class="space-y-2">
                             <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1" data-i18n="label_db_file">${t.label_db_file || 'Файл базы (.sqlite)'}</label>
                             <input type="file" id="open-file" accept=".sqlite,.db" required class="w-full text-xs p-3 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl focus:border-aru-500 cursor-pointer">
                        </div>

                        <div class="space-y-2">
                            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1" data-i18n="label_file_password">${t.label_file_password || 'Пароль от файла'}</label>
                            <input type="password" name="password" required class="w-full p-4 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl focus:border-aru-500 outline-none dark:text-white text-sm" placeholder="••••••••">
                        </div>

                        <button type="submit" class="w-full py-4 bg-aru-500 hover:bg-aru-600 text-white rounded-2xl font-bold transition-all shadow-lg shadow-aru-500/20">
                            <span data-i18n="btn_import_open">${t.btn_import_open || 'Импортировать и Открыть'}</span>
                        </button>
                        
                        <div class="text-center pt-2">
                            <button type="button" onclick="app.openModal('login')" class="text-[10px] font-bold text-gray-400 hover:text-aru-500 uppercase">
                                <span data-i18n="btn_back_to_login">${t.btn_back_to_login || 'Назад к входу'}</span>
                            </button>
                        </div>
                    </form>
                    <button onclick="document.getElementById('modal-container').innerHTML=''" class="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 transition-colors">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </button>
                </div>
            </div>`;
        }
        modalContainer.innerHTML = html;
        WizardController.app.applyTranslations(modalContainer);
        lucide.createIcons();
    },

    // --- Remote connect modal (auth screen "Google Drive / WebDAV" button) ---

    _setRemoteProvider: (p) => {
        WizardController.wizardData.remoteProvider = p;
        document.getElementById('rc-tab-gdrive').className = 'flex-1 py-2 px-1 rounded-lg text-[10px] font-bold transition ' + (p === 'gdrive' ? 'bg-white shadow-sm text-aru-600' : 'text-gray-500');
        document.getElementById('rc-tab-webdav').className = 'flex-1 py-2 px-1 rounded-lg text-[10px] font-bold transition ' + (p === 'webdav' ? 'bg-white shadow-sm text-aru-600' : 'text-gray-500');
        document.getElementById('remote-connect-body').innerHTML = WizardController._renderRemoteConnectBody();
        lucide.createIcons();
    },

    _renderRemoteConnectBody: () => {
        const t = state.translations || {};
        const d = WizardController.wizardData;
        const inputCls = 'w-full p-3 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl focus:border-aru-500 outline-none dark:text-white text-sm';
        const labelCls = 'text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block';
        if (d.remoteProvider === 'webdav') {
            return `
            <div class="space-y-3">
                <div><label class="${labelCls}">${t.remote_label_webdav_url || 'Сервер WebDAV'}</label>
                    <input id="rc-webdav-url" type="text" value="${d.webdav_url || ''}" placeholder="https://cloud.example.com/remote.php/dav/files/me" class="${inputCls}"></div>
                <div><label class="${labelCls}">${t.remote_label_webdav_user || 'Имя пользователя'}</label>
                    <input id="rc-webdav-user" type="text" value="${d.webdav_user || ''}" class="${inputCls}"></div>
                <div><label class="${labelCls}">${t.remote_label_webdav_pass || 'Пароль / пароль приложения'}</label>
                    <input id="rc-webdav-pass" type="password" value="${d.webdav_pass || ''}" class="${inputCls}"></div>
                <div><label class="${labelCls}">${t.remote_label_webdav_path || 'Папка (необязательно)'}</label>
                    <input id="rc-webdav-path" type="text" value="${d.webdav_path || 'Aru'}" class="${inputCls}"></div>
                <button onclick="WizardController.connectRemote('webdav')" class="w-full py-4 bg-aru-500 hover:bg-aru-600 text-white rounded-2xl font-bold transition-all shadow-lg shadow-aru-500/20 flex items-center justify-center gap-2">
                    <i data-lucide="plug" class="w-4 h-4"></i> ${t.remote_btn_connect || 'Подключиться'}
                </button>
            </div>`;
        }
        return `
        <div class="space-y-3">
            <div class="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-[10px] text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800 leading-relaxed space-y-1.5">
                <div><i data-lucide="info" class="w-3 h-3 inline mr-1"></i> ${t.remote_gdrive_hint || 'В Google Cloud Console создайте OAuth Client ID (тип Web) и укажите в Authorized JavaScript origins адрес:'}</div>
                <div class="flex items-center justify-between bg-white dark:bg-gray-900 px-2.5 py-1 rounded border border-blue-200 dark:border-blue-800 text-[10px]">
                    <span class="font-mono text-gray-700 dark:text-gray-300 select-all">${window.location.origin}</span>
                    <button type="button" onclick="navigator.clipboard.writeText(window.location.origin); UI.showToast(window.aruState?.translations?.copied || 'Скопировано');" class="text-blue-600 dark:text-blue-400 font-bold hover:underline ml-2">${t.action_copy || 'Copy'}</button>
                </div>
            </div>
            <div><label class="${labelCls}">${t.remote_label_client_id || 'Google Client ID'}</label>
                <input id="rc-gdrive-client" type="text" value="${d.gdrive_client_id || ''}" placeholder="xxxx.apps.googleusercontent.com" class="${inputCls}"></div>
            <button onclick="WizardController.connectRemote('gdrive')" class="w-full py-4 bg-blue-500 hover:bg-blue-600 text-white rounded-2xl font-bold transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2">
                <i data-lucide="key-round" class="w-4 h-4"></i> ${t.remote_btn_google || 'Авторизоваться в Google'}
            </button>
        </div>`;
    },

    _renderRemoteConnect: () => {
        const t = state.translations || {};
        const d = WizardController.wizardData;
        if (!d.remoteProvider) d.remoteProvider = 'gdrive';
        return `
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm fade-in p-4">
            <div class="bg-white dark:bg-gray-800 rounded-3xl w-full max-w-md p-8 shadow-2xl relative border border-gray-100 dark:border-gray-700 animate-fade-in-up max-h-[90vh] flex flex-col">
                <div class="flex flex-col items-center mb-6">
                    <div class="w-16 h-16 bg-blue-50 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center text-blue-500 mb-4 shadow-inner">
                        <i data-lucide="cloud" class="w-8 h-8"></i>
                    </div>
                    <h3 class="text-2xl font-bold dark:text-white">${t.remote_open_title || 'Открыть базу из облака'}</h3>
                    <p class="text-gray-400 text-xs mt-1 text-center">${t.remote_open_desc || 'Подключитесь к своему Google Drive или WebDAV и откройте файл базы данных (.sqlite), который можно свободно копировать и переносить.'}</p>
                </div>
                <div class="flex p-1 bg-gray-100 dark:bg-gray-900 rounded-xl mb-4">
                    <button onclick="WizardController._setRemoteProvider('gdrive')" id="rc-tab-gdrive" class="flex-1 py-2 px-1 rounded-lg text-[10px] font-bold transition ${d.remoteProvider === 'webdav' ? 'text-gray-500' : 'bg-white shadow-sm text-aru-600'}">Google Drive</button>
                    <button onclick="WizardController._setRemoteProvider('webdav')" id="rc-tab-webdav" class="flex-1 py-2 px-1 rounded-lg text-[10px] font-bold transition ${d.remoteProvider === 'webdav' ? 'bg-white shadow-sm text-aru-600' : 'text-gray-500'}">WebDAV</button>
                </div>
                <div id="remote-connect-body" class="overflow-y-auto custom-scrollbar">
                    ${WizardController._renderRemoteConnectBody()}
                </div>
                <button onclick="document.getElementById('modal-container').innerHTML=''" class="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 transition-colors">
                    <i data-lucide="x" class="w-5 h-5"></i>
                </button>
            </div>
        </div>`;
    },

    connectRemote: async (provider) => {
        const t = state.translations || {};
        const d = WizardController.wizardData;
        try {
            if (provider === 'gdrive') {
                const clientId = document.getElementById('rc-gdrive-client')?.value.trim();
                if (!clientId) return alert(t.remote_alert_client_id || 'Введите Client ID вашего Google Cloud проекта');
                d.gdrive_client_id = clientId;
                const tokens = await RemoteAdapters.gdrive.authorize(clientId);
                const profile = {
                    type: 'gdrive',
                    clientId,
                    accessToken: tokens.accessToken,
                    accessTokenExp: Date.now() + (tokens.expiresIn || 3600) * 1000,
                    fileName: 'aru_database.sqlite',
                    createdAt: Date.now()
                };
                RemoteStorage.adoptPending(profile);
                await WizardController._renderRemotePicker();
                return;
            }
            const url = document.getElementById('rc-webdav-url').value.trim();
            const username = document.getElementById('rc-webdav-user').value.trim();
            const password = document.getElementById('rc-webdav-pass').value;
            const davPath = document.getElementById('rc-webdav-path').value.trim();
            if (!url || !username || !password) return alert(t.remote_alert_webdav_fields || 'Заполните URL, имя пользователя и пароль');
            Object.assign(d, { webdav_url: url, webdav_user: username, webdav_pass: password, webdav_path: davPath });
            await RemoteStorage.adoptPending({ type: 'webdav', url, username, password, davPath, fileName: 'aru_database.sqlite', createdAt: Date.now() });
            await WizardController._renderRemotePicker();
        } catch (e) {
            console.error('connectRemote failed', e);
            alert(e.message);
        }
    },

    _renderRemotePicker: async (mode = 'open') => {
        const t = state.translations || {};
        const body = document.getElementById('remote-connect-body');
        if (!body) return;
        body.innerHTML = `<div class="py-8 text-center"><div class="w-6 h-6 border-4 border-aru-500 border-t-transparent rounded-full animate-spin inline-block"></div><div class="text-xs text-gray-400 mt-2">${t.remote_loading_files || 'Загрузка списка файлов...'}</div></div>`;
        let files;
        try {
            files = await RemoteStorage.listRemoteFiles();
        } catch (e) {
            console.error('listRemoteFiles failed', e);
            alert((t.remote_error_list || 'Не удалось получить список файлов') + ': ' + e.message);
            body.innerHTML = WizardController._renderRemoteConnectBody();
            lucide.createIcons();
            return;
        }
        const esc = (s) => String(s).replace(/'/g, "\\'");
        const rows = files.length ? files.map(f => `
            <button onclick="WizardController.openRemoteFile('${f.id}', '${esc(f.name)}', '${mode}')" class="w-full p-3 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-aru-400 hover:bg-aru-50 dark:hover:bg-aru-900/20 transition flex items-center gap-3 text-left">
                <i data-lucide="database" class="w-4 h-4 text-aru-500 flex-shrink-0"></i>
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-bold text-gray-700 dark:text-gray-200 truncate">${f.name}</div>
                    <div class="text-[10px] text-gray-400">${f.ts ? new Date(f.ts).toLocaleString() : ''} · ${Math.max(1, Math.round((f.size || 0) / 1024))} KB</div>
                </div>
                <i data-lucide="${mode === 'link' ? 'check-circle-2' : 'download'}" class="w-4 h-4 text-gray-300"></i>
            </button>`).join('') : `<div class="py-6 text-center text-gray-400 text-xs leading-relaxed">${t.remote_no_files || 'Файлов базы не найдено.<br>Новую базу можно создать кнопкой «Создать базу» - в ней есть выбор облачного хранилища.'}</div>`;
        const linkUpload = mode === 'link' ? `
            <button onclick="WizardController.uploadLocalAsNewRemote()" class="w-full py-3 px-4 rounded-xl bg-aru-500 hover:bg-aru-600 text-white font-bold text-sm transition flex items-center justify-center gap-2">
                <i data-lucide="upload-cloud" class="w-4 h-4"></i> ${t.remote_upload_local || 'Загрузить текущую базу как новый файл'}
            </button>` : '';
        body.innerHTML = `
            <div class="flex items-center justify-between mb-3">
                <span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">${mode === 'link' ? (t.remote_pick_file_link || 'Выберите файл или загрузите текущую базу') : (t.remote_pick_file || 'Выберите файл базы')}</span>
                <button onclick="WizardController._renderRemotePicker('${mode}')" class="p-1.5 text-gray-400 hover:text-aru-500 transition-colors" title="Refresh"><i data-lucide="refresh-cw" class="w-4 h-4"></i></button>
            </div>
            <div class="space-y-2 max-h-56 overflow-y-auto custom-scrollbar mb-3">${rows}</div>
            ${linkUpload}`;
        lucide.createIcons();
    },

    openRemoteFile: async (id, name, mode = 'open') => {
        const t = state.translations || {};
        try {
            await RemoteStorage.useRemoteFile(id, name);
            if (mode === 'link') {
                // Settings link flow: the local DB is logged-in data — ask before replacing it
                if (!confirm((t.remote_link_take_confirm || 'Заменить локальную базу данными этого файла?') + '\n' + name)) return;
                const bytes = await RemoteStorage.pullBytes();
                await DB.applyRemoteBytes(bytes);
                await WizardController.app.refreshRemoteSync();
                document.getElementById('modal-container').innerHTML = '';
                WizardController.app._openSettings();
                WizardController.app.switchTab('storage');
                return;
            }
            const bytes = await RemoteStorage.pullBytes();
            const ok = await DB.smartLoadFromBytes(bytes);
            if (!ok) {
                alert(t.remote_alert_local_newer || 'Локальная копия новее удалённой. Загрузка отменена для защиты данных.');
                return;
            }
            // Keep the profile in memory; persisted encrypted once the DB password is verified at login
            WizardController._pendingRemoteProfile = JSON.parse(JSON.stringify(RemoteStorage.profile));
            WizardController.app.openModal('login');
        } catch (e) {
            console.error('openRemoteFile failed', e);
            alert((t.remote_error_open || 'Не удалось открыть файл') + ': ' + e.message);
        }
    },

    uploadLocalAsNewRemote: async () => {
        const t = state.translations || {};
        try {
            const defName = 'aru_database_' + new Date().toISOString().slice(0, 10) + '.sqlite';
            const name = prompt(t.remote_upload_name_prompt || 'Имя нового файла на сервере:', defName);
            if (!name) return;
            await RemoteStorage.createRemoteFile(name.trim());
            await RemoteStorage.pushNow(DB.db.export());
            await WizardController.app.refreshRemoteSync();
            document.getElementById('modal-container').innerHTML = '';
            WizardController.app._openSettings();
            WizardController.app.switchTab('storage');
        } catch (e) {
            console.error('uploadLocalAsNewRemote failed', e);
            alert((t.remote_error_setup || 'Не удалось настроить облачное хранилище') + ': ' + e.message);
        }
    },

    // Called from app.init when returning from the Google consent screen (remote-open flow)
    resumeRemoteOpen: async (oauth) => {
        const profile = {
            type: 'gdrive',
            clientId: oauth.clientId,
            accessToken: oauth.tokens.accessToken,
            refreshToken: oauth.tokens.refreshToken,
            accessTokenExp: Date.now() + (oauth.tokens.expiresIn || 3600) * 1000,
            fileName: 'aru_database.sqlite',
            createdAt: Date.now()
        };
        await RemoteStorage.adoptPending(profile);
        WizardController.app.openModal('remote');
        await WizardController._renderRemotePicker();
    },

    renderWizard: () => {
        const modalContainer = document.getElementById('modal-container');
        const data = WizardController.app.wizardData;
        const t = state.translations || {};
        let stageHTML = '';

        if (data.stage === 1) {
            stageHTML = `
            <div class="space-y-4 animate-fade-in">
                <p class="text-sm text-gray-500 mb-6">${t.wiz_step1_desc || 'Давайте создадим вашу защищенную базу данных Ару.'}</p>
                <div>
                    <label class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.label_dbname || 'Имя базы'}</label>
                    <input type="text" id="wiz-dbname" value="${data.dbname}" placeholder="${t.placeholder_dbname || 'Напр. Мои Мысли'}" class="w-full p-4 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-2xl focus:border-aru-500 outline-none dark:text-white transition-all shadow-sm">
                </div>
                <div>
                    <label class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.label_password || 'Мастер-пароль'}</label>
                    <input type="password" id="wiz-password" value="${data.password}" placeholder="${t.placeholder_password || 'Минимум 6 символов'}" class="w-full p-4 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-2xl focus:border-aru-500 outline-none dark:text-white transition-all shadow-sm">
                </div>
                ${Auth.isWebAuthnSupported() ? `
                <div class="p-3 bg-gray-50 dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-1">
                    <label class="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" id="wiz-allow-biometrics" ${data.allow_biometrics !== false ? 'checked' : ''} class="w-4 h-4 accent-aru-500 rounded">
                        <span class="text-xs font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                            <i data-lucide="fingerprint" class="w-4 h-4 text-aru-500"></i>
                            ${t.wiz_allow_biometrics || 'Разрешить вход по биометрии (Touch ID / Face ID)'}
                        </span>
                    </label>
                    <p class="text-[11px] text-gray-400 pl-7 leading-tight">${t.wiz_allow_biometrics_hint || 'После подтверждения вы сможете быстро входить по отпечатку или лицу на этом устройстве.'}</p>
                </div>` : ''}
                <div class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl text-xs text-blue-600 dark:text-blue-300 border border-blue-100 dark:border-blue-800 flex gap-3">
                    <i data-lucide="shield-check" class="w-5 h-5 flex-shrink-0"></i>
                    <span>${t.wiz_password_hint || 'Этот пароль используется для шифрования ваших данных внутри браузера. Не теряйте его!'}</span>
                </div>
            </div>`;
        } else if (data.stage === 2) {
            stageHTML = `
            <div class="grid grid-cols-1 gap-4 animate-fade-in">
                <p class="text-sm text-gray-500 mb-2">${t.wiz_step2_desc || 'Выберите, как Ару должна общаться с вами.'}</p>
                
                <div onclick="app.setWizProfile('child')" class="p-4 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-md flex items-center gap-4 ${data.profile === 'child' ? 'border-aru-500 bg-aru-50 dark:bg-aru-900/20' : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-aru-200'}">
                    <div class="w-12 h-12 rounded-xl bg-orange-100 text-orange-500 dark:bg-orange-900/30 flex items-center justify-center">
                        <i data-lucide="baby" class="w-6 h-6"></i>
                    </div>
                    <div class="flex-1">
                        <h4 class="font-bold text-gray-800 dark:text-white">${t.wiz_profile_child_title || 'Ребенок'}</h4>
                        <p class="text-[10px] text-gray-500">${t.wiz_profile_child_desc || 'Понятные объяснения, акцент на обучение и полную безопасность.'}</p>
                    </div>
                </div>

                <div onclick="app.setWizProfile('teen')" class="p-4 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-md flex items-center gap-4 ${data.profile === 'teen' ? 'border-aru-500 bg-aru-50 dark:bg-aru-900/20' : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-aru-200'}">
                    <div class="w-12 h-12 rounded-xl bg-purple-100 text-purple-500 dark:bg-purple-900/30 flex items-center justify-center">
                        <i data-lucide="headphones" class="w-6 h-6"></i>
                    </div>
                    <div class="flex-1">
                        <h4 class="font-bold text-gray-800 dark:text-white">${t.wiz_profile_teen_title || 'Подросток'}</h4>
                        <p class="text-[10px] text-gray-500">${t.wiz_profile_teen_desc || 'Современный тон, баланс между помощью в учебе и личными интересами.'}</p>
                    </div>
                </div>

                <div onclick="app.setWizProfile('adult')" class="p-4 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-md flex items-center gap-4 ${data.profile === 'adult' ? 'border-aru-500 bg-aru-50 dark:bg-aru-900/20' : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-aru-200'}">
                    <div class="w-12 h-12 rounded-xl bg-blue-100 text-blue-500 dark:bg-blue-900/30 flex items-center justify-center">
                        <i data-lucide="user" class="w-6 h-6"></i>
                    </div>
                    <div class="flex-1">
                        <h4 class="font-bold text-gray-800 dark:text-white">${t.wiz_profile_adult_title || 'Взрослый'}</h4>
                        <p class="text-[10px] text-gray-500">${t.wiz_profile_adult_desc || 'Прямой доступ ко всем функциям, профессиональный и полезный тон.'}</p>
                    </div>
                </div>
            </div>`;
        } else if (data.stage === 3) {
            stageHTML = `
            <div class="space-y-4 animate-fade-in">
                <p class="text-sm text-gray-500 mb-2">${t.wiz_step3_desc || 'Настройте подключение к интеллекту Ару.'}</p>
                
                <div class="flex p-1 bg-gray-100 dark:bg-gray-900 rounded-xl mb-4">
                    <button onclick="app.setWizAI('gemini')" class="flex-1 py-2 px-1 rounded-lg text-[10px] font-bold transition ${data.ai_type === 'gemini' ? 'bg-white shadow-sm text-aru-600' : 'text-gray-500'}">Gemini</button>
                    <button onclick="app.setWizAI('openrouter')" class="flex-1 py-2 px-1 rounded-lg text-[10px] font-bold transition ${data.ai_type === 'openrouter' ? 'bg-white shadow-sm text-aru-600' : 'text-gray-500'}">OpenRouter</button>
                    <button onclick="app.setWizAI('custom')" class="flex-1 py-2 px-1 rounded-lg text-[10px] font-bold transition ${data.ai_type === 'custom' ? 'bg-white shadow-sm text-aru-600' : 'text-gray-500'}">Custom</button>
                </div>

                <div class="space-y-3">
                    ${data.ai_type === 'gemini' ? `
                        <div>
                            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.label_gemini_key || 'Gemini API Key'}</label>
                            <input type="password" id="wiz-gemini-key" value="${data.gemini_key || ''}" placeholder="${t.placeholder_password || 'Key'}" class="w-full p-3 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl focus:border-aru-500 outline-none dark:text-white text-sm">
                        </div>
                        <div>
                            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.label_gemini_model || 'Gemini Model'}</label>
                            <input type="text" id="wiz-gemini-model" value="${data.gemini_model || ''}" placeholder="gemini-2.0-flash" class="w-full p-3 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl focus:border-aru-500 outline-none dark:text-white text-sm">
                        </div>
                    ` : ''}

                    ${data.ai_type === 'openrouter' ? `
                        <div class="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl text-[10px] text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-800 mb-2">
                             <i data-lucide="alert-triangle" class="w-3 h-3 inline mr-1"></i> ${t.wiz_or_warning || 'Внимание! Бесплатные модели имеют ограничения и лимиты!'}
                        </div>
                        <div>
                            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.label_openrouter_key || 'OpenRouter API Key'}</label>
                            <input type="password" id="wiz-openrouter-key" value="${data.openrouter_key}" placeholder="sk-or-..." class="w-full p-3 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl focus:border-aru-500 outline-none dark:text-white text-sm">
                        </div>
                        <div>
                            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.label_openrouter_model || 'Model Name'}</label>
                            <input type="text" id="wiz-openrouter-model" value="${data.openrouter_model}" placeholder="" class="w-full p-3 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl focus:border-aru-500 outline-none dark:text-white text-sm">
                        </div>
                        <div>
                            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.label_openrouter_url || 'Base URL'}</label>
                            <input type="text" id="wiz-openrouter-url" value="${data.openrouter_url}" class="w-full p-3 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl focus:border-aru-500 outline-none dark:text-white text-sm">
                        </div>
                    ` : ''}

                    ${data.ai_type === 'custom' ? `
                        <div class="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-[10px] text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800 mb-2">
                             ${t.wiz_custom_desc || 'Приватные модели Ollama / LM Studio (OpenAI-совместимые)'}
                        </div>
                        <div>
                            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.label_custom_url || 'Base URL'}</label>
                            <input type="text" id="wiz-custom-url" value="${data.custom_url}" placeholder="http://localhost:1234/v1/chat/completions" class="w-full p-3 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl focus:border-aru-500 outline-none dark:text-white text-sm">
                        </div>
                        <div>
                            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.label_custom_model || 'Model Name'}</label>
                            <input type="text" id="wiz-custom-model" value="${data.custom_model}" placeholder="llama-3" class="w-full p-3 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl focus:border-aru-500 outline-none dark:text-white text-sm">
                        </div>
                        <div>
                            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">${t.label_custom_key || 'API Key'}</label>
                            <input type="password" id="wiz-custom-key" value="${data.custom_key || ''}" placeholder="${t.hint_custom_key_optional || 'Usually not required'}" class="w-full p-3 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl focus:border-aru-500 outline-none dark:text-white text-sm">
                        </div>
                    ` : ''}
                </div>
            </div>`;
        } else if (data.stage === 4) {
            const cardCls = (active) => `p-4 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-md flex items-center gap-4 ${active ? 'border-aru-500 bg-aru-50 dark:bg-aru-900/20' : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-aru-200'}`;
            const inputCls = 'w-full p-3 bg-gray-50 dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl focus:border-aru-500 outline-none dark:text-white text-sm';
            const labelCls = 'text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block';
            stageHTML = `
            <div class="space-y-4 animate-fade-in">
                <p class="text-sm text-gray-500">${t.wiz_step4_desc || 'Где хранить файл базы? Вы можете изменить это позже в настройках.'}</p>

                <div onclick="app.setWizStorage('browser')" class="${cardCls(data.storage === 'browser')}">
                    <div class="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                        <i data-lucide="smartphone" class="w-6 h-6"></i>
                    </div>
                    <div class="flex-1">
                        <h4 class="font-bold text-gray-800 dark:text-white">${t.wiz_storage_browser_title || 'Только в браузере'}</h4>
                        <p class="text-[10px] text-gray-500">${t.wiz_storage_browser_desc || 'По умолчанию. Данные остаются в этом устройстве, экспорт возможен в любой момент.'}</p>
                    </div>
                </div>

                <div onclick="app.setWizStorage('file')" class="${cardCls(data.storage === 'file')}">
                    <div class="w-12 h-12 rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                        <i data-lucide="hard-drive" class="w-6 h-6"></i>
                    </div>
                    <div class="flex-1">
                        <h4 class="font-bold text-gray-800 dark:text-white">${t.wiz_storage_file_title || 'Файл на устройстве'}</h4>
                        <p class="text-[10px] text-gray-500">${t.wiz_storage_file_desc || 'Сохранить .sqlite файл в папку на этом устройстве и синхронизировать его при каждом сохранении.'}</p>
                    </div>
                </div>

                <div onclick="app.setWizStorage('gdrive')" class="${cardCls(data.storage === 'gdrive')}">
                    <div class="w-12 h-12 rounded-xl bg-blue-100 text-blue-500 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                        <i data-lucide="cloud" class="w-6 h-6"></i>
                    </div>
                    <div class="flex-1">
                        <h4 class="font-bold text-gray-800 dark:text-white">Google Drive</h4>
                        <p class="text-[10px] text-gray-500">${t.wiz_storage_gdrive_desc || 'Ваш личный Google Drive через собственный проект Google Cloud (BYOK). Файл доступен только этому приложению.'}</p>
                    </div>
                </div>

                <div onclick="app.setWizStorage('webdav')" class="${cardCls(data.storage === 'webdav')}">
                    <div class="w-12 h-12 rounded-xl bg-purple-100 text-purple-500 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                        <i data-lucide="server" class="w-6 h-6"></i>
                    </div>
                    <div class="flex-1">
                        <h4 class="font-bold text-gray-800 dark:text-white">WebDAV</h4>
                        <p class="text-[10px] text-gray-500">${t.wiz_storage_webdav_desc || 'Nextcloud, ownCloud или любой WebDAV-сервер. Полный контроль над инфраструктурой.'}</p>
                    </div>
                </div>

                ${data.storage === 'gdrive' ? `
                <div class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800 space-y-3">
                    <div class="space-y-1.5 text-[10px] text-blue-600 dark:text-blue-400 leading-relaxed">
                        <div>${t.remote_gdrive_hint || 'В Google Cloud Console создайте OAuth Client ID (тип Web) и укажите в Authorized JavaScript origins адрес:'}</div>
                        <div class="flex items-center justify-between bg-white dark:bg-gray-900 px-2.5 py-1 rounded border border-blue-200 dark:border-blue-800">
                            <span class="font-mono text-gray-700 dark:text-gray-300 select-all">${window.location.origin}</span>
                            <button type="button" onclick="navigator.clipboard.writeText(window.location.origin); UI.showToast(window.aruState?.translations?.copied || 'Скопировано');" class="text-blue-600 dark:text-blue-400 font-bold hover:underline ml-2">${t.action_copy || 'Copy'}</button>
                        </div>
                    </div>
                    <div><label class="${labelCls}">${t.remote_label_client_id || 'Google Client ID'}</label>
                        <input type="text" id="wiz-gdrive-client" value="${data.gdrive_client_id || ''}" placeholder="xxxx.apps.googleusercontent.com" class="${inputCls}"></div>
                </div>` : ''}

                ${data.storage === 'webdav' ? `
                <div class="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-2xl border border-purple-100 dark:border-purple-800 space-y-3">
                    <p class="text-[10px] text-purple-600 dark:text-purple-400 leading-relaxed">${t.remote_webdav_hint || 'Nextcloud, ownCloud, Synology или любой WebDAV. В браузере (PWA) сервер должен разрешать CORS (PROPFIND, MKCOL, Depth), либо используйте обратный прокси (/webdav).'}</p>
                    <div><label class="${labelCls}">${t.remote_label_webdav_url || 'Сервер WebDAV'}</label>
                        <input type="text" id="wiz-webdav-url" value="${data.webdav_url || ''}" placeholder="https://cloud.example.com/remote.php/dav/files/me" class="${inputCls}"></div>
                    <div class="grid grid-cols-2 gap-3">
                        <div><label class="${labelCls}">${t.remote_label_webdav_user || 'Имя пользователя'}</label>
                            <input type="text" id="wiz-webdav-user" value="${data.webdav_user || ''}" class="${inputCls}"></div>
                        <div><label class="${labelCls}">${t.remote_label_webdav_pass || 'Пароль'}</label>
                            <input type="password" id="wiz-webdav-pass" value="${data.webdav_pass || ''}" class="${inputCls}"></div>
                    </div>
                    <div><label class="${labelCls}">${t.remote_label_webdav_path || 'Папка (необязательно)'}</label>
                        <input type="text" id="wiz-webdav-path" value="${data.webdav_path || 'Aru'}" class="${inputCls}"></div>
                </div>` : ''}
            </div>`;
        }

        modalContainer.innerHTML = `
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm fade-in p-4">
            <div class="bg-white dark:bg-gray-800 rounded-3xl w-full max-w-lg shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
                <!-- Progress Header -->
                <div class="p-6 pb-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                    <div class="flex items-center justify-between mb-4">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 bg-aru-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-aru-500/30">
                                <i data-lucide="sparkles" class="w-6 h-6"></i>
                            </div>
                            <div>
                                <h3 class="text-xl font-bold dark:text-white" data-i18n="wiz_title">${t.wiz_title || 'Настройка Ару'}</h3>
                                <p class="text-[10px] font-bold text-aru-500 uppercase tracking-widest"><span data-i18n="wiz_stage">${t.wiz_stage || 'Шаг'}</span> ${data.stage} <span data-i18n="wiz_of">${t.wiz_of || 'из'}</span> 4</p>
                            </div>
                        </div>
                        <button onclick="document.getElementById('modal-container').innerHTML=''" class="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-400 transition">
                            <i data-lucide="x" class="w-5 h-5"></i>
                        </button>
                    </div>
                    <!-- Indicator dots -->
                    <div class="flex gap-2 mb-2">
                        <div class="h-1.5 flex-1 rounded-full ${data.stage >= 1 ? 'bg-aru-500' : 'bg-gray-200 dark:bg-gray-700'}"></div>
                        <div class="h-1.5 flex-1 rounded-full ${data.stage >= 2 ? 'bg-aru-500' : 'bg-gray-200 dark:bg-gray-700'}"></div>
                        <div class="h-1.5 flex-1 rounded-full ${data.stage >= 3 ? 'bg-aru-500' : 'bg-gray-200 dark:bg-gray-700'}"></div>
                        <div class="h-1.5 flex-1 rounded-full ${data.stage >= 4 ? 'bg-aru-500' : 'bg-gray-200 dark:bg-gray-700'}"></div>
                    </div>
                </div>

                <!-- Stage Content -->
                <div class="p-8 overflow-y-auto flex-1 custom-scrollbar">
                    ${stageHTML}
                </div>

                <!-- Bottom Navigation -->
                <div class="p-6 pt-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex gap-3">
                    ${data.stage > 1 ? `
                        <button onclick="app.prevWizStage()" class="flex-1 py-4 px-6 border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-2xl font-bold transition-all flex items-center justify-center gap-2">
                            <i data-lucide="arrow-left" class="w-5 h-5"></i> <span data-i18n="wiz_prev">${t.wiz_prev || 'Назад'}</span>
                        </button>
                    ` : ''}
                    <button onclick="${data.stage === 4 ? 'WizardController.app.handleWizardComplete()' : 'WizardController.app.nextWizStage()'}" class="flex-[2] py-4 px-6 bg-aru-500 hover:bg-aru-600 text-white rounded-2xl font-bold transition-all shadow-lg shadow-aru-500/30 flex items-center justify-center gap-2 text-lg">
                        ${data.stage === 4 ? `<i data-lucide="check-circle" class="w-5 h-5"></i> <span data-i18n="wiz_create">${t.wiz_create || 'Создать и Сохранить'}</span>` : `<span data-i18n="wiz_next">${t.wiz_next || 'Далее'}</span> <i data-lucide="arrow-right" class="w-5 h-5"></i>`}
                    </button>
                </div>
            </div>
        </div>`;
        WizardController.app.applyTranslations(modalContainer);
        lucide.createIcons();
    },

    setWizProfile: (p) => { WizardController.app.wizardData.profile = p; WizardController.app.renderWizard(); },
    setWizAI: (t) => { WizardController.app.wizardData.ai_type = t; WizardController.app.renderWizard(); },

    setWizStorage: (s) => {
        const d = WizardController.app.wizardData;
        // Preserve typed provider fields before re-render wipes them
        if (d.storage === 'gdrive') {
            const el = document.getElementById('wiz-gdrive-client');
            if (el) d.gdrive_client_id = el.value.trim();
        } else if (d.storage === 'webdav') {
            const g = (id) => document.getElementById(id)?.value ?? '';
            d.webdav_url = g('wiz-webdav-url').trim();
            d.webdav_user = g('wiz-webdav-user').trim();
            d.webdav_pass = g('wiz-webdav-pass');
            d.webdav_path = g('wiz-webdav-path').trim();
        }
        d.storage = s;
        WizardController.app.renderWizard();
    },

    nextWizStage: () => {
        const d = WizardController.app.wizardData;
        if (d.stage === 1) {
            d.dbname = document.getElementById('wiz-dbname').value;
            d.password = document.getElementById('wiz-password').value;
            const bioCheck = document.getElementById('wiz-allow-biometrics');
            if (bioCheck) d.allow_biometrics = bioCheck.checked;
            if (!d.dbname || d.password.length < 6) return alert("Введите имя базы и пароль (мин 6 симв)");
        } else if (d.stage === 3) {
            if (d.ai_type === 'gemini') {
                d.gemini_key = document.getElementById('wiz-gemini-key').value;
                d.gemini_model = document.getElementById('wiz-gemini-model').value || 'gemini-2.5-flash';
                if (!d.gemini_key) return alert("Введите Gemini API Ключ");
            } else if (d.ai_type === 'openrouter') {
                d.openrouter_key = document.getElementById('wiz-openrouter-key').value;
                d.openrouter_model = document.getElementById('wiz-openrouter-model').value;
                d.openrouter_url = document.getElementById('wiz-openrouter-url').value;
                if (!d.openrouter_key || !d.openrouter_model) return alert("Заполните API ключ и название модели");
            } else if (d.ai_type === 'custom') {
                d.custom_key = document.getElementById('wiz-custom-key').value;
                d.custom_model = document.getElementById('wiz-custom-model').value;
                d.custom_url = document.getElementById('wiz-custom-url').value;
                if (!d.custom_url || !d.custom_model) return alert("Заполните Base URL и название модели");
            }
        }
        d.stage++;
        WizardController.app.renderWizard();
    },

    prevWizStage: () => {
        WizardController.app.wizardData.stage--;
        WizardController.app.renderWizard();
    },

    handleWizardComplete: async () => {
        const d = WizardController.app.wizardData;
        // Final capture for stage 3 — its inputs only exist while stage 3 is mounted;
        // on stage 4 the values were already captured on the 3→4 transition
        if (d.ai_type === 'gemini') {
            const keyEl = document.getElementById('wiz-gemini-key');
            if (keyEl) {
                d.gemini_key = keyEl.value;
                d.gemini_model = document.getElementById('wiz-gemini-model').value || 'gemini-2.5-flash';
                if (!d.gemini_key) return alert("Введите Gemini API Ключ");
            }
        } else if (d.ai_type === 'openrouter') {
            const keyEl = document.getElementById('wiz-openrouter-key');
            if (keyEl) {
                d.openrouter_key = keyEl.value;
                d.openrouter_model = document.getElementById('wiz-openrouter-model').value;
                d.openrouter_url = document.getElementById('wiz-openrouter-url').value;
                if (!d.openrouter_key || !d.openrouter_model) return alert("Заполните API ключ и название модели");
            }
        } else if (d.ai_type === 'custom') {
            const urlEl = document.getElementById('wiz-custom-url');
            if (urlEl) {
                d.custom_key = document.getElementById('wiz-custom-key').value;
                d.custom_model = document.getElementById('wiz-custom-model').value;
                d.custom_url = urlEl.value;
                if (!d.custom_url || !d.custom_model) return alert("Заполните Base URL и название модели");
            }
        }

        // Capture stage-4 storage fields
        const t = state.translations || {};
        const storage = d.storage || 'browser';
        if (storage === 'gdrive') {
            const el = document.getElementById('wiz-gdrive-client');
            if (el) d.gdrive_client_id = el.value.trim();
            if (!d.gdrive_client_id) return alert(t.remote_alert_client_id || 'Введите Client ID вашего Google Cloud проекта');
        } else if (storage === 'webdav') {
            const g = (id) => document.getElementById(id)?.value ?? '';
            d.webdav_url = g('wiz-webdav-url').trim();
            d.webdav_user = g('wiz-webdav-user').trim();
            d.webdav_pass = g('wiz-webdav-pass');
            d.webdav_path = g('wiz-webdav-path').trim();
            if (!d.webdav_url || !d.webdav_user || !d.webdav_pass) {
                return alert(t.remote_alert_webdav_fields || 'Заполните URL, имя пользователя и пароль WebDAV');
            }
        }

        try {
            const hash = await Auth.hashPassword(d.password);
            // Create a unique storage key for this new DB so multiple DBs don't collide
            const safeName = (d.dbname || 'aru').replace(/[^a-z0-9\-_]/gi, '_').toLowerCase().slice(0, 40);
            const dbKey = `aru_db_${safeName}_${Date.now()}`;
            await DB.createDBWithKey(hash, dbKey);

            DB.saveSetting('db_name', d.dbname);
            DB.saveSetting('user_mode', d.profile);
            DB.saveSetting('user_name', '');
            DB.saveSetting('db_password', hash);

            DB.saveSetting('llm_type', d.ai_type);
            DB.saveSetting('gemini_key', d.gemini_key);
            DB.saveSetting('gemini_model', d.gemini_model);
            DB.saveSetting('openrouter_key', d.openrouter_key);
            DB.saveSetting('openrouter_model', d.openrouter_model);
            DB.saveSetting('openrouter_url', d.openrouter_url);
            DB.saveSetting('custom_key', d.custom_key);
            DB.saveSetting('custom_model', d.custom_model);
            DB.saveSetting('custom_url', d.custom_url);

            // Remote sync defaults (editable later in Settings → Storage)
            DB.saveSetting('remote_sync_mode', 'auto', false);
            DB.saveSetting('remote_conflict', 'ask', false);
            DB.saveSetting('remote_poll', '0', false);
            DB.saveSetting('biometrics_enabled', d.allow_biometrics ? 'true' : 'false', false);

            if (d.allow_biometrics && Auth.isWebAuthnSupported()) {
                try {
                    await Auth.registerBiometrics(d.password, dbKey, d.dbname);
                } catch (e) {
                    console.warn('Biometrics setup skipped or cancelled during wizard', e);
                }
            }

            if (storage === 'gdrive') {
                const tokens = await RemoteAdapters.gdrive.authorize(d.gdrive_client_id);
                const profile = {
                    type: 'gdrive',
                    clientId: d.gdrive_client_id,
                    accessToken: tokens.accessToken,
                    accessTokenExp: Date.now() + (tokens.expiresIn || 3600) * 1000,
                    fileName: 'aru_database.sqlite',
                    createdAt: Date.now()
                };
                await RemoteStorage.saveProfile(profile, d.password);
                await RemoteStorage.createRemoteFile('aru_database.sqlite');
                await RemoteStorage.pushNow(DB.db.export());
                await DB.save();
                WizardController.app.startSession();
                return;
            }

            if (storage === 'webdav') {
                await WizardController.setupWebdavCreate(d);
            } else if (storage === 'file') {
                // Use native file picker to create the file and get write access
                const ok = await DB.saveToSelectedFile();
                if (!ok) {
                    // Fallback to manual export if picker fails/cancelled
                    DB.exportToFile(d.dbname);
                }
            }

            await DB.save();
            WizardController.app.startSession();
        } catch (e) {
            console.error(e);
            alert("Error: " + e.message);
        }
    },

    // Completes wizard creation after returning from the Google consent screen
    finishGoogleCreate: async (oauth, d) => {
        const t = state.translations || {};
        try {
            const profile = {
                type: 'gdrive',
                clientId: oauth.clientId,
                accessToken: oauth.tokens.accessToken,
                refreshToken: oauth.tokens.refreshToken,
                accessTokenExp: Date.now() + (oauth.tokens.expiresIn || 3600) * 1000,
                fileName: 'aru_database.sqlite',
                createdAt: Date.now()
            };
            await RemoteStorage.saveProfile(profile, d.password);
            await RemoteStorage.createRemoteFile('aru_database.sqlite');
            await RemoteStorage.pushNow(DB.db.export());
        } catch (e) {
            // Local DB is already created; cloud link can be retried from Settings → Storage
            console.error('finishGoogleCreate cloud setup failed', e);
            alert((t.remote_error_setup || 'База создана локально, но настройка Google Drive не удалась. Повторите позже в Настройках → Хранилище.') + '\n' + e.message);
        }
        await DB.save();
        WizardController.app.startSession();
    },

    setupWebdavCreate: async (d) => {
        const t = state.translations || {};
        try {
            const profile = {
                type: 'webdav',
                url: d.webdav_url,
                username: d.webdav_user,
                password: d.webdav_pass,
                davPath: d.webdav_path,
                fileName: 'aru_database.sqlite',
                createdAt: Date.now()
            };
            await RemoteStorage.saveProfile(profile, d.password);
            await RemoteStorage.createRemoteFile('aru_database.sqlite');
            await RemoteStorage.pushNow(DB.db.export());
        } catch (e) {
            console.error('setupWebdavCreate failed', e);
            alert((t.remote_error_setup || 'База создана локально, но настройка WebDAV не удалась. Проверьте параметры в Настройках → Хранилище.') + '\n' + e.message);
        }
    },

    loginWithBiometrics: async () => {
        const t = state.translations || {};
        try {
            const pwd = await Auth.authenticateBiometrics(DB.dbPath || 'default');
            if (!pwd) return;
            await WizardController._completeLoginWithPassword(pwd);
        } catch (e) {
            console.error('Biometric authentication error', e);
            if (e.name !== 'NotAllowedError') {
                alert((t.alert_biometrics_failed || 'Ошибка биометрии: ') + e.message);
            }
        }
    },

    _completeLoginWithPassword: async (pwd) => {
        if (DB.fileHandle) {
            const granted = await DB.checkFilePermission();
            if (!granted) {
                const t = state.translations || {};
                alert(t.alert_write_permission || "Для работы требуется разрешение на запись в файл базы данных.");
                return;
            }
        }

        const res = DB.exec("SELECT value FROM settings WHERE key='db_password'");
        if (!res.length || !res[0].values.length) {
            const t = state.translations || {};
            alert(t.alert_db_not_found || 'Error: Password not found');
            return;
        }
        const storedHash = res[0].values[0][0];
        const isValid = await Auth.verifyPassword(pwd, storedHash);
        if (!isValid) {
            const t = state.translations || {};
            alert(t.alert_wrong_password || 'Wrong password');
            return;
        }

        const linkAfterLogin = WizardController._pendingLinkAfterLogin;
        WizardController._pendingLinkAfterLogin = false;

        if (WizardController._pendingRemoteProfile) {
            try {
                await RemoteStorage.saveProfile(WizardController._pendingRemoteProfile, pwd);
            } catch (e) {
                console.warn('Failed to persist remote profile', e);
            }
            WizardController._pendingRemoteProfile = null;
        } else if (await RemoteStorage.isConfigured()) {
            try {
                await RemoteStorage.unlock(pwd);
            } catch (e) {
                console.warn('Remote profile unlock failed', e);
            }
        }

        await WizardController.app.refreshRemoteSync();
        WizardController.app.startSession();
        if (linkAfterLogin) await WizardController.app.completeRemoteLink();
    },

    handleLogin: async (e) => {
        e.preventDefault();
        const pwd = e.target.password.value;

        await WizardController._completeLoginWithPassword(pwd);
    },

    handleOpenDBPicker: async () => {
        const ok = await DB.openFromFilePicker();
        if (ok) {
            WizardController.app.openModal('login'); // Ask for password of the newly picked file
        }
    },

    handleImportDB: async (e) => {
        e.preventDefault();
        const pwd = e.target.password.value;
        const fileInput = document.getElementById('open-file');

        try {
            if (!fileInput.files.length) {
                const t = state.translations || {};
                alert(t.alert_select_file || "Пожалуйста, сначала выберите файл базы.");
                return;
            }

            // Important: wait for import to finish
            await DB.importFromFile(fileInput.files[0]);

            // After import, DB is in DB.db but not yet necessarily saved to storage until WizardController.app.startSession or manual save
            // We verify the hash from the newly loaded DB instance
            const res = DB.exec("SELECT value FROM settings WHERE key='db_password'");
            if (!res.length || !res[0].values.length) {
                const t = state.translations || {};
                alert(t.alert_corrupt_db || 'Eror: File is not a base or broken');
                return;
            }
            const storedHash = res[0].values[0][0];

            const isValid = await Auth.verifyPassword(pwd, storedHash);
            if (isValid) {
                WizardController.app.startSession();
            } else {
                const t = state.translations || {};
                alert(t.alert_wrong_password || 'Неверный пароль');
            }
        } catch (err) {
            console.error(err);
            alert('Open Error: ' + err.message);
        }
    },

    resetDB: async () => {
        const t = state.translations || {};
        if (!confirm(t.confirm_reset_db || "Внимание! Это удалит текущую базу из браузера безвозвратно. Продолжить?")) return;
        // Full delete: keep as explicit destructive action (Delete DB file from storage)
        await localforage.removeItem(DB.dbPath);
        // Also remove file handle metadata if exists
        try { if (DB.handleKey) await localforage.removeItem(DB.handleKey); } catch (e) { console.warn('Failed to remove file handle', e); }
        location.reload();
    },

    // Graceful disconnect: do not delete DB data, just remove file handle and unauthorize session
    disconnectDB: async () => {
        const t = state.translations || {};
        if (!confirm(t.confirm_disconnect_db || "Текущее подключение будет разорвано. Выберите базу для подключения. Продолжить?")) return;
        try {
            // Clear file handle in DB and storage, but keep DB data in IndexedDB
            if (DB && typeof DB.setFileHandle === 'function') await DB.setFileHandle(null);
            if (DB.handleKey) { try { await localforage.removeItem(DB.handleKey); } catch (e) { console.warn('Failed to remove handle from storage', e); } }
        } catch (e) {
            console.warn('disconnectDB: cleanup failed', e);
        }
        // De-authorize session and show login
        localStorage.removeItem('aru_authorized');
        location.reload();
    },
};
