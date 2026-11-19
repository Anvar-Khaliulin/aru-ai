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

function httpError(prefix, status, body = '') {
    const err = new Error(`${prefix} ${status}: ${String(body || '').slice(0, 300)}`.trim());
    err.status = status;
    return err;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const ac = new AbortController();
    const externalSignal = options.signal || null;
    if (externalSignal?.aborted) {
        ac.abort(externalSignal.reason);
    }
    const onExternalAbort = () => ac.abort(externalSignal?.reason);
    if (externalSignal) externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => ac.abort(new Error('Request timeout')), timeoutMs);
    try {
        const fetchOpts = { ...options, signal: ac.signal };
        return await fetch(url, fetchOpts);
    } finally {
        clearTimeout(timer);
        if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
}

// ---------- Profile decryption (AES-GCM, key derived from the master password via PBKDF2) ----------

async function decryptProfile(blob, password) {
    const salt = b64ToU8(blob.salt);
    const iv = b64ToU8(blob.iv);
    const rawKey = await Auth._deriveKey(password, salt);
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b64ToU8(blob.ct));
    return {
        profile: JSON.parse(new TextDecoder().decode(plain)),
        rawKey,
        salt
    };
}

// ---------- Google Drive adapter (Google Identity Services + Drive API v3, scope drive.file) ----------

const GoogleDriveAdapter = {
    type: 'gdrive',
    profile: null,

    _apiBase: 'https://www.googleapis.com/drive/v3',
    _uploadBase: 'https://www.googleapis.com/upload/drive/v3',
    // name -> file id cache: every sync file has a stable name, so resolving ids
    // from a full folder listing on each read/write wasted Drive API quota and
    // made three-device sync hit rate limits.
    _nameIds: new Map(),
    _folderCheckedAt: 0,

    init(profile) {
        this.profile = profile;
        this._nameIds = new Map();
        this._folderCheckedAt = 0;
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

    async _ensureAccessToken({ signal = null, forceRefresh = false } = {}) {
        if (signal?.aborted) {
            throw signal.reason || new DOMException('Aborted', 'AbortError');
        }
        const p = this.profile;
        const now = Date.now();
        if (!forceRefresh && p.accessToken && p.accessTokenExp && p.accessTokenExp - 60000 > now) return;

        // Try silent refresh in the background
        if (p.clientId) {
            try {
                await this._ensureGisLoaded();
                if (signal?.aborted) {
                    throw signal.reason || new DOMException('Aborted', 'AbortError');
                }
                const refreshed = await new Promise((resolve, reject) => {
                    let settled = false;
                    const finish = (fn, val) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timer);
                        if (signal) signal.removeEventListener('abort', onAbort);
                        fn(val);
                    };
                    const onAbort = () => finish(reject, signal.reason || new DOMException('Aborted', 'AbortError'));
                    const timer = setTimeout(() => finish(reject, new Error('Google silent token refresh timeout')), 20000);
                    if (signal) signal.addEventListener('abort', onAbort, { once: true });

                    const client = window.google.accounts.oauth2.initTokenClient({
                        client_id: p.clientId,
                        scope: 'https://www.googleapis.com/auth/drive.file',
                        prompt: '',
                        callback: (resp) => {
                            if (resp.error || !resp.access_token) {
                                finish(reject, new Error(resp.error_description || resp.error || 'Silent refresh failed'));
                                return;
                            }
                            finish(resolve, {
                                accessToken: resp.access_token,
                                expiresIn: parseInt(resp.expires_in) || 3599
                            });
                        },
                        error_callback: (err) => finish(reject, new Error(err?.message || 'Silent refresh error'))
                    });
                    client.requestAccessToken({ prompt: '' });
                });

                p.accessToken = refreshed.accessToken;
                p.accessTokenExp = Date.now() + refreshed.expiresIn * 1000;
                if (RemoteStorage.onProfileChange) await RemoteStorage.onProfileChange(this.profile);
                return;
            } catch (silentErr) {
                if (silentErr?.name === 'AbortError' || signal?.aborted) throw silentErr;
                console.warn('Google silent token refresh unavailable:', silentErr);
            }
        }

        throw new Error(translations().remote_error_reauth || 'Срок действия сессии Google Drive истёк. Пожалуйста, повторно авторизуйтесь в Настройках → Хранилище.');
    },

    async _authedFetch(url, options = {}) {
        const signal = options.signal || null;
        const timeoutMs = options.timeoutMs || 30000;
        const baseHeaders = { ...(options.headers || {}) };
        await this._ensureAccessToken({ signal });

        const doFetch = () => {
            const reqOpts = { cache: 'no-store', ...options };
            delete reqOpts.timeoutMs;
            reqOpts.headers = {
                ...baseHeaders,
                'Authorization': `Bearer ${this.profile.accessToken}`
            };
            return fetchWithTimeout(url, reqOpts, timeoutMs);
        };

        let res = await doFetch();
        if (res.status === 401) {
            this.profile.accessToken = null;
            this.profile.accessTokenExp = 0;
            await this._ensureAccessToken({ signal, forceRefresh: true });
            res = await doFetch();
        }
        return res;
    },

    async _api(path, options = {}) {
        const res = await this._authedFetch(this._apiBase + path, options);
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw httpError('Google Drive API error', res.status, text);
        }
        return res;
    },

    // Creates (or reuses) the app-owned "Aru AI" folder
    async ensureFolder(signal = null) {
        if (this.profile.folderId && Date.now() - this._folderCheckedAt < 10 * 60 * 1000) {
            return this.profile.folderId;
        }
        const prevFolderId = this.profile.folderId;
        if (this.profile.folderId) {
            try {
                const res = await this._api(`/files/${this.profile.folderId}?fields=id,trashed`, { signal });
                const meta = await res.json().catch(() => ({}));
                if (!meta.trashed) {
                    this._folderCheckedAt = Date.now();
                    return this.profile.folderId;
                }
            } catch (e) {
                if (e?.status !== 404) throw e;
            }
        }
        const q = encodeURIComponent("name='Aru AI' and mimeType='application/vnd.google-apps.folder' and trashed=false");
        const res = await this._api(`/files?q=${q}&fields=files(id,name)&orderBy=createdTime`, { signal });
        const json = await res.json();
        if (json.files && json.files.length) {
            this.profile.folderId = json.files[0].id;
        } else {
            const createRes = await this._api('/files', {
                method: 'POST',
                signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Aru AI', mimeType: 'application/vnd.google-apps.folder' })
            });
            const created = await createRes.json();
            this.profile.folderId = created.id;
        }
        this._folderCheckedAt = Date.now();
        if (this.profile.folderId !== prevFolderId && RemoteStorage.onProfileChange) {
            await RemoteStorage.onProfileChange(this.profile);
        }
        return this.profile.folderId;
    },

    async listFiles(opts = {}) {
        const folderId = await this.ensureFolder(opts.signal || null);
        const q = encodeURIComponent(`'${folderId}' in parents and name contains '.sqlite' and trashed=false`);
        const res = await this._api(`/files?q=${q}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc`, { signal: opts.signal });
        const json = await res.json();
        return (json.files || []).map(f => ({
            id: f.id,
            name: f.name,
            ts: Date.parse(f.modifiedTime) || 0,
            size: parseInt(f.size) || 0
        }));
    },

    async createFile(name, opts = {}) {
        const signal = opts.signal || null;
        const folderId = await this.ensureFolder(signal);
        const metadata = { name, parents: [folderId] };
        const boundary = 'aru_boundary_' + Date.now();
        const body = new Blob([
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
            `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
            new Uint8Array(0),
            `\r\n--${boundary}--`
        ]);
        const res = await this._authedFetch(`${this._uploadBase}/files?uploadType=multipart&fields=id,name`, {
            method: 'POST',
            signal,
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw httpError('Google Drive create file failed', res.status, text);
        }
        const json = await res.json();
        return { id: json.id, name: json.name };
    },

    async load(opts = {}) {
        const res = await this._api(`/files/${this.profile.fileId}?alt=media`, { signal: opts.signal });
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
    },

    async save(bytes, opts = {}) {
        const res = await this._authedFetch(`${this._uploadBase}/files/${this.profile.fileId}?uploadType=media`, {
            method: 'PATCH',
            signal: opts.signal,
            headers: { 'Content-Type': 'application/octet-stream' },
            body: bytes
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw httpError('Google Drive upload failed', res.status, text);
        }
    },

    async getRemoteInfo(opts = {}) {
        if (!this.profile.fileId) return null;
        let res;
        try {
            res = await this._api(`/files/${this.profile.fileId}?fields=id,name,modifiedTime,size`, { signal: opts.signal });
        } catch (e) {
            if (e?.status === 404) return null; // file deleted or moved away
            throw e;
        }
        const json = await res.json();
        return {
            name: json.name,
            ts: Date.parse(json.modifiedTime) || 0,
            size: parseInt(json.size) || 0
        };
    },

    // ----- Named files used by the v2 sync workspace -----

    async listAllFiles(opts = {}) {
        const folderId = await this.ensureFolder(opts.signal || null);
        const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
        const files = [];
        let pageToken = '';
        do {
            const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
            const res = await this._api(`/files?q=${q}&fields=nextPageToken,files(id,name,modifiedTime,size)&pageSize=1000${page}`, { signal: opts.signal });
            const json = await res.json();
            for (const f of json.files || []) {
                files.push({
                    id: f.id,
                    name: f.name,
                    ts: Date.parse(f.modifiedTime) || 0,
                    size: parseInt(f.size) || 0
                });
            }
            pageToken = json.nextPageToken || '';
        } while (pageToken);
        files.sort((a, b) => (b.ts - a.ts) || String(a.id).localeCompare(String(b.id)));
        const nameIds = new Map();
        for (const f of files) {
            if (!nameIds.has(f.name)) nameIds.set(f.name, f.id);
        }
        this._nameIds = nameIds;
        return files;
    },

    async findNamed(name, opts = {}) {
        const cached = this._nameIds.get(name);
        if (cached) return { id: cached, name };
        const files = await this.listAllFiles(opts);
        return files.find(f => f.name === name) || null;
    },

    async readNamed(name, opts = {}) {
        for (let attempt = 0; attempt < 2; attempt++) {
            const file = await this.findNamed(name, opts);
            if (!file) return null;
            const res = await this._authedFetch(`${this._apiBase}/files/${file.id}?alt=media`, {
                cache: 'no-store',
                signal: opts.signal
            });
            if (res.status === 404) {
                this._nameIds.delete(name);
                continue;
            }
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw httpError('Google Drive read failed', res.status, text);
            }
            return new Uint8Array(await res.arrayBuffer());
        }
        return null;
    },

    async writeNamed(name, bytes, opts = {}) {
        const signal = opts.signal || null;
        const folderId = await this.ensureFolder(signal);
        const existing = opts.fresh ? null : await this.findNamed(name, { signal });
        if (existing) {
            const res = await this._authedFetch(`${this._uploadBase}/files/${existing.id}?uploadType=media`, {
                method: 'PATCH',
                signal,
                headers: { 'Content-Type': 'application/octet-stream' },
                body: bytes
            });
            if (res.status === 404) {
                this._nameIds.delete(name);
            } else if (res.ok) {
                return { id: existing.id, name };
            } else {
                const text = await res.text().catch(() => '');
                throw httpError('Google Drive update failed', res.status, text);
            }
        }
        const boundary = 'aru_boundary_' + Date.now();
        const metadata = { name, parents: [folderId] };
        const body = new Blob([
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
            `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
            bytes,
            `\r\n--${boundary}--`
        ]);
        const res = await this._authedFetch(`${this._uploadBase}/files?uploadType=multipart&fields=id,name`, {
            method: 'POST',
            signal,
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw httpError('Google Drive create failed', res.status, text);
        }
        const json = await res.json();
        let chosenId = json.id;
        let chosenName = json.name || name;

        // Deduplicate singleton control files if two devices raced to create them
        if (name === 'aru_sync_head.json' || name === 'aru_sync_keyfile.json') {
            try {
                const dupQ = encodeURIComponent(`'${folderId}' in parents and name='${name}' and trashed=false`);
                const dupRes = await this._api(`/files?q=${dupQ}&fields=files(id,name)`, { signal });
                const dupJson = await dupRes.json();
                const dupes = (dupJson.files || []).filter(f => f.id);
                if (dupes.length > 1) {
                    dupes.sort((a, b) => String(a.id).localeCompare(String(b.id)));
                    const canonical = dupes[0];
                    if (canonical.id !== json.id) {
                        const patchRes = await this._authedFetch(`${this._uploadBase}/files/${canonical.id}?uploadType=media`, {
                            method: 'PATCH',
                            signal,
                            headers: { 'Content-Type': 'application/octet-stream' },
                            body: bytes
                        });
                        if (patchRes.ok) {
                            await this.removeFile(json.id, { signal }).catch(e => { if (e?.status !== 404) console.warn(e); });
                            chosenId = canonical.id;
                            chosenName = canonical.name || name;
                        }
                    } else {
                        for (const extra of dupes.slice(1)) {
                            await this.removeFile(extra.id, { signal }).catch(e => { if (e?.status !== 404) console.warn(e); });
                        }
                    }
                }
            } catch (e) {
                if (e?.name === 'AbortError' || signal?.aborted) throw e;
            }
        }

        this._nameIds.set(chosenName, chosenId);
        return { id: chosenId, name: chosenName };
    },

    async removeNamed(name, opts = {}) {
        const file = await this.findNamed(name, opts);
        if (!file) return;
        await this.removeFile(file.id, opts);
        this._nameIds.delete(name);
    },

    async removeFile(fileId, opts = {}) {
        try {
            await this._api(`/files/${fileId}`, { method: 'DELETE', signal: opts.signal });
        } catch (e) {
            if (e?.status === 404) return;
            throw e;
        }
    }
};

// ---------- WebDAV adapter (GET/PUT/PROPFIND, Basic Auth over HTTPS, direct or custom proxy) ----------

const WebDAVAdapter = {
    type: 'webdav',
    profile: null,
    _collectionReady: false,

    init(profile) {
        this.profile = profile;
        this._collectionReady = false;
    },

    _baseUrl() {
        return (this.profile.url || '').replace(/\/+$/, '');
    },

    _encodePath(pathname) {
        return String(pathname || '')
            .split('/')
            .map(seg => (seg ? encodeURIComponent(seg) : ''))
            .join('/');
    },

    async _dav(pathname, options = {}) {
        const settings = window.aruState?.userSettings || {};
        const url = this._baseUrl() + this._encodePath(pathname);
        const headers = { ...(options.headers || {}) };
        if (!options.skipAuth && this.profile.username) {
            const creds = u8ToB64(new TextEncoder().encode(`${this.profile.username}:${this.profile.password || ''}`));
            headers['Authorization'] = `Basic ${creds}`;
        }

        // Support custom proxy configured on the profile itself or in Network settings
        const customProxy = this.profile.proxyUrl || (settings.proxy_strategy === 'custom' ? settings.proxy_custom_url : null);
        // Never let the browser HTTP cache serve a stale head or snapshot.
        const timeoutMs = options.timeoutMs || 30000;
        const fetchOpts = { cache: 'no-store', ...options, headers };
        delete fetchOpts.timeoutMs;
        delete fetchOpts.skipAuth;
        let res;
        if (customProxy) {
            const proxyUrl = customProxy.includes('%URL%')
                ? customProxy.replace('%URL%', encodeURIComponent(url))
                : customProxy + encodeURIComponent(url);
            res = await fetchWithTimeout(proxyUrl, fetchOpts, timeoutMs);
        } else {
            try {
                res = await fetchWithTimeout(url, fetchOpts, timeoutMs);
            } catch (e) {
                if (e?.name === 'AbortError' || options.signal?.aborted) throw e;
                const t = translations();
                const isCors = e.name === 'TypeError' || /fetch/i.test(e.message);
                if (isCors) {
                    throw new Error(t.remote_error_webdav_cors || 'WebDAV запрос заблокирован браузером (CORS). Для работы WebDAV в браузере требуется: 1) Включить CORS на сервере WebDAV (методы PROPFIND, MKCOL, заголовки Authorization, Depth), либо 2) Использовать обратный прокси на своём сервере (например /webdav), либо 3) Указать персональный CORS-прокси в настройках Сети.');
                }
                throw e;
            }
        }

        if (options.method === 'PROPFIND') return res; // callers inspect 404 vs other failures explicitly
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw httpError('WebDAV error', res.status, text);
        }
        return res;
    },

    _filePath() {
        const dir = (this.profile.davPath || '').replace(/^\/+|\/+$/g, '');
        return (dir ? '/' + dir : '') + '/' + (this.profile.fileName || 'aru_database.sqlite');
    },

    // Ensures the collection path exists, creating segments with MKCOL as needed
    async ensureCollection(opts = {}) {
        if (this._collectionReady) return;
        const signal = opts.signal || null;
        const segments = (this.profile.davPath || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        let current = '';
        for (const seg of segments) {
            current += '/' + seg;
            const probe = await this._dav(current + '/', { method: 'PROPFIND', headers: { Depth: '0' }, skipAuth: false, signal });
            if (probe.ok) continue;
            if (probe.status !== 404 && probe.status !== 409) {
                const text = await probe.text().catch(() => '');
                throw httpError('WebDAV PROPFIND error', probe.status, text);
            }
            try {
                await this._dav(current, { method: 'MKCOL', signal });
            } catch (err) {
                if (err?.status !== 405 && err?.status !== 301) throw err; // 405/301 = already exists
            }
        }
        this._collectionReady = true;
    },

    async listFiles(opts = {}) {
        const dir = (this.profile.davPath || '').replace(/^\/+|\/+$/g, '');
        const path = dir ? '/' + dir + '/' : '/';
        const res = await this._dav(path, { method: 'PROPFIND', headers: { Depth: '1' }, signal: opts.signal });
        if (res.status === 404) return [];
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw httpError('WebDAV PROPFIND error', res.status, text);
        }
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
            let href = hrefEl.textContent || '';
            try { href = decodeURIComponent(href); } catch (_) {}
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

    async createFile(name, opts = {}) {
        await this.ensureCollection(opts);
        this.profile.fileName = name;
        await this._dav(this._filePath(), { method: 'PUT', body: new Uint8Array(0), headers: { 'Content-Type': 'application/x-sqlite3' }, signal: opts.signal });
        return { id: this._filePath(), name };
    },

    async load(opts = {}) {
        const res = await this._dav(this._filePath(), { method: 'GET', signal: opts.signal });
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
    },

    async save(bytes, opts = {}) {
        try {
            await this._dav(this._filePath(), { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/x-sqlite3' }, signal: opts.signal });
        } catch (e) {
            if (e?.status === 404 || e?.status === 409) this._collectionReady = false;
            throw e;
        }
    },

    async getRemoteInfo(opts = {}) {
        const res = await this._dav(this._filePath(), { method: 'PROPFIND', headers: { Depth: '0' }, signal: opts.signal });
        if (res.status === 404) return null; // file not created yet
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw httpError('WebDAV PROPFIND error', res.status, text);
        }
        const xmlText = await res.text();
        const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
        const lastmodEl = doc.getElementsByTagNameNS('*', 'getlastmodified')[0];
        const sizeEl = doc.getElementsByTagNameNS('*', 'getcontentlength')[0];
        return {
            name: this.profile.fileName || 'aru_database.sqlite',
            ts: lastmodEl ? Date.parse(lastmodEl.textContent) || 0 : 0,
            size: sizeEl ? parseInt(sizeEl.textContent) || 0 : 0
        };
    },

    // ----- Named files used by the v2 sync workspace -----

    _namedPath(name) {
        const dir = (this.profile.davPath || '').replace(/^\/+|\/+$/g, '');
        return (dir ? '/' + dir : '') + '/' + name;
    },

    async listAllFiles(opts = {}) {
        const dir = (this.profile.davPath || '').replace(/^\/+|\/+$/g, '');
        const path = dir ? '/' + dir + '/' : '/';
        const res = await this._dav(path, { method: 'PROPFIND', headers: { Depth: '1' }, signal: opts.signal });
        if (res.status === 404) return [];
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw httpError('WebDAV PROPFIND error', res.status, text);
        }
        const xmlText = await res.text();
        const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
        if (doc.querySelector('parsererror')) {
            throw new Error('WebDAV list: ' + (translations().remote_error_webdav_xml || 'неверный XML-ответ от сервера'));
        }
        const responses = Array.from(doc.getElementsByTagNameNS('*', 'response'));
        const files = [];
        for (const resp of responses) {
            const hrefEl = resp.getElementsByTagNameNS('*', 'href')[0];
            const isCollection = resp.getElementsByTagNameNS('*', 'collection').length > 0;
            if (!hrefEl || isCollection) continue;
            let href = hrefEl.textContent || '';
            try { href = decodeURIComponent(href); } catch (_) {}
            const name = href.split('/').filter(Boolean).pop();
            if (!name) continue;
            const lastmodEl = resp.getElementsByTagNameNS('*', 'getlastmodified')[0];
            const sizeEl = resp.getElementsByTagNameNS('*', 'getcontentlength')[0];
            files.push({
                id: name,
                name,
                ts: lastmodEl ? Date.parse(lastmodEl.textContent) || 0 : 0,
                size: sizeEl ? parseInt(sizeEl.textContent) || 0 : 0
            });
        }
        files.sort((a, b) => b.ts - a.ts);
        return files;
    },

    async findNamed(name, opts = {}) {
        const files = await this.listAllFiles(opts);
        return files.find(f => f.name === name) || null;
    },

    async readNamed(name, opts = {}) {
        try {
            const res = await this._dav(this._namedPath(name), { method: 'GET', signal: opts.signal });
            return new Uint8Array(await res.arrayBuffer());
        } catch (e) {
            if (e?.status === 404) return null;
            throw e;
        }
    },

    async writeNamed(name, bytes, opts = {}) {
        await this.ensureCollection(opts);
        try {
            await this._dav(this._namedPath(name), {
                method: 'PUT',
                body: bytes,
                headers: { 'Content-Type': 'application/octet-stream' },
                signal: opts.signal
            });
        } catch (e) {
            if (e?.status === 404 || e?.status === 409) this._collectionReady = false;
            throw e;
        }
        return { id: name, name };
    },

    async removeNamed(name, opts = {}) {
        try {
            await this._dav(this._namedPath(name), { method: 'DELETE', signal: opts.signal });
        } catch (e) {
            if (e?.status !== 404) throw e;
        }
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
        const { profile, rawKey, salt } = await decryptProfile(blob, password);
        this._keyCache = { rawKey, salt };
        this.profile = profile;
        this.locked = false;
        this.adapter = profile.type === 'gdrive' ? GoogleDriveAdapter : WebDAVAdapter;
        this.adapter.init(profile);
        this.onProfileChange = async () => {
            await this._persistUnlockedProfile();
            await window.SyncEngine?._saveTrusted?.();
        };
        this._notifyStatus('cloud-paused');
        return profile;
    },

    lock() {
        if (this._pushTimer) { clearTimeout(this._pushTimer); this._pushTimer = null; }
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
        this.onProfileChange = async () => {
            await this._persistUnlockedProfile();
            await window.SyncEngine?._saveTrusted?.();
        };
        return profile;
    },

    async disconnect() {
        if (this._pushTimer) { clearTimeout(this._pushTimer); this._pushTimer = null; }
        this.stopPolling();
        await localforage.removeItem(this._profileKey());
        localStorage.removeItem(this._metaKey());
        this.profile = null;
        this.adapter = null;
        this._keyCache = null;
        this.locked = true;
    },

    // Public API used by db.js — debounced push of the exported DB bytes
    schedulePush(bytes) {
        if (window.SyncEngine?.isEnabled?.()) return; // v2 owns snapshots
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
        if (window.SyncEngine?.isEnabled?.()) return; // v2 owns snapshots
        if (!this.isUnlocked() || !this.adapter) return;
        // Recover from a previous failed push: without this the stored chain
        // stays rejected and every later sync attempt is skipped forever.
        this._pushChain = this._pushChain.catch((e) => {
            console.warn('RemoteStorage: previous push failed, retrying', e);
        }).then(async () => {
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
        if (created.id) this.profile.fileId = created.id;
        this.profile.fileName = created.name || name;
        if (this.onProfileChange) await this.onProfileChange(this.profile);
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
        if (window.SyncEngine?.isEnabled?.()) return; // v2 has its own adaptive polling
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
        if (typeof document === 'undefined' || !document.body) return Promise.resolve('local');
        const t = translations();
        let host = document.getElementById('aru-dialog-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'aru-dialog-host';
            document.body.appendChild(host);
        }
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

        return new Promise((resolve) => {
            let settled = false;
            const root = document.createElement('div');
            root.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in p-4';
            const dateStr = remoteInfo && remoteInfo.ts ? new Date(remoteInfo.ts).toLocaleString() : '—';
            root.innerHTML = `
                <div class="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-md p-6 shadow-2xl" role="dialog" aria-modal="true">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                            <i data-lucide="git-compare" class="w-5 h-5 text-amber-600"></i>
                        </div>
                        <div>
                            <h3 class="text-lg font-bold dark:text-white">${esc(t.remote_conflict_title || 'Remote copy is newer')}</h3>
                            <p class="text-xs text-gray-400">${esc(t.remote_conflict_hint || 'The database file on the server was changed from another device.')}</p>
                        </div>
                    </div>
                    <div class="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-xs text-gray-500 dark:text-gray-400 mb-5">
                        ${esc(t.remote_conflict_remote_ts || 'Remote modified:')} <b>${esc(dateStr)}</b>
                    </div>
                    <div class="space-y-2">
                        <button id="rc-local" class="w-full py-3 px-4 rounded-xl bg-aru-500 hover:bg-aru-600 text-white font-bold text-sm transition">${esc(t.remote_conflict_keep_local || 'Keep local (upload mine)')}</button>
                        <button id="rc-remote" class="w-full py-3 px-4 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold text-sm transition">${esc(t.remote_conflict_take_remote || 'Take remote (download)')}</button>
                        <button id="rc-copy" class="w-full py-3 px-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-500 dark:text-gray-400 font-bold text-sm transition">${esc(t.remote_conflict_save_copy || 'Download remote as a copy')}</button>
                    </div>
                </div>`;
            const onKey = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    done('local');
                }
            };
            const done = (choice) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKey, true);
                if (root.parentNode) root.parentNode.removeChild(root);
                resolve(choice);
            };
            host.appendChild(root);
            if (window.lucide) lucide.createIcons();
            document.addEventListener('keydown', onKey, true);
            const btnLocal = root.querySelector('#rc-local');
            const btnRemote = root.querySelector('#rc-remote');
            const btnCopy = root.querySelector('#rc-copy');
            if (btnLocal) btnLocal.onclick = () => done('local');
            if (btnRemote) btnRemote.onclick = () => done('remote');
            if (btnCopy) btnCopy.onclick = () => done('copy');
        });
    },

    _notifyStatus(status) {
        if (this.onStatusChange) this.onStatusChange(status);
    }
};

// Adapter registry for wizard/settings UI
export const RemoteAdapters = { gdrive: GoogleDriveAdapter, webdav: WebDAVAdapter };

window.RemoteStorage = RemoteStorage;
