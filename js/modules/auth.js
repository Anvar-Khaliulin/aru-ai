/*
---ARU-LAB.SPACE---ALMATY---2026---
Authentication module managing database login, creation, profile selections, and WebAuthn biometrics.
---chat.aru-lab.space---PWA---
*/
export const Auth = {

    // Cryptographic algorithm configuration
    algo: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: 100000
    },

    async hashPassword(password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key = await this._deriveKey(password, salt);
        return this._toHex(salt) + ':' + this._toHex(key);
    },

    async verifyPassword(password, storedHash) {
        const [saltHex, correctKeyHex] = storedHash.split(':');
        const salt = this._fromHex(saltHex);
        const derivedKey = await this._deriveKey(password, salt);
        const derivedKeyHex = this._toHex(derivedKey);
        return derivedKeyHex === correctKeyHex;
    },

    // --- Web Authentication API (WebAuthn / Biometrics) ---

    isWebAuthnSupported() {
        return !!(window.PublicKeyCredential &&
                  navigator.credentials &&
                  navigator.credentials.create &&
                  navigator.credentials.get);
    },

    async isPlatformAuthenticatorAvailable() {
        if (!this.isWebAuthnSupported()) return false;
        try {
            if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
                return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
            }
        } catch (e) {
            console.warn('Error checking platform authenticator availability', e);
        }
        return false;
    },

    getBiometricsKey(dbIdentifier = 'default') {
        const safe = (dbIdentifier || 'default').replace(/[^a-z0-9_-]/gi, '_');
        return `aru_bio_${safe}`;
    },

    hasBiometrics(dbIdentifier = 'default') {
        try {
            const key = this.getBiometricsKey(dbIdentifier);
            const val = localStorage.getItem(key);
            return !!val;
        } catch (e) {
            return false;
        }
    },

    removeBiometrics(dbIdentifier = 'default') {
        try {
            const key = this.getBiometricsKey(dbIdentifier);
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            return false;
        }
    },

    async registerBiometrics(password, dbIdentifier = 'default', username = 'Aru User') {
        if (!this.isWebAuthnSupported()) {
            throw new Error('WebAuthn is not supported');
        }

        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const userId = crypto.getRandomValues(new Uint8Array(16));

        const createOptions = {
            publicKey: {
                challenge: challenge,
                rp: {
                    name: 'Aru AI',
                    id: window.location.hostname || 'localhost'
                },
                user: {
                    id: userId,
                    name: username || 'aru-user',
                    displayName: username || 'Aru AI'
                },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 },   // ES256
                    { type: 'public-key', alg: -257 }  // RS256
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform', // Face ID, Touch ID, Android Biometrics, Windows Hello
                    userVerification: 'required',
                    requireResidentKey: false
                },
                timeout: 60000,
                attestation: 'none'
            }
        };

        const credential = await navigator.credentials.create(createOptions);
        if (!credential) {
            throw new Error('Biometric registration was cancelled or failed.');
        }

        // Key must match the one derived in authenticateBiometrics: SHA-256(salt || credential ID)
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const rawAuthData = new Uint8Array(credential.rawId);
        const derivationSalt = new Uint8Array(salt.length + rawAuthData.length);
        derivationSalt.set(salt, 0);
        derivationSalt.set(rawAuthData, salt.length);

        const derivedKeyMaterial = await crypto.subtle.digest('SHA-256', derivationSalt);
        const aesKey = await crypto.subtle.importKey(
            'raw',
            derivedKeyMaterial,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt']
        );

        const enc = new TextEncoder();
        const encryptedPass = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            aesKey,
            enc.encode(password)
        );

        const record = {
            credId: this._toHex(new Uint8Array(credential.rawId)),
            salt: this._toHex(salt),
            iv: this._toHex(iv),
            ciphertext: this._toHex(new Uint8Array(encryptedPass)),
            registeredAt: Date.now()
        };

        const storageKey = this.getBiometricsKey(dbIdentifier);
        localStorage.setItem(storageKey, JSON.stringify(record));
        return true;
    },

    async authenticateBiometrics(dbIdentifier = 'default') {
        if (!this.isWebAuthnSupported()) {
            throw new Error('WebAuthn is not supported');
        }

        const storageKey = this.getBiometricsKey(dbIdentifier);
        const recordRaw = localStorage.getItem(storageKey);
        if (!recordRaw) {
            throw new Error('Biometrics not configured on this device.');
        }

        const record = JSON.parse(recordRaw);
        const credId = this._fromHex(record.credId);
        const challenge = crypto.getRandomValues(new Uint8Array(32));

        const getOptions = {
            publicKey: {
                challenge: challenge,
                rpId: window.location.hostname || 'localhost',
                allowCredentials: [{
                    type: 'public-key',
                    id: credId,
                    transports: ['internal']
                }],
                userVerification: 'required',
                timeout: 60000
            }
        };

        const assertion = await navigator.credentials.get(getOptions);
        if (!assertion) {
            throw new Error('Biometric authentication cancelled');
        }

        const salt = this._fromHex(record.salt);
        const iv = this._fromHex(record.iv);
        const ciphertext = this._fromHex(record.ciphertext);

        const rawAuthData = new Uint8Array(assertion.rawId);
        const derivationSalt = new Uint8Array(salt.length + rawAuthData.length);
        derivationSalt.set(salt, 0);
        derivationSalt.set(rawAuthData, salt.length);

        const derivedKeyMaterial = await crypto.subtle.digest('SHA-256', derivationSalt);
        const aesKey = await crypto.subtle.importKey(
            'raw',
            derivedKeyMaterial,
            { name: 'AES-GCM' },
            false,
            ['decrypt']
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            aesKey,
            ciphertext
        );

        const dec = new TextDecoder();
        return dec.decode(decrypted);
    },

    // Internal cryptographic helper methods

    async _deriveKey(password, salt) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            enc.encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveBits', 'deriveKey']
        );

        const strictKey = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: this.algo.iterations,
                hash: this.algo.hash
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 }, // Just deriving bits, but AES-GCM is a standard target
            true,
            ['encrypt', 'decrypt']
        );

        // Exports derived key as raw bytes for string conversion
        const raw = await crypto.subtle.exportKey('raw', strictKey);
        return new Uint8Array(raw);
    },

    _toHex(buffer) {
        return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    _fromHex(hexString) {
        return new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    }
};
