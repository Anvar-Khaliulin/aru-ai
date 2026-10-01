/*
---ARU-LAB.SPACE---ALMATY---2026---
Remote storage module: Google Drive and WebDAV adapters for syncing the portable SQLite DB file.
BYOK design: user-provided credentials, stored per-device and AES-GCM encrypted with the master password.
The synced .sqlite file itself stays credential-free and can be copied, moved or reconnected anywhere.
---chat.aru-lab.space---PWA---
*/
import { Auth } from './auth.js';

const translations = () => window.aruState?.translations || {};

function u8ToB64(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
}

function b64ToU8(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function b64Url(bytes) {
    return u8ToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------- Profile decryption (AES-GCM, key derived from the master password via PBKDF2) ----------

async function decryptProfile(blob, password) {
    const salt = b64ToU8(blob.salt);
    const iv = b64ToU8(blob.iv);
    const rawKey = await Auth._deriveKey(password, salt);
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b64ToU8(blob.ct));
    return JSON.parse(new TextDecoder().decode(plain));
}

// ---------- Google Drive adapter (Google Identity Services + Drive API v3, scope drive.file) ----------

const GoogleDriveAdapter = {
    type: 'gdrive',
    profile: null,

    _apiBase: 'https://www.googleapis.com/drive/v3',
    _uploadBase: 'https://www.googleapis.com/upload/drive/v3',

    init(profile) {
        this.profile = profile;
    },

    async _ensureGisLoaded() {
        if (window.google?.accounts?.oauth2) return;
        // Wait briefly if script tag is already in document
        if (document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
            for (let i = 0; i < 25; i++) {
                if (window.google?.accounts?.oauth2) return;
                await new Promise(r => setTimeout(r, 150));
            }
        }
        // If not loaded yet, inject dynamically
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = () => {
                if (window.google?.accounts?.oauth2) resolve();
                else reject(new Error('Google Identity Services script loaded but oauth2 is unavailable.'));
            };
            script.onerror = () => reject(new Error(translations().remote_error_gis_load || 'Не удалось загрузить библиотеку Google Identity Services. Проверьте интернет или блокировщики скриптов.'));
            document.head.appendChild(script);
        });
    },

    // Interactive popup authorization using GIS token client
    async authorize(clientId) {
        await this._ensureGisLoaded();
        return new Promise((resolve, reject) => {
            try {
                const tokenClient = window.google.accounts.oauth2.initTokenClient({
                    client_id: clientId,
                    scope: 'https://www.googleapis.com/auth/drive.file',
                    callback: (resp) => {
                        if (resp.error) {
                            const desc = resp.error_description || resp.error;
                            if (desc === 'popup_closed_by_user') {
                                reject(new Error(translations().remote_error_gdrive_closed || 'Окно авторизации Google было закрыто.'));
                            } else {
                                reject(new Error((translations().remote_error_gdrive_oauth || 'Ошибка Google OAuth: ') + desc));
                            }
                            return;
                        }
                        if (!resp.access_token) {
                            reject(new Error(translations().remote_error_gdrive_token || 'Токен доступа от Google не получен.'));
                            return;
                        }
                        resolve({
                            accessToken: resp.access_token,
                            expiresIn: parseInt(resp.expires_in) || 3599
                        });
                    },
                    error_callback: (err) => {
                        reject(new Error((translations().remote_error_gdrive_auth || 'Ошибка авторизации Google: ') + (err?.message || translations().remote_error_popup_blocked || 'всплывающее окно заблокировано браузером')));
                    }
                });
                tokenClient.requestAccessToken({ prompt: 'consent' });
            } catch (e) {
                reject(e);
            }
        });
    },

    // Backward-compatibility wrapper
    async startAuth(clientId, resume) {
        const tokens = await this.authorize(clientId);
        return { tokens, clientId, resume };
    },

    async handleAuthCallback() {
        return null;
    },

    async _ensureAccessToken() {
        const p = this.profile;
        const now = Date.now();
        if (p.accessToken && p.accessTokenExp && p.accessTokenExp - 60000 > now) return;

        // Try silent refresh in the background
        if (p.clientId) {
            try {
                await this._ensureGisLoaded();
                const refreshed = await new Promise((resolve, reject) => {
                    const client = window.google.accounts.oauth2.initTokenClient({
                        client_id: p.clientId,
                        scope: 'https://www.googleapis.com/auth/drive.file',
                        prompt: '',
                        callback: (resp) => {
                            if (resp.error || !resp.access_token) {
                                reject(new Error(resp.error_description || resp.error || 'Silent refresh failed'));
                                return;
                            }
                            resolve({
                                accessToken: resp.access_token,
                                expiresIn: parseInt(resp.expires_in) || 3599
                            });
                        },
                        error_callback: (err) => reject(new Error(err?.message || 'Silent refresh error'))
                    });
                    client.requestAccessToken({ prompt: '' });
                });

                p.accessToken = refreshed.accessToken;
                p.accessTokenExp = Date.now() + refreshed.expiresIn * 1000;
                if (RemoteStorage.onProfileChange) await RemoteStorage.onProfileChange(this.profile);
                return;
            } catch (silentErr) {
                console.warn('Google silent token refresh unavailable:', silentErr);
            }
        }

        throw new Error(translations().remote_error_reauth || 'Срок действия сессии Google Drive истёк. Пожалуйста, повторно авторизуйтесь в Настройках → Хранилище.');
    },

    async _api(path, options = {}) {
        await this._ensureAccessToken();
        const res = await fetch(this._apiBase + path, {
            ...options,
            headers: {
                'Authorization': `Bearer ${this.profile.accessToken}`,
                ...(options.headers || {})
            }
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Google Drive API error ${res.status}: ${text.slice(0, 300)}`);
        }
        return res;
    },

    // Creates (or reuses) the app-owned "Aru AI" folder
    async ensureFolder() {
        if (this.profile.folderId) {
            try {
                await this._api(`/files/${this.profile.folderId}?fields=id`);
                return this.profile.folderId;
            } catch (e) { /* folder gone, recreate */ }
        }
        const q = encodeURIComponent("name='Aru AI' and mimeType='application/vnd.google-apps.folder' and trashed=false");
        const res = await this._api(`/files?q=${q}&fields=files(id,name)`);
        const json = await res.json();
        if (json.files && json.files.length) {
            this.profile.folderId = json.files[0].id;
        } else {
            const createRes = await this._api('/files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Aru AI', mimeType: 'application/vnd.google-apps.folder' })
            });
            const created = await createRes.json();
            this.profile.folderId = created.id;
        }
        return this.profile.folderId;
    },

    async listFiles() {
        const folderId = await this.ensureFolder();
        const q = encodeURIComponent(`'${folderId}' in parents and name contains '.sqlite' and trashed=false`);
        const res = await this._api(`/files?q=${q}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc`);
        const json = await res.json();
        return (json.files || []).map(f => ({
            id: f.id,
            name: f.name,
            ts: Date.parse(f.modifiedTime) || 0,
            size: parseInt(f.size) || 0
        }));
    },

    async createFile(name) {
        await this._ensureAccessToken();
        const folderId = await this.ensureFolder();
        const metadata = { name, parents: [folderId] };
        const boundary = 'aru_boundary_' + Date.now();
        const body = new Blob([
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
            `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
            new Uint8Array(0),
            `\r\n--${boundary}--`
        ]);
        const res = await fetch(`${this._uploadBase}/files?uploadType=multipart&fields=id,name`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.profile.accessToken}`,
                'Content-Type': `multipart/related; boundary=${boundary}`
            },
            body
        });
        if (!res.ok) throw new Error('Google Drive create file failed: ' + res.status);
        const json = await res.json();
        return { id: json.id, name: json.name };
    },

    async load() {
        const res = await this._api(`/files/${this.profile.fileId}?alt=media`);
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
    },

    async save(bytes) {
        await this._ensureAccessToken();
        const res = await fetch(`${this._uploadBase}/files/${this.profile.fileId}?uploadType=media`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${this.profile.accessToken}`,
                'Content-Type': 'application/octet-stream',
                'Content-Length': bytes.length
            },
            body: bytes
        });
        if (!res.ok) throw new Error('Google Drive upload failed: ' + res.status);
    },

    async getRemoteInfo() {
        if (!this.profile.fileId) return null;
        let res;
        try {
            res = await this._api(`/files/${this.profile.fileId}?fields=id,name,modifiedTime,size`);
        } catch (e) {
            if (/\b404\b/.test(e.message)) return null; // file deleted or moved away
            throw e;
        }
        const json = await res.json();
        return {
            name: json.name,
            ts: Date.parse(json.modifiedTime) || 0,
            size: parseInt(json.size) || 0
        };
    },

    async removeFile(fileId) {
        await this._api(`/files/${fileId}`, { method: 'DELETE' });
    }
};

// ---------- WebDAV adapter (GET/PUT/PROPFIND, Basic Auth over HTTPS, direct or custom proxy) ----------

const WebDAVAdapter = {
    type: 'webdav',
    profile: null,

    init(profile) {
        this.profile = profile;
    },

    _baseUrl() {
        return (this.profile.url || '').replace(/\/+$/, '');
    },

    async _dav(pathname, options = {}) {
        const settings = window.aruState?.userSettings || {};
        const url = this._baseUrl() + pathname;
        const headers = { ...(options.headers || {}) };
        if (!options.skipAuth && this.profile.username) {
            const creds = u8ToB64(new TextEncoder().encode(`${this.profile.username}:${this.profile.password || ''}`));
            headers['Authorization'] = `Basic ${creds}`;
        }

        // Support custom proxy configured on the profile itself or in Network settings
        const customProxy = this.profile.proxyUrl || (settings.proxy_strategy === 'custom' ? settings.proxy_custom_url : null);
        let res;
        if (customProxy) {
            const proxyUrl = customProxy.includes('%URL%')
                ? customProxy.replace('%URL%', encodeURIComponent(url))
                : customProxy + encodeURIComponent(url);
            res = await fetch(proxyUrl, { ...options, headers });
        } else {
            try {
                res = await fetch(url, { ...options, headers });
            } catch (e) {
                const t = translations();
                const isCors = e.name === 'TypeError' || /fetch/i.test(e.message);
                if (isCors) {
                    throw new Error(t.remote_error_webdav_cors || 'WebDAV запрос заблокирован браузером (CORS). Для работы WebDAV в браузере требуется: 1) Включить CORS на сервере WebDAV (методы PROPFIND, MKCOL, заголовки Authorization, Depth), либо 2) Использовать обратный прокси на своём сервере (например /webdav), либо 3) Указать персональный CORS-прокси в настройках Сети.');
                }
                throw e;
            }
        }

        if (options.method === 'PROPFIND') return res; // 404 expected when probing
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`WebDAV error ${res.status}: ${text.slice(0, 300)}`);
        }
        return res;
    },

    _filePath() {
        const dir = (this.profile.davPath || '').replace(/^\/+|\/+$/g, '');
        return (dir ? '/' + dir : '') + '/' + (this.profile.fileName || 'aru_database.sqlite');
    },

    // Ensures the collection path exists, creating segments with MKCOL as needed
    async ensureCollection() {
        const segments = (this.profile.davPath || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        let current = '';
        for (const seg of segments) {
            current += '/' + seg;
            const probe = await this._dav(current + '/', { method: 'PROPFIND', headers: { Depth: '0' }, skipAuth: false }).catch(() => null);
            if (probe && probe.ok) continue;
            await this._dav(current, { method: 'MKCOL' }).catch(() => ({ ok: true })); // 405 = already exists
        }
    },

    async listFiles() {
        const dir = (this.profile.davPath || '').replace(/^\/+|\/+$/g, '');
        const path = dir ? '/' + dir + '/' : '/';
        const res = await this._dav(path, { method: 'PROPFIND', headers: { Depth: '1' } });
        if (!res.ok && res.status === 404) return [];
        const xmlText = await res.text();
        const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
        const parserError = doc.querySelector('parsererror');
        if (parserError) throw new Error('WebDAV list: ' + (translations().remote_error_webdav_xml || 'неверный XML-ответ от сервера'));
        const responses = Array.from(doc.getElementsByTagNameNS('*', 'response'));
        const files = [];
        for (const resp of responses) {
            const hrefEl = resp.getElementsByTagNameNS('*', 'href')[0];
            const isCollection = resp.getElementsByTagNameNS('*', 'collection').length > 0;
            if (!hrefEl || isCollection) continue;
            const href = decodeURIComponent(hrefEl.textContent);
            if (!href.endsWith('.sqlite') && !href.endsWith('.db')) continue;
            const lastmodEl = resp.getElementsByTagNameNS('*', 'getlastmodified')[0];
            const sizeEl = resp.getElementsByTagNameNS('*', 'getcontentlength')[0];
            files.push({
                id: href,
                name: href.split('/').filter(Boolean).pop(),
                ts: lastmodEl ? Date.parse(lastmodEl.textContent) || 0 : 0,
                size: sizeEl ? parseInt(sizeEl.textContent) || 0 : 0
            });
        }
        files.sort((a, b) => b.ts - a.ts);
        return files;
    },

    async createFile(name) {
        await this.ensureCollection();
        this.profile.fileName = name;
        await this._dav(this._filePath(), { method: 'PUT', body: new Uint8Array(0), headers: { 'Content-Type': 'application/x-sqlite3' } });
        return { id: this._filePath(), name };
    },

    async load() {
        const res = await this._dav(this._filePath(), { method: 'GET' });
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
    },

    async save(bytes) {
        const res = await this._dav(this._filePath(), { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/x-sqlite3' } });
        if (!res.ok) throw new Error('WebDAV PUT failed: ' + res.status);
    },

    async getRemoteInfo() {
        const res = await this._dav(this._filePath(), { method: 'PROPFIND', headers: { Depth: '0' } });
        if (!res.ok) return null; // file not created yet
        const xmlText = await res.text();
        const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
        const lastmodEl = doc.getElementsByTagNameNS('*', 'getlastmodified')[0];
        const sizeEl = doc.getElementsByTagNameNS('*', 'getcontentlength')[0];
        return {
            name: this.profile.fileName || 'aru_database.sqlite',
            ts: lastmodEl ? Date.parse(lastmodEl.textContent) || 0 : 0,
            size: sizeEl ? parseInt(sizeEl.textContent) || 0 : 0
        };
    }
};

// ---------- RemoteStorage facade ----------

export const RemoteStorage = {
    profile: null,      // decrypted profile (memory only, never persisted raw)
    adapter: null,
    locked: true,
    onRemoteNewer: null,       // callback(remoteInfo) — set by db.js
    onProfileChange: null,     // callback(profile) — persists rotated tokens
    onStatusChange: null,      // callback(status) — mirrors DB.onStatusChange

    _pushTimer: null,
    _pushChain: Promise.resolve(),
    _pollTimer: null,
    _keyCache: null, // {rawKey, salt} — memory only, lets us persist token rotations without re-asking the password

    // Persists the in-memory profile using the cached key material (token rotation path)
    async _persistUnlockedProfile() {
        if (!this._keyCache || !this.profile) return;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await crypto.subtle.importKey('raw', this._keyCache.rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
        const ct = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv }, key,
            new TextEncoder().encode(JSON.stringify(this.profile))
        );
        await localforage.setItem(this._profileKey(), {
            v: 1,
            salt: u8ToB64(this._keyCache.salt),
            iv: u8ToB64(iv),
            ct: u8ToB64(new Uint8Array(ct))
        });
    },

    _dbKey() {
        return localStorage.getItem('aru_active_db') || 'aru_db_v1';
    },

    _profileKey() {
        return `aru_remote_${this._dbKey()}`;
    },

    _metaKey() {
        return `aru_remote_meta_${this._dbKey()}`;
    },

    _meta() {
        try { return JSON.parse(localStorage.getItem(this._metaKey()) || '{}'); } catch (e) { return {}; }
    },

    _saveMeta(patch) {
        const meta = { ...this._meta(), ...patch };
        localStorage.setItem(this._metaKey(), JSON.stringify(meta));
    },

    _getSetting(key, fallback) {
        try {
            const s = window.DB?.getSettings?.();
            if (s && s[key] !== undefined && s[key] !== null && s[key] !== '') return s[key];
        } catch (e) { }
        return fallback;
    },

    adoptPending(profile) {
        this.profile = profile;
        this.locked = false;
        this.adapter = profile.type === 'gdrive' ? GoogleDriveAdapter : WebDAVAdapter;
        this.adapter.init(profile);
    },

    async isConfigured() {
        return !!(await localforage.getItem(this._profileKey()));
    },

    isUnlocked() {
        return !!this.profile && !this.locked;
    },

    type() {
        return this.profile?.type || null;
    },

    displayName() {
        if (!this.profile) return '';
        if (this.profile.type === 'gdrive') return 'Google Drive';
        return this.profile.url || 'WebDAV';
    },

    // Decrypts and activates the stored profile. Throws on wrong password.
    async unlock(password) {
        const blob = await localforage.getItem(this._profileKey());
        if (!blob) throw new Error(translations().remote_error_not_configured || 'Remote storage is not configured.');
        const profile = await decryptProfile(blob, password);
        const salt = b64ToU8(blob.salt);
        this._keyCache = { rawKey: await Auth._deriveKey(password, salt), salt };
        this.profile = profile;
        this.locked = false;
        this.adapter = profile.type === 'gdrive' ? GoogleDriveAdapter : WebDAVAdapter;
        this.adapter.init(profile);
        this.onProfileChange = async () => this._persistUnlockedProfile();
        this._notifyStatus('cloud-paused');
        return profile;
    },

    lock() {
        this.profile = null;
        this.adapter = null;
        this._keyCache = null;
        this.locked = true;
        this.stopPolling();
        this._notifyStatus('cloud-paused');
    },

    // Encrypts and persists a fresh profile, then activates it
    async saveProfile(profile, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const rawKey = await Auth._deriveKey(password, salt);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
        const ct = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv }, key,
            new TextEncoder().encode(JSON.stringify(profile))
        );
        await localforage.setItem(this._profileKey(), {
            v: 1,
            salt: u8ToB64(salt),
            iv: u8ToB64(iv),
            ct: u8ToB64(new Uint8Array(ct))
        });
        this._keyCache = { rawKey, salt };
        this.profile = profile;
        this.locked = false;
        this.adapter = profile.type === 'gdrive' ? GoogleDriveAdapter : WebDAVAdapter;
        this.adapter.init(profile);
        this.onProfileChange = async () => this._persistUnlockedProfile();
        return profile;
    },

    async disconnect() {
        this.stopPolling();
        await localforage.removeItem(this._profileKey());
        localStorage.removeItem(this._metaKey());
        this.profile = null;
        this.adapter = null;
        this._keyCache = null;
        this.locked = true;
    },

    // Entry point for app.init: completes the Google redirect round-trip if we just came back
    handleGoogleAuthCallback() {
        return GoogleDriveAdapter.handleAuthCallback();
    },

    // Public API used by db.js — debounced push of the exported DB bytes
    schedulePush(bytes) {
        if (!this.isUnlocked() || !this.adapter) return;
        if (this._getSetting('remote_sync_mode', 'auto') !== 'auto') return;
        if (this._pushTimer) clearTimeout(this._pushTimer);
        this._pushTimer = setTimeout(() => {
            this._pushTimer = null;
            this.pushNow(bytes).catch(e => {
                console.warn('RemoteStorage: push failed', e);
                this._notifyStatus('cloud-error');
            });
        }, 3000);
    },

    async pushNow(bytes) {
        if (!this.isUnlocked() || !this.adapter) return;
        this._pushChain = this._pushChain.then(async () => {
            this._notifyStatus('cloud-syncing');
            await this.adapter.save(bytes);
            this._saveMeta({ lastPushAt: Date.now() });
            this._notifyStatus('cloud-synced');
        });
        return this._pushChain;
    },

    async pullBytes() {
        if (!this.isUnlocked() || !this.adapter) throw new Error('Remote storage locked');
        this._notifyStatus('cloud-syncing');
        const bytes = await this.adapter.load();
        this._notifyStatus('cloud-synced');
        return bytes;
    },

    // Conflict comparison: returns 'equal' | 'local' | 'remote' | 'unknown'
    async compareWithRemote(localTS) {
        if (!this.isUnlocked() || !this.adapter) return 'unknown';
        const info = await this.adapter.getRemoteInfo();
        if (!info) return 'local'; // no remote file yet — push will create it
        const remoteTS = info.ts;
        if (!remoteTS || !localTS) return 'unknown';
        const lastPushAt = this._meta().lastPushAt || 0;
        // Remote mtime at/before our last push means no external change:
        // the remote holds exactly what we uploaded, so only local edits after the push matter
        if (remoteTS <= lastPushAt + 2000) {
            return localTS > lastPushAt + 2000 ? 'local' : 'equal';
        }
        if (Math.abs(localTS - remoteTS) <= 2000) return 'equal';
        return localTS > remoteTS ? 'local' : 'remote';
    },

    async getRemoteInfo() {
        if (!this.isUnlocked() || !this.adapter) return null;
        return await this.adapter.getRemoteInfo();
    },

    getLastSyncAt() {
        return this._meta().lastPushAt || 0;
    },

    async listRemoteFiles() {
        if (!this.isUnlocked() || !this.adapter) return [];
        return await this.adapter.listFiles();
    },

    async createRemoteFile(name) {
        if (!this.isUnlocked() || !this.adapter) throw new Error('Remote storage locked');
        const created = await this.adapter.createFile(name);
        if (created.id && !this.profile.fileId) {
            this.profile.fileId = created.id;
            if (this.onProfileChange) await this.onProfileChange(this.profile);
        }
        return created;
    },

    async useRemoteFile(fileId, name) {
        this.profile.fileId = fileId;
        this.profile.fileName = name;
        if (this.onProfileChange) await this.onProfileChange(this.profile);
    },

    // Periodic poll for external changes
    startPolling(intervalMin) {
        this.stopPolling();
        if (!intervalMin || intervalMin <= 0) return;
        this._pollTimer = setInterval(async () => {
            if (!this.isUnlocked() || this._pushTimer) return; // skip while a push is pending
            try {
                const info = await this.adapter.getRemoteInfo();
                const localTS = this._getSetting('last_save_ts', 0);
                const base = Math.max(parseInt(localTS) || 0, this._meta().lastPushAt || 0);
                if (info && info.ts && info.ts > base + 2000) {
                    if (this.onRemoteNewer) await this.onRemoteNewer(info);
                }
            } catch (e) {
                console.warn('RemoteStorage: poll failed', e);
            }
        }, intervalMin * 60000);
    },

    stopPolling() {
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    },

    // 3-way conflict dialog. Resolves to 'local' | 'remote' | 'copy'
    showConflictDialog(remoteInfo) {
        const t = translations();
        const container = document.getElementById('modal-container');
        if (!container) return Promise.resolve('local');

        return new Promise((resolve) => {
            const done = (choice) => {
                container.innerHTML = '';
                resolve(choice);
            };
            const dateStr = remoteInfo && remoteInfo.ts ? new Date(remoteInfo.ts).toLocaleString() : '—';
            container.innerHTML = `
            <div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in p-4">
                <div class="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-md p-6 shadow-2xl">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                            <i data-lucide="git-compare" class="w-5 h-5 text-amber-600"></i>
                        </div>
                        <div>
                            <h3 class="text-lg font-bold dark:text-white">${t.remote_conflict_title || 'Remote copy is newer'}</h3>
                            <p class="text-xs text-gray-400">${t.remote_conflict_hint || 'The database file on the server was changed from another device.'}</p>
                        </div>
                    </div>
                    <div class="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-xs text-gray-500 dark:text-gray-400 mb-5">
                        ${t.remote_conflict_remote_ts || 'Remote modified:'} <b>${dateStr}</b>
                    </div>
                    <div class="space-y-2">
                        <button id="rc-local" class="w-full py-3 px-4 rounded-xl bg-aru-500 hover:bg-aru-600 text-white font-bold text-sm transition">${t.remote_conflict_keep_local || 'Keep local (upload mine)'}</button>
                        <button id="rc-remote" class="w-full py-3 px-4 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold text-sm transition">${t.remote_conflict_take_remote || 'Take remote (download)'}</button>
                        <button id="rc-copy" class="w-full py-3 px-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-500 dark:text-gray-400 font-bold text-sm transition">${t.remote_conflict_save_copy || 'Download remote as a copy'}</button>
                    </div>
                </div>
            </div>`;
            if (window.lucide) lucide.createIcons();
            container.querySelector('#rc-local').onclick = () => done('local');
            container.querySelector('#rc-remote').onclick = () => done('remote');
            container.querySelector('#rc-copy').onclick = () => done('copy');
        });
    },

    _notifyStatus(status) {
        if (this.onStatusChange) this.onStatusChange(status);
    }
};

// Adapter registry for wizard/settings UI
export const RemoteAdapters = { gdrive: GoogleDriveAdapter, webdav: WebDAVAdapter };

window.RemoteStorage = RemoteStorage;
