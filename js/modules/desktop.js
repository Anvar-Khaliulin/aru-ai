/*
---ARU-LAB.SPACE---ALMATY---2026---
Desktop shell controller: an OS-like representation of the existing app, its modals and plugins.
No business logic is duplicated here — windows host the real app containers.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { DB } from './db.js';
import { UI } from './ui.js';
import { CanvasManager } from './canvas.js';
import { DesktopNotes } from './desktopNotes.js';

const MODE_KEY = 'aru_desktop_mode';
const SCALE_KEY = 'aru_desktop_scale';
const WALLPAPER_SETTING = 'desktop_wallpaper';
const WALLPAPER_LS = 'aru_desktop_wallpaper';

const SCALES = [1, 1.1, 1.25, 1.5];
const LOCALES = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-US' };
const LANG_LABELS = { kk: 'Қазақша', ru: 'Русский', en: 'English' };
const LANG_CODES = { kk: 'KZ', ru: 'RU', en: 'EN' };

const NOISE_URI = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='160' height='160' filter='url(%23n)' opacity='0.55'/></svg>\")";

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const num = (v, fallback, min, max) => {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));
const pad2 = (v) => String(v).padStart(2, '0');
const isoDate = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

function safeColor(value, fallback) {
    const v = String(value ?? '').trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v.toLowerCase();
    if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]*\)$/i.test(v)) return v;
    return fallback;
}

function safeUrl(value) {
    const v = String(value ?? '').trim();
    if (!v) return '';
    if (/["'<>]/.test(v)) return '';
    if (/^(https?:|blob:|data:image\/)/i.test(v)) return v;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return '';
    return v;
}

function deepMerge(base, extra) {
    if (Array.isArray(base)) {
        if (!Array.isArray(extra)) return clone(base);
        return extra.map((item) => (item && typeof item === 'object' ? clone(item) : item));
    }
    if (base && typeof base === 'object') {
        const out = {};
        const keys = Object.keys(base);
        keys.forEach((key) => {
            out[key] = deepMerge(base[key], extra && typeof extra === 'object' ? extra[key] : undefined);
        });
        return out;
    }
    return extra === undefined ? base : extra;
}

const DEFAULT_WALLPAPER = {
    version: 1,
    baseColor: '#0f172a',
    gradient: {
        type: 'linear',
        angle: 135,
        stops: [
            { color: '#f97316', position: 0 },
            { color: '#7c2d12', position: 100 }
        ]
    },
    pattern: {
        type: 'none',
        color: '#ffffff',
        opacity: 0.08,
        size: 24
    },
    image: {
        url: '',
        size: 'cover',
        opacity: 1,
        blur: 0
    },
    overlay: {
        color: '#000000',
        opacity: 0.18
    },
    noise: 0.03,
    vignette: 0.22
};

function sanitizeWallpaper(raw) {
    const merged = deepMerge(DEFAULT_WALLPAPER, raw && typeof raw === 'object' ? raw : {});
    const out = merged;

    out.version = 1;
    out.baseColor = safeColor(out.baseColor, DEFAULT_WALLPAPER.baseColor);

    const gradient = out.gradient && typeof out.gradient === 'object' ? out.gradient : {};
    out.gradient = {
        type: ['linear', 'radial', 'conic'].includes(gradient.type) ? gradient.type : 'linear',
        angle: num(gradient.angle, 135, 0, 360),
        stops: (Array.isArray(gradient.stops) ? gradient.stops : DEFAULT_WALLPAPER.gradient.stops)
            .slice(0, 4)
            .map((stop, index) => ({
                color: safeColor(stop && stop.color, index === 0 ? '#f97316' : '#7c2d12'),
                position: num(stop && stop.position, index === 0 ? 0 : 100, 0, 100)
            }))
    };
    while (out.gradient.stops.length < 2) {
        out.gradient.stops.push({ color: '#7c2d12', position: 100 });
    }
    out.gradient.stops[0].position = 0;
    out.gradient.stops[out.gradient.stops.length - 1].position = 100;

    const pattern = out.pattern && typeof out.pattern === 'object' ? out.pattern : {};
    out.pattern = {
        type: ['none', 'dots', 'grid', 'diagonal', 'waves'].includes(pattern.type) ? pattern.type : 'none',
        color: safeColor(pattern.color, '#ffffff'),
        opacity: num(pattern.opacity, 0.08, 0, 1),
        size: num(pattern.size, 24, 6, 120)
    };

    const image = out.image && typeof out.image === 'object' ? out.image : {};
    out.image = {
        url: safeUrl(image.url),
        size: ['cover', 'contain', 'auto'].includes(image.size) ? image.size : 'cover',
        opacity: num(image.opacity, 1, 0, 1),
        blur: num(image.blur, 0, 0, 40)
    };

    const overlay = out.overlay && typeof out.overlay === 'object' ? out.overlay : {};
    out.overlay = {
        color: safeColor(overlay.color, '#000000'),
        opacity: num(overlay.opacity, 0.18, 0, 1)
    };

    out.noise = num(out.noise, 0.03, 0, 0.5);
    out.vignette = num(out.vignette, 0.22, 0, 0.8);

    return out;
}

function preset(partial) {
    return sanitizeWallpaper(deepMerge(DEFAULT_WALLPAPER, partial));
}

const PRESETS = [
    {
        id: 'sunset',
        cfg: preset({
            baseColor: '#1a1025',
            gradient: { type: 'linear', angle: 135, stops: [{ color: '#f97316', position: 0 }, { color: '#7c2d12', position: 100 }] },
            overlay: { color: '#000000', opacity: 0.16 },
            noise: 0.03,
            vignette: 0.25
        })
    },
    {
        id: 'mountain',
        cfg: preset({
            baseColor: '#0b1a2a',
            gradient: { type: 'linear', angle: 160, stops: [{ color: '#0f2027', position: 0 }, { color: '#2c5364', position: 100 }] },
            overlay: { color: '#000000', opacity: 0.14 },
            noise: 0.05,
            vignette: 0.35
        })
    },
    {
        id: 'fox',
        cfg: preset({
            baseColor: '#211008',
            gradient: { type: 'radial', angle: 135, stops: [{ color: '#7c2d12', position: 0 }, { color: '#1a0d05', position: 100 }] },
            pattern: { type: 'dots', color: '#ffffff', opacity: 0.05, size: 22 },
            overlay: { color: '#000000', opacity: 0.1 },
            vignette: 0.4
        })
    },
    {
        id: 'aurora',
        cfg: preset({
            baseColor: '#04121a',
            gradient: { type: 'linear', angle: 120, stops: [{ color: '#14b8a6', position: 0 }, { color: '#4338ca', position: 100 }] },
            overlay: { color: '#020617', opacity: 0.18 },
            noise: 0.04,
            vignette: 0.3
        })
    },
    {
        id: 'paper',
        cfg: preset({
            baseColor: '#f1e9db',
            gradient: { type: 'linear', angle: 160, stops: [{ color: '#f8f5ec', position: 0 }, { color: '#e7dcc7', position: 100 }] },
            pattern: { type: 'grid', color: '#7c6f57', opacity: 0.06, size: 26 },
            overlay: { color: '#ffffff', opacity: 0.05 },
            noise: 0.08,
            vignette: 0.12
        })
    },
    {
        id: 'nightgrid',
        cfg: preset({
            baseColor: '#060a14',
            gradient: { type: 'radial', angle: 135, stops: [{ color: '#101b33', position: 0 }, { color: '#05070d', position: 100 }] },
            pattern: { type: 'grid', color: '#3b82f6', opacity: 0.22, size: 34 },
            overlay: { color: '#000000', opacity: 0.12 },
            noise: 0.03,
            vignette: 0.4
        })
    },
    {
        id: 'ocean',
        cfg: preset({
            baseColor: '#031525',
            gradient: { type: 'linear', angle: 145, stops: [{ color: '#0ea5e9', position: 0 }, { color: '#0c4a6e', position: 100 }] },
            pattern: { type: 'waves', color: '#e0f2fe', opacity: 0.1, size: 36 },
            overlay: { color: '#020617', opacity: 0.14 },
            vignette: 0.25
        })
    },
    {
        id: 'rose',
        cfg: preset({
            baseColor: '#2a0b1a',
            gradient: { type: 'radial', angle: 135, stops: [{ color: '#fb7185', position: 0 }, { color: '#4c0519', position: 100 }] },
            pattern: { type: 'diagonal', color: '#ffffff', opacity: 0.04, size: 26 },
            overlay: { color: '#000000', opacity: 0.1 },
            vignette: 0.3
        })
    }
];

const WALLPAPER_LAYERS = `
    <div class="wd-wp-base"></div>
    <div class="wd-wp-image"></div>
    <div class="wd-wp-tint"></div>
    <div class="wd-wp-pattern"></div>
    <div class="wd-wp-noise"></div>
    <div class="wd-wp-vignette"></div>`;

const DESKTOP_ICONS = [
    { action: 'chats', icon: 'messages-square', key: 'chats', color: '#f97316' },
    { action: 'settings', icon: 'settings', key: 'settings', color: '#64748b' },
    { action: 'personalization', icon: 'palette', key: 'personalization', color: '#ec4899' },
    { action: 'library', icon: 'library', key: 'library', color: '#3b82f6' },
    { action: 'notes', icon: 'notebook-pen', key: 'notes', color: '#d97706' }
];

const START_APPS = [
    DESKTOP_ICONS[0], DESKTOP_ICONS[3], DESKTOP_ICONS[1], DESKTOP_ICONS[2], DESKTOP_ICONS[4],
    { action: 'task', icon: 'clipboard-check', key: 'tasks' },
    { action: 'fit-care', icon: 'heart-pulse', key: 'fit_care' },
    { action: 'skills', icon: 'blocks', key: 'skills' },
    { action: 'theme', icon: 'sun-moon', key: 'theme' },
    { action: 'exit', icon: 'minimize-2', key: 'minimize' }
];

function refreshIcons() {
    try {
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    } catch (e) {
        // icon rendering is cosmetic
    }
}

export const DesktopMode = {
    app: null,
    shell: null,
    active: false,
    windows: new Map(),
    activeWinId: null,
    scale: 1,
    zCounter: 10,
    winSeq: 0,
    adoptSeq: 0,
    texts: {},
    allTexts: {},
    wallpaper: clone(DEFAULT_WALLPAPER),
    calView: null,
    calSelected: null,
    persCfg: null,
    persApplied: false,
    _persReady: false,
    _clockTimer: null,
    _observer: null,
    _rawInnerHTML: Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML'),
    _adopting: false,
    tabWindows: new Map(),
    liveTab: null,
    workspace: null,
    workspaceHome: null,
    sidebarHome: null,
    sidebar: null,
    notes: null,
    draftStates: new WeakMap(),

    // ---------- Translations ----------

    async loadTexts() {
        try {
            const response = await fetch('lang/desktop.json', { cache: 'no-cache' });
            if (!response.ok) throw new Error('desktop lang not found');
            this.allTexts = await response.json();
        } catch (error) {
            console.warn('[Desktop] Failed to load desktop translations', error);
            this.allTexts = {};
        }
        this.setLangTexts();
    },

    setLangTexts() {
        const lang = String(state.lang || 'ru').split('-')[0];
        this.texts = (this.allTexts && (this.allTexts[lang] || this.allTexts.en)) || {};
    },

    t(key) {
        const common = { settings: 'settings_title', library: 'sidebar_library', theme: 'label_theme', cancel: 'btn_cancel' };
        if (common[key] && state.translations?.[common[key]]) return state.translations[common[key]];
        return this.texts?.[key] || state.translations?.[key] || key;
    },

    locale() {
        return LOCALES[String(state.lang || 'ru').split('-')[0]] || 'ru-RU';
    },

    // ---------- Init ----------

    async init(app) {
        this.app = app;
        window.DesktopMode = this;

        await this.loadTexts();
        this.loadWallpaper();
        this.loadScale();
        this.patchModals();

        document.addEventListener('fullscreenchange', () => this.updateFullscreenBtn());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeMenus();
        });
        window.addEventListener('aru-lang-changed', () => {
            this.setLangTexts();
            this.applyTexts();
        });
        window.addEventListener('aru-session-started', () => {
            if (localStorage.getItem(MODE_KEY) === '1' && !this.active) {
                this.enter({ fullscreen: false });
            }
        });
        window.addEventListener('aru-tab-activating', (event) => {
            if (this.active) this.mountTab(event.detail.tab);
        });
        window.addEventListener('aru-tab-activated', (event) => {
            if (this.active && event.detail.tab === this.liveTab) this.restoreDraft(event.detail.tab);
        });
        window.addEventListener('aru-tabs-changed', () => {
            if (this.active) this.syncTabWindows();
        });
        window.addEventListener('resize', () => {
            if (this.active) this.clampAllWindows();
        });

        this.applyTexts();
    },

    loadScale() {
        const stored = parseFloat(localStorage.getItem(SCALE_KEY));
        this.scale = SCALES.includes(stored) ? stored : 1;
    },

    // ---------- Wallpaper storage ----------

    loadWallpaper() {
        let raw = null;
        try {
            if (DB && DB.db) raw = DB.getSettings()[WALLPAPER_SETTING];
        } catch (e) {
            // DB may not be ready yet
        }
        if (!raw) {
            try { raw = localStorage.getItem(WALLPAPER_LS); } catch (e) { raw = null; }
        }
        if (raw) {
            try { this.wallpaper = sanitizeWallpaper(JSON.parse(raw)); return; } catch (e) { /* fall through */ }
        }
        this.wallpaper = clone(DEFAULT_WALLPAPER);
    },

    saveWallpaper(cfg) {
        const clean = sanitizeWallpaper(cfg);
        const json = JSON.stringify(clean);
        this.wallpaper = clean;
        try { localStorage.setItem(WALLPAPER_LS, json); } catch (e) { /* storage may be full */ }
        try {
            if (DB && DB.db) DB.saveSetting(WALLPAPER_SETTING, json);
        } catch (e) {
            console.warn('[Desktop] Failed to persist wallpaper in DB', e);
        }
        if (state.userSettings) state.userSettings[WALLPAPER_SETTING] = json;
        return clean;
    },

    // ---------- Wallpaper rendering ----------

    gradientCss(gradient) {
        const stops = gradient.stops.map((stop) => `${stop.color} ${stop.position}%`).join(', ');
        if (gradient.type === 'radial') return `radial-gradient(circle at 50% 40%, ${stops})`;
        if (gradient.type === 'conic') return `conic-gradient(from ${gradient.angle}deg at 50% 50%, ${stops})`;
        return `linear-gradient(${gradient.angle}deg, ${stops})`;
    },

    patternCss(pattern) {
        const color = pattern.color;
        const size = pattern.size;
        switch (pattern.type) {
            case 'dots':
                return { image: `radial-gradient(${color} 1.15px, transparent 1.2px)`, size: `${size}px ${size}px` };
            case 'grid':
                return {
                    image: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
                    size: `${size}px ${size}px`
                };
            case 'diagonal':
                return {
                    image: `repeating-linear-gradient(45deg, ${color} 0 1px, transparent 1px ${Math.max(4, size / 4)}px)`,
                    size: `${size}px ${size}px`
                };
            case 'waves':
                return {
                    image: `repeating-radial-gradient(circle at 0 0, ${color} 0 1px, transparent 1px ${Math.max(4, size / 3)}px)`,
                    size: `${size}px ${size}px`
                };
            default:
                return { image: 'none', size: 'auto' };
        }
    },

    paintWallpaper(root, cfgInput) {
        if (!root) return;
        const cfg = sanitizeWallpaper(cfgInput);
        root.style.backgroundColor = cfg.baseColor;

        const base = root.querySelector('.wd-wp-base');
        if (base) {
            base.style.backgroundColor = cfg.baseColor;
            base.style.backgroundImage = this.gradientCss(cfg.gradient);
        }

        const image = root.querySelector('.wd-wp-image');
        if (image) {
            const url = safeUrl(cfg.image.url);
            image.style.backgroundImage = url ? `url("${url.replace(/"/g, '%22')}")` : 'none';
            image.style.backgroundSize = cfg.image.size;
            image.style.backgroundRepeat = cfg.image.size === 'auto' ? 'repeat' : 'no-repeat';
            image.style.opacity = String(cfg.image.opacity);
            image.style.filter = cfg.image.blur > 0 ? `blur(${cfg.image.blur}px)` : 'none';
            image.style.transform = cfg.image.blur > 0 ? `scale(${1 + cfg.image.blur / 60})` : 'none';
        }

        const tint = root.querySelector('.wd-wp-tint');
        if (tint) {
            tint.style.backgroundColor = cfg.overlay.color;
            tint.style.opacity = String(cfg.overlay.opacity);
        }

        const pattern = root.querySelector('.wd-wp-pattern');
        if (pattern) {
            const css = this.patternCss(cfg.pattern);
            pattern.style.backgroundImage = css.image;
            pattern.style.backgroundSize = css.size;
            pattern.style.opacity = cfg.pattern.type === 'none' ? '0' : String(cfg.pattern.opacity);
        }

        const noise = root.querySelector('.wd-wp-noise');
        if (noise) {
            noise.style.backgroundImage = NOISE_URI;
            noise.style.opacity = String(cfg.noise);
        }

        const vignette = root.querySelector('.wd-wp-vignette');
        if (vignette) {
            vignette.style.backgroundImage = 'radial-gradient(ellipse at center, transparent 52%, rgba(0, 0, 0, 0.85) 100%)';
            vignette.style.opacity = String(cfg.vignette);
        }
    },

    wallpaperLayer() {
        return this.shell ? this.shell.querySelector('#wd-wallpaper') : null;
    },

    // ---------- Modal adoption ----------

    patchModals() {
        const container = document.getElementById('modal-container');
        if (!container || container.__aruDesktopPatched) return;
        container.__aruDesktopPatched = true;

        const desc = this._rawInnerHTML;
        const self = this;
        Object.defineProperty(container, 'innerHTML', {
            configurable: true,
            get() { return desc.get.call(container); },
            set(value) {
                const hadAdopted = self.hasAdoptedWindows();
                desc.set.call(container, value);
                if (hadAdopted && !String(value ?? '').trim()) {
                    self.closeAdoptedWindows();
                }
            }
        });

        this._observer = new MutationObserver((mutations) => {
            if (!self.active || self._adopting) return;
            const added = [];
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== 1) return;
                    if (['SCRIPT', 'STYLE', 'LINK', 'META'].includes(node.tagName)) return;
                    added.push(node);
                });
            });
            if (!added.length) return;
            self.closeAdoptedWindows();
            added.forEach((node) => self.adoptModal(node));
        });
        this._observer.observe(container, { childList: true });
    },

    hasAdoptedWindows() {
        for (const win of this.windows.values()) {
            if (win.adopted) return true;
        }
        return false;
    },

    clearContainer() {
        const container = document.getElementById('modal-container');
        if (!container) return;
        try { this._rawInnerHTML.set.call(container, ''); } catch (e) { container.textContent = ''; }
    },

    adoptAll() {
        const container = document.getElementById('modal-container');
        if (!container) return;
        const nodes = Array.from(container.children).filter((node) => !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(node.tagName));
        if (!nodes.length) return;
        this.closeAdoptedWindows();
        nodes.forEach((node) => this.adoptModal(node));
    },

    adoptModal(modal) {
        if (!modal || modal.nodeType !== 1) return;
        if (modal.closest('#aru-desktop')) return;

        const dialog = Array.from(modal.children).find((child) => /max-w-/.test(child.className || ''))
            || modal.firstElementChild
            || modal;

        const widthMap = [
            ['max-w-sm', 440],
            ['max-w-md', 540],
            ['max-w-lg', 640],
            ['max-w-xl', 700],
            ['max-w-2xl', 880],
            ['max-w-3xl', 980],
            ['max-w-4xl', 1100],
            ['max-w-5xl', 1220],
            ['max-w-6xl', 1320]
        ];
        let width = 720;
        for (const [cls, value] of widthMap) {
            if (dialog.classList.contains(cls)) { width = value; break; }
        }

        const dialogClasses = dialog.className || '';
        const fillsHeight = /h-\[(?:8[05]|9[05]|100)vh\]/.test(dialogClasses) || /h-screen/.test(dialogClasses);

        const heading = dialog.querySelector('h1, h2, h3');
        const titleText = heading ? heading.textContent.replace(/\s+/g, ' ').trim() : '';

        let icon = 'app-window';
        const titleMap = [
            [/settings|настрой|параметр/i, 'settings'],
            [/library|библиотек|кітапхан/i, 'library'],
            [/plugin|плагин/i, 'blocks'],
            [/password|парол|безопас|қауіпсіз/i, 'shield'],
            [/transfer|перенос|тасымал/i, 'arrow-left-right'],
            [/info|информ|ақпарат/i, 'info'],
            [/welcome|добро|қош|create|создан|жасау/i, 'sparkles']
        ];
        for (const [pattern, name] of titleMap) {
            if (pattern.test(titleText)) { icon = name; break; }
        }

        const area = this.areaSize();
        const win = this.createWindow({
            id: `adopt-${++this.adoptSeq}`,
            titleText: titleText || this.t('window'),
            icon,
            width,
            height: fillsHeight ? Math.round(area.h * 0.88) : 420,
            adopted: true
        });
        if (!win) return;

        modal.classList.add('wd-modal-root');
        modal.style.setProperty('position', 'static', 'important');
        modal.style.setProperty('inset', 'auto', 'important');
        modal.style.setProperty('z-index', 'auto', 'important');
        modal.style.setProperty('background', 'transparent', 'important');
        modal.style.setProperty('backdrop-filter', 'none', 'important');
        modal.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
        modal.style.setProperty('width', '100%', 'important');
        modal.style.setProperty('padding', '0', 'important');
        modal.style.setProperty('height', fillsHeight ? '100%' : 'auto', 'important');

        Array.from(modal.children).forEach((child) => {
            if (child !== dialog && child.classList.contains('absolute') && child.classList.contains('inset-0')) child.remove();
        });
        if (dialog !== modal) {
            dialog.classList.add('wd-modal-content');
            dialog.style.maxHeight = '100%';
            dialog.style.maxWidth = 'none';
            dialog.style.width = '100%';
            if (fillsHeight) dialog.style.height = '100%';
            const header = dialog.firstElementChild;
            if (header?.querySelector('h1, h2, h3') && header.querySelector('button[onclick*="modal-container"], button[onclick*="closeModal"]')) header.remove();
            if (dialog.querySelector('#tab-general')) this.decorateSettings(dialog);
        }
        if (!fillsHeight) win.body.style.overflowY = 'auto';

        win.body.appendChild(modal);
        win.modalRoot = modal;

        if (!fillsHeight) {
            const needed = Math.max(
                (dialog.offsetHeight || 0) + 20,
                (modal.scrollHeight || 0) + 12
            );
            const height = clamp(needed || 360, 210, Math.round(area.h * 0.9));
            this.resizeWindow(win.id, win.w, height);
        }

        refreshIcons();
        this.focusWindow(win.id);
    },

    decorateSettings(dialog) {
        const nav = dialog.querySelector('.tab-btn').parentElement;
        const content = dialog.querySelector('#tab-general').parentElement;
        dialog.classList.add('wd-settings-layout');
        nav.classList.add('wd-settings-nav');
        content.classList.add('wd-settings-content');
        dialog.lastElementChild.classList.add('wd-settings-footer');
        const icons = { state: 'activity', general: 'sliders-horizontal', memory: 'brain', rss: 'rss', network: 'network', storage: 'hard-drive', security: 'shield-check' };
        nav.querySelectorAll('[data-tab]').forEach((button) => {
            const caption = document.createElement('span');
            caption.textContent = button.textContent;
            caption.dataset.i18n = `settings_tab_${button.dataset.tab}`;
            button.replaceChildren(caption);
            const icon = document.createElement('i');
            icon.dataset.lucide = icons[button.dataset.tab];
            icon.className = 'w-4 h-4';
            button.prepend(icon);
        });
    },

    closeAdoptedWindows() {
        const ids = [];
        this.windows.forEach((win, id) => { if (win.adopted) ids.push(id); });
        if (!ids.length) return;
        this._adopting = true;
        ids.forEach((id) => this.destroyWindow(id, { keepContainer: true }));
        this._adopting = false;
        this.clearContainer();
    },

    // ---------- Shell ----------

    buildShell() {
        if (this.shell) return;
        const el = document.createElement('div');
        el.id = 'aru-desktop';
        el.className = 'hidden';
        el.innerHTML = `
            <div class="wd-wallpaper" id="wd-wallpaper">${WALLPAPER_LAYERS}</div>
            <div class="wd-desktop-area" id="wd-desktop-area">
                <div class="wd-icons" id="wd-icons"></div>
                <div class="wd-windows" id="wd-windows"></div>
            </div>
            <div class="wd-taskbar">
                <button type="button" class="wd-start-btn" id="wd-start-btn" title="${esc(this.t('start'))}">
                    <i data-lucide="paw-print" class="w-5 h-5"></i>
                </button>
                <div class="wd-taskbar-wins" id="wd-taskbar-wins"></div>
                <div class="wd-taskbar-spacer"></div>
                <div class="wd-tray">
                    <button type="button" class="wd-tray-btn" id="wd-lang-btn" title="${esc(this.t('tray_language'))}">
                        <i data-lucide="languages" class="w-4 h-4"></i>
                        <span class="wd-tray-lang-label" id="wd-lang-code">${esc(LANG_CODES[state.lang] || 'RU')}</span>
                    </button>
                    <button type="button" class="wd-tray-btn" id="wd-fullscreen-btn" title="${esc(this.t('fullscreen'))}">
                        <i data-lucide="maximize" class="w-4 h-4"></i>
                    </button>
                    <button type="button" class="wd-tray-btn wd-clock" id="wd-clock-btn">
                        <span class="wd-clock-time" id="wd-clock-time"></span>
                        <span class="wd-clock-date" id="wd-clock-date"></span>
                    </button>
                </div>
            </div>
            <div class="wd-start-menu hidden" id="wd-start-menu"></div>
            <div class="wd-lang-menu hidden" id="wd-lang-menu"></div>
            <div class="wd-calendar-popover hidden" id="wd-calendar-popover"></div>
            <div id="wd-parking" hidden></div>
        `;
        document.body.appendChild(el);
        this.shell = el;

        el.querySelector('#wd-start-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleStart();
        });
        el.querySelector('#wd-lang-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleLangMenu();
        });
        el.querySelector('#wd-fullscreen-btn').addEventListener('click', () => this.toggleFullscreen());
        el.querySelector('#wd-clock-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.openCalendar();
        });

        const area = el.querySelector('#wd-desktop-area');
        area.addEventListener('contextmenu', (e) => this.onContextMenu(e));

        el.querySelector('#wd-start-menu').addEventListener('click', (e) => {
            const button = e.target.closest('[data-wd-action]');
            if (!button) return;
            this.closeMenus();
            this.runAction(button.dataset.wdAction);
        });
        el.querySelector('#wd-lang-menu').addEventListener('click', (e) => {
            const button = e.target.closest('[data-wd-lang]');
            if (!button) return;
            this.closeMenus();
            const host = this.app || window.app;
            if (host && typeof host.setLang === 'function') host.setLang(button.dataset.wdLang);
        });

        el.addEventListener('pointerdown', (e) => {
            if (e.target.closest('#wd-start-menu') || e.target.closest('#wd-start-btn')) return;
            if (e.target.closest('#wd-lang-menu') || e.target.closest('#wd-lang-btn')) return;
            if (e.target.closest('.wd-context-menu')) return;
            if (e.target.closest('#wd-calendar-popover') || e.target.closest('#wd-clock-btn')) return;
            this.closeMenus();
        }, true);

        refreshIcons();
    },

    startClock() {
        this.stopClock();
        this.updateClock();
        this._clockTimer = window.setInterval(() => this.updateClock(), 15000);
    },

    stopClock() {
        if (this._clockTimer) {
            window.clearInterval(this._clockTimer);
            this._clockTimer = null;
        }
    },

    updateClock() {
        if (!this.shell) return;
        const now = new Date();
        const locale = this.locale();
        const timeEl = this.shell.querySelector('#wd-clock-time');
        const dateEl = this.shell.querySelector('#wd-clock-date');
        const btn = this.shell.querySelector('#wd-clock-btn');
        if (timeEl) timeEl.textContent = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        if (dateEl) dateEl.textContent = now.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
        if (btn) btn.title = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    },

    areaSize() {
        const zone = this.shell ? this.shell.querySelector('#wd-windows') : null;
        let width = zone ? zone.clientWidth : 0;
        let height = zone ? zone.clientHeight : 0;
        if (!width || !height) {
            const scale = this.scale || 1;
            width = window.innerWidth / scale;
            height = window.innerHeight / scale - 52;
        }
        return { w: Math.max(width, 320), h: Math.max(height, 200) };
    },

    enter(options = {}) {
        if (this.active) {
            if (options.fullscreen !== false) this.requestFullscreen();
            return;
        }
        if (window.matchMedia('(max-width: 767px)').matches) return;
        if (!state.isAuth) return;

        if (options.fullscreen !== false) this.requestFullscreen();

        this.buildShell();
        this.prepareWorkspace();

        this.loadWallpaper();
        this.loadScale();
        this.shell.style.setProperty('--wd-scale', String(this.scale));
        this.paintWallpaper(this.wallpaperLayer(), this.wallpaper);
        this.renderDesktopIcons();

        this.shell.classList.remove('hidden');
        document.body.classList.add('aru-desktop-mode');
        this.active = true;
        localStorage.setItem(MODE_KEY, '1');

        this.startClock();
        this.openChatsWindow();
        if (state.tabs.length) {
            state.tabs.forEach((tab) => this.ensureTabWindow(tab));
            const activeTab = state.tabs[state.activeTabIndex];
            if (activeTab) this.mountTab(activeTab);
        }
        this.adoptAll();
        this.applyTexts();
        this.updateFullscreenBtn();
    },

    exit() {
        if (!this.active || (this.notes && !this.notes.canClose())) return;
        this.closeMenus();
        this.paintWallpaper(this.wallpaperLayer(), this.wallpaper);
        this.persApplied = true;
        this.restoreWorkspace();
        this.active = false;
        [...this.windows.keys()].forEach((id) => this.destroyWindow(id, { keepContainer: true }));
        this.tabWindows.clear();
        this.liveTab = null;
        this.clearContainer();
        this.stopClock();

        this.shell.classList.add('hidden');
        document.body.classList.remove('aru-desktop-mode');
        localStorage.setItem(MODE_KEY, '0');

        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
    },

    moveNode(parent, node, before = null) {
        if (parent.moveBefore && node.isConnected && parent.isConnected) parent.moveBefore(node, before);
        else parent.insertBefore(node, before);
    },

    prepareWorkspace() {
        this.workspace = document.getElementById('screen-chat');
        this.sidebar = document.getElementById('sidebar');
        this.workspaceHome = { parent: this.workspace.parentNode, next: this.workspace.nextSibling };
        this.sidebarHome = { parent: this.sidebar.parentNode, next: this.sidebar.nextSibling };
        this.moveNode(this.shell.querySelector('#wd-parking'), this.workspace);
        this.addCanvasDivider();
    },

    restoreWorkspace() {
        this.captureDraft(this.liveTab);
        this.sidebar.style.width = '';
        this.moveNode(this.sidebarHome.parent, this.sidebar, this.sidebarHome.next);
        this.moveNode(this.workspaceHome.parent, this.workspace, this.workspaceHome.next);
        this.workspace.querySelector('.wd-canvas-divider')?.remove();
        document.getElementById('canvas-panel').style.removeProperty('--wd-canvas-width');
    },

    openChatsWindow() {
        const existing = this.windows.get('chats');
        if (existing) {
            this.focusWindow(existing.id);
            return;
        }
        const win = this.createWindow({ id: 'chats', titleKey: 'chats', icon: 'messages-square', width: 360,
            height: 630, x: 108, y: 24, type: 'chat-list', canMaximize: false });
        win.body.classList.add('wd-chat-list');
        this.moveNode(win.body, this.sidebar);
        this.sidebar.style.width = '';
        this.app.loadChatsList();
    },

    ensureTabWindow(tab) {
        let win = this.tabWindows.get(tab);
        if (win) return win;
        const area = this.areaSize();
        win = this.createWindow({ id: `tab-${++this.winSeq}`, titleText: tab.title,
            icon: tab.type === 'plugin' ? (tab.icon || 'blocks') : (tab.isPrivate ? 'shield-check' : 'message-circle'),
            width: Math.min(1020, area.w - 120), height: Math.min(780, area.h - 50), type: 'tab' });
        win.tab = tab;
        win.body.classList.add('wd-chat-body');
        this.tabWindows.set(tab, win);
        return win;
    },

    captureDraft(tab) {
        if (!tab || !this.workspace) return;
        const input = document.getElementById('prompt-input');
        const stream = document.getElementById('messages-container');
        const editor = document.getElementById('doc-editor');
        const canvasView = ['preview', 'code', 'edit'].find((name) =>
            document.getElementById(`btn-canvas-${name}`)?.classList.contains('shadow-sm'));
        this.draftStates.set(tab, { value: input.value, height: input.style.height,
            scroll: stream.scrollTop, canvasWidth: document.getElementById('canvas-panel').style.getPropertyValue('--wd-canvas-width'),
            canvasView, docHtml: canvasView === 'edit' ? editor.innerHTML : null });
    },

    restoreDraft(tab) {
        const saved = this.draftStates.get(tab);
        const input = document.getElementById('prompt-input');
        input.value = saved?.value || '';
        input.style.height = saved?.height || '';
        document.getElementById('canvas-panel').style.setProperty('--wd-canvas-width', saved?.canvasWidth || '45%');
        if (tab.artifact) {
            CanvasManager.switchTab(saved?.canvasView || 'preview');
            if (saved?.canvasView === 'edit' && tab.artifact.type === 'doc' && saved.docHtml !== null) {
                document.getElementById('doc-editor').innerHTML = window.DOMPurify.sanitize(saved.docHtml);
            }
        }
        if (saved) document.getElementById('messages-container').scrollTop = saved.scroll;
        this.app.updateSearchUI();
    },

    snapshotTab(tab) {
        const win = this.tabWindows.get(tab);
        if (!win || !this.workspace || this.workspace.parentNode !== win.body) return;
        this.captureDraft(tab);
        const snapshot = this.workspace.cloneNode(true);
        snapshot.classList.add('wd-chat-snapshot');
        snapshot.inert = true;
        snapshot.querySelectorAll('iframe').forEach((frame) => {
            const placeholder = document.createElement('div');
            placeholder.className = 'wd-snapshot-artifact';
            placeholder.textContent = tab.artifact?.title || this.t('window');
            frame.replaceWith(placeholder);
        });
        [snapshot, ...snapshot.querySelectorAll('*')].forEach((element) => {
            Array.from(element.attributes).forEach((attribute) => {
                if (attribute.name === 'id' || attribute.name.startsWith('on') || attribute.name === 'data-msg-id') element.removeAttribute(attribute.name);
            });
        });
        snapshot.querySelectorAll('script, style, link').forEach((element) => element.remove());
        win.body.querySelector('.wd-chat-snapshot')?.remove();
        win.body.appendChild(snapshot);
        const stream = snapshot.querySelector('.chat-stream');
        if (stream) stream.scrollTop = this.draftStates.get(tab).scroll;
    },

    mountTab(tab) {
        if (!tab || !this.active) return;
        const win = this.ensureTabWindow(tab);
        if (this.liveTab === tab) this.captureDraft(tab);
        if (this.liveTab !== tab) {
            this.snapshotTab(this.liveTab);
            document.getElementById('chapters-pick-cancel')?.click();
            document.getElementById('tools-menu').classList.remove('active');
            win.body.querySelector('.wd-chat-snapshot')?.remove();
            this.moveNode(win.body, this.workspace);
            this.liveTab = tab;
        }
        this.focusWindow(win.id);
    },

    syncTabWindows() {
        this.tabWindows.forEach((win, tab) => {
            if (!state.tabs.includes(tab)) {
                if (this.liveTab === tab) {
                    this.moveNode(this.shell.querySelector('#wd-parking'), this.workspace);
                    this.liveTab = null;
                }
                this.tabWindows.delete(tab);
                this.destroyWindow(win.id, { keepContainer: true });
            } else {
                win.titleText = tab.title;
                win.titleEl.textContent = tab.title;
            }
        });
        this.renderTaskbar();
    },

    addCanvasDivider() {
        const panel = document.getElementById('canvas-panel');
        const divider = document.createElement('div');
        divider.className = 'wd-canvas-divider';
        divider.tabIndex = 0;
        divider.setAttribute('role', 'separator');
        divider.setAttribute('aria-orientation', 'vertical');
        divider.setAttribute('aria-label', this.t('canvas_ratio'));
        panel.before(divider);
        divider.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            divider.setPointerCapture(event.pointerId);
            this.workspace.classList.add('wd-resizing-canvas');
        });
        divider.addEventListener('pointermove', (event) => {
            if (!divider.hasPointerCapture(event.pointerId)) return;
            const rect = this.workspace.getBoundingClientRect();
            const percent = clamp((rect.right - event.clientX) / rect.width * 100, 25, 70);
            panel.style.setProperty('--wd-canvas-width', `${percent}%`);
        });
        const finish = () => this.workspace.classList.remove('wd-resizing-canvas');
        divider.addEventListener('lostpointercapture', finish);
        divider.addEventListener('pointerup', (event) => {
            if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
        });
        divider.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const width = parseFloat(panel.style.getPropertyValue('--wd-canvas-width')) || 45;
            panel.style.setProperty('--wd-canvas-width', `${clamp(width + (event.key === 'ArrowLeft' ? 3 : -3), 25, 70)}%`);
        });
    },

    openNotes() {
        let win = this.windows.get('notes');
        if (!win) {
            win = this.createWindow({ id: 'notes', titleKey: 'notes', icon: 'notebook-pen', width: 850, height: 640,
                canClose: () => this.notes.canClose(), onClose: () => { this.notes.destroy(); this.notes = null; } });
            this.notes = new DesktopNotes(win.body, { t: (key) => this.t(key), locale: () => this.locale() });
        }
        this.focusWindow(win.id);
    },

    openArtifact(id) {
        const artifact = DB.query('SELECT * FROM modules_data WHERE id = ? AND type IN (?, ?, ?, ?)', [id, 'app', 'game', 'doc', 'analytics'])[0];
        if (!artifact) return;
        const existing = this.windows.get(`artifact-${id}`);
        if (existing) { this.focusWindow(existing.id); return; }
        const icons = { app: 'layout', game: 'gamepad-2', doc: 'file-text', analytics: 'bar-chart-3' };
        const win = this.createWindow({ id: `artifact-${id}`, titleText: artifact.name, icon: icons[artifact.type], width: 940, height: 700, type: 'artifact' });
        const frame = document.createElement('iframe');
        frame.className = 'wd-artifact-frame';
        frame.title = artifact.name;
        frame.sandbox = 'allow-scripts allow-forms allow-modals allow-popups';
        win.body.appendChild(frame);
        CanvasManager.renderInto(frame, { type: artifact.type, title: artifact.name, code: artifact.content });
    },

    async requestFullscreen() {
        if (document.fullscreenElement) return;
        // iOS home-screen apps have no element fullscreen API; desktop PWAs do.
        if (navigator.standalone) return;
        try {
            const el = document.documentElement;
            if (el.requestFullscreen) await el.requestFullscreen();
        } catch (error) {
            console.warn('[Desktop] Fullscreen request was rejected', error);
        }
    },

    toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else {
            this.requestFullscreen();
        }
    },

    updateFullscreenBtn() {
        if (!this.shell) return;
        const btn = this.shell.querySelector('#wd-fullscreen-btn');
        if (!btn) return;
        const isFull = !!document.fullscreenElement;
        btn.innerHTML = `<i data-lucide="${isFull ? 'minimize' : 'maximize'}" class="w-4 h-4"></i>`;
        btn.title = this.t('fullscreen');
        refreshIcons();
    },

    setScale(value, options = {}) {
        const numeric = Number(value);
        this.scale = SCALES.includes(numeric) ? numeric : 1;
        try { localStorage.setItem(SCALE_KEY, String(this.scale)); } catch (e) { /* ignore */ }
        if (!this.shell) return;
        this.shell.style.setProperty('--wd-scale', String(this.scale));
        if (options.silent) return;

        this.clampAllWindows();
        this.closeMenus();
    },

    clampAllWindows() {
        const area = this.areaSize();
        this.windows.forEach((win) => {
            if (win.maximized) return;
            win.w = clamp(win.w, 320, area.w);
            win.h = clamp(win.h, 190, area.h);
            win.x = clamp(win.x, 0, Math.max(area.w - win.w, 0));
            win.y = clamp(win.y, 0, Math.max(area.h - win.h, 0));
            this.applyRect(win);
        });
    },

    // ---------- Desktop icons and actions ----------

    renderDesktopIcons() {
        if (!this.shell) return;
        const wrap = this.shell.querySelector('#wd-icons');
        if (!wrap) return;
        wrap.innerHTML = DESKTOP_ICONS.map((item) => `
            <button type="button" class="wd-icon" data-icon-action="${item.action}" title="${esc(this.t(item.key))}">
                <span class="wd-icon-tile" style="background: linear-gradient(145deg, ${item.color}, ${item.color}aa);">
                    <i data-lucide="${item.icon}" class="w-6 h-6"></i>
                </span>
                <span>${esc(this.t(item.key))}</span>
            </button>
        `).join('');
        wrap.querySelectorAll('[data-icon-action]').forEach((button) => {
            button.addEventListener('click', () => this.runAction(button.dataset.iconAction));
        });
        refreshIcons();
    },

    runAction(action) {
        const host = this.app || window.app || {};
        switch (action) {
            case 'chats':
                this.openChatsWindow();
                break;
            case 'notes':
                this.openNotes();
                break;
            case 'library':
                if (typeof host.openLibrary === 'function') host.openLibrary();
                break;
            case 'settings':
                if (typeof host.openSettings === 'function') host.openSettings();
                break;
            case 'plugins':
                if (typeof host.openPlugins === 'function') host.openPlugins();
                break;
            case 'personalization':
                this.openPersonalization();
                break;
            case 'task':
            case 'fit-care':
            case 'skills':
                if (typeof host.launchPlugin === 'function') host.launchPlugin(action);
                break;
            case 'theme': {
                const themeBtn = document.getElementById('theme-toggle');
                if (themeBtn) themeBtn.click();
                break;
            }
            case 'exit':
                this.exit();
                break;
            default:
                break;
        }
    },

    // ---------- Start menu ----------

    renderStartMenu() {
        const menu = this.shell.querySelector('#wd-start-menu');
        if (!menu) return;
        const settings = state.userSettings || {};
        const translations = state.translations || {};
        const modeKey = `wiz_profile_${settings.user_mode || 'adult'}_title`;
        const modeLabel = translations[modeKey] || '';

        const apps = START_APPS.map((item) => `
            <button type="button" class="wd-start-app" data-wd-action="${item.action}">
                <i data-lucide="${item.icon}" class="w-4 h-4"></i>
                <span>${esc(this.t(item.key))}</span>
            </button>
        `).join('');

        menu.innerHTML = `
            <div class="wd-start-head">
                <div class="wd-start-avatar"><i data-lucide="user" class="w-5 h-5"></i></div>
                <div class="min-w-0">
                    <div class="wd-start-user truncate">${esc(settings.user_name || 'User')}</div>
                    <div class="wd-start-mode">${esc(modeLabel)}</div>
                </div>
            </div>
            <div class="wd-start-grid">${apps}</div>
        `;
        refreshIcons();
    },

    toggleStart() {
        const menu = this.shell.querySelector('#wd-start-menu');
        const startBtn = this.shell.querySelector('#wd-start-btn');
        if (!menu) return;
        const wasOpen = !menu.classList.contains('hidden');
        this.closeMenus();
        if (wasOpen) return;
        this.renderStartMenu();
        menu.classList.remove('hidden');
        if (startBtn) startBtn.classList.add('active');
    },

    toggleLangMenu() {
        const menu = this.shell.querySelector('#wd-lang-menu');
        if (!menu) return;
        const wasOpen = !menu.classList.contains('hidden');
        this.closeMenus();
        if (wasOpen) return;

        menu.innerHTML = ['kk', 'ru', 'en'].map((code) => `
            <button type="button" class="wd-lang-item ${state.lang === code ? 'active' : ''}" data-wd-lang="${code}">
                <span class="wd-lang-code">${LANG_CODES[code]}</span>
                <span>${esc(LANG_LABELS[code])}</span>
                ${state.lang === code ? '<i data-lucide="check" class="w-4 h-4 wd-lang-check"></i>' : ''}
            </button>
        `).join('');
        menu.classList.remove('hidden');
        refreshIcons();
    },

    closeMenus() {
        if (!this.shell) return;
        this.shell.querySelector('#wd-start-menu')?.classList.add('hidden');
        this.shell.querySelector('#wd-lang-menu')?.classList.add('hidden');
        this.shell.querySelector('#wd-start-btn')?.classList.remove('active');
        this.shell.querySelector('#wd-context-menu')?.remove();
        this.shell.querySelector('#wd-calendar-popover')?.classList.add('hidden');
    },

    // ---------- Context menu ----------

    onContextMenu(event) {
        if (!this.active) return;
        if (event.target.closest('.wd-window')) return;
        event.preventDefault();
        const rect = this.shell.getBoundingClientRect();
        const scale = this.scale || 1;
        const x = (event.clientX - rect.left) / scale;
        const y = (event.clientY - rect.top) / scale;
        this.showContextMenu(x, y);
    },

    showContextMenu(x, y) {
        this.closeMenus();
        const menu = document.createElement('div');
        menu.className = 'wd-context-menu';
        menu.id = 'wd-context-menu';
        menu.innerHTML = `
            <button type="button" class="wd-menu-item" data-cm-action="personalization">
                <i data-lucide="palette" class="w-4 h-4"></i>
                <span>${esc(this.t('personalization'))}</span>
            </button>
            <div class="wd-menu-sep"></div>
            <div class="wd-menu-heading">${esc(this.t('resolution'))}</div>
            ${SCALES.map((scale) => `
                <button type="button" class="wd-menu-item" data-cm-action="scale" data-scale="${scale}">
                    <span>${Math.round(scale * 100)}%</span>
                    ${this.scale === scale ? '<i data-lucide="check" class="w-4 h-4 wd-menu-check"></i>' : ''}
                </button>
            `).join('')}
            <div class="wd-menu-sep"></div>
            <button type="button" class="wd-menu-item" data-cm-action="exit">
                <i data-lucide="power" class="w-4 h-4"></i>
                <span>${esc(this.t('exit_desktop'))}</span>
            </button>
        `;
        this.shell.appendChild(menu);

        const area = this.areaSize();
        const width = menu.offsetWidth || 252;
        const height = menu.offsetHeight || 200;
        menu.style.left = `${clamp(x, 4, Math.max(area.w - width - 4, 4))}px`;
        menu.style.top = `${clamp(y, 4, Math.max(area.h + 52 - height - 4, 4))}px`;

        menu.addEventListener('click', (event) => {
            const button = event.target.closest('[data-cm-action]');
            if (!button) return;
            const action = button.dataset.cmAction;
            this.closeMenus();
            if (action === 'personalization') this.openPersonalization();
            else if (action === 'scale') this.setScale(Number(button.dataset.scale));
            else if (action === 'exit') this.exit();
        });
        refreshIcons();
    },

    // ---------- Windows ----------

    createWindow(options = {}) {
        if (!this.shell) return null;
        const id = options.id || `win-${++this.winSeq}`;
        if (this.windows.has(id)) {
            const existing = this.windows.get(id);
            if (existing.minimized) this.restoreWindow(id);
            this.focusWindow(id);
            return existing;
        }

        const area = this.areaSize();
        const width = clamp(Math.round(options.width || 760), 320, Math.max(area.w - 8, 320));
        const height = clamp(Math.round(options.height || 560), 190, Math.max(area.h - 8, 190));
        const offsetIndex = this.windows.size % 5;
        const x = clamp(
            options.x != null ? Math.round(options.x) : Math.round((area.w - width) / 2 + offsetIndex * 26),
            -Math.max(width - 160, 0),
            Math.max(area.w - width, 0)
        );
        const y = clamp(
            options.y != null ? Math.round(options.y) : Math.round((area.h - height) / 2 + offsetIndex * 20),
            0,
            Math.max(area.h - height, 0)
        );

        const el = document.createElement('div');
        el.className = 'wd-window';
        el.dataset.winId = id;
        el.innerHTML = `
            <div class="wd-window-titlebar">
                <div class="wd-window-icon"><i data-lucide="${options.icon || 'app-window'}"></i></div>
                <div class="wd-window-title"></div>
                <div class="wd-window-controls">
                    <button type="button" class="wd-win-btn" data-wd-win="minimize" title="${esc(this.t('minimize'))}">
                        <i data-lucide="minus" class="w-4 h-4"></i>
                    </button>
                    <button type="button" class="wd-win-btn" data-wd-win="maximize" title="${esc(this.t('maximize'))}">
                        <i data-lucide="square" class="w-4 h-4"></i>
                    </button>
                    <button type="button" class="wd-win-btn" data-wd-win="close" title="${esc(this.t('close'))}">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
            <div class="wd-window-body"></div>
            <div class="wd-window-resize"></div>
        `;

        const win = {
            id,
            el,
            body: el.querySelector('.wd-window-body'),
            titleEl: el.querySelector('.wd-window-title'),
            icon: options.icon || 'app-window',
            titleKey: options.titleKey || null,
            titleText: options.titleText || '',
            x, y, w: width, h: height,
            minimized: false,
            maximized: false,
            prevRect: null,
            adopted: !!options.adopted,
            type: options.type || 'generic',
            modalRoot: null,
            taskBtn: null,
            onClose: typeof options.onClose === 'function' ? options.onClose : null,
            canClose: options.canClose || null,
            canMaximize: options.canMaximize !== false
        };
        if (!win.canMaximize) el.querySelector('[data-wd-win="maximize"]').remove();

        win.titleEl.textContent = win.titleKey ? this.t(win.titleKey) : (win.titleText || this.t('window'));

        if (options.contentEl) {
            win.body.appendChild(options.contentEl);
        } else if (options.html != null) {
            win.body.innerHTML = options.html;
        }

        this.shell.querySelector('#wd-windows').appendChild(el);
        this.applyRect(win);
        this.windows.set(id, win);

        this.bindWindow(win);
        this.renderTaskbar();
        this.focusWindow(id);
        refreshIcons();
        return win;
    },

    bindWindow(win) {
        const { el } = win;
        el.addEventListener('pointerdown', () => this.focusWindow(win.id));

        const titlebar = el.querySelector('.wd-window-titlebar');
        const resizeHandle = el.querySelector('.wd-window-resize');

        titlebar.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            if (event.target.closest('.wd-win-btn')) return;
            if (win.maximized) return;
            this.startDrag(win, event);
        });
        titlebar.addEventListener('dblclick', (event) => {
            if (event.target.closest('.wd-win-btn')) return;
            this.toggleMaximize(win.id);
        });

        el.querySelectorAll('[data-wd-win]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const action = button.dataset.wdWin;
                if (action === 'minimize') this.minimizeWindow(win.id);
                else if (action === 'maximize') this.toggleMaximize(win.id);
                else if (action === 'close') this.closeWindow(win.id);
            });
        });

        if (resizeHandle) {
            resizeHandle.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) return;
                this.startResize(win, event);
            });
        }
    },

    startDrag(win, event) {
        event.preventDefault();
        const scale = this.scale || 1;
        const startX = event.clientX;
        const startY = event.clientY;
        const baseX = win.x;
        const baseY = win.y;

        const onMove = (moveEvent) => {
            const area = this.areaSize();
            win.x = clamp(baseX + (moveEvent.clientX - startX) / scale, -win.w + 140, Math.max(area.w - 140, 0));
            win.y = clamp(baseY + (moveEvent.clientY - startY) / scale, 0, Math.max(area.h - 44, 0));
            this.applyRect(win);
        };
        const onUp = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    },

    startResize(win, event) {
        event.preventDefault();
        event.stopPropagation();
        const scale = this.scale || 1;
        const startX = event.clientX;
        const startY = event.clientY;
        const baseW = win.w;
        const baseH = win.h;

        const onMove = (moveEvent) => {
            const area = this.areaSize();
            win.w = clamp(baseW + (moveEvent.clientX - startX) / scale, 320, Math.max(area.w - win.x, 320));
            win.h = clamp(baseH + (moveEvent.clientY - startY) / scale, 190, Math.max(area.h - win.y, 190));
            this.applyRect(win);
        };
        const onUp = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    },

    applyRect(win) {
        win.el.style.left = `${Math.round(win.x)}px`;
        win.el.style.top = `${Math.round(win.y)}px`;
        win.el.style.width = `${Math.round(win.w)}px`;
        win.el.style.height = `${Math.round(win.h)}px`;
    },

    resizeWindow(id, width, height) {
        const win = this.windows.get(id);
        if (!win) return;
        const area = this.areaSize();
        win.w = clamp(Math.round(width), 320, area.w);
        win.h = clamp(Math.round(height), 190, area.h);
        win.x = clamp(win.x, 0, Math.max(area.w - win.w, 0));
        win.y = clamp(win.y, 0, Math.max(area.h - win.h, 0));
        this.applyRect(win);
    },

    focusWindow(id) {
        const win = this.windows.get(id);
        if (!win) return;
        if (win.tab && this.liveTab !== win.tab && state.tabs.includes(win.tab)) {
            this.app.switchTab(state.tabs.indexOf(win.tab));
            return;
        }
        if (win.minimized) {
            win.minimized = false;
            win.el.classList.remove('minimized');
        }
        this.activeWinId = id;
        win.el.style.zIndex = String(++this.zCounter);
        this.windows.forEach((item, winId) => {
            item.el.classList.toggle('focused', winId === id);
        });
        this.updateTaskbarActive();
    },

    minimizeWindow(id) {
        const win = this.windows.get(id);
        if (!win) return;
        win.minimized = true;
        win.el.classList.add('minimized');
        if (this.activeWinId === id) this.activeWinId = null;
        this.updateTaskbarActive();
    },

    restoreWindow(id) {
        this.focusWindow(id);
    },

    toggleMaximize(id) {
        const win = this.windows.get(id);
        if (!win || !win.canMaximize) return;
        if (win.maximized) {
            win.maximized = false;
            win.el.classList.remove('maximized');
            if (win.prevRect) {
                win.x = win.prevRect.x;
                win.y = win.prevRect.y;
                win.w = win.prevRect.w;
                win.h = win.prevRect.h;
                this.applyRect(win);
            }
            this.setMaximizeIcon(win, false);
        } else {
            win.prevRect = { x: win.x, y: win.y, w: win.w, h: win.h };
            win.maximized = true;
            win.el.classList.add('maximized');
            this.setMaximizeIcon(win, true);
        }
        this.focusWindow(id);
    },

    setMaximizeIcon(win, maximized) {
        const button = win.el.querySelector('[data-wd-win="maximize"]');
        if (!button) return;
        button.innerHTML = `<i data-lucide="${maximized ? 'minimize-2' : 'square'}" class="w-4 h-4"></i>`;
        button.title = this.t(maximized ? 'restore' : 'maximize');
        refreshIcons();
    },

    closeWindow(id) {
        const win = this.windows.get(id);
        if (!win || (win.canClose && !win.canClose())) return;
        if (win.tab) {
            this.app.closeTab(state.tabs.indexOf(win.tab));
            return;
        }
        if (id === 'chats') this.moveNode(this.shell.querySelector('#wd-parking'), this.sidebar);
        this.destroyWindow(id);
    },

    destroyWindow(id, options = {}) {
        const win = this.windows.get(id);
        if (!win) return;
        if (win.onClose) {
            try { win.onClose(); } catch (error) { console.warn('[Desktop] Window onClose failed', error); }
        }
        win.el.remove();
        if (win.taskBtn) win.taskBtn.remove();
        this.windows.delete(id);
        if (this.activeWinId === id) this.activeWinId = null;
        this.updateTaskbarActive();
        if (win.adopted && !options.keepContainer && !this._adopting) {
            this.closeAdoptedWindows();
            this.clearContainer();
        }
    },

    renderTaskbar() {
        if (!this.shell) return;
        const wrap = this.shell.querySelector('#wd-taskbar-wins');
        if (!wrap) return;
        wrap.innerHTML = '';
        this.windows.forEach((win, id) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'wd-task-btn';
            button.dataset.winId = id;
            button.title = win.titleKey ? this.t(win.titleKey) : (win.titleText || this.t('window'));
            const caption = win.tab ? Array.from(button.title).slice(0, 7).join('') + (Array.from(button.title).length > 7 ? '…' : '') : button.title;
            button.innerHTML = `<i data-lucide="${win.icon}" class="w-4 h-4"></i><span>${esc(caption)}</span>`;
            button.addEventListener('click', () => {
                const current = this.windows.get(id);
                if (!current) return;
                if (current.minimized) this.restoreWindow(id);
                else if (this.activeWinId === id) this.minimizeWindow(id);
                else this.focusWindow(id);
            });
            wrap.appendChild(button);
            win.taskBtn = button;
        });
        this.updateTaskbarActive();
        refreshIcons();
    },

    updateTaskbarActive() {
        if (!this.shell) return;
        this.windows.forEach((win, id) => {
            if (win.taskBtn) win.taskBtn.classList.toggle('active', !win.minimized && this.activeWinId === id);
        });
    },

    // ---------- Calendar ----------

    openCalendar() {
        const popover = this.shell.querySelector('#wd-calendar-popover');
        const wasOpen = !popover.classList.contains('hidden');
        this.closeMenus();
        if (wasOpen) return;
        const now = new Date();
        this.calView = { year: now.getFullYear(), month: now.getMonth() };
        this.calSelected = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        this.renderCalendarWindow();
        popover.classList.remove('hidden');
    },

    renderCalendarWindow() {
        const body = this.shell?.querySelector('#wd-calendar-popover');
        if (!body) return;
        body.innerHTML = this.buildCalendarHtml();
        body.querySelectorAll('[data-cal-nav]').forEach((button) => {
            button.addEventListener('click', () => {
                const delta = Number(button.dataset.calNav);
                const date = new Date(this.calView.year, this.calView.month + delta, 1);
                this.calView = { year: date.getFullYear(), month: date.getMonth() };
                this.renderCalendarWindow();
            });
        });
        body.querySelectorAll('[data-cal-date]').forEach((button) => {
            button.addEventListener('click', () => {
                const [year, month, day] = button.dataset.calDate.split('-').map(Number);
                this.calSelected = new Date(year, month - 1, day);
                if (month - 1 !== this.calView.month || year !== this.calView.year) {
                    this.calView = { year, month: month - 1 };
                }
                this.renderCalendarWindow();
            });
        });
        const todayBtn = body.querySelector('[data-cal-today]');
        if (todayBtn) {
            todayBtn.addEventListener('click', () => {
                const now = new Date();
                this.calView = { year: now.getFullYear(), month: now.getMonth() };
                this.calSelected = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                this.renderCalendarWindow();
            });
        }
        refreshIcons();
    },

    buildCalendarHtml() {
        const locale = this.locale();
        const view = this.calView || { year: new Date().getFullYear(), month: new Date().getMonth() };
        const selected = this.calSelected || new Date();
        const first = new Date(view.year, view.month, 1);
        const startOffset = (first.getDay() + 6) % 7;
        const prevDays = new Date(view.year, view.month, 0).getDate();
        const currentDays = new Date(view.year, view.month + 1, 0).getDate();
        const todayKey = isoDate(new Date());
        const selectedKey = isoDate(selected);

        const cells = [];
        for (let i = 0; i < 42; i += 1) {
            const dayNumber = i - startOffset + 1;
            let date;
            let other = false;
            if (dayNumber < 1) {
                date = new Date(view.year, view.month - 1, prevDays + dayNumber);
                other = true;
            } else if (dayNumber > currentDays) {
                date = new Date(view.year, view.month + 1, dayNumber - currentDays);
                other = true;
            } else {
                date = new Date(view.year, view.month, dayNumber);
            }
            const key = isoDate(date);
            const classes = [
                'wd-cal-cell',
                other ? 'other' : '',
                key === todayKey ? 'today' : '',
                key === selectedKey ? 'selected' : ''
            ].filter(Boolean).join(' ');
            cells.push(`<button type="button" class="${classes}" data-cal-date="${key}">${date.getDate()}</button>`);
        }

        const dows = Array.from({ length: 7 }, (_, index) => (
            `<div class="wd-cal-dow">${esc(new Date(2024, 0, 1 + index).toLocaleDateString(locale, { weekday: 'short' }))}</div>`
        )).join('');

        const title = first.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
        const selectedLabel = selected.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });

        return `
            <div class="wd-cal">
                <div class="wd-cal-head">
                    <button type="button" class="wd-cal-nav" data-cal-nav="-1" title="${esc(this.t('calendar'))}">
                        <i data-lucide="chevron-left" class="w-4 h-4"></i>
                    </button>
                    <div class="wd-cal-title">${esc(title)}</div>
                    <button type="button" class="wd-cal-nav" data-cal-nav="1" title="${esc(this.t('calendar'))}">
                        <i data-lucide="chevron-right" class="w-4 h-4"></i>
                    </button>
                </div>
                <div class="wd-cal-grid">${dows}${cells.join('')}</div>
                <div class="wd-cal-foot">
                    <button type="button" class="wd-btn wd-btn-ghost" data-cal-today>${esc(this.t('today'))}</button>
                    <span>${esc(selectedLabel)}</span>
                </div>
            </div>
        `;
    },

    // ---------- Personalization ----------

    openPersonalization() {
        if (this.windows.has('personalization')) {
            this.focusWindow('personalization');
            return;
        }
        this.loadWallpaper();
        this.persCfg = sanitizeWallpaper(this.wallpaper);
        this.persApplied = false;

        let win = this.windows.get('personalization');
        if (!win) {
            const area = this.areaSize();
            win = this.createWindow({
                id: 'personalization',
                titleKey: 'personalization',
                icon: 'palette',
                width: Math.min(980, Math.max(area.w - 24, 360)),
                height: Math.min(820, Math.max(area.h - 24, 300)),
                type: 'pers',
                onClose: () => {
                    if (!this.persApplied) this.paintWallpaper(this.wallpaperLayer(), this.wallpaper);
                }
            });
        }
        if (!win) return;

        if (!win.persBound) {
            this.bindPersonalization(win);
            win.persBound = true;
        }
        this.renderPersonalizationWindow();
        this.focusWindow('personalization');
    },

    renderPersonalizationWindow() {
        const win = this.windows.get('personalization');
        if (!win) return;
        const scroll = win.body.querySelector('.wd-pers')?.scrollTop || 0;
        win.body.innerHTML = this.buildPersonalizationHtml(this.persCfg);
        const preview = win.body.querySelector('#wp-preview');
        this.paintWallpaper(preview, this.persCfg);
        this.paintWallpaper(this.wallpaperLayer(), this.persCfg);
        win.body.querySelectorAll('.wd-preset').forEach((button) => {
            const entry = PRESETS.find((item) => item.id === button.dataset.preset);
            if (entry) this.paintWallpaper(button.querySelector('.wd-wallpaper'), entry.cfg);
        });
        this.updatePersOutputs(win.body);
        const scroller = win.body.querySelector('.wd-pers');
        if (scroller) scroller.scrollTop = scroll;
        refreshIcons();
    },

    buildPersonalizationHtml(cfg) {
        const tr = (key) => esc(this.t(key));
        const colorField = (id, value) => `<input type="color" class="wd-color" id="${id}" data-wp="${id}" value="${esc(value)}">`;
        const selectField = (id, options, value) => `
            <select class="wd-select" id="${id}" data-wp="${id}">
                ${options.map((option) => `<option value="${esc(option.value)}" ${option.value === value ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
            </select>`;
        const field = (label, control) => `<div class="wd-field"><label class="wd-label">${label}</label>${control}</div>`;
        const rangeField = (label, id, value, min, max, step, format) => `
            <div class="wd-field">
                <label class="wd-label">${label}</label>
                <div class="wd-range-row">
                    <input type="range" class="wd-range" id="${id}" data-wp="${id}" data-fmt="${format}"
                        min="${min}" max="${max}" step="${step}" value="${value}">
                    <output id="${id}-out">${this.formatRange(value, format)}</output>
                </div>
            </div>`;

        const presets = PRESETS.map((entry) => `
            <button type="button" class="wd-preset ${this.sameWallpaper(entry.cfg, cfg) ? 'active' : ''}" data-preset="${entry.id}">
                <div class="wd-wallpaper">${WALLPAPER_LAYERS}</div>
                <span class="wd-preset-name">${tr(`preset_${entry.id}`)}</span>
            </button>
        `).join('');

        const firstStop = cfg.gradient.stops[0];
        const lastStop = cfg.gradient.stops[cfg.gradient.stops.length - 1];

        return `
            <div class="wd-pers">
                <div class="wd-pers-preview-wrap">
                    <span class="wd-pers-preview-label">${tr('preview')}</span>
                    <div class="wd-pers-preview" id="wp-preview">
                        <div class="wd-wallpaper">${WALLPAPER_LAYERS}</div>
                    </div>
                </div>

                <div class="wd-card">
                    <div class="wd-card-title"><i data-lucide="image" class="w-3.5 h-3.5"></i>${tr('wallpaper_presets')}</div>
                    <div class="wd-pers-presets">${presets}</div>
                </div>

                <div class="wd-pers-grid">
                    <div class="wd-card">
                        <div class="wd-card-title"><i data-lucide="paintbrush" class="w-3.5 h-3.5"></i>${tr('colors')}</div>
                        ${field(tr('base_color'), colorField('wp-base', cfg.baseColor))}
                        <div class="wd-row">
                            ${field(tr('color_from'), colorField('wp-from', firstStop.color))}
                            ${field(tr('color_to'), colorField('wp-to', lastStop.color))}
                        </div>
                        <div class="wd-row">
                            ${field(tr('gradient_type'), selectField('wp-gtype', [
                                { value: 'linear', label: this.t('linear') },
                                { value: 'radial', label: this.t('radial') },
                                { value: 'conic', label: this.t('conic') }
                            ], cfg.gradient.type))}
                        </div>
                        ${rangeField(tr('angle'), 'wp-angle', cfg.gradient.angle, 0, 360, 1, 'deg')}
                    </div>

                    <div class="wd-card">
                        <div class="wd-card-title"><i data-lucide="grid-3x3" class="w-3.5 h-3.5"></i>${tr('pattern')}</div>
                        ${field(tr('gradient_type'), selectField('wp-pat-type', [
                            { value: 'none', label: this.t('pattern_none') },
                            { value: 'dots', label: this.t('pattern_dots') },
                            { value: 'grid', label: this.t('pattern_grid') },
                            { value: 'diagonal', label: this.t('pattern_diagonal') },
                            { value: 'waves', label: this.t('pattern_waves') }
                        ], cfg.pattern.type))}
                        ${field(tr('pattern_color'), colorField('wp-pat-color', cfg.pattern.color))}
                        ${rangeField(tr('pattern_opacity'), 'wp-pat-opacity', cfg.pattern.opacity, 0, 1, 0.01, 'pct')}
                        ${rangeField(tr('pattern_size'), 'wp-pat-size', cfg.pattern.size, 6, 120, 1, 'px')}
                    </div>

                    <div class="wd-card">
                        <div class="wd-card-title"><i data-lucide="image-plus" class="w-3.5 h-3.5"></i>${tr('image')}</div>
                        <div class="wd-field">
                            <label class="wd-label">${tr('image_url')}</label>
                            <input type="text" class="wd-input" id="wp-img-url" data-wp="wp-img-url"
                                value="${esc(cfg.image.url)}" placeholder="https://...">
                            <div class="wd-hint">${tr('image_hint')}</div>
                        </div>
                        ${field(tr('image'), selectField('wp-img-size', [
                            { value: 'cover', label: 'Cover' },
                            { value: 'contain', label: 'Contain' },
                            { value: 'auto', label: 'Auto' }
                        ], cfg.image.size))}
                        ${rangeField(tr('image_opacity'), 'wp-img-opacity', cfg.image.opacity, 0, 1, 0.01, 'pct')}
                        ${rangeField(tr('image_blur'), 'wp-img-blur', cfg.image.blur, 0, 40, 1, 'px')}
                    </div>

                    <div class="wd-card">
                        <div class="wd-card-title"><i data-lucide="sun-dim" class="w-3.5 h-3.5"></i>${tr('effects')}</div>
                        ${field(tr('overlay_color'), colorField('wp-ov-color', cfg.overlay.color))}
                        ${rangeField(tr('overlay'), 'wp-ov-opacity', cfg.overlay.opacity, 0, 1, 0.01, 'pct')}
                        ${rangeField(tr('noise'), 'wp-noise', cfg.noise, 0, 0.5, 0.01, 'pct')}
                        ${rangeField(tr('vignette'), 'wp-vignette', cfg.vignette, 0, 0.8, 0.01, 'pct')}
                    </div>

                    <div class="wd-card wide">
                        <div class="wd-card-title"><i data-lucide="code-2" class="w-3.5 h-3.5"></i>${tr('wallpaper_json')}</div>
                        <textarea class="wd-json" id="wp-json" spellcheck="false">${esc(JSON.stringify(cfg, null, 2))}</textarea>
                        <div class="wd-hint">${tr('wallpaper_json_hint')}</div>
                        <div class="wd-json-actions">
                            <button type="button" class="wd-btn wd-btn-ghost" data-pers-action="json-apply">${tr('json_apply')}</button>
                            <button type="button" class="wd-btn wd-btn-ghost" data-pers-action="export">${tr('json_export')}</button>
                            <button type="button" class="wd-btn wd-btn-ghost" data-pers-action="import">${tr('json_import')}</button>
                            <button type="button" class="wd-btn wd-btn-ghost" data-pers-action="reset">${tr('reset')}</button>
                        </div>
                        <input type="file" id="wp-import" accept=".json,application/json" class="hidden">
                    </div>
                </div>

                <div class="wd-pers-actions">
                    <button type="button" class="wd-btn wd-btn-ghost" data-pers-action="cancel">${tr('cancel')}</button>
                    <button type="button" class="wd-btn wd-btn-primary" data-pers-action="apply">${tr('apply')}</button>
                </div>
            </div>
        `;
    },

    bindPersonalization(win) {
        const body = win.body;

        const onInput = (event) => {
            if (event.target.closest('.wd-json')) return;
            if (!event.target.matches('[data-wp]')) return;
            this.syncPersForm(body);
        };
        body.addEventListener('input', onInput);
        body.addEventListener('change', (event) => {
            if (event.target.id === 'wp-import') {
                this.importWallpaperFile(body, event.target);
                return;
            }
            onInput(event);
        });

        body.addEventListener('click', (event) => {
            const presetBtn = event.target.closest('[data-preset]');
            if (presetBtn) {
                const entry = PRESETS.find((item) => item.id === presetBtn.dataset.preset);
                if (entry) {
                    this.persCfg = sanitizeWallpaper(entry.cfg);
                    this.renderPersonalizationWindow();
                }
                return;
            }
            const actionBtn = event.target.closest('[data-pers-action]');
            if (!actionBtn) return;
            const action = actionBtn.dataset.persAction;
            if (action === 'json-apply') this.applyPersJson(body);
            else if (action === 'export') this.exportWallpaper();
            else if (action === 'import') body.querySelector('#wp-import')?.click();
            else if (action === 'reset') {
                this.persCfg = clone(DEFAULT_WALLPAPER);
                this.renderPersonalizationWindow();
            } else if (action === 'cancel') {
                this.persApplied = true;
                this.paintWallpaper(this.wallpaperLayer(), this.wallpaper);
                this.destroyWindow('personalization');
            } else if (action === 'apply') {
                this.applyWallpaper();
            }
        });
    },

    readPersForm(body) {
        const value = (id, fallback) => {
            const input = body.querySelector(`#${id}`);
            return input ? input.value : fallback;
        };
        const cfg = clone(this.persCfg);
        cfg.baseColor = value('wp-base', cfg.baseColor);
        cfg.gradient.type = value('wp-gtype', cfg.gradient.type);
        cfg.gradient.angle = Number(value('wp-angle', cfg.gradient.angle));
        cfg.gradient.stops[0].color = value('wp-from', cfg.gradient.stops[0].color);
        const lastStop = cfg.gradient.stops[cfg.gradient.stops.length - 1];
        lastStop.color = value('wp-to', lastStop.color);
        cfg.pattern.type = value('wp-pat-type', cfg.pattern.type);
        cfg.pattern.color = value('wp-pat-color', cfg.pattern.color);
        cfg.pattern.opacity = Number(value('wp-pat-opacity', cfg.pattern.opacity));
        cfg.pattern.size = Number(value('wp-pat-size', cfg.pattern.size));
        cfg.image.url = String(value('wp-img-url', cfg.image.url) || '').trim();
        cfg.image.size = value('wp-img-size', cfg.image.size);
        cfg.image.opacity = Number(value('wp-img-opacity', cfg.image.opacity));
        cfg.image.blur = Number(value('wp-img-blur', cfg.image.blur));
        cfg.overlay.color = value('wp-ov-color', cfg.overlay.color);
        cfg.overlay.opacity = Number(value('wp-ov-opacity', cfg.overlay.opacity));
        cfg.noise = Number(value('wp-noise', cfg.noise));
        cfg.vignette = Number(value('wp-vignette', cfg.vignette));
        return sanitizeWallpaper(cfg);
    },

    syncPersForm(body) {
        const cfg = this.readPersForm(body);
        this.persCfg = cfg;
        this.paintWallpaper(this.wallpaperLayer(), cfg);
        this.paintWallpaper(body.querySelector('#wp-preview'), cfg);
        this.updatePersOutputs(body);

        const textarea = body.querySelector('#wp-json');
        if (textarea && document.activeElement !== textarea) {
            textarea.value = JSON.stringify(cfg, null, 2);
        }
        body.querySelectorAll('.wd-preset').forEach((button) => {
            const entry = PRESETS.find((item) => item.id === button.dataset.preset);
            button.classList.toggle('active', !!entry && this.sameWallpaper(entry.cfg, cfg));
        });
    },

    updatePersOutputs(body) {
        body.querySelectorAll('input[type="range"][data-fmt]').forEach((input) => {
            const output = body.querySelector(`#${input.id}-out`);
            if (output) output.textContent = this.formatRange(input.value, input.dataset.fmt);
        });
    },

    formatRange(value, format) {
        const numeric = Number(value) || 0;
        if (format === 'pct') return `${Math.round(numeric * 100)}%`;
        if (format === 'px') return `${Math.round(numeric)}px`;
        if (format === 'deg') return `${Math.round(numeric)}°`;
        return String(Math.round(numeric));
    },

    sameWallpaper(a, b) {
        try {
            return JSON.stringify(sanitizeWallpaper(a)) === JSON.stringify(sanitizeWallpaper(b));
        } catch (e) {
            return false;
        }
    },

    applyPersJson(body) {
        const textarea = body.querySelector('#wp-json');
        if (!textarea) return;
        try {
            const parsed = JSON.parse(textarea.value);
            this.persCfg = sanitizeWallpaper(parsed);
            this.renderPersonalizationWindow();
        } catch (error) {
            UI.showToast(this.t('invalid_json'), 'alert-triangle');
        }
    },

    importWallpaperFile(body, input) {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                this.persCfg = sanitizeWallpaper(JSON.parse(String(reader.result)));
                this.renderPersonalizationWindow();
            } catch (error) {
                UI.showToast(this.t('invalid_json'), 'alert-triangle');
            }
        };
        reader.readAsText(file);
        input.value = '';
    },

    exportWallpaper() {
        const textarea = this.windows.get('personalization')?.body.querySelector('#wp-json');
        let json;
        try {
            json = textarea ? JSON.stringify(sanitizeWallpaper(JSON.parse(textarea.value)), null, 2) : JSON.stringify(this.persCfg, null, 2);
        } catch (error) {
            json = JSON.stringify(this.persCfg, null, 2);
        }
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'aru-wallpaper.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    },

    applyWallpaper() {
        this.persApplied = true;
        const saved = this.saveWallpaper(this.persCfg || this.wallpaper);
        this.paintWallpaper(this.wallpaperLayer(), saved);
        this.destroyWindow('personalization');
        UI.showToast(this.t('wallpaper_saved'), 'check');
    },

    // ---------- Texts ----------

    applyTexts() {
        if (!this.allTexts || !Object.keys(this.allTexts).length) return;
        this.setLangTexts();

        document.querySelectorAll('[data-dt]').forEach((el) => {
            const key = el.dataset.dt;
            if (key) el.textContent = this.t(key);
        });
        document.querySelectorAll('[data-dt-title]').forEach((el) => {
            const key = el.dataset.dtTitle;
            if (key) el.title = this.t(key);
        });
        document.querySelectorAll('[data-dt-placeholder]').forEach((el) => {
            const key = el.dataset.dtPlaceholder;
            if (key) el.placeholder = this.t(key);
        });

        if (!this.shell) return;

        const startBtn = this.shell.querySelector('#wd-start-btn');
        if (startBtn) startBtn.title = this.t('start');
        const langBtn = this.shell.querySelector('#wd-lang-btn');
        if (langBtn) langBtn.title = this.t('tray_language');
        const langCode = this.shell.querySelector('#wd-lang-code');
        if (langCode) langCode.textContent = LANG_CODES[state.lang] || 'RU';

        this.renderDesktopIcons();
        this.renderTaskbar();
        this.updateClock();
        this.updateFullscreenBtn();

        this.windows.forEach((win) => {
            if (win.titleKey) win.titleEl.textContent = this.t(win.titleKey);
            this.setMaximizeIcon(win, win.maximized);
        });

        if (!this.shell.querySelector('#wd-start-menu')?.classList.contains('hidden')) this.renderStartMenu();
        if (!this.shell.querySelector('#wd-calendar-popover').classList.contains('hidden')) this.renderCalendarWindow();
        if (this.windows.has('personalization')) this.renderPersonalizationWindow();
        if (this.notes) this.notes.renderTexts();
    }
};

window.DesktopMode = DesktopMode;
