/*
---ARU-LAB.SPACE---ALMATY---2026---
Cloud transport for sync v2: encrypted immutable snapshots, a head pointer and a
password-wrapped workspace key. Provider-agnostic: Google Drive and WebDAV both
expose named files, so the engine never talks to a provider directly.
---chat.aru-lab.space---PWA---
*/
import { Auth } from '../auth.js';
import { SyncCore, u8ToB64, b64ToU8 } from './syncCore.js';

export const SYNC_FILES = {
    keyfile: 'aru_sync_keyfile.json',
    head: 'aru_sync_head.json',
    snapshotPrefix: 'aru_sync_snap_'
};

const HEAD_VERSION = 2;
const KEYFILE_VERSION = 2;

export class SyncTransport {
    constructor(adapter) {
        this.adapter = adapter;
    }

    async readBytes(name) {
        return this.adapter.readNamed(name);
    }

    async writeBytes(name, bytes, opts) {
        return this.adapter.writeNamed(name, bytes, opts);
    }

    async readJson(name) {
        const bytes = await this.readBytes(name);
        if (!bytes) return null;
        try {
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            console.warn('Sync transport: broken JSON', name, e);
            return null;
        }
    }

    async writeJson(name, value) {
        return this.writeBytes(name, new TextEncoder().encode(JSON.stringify(value)));
    }

    async readHead() {
        const head = await this.readJson(SYNC_FILES.head);
        if (!head || head.v !== HEAD_VERSION || !head.baseId || !head.head) return null;
        return head;
    }

    async writeHead(head) {
        return this.writeJson(SYNC_FILES.head, { ...head, v: HEAD_VERSION, updatedAt: new Date().toISOString() });
    }

    async readSnapshot(name, workspaceKey) {
        const raw = await this.readBytes(name);
        if (!raw) return null;
        return SyncCore.decryptBytes(workspaceKey, raw);
    }

    // Encrypts and uploads a snapshot. The returned descriptor goes into the head.
    async writeSnapshot(bytes, { generation, workspaceKey, parents = [], lineage = [], baseId, deviceId, deviceName, rev }) {
        const safeGen = String(generation).padStart(6, '0');
        const name = `${SYNC_FILES.snapshotPrefix}${safeGen}_${deviceId}_${SyncCore.revSuffix(rev)}.bin`;
        const encrypted = await SyncCore.encryptBytes(workspaceKey, bytes);
        // Snapshot names are unique (generation + device + rev), so the provider
        // can create the file directly instead of looking it up first.
        await this.writeBytes(name, encrypted, { fresh: true });
        return {
            v: HEAD_VERSION,
            baseId,
            head: name,
            parents,
            lineage: lineage.slice(-100),
            generation,
            rev,
            device: deviceId,
            deviceName,
            size: encrypted.length,
            plainSize: bytes.length,
            schema: 1
        };
    }

    // ---------- Workspace key wrapped by the master password ----------

    async writeKeyfile(baseId, workspaceKey, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const rawKey = await Auth._deriveKey(password, salt);
        const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            new TextEncoder().encode(JSON.stringify({ key: workspaceKey, baseId }))
        );
        const keyfile = {
            v: KEYFILE_VERSION,
            baseId,
            salt: u8ToB64(salt),
            iv: u8ToB64(iv),
            ct: u8ToB64(new Uint8Array(ct)),
            createdAt: new Date().toISOString()
        };
        await this.writeJson(SYNC_FILES.keyfile, keyfile);
        return keyfile;
    }

    // Returns { baseId, key } or null when no keyfile exists. Throws on a wrong password.
    async readKeyfile(password) {
        const keyfile = await this.readJson(SYNC_FILES.keyfile);
        if (!keyfile) return null;
        if (keyfile.v !== KEYFILE_VERSION) throw new Error('Unsupported sync keyfile version');
        const salt = b64ToU8(keyfile.salt);
        const iv = b64ToU8(keyfile.iv);
        const rawKey = await Auth._deriveKey(password, salt);
        const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b64ToU8(keyfile.ct));
        const data = JSON.parse(new TextDecoder().decode(plain));
        if (!data.key) throw new Error('Sync keyfile does not contain a workspace key');
        return { baseId: keyfile.baseId || data.baseId, key: data.key };
    }

    // ---------- Housekeeping ----------

    async cleanupSnapshots(activeHead, keep = 12) {
        try {
            const files = await this.adapter.listAllFiles();
            const snaps = files
                .filter(f => f.name.startsWith(SYNC_FILES.snapshotPrefix) && f.name !== activeHead)
                .sort((a, b) => (b.ts || 0) - (a.ts || 0));
            for (const file of snaps.slice(keep)) {
                await this.adapter.removeNamed(file.name).catch(e => console.warn('Sync cleanup failed', file.name, e));
            }
        } catch (e) {
            console.warn('Sync cleanup skipped', e);
        }
    }
}
