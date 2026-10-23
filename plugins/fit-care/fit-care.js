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
        dayTab: 'aru',
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
        showPrivate: false,
        planViewId: null,
        planWeek: 'template',
        healthPage: 0,
        cyclesPage: 0,
        intimacyPage: 0
    },

    MAX_CHAT_HISTORY: 16,

    async onActivate() {
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

        const savedView = localStorage.getItem('aru_fit_view');
        if (['calendar', 'dashboard', 'plan', 'health', 'settings'].includes(savedView)) {
            this.state.view = savedView;
        }
        const savedMode = localStorage.getItem('aru_fit_cal_mode');
        if (savedMode === 'week' || savedMode === 'month') this.state.calendarMode = savedMode;
        const savedRange = Number(localStorage.getItem('aru_fit_dash_range'));
        if ([30, 90, 365].includes(savedRange)) this.state.dashRange = savedRange;

        this.state.selectedDate = this.todayKey();
        this.state.cursor = this.dateFromKey(this.state.selectedDate);
        this.loadAll();
        this.render();

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
                if (event.key !== 'Enter' || event.shiftKey) return;
                if (!event.target || event.target.id !== 'fit-chat-input') return;
                event.preventDefault();
                void this.sendChat();
            });
            root.addEventListener('input', (event) => {
                const el = event.target;
                if (!el || el.id !== 'fit-chat-input') return;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
            });
        }
        if (!this._langListenerBound) {
            this._langListenerBound = true;
            window.addEventListener('aru-lang-changed', () => {
                this.state.lang = this.currentLang();
                this.applyI18n();
                if (this._root) this.render();
            });
        }
        if (!window._fitGlobalKeysBound) {
            window._fitGlobalKeysBound = true;
            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                const plugin = window.FitCarePlugin;
                if (!plugin || !plugin._root) return;
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

    // Model replies arrive as markdown; text is escaped before parsing so a reply
    // can never inject markup, and the result is stripped down to formatting tags.
    renderChatMarkdown(text) {
        const raw = String(text === null || text === undefined ? '' : text);
        if (typeof marked === 'undefined' || typeof marked.parse !== 'function') return this.esc(raw);
        let html;
        try {
            html = marked.parse(this.esc(raw), { gfm: true, breaks: true });
        } catch (error) {
            return this.esc(raw);
        }
        if (typeof DOMParser === 'undefined') return this.esc(raw);
        let root;
        try {
            const doc = new DOMParser().parseFromString(`<div id="fit-md-root">${html}</div>`, 'text/html');
            root = doc.getElementById('fit-md-root');
            if (!root) return this.esc(raw);
            root.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select,link,meta,base,svg,math,img,video,audio,source').forEach((node) => node.remove());
            root.querySelectorAll('*').forEach((el) => {
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
        const parsed = this.parseJson(value, []);
        return Array.isArray(parsed) ? parsed : [];
    },

    exerciseLabel(exercise) {
        if (!exercise) return '';
        if (typeof exercise === 'string') return exercise;
        const parts = [];
        if (exercise.name) parts.push(exercise.name);
        if (exercise.sets || exercise.reps) parts.push(`${exercise.sets || '?'}×${exercise.reps || '?'}`);
        if (exercise.weight !== undefined && exercise.weight !== null && exercise.weight !== '') parts.push(`${exercise.weight} ${this.t('kg')}`);
        return parts.join(' · ') || exercise.name || '';
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
        if (selected < from) from = selected;
        if (selected > to) to = selected;
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
    },

    refresh() {
        if (!this._root || !(window.DB && window.DB.db)) return;
        this.loadAll();
        if (this.state.view === 'calendar') this.render();
        else this.render();
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

    getPlanSessionForDate(date) {
        const plan = this.getActivePlan();
        if (!plan || !plan.start_date) return null;
        const totalDays = Number(plan.weeks || 0) * 7;
        const offset = this.diffDays(plan.start_date, date);
        if (offset < 0 || offset >= totalDays) return null;
        const week = Math.floor(offset / 7) + 1;
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
        if (!plan || !plan.start_date) return null;
        const totalDays = Number(plan.weeks || 0) * 7;
        const elapsed = Math.min(Math.max(this.diffDays(plan.start_date, this.todayKey()) + 1, 0), totalDays);
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
            currentWeek: Math.min(Math.floor(elapsed / 7) + 1, Number(plan.weeks || 1)),
            sessionsPerWeek
        };
    },

    // ---------- cycle engine ----------
    averageCycleLength() {
        const profile = this.state.profile || {};
        const lengths = (this.state.cycles || [])
            .map((cycle) => Number(cycle.cycle_length))
            .filter((length) => Number.isFinite(length) && length >= 15 && length <= 60)
            .slice(-6);
        if (lengths.length >= 2) {
            return Math.round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length);
        }
        return Number(profile.cycle_length) || 28;
    },

    getCycleInfo(date) {
        const profile = this.state.profile || {};
        if (!Number(profile.cycle_tracking)) {
            return { tracking: false, hasData: false, phase: '', day: null };
        }
        const cycles = (this.state.cycles || []).filter((cycle) => cycle.start_date);
        if (!cycles.length) {
            return { tracking: true, hasData: false, phase: '', day: null, avg: Number(profile.cycle_length) || 28 };
        }
        const reference = cycles.filter((cycle) => cycle.start_date <= date).pop();
        if (!reference) {
            return { tracking: true, hasData: false, phase: '', day: null, avg: this.averageCycleLength() };
        }
        const avg = this.averageCycleLength();
        const luteal = Math.min(Math.max(Number(profile.luteal_length) || 14, 7), Math.max(avg - 7, 7));
        const periodLength = Math.min(Math.max(Number(profile.period_length) || 5, 1), avg);
        const offset = this.diffDays(reference.start_date, date);
        const predictedCycles = Math.max(0, Math.floor(offset / avg));
        const cycleStart = this.addDays(reference.start_date, predictedCycles * avg);
        const cycleDay = this.diffDays(cycleStart, date) + 1;
        const ovulationDay = Math.max(periodLength + 1, avg - luteal + 1);
        const fertileStart = Math.max(periodLength + 1, ovulationDay - 5);
        const fertileEnd = Math.min(avg, ovulationDay + 1);
        let phase = 'luteal';
        if (cycleDay <= periodLength) phase = 'menstrual';
        else if (cycleDay === ovulationDay) phase = 'ovulation';
        else if (cycleDay >= fertileStart && cycleDay <= fertileEnd) phase = 'fertile';
        else if (cycleDay < fertileStart) phase = 'follicular';
        return {
            tracking: true,
            hasData: true,
            phase,
            day: cycleDay,
            avg,
            periodLength,
            cycleStart,
            ovulationDay,
            fertileStart,
            fertileEnd,
            nextPeriod: this.addDays(cycleStart, avg),
            predicted: predictedCycles > 0,
            lastStart: reference.start_date
        };
    },

    getDosesForDate(date) {
        const weekday = this.weekdayIndex(date);
        const logs = this.getHealthLogs(date).filter((log) => log.type === 'medication');
        const doses = [];
        for (const protocol of this.state.protocols || []) {
            if (!Number(protocol.active)) continue;
            const schedule = this.parseJson(protocol.schedule, {});
            const days = Array.isArray(schedule.days) ? schedule.days.map(Number) : [];
            if (days.length && !days.includes(weekday)) continue;
            const times = Array.isArray(schedule.times) ? schedule.times.map((time) => String(time).trim()).filter(Boolean) : [];
            const protocolLogs = logs.filter((log) => Number(log.protocol_id) === Number(protocol.id));
            if (!times.length) {
                const log = protocolLogs[0] || null;
                doses.push({ protocol, time: '', log, status: log ? log.status : '' });
                continue;
            }
            for (const time of times) {
                const log = protocolLogs.find((entry) => entry.log_time === time) || null;
                doses.push({ protocol, time, log, status: log ? log.status : '' });
            }
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
            container.innerHTML = `<div class="fit-page"><div class="fit-empty"><strong>Fit & Care</strong><span>This section is still loading.</span></div></div>`;
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
        if (!action) return;
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
            case 'delete-intimacy':
                this.confirmDelete(() => window.DB.deleteFitIntimacyLog(el.dataset.id));
                return;
            case 'delete-cycle-log':
                this.confirmDelete(() => window.DB.deleteFitCycleLog(date));
                return;
            case 'mark-dose':
                this.toggleDose(date, el.dataset);
                return;
            case 'cycle-start':
                window.DB.startFitCycle(date);
                this.closeModal();
                this.refresh();
                this.toast(this.t('cycle_started'), 'success');
                return;
            case 'cycle-end':
                window.DB.endFitCycle(date);
                this.closeModal();
                this.refresh();
                this.toast(this.t('cycle_ended'), 'success');
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
        if (taken && data.logId) {
            window.DB.deleteFitHealthLog(data.logId);
        } else if (data.logId) {
            window.DB.saveFitHealthLog({ id: data.logId, log_date: date, log_time: data.time || '', protocol_id: Number(data.protocol), type: 'medication', name: data.name || '', status: 'taken' });
        } else {
            window.DB.saveFitHealthLog({ log_date: date, log_time: data.time || '', protocol_id: Number(data.protocol), type: 'medication', name: data.name || '', status: 'taken' });
        }
        this.refresh();
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
        switch (name) {
            case 'meal': this.saveMeal(form); return;
            case 'workout': this.saveWorkout(form); return;
            case 'metrics': this.saveMetrics(form); return;
            case 'med': this.saveMed(form); return;
            case 'health': this.saveHealth(form); return;
            case 'cycle': this.saveCycleLog(form); return;
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
    },

    saveMeal(form) {
        const date = form.dataset.date;
        const id = Number(form.dataset.id) || null;
        const tags = this.splitList(this.fieldValue(form, 'tags'));
        const meal = {
            id,
            log_date: date,
            meal_time: this.fieldValue(form, 'meal_time'),
            title: this.fieldValue(form, 'title'),
            tags,
            calories: this.fieldNumber(form, 'calories'),
            protein: this.fieldNumber(form, 'protein'),
            carbs: this.fieldNumber(form, 'carbs'),
            fat: this.fieldNumber(form, 'fat'),
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

    openWorkoutModal(date, options) {
        const opts = options || {};
        const existing = opts.workout || null;
        const planDay = opts.planDay || null;
        const planSession = this.getPlanSessionForDate(date);
        let exercises = existing ? this.parseExercises(existing.exercises) : (planDay ? this.parseExercises(planDay.exercises) : []);
        const exerciseText = exercises.map((exercise) => this.exerciseLabel(exercise)).join('\n');
        const title = existing ? existing.title : (planDay ? (planDay.title || planDay.focus) : '');
        const status = existing ? existing.status : (opts.status || 'done');
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
                    <input class="fit-input" name="volume_kg" type="number" min="0" step="1" value="${this.esc(existing && existing.volume_kg !== null ? existing.volume_kg : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('rpe'))}</span>
                    <input class="fit-input" name="rpe" type="number" min="1" max="10" step="1" value="${this.esc(existing && existing.rpe !== null ? existing.rpe : '')}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('status'))}</span>
                    <select class="fit-select" name="status">
                        ${['done', 'planned', 'skipped'].map((value) => `<option value="${value}" ${status === value ? 'selected' : ''}>${this.esc(this.t(`workout_${value}`))}</option>`).join('')}
                    </select>
                </label>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('workout_exercises'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <textarea class="fit-textarea" name="exercises" rows="4" placeholder="${this.esc(this.t('workout_exercises_hint'))}">${this.esc(exerciseText)}</textarea>
                </label>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('note'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <textarea class="fit-textarea" name="note" rows="2">${this.esc(existing ? existing.note : '')}</textarea>
                </label>
            </form>
        `;
        this.openModal({
            title: existing ? this.t('modal_workout') : (planDay ? this.t('start_session') : this.t('quick_workout')),
            subtitle: planSession ? `${planSession.plan.title} · ${this.t('plan_week')} ${planSession.week}` : this.formatDate(date, { day: 'numeric', month: 'long' }),
            body,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="submit-form" data-form="fit-form-workout">${this.esc(this.t('save_workout'))}</button>
            `
        });
    },

    saveWorkout(form) {
        const exercises = this.fieldValue(form, 'exercises')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        const planDayId = Number(form.dataset.planDay) || null;
        const workout = {
            id: Number(form.dataset.id) || null,
            log_date: this.fieldValue(form, 'log_date') || form.dataset.date,
            log_time: this.fieldValue(form, 'log_time'),
            plan_day_id: planDayId,
            title: this.fieldValue(form, 'title'),
            exercises,
            duration_min: this.fieldNumber(form, 'duration_min'),
            volume_kg: this.fieldNumber(form, 'volume_kg'),
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
        const fields = ['weight', 'body_fat', 'muscle_mass', 'water_pct', 'bone_mass', 'visceral_fat', 'steps', 'sleep_hours', 'energy', 'mood', 'stress', 'water_ml', 'calories', 'protein'];
        for (const field of fields) {
            const value = this.fieldNumber(form, field);
            if (value !== null) patch[field] = value;
        }
        patch.symptoms = JSON.stringify(this.splitList(this.fieldValue(form, 'symptoms')).slice(0, 20));
        const note = this.fieldValue(form, 'measurement_note');
        if (note) patch.measurement_note = note;
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
        window.DB.saveFitHealthLog({
            log_date: date,
            log_time: this.fieldValue(form, 'log_time'),
            protocol_id: protocol.id,
            type: 'medication',
            name: protocol.name,
            dosage: protocol.dosage,
            status: this.fieldValue(form, 'status') || 'taken',
            note: this.fieldValue(form, 'note')
        });
        this.closeModal();
        this.refresh();
        this.toast(this.t('toast_saved'), 'success');
    },

    openHealthModal(date, presetType, existing) {
        const log = existing || null;
        const selectedType = log ? log.type : presetType;
        const types = ['measurement', 'glucose', 'pressure', 'symptom', 'temperature', 'other'];
        const body = `
            <form id="fit-form-health" data-fit-form="health" data-date="${date}" data-id="${log ? log.id : ''}" class="fit-form-grid">
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
                    <input class="fit-input" name="unit" maxlength="24" value="${this.esc(log ? log.unit : '')}" placeholder="mmol/L, mmHg…">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('tags'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <input class="fit-input" name="tags" value="${this.esc(log ? this.parseJson(log.tags, []).join(', ') : '')}" placeholder="fasting, after meal…">
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
        window.DB.saveFitCycleLog({
            log_date: date,
            flow: this.fieldValue(form, 'flow'),
            note: this.fieldValue(form, 'note')
        });
        this.closeModal();
        this.refresh();
        this.toast(this.t('toast_saved'), 'success');
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

    saveDayNote(date, value) {
        window.DB.patchFitDailyLog(date, { note: String(value || '') });
        this.state.dailyMap.set(date, Object.assign({}, this.getDaily(date) || {}, { log_date: date, note: value }));
        this.toast(this.t('toast_saved'), 'success');
    },

    // ---------- Aru daily chat ----------
    getChatMessages(date) {
        if (!(window.DB && window.DB.db)) return [];
        try { return window.DB.getFitChatMessages(date, 80) || []; } catch (error) { return []; }
    },

    buildChatContext(date) {
        const lines = [];
        lines.push('You are Aru inside the Fit & Care plugin, discussing one specific day. Answer in the user\'s language, briefly and supportively.');
        lines.push(`The day being discussed is ${date}. In every FIT command you emit, always pass date="${date}" unless the user explicitly names another day.`);
        lines.push(`This chat is a full interface to the journal: use the [[FIT: ...]] commands from your system instruction to read and write${this.cycleEnabled() ? ' (cycle included)' : ''}. Record casual mentions the same way as in the main chat — food, training, body measurements, sleep, water, steps, mood, symptoms, medication. When the user names food without numbers, estimate calories/protein/carbs/fat yourself and set estimated="1".`);
        lines.push('Use only the journal facts below. Never diagnose, prescribe, suggest doses, or present cycle predictions as contraception. For worrying symptoms, calmly suggest a qualified clinician. Do not output TOOL tags in this chat.');
        const snapshot = window.DB.getFitAruSnapshot(true);
        if (snapshot) lines.push('', snapshot);
        const log = this.getDaily(date) || {};
        const dayBits = [];
        const labels = {
            weight: 'weight kg', body_fat: 'body fat %', muscle_mass: 'muscle kg', water_pct: 'water %',
            bone_mass: 'bone kg', visceral_fat: 'visceral fat', steps: 'steps', sleep_hours: 'sleep h',
            energy: 'energy 1-5', mood: 'mood 1-5', stress: 'stress 1-5', water_ml: 'water ml',
            calories: 'calories', protein: 'protein g', carbs: 'carbs g', fat: 'fat g'
        };
        for (const [field, label] of Object.entries(labels)) {
            if (log[field] !== null && log[field] !== undefined) dayBits.push(`${label}: ${log[field]}`);
        }
        if (dayBits.length) lines.push(`Day ${date} metrics: ${dayBits.join(', ')}.`);
        if (log.note) lines.push(`User's note for ${date}: ${log.note}`);
        const planSession = this.getPlanSessionForDate(date);
        if (planSession && !planSession.isRest) {
            lines.push(`Planned session (week ${planSession.week}): ${planSession.day.title || planSession.day.focus || 'session'}; exercises: ${this.parseExercises(planSession.day.exercises).map((exercise) => this.exerciseLabel(exercise)).join('; ') || 'not specified'}.`);
        } else if (planSession && planSession.isRest) {
            lines.push(`Planned: rest day on ${date}.`);
        } else if (this.state.activePlan) {
            lines.push(`No plan session scheduled on ${date}.`);
        }
        const workouts = this.getWorkouts(date);
        if (workouts.length) {
            lines.push(`Workouts on ${date}: ${workouts.map((workout) => `${workout.title} (${workout.status}${workout.duration_min ? `, ${workout.duration_min} min` : ''}${workout.rpe ? `, RPE ${workout.rpe}` : ''})`).join('; ')}.`);
        }
        const meals = this.getMeals(date);
        if (meals.length) {
            lines.push(`Meals on ${date}: ${meals.map((meal) => {
                const macros = [meal.calories ? `${meal.calories} kcal` : '', meal.protein ? `P ${meal.protein} g` : '', meal.carbs ? `C ${meal.carbs} g` : '', meal.fat ? `F ${meal.fat} g` : ''].filter(Boolean).join(', ');
                const tags = this.parseJson(meal.tags, []);
                return `${meal.meal_time ? meal.meal_time + ' ' : ''}${meal.title}${macros ? ` (${macros})` : ''}${tags.length ? ` [${tags.join(', ')}]` : ''}`;
            }).join('; ')}.`);
        }
        const health = this.getHealthLogs(date);
        if (health.length) {
            lines.push(`Health events on ${date}: ${health.map((event) => `${event.log_time ? event.log_time + ' ' : ''}${event.name || event.type}${event.value !== null && event.value !== undefined ? ` ${event.value}${event.value2 ? '/' + event.value2 : ''}` : ''}${event.unit ? ' ' + event.unit : ''} [${event.status}]`).join('; ')}.`);
        }
        const doses = this.getDosesForDate(date).filter((dose) => dose.time);
        if (doses.length) {
            lines.push(`Medication schedule on ${date}: ${doses.map((dose) => `${dose.protocol.name}${dose.time ? ' ' + dose.time : ''} — ${dose.status || 'not logged'}`).join('; ')}.`);
        }
        const cycle = this.getCycleInfo(date);
        if (cycle.tracking && cycle.hasData) {
            lines.push(`Cycle context: day ${cycle.day}, phase ${this.t(`cycle_phase_${cycle.phase}`)}${cycle.predicted ? ' (predicted)' : ''}. Predicted next period: ${cycle.nextPeriod}. Predictions are estimates and not contraception.`);
        }
        return lines.join('\n');
    },

    async sendChat() {
        if (this.state.chatBusy) return;
        const input = document.getElementById('fit-chat-input');
        const text = String((input ? input.value : '') || '').trim();
        if (!text) return;
        const date = this.state.selectedDate || this.todayKey();
        const llm = window.app && window.app.llm;
        if (!llm || (llm.llmType !== 'custom' && !llm.apiKey)) {
            this.toast(this.t('chat_need_key'), 'error');
            return;
        }
        const previous = this.getChatMessages(date);
        window.DB.saveFitChatMessage(date, 'user', text);
        this.state.chatDraft = '';
        this.state.chatBusy = true;
        this.state.chatError = '';
        if (this.state.view === 'calendar') this.updateDayPanel();
        try {
            // The system prompt carries the journal snapshot and the FIT command
            // contract, so it has to be current before this chat sends anything.
            if (window.app && typeof window.app.updateSystemPrompt === 'function') window.app.updateSystemPrompt();
            const history = previous
                .filter((message) => message.role === 'user' || message.role === 'assistant')
                .slice(-this.MAX_CHAT_HISTORY)
                .map((message) => ({ role: message.role, content: message.content }));
            const context = this.buildChatContext(date);
            const prompt = `${context}\n\n[USER QUESTION]\n${text}`;
            let raw = await llm.sendMessage(history, prompt);
            if (raw === null || raw === undefined) throw new Error('Empty response');
            raw = String(raw);
            const triggers = window.Triggers;
            if (triggers && typeof triggers.processResponseForFitCare === 'function') {
                raw = triggers.processResponseForFitCare(raw, false, date);
            } else {
                raw = raw.replace(/\[\[\s*FIT[\s\S]*?\]\]/gi, '');
            }
            raw = String(raw)
                .replace(/\[\[\s*TOOL[\s\S]*?\]\]/gi, '')
                .replace(/\[\[\s*MEMORY[\s\S]*?\]\]/gi, '')
                .replace(/\[\[\s*ARU_SUGGESTIONS[\s\S]*?\/\s*ARU_SUGGESTIONS\s*\]\]/gi, '')
                .trim();
            window.DB.saveFitChatMessage(date, 'assistant', raw);
        } catch (error) {
            console.error('FitCare chat failed', error);
            this.state.chatError = this.t('chat_failed');
        } finally {
            this.state.chatBusy = false;
            if (this.state.view === 'calendar') {
                this.updateDayPanel();
                setTimeout(() => this.scrollChatToBottom(), 50);
            }
        }
    },

    scrollChatToBottom() {
        const thread = document.getElementById('fit-chat-thread');
        if (thread) thread.scrollTop = thread.scrollHeight;
    }
});
