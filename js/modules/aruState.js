/*
---ARU-LAB.SPACE---ALMATY---2026---
Global state manager handling the personality metrics, theme, and language configuration.
---chat.aru-lab.space---PWA---
*/
const defaultState = {
    lang: 'en',
    theme: 'light',
    appVersion: '',
    translations: {},
    isAuth: false,
    currentChatId: null,
    tabs: [], // { chatId, pluginId, type: 'chat'|'plugin', title, artifact: null, isSending: false, isCanvasOpen: false, attachments: [], isSearchEnabled: false }
    activeTabIndex: -1,
    pluginsTranslations: {},
    userSettings: {
        show_stickers: 'true'
    },
    isFileDataPending: false,
};

// Internal mutable personality store
const _personality = { mood: 50, humor: 50, sarcasm: 0, affinity: 0 };

export const aruGlobalState = {
    ...defaultState,
    lang: localStorage.getItem('aru_lang') || 'en',
    theme: localStorage.getItem('aru_theme') || 'light',

    // Read-only accessor returning a frozen snapshot of the personality state
    get personality() {
        return Object.freeze({ ..._personality });
    },

    // Controlled setter for personality metrics with strict constraints to ensure valid data ranges
    setPersonality(updates = {}) {
        if (typeof updates !== 'object' || updates === null) return;
        const allowed = ['mood', 'sarcasm', 'humor', 'affinity'];
        let mutated = false;

        for (const k of allowed) {
            if (k in updates && typeof updates[k] === 'number') {
                _personality[k] = Math.max(0, Math.min(100, Math.round(updates[k])));
                mutated = true;
            }
        }

        if (mutated) {
            // Synchronizes global variable state across the application
            window.aruState = aruGlobalState;
        }
    }
};

// Global window exposure for application-wide accessibility
window.aruState = aruGlobalState;
