/*
---ARU-LAB.SPACE---ALMATY---2026---
Sync core: stable device identity, hybrid logical clocks, byte and AES-GCM helpers.
No DOM and no DB access here so the merge engine can run in tests as well.
---chat.aru-lab.space---PWA---
*/

const DEVICE_ID_KEY = 'aru_sync_device_id';
const DEVICE_NAME_KEY = 'aru_sync_device_name';
const CLOCK_KEY = 'aru_sync_clock';

function randomHex(bytes = 16) {
    const buf = crypto.getRandomValues(new Uint8Array(bytes));
    return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function u8ToB64(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
}

export function b64ToU8(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export function randomBytes(n) {
    return crypto.getRandomValues(new Uint8Array(n));
}

export function randomId(bytes = 16) {
    return randomHex(bytes);
}

export function toHex(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
}

export function fromHex(hex) {
    const clean = String(hex || '').replace(/[^0-9a-f]/gi, '');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
}

export async function sha256Hex(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return toHex(digest);
}

// ---------- Hybrid logical clock ----------
// Format is fixed-width so plain string comparison orders revisions:
// 0000017653210000-000001-a1b2c3d4e5f6
// physical (ms, 13 digits) - counter (6 digits) - device id

function encodeHlc(physical, counter, device) {
    return `${String(physical).padStart(13, '0')}-${String(counter).padStart(6, '0')}-${device}`;
}

export function parseHlc(rev) {
    const m = /^(\d{13})-(\d{6})-([0-9a-z_-]+)$/.exec(String(rev || ''));
    if (!m) return null;
    return { physical: parseInt(m[1], 10), counter: parseInt(m[2], 10), device: m[3] };
}

let lastPhysical = 0;
let lastCounter = 0;

function loadClock() {
    try {
        const raw = JSON.parse(localStorage.getItem(CLOCK_KEY) || '{}');
        if (Number.isFinite(raw.physical)) lastPhysical = raw.physical;
        if (Number.isFinite(raw.counter)) lastCounter = raw.counter;
    } catch (e) { /* ignore a broken local clock record */ }
}

function persistClock() {
    try {
        localStorage.setItem(CLOCK_KEY, JSON.stringify({ physical: lastPhysical, counter: lastCounter }));
    } catch (e) { /* storage can be unavailable in private mode */ }
}

let _loaded = false;
function ensureClock() {
    if (_loaded) return;
    _loaded = true;
    loadClock();
}

export const SyncCore = {
    deviceId() {
        try {
            let id = localStorage.getItem(DEVICE_ID_KEY);
            if (!id) {
                id = randomHex(8);
                localStorage.setItem(DEVICE_ID_KEY, id);
            }
            return id;
        } catch (e) {
            if (!this._memoryDevice) this._memoryDevice = randomHex(8);
            return this._memoryDevice;
        }
    },

    deviceName() {
        try {
            let name = localStorage.getItem(DEVICE_NAME_KEY);
            if (!name) {
                const ua = navigator.userAgent || '';
                const platform = navigator.userAgentData?.platform || navigator.platform || '';
                let guess = platform || 'Browser';
                if (/iPhone|iPad|iPod/i.test(ua)) guess = 'iOS';
                else if (/Mac/i.test(ua)) guess = 'macOS';
                else if (/Win/i.test(ua)) guess = 'Windows';
                else if (/Android/i.test(ua)) guess = 'Android';
                else if (/Linux/i.test(ua)) guess = 'Linux';
                name = `${guess} · ${randomHex(2)}`;
                localStorage.setItem(DEVICE_NAME_KEY, name);
            }
            return name;
        } catch (e) {
            return 'Browser';
        }
    },

    // Advances the local clock and returns a revision to stamp the next write.
    nextRev() {
        ensureClock();
        const now = Date.now();
        if (now > lastPhysical) {
            lastPhysical = now;
            lastCounter = 0;
        } else {
            lastCounter += 1;
        }
        // Keep the counter bounded if the system clock jumps backwards for a long time.
        if (lastCounter > 999999) {
            lastPhysical += 1;
            lastCounter = 0;
        }
        persistClock();
        return encodeHlc(lastPhysical, lastCounter, this.deviceId());
    },

    // A remote revision must never be older than what this device can produce next.
    observeRemote(rev) {
        ensureClock();
        const parsed = parseHlc(rev);
        if (!parsed) return;
        if (parsed.physical > lastPhysical) {
            lastPhysical = parsed.physical;
            lastCounter = parsed.counter;
            persistClock();
        } else if (parsed.physical === lastPhysical && parsed.counter > lastCounter) {
            lastCounter = parsed.counter;
            persistClock();
        }
    },

    // Stable comparison for revision strings. Empty/impossible revisions sort first.
    compareRev(a, b) {
        const ra = String(a || '');
        const rb = String(b || '');
        if (ra === rb) return 0;
        return ra > rb ? 1 : -1;
    },

    // Short suffix used in snapshot file names.
    revSuffix(rev) {
        const parsed = parseHlc(rev);
        if (!parsed) return randomHex(4);
        return `${parsed.physical.toString(36)}${parsed.counter.toString(36)}`;
    },

    // ---------- AES-GCM (workspace key) ----------

    async importAesKey(keyB64, usages = ['encrypt', 'decrypt']) {
        return crypto.subtle.importKey('raw', b64ToU8(keyB64), { name: 'AES-GCM' }, false, usages);
    },

    async encryptBytes(keyB64, plain) {
        const key = await this.importAesKey(keyB64, ['encrypt']);
        const iv = randomBytes(12);
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
        const out = new Uint8Array(12 + ct.byteLength);
        out.set(iv, 0);
        out.set(new Uint8Array(ct), 12);
        return out;
    },

    async decryptBytes(keyB64, blob) {
        const key = await this.importAesKey(keyB64, ['decrypt']);
        const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
        if (bytes.length < 13) throw new Error('Encrypted payload is too short');
        const iv = bytes.subarray(0, 12);
        const ct = bytes.subarray(12);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return new Uint8Array(plain);
    },

    async encryptJson(keyB64, value) {
        return this.encryptBytes(keyB64, new TextEncoder().encode(JSON.stringify(value)));
    },

    async decryptJson(keyB64, blob) {
        return JSON.parse(new TextDecoder().decode(await this.decryptBytes(keyB64, blob)));
    },

    // ---------- Stable data hashing (dirty detection and snapshot naming) ----------

    stableStringify(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(v => this.stableStringify(v)).join(',') + ']';
        const keys = Object.keys(value).sort();
        return '{' + keys.map(k => JSON.stringify(k) + ':' + this.stableStringify(value[k])).join(',') + '}';
    }
};

export function getJson(key, fallback = null) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}

export function setJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* ignore quota/private-mode failures */ }
}
