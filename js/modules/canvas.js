/*
---ARU-LAB.SPACE---ALMATY---2026---
Canvas manager responsible for rendering generated artifacts like games, apps, and documents.
---chat.aru-lab.space---PWA---
*/
import { DB } from './db.js';
import { UI } from './ui.js';
import { loadHtml2Pdf } from './lazyLoader.js';

export const CanvasManager = {
    containers: {}, // chatId -> { container, iframe }
    panel: document.getElementById('canvas-panel'),
    currentArtifact: null,
    _storageFrames: new Map(), // iframe -> { scopeKey, type, title, code, onDataChange }
    _storageFlushTimer: null,
    _storageDirty: false,
    _storageBridgeBound: false,
    _storageRate: new WeakMap(),

    init() {
        const renderArea = document.getElementById('canvas-render-area');
        if (renderArea) renderArea.innerHTML = '';
        this.containers = {};
        this._storageFrames.clear();
        this._ensureStorageBridge();

        try {
            if (typeof MutationObserver !== 'undefined') {
                this._themeObserver = new MutationObserver(() => {
                    const isDark = document.documentElement.classList.contains('dark');
                    Object.values(this.containers).forEach(({ iframe }) => {
                        if (!iframe) return;
                        try {
                            const doc = iframe.contentWindow.document;
                            doc.documentElement.classList.toggle('dark', isDark);
                            if (doc.body) doc.body.classList.toggle('dark', isDark);
                        } catch (e) {
                            // Artifacts run in a sandbox without same-origin access, so the
                            // theme can only be applied at srcdoc render time.
                            iframe.dataset.lastTheme = '';
                        }
                    });
                    const renderArea = document.getElementById('canvas-render-area');
                    if (this.currentArtifact && renderArea && !renderArea.classList.contains('hidden')) {
                        this.renderPreview();
                    }
                });
                this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            }
        } catch (e) {
            console.warn('CanvasManager.init: failed to attach theme observer', e);
        }
    },

    open() {
        this.panel.classList.remove('hidden', 'absolute', 'z-50', 'w-full');
        // Artifacts can open the panel without going through ChatController.toggleCanvas,
        // so the split handle has to follow the panel state here as well.
        const resizer = document.getElementById('canvas-resizer');
        if (resizer) resizer.classList.remove('hidden');
        const st = window.aruState;
        if (st && st.tabs[st.activeTabIndex]) {
            st.tabs[st.activeTabIndex].isCanvasOpen = true;
        }
    },

    close() {
        this.panel.classList.add('hidden');
        this.panel.classList.remove('canvas-fullscreen', 'absolute', 'z-50', 'w-full');
        document.getElementById('aru-desktop')?.classList.remove('wd-has-fullscreen-canvas');
        const resizer = document.getElementById('canvas-resizer');
        if (resizer) resizer.classList.add('hidden');
        const st = window.aruState;
        if (st && st.tabs[st.activeTabIndex]) {
            st.tabs[st.activeTabIndex].isCanvasOpen = false;
        }
    },

    getTabKey(tab) {
        if (!tab) return null;
        if (tab.canvasKey) return tab.canvasKey;
        if (tab.type === 'plugin') return `plugin:${tab.pluginId || 'unknown'}`;
        return tab.chatId ?? null;
    },

    _ensureStorageBridge() {
        if (this._storageBridgeBound) return;
        this._storageBridgeBound = true;

        window.addEventListener('message', (event) => {
            const msg = event.data;
            if (!msg || msg.type !== 'ARU_STORAGE_REQUEST') return;

            let matchedEntry = null;
            for (const [frameEl, entry] of this._storageFrames.entries()) {
                if (!frameEl || !frameEl.isConnected) {
                    this._storageFrames.delete(frameEl);
                    continue;
                }
                if (frameEl.contentWindow === event.source) {
                    matchedEntry = entry;
                    break;
                }
            }
            if (!matchedEntry || !matchedEntry.scopeKey) return;

            const scopeKey = matchedEntry.scopeKey;
            const action = String(msg.action || '');
            let result = null;
            let error = null;

            try {
                if (action === 'get') {
                    const all = DB.getArtifactStorage ? DB.getArtifactStorage(scopeKey) : {};
                    const k = String(msg.key ?? '');
                    result = Object.prototype.hasOwnProperty.call(all, k) ? all[k] : null;
                } else if (action === 'keys') {
                    const all = DB.getArtifactStorage ? DB.getArtifactStorage(scopeKey) : {};
                    result = Object.keys(all);
                } else if (action === 'getAll') {
                    result = DB.getArtifactStorage ? DB.getArtifactStorage(scopeKey) : {};
                } else if (action === 'set' || action === 'remove' || action === 'clear') {
                    if (!this._checkStorageRate(event.source)) {
                        throw new Error('RateLimitExceeded: too many storage writes');
                    }
                    if (action === 'set') {
                        DB.setArtifactStorageItem(scopeKey, msg.key, msg.value, false);
                    } else if (action === 'remove') {
                        DB.removeArtifactStorageItem(scopeKey, msg.key, false);
                    } else {
                        DB.clearArtifactStorage(scopeKey, false);
                    }
                    result = true;
                    this._scheduleStorageFlush();
                    this._broadcastStorageSync(scopeKey, event.source);
                    this.updateResetStorageButton();
                    if (typeof matchedEntry.onDataChange === 'function') {
                        try { matchedEntry.onDataChange(scopeKey); } catch (_) {}
                    }
                    try {
                        window.dispatchEvent(new CustomEvent('aru-artifact-storage-changed', { detail: { scopeKey } }));
                    } catch (_) {}
                } else {
                    throw new Error('Unknown storage action');
                }
            } catch (err) {
                error = err && err.message ? err.message : String(err || 'Storage error');
            }

            if (msg.requestId && event.source && typeof event.source.postMessage === 'function') {
                try {
                    event.source.postMessage({
                        type: 'ARU_STORAGE_RESPONSE',
                        requestId: msg.requestId,
                        result,
                        error
                    }, '*');
                } catch (_) {}
            }
        });

        window.addEventListener('pagehide', () => this.flushPendingStorage());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.flushPendingStorage();
        });
    },

    _checkStorageRate(win) {
        if (!win) return false;
        const now = Date.now();
        let entry = this._storageRate.get(win);
        if (!entry || now - entry.winStart >= 1000) {
            entry = { winStart: now, count: 0 };
            this._storageRate.set(win, entry);
        }
        entry.count++;
        return entry.count <= 120;
    },

    _scheduleStorageFlush() {
        this._storageDirty = true;
        if (this._storageFlushTimer) clearTimeout(this._storageFlushTimer);
        this._storageFlushTimer = setTimeout(() => this.flushPendingStorage(), 400);
    },

    flushPendingStorage() {
        if (this._storageFlushTimer) {
            clearTimeout(this._storageFlushTimer);
            this._storageFlushTimer = null;
        }
        if (!this._storageDirty) return;
        this._storageDirty = false;
        try {
            if (DB && typeof DB.save === 'function') DB.save();
        } catch (e) {
            console.warn('CanvasManager.flushPendingStorage failed', e);
        }
    },

    _broadcastStorageSync(scopeKey, excludeSource) {
        if (!scopeKey || !DB.getArtifactStorage) return;
        const snapshot = DB.getArtifactStorage(scopeKey);
        for (const [frameEl, entry] of this._storageFrames.entries()) {
            if (!frameEl || !frameEl.isConnected) {
                this._storageFrames.delete(frameEl);
                continue;
            }
            if (entry.scopeKey !== scopeKey) continue;
            if (frameEl.contentWindow && frameEl.contentWindow !== excludeSource) {
                try {
                    frameEl.contentWindow.postMessage({ type: 'ARU_STORAGE_SYNC', data: snapshot }, '*');
                } catch (_) {}
            }
        }
    },

    registerStorageFrame(iframe, meta = {}) {
        if (!iframe) return;
        this._storageFrames.set(iframe, {
            scopeKey: meta.scopeKey || null,
            type: meta.type || 'app',
            title: meta.title || '',
            code: meta.code || '',
            onDataChange: meta.onDataChange || null
        });
    },

    unregisterStorageFrame(iframe) {
        if (!iframe) return;
        if (this._storageFrames.has(iframe)) {
            this._storageFrames.delete(iframe);
            this.flushPendingStorage();
        }
    },

    _resolveActiveTabScope(type, title, sourceOverride = null) {
        if (!title || type === 'doc' || !DB.getArtifactScopeKey) return null;
        const st = window.aruState;
        const tab = st && st.activeTabIndex >= 0 ? st.tabs[st.activeTabIndex] : null;
        const art = tab && tab.artifact;
        const sameArt = !!(art && art.title === title && art.type === type);
        if (sourceOverride === 'module' || (sameArt && art.source === 'module')) {
            return DB.getArtifactScopeKey({ source: 'module', type, title });
        }
        if (sameArt && art.storageScope) return art.storageScope;
        if (tab && tab.type === 'plugin' && tab.pluginId === 'skills') {
            return (sameArt && art.storageScope) ? art.storageScope : null;
        }
        if (tab && tab.chatId !== null && tab.chatId !== undefined) {
            return DB.getArtifactScopeKey({
                source: 'chat',
                type,
                title,
                chatId: tab.chatId,
                isPrivate: !!tab.isPrivate
            });
        }
        return null;
    },

    _buildStorageShim(initialData = {}, persistent = false) {
        const initialJson = JSON.stringify(initialData || {})
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029');
        const persistentFlag = persistent ? 'true' : 'false';
        return `<script>(function(){
            var persistent = ${persistentFlag};
            var data = Object.create(null);
            try {
                var init = ${initialJson};
                if (init && typeof init === 'object') {
                    var initKeys = Object.keys(init);
                    for (var i = 0; i < initKeys.length; i++) {
                        data[initKeys[i]] = String(init[initKeys[i]]);
                    }
                }
            } catch (_) {}

            function postBridge(msg) {
                if (!persistent || !window.parent || window.parent === window) return;
                try { window.parent.postMessage(msg, '*'); } catch (_) {}
            }

            var apiTarget = Object.create(null);
            apiTarget.getItem = function(k) {
                k = String(k);
                return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
            };
            apiTarget.setItem = function(k, v) {
                k = String(k);
                v = String(v);
                data[k] = v;
                postBridge({ type: 'ARU_STORAGE_REQUEST', action: 'set', key: k, value: v });
            };
            apiTarget.removeItem = function(k) {
                k = String(k);
                delete data[k];
                postBridge({ type: 'ARU_STORAGE_REQUEST', action: 'remove', key: k });
            };
            apiTarget.clear = function() {
                data = Object.create(null);
                postBridge({ type: 'ARU_STORAGE_REQUEST', action: 'clear' });
            };
            apiTarget.key = function(i) {
                var keys = Object.keys(data);
                return (i >= 0 && i < keys.length) ? keys[i] : null;
            };
            Object.defineProperty(apiTarget, 'length', {
                enumerable: false,
                configurable: true,
                get: function() { return Object.keys(data).length; }
            });

            var localStore = apiTarget;
            if (typeof Proxy === 'function') {
                var hasOwn = Object.prototype.hasOwnProperty;
                localStore = new Proxy(apiTarget, {
                    get: function(target, prop) {
                        if (typeof prop === 'symbol') return target[prop];
                        if (hasOwn.call(target, prop)) return target[prop];
                        return hasOwn.call(data, prop) ? data[prop] : undefined;
                    },
                    set: function(target, prop, value) {
                        if (typeof prop !== 'symbol' && !hasOwn.call(target, prop)) {
                            apiTarget.setItem(prop, value);
                            return true;
                        }
                        return false;
                    },
                    deleteProperty: function(target, prop) {
                        if (typeof prop !== 'symbol' && !hasOwn.call(target, prop)) {
                            apiTarget.removeItem(prop);
                        }
                        return true;
                    },
                    has: function(target, prop) {
                        return hasOwn.call(target, prop) || hasOwn.call(data, String(prop));
                    },
                    ownKeys: function() {
                        return Object.keys(data);
                    },
                    getOwnPropertyDescriptor: function(target, prop) {
                        if (hasOwn.call(data, String(prop))) {
                            return { enumerable: true, configurable: true, value: data[String(prop)] };
                        }
                        return Object.getOwnPropertyDescriptor(target, prop);
                    }
                });
            }

            function makeMemStore() {
                var mem = Object.create(null);
                return {
                    getItem: function(k) { k = String(k); return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
                    setItem: function(k, v) { mem[String(k)] = String(v); },
                    removeItem: function(k) { delete mem[String(k)]; },
                    clear: function() { mem = Object.create(null); },
                    key: function(i) { var ks = Object.keys(mem); return (i >= 0 && i < ks.length) ? ks[i] : null; },
                    get length() { return Object.keys(mem).length; }
                };
            }

            // Always bind sandbox localStorage to our isolated backing store so opaque
            // origins work without SecurityError and host storage stays untouched.
            try {
                Object.defineProperty(window, 'localStorage', { configurable: true, get: function() { return localStore; } });
            } catch (e) {}

            var sessionStore = makeMemStore();
            try { window.sessionStorage.getItem('__aru_probe__'); } catch (e2) {
                try {
                    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function() { return sessionStore; } });
                } catch (e3) {}
            }

            var pending = new Map();
            var reqSeq = 0;

            window.addEventListener('message', function(event) {
                if (event.source !== window.parent || !event.data) return;
                var msg = event.data;
                if (msg.type === 'ARU_STORAGE_SYNC' && msg.data && typeof msg.data === 'object') {
                    var next = Object.create(null);
                    var ks = Object.keys(msg.data);
                    for (var i = 0; i < ks.length; i++) next[ks[i]] = String(msg.data[ks[i]]);
                    data = next;
                    return;
                }
                if (msg.type === 'ARU_STORAGE_RESPONSE' && msg.requestId && pending.has(msg.requestId)) {
                    var entry = pending.get(msg.requestId);
                    pending.delete(msg.requestId);
                    if (msg.error) entry.reject(new Error(msg.error));
                    else entry.resolve(msg.result);
                }
            });

            function request(action, key, value) {
                if (!persistent || !window.parent || window.parent === window) {
                    return Promise.resolve(true);
                }
                return new Promise(function(resolve, reject) {
                    var requestId = 'r_' + (++reqSeq) + '_' + Math.random().toString(36).slice(2, 8);
                    pending.set(requestId, { resolve: resolve, reject: reject });
                    try {
                        window.parent.postMessage({
                            type: 'ARU_STORAGE_REQUEST',
                            requestId: requestId,
                            action: action,
                            key: key,
                            value: value
                        }, '*');
                    } catch (err) {
                        pending.delete(requestId);
                        reject(err);
                    }
                });
            }

            function decodeValue(raw) {
                if (raw === null || raw === undefined) return null;
                try { return JSON.parse(raw); } catch (_) { return raw; }
            }

            window.aruStorage = {
                get: function(key) {
                    var k = String(key);
                    var raw = Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
                    return Promise.resolve(decodeValue(raw));
                },
                set: function(key, value) {
                    var k = String(key);
                    if (value === undefined) return window.aruStorage.remove(k);
                    var raw;
                    try { raw = JSON.stringify(value); } catch (err) { return Promise.reject(err); }
                    if (raw === undefined) return Promise.reject(new Error('Value is not JSON-serializable'));
                    var hadPrev = Object.prototype.hasOwnProperty.call(data, k);
                    var prev = data[k];
                    data[k] = raw;
                    return request('set', k, raw).catch(function(err) {
                        if (hadPrev) data[k] = prev;
                        else delete data[k];
                        throw err;
                    });
                },
                remove: function(key) {
                    var k = String(key);
                    var hadPrev = Object.prototype.hasOwnProperty.call(data, k);
                    var prev = data[k];
                    delete data[k];
                    return request('remove', k).catch(function(err) {
                        if (hadPrev) data[k] = prev;
                        throw err;
                    });
                },
                clear: function() {
                    var prev = data;
                    data = Object.create(null);
                    return request('clear').catch(function(err) {
                        data = prev;
                        throw err;
                    });
                },
                keys: function() {
                    return Promise.resolve(Object.keys(data));
                },
                getAll: function() {
                    var out = {};
                    var ks = Object.keys(data);
                    for (var i = 0; i < ks.length; i++) out[ks[i]] = decodeValue(data[ks[i]]);
                    return Promise.resolve(out);
                }
            };
        })();</script>`;
    },

    updateResetStorageButton() {
        const btn = document.getElementById('btn-canvas-reset-storage');
        if (!btn) return;
        const scope = this.currentArtifact && this.currentArtifact.storageScope;
        const hasData = !!(scope && DB && DB.hasArtifactStorage && DB.hasArtifactStorage(scope));
        btn.classList.toggle('hidden', !hasData);
    },

    notifyScopeReset(scopeKey) {
        if (!scopeKey) return;
        for (const [frameEl, entry] of this._storageFrames.entries()) {
            if (!frameEl || !frameEl.isConnected) {
                this._storageFrames.delete(frameEl);
                continue;
            }
            if (entry.scopeKey !== scopeKey) continue;
            frameEl.dataset.lastCode = '';
            this.renderInto(frameEl, entry);
        }
        this.updateResetStorageButton();
        try {
            window.dispatchEvent(new CustomEvent('aru-artifact-storage-changed', { detail: { scopeKey } }));
        } catch (_) {}
    },

    async resetCurrentArtifactStorage(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        const scope = this.currentArtifact && this.currentArtifact.storageScope;
        if (!scope || !DB.clearArtifactStorage) return;
        const appState = window.aruState || {};
        const t = appState.translations || {};
        const msg = t.confirm_reset_artifact_data || 'Reset saved data (records, history, state) for this artifact? The artifact code will remain intact.';
        if (!(await UI.confirm(msg))) return;
        this.flushPendingStorage();
        DB.clearArtifactStorage(scope, true);
        this.notifyScopeReset(scope);
        UI.showToast(t.toast_artifact_data_reset || 'Artifact data reset', 'rotate-ccw');
    },

    renderArtifact(type, title, code, meta = {}) {
        const storageScope = meta.storageScope !== undefined
            ? meta.storageScope
            : this._resolveActiveTabScope(type, title, meta.source || null);
        this.currentArtifact = {
            type,
            title,
            code,
            source: meta.source || null,
            storageScope
        };
        this.open();

        document.getElementById('canvas-empty-state').classList.add('hidden');
        document.getElementById('canvas-render-area').classList.remove('hidden');

        const tabsEl = document.getElementById('canvas-tabs');
        const btnEdit = document.getElementById('btn-canvas-edit');
        const showTabs = (type === 'app' || type === 'game' || type === 'analytics' || type === 'doc');
        if (tabsEl) tabsEl.classList.toggle('hidden', !showTabs);
        if (btnEdit) btnEdit.classList.toggle('hidden', type !== 'doc');
        document.getElementById('canvas-title-text').textContent = title;

        this.switchTab('preview');
        this.updateResetStorageButton();
    },

    switchTab(tab) {
        const renderArea = document.getElementById('canvas-render-area');
        const codeArea = document.getElementById('canvas-code-area');
        const editArea = document.getElementById('canvas-edit-area');
        const btnPreview = document.getElementById('btn-canvas-preview');
        const btnCode = document.getElementById('btn-canvas-code');
        const btnEdit = document.getElementById('btn-canvas-edit');

        if (!this.currentArtifact) tab = 'preview';
        if (this.currentArtifact && this.currentArtifact.type !== 'doc' && tab === 'edit') tab = 'preview';

        const activeCls = 'flex-1 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-gray-700 shadow-sm transition-all';
        const idleCls = 'flex-1 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-700 dark:text-gray-400 transition-all';
        btnPreview.className = tab === 'preview' ? activeCls : idleCls;
        btnCode.className = tab === 'code' ? activeCls : idleCls;
        if (btnEdit) {
            const isDoc = this.currentArtifact && this.currentArtifact.type === 'doc';
            btnEdit.className = (tab === 'edit' ? activeCls : idleCls) + (isDoc ? '' : ' hidden');
        }

        renderArea.classList.toggle('hidden', tab !== 'preview');
        codeArea.classList.toggle('hidden', tab !== 'code');
        if (editArea) editArea.classList.toggle('hidden', tab !== 'edit');

        if (tab === 'preview') {
            this.renderPreview();
        } else if (tab === 'code') {
            this.renderCode();
        } else if (tab === 'edit') {
            this.loadDocEditor();
        }
    },

    renderPreview() {
        if (!this.currentArtifact) return;
        const state = window.aruState;
        if (!state || state.activeTabIndex === -1) return;

        const tab = state.tabs[state.activeTabIndex];
        const chatId = this.getTabKey(tab);
        if (chatId === null || chatId === undefined) return;
        const { type, title, code } = this.currentArtifact;
        const storageScope = this.currentArtifact.storageScope !== undefined
            ? this.currentArtifact.storageScope
            : this._resolveActiveTabScope(type, title, this.currentArtifact.source || null);
        this.currentArtifact.storageScope = storageScope;
        const renderArea = document.getElementById('canvas-render-area');

        if (!this.containers[chatId]) {
            const container = document.createElement('div');
            container.className = 'w-full h-full chat-artifact-container';
            container.dataset.chatId = String(chatId);
            renderArea.appendChild(container);

            const iframe = document.createElement('iframe');
            iframe.className = 'w-full h-full border-none';
            iframe.sandbox = 'allow-scripts allow-forms allow-modals allow-popups';

            container.appendChild(iframe);
            this.containers[chatId] = { container, iframe };
        }

        const { iframe, container } = this.containers[chatId];

        renderArea.querySelectorAll('.chat-artifact-container').forEach(el => el.classList.add('hidden'));
        container.classList.remove('hidden');

        const isDark = document.documentElement.classList.contains('dark');
        const theme = isDark ? 'dark' : 'light';
        const scopeAttr = String(storageScope || '');

        if (iframe.dataset.lastCode === code && iframe.dataset.lastTheme === theme && iframe.dataset.lastScope === scopeAttr) {
            this.updateResetStorageButton();
            return;
        }

        iframe.dataset.lastCode = code;
        iframe.dataset.lastTheme = theme;
        iframe.dataset.lastScope = scopeAttr;
        this.renderInto(iframe, { type, title, code, storageScope });
        this.updateResetStorageButton();
    },

    renderInto(iframe, { type, title, code, storageScope = null, onDataChange = null }) {
        const isDark = document.documentElement.classList.contains('dark');
        const effectiveScope = (type === 'doc') ? null : (storageScope || null);
        this._ensureStorageBridge();
        this.registerStorageFrame(iframe, {
            scopeKey: effectiveScope,
            type,
            title,
            code,
            onDataChange
        });
        let finalCode = code;
        if (type === 'doc') {
            if (typeof marked !== 'undefined') {
                const docHtml = marked.parse(code);
                let safeHtml = (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(docHtml) : docHtml;
                // The chat markdown renderer injects a copy button that relies on the
                // parent page cache; inside the sandbox it would be a dead icon.
                try {
                    const holder = document.createElement('div');
                    holder.innerHTML = safeHtml;
                    holder.querySelectorAll('div.rounded-xl > div:first-child > button').forEach(btn => btn.remove());
                    safeHtml = holder.innerHTML;
                } catch (e) { /* keep sanitized markup as-is */ }
                finalCode = `<article class="aru-doc">${safeHtml}</article>`;
            } else {
                finalCode = `<pre class="aru-doc">${UI.escapeHTML(code)}</pre>`;
            }
        } else if (type === 'app' || type === 'game' || type === 'analytics') {
            if (!/<!DOCTYPE html>/i.test(code) && !/^\s*<html/i.test(code)) {
                if (!/<\w+[^>]*>/.test(code)) {
                    finalCode = `<div id="root"></div><script>try { ${code} } catch(e) { console.error(e); document.getElementById('root').innerText = 'Runtime error: ' + e.message; }</script>`;
                } else {
                    finalCode = code;
                }
            } else {
                finalCode = code;
            }
        }

        const gameScaling = (type === 'game') ? `
            canvas, img, svg, video { max-width: 100% !important; height: auto !important; object-fit: contain; }
            body { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; min-height: 100vh; margin: 0; padding: 10px; overflow-x: hidden; }
            #app, #root, #game-container { max-width: 100%; width: 100%; }
        ` : '';

        // Text documents must read exactly like the "Edit" tab, which renders inside
        // #doc-editor with the app transcript styles. The typography plugin is not
        // available in the sandbox, so the document rules are spelled out here.
        const docStyles = (type === 'doc') ? `
            body {
                margin: 0;
                padding: 20px;
                background: #ffffff;
                color: #1f2937;
                font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                font-size: 14px;
                line-height: 1.65;
                -webkit-font-smoothing: antialiased;
            }
            .dark body { background: #1c1c1e; color: #e5e7eb; }
            .aru-doc { max-width: none; word-break: break-word; }
            .aru-doc > :first-child { margin-top: 0; }
            .aru-doc > :last-child { margin-bottom: 0; }
            .aru-doc h1, .aru-doc h2, .aru-doc h3,
            .aru-doc h4, .aru-doc h5, .aru-doc h6 {
                margin: 0.9em 0 0.45em;
                font-weight: 700;
                line-height: 1.3;
                letter-spacing: -0.01em;
            }
            .aru-doc h1 { font-size: 1.45em; }
            .aru-doc h2 { font-size: 1.25em; }
            .aru-doc h3 { font-size: 1.1em; }
            .aru-doc h4, .aru-doc h5, .aru-doc h6 { font-size: 1em; }
            .aru-doc p { margin: 0.5em 0; }
            .aru-doc ul, .aru-doc ol { margin: 0.5em 0; padding-left: 1.4em; }
            .aru-doc ul { list-style: disc; }
            .aru-doc ol { list-style: decimal; }
            .aru-doc li { margin: 0.2em 0; }
            .aru-doc li > ul, .aru-doc li > ol { margin: 0.2em 0; }
            .aru-doc input[type="checkbox"] { margin: 0 0.45em 0 0; vertical-align: middle; accent-color: #f97316; }
            .aru-doc blockquote {
                margin: 0.6em 0;
                padding-left: 0.9em;
                border-left: 3px solid #f97316;
                color: #6b7280;
            }
            .dark .aru-doc blockquote { color: #9ca3af; }
            .aru-doc a { color: #f97316; text-decoration: underline; }
            .aru-doc strong { font-weight: 700; }
            .aru-doc :not(pre) > code {
                padding: 0.1em 0.35em;
                border-radius: 4px;
                background: #f3f4f6;
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-size: 0.9em;
            }
            .dark .aru-doc :not(pre) > code { background: #1f2937; }
            .aru-doc pre {
                margin: 0.6em 0;
                padding: 0.8em 1em;
                border-radius: 8px;
                background: #f3f4f6;
                overflow-x: auto;
            }
            .dark .aru-doc pre { background: #1f2937; }
            .aru-doc pre code,
            .aru-doc pre code.hljs { background: transparent !important; padding: 0; font-size: 0.92em; color: inherit; }
            .aru-doc hr { margin: 1em 0; border: 0; border-top: 1px solid #e9e9ec; }
            .dark .aru-doc hr { border-top-color: #2b2b2f; }
            .aru-doc table { width: 100%; margin: 0.65em 0; border-collapse: collapse; font-size: 0.95em; }
            .aru-doc th, .aru-doc td { padding: 6px 9px; text-align: left; }
            .aru-doc th { background: #f4f4f6; font-weight: 700; }
            .dark .aru-doc th { background: #232326; }
            .aru-doc tbody tr:nth-child(even) { background: #fafafa; }
            .dark .aru-doc tbody tr:nth-child(even) { background: #202023; }
            .aru-doc img { max-width: 100%; height: auto; border-radius: 8px; }
            /* Fenced code arrives as a chat-style card; keep its shape but drop the hairline. */
            .aru-doc > div.rounded-xl {
                margin: 0.9em 0 !important;
                border: 0 !important;
                box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 6px 14px -8px rgba(15, 23, 42, 0.22) !important;
            }
            .dark .aru-doc > div.rounded-xl {
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45), 0 8px 18px -10px rgba(0, 0, 0, 0.65) !important;
            }
            .aru-doc > div.rounded-xl > div:first-child {
                border-bottom: 0 !important;
                background: #f4f4f6 !important;
            }
            .dark .aru-doc > div.rounded-xl > div:first-child { background: #232326 !important; }
            .aru-doc > div.rounded-xl pre { background: #fafafa !important; }
            .dark .aru-doc > div.rounded-xl pre { background: #18181b !important; }
        ` : '';

        // Sandboxed iframes get an opaque origin, so native localStorage/sessionStorage
        // throw SecurityError. When an artifact has a persistent storageScope we pre-hydrate
        // its SQLite keys so synchronous localStorage works immediately and persist writes
        // back via postMessage, alongside the async window.aruStorage helper.
        const initialData = (effectiveScope && DB && DB.getArtifactStorage)
            ? DB.getArtifactStorage(effectiveScope)
            : {};
        const storageShim = this._buildStorageShim(initialData, !!effectiveScope);

        const pdfSnapshotBridge = `<script>(function(){
            window.addEventListener('message', function(e) {
                if (!e.data || e.data.type !== 'aru-pdf-snapshot' || e.source !== window.parent) return;
                try {
                    var clone = document.body ? document.body.cloneNode(true) : document.createElement('div');
                    var origCanvases = document.querySelectorAll('canvas');
                    var cloneCanvases = clone.querySelectorAll('canvas');
                    for (var i = 0; i < origCanvases.length; i++) {
                        try {
                            var img = document.createElement('img');
                            img.src = origCanvases[i].toDataURL('image/png');
                            img.style.maxWidth = '100%';
                            img.style.height = 'auto';
                            img.className = origCanvases[i].className;
                            if (cloneCanvases[i] && cloneCanvases[i].parentNode) {
                                cloneCanvases[i].parentNode.replaceChild(img, cloneCanvases[i]);
                            }
                        } catch (_) {}
                    }
                    var scripts = clone.querySelectorAll('script');
                    for (var j = 0; j < scripts.length; j++) scripts[j].remove();
                    var styles = [];
                    var styleEls = document.querySelectorAll('style');
                    for (var k = 0; k < styleEls.length; k++) styles.push(styleEls[k].textContent || '');
                    window.parent.postMessage({
                        type: 'aru-pdf-snapshot-result',
                        reqId: e.data.reqId,
                        html: clone.innerHTML || '',
                        styles: styles.join('\\n')
                    }, '*');
                } catch (err) {
                    window.parent.postMessage({
                        type: 'aru-pdf-snapshot-result',
                        reqId: e.data.reqId,
                        error: err && err.message ? err.message : 'snapshot failed'
                    }, '*');
                }
            });
        })();</script>`;

        const hljsTheme = isDark ? 'github-dark.min.css' : 'github.min.css';
        const isFullDoc = type !== 'doc' && (/<!DOCTYPE html>/i.test(finalCode) || /^\s*<html/i.test(finalCode));
        let sandboxHTML;

        if (isFullDoc) {
            const headInject = `${storageShim}\n${pdfSnapshotBridge}`;
            if (/<head[^>]*>/i.test(finalCode)) {
                sandboxHTML = finalCode.replace(/<head([^>]*)>/i, (_, attrs) => `<head${attrs}>\n${headInject}`);
            } else if (/<html[^>]*>/i.test(finalCode)) {
                sandboxHTML = finalCode.replace(/<html([^>]*)>/i, (_, attrs) => `<html${attrs}><head>${headInject}</head>`);
            } else {
                sandboxHTML = `${headInject}\n${finalCode}`;
            }
            if (isDark) {
                sandboxHTML = sandboxHTML.replace(/<html([^>]*)>/i, (m, attrs) => {
                    if (/class\s*=\s*["']/i.test(attrs)) {
                        return `<html${attrs.replace(/class\s*=\s*(["'])/i, 'class=$1dark ')}>`;
                    }
                    return `<html${attrs} class="dark">`;
                });
            }
        } else {
            sandboxHTML = `
            <!DOCTYPE html>
            <html lang="en" class="${isDark ? 'dark' : ''}">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                ${storageShim}
                ${pdfSnapshotBridge}
                ${type === 'doc' ? '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">' : ''}
                <script src="https://cdn.tailwindcss.com"></script>
                <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${hljsTheme}">
                <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
                <style>
                    body { background-color: #ffffff; color: #1f2937; padding: 20px; font-family: sans-serif; transition: background-color 0.3s; }
                    .dark body { background-color: #111827; color: #f3f4f6; }
                    ::-webkit-scrollbar { width: 6px; }
                    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
                    ${gameScaling}
                    ${docStyles}
                </style>
                <script>tailwind.config = { darkMode: 'class' };</script>
            </head>
            <body class="${type === 'doc' ? 'aru-doc-body' : 'bg-white dark:bg-gray-900'}">
                ${finalCode}
                <script>document.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el));</script>
            </body>
            </html>
        `;
        }

        iframe.srcdoc = sandboxHTML;
    },

    switchChat(chatId) {
        const renderArea = document.getElementById('canvas-render-area');
        if (!renderArea) return;

        renderArea.querySelectorAll('.chat-artifact-container').forEach(el => el.classList.add('hidden'));

        if (this.containers[chatId]) {
            this.containers[chatId].container.classList.remove('hidden');
            const empty = document.getElementById('canvas-empty-state');
            if (empty) empty.classList.add('hidden');
            renderArea.classList.remove('hidden');
            this.updateResetStorageButton();
        } else {
            this.clearCanvas();
        }
    },

    destroyContainer(chatId) {
        if (this.containers[chatId]) {
            this.unregisterStorageFrame(this.containers[chatId].iframe);
            this.containers[chatId].container.remove();
            delete this.containers[chatId];
        }
    },

    renderCode() {
        if (!this.currentArtifact) return;
        const { type, code } = this.currentArtifact;
        const codeDisplay = document.getElementById('code-display');
        let lang = 'javascript';
        if (type === 'doc') lang = 'markdown';
        else if (/^\s*</.test(code) || /<!DOCTYPE html>/i.test(code)) lang = 'xml';
        codeDisplay.className = `language-${lang}`;
        codeDisplay.textContent = code;
        if (typeof hljs !== 'undefined') {
            if (hljs.getLanguage(lang)) {
                codeDisplay.removeAttribute('data-highlighted');
                hljs.highlightElement(codeDisplay);
            } else {
                codeDisplay.removeAttribute('data-highlighted');
                codeDisplay.className = 'language-plaintext';
            }
        }
    },

    loadDocEditor() {
        if (!this.currentArtifact || this.currentArtifact.type !== 'doc') return;
        const editor = document.getElementById('doc-editor');
        if (!editor) return;
        const code = this.currentArtifact.code;
        if (typeof marked !== 'undefined') {
            const docHtml = marked.parse(code);
            let safeHtml = (typeof DOMPurify !== 'undefined')
                ? DOMPurify.sanitize(docHtml, { FORBID_ATTR: ['onclick'] })
                : docHtml;
            try {
                const holder = document.createElement('div');
                holder.innerHTML = safeHtml;
                holder.querySelectorAll('div.rounded-xl').forEach((card) => {
                    const pre = card.querySelector('pre');
                    const headerBtn = card.querySelector('div:first-child > button');
                    if (pre && headerBtn) card.replaceWith(pre);
                });
                safeHtml = holder.innerHTML;
            } catch (_) {}
            editor.innerHTML = safeHtml;
        } else {
            editor.textContent = code;
        }
        if (editor.dataset.pasteBound !== '1') {
            editor.dataset.pasteBound = '1';
            editor.addEventListener('paste', (e) => {
                if (!e.clipboardData) return;
                e.preventDefault();
                const html = e.clipboardData.getData('text/html');
                if (html && typeof DOMPurify !== 'undefined') {
                    const clean = DOMPurify.sanitize(html, {
                        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
                        FORBID_ATTR: ['onclick', 'onerror', 'onload']
                    });
                    document.execCommand('insertHTML', false, clean);
                } else {
                    const plain = e.clipboardData.getData('text/plain');
                    document.execCommand('insertText', false, plain);
                }
            });
        }
        if (window.lucide) window.lucide.createIcons();
    },

    async docEditCommand(cmd, value = null) {
        const editor = document.getElementById('doc-editor');
        if (!editor) return;
        if (cmd === 'createLink') {
            const sel = window.getSelection();
            const savedRange = (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode))
                ? sel.getRangeAt(0).cloneRange()
                : null;
            const t = window.aruState && window.aruState.translations ? window.aruState.translations : {};
            const rawUrl = await UI.prompt(t.edit_link_prompt || 'URL:', 'https://');
            const url = String(rawUrl || '').trim();
            if (!url || !/^(https?:|mailto:|tel:|#|\/)/i.test(url)) return;
            editor.focus();
            if (savedRange && sel) {
                sel.removeAllRanges();
                sel.addRange(savedRange);
            }
            document.execCommand('createLink', false, url);
            return;
        }
        editor.focus();
        if (cmd === 'formatBlock') {
            document.execCommand('formatBlock', false, value);
        } else {
            document.execCommand(cmd, false, value);
        }
    },

    saveDocEdit() {
        if (!this.currentArtifact || this.currentArtifact.type !== 'doc') return;
        const editor = document.getElementById('doc-editor');
        if (!editor) return;
        let markdown = editor.innerText;
        if (typeof TurndownService !== 'undefined') {
            const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
            td.addRule('strikethrough', {
                filter: ['del', 's'],
                replacement: (content) => `~~${content}~~`
            });
            markdown = td.turndown(editor.innerHTML);
        }
        this.currentArtifact.code = markdown;

        const state = window.aruState;
        const tab = state && state.tabs[state.activeTabIndex];
        if (tab) {
            tab.artifact = { ...this.currentArtifact };
            const tabKey = this.getTabKey(tab);
            const cacheKey = (tabKey !== null && tabKey !== undefined) ? `${tabKey}:${this.currentArtifact.title}` : this.currentArtifact.title;
            if (!window.aruArtifactsCache) window.aruArtifactsCache = {};
            window.aruArtifactsCache[cacheKey] = { type: 'doc', title: this.currentArtifact.title, code: markdown };
            if (tab.type === 'plugin' && tab.pluginId === 'skills' && window.DB && window.SkillsPlugin) {
                const projId = window.SkillsPlugin.state?.activeProjectId;
                const artId = window.SkillsPlugin.state?.lastArtifactId;
                const existing = artId && DB.getSkillArtifact ? DB.getSkillArtifact(artId) : null;
                if (existing && existing.title === this.currentArtifact.title && DB.saveSkillArtifact) {
                    DB.saveSkillArtifact(existing.project_id, existing.run_id ?? null, this.currentArtifact.title, 'doc', markdown);
                } else if (projId && DB.saveSkillArtifact) {
                    const savedId = DB.saveSkillArtifact(projId, null, this.currentArtifact.title, 'doc', markdown);
                    if (savedId) window.SkillsPlugin.state.lastArtifactId = savedId;
                }
            } else if (!tab.isPrivate && tab.type !== 'plugin' && tab.chatId !== null && tab.chatId !== undefined && window.DB && DB.saveChatArtifact) {
                DB.saveChatArtifact(tab.chatId, this.currentArtifact.title, 'doc', markdown);
            }
        }
        this.switchTab('preview');
    },

    cancelDocEdit() {
        this.switchTab('preview');
    },

    copyCode() {
        if (!this.currentArtifact || !navigator.clipboard?.writeText) return;
        const t = (window.aruState && window.aruState.translations) || {};
        navigator.clipboard.writeText(this.currentArtifact.code)
            .then(() => UI.showToast(t.copied || 'Скопировано', 'check'))
            .catch((e) => console.warn('CanvasManager.copyCode failed', e));
    },

    clearCanvas(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        this.currentArtifact = null;
        this.panel.classList.remove('canvas-fullscreen');
        document.getElementById('aru-desktop')?.classList.remove('wd-has-fullscreen-canvas');
        const icon = document.getElementById('canvas-maximize-icon');
        if (icon) icon.setAttribute('data-lucide', 'maximize-2');
        if (window.lucide) window.lucide.createIcons();
        
        const empty = document.getElementById('canvas-empty-state'); if (empty) empty.classList.remove('hidden');
        const render = document.getElementById('canvas-render-area'); if (render) {
            render.classList.add('hidden');
            render.querySelectorAll('.chat-artifact-container').forEach(el => el.classList.add('hidden'));
        }
        const codeArea = document.getElementById('canvas-code-area'); if (codeArea) codeArea.classList.add('hidden');
        const editArea = document.getElementById('canvas-edit-area'); if (editArea) editArea.classList.add('hidden');
        const tabs = document.getElementById('canvas-tabs'); if (tabs) tabs.classList.add('hidden');
        const title = document.getElementById('canvas-title-text'); if (title) title.textContent = 'Canvas';
        this.updateResetStorageButton();
    },

    toggleFullscreen(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        this.panel.classList.toggle('canvas-fullscreen');
        const isFullscreen = this.panel.classList.contains('canvas-fullscreen');
        document.getElementById('aru-desktop')?.classList.toggle('wd-has-fullscreen-canvas', isFullscreen);
        
        const icon = document.getElementById('canvas-maximize-icon');
        const btn = icon ? icon.closest('button') : null;
        
        if (icon) {
            icon.setAttribute('data-lucide', isFullscreen ? 'minimize-2' : 'maximize-2');
            if (window.lucide) window.lucide.createIcons();
        }
        
        if (btn) {
            const state = window.aruState || {};
            const t = state.translations || {};
            btn.title = isFullscreen ? 
                (t.canvas_minimize_tooltip || 'Restore') : 
                (t.canvas_expand_tooltip || 'Maximize');
        }
    },

    toggleDownloadDropdown(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        const dropdown = document.getElementById('download-dropdown');
        if (!dropdown) return;
        if (this._closeDownloadDropdown) {
            document.removeEventListener('click', this._closeDownloadDropdown);
            this._closeDownloadDropdown = null;
        }
        dropdown.classList.toggle('hidden');

        if (!dropdown.classList.contains('hidden')) {
            this._closeDownloadDropdown = (e) => {
                if (!dropdown.contains(e.target)) {
                    dropdown.classList.add('hidden');
                    document.removeEventListener('click', this._closeDownloadDropdown);
                    this._closeDownloadDropdown = null;
                }
            };
            document.addEventListener('click', this._closeDownloadDropdown);
        }
    },

    downloadAsHTML(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        if (!this.currentArtifact) return;
        const { title, type, code } = this.currentArtifact;
        const safeTitle = UI.escapeHTML(title || 'artifact');

        let outHtml = code;
        if (type === 'doc') {
            let rendered = '';
            if (typeof marked !== 'undefined') {
                const docHtml = marked.parse(code);
                let safeHtml = (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(docHtml) : docHtml;
                try {
                    const holder = document.createElement('div');
                    holder.innerHTML = safeHtml;
                    holder.querySelectorAll('div.rounded-xl > div:first-child > button').forEach(btn => btn.remove());
                    safeHtml = holder.innerHTML;
                } catch (_) {}
                rendered = `<article class="aru-doc">${safeHtml}</article>`;
            } else {
                rendered = `<pre class="aru-doc">${UI.escapeHTML(code)}</pre>`;
            }
            outHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
<style>
  body { margin: 0; padding: 32px 20px; background: #ffffff; color: #1f2937; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 15px; line-height: 1.65; }
  .aru-doc { max-width: 780px; margin: 0 auto; word-break: break-word; }
  .aru-doc h1, .aru-doc h2, .aru-doc h3, .aru-doc h4 { margin: 1em 0 0.45em; font-weight: 700; line-height: 1.3; }
  .aru-doc p { margin: 0.6em 0; }
  .aru-doc ul, .aru-doc ol { margin: 0.6em 0; padding-left: 1.4em; }
  .aru-doc blockquote { margin: 0.8em 0; padding-left: 1em; border-left: 3px solid #f97316; color: #6b7280; }
  .aru-doc :not(pre) > code { padding: 0.1em 0.35em; border-radius: 4px; background: #f3f4f6; font-family: monospace; font-size: 0.9em; }
  .aru-doc pre { margin: 0.8em 0; padding: 0.9em 1em; border-radius: 8px; background: #f3f4f6; overflow-x: auto; }
  .aru-doc pre code { background: transparent; padding: 0; }
  .aru-doc table { width: 100%; margin: 0.8em 0; border-collapse: collapse; }
  .aru-doc th, .aru-doc td { padding: 6px 9px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  .aru-doc img { max-width: 100%; height: auto; border-radius: 8px; }
</style>
</head>
<body>
${rendered}
</body>
</html>`;
        } else if (!/<!DOCTYPE html>/i.test(code) && !/^\s*<html/i.test(code)) {
            outHtml = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${safeTitle}</title>\n<script src="https://cdn.tailwindcss.com"></script>\n</head>\n<body class="p-6">\n${code}\n</body>\n</html>`;
        }

        const blob = new Blob([outHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(title || 'artifact').replace(/\s+/g, '_')}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        document.getElementById('download-dropdown')?.classList.add('hidden');
    },

    _requestPdfSnapshot(iframe) {
        return new Promise((resolve) => {
            if (!iframe || !iframe.contentWindow) {
                resolve(null);
                return;
            }
            const reqId = 'pdf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            let done = false;
            const finish = (payload) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                window.removeEventListener('message', onMessage);
                resolve(payload);
            };
            const onMessage = (e) => {
                if (e.source !== iframe.contentWindow) return;
                const d = e.data;
                if (!d || d.type !== 'aru-pdf-snapshot-result' || d.reqId !== reqId) return;
                finish(d);
            };
            const timer = setTimeout(() => finish(null), 4000);
            window.addEventListener('message', onMessage);
            try {
                iframe.contentWindow.postMessage({ type: 'aru-pdf-snapshot', reqId }, '*');
            } catch (_) {
                finish(null);
            }
        });
    },

    async downloadAsPDF(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        if (!this.currentArtifact) return;
        const { title, type, code } = this.currentArtifact;
        const state = window.aruState;
        if (!state || state.activeTabIndex === -1) return;

        const tabKey = this.getTabKey(state.tabs[state.activeTabIndex]);
        const container = this.containers[tabKey];

        try {
            document.getElementById('download-dropdown')?.classList.add('hidden');
            if (typeof html2pdf === 'undefined') {
                try {
                    await loadHtml2Pdf();
                } catch (loadErr) {
                    console.warn('Lazy html2pdf load failed:', loadErr);
                }
            }
            if (typeof html2pdf === 'undefined') {
                await UI.alert('PDF exporter library is not loaded.');
                return;
            }

            const element = document.createElement('div');
            element.style.padding = '20px';
            element.style.backgroundColor = 'white';
            element.style.color = '#111827';
            element.classList.add('pdf-export-container');

            if (type === 'doc') {
                const printCss = document.createElement('style');
                printCss.textContent = `
                    .pdf-export-container .aru-doc { font-family: Inter, sans-serif; font-size: 13px; line-height: 1.65; color: #1f2937; }
                    .pdf-export-container .aru-doc h1 { font-size: 1.45em; font-weight: 700; margin: 0.9em 0 0.4em; }
                    .pdf-export-container .aru-doc h2 { font-size: 1.25em; font-weight: 700; margin: 0.9em 0 0.4em; }
                    .pdf-export-container .aru-doc h3 { font-size: 1.1em; font-weight: 700; margin: 0.8em 0 0.4em; }
                    .pdf-export-container .aru-doc p { margin: 0.5em 0; }
                    .pdf-export-container .aru-doc ul { list-style: disc; padding-left: 1.4em; margin: 0.5em 0; }
                    .pdf-export-container .aru-doc ol { list-style: decimal; padding-left: 1.4em; margin: 0.5em 0; }
                    .pdf-export-container .aru-doc blockquote { border-left: 3px solid #f97316; padding-left: 0.9em; color: #4b5563; margin: 0.6em 0; }
                    .pdf-export-container .aru-doc pre { background: #f3f4f6; padding: 0.8em 1em; border-radius: 6px; overflow-x: auto; margin: 0.6em 0; }
                    .pdf-export-container .aru-doc code { font-family: monospace; font-size: 0.9em; background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 4px; }
                    .pdf-export-container .aru-doc pre code { background: transparent; padding: 0; }
                    .pdf-export-container .aru-doc table { width: 100%; border-collapse: collapse; margin: 0.65em 0; }
                    .pdf-export-container .aru-doc th, .pdf-export-container .aru-doc td { padding: 6px 8px; border-bottom: 1px solid #d1d5db; text-align: left; }
                `;
                element.appendChild(printCss);
                const holder = document.createElement('div');
                if (typeof marked !== 'undefined') {
                    const docHtml = marked.parse(code);
                    const safeHtml = (typeof DOMPurify !== 'undefined')
                        ? DOMPurify.sanitize(docHtml, { FORBID_TAGS: ['script', 'iframe'], FORBID_ATTR: ['onclick', 'onerror', 'onload'] })
                        : docHtml;
                    holder.innerHTML = `<article class="aru-doc">${safeHtml}</article>`;
                    holder.querySelectorAll('div.rounded-xl > div:first-child > button').forEach(btn => btn.remove());
                } else {
                    const pre = document.createElement('pre');
                    pre.className = 'aru-doc';
                    pre.textContent = code;
                    holder.appendChild(pre);
                }
                element.appendChild(holder);
                if (typeof UI.renderMath === 'function') UI.renderMath(element);
            } else {
                const snap = container && container.iframe ? await this._requestPdfSnapshot(container.iframe) : null;
                if (snap && snap.styles) {
                    const snapCss = document.createElement('style');
                    snapCss.textContent = String(snap.styles).replace(/<\/style/gi, '<\\/style');
                    element.appendChild(snapCss);
                }
                const rawHtml = (snap && !snap.error && typeof snap.html === 'string' && snap.html.trim()) ? snap.html : code;
                const safeHtml = (typeof DOMPurify !== 'undefined')
                    ? DOMPurify.sanitize(rawHtml, { FORBID_TAGS: ['script', 'iframe', 'object', 'embed'], FORBID_ATTR: ['onclick', 'onerror', 'onload'] })
                    : UI.escapeHTML(rawHtml);
                const holder = document.createElement('div');
                holder.innerHTML = safeHtml;
                element.appendChild(holder);
            }

            const opt = {
                margin: 10,
                filename: `${(title || 'artifact').replace(/\s+/g, '_')}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true, logging: false },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            // @ts-ignore
            await html2pdf().set(opt).from(element).save();
        } catch (e) {
            console.error('PDF Generation Error:', e);
            await UI.alert('Error generating PDF: ' + e.message);
        }
    },

    downloadCurrentArtifact(evt) {
        this.downloadAsHTML(evt);
    },

    async saveCurrentArtifact() {
        if (!this.currentArtifact) return;
        const appState = window.aruState || {};
        const t = appState.translations || {};

        this.flushPendingStorage();
        const oldScope = this.currentArtifact.storageScope || null;
        let title = this.currentArtifact.title;
        let type = this.currentArtifact.type;

        if (DB.moduleExists(type, title)) {
            const overwrite = await UI.confirm(t.confirm_overwrite_artifact || 'Artifact with this name already exists. Overwrite?');
            if (!overwrite) {
                const newTitle = await UI.prompt(t.prompt_rename_chat || 'Enter new title:', title + ' (Copy)');
                if (!newTitle || !newTitle.trim()) return;
                title = newTitle.trim();
                this.currentArtifact.title = title;
                document.getElementById('canvas-title-text').textContent = title;
            }
        }

        const tags = await UI.prompt(t.canvas_save_prompt || 'Enter comma separated tags:', 'general');
        if (tags === null) return;

        try {
            DB.saveModule(type, title, this.currentArtifact.code, tags);
            const newScope = DB.getArtifactScopeKey
                ? DB.getArtifactScopeKey({ source: 'module', type, title })
                : null;
            if (oldScope && newScope && oldScope !== newScope && DB.hasArtifactStorage && DB.hasArtifactStorage(oldScope)) {
                DB.copyArtifactStorage(oldScope, newScope, { overwrite: false });
            }
            this.currentArtifact.source = 'module';
            this.currentArtifact.storageScope = newScope;

            const tab = appState.activeTabIndex >= 0 ? appState.tabs[appState.activeTabIndex] : null;
            const tabKey = this.getTabKey(tab);
            const activeContainer = tabKey !== null && tabKey !== undefined ? this.containers[tabKey] : null;
            if (tab && tab.artifact) {
                tab.artifact.title = title;
                tab.artifact.source = 'module';
                tab.artifact.storageScope = newScope;
            }
            if (activeContainer && activeContainer.iframe) {
                activeContainer.iframe.dataset.lastScope = String(newScope || '');
                const entry = this._storageFrames.get(activeContainer.iframe);
                if (entry) {
                    entry.scopeKey = newScope;
                    entry.title = title;
                } else {
                    this.registerStorageFrame(activeContainer.iframe, {
                        scopeKey: newScope,
                        type,
                        title,
                        code: this.currentArtifact.code
                    });
                }
            }
            if (newScope) {
                this._broadcastStorageSync(newScope, null);
                try {
                    window.dispatchEvent(new CustomEvent('aru-artifact-storage-changed', { detail: { scopeKey: newScope } }));
                } catch (_) {}
            }
            this.updateResetStorageButton();
            UI.showToast(t.toast_saved || 'Saved successfully', 'check-circle');
        } catch (e) {
            console.error(e);
            await UI.alert(t.lib_error || 'Save sequence encountered an error');
        }
    }
};
window.CanvasManager = CanvasManager;

