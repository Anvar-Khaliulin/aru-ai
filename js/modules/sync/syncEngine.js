/*
---ARU-LAB.SPACE---ALMATY---2026---
Sync engine v2: merge-before-push over immutable encrypted snapshots.
The cloud head always wins as the base of truth; a device with local edits
merges them into the head instead of overwriting it. Polling is adaptive
(25s visible / 60s hidden) with an immediate pass on focus and reconnect.
---chat.aru-lab.space---PWA---
*/
import { SyncCore, u8ToB64, b64ToU8, randomBytes } from './syncCore.js';
import { SyncTransport } from './syncTransport.js';
import { mergeDatabases, countConflicts } from './syncMerge.js';
import { readDirtyState, clearDirtyIfUnchanged, markDirty } from './syncSchema.js';

const META_PREFIX = 'aru_sync_meta2_';
const BASE_PREFIX = 'aru_sync_base_';
const TRUST_PREFIX = 'aru_sync_trusted_';
const TRUST_FLAG_PREFIX = 'aru_sync_trust_';
const ENSURE_TIMEOUT = 90000;

function dbKey() {
    return window.DB?.dbPath || localStorage.getItem('aru_active_db') || 'default';
}

function readSettings() {
    try { return window.DB?.getSettings?.() || {}; } catch (e) { return {}; }
}

function toast(message, icon = 'cloud') {
    try { window.UI?.showToast?.(message, icon); } catch (e) { /* UI may not be ready */ }
}

export const SyncEngine = {
    _started: false,
    _syncing: false,
    _pending: false,
    _transport: null,
    _workspaceKey: null,
    _baseId: null,
    _pollTimer: null,
    _debounceTimer: null,
    _listenersBound: false,
    _lastMergeAt: 0,
    _lastConflictToastAt: 0,

    isEnabled() {
        return !!(this._started && this._workspaceKey && this._transport);
    },

    _setStatus(status) {
        try { window.app?.updateSyncStatus?.(status); } catch (e) { /* ignore */ }
        try { window.dispatchEvent(new CustomEvent('aru-sync-status', { detail: { status } })); } catch (e) { /* ignore */ }
    },

    _meta() {
        try {
            return JSON.parse(localStorage.getItem(META_PREFIX + dbKey()) || '{}');
        } catch (e) {
            return {};
        }
    },

    _saveMeta(patch) {
        const meta = { ...this._meta(), ...patch };
        try { localStorage.setItem(META_PREFIX + dbKey(), JSON.stringify(meta)); } catch (e) { /* ignore */ }
    },

    async _storeBase(bytes) {
        try { await localforage.setItem(BASE_PREFIX + dbKey(), bytes); } catch (e) { console.warn('Sync: base snapshot not stored', e); }
    },

    async _loadBase() {
        try {
            const value = await localforage.getItem(BASE_PREFIX + dbKey());
            return value ? new Uint8Array(value) : null;
        } catch (e) {
            return null;
        }
    },

    _makeTransport() {
        const adapter = window.RemoteStorage?.adapter;
        if (!adapter) throw new Error('Cloud storage is not unlocked');
        return new SyncTransport(adapter);
    },

    // ---------- Trusted device: one password entry per device ----------

    _trustEnabled() {
        try { return localStorage.getItem(TRUST_FLAG_PREFIX + dbKey()) !== '0'; } catch (e) { return true; }
    },

    setTrustDevice(enabled) {
        try { localStorage.setItem(TRUST_FLAG_PREFIX + dbKey(), enabled ? '1' : '0'); } catch (e) { /* ignore */ }
        if (enabled) this._saveTrusted();
        else this.forgetTrusted();
    },

    async _trustedRecord(create = true) {
        const key = TRUST_PREFIX + dbKey();
        let record = await localforage.getItem(key);
        if (!record && create) {
            const cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
            record = { v: 1, key: cryptoKey, createdAt: Date.now() };
            await localforage.setItem(key, record);
        }
        return record;
    },

    async _saveTrusted() {
        if (!this._workspaceKey || !window.RemoteStorage?.profile) return;
        if (!this._trustEnabled()) return;
        try {
            const record = await this._trustedRecord(true);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const payload = new TextEncoder().encode(JSON.stringify({
                profile: window.RemoteStorage.profile,
                workspaceKey: this._workspaceKey,
                baseId: this._baseId
            }));
            const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, record.key, payload);
            record.iv = u8ToB64(iv);
            record.ct = u8ToB64(new Uint8Array(ct));
            record.updatedAt = Date.now();
            record.dbKey = dbKey();
            await localforage.setItem(TRUST_PREFIX + dbKey(), record);
        } catch (e) {
            console.warn('Sync: trusted device key was not saved', e);
        }
    },

    async forgetTrusted() {
        try { await localforage.removeItem(TRUST_PREFIX + dbKey()); } catch (e) { /* ignore */ }
    },

    hasTrustedDevice() {
        return this._trustEnabled();
    },

    async tryTrustedUnlock() {
        if (window.RemoteStorage?.isUnlocked()) return true;
        if (!this._trustEnabled()) return false;
        try {
            const record = await localforage.getItem(TRUST_PREFIX + dbKey());
            if (!record?.key || !record.iv || !record.ct) return false;
            const plain = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: b64ToU8(record.iv) },
                record.key,
                b64ToU8(record.ct)
            );
            const data = JSON.parse(new TextDecoder().decode(plain));
            if (!data?.profile || !data?.workspaceKey) return false;
            window.RemoteStorage.adoptPending(data.profile);
            window.RemoteStorage.onProfileChange = async () => { await this._saveTrusted(); };
            this._workspaceKey = data.workspaceKey;
            this._baseId = data.baseId || data.profile.workspaceBaseId || null;
            return true;
        } catch (e) {
            console.warn('Sync: trusted unlock failed', e);
            return false;
        }
    },

    // ---------- Workspace lifecycle ----------

    // Enables sync v2 for the currently unlocked cloud profile.
    // Requires the DB password: it wraps the workspace key in the cloud keyfile.
    // force=true replaces an existing workspace (the local DB becomes the new head).
    async enableWorkspace({ password, force = false } = {}) {
        const RS = window.RemoteStorage;
        if (!RS?.isUnlocked()) throw new Error('Cloud storage is locked');
        if (!password) throw new Error('Database password is required to enable cloud merge');

        const transport = this._makeTransport();
        const head = await transport.readHead();
        let key = RS.profile?.workspaceKey || null;
        let baseId = RS.profile?.workspaceBaseId || null;
        let replacing = false;

        if (head && force) {
            key = u8ToB64(randomBytes(32));
            baseId = SyncCore.deviceId() + '-' + Date.now().toString(36);
            await transport.writeKeyfile(baseId, key, password);
            replacing = true;
        } else if (head) {
            const keyfile = await transport.readKeyfile(password).catch(e => {
                throw new Error('Не удалось расшифровать ключ синхронизации. Проверьте пароль базы: ' + e.message);
            });
            if (!keyfile) throw new Error('Ключ синхронизации не найден в облаке');
            key = keyfile.key;
            baseId = keyfile.baseId || head.baseId;
        } else if (!key) {
            key = u8ToB64(randomBytes(32));
            baseId = SyncCore.deviceId() + '-' + Date.now().toString(36);
            await transport.writeKeyfile(baseId, key, password);
        }

        RS.profile.workspaceKey = key;
        RS.profile.workspaceBaseId = baseId;
        if (RS._keyCache && RS._persistUnlockedProfile) {
            await RS._persistUnlockedProfile().catch(() => {});
        }

        // Mark the engine active before saving settings: the save triggers a
        // local-sync hook, and v2 must own it instead of the legacy push.
        this._transport = transport;
        this._workspaceKey = key;
        this._baseId = baseId;
        this._started = true;

        try {
            window.DB.saveSetting('sync_v2_enabled', '1', false);
            window.DB.saveSetting('sync_v2_base_id', baseId, false);
            await window.DB.save();
        } catch (e) { console.warn('Sync: failed to persist v2 settings', e); }

        this._saveTrusted();
        this._startPolling();
        this._setStatus('cloud-syncing');
        if (replacing) await this._replaceHead(transport, head);
        else if (head) await this.syncNow('enable');
        else await this._initialUpload();
        this._setStatus('cloud-synced');
        return true;
    },

    // Publishes the local DB as a brand-new lineage on top of an existing head,
    // used when the user explicitly agrees to replace the cloud workspace.
    async _replaceHead(transport, previousHead) {
        const DB = window.DB;
        const bytes = DB.db.export();
        const dirty = readDirtyState(DB.db);
        const rev = SyncCore.nextRev();
        const desc = await transport.writeSnapshot(bytes, {
            generation: (previousHead?.generation || 0) + 1,
            workspaceKey: this._workspaceKey,
            parents: [],
            lineage: [],
            baseId: this._baseId,
            deviceId: SyncCore.deviceId(),
            deviceName: SyncCore.deviceName(),
            rev
        });
        await transport.writeHead(desc);
        await this._storeBase(bytes);
        clearDirtyIfUnchanged(DB.db, dirty.seq);
        this._saveMeta({ lastHead: desc.head, lastSyncAt: Date.now(), lastRev: rev, baseId: this._baseId });
        transport.cleanupSnapshots(desc.head, 12).catch(() => {});
    },

    // True when the cloud already holds a sync-v2 workspace.
    async hasCloudWorkspace() {
        try {
            const transport = this._makeTransport();
            return !!(await transport.readHead());
        } catch (e) {
            return false;
        }
    },

    // Starts v2 when the workspace key is already known (trusted device) or the
    // password is available (fresh login on a joined workspace).
    async start({ password = null } = {}) {
        if (this._started) {
            this._startPolling();
            this.syncNow('start');
            return true;
        }
        const RS = window.RemoteStorage;
        if (!RS?.isUnlocked()) return false;

        const transport = this._makeTransport();
        let head = null;
        try { head = await transport.readHead(); } catch (e) { console.warn('Sync: head read failed', e); }

        const profile = RS.profile || {};
        let key = profile.workspaceKey || null;
        let baseId = profile.workspaceBaseId || null;

        if (!key && head) {
            if (!password) return false;
            const keyfile = await transport.readKeyfile(password);
            if (!keyfile) return false;
            key = keyfile.key;
            baseId = keyfile.baseId || head.baseId;
            profile.workspaceKey = key;
            profile.workspaceBaseId = baseId;
            if (RS._keyCache && RS._persistUnlockedProfile) await RS._persistUnlockedProfile().catch(() => {});
        }
        if (!key) return false;

        if (head && baseId && head.baseId && head.baseId !== baseId) {
            throw new Error('Облако относится к другой рабочей области синхронизации');
        }

        this._transport = transport;
        this._workspaceKey = key;
        this._baseId = baseId || head?.baseId || null;
        this._started = true;

        try {
            window.DB.saveSetting('sync_v2_enabled', '1', false);
            if (this._baseId) window.DB.saveSetting('sync_v2_base_id', this._baseId, false);
            await window.DB.save();
        } catch (e) { /* settings are best-effort */ }

        this._saveTrusted();
        this._startPolling();
        if (head) await this.syncNow('start');
        else await this._initialUpload();
        return true;
    },

    // Called after a session starts; unlocks a trusted device and resumes v2 silently.
    async autoStart() {
        if (this._started) return true;
        try {
            if (!(await window.RemoteStorage?.isConfigured?.())) return false;
            if (!window.RemoteStorage.isUnlocked()) {
                const unlocked = await this.tryTrustedUnlock();
                if (!unlocked) return false;
            }
            const profile = window.RemoteStorage.profile;
            if (!profile?.workspaceKey) return false;
            return await this.start({});
        } catch (e) {
            console.warn('SyncEngine.autoStart failed', e);
            return false;
        }
    },

    disable() {
        this._started = false;
        this._workspaceKey = null;
        this._baseId = null;
        this._transport = null;
        this._stopPolling();
        try { window.DB.saveSetting('sync_v2_enabled', '0', false); } catch (e) { /* ignore */ }
    },

    _initialUpload() {
        return this._runCycle('initial');
    },

    // ---------- Local save hook ----------

    onLocalSave() {
        if (!this.isEnabled()) return;
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            this.syncNow('local').catch(() => {});
        }, 4000);
    },

    // ---------- Polling ----------

    _startPolling() {
        this._stopPolling();
        const schedule = () => {
            const delay = document.hidden ? 60000 : 25000;
            this._pollTimer = setTimeout(async () => {
                try { await this.syncNow('poll'); } catch (e) { /* status already set */ }
                if (this._started) schedule();
            }, delay);
        };
        this._onFocus = () => { this.syncNow('focus').catch(() => {}); };
        this._onVisible = () => { if (!document.hidden) this.syncNow('visible').catch(() => {}); };
        this._onOnline = () => { this.syncNow('online').catch(() => {}); };
        window.addEventListener('focus', this._onFocus);
        window.addEventListener('online', this._onOnline);
        document.addEventListener('visibilitychange', this._onVisible);
        this._listenersBound = true;
        schedule();
    },

    _stopPolling() {
        if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
        if (this._debounceTimer) { clearTimeout(this._debounceTimer); this._debounceTimer = null; }
        if (this._listenersBound) {
            window.removeEventListener('focus', this._onFocus);
            window.removeEventListener('online', this._onOnline);
            document.removeEventListener('visibilitychange', this._onVisible);
            this._listenersBound = false;
        }
    },

    async _withLock(fn) {
        const name = 'aru-sync-' + dbKey();
        if (navigator.locks?.request) {
            return navigator.locks.request(name, { mode: 'exclusive' }, fn);
        }
        return fn();
    },

    // ---------- Main cycle ----------

    async syncNow(reason = 'manual') {
        if (!this.isEnabled()) return { skipped: true };
        if (this._syncing) {
            this._pending = true;
            return { queued: true };
        }
        const manual = reason === 'manual';
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), ENSURE_TIMEOUT));

        try {
            const result = await Promise.race([
                this._withLock(() => this._runCycle(reason)),
                timeout
            ]);
            if (manual) this._setStatus('cloud-synced');
            return result || { ok: true };
        } catch (e) {
            console.warn('SyncEngine.syncNow failed:', e);
            this._setStatus('cloud-error');
            if (manual) await window.UI?.alert?.('Не удалось синхронизировать: ' + e.message);
            return { error: e.message };
        }
    },

    async _runCycle(reason) {
        if (!this.isEnabled()) return { skipped: true };
        const DB = window.DB;
        const transport = this._transport;
        this._syncing = true;
        this._setStatus('cloud-syncing');

        try {
            for (let attempt = 0; attempt < 3; attempt++) {
                const head = await transport.readHead();
                const dirty = readDirtyState(DB.db);
                const meta = this._meta();

                if (!head) {
                    const bytes = DB.db.export();
                    const rev = SyncCore.nextRev();
                    const desc = await transport.writeSnapshot(bytes, {
                        generation: 1,
                        workspaceKey: this._workspaceKey,
                        parents: [],
                        lineage: [],
                        baseId: this._baseId,
                        deviceId: SyncCore.deviceId(),
                        deviceName: SyncCore.deviceName(),
                        rev
                    });
                    await transport.writeHead(desc);
                    await this._storeBase(bytes);
                    clearDirtyIfUnchanged(DB.db, dirty.seq);
                    this._saveMeta({ lastHead: desc.head, lastSyncAt: Date.now(), lastRev: rev, baseId: this._baseId });
                    this._setStatus('cloud-synced');
                    return { ok: true, created: true };
                }

                SyncCore.observeRemote(head.rev);

                if (head.head === meta.lastHead) {
                    if (!dirty.dirty) {
                        this._saveMeta({ lastSyncAt: Date.now() });
                        this._setStatus('cloud-synced');
                        return { ok: true, unchanged: true };
                    }
                    // The cloud head is the snapshot we already base on: append local changes.
                    const bytes = DB.db.export();
                    const rev = SyncCore.nextRev();
                    const desc = await transport.writeSnapshot(bytes, {
                        generation: (head.generation || 0) + 1,
                        workspaceKey: this._workspaceKey,
                        parents: [head.head],
                        lineage: [...(head.lineage || []), head.head],
                        baseId: this._baseId || head.baseId,
                        deviceId: SyncCore.deviceId(),
                        deviceName: SyncCore.deviceName(),
                        rev
                    });
                    await transport.writeHead(desc);
                    const confirmed = await transport.readHead();
                    if (!confirmed || confirmed.head !== desc.head) {
                        // Another device advanced the head while we uploaded; merge again.
                        continue;
                    }
                    await this._storeBase(bytes);
                    clearDirtyIfUnchanged(DB.db, dirty.seq);
                    this._saveMeta({ lastHead: desc.head, lastSyncAt: Date.now(), lastRev: rev });
                    transport.cleanupSnapshots(desc.head, 12).catch(() => {});
                    this._setStatus('cloud-synced');
                    return { ok: true, pushed: true };
                }

                // Remote advanced: download, merge, then push or adopt.
                const remoteBytes = await transport.readSnapshot(head.head, this._workspaceKey);
                if (!remoteBytes) throw new Error('Снимок из облака не найден: ' + head.head);

                // A base is only usable when the current head descends from it.
                // Otherwise (two devices created the workspace at the same time)
                // three-way diffing would read our own rows as "deleted remotely".
                const lineage = Array.isArray(head.lineage) ? head.lineage : [];
                const baseValid = !!(meta.lastHead && (meta.lastHead === head.head || lineage.includes(meta.lastHead)));
                const baseBytes = baseValid ? await this._loadBase() : null;

                const localBytes = DB.db.export();
                const seqAtExport = readDirtyState(DB.db).seq;
                let merged = mergeDatabases({
                    SQL: DB.SQL,
                    baseBytes,
                    localBytes,
                    remoteBytes
                });

                if (!dirty.dirty && baseValid) {
                    // No local edits: adopt the remote head without writing a new snapshot.
                    if (merged.stats.changed) {
                        await DB.applySyncDatabase(merged.db, merged.bytes);
                    } else {
                        try { merged.db.close(); } catch (e) { /* ignore */ }
                    }
                    await this._storeBase(remoteBytes);
                    this._saveMeta({ lastHead: head.head, lastSyncAt: Date.now(), lastRev: head.rev });
                    this._setStatus('cloud-synced');
                    this._notifyConflicts(merged.stats.conflicts);
                    return { ok: true, pulled: true };
                }

                const uploadedBytes = merged.bytes;
                const rev = SyncCore.nextRev();
                const desc = await transport.writeSnapshot(uploadedBytes, {
                    generation: (head.generation || 0) + 1,
                    workspaceKey: this._workspaceKey,
                    parents: [head.head],
                    lineage: [...(head.lineage || []), head.head],
                    baseId: this._baseId || head.baseId,
                    deviceId: SyncCore.deviceId(),
                    deviceName: SyncCore.deviceName(),
                    rev
                });
                await transport.writeHead(desc);
                const confirmed = await transport.readHead();
                if (!confirmed || confirmed.head !== desc.head) {
                    try { merged.db.close(); } catch (e) { /* ignore */ }
                    continue;
                }

                // Local writes may have landed while the snapshot was uploading.
                const liveSeq = readDirtyState(DB.db).seq;
                let lateWrites = liveSeq !== seqAtExport;
                if (lateWrites) {
                    try { merged.db.close(); } catch (e) { /* ignore */ }
                    const freshLocal = DB.db.export();
                    merged = mergeDatabases({
                        SQL: DB.SQL,
                        baseBytes,
                        localBytes: freshLocal,
                        remoteBytes
                    });
                }

                await DB.applySyncDatabase(merged.db, merged.bytes);
                if (lateWrites) markDirty(DB.db);
                else clearDirtyIfUnchanged(DB.db, liveSeq);

                await this._storeBase(uploadedBytes);
                this._saveMeta({ lastHead: desc.head, lastSyncAt: Date.now(), lastRev: rev });
                transport.cleanupSnapshots(desc.head, 12).catch(() => {});
                this._lastMergeAt = Date.now();
                this._setStatus('cloud-synced');
                this._notifyConflicts(merged.stats.conflicts);
                return { ok: true, merged: true, stats: merged.stats };
            }

            // Head kept moving under us; the next poll will retry with a fresh base.
            markDirty(DB.db);
            this._setStatus('cloud-synced');
            return { ok: true, retry: true };
        } finally {
            this._syncing = false;
            if (this._pending && this._started) {
                this._pending = false;
                setTimeout(() => this.syncNow('pending').catch(() => {}), 300);
            }
        }
    },

    _notifyConflicts(count) {
        if (!count) return;
        const now = Date.now();
        if (now - this._lastConflictToastAt < 60000) return;
        this._lastConflictToastAt = now;
        const total = this.getConflictCount();
        toast(`Изменения объединены. Разрешено конфликтов: ${count}${total ? ` (всего ${total})` : ''}`, 'git-merge');
    },

    // ---------- Status helpers for Settings ----------

    getConflictCount() {
        try { return window.DB?.db ? countConflicts(window.DB.db) : 0; } catch (e) { return 0; }
    },

    getLastSyncAt() {
        return this._meta().lastSyncAt || 0;
    },

    getBaseId() {
        return this._baseId || this._meta().baseId || readSettings().sync_v2_base_id || '';
    },

    // Re-wraps the workspace key after the master password changes, so other
    // devices and fresh logins can still unwrap it.
    async rewrapKeyfile(password) {
        if (!this._workspaceKey || !this._baseId) return false;
        const transport = this._transport || this._makeTransport();
        await transport.writeKeyfile(this._baseId, this._workspaceKey, password);
        return true;
    },

    // Entry point for the "open workspace on a new device" flow.
    async openWorkspaceFromCloud(password) {
        const RS = window.RemoteStorage;
        if (!RS?.isUnlocked()) throw new Error('Cloud storage is locked');
        const transport = this._makeTransport();
        const head = await transport.readHead();
        if (!head) throw new Error('В облаке нет синхронизированной базы');
        const keyfile = await transport.readKeyfile(password);
        if (!keyfile) throw new Error('Ключ синхронизации не найден');
        const bytes = await transport.readSnapshot(head.head, keyfile.key);
        if (!bytes) throw new Error('Не удалось скачать снимок базы');
        return { bytes, head, key: keyfile.key, baseId: keyfile.baseId || head.baseId };
    }
};

window.SyncEngine = SyncEngine;
