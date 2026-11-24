/*
---ARU-LAB.SPACE---ALMATY---2026---
Aru Fit & Care — plugin core: state, i18n, data loading, quick logging,
daily Aru chat and shared modal/toast helpers.

The plugin ships as several classic scripts that extend this object; the
plugin manager executes them in order and then calls onActivate().
---chat.aru-lab.space---PWA---
*/
window.FitCarePlugin = window.FitCarePlugin || {};

Object.assign(window.FitCarePlugin, {
    state: {
        view: 'calendar',
        calendarMode: 'month',
        cursor: new Date(),
        selectedDate: null,
        dayTab: 'day',
        chatWide: false,
        dashRange: 30,
        lang: 'en',
        i18n: {},
        range: { from: '', to: '' },
        profile: null,
        plans: [],
        activePlan: null,
        planDays: [],
        protocols: [],
        cycles: [],
        dailyMap: new Map(),
        workoutsByDate: new Map(),
        mealsByDate: new Map(),
        healthByDate: new Map(),
        cycleLogByDate: new Map(),
        intimacyByDate: new Map(),
        chatBusy: false,
        chatError: '',
        chatDraft: '',
        noteDrafts: {},
        showPrivate: false,
        planViewId: null,
        planWeek: null,
        healthPage: 0,
        cyclesPage: 0,
        intimacyPage: 0
    },

    MAX_CHAT_HISTORY: 16,

    async onActivate() {
        if (this.isChild()) return;
        const root = document.getElementById('fit-care-plugin-root');
        if (this._initialized && root && this._root === root && window.DB && window.DB.db) {
            this.state.lang = this.currentLang();
            this.applyI18n();
            this.loadAll();
            this.render();
            return;
        }
        await this.init();
    },

    onDeactivate() {
        this.closeModal();
    },

    onClose() {
        this.closeModal();
        this._root = null;
    },

    async init() {
        if (this.isChild()) return;
        const root = document.getElementById('fit-care-plugin-root');
        if (!root) return;
        if (!(window.DB && window.DB.db)) {
            if (!this._waitingDb) {
                this._waitingDb = true;
                window.addEventListener('aru-db-initialized', () => {
                    this._waitingDb = false;
                    this.init();
                }, { once: true });
            }
            return;
        }
        this._root = root;
        this.bindEvents();
        await this.loadI18n();
        this.state.lang = this.currentLang();
        this.applyI18n();

        if (!this._initialized) {
            const savedView = localStorage.getItem('aru_fit_view');
            if (['calendar', 'dashboard', 'plan', 'health', 'settings'].includes(savedView)) {
                this.state.view = savedView;
            }
            const savedMode = localStorage.getItem('aru_fit_cal_mode');
            if (savedMode === 'week' || savedMode === 'month') this.state.calendarMode = savedMode;
            const savedRange = Number(localStorage.getItem('aru_fit_dash_range'));
            if ([30, 90, 365].includes(savedRange)) this.state.dashRange = savedRange;
        }

        if (!this.state.selectedDate) this.state.selectedDate = this.todayKey();
        this.state.cursor = this.dateFromKey(this.state.selectedDate);
        this.loadAll();
        this.render();
        this._initialized = true;

        if (this.state.profile && !Number(this.state.profile.disclaimer_accepted)) {
            this.openDisclaimer();
        }
    },

    bindEvents() {
        const root = this._root;
        if (!root) return;
        if (!root._fitBound) {
            root._fitBound = true;
            root.addEventListener('click', (event) => {
                const el = event.target.closest('[data-fit-action]');
                if (!el || !root.contains(el)) return;
                if (el.disabled) return;
                event.preventDefault();
                this.handleAction(el.dataset.fitAction, el, event);
            });
            root.addEventListener('submit', (event) => {
                const form = event.target.closest('[data-fit-form]');
                if (!form) return;
                event.preventDefault();
                this.handleForm(form.dataset.fitForm, form);
            });
            root.addEventListener('keydown', (event) => {
                if (event.target && event.target.id === 'fit-chat-input') {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void this.sendChat();
                    }
                    return;
                }
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const tag = event.target && event.target.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
                const actionEl = event.target && event.target.closest ? event.target.closest('[role="button"][data-fit-action]') : null;
                if (!actionEl || !root.contains(actionEl) || actionEl.disabled) return;
                event.preventDefault();
                this.handleAction(actionEl.dataset.fitAction, actionEl, event);
            });
            root.addEventListener('input', (event) => {
                const el = event.target;
                if (!el) return;
                if (el.id === 'fit-chat-input') {
                    this.state.chatDraft = el.value;
                    el.style.height = 'auto';
                    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
                    return;
                }
                if (el.id === 'fit-day-note') {
                    const key = (el.dataset && el.dataset.date) || this.state.selectedDate || this.todayKey();
                    this.state.noteDrafts[key] = el.value;
                    return;
                }
                const mealForm = el.closest && el.closest('#fit-form-meal');
                if (mealForm) {
                    this.updateMealMacroPreview(mealForm);
                    return;
                }
                const workoutForm = el.closest && el.closest('#fit-form-workout');
                if (workoutForm) {
                    if (el.name === 'volume_kg') {
                        el.dataset.manual = el.value !== '' ? '1' : '0';
                    }
                    this.updateWorkoutLivePreview(workoutForm);
                }
            });
            root.addEventListener('change', (event) => {
                const el = event.target;
                const workoutForm = el && el.closest && el.closest('#fit-form-workout');
                if (workoutForm) this.updateWorkoutLivePreview(workoutForm);
            });
        }
        if (!this._langListenerBound) {
            this._langListenerBound = true;
            window.addEventListener('aru-lang-changed', () => {
                this.state.lang = this.currentLang();
                this.applyI18n();
                if (this._root) this.render();
            });
            window.addEventListener('aru-db-initialized', () => {
                this.state.noteDrafts = {};
                this.state.chatDraft = '';
                this.state.showPrivate = false;
                this._cycleStatsCache = null;
                this.state.selectedDate = this.todayKey();
                this.state.cursor = this.dateFromKey(this.state.selectedDate);
                if (this._root && window.DB && window.DB.db) {
                    this.loadAll();
                    this.render();
                }
            });
            window.addEventListener('aru-sync-applied', () => {
                if (this._root && window.DB && window.DB.db && !this.state.chatBusy) {
                    this.loadAll();
                    this.render();
                }
            });
            window.addEventListener('aru-user-mode-changed', () => {
                if (!this.isAdult()) this.state.showPrivate = false;
                if (this.isChild()) {
                    this.closeModal();
                    if (this._root) this._root.innerHTML = '';
                    return;
                }
                if (this._root && window.DB && window.DB.db) {
                    this.loadAll();
                    this.render();
                }
            });
        }
        if (!window._fitGlobalKeysBound) {
            window._fitGlobalKeysBound = true;
            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                const plugin = window.FitCarePlugin;
                if (!plugin || !plugin._root) return;
                const dialogHost = document.getElementById('aru-dialog-host');
                if (dialogHost && !dialogHost.classList.contains('hidden') && dialogHost.childElementCount > 0) return;
                const modal = document.getElementById('fit-modal');
                if (modal && !modal.classList.contains('hidden')) {
                    plugin.closeModal();
                }
            });
        }
    },

    currentLang() {
        let lang = 'en';
        if (window.aruState && window.aruState.lang) lang = window.aruState.lang;
        else if (document.documentElement.lang) lang = document.documentElement.lang;
        lang = String(lang).toLowerCase().split('-')[0];
        return lang === 'ru' || lang === 'kk' ? lang : 'en';
    },

    async loadI18n() {
        if (window._fitI18nData) {
            this.state.i18n = window._fitI18nData;
            return;
        }
        try {
            const res = await fetch('plugins/fit-care/fit-care-i18n.json');
            if (!res.ok) throw new Error(`i18n HTTP ${res.status}`);
            const data = await res.json();
            window._fitI18nData = data;
            this.state.i18n = data;
        } catch (error) {
            console.warn('FitCare: i18n load failed', error);
            this.state.i18n = { en: {} };
        }
    },

    t(key, vars) {
        const lang = this.state.lang || 'en';
        const dict = this.state.i18n[lang] || {};
        const fallback = this.state.i18n.en || {};
        let value = dict[key];
        if (value === undefined) value = fallback[key];
        if (value === undefined) value = key;
        return String(value).replace(/\{(\w+)\}/g, (match, name) => (
            vars && vars[name] !== undefined ? String(vars[name]) : match
        ));
    },

    applyI18n() {
        const root = this._root;
        if (!root) return;
        root.querySelectorAll('[data-fit-i18n]').forEach((el) => {
            el.textContent = this.t(el.dataset.fitI18n);
        });
        root.querySelectorAll('[data-fit-i18n-title]').forEach((el) => {
            el.title = this.t(el.dataset.fitI18nTitle);
        });
        const subtitle = root.querySelector('.fit-brand-copy p');
        if (subtitle) subtitle.textContent = this.t('subtitle');
        const quick = root.querySelector('.fit-quick-btn span');
        if (quick) quick.textContent = this.t('quick_log');
    },

    esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    // Model replies arrive as markdown; raw markdown is parsed first so blockquotes
    // and code blocks work, then strictly sanitized via DOMParser allowlists.
    renderChatMarkdown(text) {
        const raw = String(text === null || text === undefined ? '' : text);
        if (typeof marked === 'undefined' || typeof marked.parse !== 'function') return this.esc(raw);
        let html;
        try {
            html = marked.parse(raw, { gfm: true, breaks: true });
        } catch (error) {
            return this.esc(raw);
        }
        if (typeof DOMParser === 'undefined') return this.esc(raw);
        const ALLOWED_TAGS = new Set([
            'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'CODE', 'PRE',
            'BLOCKQUOTE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
            'HR', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SPAN', 'DIV'
        ]);
        let root;
        try {
            const doc = new DOMParser().parseFromString(`<div id="fit-md-root">${html}</div>`, 'text/html');
            root = doc.getElementById('fit-md-root');
            if (!root) return this.esc(raw);
            root.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select,link,meta,base,svg,math,img,video,audio,source,template,noscript').forEach((node) => node.remove());
            Array.from(root.querySelectorAll('*')).reverse().forEach((el) => {
                if (!ALLOWED_TAGS.has(String(el.tagName || '').toUpperCase())) {
                    const parent = el.parentNode;
                    if (parent) {
                        while (el.firstChild) parent.insertBefore(el.firstChild, el);
                        parent.removeChild(el);
                    }
                    return;
                }
                Array.from(el.attributes).forEach((attr) => {
                    if (!/^(href|title|colspan|rowspan)$/i.test(attr.name)) el.removeAttribute(attr.name);
                });
            });
            root.querySelectorAll('a[href]').forEach((link) => {
                const href = link.getAttribute('href').trim();
                if (/^(https?:|mailto:|#)/i.test(href)) {
                    link.setAttribute('target', '_blank');
                    link.setAttribute('rel', 'noopener noreferrer');
                } else {
                    link.removeAttribute('href');
                }
            });
        } catch (error) {
            return this.esc(raw);
        }
        return root.innerHTML;
    },

    isAdult() {
        const mode = (window.aruState && window.aruState.userSettings && window.aruState.userSettings.user_mode) || 'adult';
        return mode === 'adult';
    },

    isChild() {
        return this.getUserMode() === 'child';
    },

    // Cycle and intimacy stay invisible everywhere until the user turns them on
    // in Settings: the plugin is available to teens and to men, who do not need
    // a cycle, and not every user wants an intimacy journal at all.
    cycleEnabled() {
        return Number((this.state.profile || {}).cycle_tracking) === 1;
    },

    intimacyEnabled() {
        return this.isAdult() && Number((this.state.profile || {}).intimacy_tracking) === 1;
    },

    // ---------- dates ----------
    dateKey(date) {
        const d = date instanceof Date ? date : new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    todayKey() {
        return this.dateKey(new Date());
    },

    dateFromKey(key) {
        return new Date(`${key}T12:00:00`);
    },

    addDays(key, days) {
        const d = this.dateFromKey(key);
        d.setDate(d.getDate() + Number(days || 0));
        return this.dateKey(d);
    },

    diffDays(fromKey, toKey) {
        return Math.round((this.dateFromKey(toKey).getTime() - this.dateFromKey(fromKey).getTime()) / 86400000);
    },

    startOfWeek(dateOrKey) {
        const d = typeof dateOrKey === 'string' ? this.dateFromKey(dateOrKey) : new Date(dateOrKey);
        d.setHours(12, 0, 0, 0);
        const offset = (d.getDay() + 6) % 7;
        d.setDate(d.getDate() - offset);
        return d;
    },

    weekdayIndex(key) {
        return ((this.dateFromKey(key).getDay() + 6) % 7) + 1;
    },

    formatDate(key, options) {
        return this.dateFromKey(key).toLocaleDateString(this.state.lang, options || { weekday: 'long', day: 'numeric', month: 'long' });
    },

    formatShortDate(key, options) {
        return this.dateFromKey(key).toLocaleDateString(this.state.lang, options || { day: 'numeric', month: 'short' });
    },

    nowTime() {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    },

    timeToMinutes(value) {
        const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
        return match ? (Number(match[1]) * 60 + Number(match[2])) : null;
    },

    fmt(value, digits = 1) {
        if (value === null || value === undefined || value === '') return '—';
        const number = Number(value);
        if (!Number.isFinite(number)) return this.esc(value);
        return number.toLocaleString(this.state.lang, { maximumFractionDigits: digits });
    },

    round(value, digits = 1) {
        const factor = Math.pow(10, digits);
        return Math.round(Number(value) * factor) / factor;
    },

    splitList(value) {
        return String(value || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .filter((item, index, list) => list.indexOf(item) === index);
    },

    parseJson(value, fallback) {
        if (value && typeof value === 'object') return value;
        try {
            const parsed = JSON.parse(value || '');
            return parsed === null || parsed === undefined ? fallback : parsed;
        } catch (error) {
            return fallback;
        }
    },

    parseExercises(value) {
        if (window.FitCareEngine && typeof window.FitCareEngine.parseExercisesStructured === 'function') {
            return window.FitCareEngine.parseExercisesStructured(value);
        }
        const parsed = this.parseJson(value, []);
        return Array.isArray(parsed) ? parsed : [];
    },

    exerciseLabel(exercise) {
        if (!exercise) return '';
        if (window.FitCareEngine && typeof window.FitCareEngine.formatExercise === 'function') {
            return window.FitCareEngine.formatExercise(exercise, this.t('kg'));
        }
        if (typeof exercise === 'string') return exercise;
        const parts = [];
        if (exercise.name) parts.push(exercise.name);
        if (exercise.sets || exercise.reps) parts.push(`${exercise.sets || '?'}×${exercise.reps || '?'}`);
        if (exercise.weight !== undefined && exercise.weight !== null && exercise.weight !== '') parts.push(`${exercise.weight} ${this.t('kg')}`);
        return parts.join(' · ') || exercise.name || '';
    },

    getUserMode() {
        return (window.aruState && window.aruState.userSettings && window.aruState.userSettings.user_mode) || 'adult';
    },

    getDayNutrition(date) {
        const key = date || this.todayKey();
        if (window.DB && typeof window.DB.getFitDayNutrition === 'function') {
            return window.DB.getFitDayNutrition(key, this.getDaily(key), this.getMeals(key));
        }
        const meals = this.getMeals(key);
        const daily = this.getDaily(key) || {};
        const sumField = (f) => {
            const vals = meals.map(m => m[f]).filter(v => v !== null && v !== undefined && v !== '');
            if (vals.length) return vals.reduce((s, v) => s + (Number(v) || 0), 0);
            return daily[f] !== null && daily[f] !== undefined ? Number(daily[f]) : null;
        };
        return {
            date: key,
            calories: sumField('calories'),
            protein: sumField('protein'),
            carbs: sumField('carbs'),
            fat: sumField('fat'),
            mealCount: meals.length,
            hasEstimated: meals.some(m => Number(m.estimated) === 1),
            source: 'fallback'
        };
    },

    getLatestWeightKg() {
        if (window.DB && typeof window.DB.getFitLatestWeight === 'function') {
            const row = window.DB.getFitLatestWeight();
            if (row && row.weight !== null && row.weight !== undefined) return Number(row.weight);
        }
        const sorted = Array.from(this.state.dailyMap.values())
            .filter(l => l && l.weight !== null && l.weight !== undefined)
            .sort((a, b) => String(b.log_date).localeCompare(String(a.log_date)));
        return sorted.length ? Number(sorted[0].weight) : null;
    },

    getLatestBodyFatPct() {
        const logs = (window.DB && window.DB.db && typeof window.DB.getFitDailyLogs === 'function')
            ? (window.DB.getFitDailyLogs(this.addDays(this.todayKey(), -120), this.todayKey()) || [])
            : Array.from(this.state.dailyMap.values());
        const found = logs
            .filter(l => l && l.body_fat !== null && l.body_fat !== undefined)
            .sort((a, b) => String(b.log_date).localeCompare(String(a.log_date)))[0];
        return found ? Number(found.body_fat) : null;
    },

    getTargets(date) {
        if (!window.FitCareEngine || typeof window.FitCareEngine.computeTargets !== 'function') return null;
        const key = date || this.todayKey();
        const workoutMinutes = this.getWorkouts(key)
            .filter(w => w && w.status === 'done')
            .reduce((s, w) => s + (Number(w.duration_min) || 0), 0);
        return window.FitCareEngine.computeTargets(this.state.profile || {}, {
            latestWeight: this.getLatestWeightKg(),
            latestBodyFat: this.getLatestBodyFatPct(),
            ageMode: this.getUserMode(),
            todayKey: this.todayKey(),
            workoutMinutes
        });
    },

    quickAddWater(date, deltaMl = 250) {
        const key = date || this.state.selectedDate || this.todayKey();
        const existing = this.getDaily(key) || {};
        const nextWater = Math.max(0, Math.round((Number(existing.water_ml) || 0) + Number(deltaMl || 250)));
        window.DB.patchFitDailyLog(key, { water_ml: nextWater });
        this.refresh();
        this.toast(`${this.t('water_short')}: ${nextWater} ${this.t('unit_ml')}`, 'success');
    },

    groupByDate(rows) {
        const map = new Map();
        for (const row of rows || []) {
            const key = row.log_date || '';
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(row);
        }
        return map;
    },

    // ---------- data ----------
    getViewRange() {
        const today = this.todayKey();
        const selected = this.state.selectedDate || today;
        let from = today;
        let to = today;
        if (this.state.view === 'calendar') {
            if (this.state.calendarMode === 'week') {
                from = this.dateKey(this.startOfWeek(this.state.cursor));
                to = this.addDays(from, 6);
            } else {
                const cursor = this.state.cursor;
                const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
                from = this.dateKey(this.startOfWeek(first));
                to = this.addDays(from, 41);
            }
        } else if (this.state.view === 'dashboard') {
            from = this.addDays(today, -(this.state.dashRange - 1));
            to = today;
        } else if (this.state.view === 'plan') {
            from = this.addDays(today, -120);
            to = this.addDays(today, 21);
        } else if (this.state.view === 'health') {
            from = this.addDays(today, -120);
            to = this.addDays(today, 30);
        } else if (this.state.view === 'settings') {
            from = this.addDays(today, -7);
            to = today;
        }
        if (this.state.view === 'calendar') {
            if (selected < from) from = selected;
            if (selected > to) to = selected;
        }
        return { from, to };
    },

    loadAll() {
        const DB = window.DB;
        if (!DB || !DB.db) return;
        const range = this.getViewRange();
        this.state.range = range;
        const daily = DB.getFitDailyLogs(range.from, range.to) || [];
        const workouts = DB.getFitWorkouts(range.from, range.to) || [];
        const meals = DB.getFitMeals(range.from, range.to) || [];
        const health = DB.getFitHealthLogs(range.from, range.to) || [];
        const profile = DB.getFitProfile();
        this.state.profile = profile;
        const cycleOn = Number(profile.cycle_tracking) === 1;
        const cycleLogs = cycleOn ? (DB.getFitCycleLogs(range.from, range.to) || []) : [];
        const intimacy = (this.isAdult() && Number(profile.intimacy_tracking) === 1)
            ? (DB.getFitIntimacyLogs(range.from, range.to) || [])
            : [];
        this.state.dailyMap = new Map(daily.map((row) => [row.log_date, row]));
        this.state.workoutsByDate = this.groupByDate(workouts);
        this.state.mealsByDate = this.groupByDate(meals);
        this.state.healthByDate = this.groupByDate(health);
        this.state.cycleLogByDate = new Map(cycleLogs.map((row) => [row.log_date, row]));
        this.state.intimacyByDate = this.groupByDate(intimacy);
        this.state.plans = DB.getFitPlans();
        this.state.activePlan = this.state.plans.find((plan) => plan.status === 'active') || null;
        this.state.planDays = this.state.activePlan ? (DB.getFitPlanDays(this.state.activePlan.id) || []) : [];
        this.state.protocols = DB.getFitProtocols();
        this.state.cycles = cycleOn ? DB.getFitCycles() : [];
        this._cycleStatsCache = null;
    },

    refresh() {
        if (!this._root || !(window.DB && window.DB.db)) return;
        this.loadAll();
        this.render();
    },

    getDaily(date) {
        return this.state.dailyMap.get(date) || null;
    },

    getWorkouts(date) {
        return this.state.workoutsByDate.get(date) || [];
    },

    getMeals(date) {
        return this.state.mealsByDate.get(date) || [];
    },

    getHealthLogs(date) {
        return this.state.healthByDate.get(date) || [];
    },

    getCycleLog(date) {
        return this.state.cycleLogByDate.get(date) || null;
    },

    getIntimacy(date) {
        return this.intimacyEnabled() ? (this.state.intimacyByDate.get(date) || []) : [];
    },

    getActivePlan() {
        return this.state.activePlan;
    },

    // Plan weeks follow the calendar (Mon–Sun), not rolling 7-day blocks from the
    // start date: week cards are labelled Mon…Sun, so a Wednesday start must not
    // shift "Monday" onto Thursday. Days before start_date belong to week 1 but
    // are not part of the plan.
    planWeekStartKey(plan) {
        return plan && plan.start_date ? this.dateKey(this.startOfWeek(plan.start_date)) : '';
    },

    planSpan(plan) {
        if (!plan || !plan.start_date) return null;
        const weekStart = this.planWeekStartKey(plan);
        const totalWeeks = Math.max(1, Number(plan.weeks) || 1);
        const end = this.addDays(weekStart, totalWeeks * 7 - 1);
        return { weekStart, end, totalWeeks };
    },

    getPlanSessionForDate(date) {
        const plan = this.getActivePlan();
        const span = plan ? this.planSpan(plan) : null;
        if (!span) return null;
        if (date < plan.start_date || date > span.end) return null;
        const week = Math.floor(this.diffDays(span.weekStart, date) / 7) + 1;
        const weekday = this.weekdayIndex(date);
        const days = (this.state.planDays || []).filter((day) => Number(day.plan_id) === Number(plan.id));
        const exact = days.find((day) => Number(day.week_index) === week && Number(day.weekday) === weekday);
        const template = days.find((day) => Number(day.week_index) === 0 && Number(day.weekday) === weekday);
        const day = exact || template || null;
        if (!day) return null;
        const isRest = !day.title && !day.focus && !this.parseExercises(day.exercises).length;
        return { plan, week, weekday, day, isRest, fromTemplate: !exact };
    },

    getActivePlanProgress() {
        const plan = this.getActivePlan();
        const span = plan ? this.planSpan(plan) : null;
        if (!span) return null;
        const today = this.todayKey();
        const totalDays = Math.max(1, this.diffDays(plan.start_date, span.end) + 1);
        const elapsed = Math.min(Math.max(this.diffDays(plan.start_date, today) + 1, 0), totalDays);
        const sessionsPerWeek = (this.state.planDays || []).filter((day) => (
            Number(day.plan_id) === Number(plan.id) &&
            Number(day.week_index) === 0 &&
            (day.title || day.focus || this.parseExercises(day.exercises).length)
        )).length;
        return {
            plan,
            elapsedDays: elapsed,
            totalDays,
            percent: totalDays ? Math.round((elapsed / totalDays) * 100) : 0,
            currentWeek: Math.min(Math.max(Math.floor(this.diffDays(span.weekStart, today) / 7) + 1, 1), Number(plan.weeks || 1)),
            inPlan: today >= plan.start_date && today <= span.end,
            beforeStart: today < plan.start_date,
            finished: today > span.end,
            sessionsPerWeek,
            weekStart: span.weekStart,
            end: span.end
        };
    },

    // ---------- cycle engine ----------
    // The maths lives in DB.getFitCycleStats/getFitCycleInfo; this wrapper only
    // caches the stats for one render pass so a 42-cell month does not recompute them.
    cycleStats() {
        if (!this._cycleStatsCache) {
            this._cycleStatsCache = (window.DB && typeof window.DB.getFitCycleStats === 'function')
                ? window.DB.getFitCycleStats()
                : { tracking: false, cycles: [], lengths: [], avg: 28, confidence: 'none' };
        }
        return this._cycleStatsCache;
    },

    averageCycleLength() {
        return this.cycleStats().avg;
    },

    getCycleInfo(date) {
        const info = (window.DB && typeof window.DB.getFitCycleInfo === 'function')
            ? window.DB.getFitCycleInfo(date || this.todayKey(), this.cycleStats())
            : null;
        return info || { tracking: false, hasData: false, phase: '', day: null };
    },

    getDosesForDate(date) {
        const weekday = this.weekdayIndex(date);
        const logs = this.getHealthLogs(date).filter((log) => log.type === 'medication');
        const keyOf = (entry) => (entry && entry.id !== undefined && entry.id !== null ? entry.id : entry);
        const usedLogKeys = new Set();
        const protocolById = new Map((this.state.protocols || []).map((p) => [Number(p.id), p]));
        const doses = [];
        for (const protocol of this.state.protocols || []) {
            if (!Number(protocol.active)) continue;
            const schedule = this.parseJson(protocol.schedule, {});
            const days = Array.isArray(schedule.days) ? schedule.days.map(Number) : [];
            if (days.length && !days.includes(weekday)) continue;
            const times = Array.isArray(schedule.times) ? schedule.times.map((time) => String(time).trim()).filter(Boolean) : [];
            const protocolLogs = logs.filter((log) => Number(log.protocol_id) === Number(protocol.id));
            if (!times.length) {
                const log = protocolLogs.find((entry) => !usedLogKeys.has(keyOf(entry))) || null;
                if (log) usedLogKeys.add(keyOf(log));
                doses.push({ protocol, time: log ? (log.log_time || '') : '', log, status: log ? log.status : '' });
                continue;
            }
            const matchedByIndex = new Array(times.length).fill(null);
            for (let i = 0; i < times.length; i++) {
                const exact = protocolLogs.find((entry) => !usedLogKeys.has(keyOf(entry)) && entry.log_time === times[i]);
                if (exact) {
                    usedLogKeys.add(keyOf(exact));
                    matchedByIndex[i] = exact;
                }
            }
            for (let i = 0; i < times.length; i++) {
                if (matchedByIndex[i]) continue;
                const schedMin = this.timeToMinutes(times[i]);
                if (schedMin === null) continue;
                let best = null;
                let bestDiff = 181;
                for (const entry of protocolLogs) {
                    if (usedLogKeys.has(keyOf(entry))) continue;
                    const entryMin = this.timeToMinutes(entry.log_time);
                    if (entryMin === null) continue;
                    const diff = Math.abs(entryMin - schedMin);
                    if (diff < bestDiff) {
                        bestDiff = diff;
                        best = entry;
                    }
                }
                if (best) {
                    usedLogKeys.add(keyOf(best));
                    matchedByIndex[i] = best;
                }
            }
            for (let i = 0; i < times.length; i++) {
                const log = matchedByIndex[i];
                doses.push({ protocol, time: times[i], log, status: log ? log.status : '' });
            }
        }
        for (const log of logs) {
            if (usedLogKeys.has(keyOf(log))) continue;
            const found = log.protocol_id ? protocolById.get(Number(log.protocol_id)) : null;
            const protocol = found || { id: Number(log.protocol_id) || 0, name: log.name || this.t('med_protocol'), dosage: '' };
            doses.push({ protocol, time: log.log_time || '', log, status: log.status || 'taken', extra: true });
        }
        return doses.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    },

    getDayAlerts(date) {
        const alerts = [];
        for (const meal of this.getMeals(date)) {
            let conflicts = [];
            try {
                conflicts = window.DB.getFitMealConflicts(meal) || [];
            } catch (error) {
                conflicts = [];
            }
            for (const conflict of conflicts) {
                alerts.push({ type: 'warn', icon: 'triangle-alert', text: this.conflictText(conflict) });
            }
        }
        if (date === this.todayKey()) {
            const now = this.nowTime();
            const missed = this.getDosesForDate(date).filter((dose) => (
                dose.time && dose.time < now && dose.status !== 'taken' && dose.status !== 'skipped'
            ));
            for (const dose of missed.slice(0, 3)) {
                alerts.push({
                    type: 'warn',
                    icon: 'pill',
                    text: this.t('missed_dose', { name: dose.protocol.name, time: dose.time })
                });
            }
            if (missed.length > 3) {
                alerts.push({ type: 'warn', icon: 'pill', text: this.t('missed_doses', { n: missed.length }) });
            }
        }
        const seen = new Set();
        return alerts.filter((alert) => {
            if (seen.has(alert.text)) return false;
            seen.add(alert.text);
            return true;
        });
    },

    conflictText(conflict) {
        if (!conflict) return '';
        if (conflict.kind === 'delay') {
            return this.t('conflict_delay', {
                name: conflict.protocol,
                meal_time: conflict.meal_time,
                need: conflict.required,
                dose_time: conflict.dose_time
            });
        }
        return this.t('conflict_tag', {
            name: conflict.protocol,
            tag: conflict.tag,
            dose_time: conflict.dose_time || '—'
        });
    },

    // ---------- rendering shell ----------
    setView(view) {
        if (!['calendar', 'dashboard', 'plan', 'health', 'settings'].includes(view)) return;
        this.closeModal();
        this.state.view = view;
        localStorage.setItem('aru_fit_view', view);
        if (view === 'calendar') this.state.cursor = this.dateFromKey(this.state.selectedDate || this.todayKey());
        this.loadAll();
        this.render();
        const container = document.getElementById('fit-view');
        if (container) container.scrollTop = 0;
    },

    render() {
        if (this.isChild()) return;
        const container = document.getElementById('fit-view');
        if (!container) return;
        this.syncNav();
        const renderers = {
            calendar: 'renderCalendarView',
            dashboard: 'renderDashboard',
            plan: 'renderPlan',
            health: 'renderHealth',
            settings: 'renderSettings'
        };
        const method = renderers[this.state.view] ? this[renderers[this.state.view]] : this.renderCalendarView;
        if (typeof method !== 'function') {
            container.innerHTML = `<div class="fit-page"><div class="fit-empty"><strong>Fit &amp; Care</strong><span>${this.esc(this.t('loading_section'))}</span></div></div>`;
            return;
        }
        try {
            method.call(this);
        } catch (error) {
            console.error('FitCare: render failed', error);
            container.innerHTML = `<div class="fit-page"><div class="fit-empty"><i data-lucide="circle-alert"></i><strong>${this.esc(this.t('toast_error'))}</strong><span>${this.esc(error.message || '')}</span></div></div>`;
        }
        if (window.lucide) window.lucide.createIcons();
    },

    syncNav() {
        const root = this._root;
        if (!root) return;
        root.querySelectorAll('.fit-nav-btn').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.view === this.state.view);
        });
    },

    // ---------- actions ----------
    handleAction(action, el) {
        if (this.isChild() || !action) return;
        const date = el.dataset.date || this.state.selectedDate || this.todayKey();
        switch (action) {
            case 'view':
                this.setView(el.dataset.view);
                return;
            case 'quick-log':
                this.openQuickLog(date);
                return;
            case 'close-modal':
            case 'modal-cancel':
                this.closeModal();
                return;
            case 'submit-form': {
                const form = document.getElementById(el.dataset.form || '');
                if (form) form.requestSubmit();
                return;
            }
            case 'confirm-yes': {
                const callback = this._confirmCallback;
                this._confirmCallback = null;
                this.closeModal();
                if (typeof callback === 'function') {
                    try { callback(); } catch (error) { console.error('FitCare: confirm failed', error); this.toast(this.t('toast_error'), 'error'); }
                }
                return;
            }
            case 'accept-disclaimer':
                window.DB.saveFitProfile({ disclaimer_accepted: 1 });
                this.state.profile = window.DB.getFitProfile();
                this.closeModal();
                this.toast(this.t('disclaimer_ok'), 'success');
                this.render();
                return;
            case 'add-meal':
                this.openMealModal(date);
                return;
            case 'add-workout':
                this.openWorkoutModal(date);
                return;
            case 'add-metrics':
                this.openMetricsModal(date);
                return;
            case 'add-med':
                this.openMedModal(date);
                return;
            case 'add-health':
                this.openHealthModal(date);
                return;
            case 'add-note':
                this.openDayPanel(date, 'day');
                setTimeout(() => {
                    const note = document.getElementById('fit-day-note');
                    if (note) note.focus();
                }, 80);
                return;
            case 'add-cycle':
                this.openCycleModal(date);
                return;
            case 'add-intimacy':
                this.openIntimacyModal(date);
                return;
            case 'edit-intimacy': {
                const entry = this.findIntimacyEntry(el.dataset.id);
                if (entry) this.openIntimacyModal(entry.log_date, entry);
                return;
            }
            case 'save-note': {
                const note = document.getElementById('fit-day-note');
                if (note) this.saveDayNote(date, note.value);
                return;
            }
            case 'delete-meal':
                this.confirmDelete(() => window.DB.deleteFitMeal(el.dataset.id));
                return;
            case 'delete-workout':
                this.confirmDelete(() => window.DB.deleteFitWorkout(el.dataset.id));
                return;
            case 'delete-health':
                this.confirmDelete(() => window.DB.deleteFitHealthLog(el.dataset.id));
                return;
            case 'delete-cycle-log':
                this.confirmDelete(() => window.DB.deleteFitCycleLog(date));
                return;
            case 'mark-dose':
                this.toggleDose(date, el.dataset);
                return;
            case 'cycle-start':
                this.requestCycleStart(date);
                return;
            case 'cycle-start-move':
                this.applyCycleStartMove(date, el.dataset.id);
                return;
            case 'cycle-end':
                this.requestCycleEnd(date);
                return;
            case 'cycle-end-confirm':
                this.applyCycleEnd(date, el.dataset.id);
                return;
            case 'enable-cycle':
                window.DB.saveFitProfile({ cycle_tracking: 1 });
                this.closeModal();
                this.refresh();
                this.toast(this.t('toast_saved'), 'success');
                return;
            case 'chat-send':
                this.sendChat();
                return;
            case 'chat-clear':
                this.confirmDelete(() => {
                    window.DB.clearFitChatMessages(date);
                    this.render();
                }, this.t('chat_clear'));
                return;
            case 'quick-water':
                this.quickAddWater(date, Number(el.dataset.ml) || 250);
                return;
            case 'meal-apply-kcal': {
                const form = document.getElementById('fit-form-meal');
                const input = form && form.elements.namedItem('calories');
                if (input && el.dataset.kcal !== undefined) {
                    input.value = String(el.dataset.kcal);
                    this.updateMealMacroPreview(form);
                }
                return;
            }
            case 'workout-add-ex': {
                const rows = document.getElementById('fit-workout-ex-rows');
                if (rows) {
                    rows.insertAdjacentHTML('beforeend', this.workoutExerciseRow({}));
                    if (window.lucide) window.lucide.createIcons();
                    const last = rows.lastElementChild;
                    const inp = last && last.querySelector('input');
                    if (inp) inp.focus();
                    this.updateWorkoutLivePreview(document.getElementById('fit-form-workout'));
                }
                return;
            }
            case 'workout-remove-ex': {
                const row = el.closest('.fit-exercise-row');
                const form = document.getElementById('fit-form-workout');
                if (row) row.remove();
                if (form) this.updateWorkoutLivePreview(form);
                return;
            }
            case 'chat-toggle-wide':
                this.state.chatWide = !this.state.chatWide;
                this.updateDayPanel();
                return;
            case 'chat-chip': {
                const prompt = el.dataset.prompt || '';
                if (prompt) void this.sendChat(prompt);
                return;
            }
            case 'chat-copy': {
                const msgId = Number(el.dataset.id);
                const msg = this.getChatMessages(date).find((m) => Number(m.id) === msgId);
                const textToCopy = msg ? String(msg.content || '') : '';
                if (textToCopy && navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(textToCopy)
                        .then(() => this.toast(this.t('chat_copied'), 'success'))
                        .catch(() => {});
                }
                return;
            }
            case 'chat-open-day':
                this.state.dayTab = 'day';
                this.updateDayPanel();
                return;
            case 'health-cycle-edit': {
                const id = Number(el.dataset.id);
                const cycle = (this.state.cycles || []).find((c) => Number(c.id) === id)
                    || (window.DB && window.DB.getFitCycle ? window.DB.getFitCycle(id) : null);
                if (cycle) this.openEditCycleModal(cycle);
                return;
            }
        }

        if (this.handleCalendarAction && this.handleCalendarAction(action, el)) return;
        if (this.handlePagerAction && this.handlePagerAction(action, el)) return;
        if (this.handleDashboardAction && this.handleDashboardAction(action, el)) return;
        if (this.handlePlanAction && this.handlePlanAction(action, el)) return;
        if (this.handleHealthAction && this.handleHealthAction(action, el)) return;
        if (this.handleSettingsAction && this.handleSettingsAction(action, el)) return;
        console.warn('FitCare: unhandled action', action);
    },

    toggleDose(date, data) {
        const taken = data.taken === '1' || data.taken === 'true';
        const markingTaken = !(taken && data.logId);
        if (taken && data.logId) {
            window.DB.deleteFitHealthLog(data.logId);
        } else if (data.logId) {
            window.DB.saveFitHealthLog({ id: data.logId, log_date: date, log_time: data.time || '', protocol_id: Number(data.protocol), type: 'medication', name: data.name || '', status: 'taken' });
        } else {
            window.DB.saveFitHealthLog({ log_date: date, log_time: data.time || '', protocol_id: Number(data.protocol), type: 'medication', name: data.name || '', status: 'taken' });
        }
        this.refresh();
        if (markingTaken && window.DB && typeof window.DB.getFitMealConflicts === 'function') {
            for (const meal of this.getMeals(date)) {
                let conflicts = [];
                try { conflicts = window.DB.getFitMealConflicts(meal) || []; } catch (error) { conflicts = []; }
                if (conflicts.length) {
                    this.toast(this.t('conflict_med_toast'), 'warn');
                    break;
                }
            }
        }
    },

    confirmDelete(callback, title) {
        this.openConfirm(
            title || this.t('modal_confirm'),
            this.t('delete_confirm_text'),
            () => { callback(); this.refresh(); this.toast(this.t('toast_deleted'), 'success'); }
        );
    },

    // ---------- shared pager ----------
    renderPager(stateKey, total, perPage) {
        const pages = Math.ceil(total / perPage);
        if (pages <= 1) {
            this.state[stateKey] = 0;
            return '';
        }
        const page = Math.min(Math.max(0, Number(this.state[stateKey]) || 0), pages - 1);
        this.state[stateKey] = page;
        const from = page * perPage + 1;
        const to = Math.min(total, from + perPage - 1);
        return `
            <div class="fit-pager">
                <button type="button" class="fit-btn-icon" data-fit-action="fit-page" data-key="${stateKey}" data-dir="-1" ${page === 0 ? 'disabled' : ''} aria-label="${this.esc(this.t('cal_prev'))}"><i data-lucide="chevron-left"></i></button>
                <span class="fit-muted" style="font-size:.66rem">${from}–${to} · ${total}</span>
                <button type="button" class="fit-btn-icon" data-fit-action="fit-page" data-key="${stateKey}" data-dir="1" ${page >= pages - 1 ? 'disabled' : ''} aria-label="${this.esc(this.t('cal_next'))}"><i data-lucide="chevron-right"></i></button>
            </div>
        `;
    },

    pageSlice(stateKey, items, perPage) {
        const pages = Math.max(1, Math.ceil(items.length / perPage));
        const page = Math.min(Math.max(0, Number(this.state[stateKey]) || 0), pages - 1);
        this.state[stateKey] = page;
        return items.slice(page * perPage, page * perPage + perPage);
    },

    handlePagerAction(action, el) {
        if (action !== 'fit-page') return false;
        const key = el.dataset.key;
        if (!(key in this.state)) return false;
        this.state[key] = Math.max(0, Number(this.state[key]) || 0) + Number(el.dataset.dir || 0);
        this.render();
        return true;
    },

    // ---------- modal helpers ----------
    openModal(options) {
        const opts = options || {};
        const modal = document.getElementById('fit-modal');
        const card = document.getElementById('fit-modal-card');
        if (!modal || !card) return;
        card.classList.toggle('is-wide', !!opts.wide);
        card.innerHTML = `
            <header class="fit-modal-head">
                <div>
                    <h2 id="fit-modal-title">${this.esc(opts.title || '')}</h2>
                    ${opts.subtitle ? `<p>${this.esc(opts.subtitle)}</p>` : ''}
                </div>
                <button type="button" class="fit-btn-icon" data-fit-action="close-modal" aria-label="${this.esc(this.t('close'))}">
                    <i data-lucide="x"></i>
                </button>
            </header>
            <div class="fit-modal-body">${opts.body || ''}</div>
            ${opts.footer ? `<footer class="fit-modal-foot">${opts.footer}</footer>` : ''}
        `;
        modal.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
        if (window.innerWidth > 760) {
            setTimeout(() => {
                const first = card.querySelector('.fit-modal-body input:not([type="hidden"]), .fit-modal-body select, .fit-modal-body textarea');
                if (first) first.focus({ preventScroll: true });
            }, 40);
        }
    },

    closeModal() {
        const modal = document.getElementById('fit-modal');
        const card = document.getElementById('fit-modal-card');
        if (modal) modal.classList.add('hidden');
        if (card) card.innerHTML = '';
        this._confirmCallback = null;
    },

    openConfirm(title, message, onConfirm) {
        this._confirmCallback = onConfirm;
        this.openModal({
            title,
            body: `<p class="fit-muted" style="margin:0;font-size:.8rem;line-height:1.55">${this.esc(message)}</p>`,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-danger" data-fit-action="confirm-yes">${this.esc(this.t('confirm_delete'))}</button>
            `
        });
    },

    openDisclaimer() {
        this.openModal({
            title: this.t('disclaimer_section'),
            subtitle: 'Aru Fit & Care',
            body: `
                <p style="margin:0;color:var(--fit-subtle);font-size:.8rem;line-height:1.6">${this.esc(this.t('disclaimer_text'))}</p>
                <div class="fit-privacy-note"><i data-lucide="shield-check"></i><span>${this.esc(this.t('privacy_local'))}</span></div>
            `,
            footer: `<button type="button" class="fit-btn fit-btn-primary" data-fit-action="accept-disclaimer">${this.esc(this.t('accept_disclaimer'))}</button>`
        });
    },

    toast(message, type) {
        const root = this._root;
        if (!root || !message) return;
        let wrap = root.querySelector('.fit-toast-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'fit-toast-wrap';
            root.appendChild(wrap);
        }
        const el = document.createElement('div');
        el.className = `fit-toast ${type || ''}`;
        const icon = type === 'error' ? 'circle-alert' : type === 'success' ? 'circle-check' : 'info';
        el.innerHTML = `<i data-lucide="${icon}"></i><span>${this.esc(message)}</span>`;
        wrap.appendChild(el);
        if (window.lucide) window.lucide.createIcons();
        setTimeout(() => {
            el.style.transition = 'opacity .2s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 220);
        }, 3400);
    },

    // ---------- quick log ----------
    openQuickLog(date) {
        const day = date || this.state.selectedDate || this.todayKey();
        const tiles = [
            { action: 'add-meal', icon: 'utensils', title: 'quick_meal', sub: 'quick_meal_sub' },
            { action: 'add-workout', icon: 'dumbbell', title: 'quick_workout', sub: 'quick_workout_sub' },
            { action: 'add-metrics', icon: 'scale', title: 'quick_metrics', sub: 'quick_metrics_sub' },
            { action: 'add-med', icon: 'pill', title: 'quick_med', sub: 'quick_med_sub' },
            { action: 'add-health', icon: 'heart-pulse', title: 'quick_health', sub: 'quick_health_sub' },
            { action: 'add-note', icon: 'notebook-pen', title: 'quick_note', sub: 'quick_note_sub' }
        ];
        if (this.cycleEnabled()) {
            tiles.push({ action: 'add-cycle', icon: 'droplet', title: 'quick_cycle', sub: 'quick_cycle_sub' });
        }
        if (this.intimacyEnabled()) {
            tiles.push({ action: 'add-intimacy', icon: 'lock', title: 'intimacy_title', sub: 'intimacy_short' });
        }
        const body = `
            <p class="fit-muted" style="margin:0;font-size:.74rem">${this.esc(this.t('quick_sub'))}</p>
            <div class="fit-quick-grid">
                ${tiles.map((tile) => `
                    <button type="button" class="fit-quick-tile" data-fit-action="${tile.action}" data-date="${day}">
                        <span class="fit-quick-tile-icon"><i data-lucide="${tile.icon}"></i></span>
                        <span><b>${this.esc(this.t(tile.title))}</b><small>${this.esc(this.t(tile.sub))}</small></span>
                    </button>
                `).join('')}
            </div>
        `;
        this.openModal({
            title: this.t('quick_title'),
            subtitle: this.t('modal_quick_sub', { date: this.formatShortDate(day) }),
            body
        });
    },

    // ---------- forms ----------
    fieldValue(form, name) {
        const el = form.elements.namedItem(name);
        return el ? String(el.value || '').trim() : '';
    },

    fieldNumber(form, name) {
        const raw = this.fieldValue(form, name);
        if (raw === '') return null;
        const value = Number(raw.replace(',', '.'));
        return Number.isFinite(value) ? value : null;
    },

    handleForm(name, form) {
        if (this.isChild()) return;
        switch (name) {
            case 'meal': this.saveMeal(form); return;
            case 'workout': this.saveWorkout(form); return;
            case 'metrics': this.saveMetrics(form); return;
            case 'med': this.saveMed(form); return;
            case 'health': this.saveHealth(form); return;
            case 'cycle': this.saveCycleLog(form); return;
            case 'cycle-edit': this.saveCycleEdit(form); return;
            case 'intimacy': this.saveIntimacy(form); return;
        }
        if (this.handlePlanForm && this.handlePlanForm(name, form)) return;
        if (this.handleHealthForm && this.handleHealthForm(name, form)) return;
        if (this.handleSettingsForm && this.handleSettingsForm(name, form)) return;
        console.warn('FitCare: unhandled form', name);
    },

    openMealModal(date, meal) {
        const existing = meal || null;
        const estimated = existing && Number(existing.estimated) ? 1 : 0;
        const body = `
            <form id="fit-form-meal" data-fit-form="meal" data-date="${date}" data-id="${existing ? existing.id : ''}" class="fit-form-grid">
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('meal_title'))}</span>
                    <input class="fit-input" name="title" required maxlength="160" value="${this.esc(existing ? existing.title : '')}" placeholder="${this.esc(this.t('meal_title_placeholder'))}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('time'))}</span>
                    <input class="fit-input" name="meal_time" type="time" value="${this.esc(existing && existing.meal_time ? existing.meal_time : this.nowTime())}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('tags'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <input class="fit-input" name="tags" value="${this.esc(existing ? this.parseJson(existing.tags, []).join(', ') : '')}" placeholder="${this.esc(this.t('meal_tags_hint'))}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('calories'))}</span>
                    <input class="fit-input" name="calories" type="number" min="0" step="1" value="${this.esc(existing && existing.calories !== null ? existing.calories : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('protein'))}, ${this.esc(this.t('g'))}</span>
                    <input class="fit-input" name="protein" type="number" min="0" step="0.1" value="${this.esc(existing && existing.protein !== null ? existing.protein : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('carbs'))}, ${this.esc(this.t('g'))}</span>
                    <input class="fit-input" name="carbs" type="number" min="0" step="0.1" value="${this.esc(existing && existing.carbs !== null ? existing.carbs : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('fat'))}, ${this.esc(this.t('g'))}</span>
                    <input class="fit-input" name="fat" type="number" min="0" step="0.1" value="${this.esc(existing && existing.fat !== null ? existing.fat : '')}">
                </label>
                <div id="fit-meal-macro-hint" class="fit-macro-hint fit-span-2 fit-hidden"></div>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('note'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <textarea class="fit-textarea" name="note" rows="2">${this.esc(existing ? existing.note : '')}</textarea>
                </label>
                <div class="fit-switch-row fit-span-2">
                    <div>
                        <b>~ ${this.esc(this.t('estimated'))}</b>
                        <small>${this.esc(this.t('estimated_hint'))}</small>
                    </div>
                    <input type="hidden" name="estimated" value="${estimated}">
                    <button type="button" class="fit-switch ${estimated ? 'is-on' : ''}"
                        data-fit-action="settings-switch" data-target="estimated"
                        aria-pressed="${estimated ? 'true' : 'false'}"
                        aria-label="${this.esc(this.t('estimated'))}"></button>
                </div>
            </form>
        `;
        this.openModal({
            title: existing ? this.t('modal_meal') : this.t('quick_meal'),
            subtitle: this.formatDate(date, { day: 'numeric', month: 'long' }),
            body,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="submit-form" data-form="fit-form-meal">${this.esc(this.t('save_meal'))}</button>
            `
        });
        this.updateMealMacroPreview(document.getElementById('fit-form-meal'));
    },

    updateMealMacroPreview(form) {
        const box = document.getElementById('fit-meal-macro-hint');
        if (!form || !box || !window.FitCareEngine) return;
        const cal = this.fieldNumber(form, 'calories');
        const protein = this.fieldNumber(form, 'protein');
        const carbs = this.fieldNumber(form, 'carbs');
        const fat = this.fieldNumber(form, 'fat');
        const check = window.FitCareEngine.validateMealMacros({ calories: cal, protein, carbs, fat });
        if (!check.hasMacros) {
            box.classList.add('fit-hidden');
            box.innerHTML = '';
            return;
        }
        box.classList.remove('fit-hidden', 'is-warn');
        if (check.mismatch) box.classList.add('is-warn');
        const label = check.mismatch
            ? this.t('meal_macro_diff', { kcal: check.fromMacros, pct: check.deviationPct })
            : this.t('meal_macro_check', { kcal: check.fromMacros });
        const canApply = cal === null || check.mismatch;
        box.innerHTML = `
            <span>${this.esc(label)}</span>
            ${canApply ? `<button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="meal-apply-kcal" data-kcal="${check.fromMacros}">${this.esc(this.t('meal_apply_kcal'))}</button>` : ''}
        `;
    },

    saveMeal(form) {
        const date = form.dataset.date;
        const id = Number(form.dataset.id) || null;
        const tags = this.splitList(this.fieldValue(form, 'tags'));
        let calories = this.fieldNumber(form, 'calories');
        const protein = this.fieldNumber(form, 'protein');
        const carbs = this.fieldNumber(form, 'carbs');
        const fat = this.fieldNumber(form, 'fat');
        if (calories === null && window.FitCareEngine) {
            const v = window.FitCareEngine.validateMealMacros({ calories, protein, carbs, fat });
            if (v.hasMacros && v.fromMacros > 0) calories = v.fromMacros;
        }
        const meal = {
            id,
            log_date: date,
            meal_time: this.fieldValue(form, 'meal_time'),
            title: this.fieldValue(form, 'title'),
            tags,
            calories,
            protein,
            carbs,
            fat,
            estimated: this.fieldValue(form, 'estimated') === '1' ? 1 : 0,
            note: this.fieldValue(form, 'note')
        };
        if (!meal.title) return;
        window.DB.saveFitMeal(meal);
        let conflicts = [];
        try { conflicts = window.DB.getFitMealConflicts(meal) || []; } catch (error) { conflicts = []; }
        this.closeModal();
        this.refresh();
        if (conflicts.length) this.toast(this.conflictText(conflicts[0]), 'error');
        else this.toast(this.t('toast_saved'), 'success');
    },

    workoutExerciseRow(exercise) {
        const item = exercise || {};
        return `
            <div class="fit-exercise-row">
                <input name="wx_name" maxlength="120" value="${this.esc(item.name || '')}" placeholder="${this.esc(this.t('plan_exercises'))}">
                <input name="wx_sets" type="number" min="0" step="1" value="${this.esc(item.sets ?? '')}" placeholder="${this.esc(this.t('plan_sets'))}">
                <input name="wx_reps" type="text" maxlength="24" value="${this.esc(item.reps ?? '')}" placeholder="${this.esc(this.t('plan_reps'))}">
                <input name="wx_weight" class="fit-ex-weight" type="number" min="0" step="0.5" value="${this.esc(item.weight ?? '')}" placeholder="${this.esc(this.t('plan_weight'))}">
                <button type="button" class="fit-btn-icon" data-fit-action="workout-remove-ex" aria-label="${this.esc(this.t('delete'))}"><i data-lucide="x"></i></button>
            </div>
        `;
    },

    collectWorkoutExercises(form) {
        if (!form) return [];
        const rows = form.querySelectorAll('#fit-workout-ex-rows .fit-exercise-row');
        const exercises = [];
        rows.forEach((row) => {
            const nameInput = row.querySelector('[name="wx_name"]');
            const name = nameInput ? String(nameInput.value || '').trim() : '';
            if (!name) return;
            const num = (sel) => {
                const inp = row.querySelector(sel);
                return inp && inp.value !== '' ? Number(String(inp.value).replace(',', '.')) : null;
            };
            const repsInput = row.querySelector('[name="wx_reps"]');
            const repsRaw = repsInput ? String(repsInput.value || '').trim() : '';
            const reps = !repsRaw ? null : (/^\d+$/.test(repsRaw) ? Number(repsRaw) : repsRaw);
            exercises.push({
                name,
                sets: num('[name="wx_sets"]'),
                reps,
                weight: num('[name="wx_weight"]')
            });
        });
        return exercises;
    },

    updateWorkoutLivePreview(form) {
        const box = document.getElementById('fit-workout-live-preview');
        if (!form || !box || !window.FitCareEngine) return;
        const exercises = this.collectWorkoutExercises(form);
        const autoVol = window.FitCareEngine.calcWorkoutVolume(exercises);
        const volInput = form.elements.namedItem('volume_kg');
        if (volInput && volInput.dataset.manual !== '1') {
            volInput.value = autoVol !== null ? String(autoVol) : '';
        }
        const duration = this.fieldNumber(form, 'duration_min');
        const rpe = this.fieldNumber(form, 'rpe');
        const title = this.fieldValue(form, 'title');
        const note = this.fieldValue(form, 'note');
        const burn = window.FitCareEngine.estimateWorkoutBurn({
            title,
            note,
            exercises,
            duration_min: duration,
            rpe
        }, this.getLatestWeightKg() || 70);
        const bits = [];
        if (autoVol) bits.push(this.t('auto_volume', { n: this.fmt(autoVol, 0) }));
        if (burn) bits.push(this.t('workout_burn_est', { n: this.fmt(burn, 0) }));
        if (!bits.length) {
            box.classList.add('fit-hidden');
            box.textContent = '';
        } else {
            box.classList.remove('fit-hidden');
            box.textContent = bits.join(' · ');
        }
    },

    openWorkoutModal(date, options) {
        const opts = options || {};
        const existing = opts.workout || null;
        const planDay = opts.planDay || null;
        const planSession = this.getPlanSessionForDate(date);
        const exercises = existing ? this.parseExercises(existing.exercises) : (planDay ? this.parseExercises(planDay.exercises) : []);
        const title = existing ? existing.title : (planDay ? (planDay.title || planDay.focus) : '');
        const status = existing ? existing.status : (opts.status || 'done');
        const hasManualVol = !!(existing && existing.volume_kg !== null && existing.volume_kg !== undefined);
        const body = `
            <form id="fit-form-workout" data-fit-form="workout" data-date="${date}" data-id="${existing ? existing.id : ''}" data-plan-day="${existing && existing.plan_day_id ? existing.plan_day_id : (planDay ? planDay.id : '')}" class="fit-form-grid">
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('workout_title'))}</span>
                    <input class="fit-input" name="title" required maxlength="160" value="${this.esc(title || '')}" placeholder="${this.esc(this.t('workout_title_placeholder'))}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('date'))}</span>
                    <input class="fit-input" name="log_date" type="date" value="${this.esc(existing ? existing.log_date : date)}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('time'))}</span>
                    <input class="fit-input" name="log_time" type="time" value="${this.esc(existing && existing.log_time ? existing.log_time : this.nowTime())}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('duration_min'))}</span>
                    <input class="fit-input" name="duration_min" type="number" min="0" step="1" value="${this.esc(existing && existing.duration_min !== null ? existing.duration_min : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('volume_kg'))}</span>
                    <input class="fit-input" name="volume_kg" type="number" min="0" step="1" data-manual="${hasManualVol ? '1' : '0'}" value="${this.esc(hasManualVol ? existing.volume_kg : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('rpe'))}</span>
                    <input class="fit-input" name="rpe" type="number" min="1" max="10" step="1" value="${this.esc(existing && existing.rpe !== null ? existing.rpe : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('status'))}</span>
                    <select class="fit-select" name="status">
                        ${['done', 'planned', 'skipped'].map((value) => `<option value="${value}" ${status === value ? 'selected' : ''}>${this.esc(this.t(`workout_${value}`))}</option>`).join('')}
                    </select>
                </label>
                <div class="fit-span-2">
                    <div class="fit-exercise-list">
                        <div class="fit-exercise-row fit-exercise-head">
                            <span>${this.esc(this.t('plan_exercises'))}</span>
                            <span>${this.esc(this.t('plan_sets'))}</span>
                            <span>${this.esc(this.t('plan_reps'))}</span>
                            <span class="fit-ex-weight">${this.esc(this.t('plan_weight'))}</span>
                            <span></span>
                        </div>
                        <div id="fit-workout-ex-rows" class="fit-exercise-list">
                            ${(exercises.length ? exercises : [{}]).map((ex) => this.workoutExerciseRow(ex)).join('')}
                        </div>
                    </div>
                    <button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="workout-add-ex" style="margin-top:8px">
                        <i data-lucide="plus"></i>${this.esc(this.t('plan_add_exercise'))}
                    </button>
                </div>
                <div id="fit-workout-live-preview" class="fit-macro-hint fit-span-2 fit-hidden"></div>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('note'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <textarea class="fit-textarea" name="note" rows="2">${this.esc(existing ? existing.note : '')}</textarea>
                </label>
            </form>
        `;
        this.openModal({
            title: existing ? this.t('modal_workout') : (planDay ? this.t('start_session') : this.t('quick_workout')),
            subtitle: planSession ? `${planSession.plan.title} · ${this.t('plan_week')} ${planSession.week}` : this.formatDate(date, { day: 'numeric', month: 'long' }),
            wide: true,
            body,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="submit-form" data-form="fit-form-workout">${this.esc(this.t('save_workout'))}</button>
            `
        });
        this.updateWorkoutLivePreview(document.getElementById('fit-form-workout'));
    },

    saveWorkout(form) {
        const exercises = this.collectWorkoutExercises(form);
        const autoVolume = window.FitCareEngine ? window.FitCareEngine.calcWorkoutVolume(exercises) : null;
        const explicitVolume = this.fieldNumber(form, 'volume_kg');
        const planDayId = Number(form.dataset.planDay) || null;
        const workout = {
            id: Number(form.dataset.id) || null,
            log_date: this.fieldValue(form, 'log_date') || form.dataset.date,
            log_time: this.fieldValue(form, 'log_time'),
            plan_day_id: planDayId,
            title: this.fieldValue(form, 'title'),
            exercises,
            duration_min: this.fieldNumber(form, 'duration_min'),
            volume_kg: explicitVolume !== null ? explicitVolume : autoVolume,
            rpe: this.fieldNumber(form, 'rpe'),
            status: this.fieldValue(form, 'status') || 'done',
            note: this.fieldValue(form, 'note')
        };
        if (!workout.title || !workout.log_date) return;
        window.DB.saveFitWorkout(workout);
        this.closeModal();
        this.refresh();
        this.toast(this.t('toast_saved'), 'success');
    },

    openMetricsModal(date) {
        const log = this.getDaily(date) || {};
        const body = `
            <form id="fit-form-metrics" data-fit-form="metrics" data-date="${date}" class="fit-form-grid">
                <p class="fit-muted fit-span-2" style="margin:0;font-size:.7rem">${this.esc(this.t('measure_hint'))}</p>
                <label class="fit-field"><span>${this.esc(this.t('metric_weight'))}, ${this.esc(this.t('kg'))}</span>
                    <input class="fit-input" name="weight" type="number" min="1" step="0.1" value="${this.esc(log.weight !== null && log.weight !== undefined ? log.weight : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_body_fat'))}, %</span>
                    <input class="fit-input" name="body_fat" type="number" min="0" max="75" step="0.1" value="${this.esc(log.body_fat !== null && log.body_fat !== undefined ? log.body_fat : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_muscle'))}, ${this.esc(this.t('kg'))}</span>
                    <input class="fit-input" name="muscle_mass" type="number" min="0" step="0.1" value="${this.esc(log.muscle_mass !== null && log.muscle_mass !== undefined ? log.muscle_mass : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_water_pct'))}, %</span>
                    <input class="fit-input" name="water_pct" type="number" min="0" max="100" step="0.1" value="${this.esc(log.water_pct !== null && log.water_pct !== undefined ? log.water_pct : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_bone'))}, ${this.esc(this.t('kg'))}</span>
                    <input class="fit-input" name="bone_mass" type="number" min="0" step="0.1" value="${this.esc(log.bone_mass !== null && log.bone_mass !== undefined ? log.bone_mass : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_visceral'))}</span>
                    <input class="fit-input" name="visceral_fat" type="number" min="0" max="60" step="0.1" value="${this.esc(log.visceral_fat !== null && log.visceral_fat !== undefined ? log.visceral_fat : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_steps'))}</span>
                    <input class="fit-input" name="steps" type="number" min="0" step="1" value="${this.esc(log.steps !== null && log.steps !== undefined ? log.steps : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_sleep'))}, ${this.esc(this.t('h'))}</span>
                    <input class="fit-input" name="sleep_hours" type="number" min="0" max="24" step="0.25" value="${this.esc(log.sleep_hours !== null && log.sleep_hours !== undefined ? log.sleep_hours : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_energy'))} (1–5)</span>
                    <input class="fit-input" name="energy" type="number" min="1" max="5" step="1" value="${this.esc(log.energy !== null && log.energy !== undefined ? log.energy : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_mood'))} (1–5)</span>
                    <input class="fit-input" name="mood" type="number" min="1" max="5" step="1" value="${this.esc(log.mood !== null && log.mood !== undefined ? log.mood : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_stress'))} (1–5)</span>
                    <input class="fit-input" name="stress" type="number" min="1" max="5" step="1" value="${this.esc(log.stress !== null && log.stress !== undefined ? log.stress : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_water_ml'))}, ${this.esc(this.t('unit_ml'))}</span>
                    <input class="fit-input" name="water_ml" type="number" min="0" step="50" value="${this.esc(log.water_ml !== null && log.water_ml !== undefined ? log.water_ml : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_calories'))}, ${this.esc(this.t('kcal'))}</span>
                    <input class="fit-input" name="calories" type="number" min="0" step="1" value="${this.esc(log.calories !== null && log.calories !== undefined ? log.calories : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_protein'))}, ${this.esc(this.t('g'))}</span>
                    <input class="fit-input" name="protein" type="number" min="0" step="0.1" value="${this.esc(log.protein !== null && log.protein !== undefined ? log.protein : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_carbs'))}, ${this.esc(this.t('g'))}</span>
                    <input class="fit-input" name="carbs" type="number" min="0" step="0.1" value="${this.esc(log.carbs !== null && log.carbs !== undefined ? log.carbs : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('metric_fat'))}, ${this.esc(this.t('g'))}</span>
                    <input class="fit-input" name="fat" type="number" min="0" step="0.1" value="${this.esc(log.fat !== null && log.fat !== undefined ? log.fat : '')}">
                </label>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('symptoms'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <input class="fit-input" name="symptoms" maxlength="400" placeholder="${this.esc(this.t('symptoms_hint'))}" value="${this.esc(this.parseJson(log.symptoms, []).join(', '))}">
                </label>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('note'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <textarea class="fit-textarea" name="measurement_note" rows="2">${this.esc(log.measurement_note || '')}</textarea>
                </label>
            </form>
        `;
        this.openModal({
            title: this.t('modal_metrics'),
            subtitle: this.formatDate(date, { day: 'numeric', month: 'long' }),
            body,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="submit-form" data-form="fit-form-metrics">${this.esc(this.t('save_metrics'))}</button>
            `
        });
    },

    saveMetrics(form) {
        const date = form.dataset.date;
        const patch = { log_date: date };
        const fields = ['weight', 'body_fat', 'muscle_mass', 'water_pct', 'bone_mass', 'visceral_fat', 'steps', 'sleep_hours', 'energy', 'mood', 'stress', 'water_ml', 'calories', 'protein', 'carbs', 'fat'];
        for (const field of fields) {
            patch[field] = this.fieldNumber(form, field);
        }
        patch.symptoms = JSON.stringify(this.splitList(this.fieldValue(form, 'symptoms')).slice(0, 20));
        patch.measurement_note = this.fieldValue(form, 'measurement_note');
        window.DB.saveFitDailyLog(patch);
        this.closeModal();
        this.refresh();
        this.toast(this.t('toast_saved'), 'success');
    },

    openMedModal(date) {
        const protocols = (this.state.protocols || []).filter((protocol) => Number(protocol.active));
        if (!protocols.length) {
            this.openModal({
                title: this.t('modal_med'),
                subtitle: this.formatDate(date, { day: 'numeric', month: 'long' }),
                body: `<div class="fit-empty"><i data-lucide="pill"></i><strong>${this.esc(this.t('no_protocol_defined'))}</strong><span>${this.esc(this.t('no_protocols_quick'))}</span></div>`,
                footer: `<button type="button" class="fit-btn fit-btn-primary" data-fit-action="view" data-view="health">${this.esc(this.t('nav_health'))}</button>`
            });
            return;
        }
        const scheduleTime = (() => {
            const doses = this.getDosesForDate(date).filter((dose) => dose.status !== 'taken' && dose.status !== 'skipped');
            return doses.length ? doses[0].time : this.nowTime();
        })();
        const body = `
            <form id="fit-form-med" data-fit-form="med" data-date="${date}" class="fit-form-grid">
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('med_protocol'))}</span>
                    <select class="fit-select" name="protocol_id">
                        ${protocols.map((protocol) => `<option value="${protocol.id}">${this.esc(protocol.name)}${protocol.dosage ? ` · ${this.esc(protocol.dosage)}` : ''}</option>`).join('')}
                    </select>
                </label>
                <label class="fit-field"><span>${this.esc(this.t('med_time'))}</span>
                    <input class="fit-input" name="log_time" type="time" value="${this.esc(scheduleTime || this.nowTime())}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('med_status'))}</span>
                    <select class="fit-select" name="status">
                        <option value="taken">${this.esc(this.t('med_taken'))}</option>
                        <option value="skipped">${this.esc(this.t('med_skipped'))}</option>
                    </select>
                </label>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('note'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <textarea class="fit-textarea" name="note" rows="2"></textarea>
                </label>
            </form>
        `;
        this.openModal({
            title: this.t('modal_med'),
            subtitle: this.formatDate(date, { day: 'numeric', month: 'long' }),
            body,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="submit-form" data-form="fit-form-med">${this.esc(this.t('save_med'))}</button>
            `
        });
    },

    saveMed(form) {
        const date = form.dataset.date;
        const protocolId = Number(this.fieldValue(form, 'protocol_id'));
        const protocol = (this.state.protocols || []).find((item) => Number(item.id) === protocolId);
        if (!protocol) return;
        const status = this.fieldValue(form, 'status') || 'taken';
        window.DB.saveFitHealthLog({
            log_date: date,
            log_time: this.fieldValue(form, 'log_time'),
            protocol_id: protocol.id,
            type: 'medication',
            name: protocol.name,
            status,
            note: this.fieldValue(form, 'note')
        });
        this.closeModal();
        this.refresh();
        if (status === 'taken' && window.DB && typeof window.DB.getFitMealConflicts === 'function') {
            for (const meal of this.getMeals(date)) {
                let conflicts = [];
                try { conflicts = window.DB.getFitMealConflicts(meal) || []; } catch (_) { conflicts = []; }
                if (conflicts.length) {
                    this.toast(this.t('conflict_med_toast'), 'error');
                    return;
                }
            }
        }
        this.toast(this.t('toast_saved'), 'success');
    },

    openHealthModal(date, presetType, existing) {
        const log = existing || null;
        const selectedType = log ? log.type : presetType;
        const types = ['measurement', 'glucose', 'pressure', 'symptom', 'temperature', 'other'];
        const body = `
            <form id="fit-form-health" data-fit-form="health" data-date="${this.esc(date)}" data-id="${log ? this.esc(log.id) : ''}" class="fit-form-grid">
                <label class="fit-field"><span>${this.esc(this.t('type'))}</span>
                    <select class="fit-select" name="type">
                        ${types.map((type) => `<option value="${type}" ${selectedType === type ? 'selected' : ''}>${this.esc(this.t(`health_type_${type}`))}</option>`).join('')}
                    </select>
                </label>
                <label class="fit-field"><span>${this.esc(this.t('time'))}</span>
                    <input class="fit-input" name="log_time" type="time" value="${this.esc(log && log.log_time ? log.log_time : this.nowTime())}">
                </label>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('name'))}</span>
                    <input class="fit-input" name="label" maxlength="120" value="${this.esc(log ? log.name : '')}" placeholder="${this.esc(this.t('health_name_placeholder'))}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('value'))}</span>
                    <input class="fit-input" name="value" type="number" step="0.01" value="${this.esc(log && log.value !== null && log.value !== undefined ? log.value : '')}" placeholder="${this.esc(this.t('health_value_placeholder'))}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('value2'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <input class="fit-input" name="value2" type="number" step="0.01" value="${this.esc(log && log.value2 !== null && log.value2 !== undefined ? log.value2 : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('unit'))}</span>
                    <input class="fit-input" name="unit" maxlength="24" value="${this.esc(log ? log.unit : '')}" placeholder="${this.esc(this.t('health_unit_placeholder'))}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('tags'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <input class="fit-input" name="tags" value="${this.esc(log ? this.parseJson(log.tags, []).join(', ') : '')}" placeholder="${this.esc(this.t('health_tags_placeholder'))}">
                </label>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('note'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <textarea class="fit-textarea" name="note" rows="3">${this.esc(log ? log.note : '')}</textarea>
                </label>
            </form>
        `;
        this.openModal({
            title: this.t('modal_health'),
            subtitle: this.formatDate(date, { day: 'numeric', month: 'long' }),
            body,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="submit-form" data-form="fit-form-health">${this.esc(this.t('save_health'))}</button>
            `
        });
    },

    saveHealth(form) {
        const date = form.dataset.date;
        const type = this.fieldValue(form, 'type') || 'measurement';
        const label = this.fieldValue(form, 'label') || this.t(`health_type_${type}`);
        const value = this.fieldNumber(form, 'value');
        const value2 = this.fieldNumber(form, 'value2');
        window.DB.saveFitHealthLog({
            id: Number(form.dataset.id) || null,
            log_date: date,
            log_time: this.fieldValue(form, 'log_time'),
            type,
            name: label,
            value,
            value2,
            unit: this.fieldValue(form, 'unit'),
            status: 'logged',
            tags: this.splitList(this.fieldValue(form, 'tags')),
            note: this.fieldValue(form, 'note')
        });
        this.closeModal();
        this.refresh();
        this.toast(this.t('toast_saved'), 'success');
    },

    // A start/end mark silently moves predictions, so both go through a check:
    // future dates are refused, duplicates and double taps are recognised, and
    // unusual gaps need an explicit confirmation instead of a silent overwrite.
    requestCycleStart(date) {
        const key = date || this.todayKey();
        if (key > this.todayKey()) {
            this.toast(this.t('cycle_future_date'), 'error');
            return;
        }
        const cycles = (this.state.cycles || []).filter((cycle) => cycle.start_date);
        const same = cycles.find((cycle) => cycle.start_date === key);
        if (same) {
            this.toast(this.t('cycle_start_exists', { date: this.formatShortDate(same.start_date) }), 'info');
            return;
        }
        const previous = cycles.filter((cycle) => cycle.start_date < key).pop() || null;
        if (previous) {
            const gap = this.diffDays(previous.start_date, key);
            if (gap > 0 && gap < 10) {
                this.openCycleStartConfirm(key, previous, gap);
                return;
            }
        }
        this.applyCycleStart(key);
    },

    applyCycleStart(date) {
        const result = window.DB.startFitCycle(date);
        if (!result) {
            this.toast(this.t('cycle_future_date'), 'error');
            return;
        }
        if (!result.created) {
            this.toast(this.t('cycle_start_exists', { date: this.formatShortDate(result.start_date) }), 'info');
            return;
        }
        this.closeModal();
        this.refresh();
        this.toast(this.t('cycle_started_on', { date: this.formatShortDate(result.start_date) }), 'success');
    },

    applyCycleStartMove(date, cycleId) {
        const id = window.DB.moveFitCycleStart(Number(cycleId), date);
        if (!id) {
            this.toast(this.t('toast_error'), 'error');
            return;
        }
        this.closeModal();
        this.refresh();
        this.toast(this.t('cycle_started_on', { date: this.formatShortDate(date) }), 'success');
    },

    openCycleStartConfirm(date, previous, gap) {
        this.openModal({
            title: this.t('cycle_start_confirm_title'),
            body: `<p class="fit-muted" style="margin:0;font-size:.8rem;line-height:1.55">${this.esc(this.t('cycle_start_confirm_text', {
                date: this.formatShortDate(previous.start_date),
                days: gap,
                new_date: this.formatShortDate(date)
            }))}</p>`,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cycle_keep_existing'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="cycle-start-move" data-date="${date}" data-id="${previous.id}">${this.esc(this.t('cycle_move_start', { date: this.formatShortDate(date) }))}</button>
            `
        });
    },

    requestCycleEnd(date) {
        const key = date || this.todayKey();
        if (key > this.todayKey()) {
            this.toast(this.t('cycle_future_date'), 'error');
            return;
        }
        const cycle = (this.state.cycles || [])
            .filter((item) => item.start_date && item.start_date <= key)
            .pop() || null;
        if (!cycle) {
            this.toast(this.t('cycle_no_active'), 'error');
            return;
        }
        if (cycle.end_date === key) {
            this.toast(this.t('cycle_end_exists', { date: this.formatShortDate(key) }), 'info');
            return;
        }
        const days = this.diffDays(cycle.start_date, key) + 1;
        if (days > 15) {
            this.openCycleEndConfirm(key, cycle, days);
            return;
        }
        this.applyCycleEnd(key, cycle.id);
    },

    applyCycleEnd(date, cycleId) {
        const id = window.DB.endFitCycle(date, cycleId ? Number(cycleId) : null);
        if (!id) {
            this.toast(this.t('cycle_no_active'), 'error');
            return;
        }
        this.closeModal();
        this.refresh();
        this.toast(this.t('cycle_ended_on', { date: this.formatShortDate(date) }), 'success');
    },

    openCycleEndConfirm(date, cycle, days) {
        this.openModal({
            title: this.t('cycle_end_confirm_title'),
            body: `<p class="fit-muted" style="margin:0;font-size:.8rem;line-height:1.55">${this.esc(this.t('cycle_end_confirm_text', {
                date: this.formatShortDate(cycle.start_date),
                days
            }))}</p>`,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="cycle-end-confirm" data-date="${date}" data-id="${cycle.id}">${this.esc(this.t('cycle_end_anyway'))}</button>
            `
        });
    },

    // Logging flow without a recent "first day" is the usual way tracking starts
    // by accident, so offer to record the start instead of leaving predictions stale.
    offerCycleStart(date) {
        if (!this.cycleEnabled()) return;
        const key = date || this.state.selectedDate || this.todayKey();
        if (key > this.todayKey()) return;
        const cycles = (this.state.cycles || []).filter((cycle) => cycle.start_date);
        const recent = cycles.some((cycle) => {
            const gap = this.diffDays(cycle.start_date, key);
            return gap >= 0 && gap <= 10;
        });
        const upcoming = cycles.some((cycle) => {
            const gap = this.diffDays(key, cycle.start_date);
            return gap > 0 && gap <= 10;
        });
        if (recent || upcoming) return;
        this.openModal({
            title: this.t('cycle_start_prompt_title'),
            subtitle: this.formatDate(key, { day: 'numeric', month: 'long' }),
            body: `<p class="fit-muted" style="margin:0;font-size:.8rem;line-height:1.55">${this.esc(this.t('cycle_start_prompt_text', { date: this.formatShortDate(key) }))}</p>`,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cycle_start_prompt_no'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="cycle-start" data-date="${key}"><i data-lucide="play"></i>${this.esc(this.t('cycle_start_prompt_yes'))}</button>
            `
        });
    },

    openCycleModal(date) {
        const profile = this.state.profile || {};
        if (!Number(profile.cycle_tracking)) {
            this.openModal({
                title: this.t('cycle_title'),
                body: `<div class="fit-empty"><i data-lucide="droplet"></i><strong>${this.esc(this.t('cycle_off_title'))}</strong><span>${this.esc(this.t('cycle_off_sub'))}</span></div>`,
                footer: `<button type="button" class="fit-btn fit-btn-primary" data-fit-action="enable-cycle">${this.esc(this.t('cycle_title'))}</button>`
            });
            return;
        }
        const log = this.getCycleLog(date) || {};
        const body = `
            <form id="fit-form-cycle" data-fit-form="cycle" data-date="${date}" class="fit-form-grid">
                <label class="fit-field"><span>${this.esc(this.t('date'))}</span>
                    <input class="fit-input" name="cycle_date" type="date" value="${date}" disabled>
                </label>
                <label class="fit-field"><span>${this.esc(this.t('cycle_flow'))}</span>
                    <select class="fit-select" name="flow">
                        <option value="">${this.esc(this.t('flow_none'))}</option>
                        ${['light', 'medium', 'heavy'].map((flow) => `<option value="${flow}" ${log.flow === flow ? 'selected' : ''}>${this.esc(this.t(`flow_${flow}`))}</option>`).join('')}
                    </select>
                </label>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('note'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <textarea class="fit-textarea" name="note" rows="2">${this.esc(log.note || '')}</textarea>
                </label>
                <div class="fit-span-2 fit-data-actions">
                    <button type="button" class="fit-btn fit-btn-soft" data-fit-action="cycle-start" data-date="${date}"><i data-lucide="play"></i>${this.esc(this.t('cycle_start'))}</button>
                    <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="cycle-end" data-date="${date}"><i data-lucide="square"></i>${this.esc(this.t('cycle_end'))}</button>
                </div>
                <p class="fit-muted fit-span-2" style="margin:0;font-size:.66rem">${this.esc(this.t('cycle_prediction_note'))}</p>
            </form>
        `;
        this.openModal({
            title: this.t('modal_cycle'),
            subtitle: this.formatDate(date, { day: 'numeric', month: 'long' }),
            body,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="submit-form" data-form="fit-form-cycle">${this.esc(this.t('save'))}</button>
            `
        });
    },

    saveCycleLog(form) {
        const date = form.dataset.date;
        const flow = this.fieldValue(form, 'flow');
        const note = this.fieldValue(form, 'note');
        if (!flow && !String(note || '').trim()) {
            // An empty row would still count as a logged cycle day, so remove it.
            window.DB.deleteFitCycleLog(date);
        } else {
            window.DB.saveFitCycleLog({ log_date: date, flow, note });
        }
        this.closeModal();
        this.refresh();
        this.toast(this.t('toast_saved'), 'success');
        if (flow) this.offerCycleStart(date);
    },

    openIntimacyModal(date, entry) {
        if (!this.intimacyEnabled()) {
            this.toast(this.t('adult_only'), 'error');
            return;
        }
        this.state.showPrivate = true;
        const existing = entry || null;
        const body = `
            <form id="fit-form-intimacy" data-fit-form="intimacy" data-date="${date}" data-id="${existing ? existing.id : ''}" class="fit-form-grid">
                <div class="fit-form-grid fit-span-2" style="grid-template-columns:1fr 1fr">
                    <label class="fit-field"><span>${this.esc(this.t('time'))}</span>
                        <input class="fit-input" type="time" name="log_time" value="${this.esc(existing ? (existing.log_time || '') : this.nowTime())}">
                    </label>
                    <label class="fit-field"><span>${this.esc(this.t('protection'))}</span>
                        <select class="fit-select" name="protection">
                            <option value="">${this.esc(this.t('protection_none'))}</option>
                            <option value="condom" ${existing && existing.protection === 'condom' ? 'selected' : ''}>${this.esc(this.t('protection_condom'))}</option>
                            <option value="pill" ${existing && existing.protection === 'pill' ? 'selected' : ''}>${this.esc(this.t('protection_pill'))}</option>
                            <option value="other" ${existing && existing.protection === 'other' ? 'selected' : ''}>${this.esc(this.t('protection_other'))}</option>
                        </select>
                    </label>
                </div>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('note'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <textarea class="fit-textarea" name="note" rows="3">${this.esc(existing ? existing.note : '')}</textarea>
                </label>
                <div class="fit-privacy-note fit-span-2"><i data-lucide="shield-check"></i><span>${this.esc(this.t('intimacy_private_note'))}</span></div>
            </form>
        `;
        this.openModal({
            title: existing ? this.t('edit') : this.t('modal_intimacy'),
            subtitle: this.formatDate(date, { day: 'numeric', month: 'long' }),
            body,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="submit-form" data-form="fit-form-intimacy">${this.esc(this.t('save'))}</button>
            `
        });
    },

    saveIntimacy(form) {
        if (!this.intimacyEnabled()) return;
        const date = form.dataset.date;
        const id = Number(form.dataset.id) || null;
        window.DB.saveFitIntimacyLog({
            id,
            log_date: date,
            log_time: this.fieldValue(form, 'log_time'),
            protection: this.fieldValue(form, 'protection'),
            note: this.fieldValue(form, 'note')
        });
        this.closeModal();
        this.refresh();
        this.toast(this.t('toast_saved'), 'success');
    },

    findIntimacyEntry(id) {
        for (const entries of this.state.intimacyByDate.values()) {
            const found = (entries || []).find((entry) => Number(entry.id) === Number(id));
            if (found) return found;
        }
        return null;
    },

    openEditCycleModal(cycle) {
        if (!cycle) return;
        const today = this.todayKey();
        const body = `
            <form id="fit-form-cycle-edit" data-fit-form="cycle-edit" data-id="${cycle.id}" class="fit-form-grid">
                <label class="fit-field"><span>${this.esc(this.t('cycle_start'))}</span>
                    <input class="fit-input" name="start_date" type="date" max="${today}" required value="${this.esc(cycle.start_date || '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('cycle_end_date'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <input class="fit-input" name="end_date" type="date" max="${today}" value="${this.esc(cycle.end_date || '')}">
                </label>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('note'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <textarea class="fit-textarea" name="notes" rows="2">${this.esc(cycle.notes || '')}</textarea>
                </label>
            </form>
        `;
        this.openModal({
            title: this.t('cycle_edit_title'),
            subtitle: this.formatShortDate(cycle.start_date),
            body,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="submit-form" data-form="fit-form-cycle-edit">${this.esc(this.t('save'))}</button>
            `
        });
    },

    saveCycleEdit(form) {
        const id = Number(form.dataset.id);
        const start_date = this.fieldValue(form, 'start_date');
        const end_date = this.fieldValue(form, 'end_date');
        const notes = this.fieldValue(form, 'notes');
        if (!id || !start_date) return;
        const res = window.DB.updateFitCycle(id, { start_date, end_date, notes });
        if (!res) {
            this.toast(this.t('cycle_future_date'), 'error');
            return;
        }
        this.closeModal();
        this.refresh();
        this.toast(this.t('toast_saved'), 'success');
    },

    saveDayNote(date, value) {
        window.DB.patchFitDailyLog(date, { note: String(value || '') });
        if (this.state.noteDrafts) delete this.state.noteDrafts[date];
        this.refresh();
        this.toast(this.t('toast_saved'), 'success');
    },

    // ---------- Aru daily chat ----------
    getChatMessages(date) {
        if (!(window.DB && window.DB.db)) return [];
        try { return window.DB.getFitChatMessages(date, 80) || []; } catch (error) { return []; }
    },

    buildChatContext(date, hasSystemSnapshot = false) {
        const lines = [];
        const nutrition = this.getDayNutrition(date);
        const targets = this.getTargets(date);
        const teenMode = this.getUserMode() === 'teen' || !!(targets && targets.teenSafe);
        lines.push(`[SELECTED DAY CONTEXT: ${date}]`);
        lines.push(`Rules: Answer concisely and supportively in the user's language (gender: feminine in Russian/gendered languages). Use [[FIT: ... date="${date}" ...]] to record casual mentions; estimate missing macros (estimated="1") and re-check calories ≈ 4P+4C+9F. Never diagnose, prescribe, suggest doses, or show raw [[FIT:...]] / tags in prose.`);
        if (teenMode) {
            lines.push('Teen safety (mandatory): NEVER suggest calorie deficits, weight-loss dieting, fasting, or restrictive targets; focus only on balanced nutrition, energy, growth, sleep, and enjoyable activity, and suggest consulting a parent/doctor for weight concerns. Intimacy tracking is disabled in teen mode.');
        }
        if (!hasSystemSnapshot && window.DB && typeof window.DB.getFitAruSnapshot === 'function') {
            const snapshot = window.DB.getFitAruSnapshot(true);
            if (snapshot) lines.push('', snapshot);
        }
        const nutParts = [];
        if (nutrition.calories !== null) nutParts.push(`${nutrition.calories} kcal`);
        if (nutrition.protein !== null) nutParts.push(`P ${nutrition.protein} g`);
        if (nutrition.carbs !== null) nutParts.push(`C ${nutrition.carbs} g`);
        if (nutrition.fat !== null) nutParts.push(`F ${nutrition.fat} g`);
        const daily = this.getDaily(date) || {};
        if (daily.water_ml !== null && daily.water_ml !== undefined) nutParts.push(`water ${daily.water_ml} ml`);
        if (targets) {
            const tBits = [];
            if (targets.calorieMin && targets.calorieMax) tBits.push(`${targets.calorieMin}–${targets.calorieMax} kcal`);
            else if (targets.calorieTarget) tBits.push(`${targets.calorieTarget} kcal`);
            if (targets.protein) tBits.push(`P ${targets.protein} g`);
            if (targets.carbs) tBits.push(`C ${targets.carbs} g`);
            if (targets.fat) tBits.push(`F ${targets.fat} g`);
            if (targets.waterMl) tBits.push(`water ${targets.waterMl} ml`);
            if (tBits.length) lines.push(`Daily targets (${targets.teenSafe ? 'teen maintenance' : (targets.formula || 'profile')}): ${tBits.join(', ')}.`);
        }
        if (nutParts.length) lines.push(`Day ${date} nutrition totals: ${nutParts.join(', ')}.`);

        const dayBits = [];
        const labels = {
            weight: 'weight kg', body_fat: 'body fat %', muscle_mass: 'muscle kg', water_pct: 'water %',
            bone_mass: 'bone kg', visceral_fat: 'visceral fat', steps: 'steps', sleep_hours: 'sleep h',
            energy: 'energy 1-5', mood: 'mood 1-5', stress: 'stress 1-5'
        };
        for (const [field, label] of Object.entries(labels)) {
            if (daily[field] !== null && daily[field] !== undefined) dayBits.push(`${label}: ${daily[field]}`);
        }
        if (dayBits.length) lines.push(`Day ${date} metrics: ${dayBits.join(', ')}.`);
        if (daily.note) lines.push(`User note (${date}): ${daily.note}`);

        const planSession = this.getPlanSessionForDate(date);
        if (planSession && !planSession.isRest) {
            lines.push(`Planned session (week ${planSession.week}/${planSession.plan.weeks}): ${planSession.day.title || planSession.day.focus || 'session'}; exercises: ${this.parseExercises(planSession.day.exercises).map((ex) => this.exerciseLabel(ex)).join('; ') || 'not specified'}.`);
        } else if (planSession && planSession.isRest) {
            lines.push(`Planned: rest day on ${date}.`);
        } else if (this.state.activePlan) {
            lines.push(`No plan session scheduled on ${date}.`);
        }

        const workouts = this.getWorkouts(date);
        if (workouts.length) {
            const wKg = this.getLatestWeightKg() || 70;
            lines.push(`Workouts (${date}): ${workouts.map((w) => {
                const burn = window.FitCareEngine ? window.FitCareEngine.estimateWorkoutBurn(w, wKg) : null;
                const exText = this.parseExercises(w.exercises).map(e => this.exerciseLabel(e)).join(', ');
                return `${w.title} [${w.status}${w.duration_min ? `, ${w.duration_min} min` : ''}${w.volume_kg ? `, vol ${w.volume_kg} kg` : ''}${w.rpe ? `, RPE ${w.rpe}` : ''}${burn ? `, ~${burn} kcal` : ''}]${exText ? ` (${exText})` : ''}`;
            }).join('; ')}.`);
        }

        const meals = this.getMeals(date);
        if (meals.length) {
            lines.push(`Meals (${date}): ${meals.map((meal) => {
                const macros = [meal.calories ? `${meal.calories} kcal` : '', meal.protein ? `P ${meal.protein} g` : '', meal.carbs ? `C ${meal.carbs} g` : '', meal.fat ? `F ${meal.fat} g` : ''].filter(Boolean).join(', ');
                const tags = this.parseJson(meal.tags, []);
                return `${meal.meal_time ? meal.meal_time + ' ' : ''}${meal.title}${macros ? ` (${macros})` : ''}${tags.length ? ` [${tags.join(', ')}]` : ''}`;
            }).join('; ')}.`);
        }

        const health = this.getHealthLogs(date);
        if (health.length) {
            lines.push(`Health events (${date}): ${health.map((event) => `${event.log_time ? event.log_time + ' ' : ''}${event.name || event.type}${event.value !== null && event.value !== undefined ? ` ${event.value}${event.value2 ? '/' + event.value2 : ''}` : ''}${event.unit ? ' ' + event.unit : ''} [${event.status}]`).join('; ')}.`);
        }

        const doses = this.getDosesForDate(date).filter((dose) => dose.time);
        if (doses.length) {
            lines.push(`Medication schedule (${date}): ${doses.map((dose) => `${dose.protocol.name}${dose.time ? ' ' + dose.time : ''} — ${dose.status || 'not logged'}`).join('; ')}.`);
        }

        const cycle = this.getCycleInfo(date);
        if (cycle.tracking && cycle.hasData) {
            if (cycle.paused) {
                lines.push(`Cycle context: paused (last logged start ${cycle.lastStart}, ${cycle.daysSinceLastStartToday ?? cycle.daysSinceLastStart} days ago). Do NOT guess a phase; if user mentions bleeding, ask for exact date for CYCLE_START.`);
            } else if (cycle.confidence === 'late') {
                lines.push(`Cycle context: ${cycle.day != null ? `day ${cycle.day} ` : ''}since ${cycle.lastStart} (+${cycle.lateDays}d past ${cycle.avg}d avg). Predictions are NOT contraception.`);
            } else {
                const kind = cycle.confidence === 'recorded' ? 'recorded' : 'estimated';
                lines.push(`Cycle context: ${kind} day ${cycle.day}, phase ${cycle.phase}, started ${cycle.cycleStart}${cycle.nextPeriod ? `, next period ~${cycle.nextPeriod}` : ''}. Forecasts are NOT contraception.`);
            }
        } else if (cycle.tracking && !cycle.hasData) {
            lines.push('Cycle tracking is on with no start logged yet. Ask for real start date before emitting CYCLE_START.');
        }
        return lines.join('\n');
    },

    async sendChat(overrideText = '') {
        if (this.isChild() || this.state.chatBusy) return;
        const input = document.getElementById('fit-chat-input');
        const fromInput = !overrideText;
        const text = String(overrideText || (input ? input.value : '') || '').trim();
        if (!text) return;
        const date = this.state.selectedDate || this.todayKey();
        const llm = window.app && window.app.llm;
        if (!llm || (llm.llmType !== 'custom' && !llm.apiKey)) {
            this.toast(this.t('chat_need_key'), 'error');
            return;
        }
        const previous = this.getChatMessages(date);
        window.DB.saveFitChatMessage(date, 'user', text);
        if (fromInput) this.state.chatDraft = '';
        this.state.chatBusy = true;
        this.state.chatError = '';
        if (this.state.view === 'calendar') this.updateDayPanel();
        let didWrite = false;
        try {
            const sys = window.app && typeof window.app.updateSystemPrompt === 'function'
                ? window.app.updateSystemPrompt({ type: 'plugin', pluginId: 'fit-care', isPrivate: false })
                : null;
            const history = previous
                .filter((message) => message.role === 'user' || message.role === 'assistant')
                .slice(-this.MAX_CHAT_HISTORY)
                .map((message) => ({ role: message.role, content: message.content }));
            const hasSystemSnapshot = Boolean(sys && sys.prompt && sys.prompt.includes('[FIT & CARE'));
            const context = this.buildChatContext(date, hasSystemSnapshot);
            const prompt = `${context}\n\n[USER QUESTION]\n${text}`;
            let raw = await llm.sendMessage(
                history,
                prompt,
                sys && sys.prompt ? { systemInstruction: sys.prompt, ageMode: sys.mode } : {}
            );
            if (raw === null || raw === undefined) throw new Error('Empty response');
            raw = String(raw);
            let actions = [];
            const triggers = window.Triggers;
            if (triggers && typeof triggers.processResponseForFitCare === 'function') {
                const res = triggers.processResponseForFitCare(raw, false, date, { returnDetails: true });
                if (res && typeof res === 'object') {
                    raw = String(res.text || '');
                    actions = Array.isArray(res.actions) ? res.actions : [];
                    didWrite = !!res.wrote;
                } else {
                    raw = String(res || '');
                }
            } else {
                raw = raw.replace(/\[\[\s*FIT[\s\S]*?\]\]/gi, '');
            }
            raw = String(raw)
                .replace(/\[\[\s*TOOL[\s\S]*?\]\]/gi, '')
                .replace(/\[\[\s*MEMORY[\s\S]*?\]\]/gi, '')
                .replace(/\[\[\s*ARU_SUGGESTIONS[\s\S]*?\/\s*ARU_SUGGESTIONS\s*\]\]/gi, '')
                .trim();
            const meta = actions.length ? JSON.stringify({ actions }) : '';
            window.DB.saveFitChatMessage(date, 'assistant', raw, meta);
        } catch (error) {
            console.error('FitCare chat failed', error);
            this.state.chatError = this.t('chat_failed');
        } finally {
            this.state.chatBusy = false;
            if (didWrite) {
                this.loadAll();
                this.render();
            } else if (this.state.view === 'calendar') {
                this.updateDayPanel();
            }
            setTimeout(() => this.scrollChatToBottom(), 50);
        }
    },

    scrollChatToBottom() {
        const thread = document.getElementById('fit-chat-thread');
        if (thread) thread.scrollTop = thread.scrollHeight;
    }
});
