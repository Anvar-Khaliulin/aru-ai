/*
---ARU-LAB.SPACE---ALMATY---2026---
Customizable Aru Dashboard: macOS-style weather, smart task focus, event calendar,
Fit & Care daily snapshot, and RSS digest across desktop Bento, mobile tabs, and Desktop Mode.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { DB } from './db.js';
import { UI } from './ui.js';
import { Tools } from './tools.js';
import { PluginManager } from './pluginManager.js';

const DONE_COL_RX = /готов|done|выполнен(?:о|ы|а|ные|ный|ная)|заверш|сделан|дайын|аяқтал|complete|finish/i;
const WEEKDAY_MAP = [6, 0, 1, 2, 3, 4, 5]; // JS getDay() -> ISO-style 0=Mon..6=Sun

function pad2(n) {
    return String(n).padStart(2, '0');
}

function isoDateKey(date) {
    const d = date instanceof Date ? date : new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDeadlineParts(raw) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(raw || '').trim());
    if (!m) return null;
    const year = +m[1];
    const month = +m[2];
    const day = +m[3];
    const hasTime = m[4] !== undefined;
    const hour = hasTime ? +m[4] : 23;
    const minute = hasTime ? +m[5] : 59;
    const date = new Date(year, month - 1, day, hour, minute, hasTime ? 0 : 59, 0);
    if (Number.isNaN(date.getTime())) return null;
    return {
        dateKey: `${m[1]}-${m[2]}-${m[3]}`,
        hasTime,
        timeLabel: hasTime ? `${m[4]}:${m[5]}` : '',
        date
    };
}

function asBool(val, fallback = false) {
    if (val === undefined || val === null || val === '') return fallback;
    if (typeof val === 'boolean') return val;
    return String(val) === 'true' || String(val) === '1';
}

export const Dashboard = {
    app: null,
    _open: false,
    _bound: false,
    _mobileTab: 'tasks', // 'tasks' | 'news' | 'fit'
    _calYear: new Date().getFullYear(),
    _calMonth: new Date().getMonth(),
    _calSelected: isoDateKey(new Date()),
    _newsTag: '',
    _showQuickAddTask: false,
    _weatherState: { status: 'idle', data: null, error: '', city: '' },
    _newsState: { status: 'idle', data: null, error: '' },
    _renderedNewsByRoot: new WeakMap(),
    _desktopHost: null,
    _resizeTimer: null,
    _lastMobileState: null,

    init(appInstance) {
        this.app = appInstance;
        if (this._bound || typeof window === 'undefined') return;
        this._bound = true;

        this._lastMobileState = window.innerWidth < 768;

        const refreshAll = () => {
            this.applyHeaderButton();
            if (this._open) this.renderStandardView();
            if (this._desktopHost && window.DesktopMode?.active) this.renderDesktopRail();
        };

        window.addEventListener('aru-session-started', () => {
            this.applyHeaderButton();
        });
        window.addEventListener('task-plugin-update', () => {
            if (this._open) this.renderStandardView();
            if (this._desktopHost && window.DesktopMode?.active) this.renderDesktopRail();
        });
        window.addEventListener('fit-care-update', () => {
            if (this._open) this.renderStandardView();
            if (this._desktopHost && window.DesktopMode?.active) this.renderDesktopRail();
        });
        window.addEventListener('aru-sync-applied', refreshAll);
        window.addEventListener('aru-lang-changed', () => {
            // Re-fetch weather localization if already loaded for a different language
            if (this._weatherState.status === 'ready') {
                this._weatherState.status = 'idle';
                const cfg = this.getConfig();
                if (cfg.widgets.weather && (this._open || (this._desktopHost && window.DesktopMode?.active))) {
                    this.loadWeather(false);
                }
            }
            refreshAll();
        });
        window.addEventListener('aru-user-mode-changed', refreshAll);
        window.addEventListener('resize', () => {
            const isMobile = window.innerWidth < 768;
            if (isMobile === this._lastMobileState) return;
            this._lastMobileState = isMobile;
            clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => {
                if (this._open) this.renderStandardView();
            }, 90);
        });
    },

    t(key, fallback = '') {
        if (state.translations && state.translations[key]) return state.translations[key];
        const pluginTr = PluginManager.getTranslation ? PluginManager.getTranslation(key) : key;
        if (pluginTr && pluginTr !== key) return pluginTr;
        return fallback || key;
    },

    esc(val) {
        return UI.escapeHTML(String(val ?? ''));
    },

    locale() {
        const lang = String(state.lang || 'ru').split('-')[0].toLowerCase();
        if (lang === 'kk') return 'kk-KZ';
        if (lang === 'en') return 'en-US';
        return 'ru-RU';
    },

    getConfig() {
        const s = state.userSettings || {};
        const userMode = s.user_mode || 'adult';
        const isChild = userMode === 'child';
        return {
            showEmpty: asBool(s.dashboard_show_empty, false),
            showStartup: asBool(s.dashboard_show_startup, false),
            headerBtn: asBool(s.dashboard_header_btn, false),
            desktopWidgets: asBool(s.dashboard_desktop_widgets, false),
            weatherCity: String(s.dashboard_weather_city || 'Almaty').trim() || 'Almaty',
            fitPrivate: asBool(s.dashboard_fit_private, false),
            userMode,
            isChild,
            widgets: {
                weather: asBool(s.dashboard_w_weather, true),
                calendar: asBool(s.dashboard_w_calendar, true),
                tasks: asBool(s.dashboard_w_tasks, true),
                news: asBool(s.dashboard_w_news, true),
                fit: !isChild && asBool(s.dashboard_w_fit, true)
            }
        };
    },

    isOpen() {
        return !!this._open;
    },

    shouldShowOnStartup() {
        return this.getConfig().showStartup;
    },

    shouldShowOnEmpty() {
        return this.getConfig().showEmpty;
    },

    hasHeaderButton() {
        return this.getConfig().headerBtn;
    },

    shouldShowOnDesktop() {
        return this.getConfig().desktopWidgets;
    },

    applyHeaderButton() {
        if (typeof document === 'undefined') return;
        const btn = document.getElementById('btn-header-dashboard');
        if (!btn) return;
        const visible = this.hasHeaderButton();
        btn.classList.toggle('hidden', !visible);
        btn.classList.toggle('is-active', visible && this._open);
        btn.setAttribute('aria-pressed', this._open ? 'true' : 'false');
    },

    applySettings({ invalidateWeather = false, invalidateNews = false } = {}) {
        if (invalidateWeather) {
            Tools.clearWeatherCache();
            this._weatherState = { status: 'idle', data: null, error: '', city: '' };
        }
        if (invalidateNews) {
            Tools.clearNewsCache();
            this._newsTag = '';
            this._newsState = { status: 'idle', data: null, error: '' };
        }
        this.applyHeaderButton();

        if (typeof document !== 'undefined') {
            if (window.DesktopMode?.active) {
                const rail = window.DesktopMode.shell?.querySelector('#wd-widgets');
                this.syncDesktopWidgets(rail);
            }
            if (state.tabs.length === 0) {
                this.syncEmptyState();
            } else if (this._open) {
                this.renderStandardView();
                this._ensureAsyncWidgets(false);
            }
        }
    },

    open() {
        if (typeof document === 'undefined') return;
        const view = document.getElementById('dashboard-view');
        if (!view) return;

        this._open = true;
        this._bindInteractiveRoot(view);

        document.getElementById('messages-container')?.classList.add('hidden');
        document.getElementById('chat-placeholder')?.classList.add('hidden');
        document.getElementById('plugin-viewport')?.classList.add('hidden');
        document.getElementById('chat-input-area')?.classList.remove('hidden');
        document.getElementById('btn-tools-trigger')?.classList.remove('hidden');
        document.getElementById('chapters-fab')?.classList.add('hidden');
        document.getElementById('chapters-panel')?.classList.add('hidden');

        // Visually hide Canvas without overwriting activeTab.isCanvasOpen.
        window.ChatController?.syncCanvasChrome?.(false);

        view.classList.remove('hidden');
        this.applyHeaderButton();
        window.ChatController?.renderTabs?.();

        // Hide mobile slide-over sidebar if open
        if (window.innerWidth < 768) {
            const sidebar = document.getElementById('sidebar');
            const backdrop = document.getElementById('sidebar-backdrop');
            if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
                sidebar.classList.add('-translate-x-full');
                if (backdrop) backdrop.classList.add('hidden');
            }
        }

        this.renderStandardView();
        this._ensureAsyncWidgets(false);
    },

    close({ restoreTab = false, silent = false } = {}) {
        if (typeof document === 'undefined') {
            this._open = false;
            return;
        }
        const wasOpen = this._open;
        this._open = false;
        const view = document.getElementById('dashboard-view');
        if (view) view.classList.add('hidden');
        this.applyHeaderButton();

        if (!silent && restoreTab && state.tabs.length > 0 && wasOpen) {
            const idx = (state.activeTabIndex >= 0 && state.activeTabIndex < state.tabs.length) ? state.activeTabIndex : 0;
            this.app?.switchTab?.(idx);
            return;
        }

        if (!silent && state.tabs.length === 0) {
            const placeholder = document.getElementById('chat-placeholder');
            if (placeholder && !this.shouldShowOnEmpty()) {
                placeholder.classList.remove('hidden');
            }
        }
    },

    toggle() {
        if (this._open) {
            if (state.tabs.length > 0) {
                this.close({ restoreTab: true });
            } else {
                this.renderStandardView();
            }
            return;
        }
        this.open();
    },

    syncEmptyState() {
        if (typeof document === 'undefined') return;
        if (state.tabs.length > 0) return;

        if (this.shouldShowOnEmpty() && !window.DesktopMode?.active) {
            this.open();
        } else {
            this.close({ silent: true });
            document.getElementById('messages-container')?.classList.remove('hidden');
            document.getElementById('chat-placeholder')?.classList.remove('hidden');
            document.getElementById('chat-input-area')?.classList.remove('hidden');
            document.getElementById('btn-tools-trigger')?.classList.remove('hidden');
        }
    },

    // ---------- Desktop Mode right-rail widgets ----------

    syncDesktopWidgets(hostEl) {
        this._desktopHost = hostEl || this._desktopHost || null;
        if (!this._desktopHost) return;

        if (!this.shouldShowOnDesktop()) {
            this._desktopHost.classList.add('hidden');
            this._desktopHost.replaceChildren();
            return;
        }

        this._bindInteractiveRoot(this._desktopHost);
        this._desktopHost.classList.remove('hidden');
        this.renderDesktopRail();
        window.DesktopMode?.syncWidgetFocusState?.();
        this._ensureAsyncWidgets(false);
    },

    unmountDesktopWidgets() {
        if (this._desktopHost) {
            this._desktopHost.classList.add('hidden');
            this._desktopHost.replaceChildren();
        }
        this._desktopHost = null;
    },

    // ---------- Data Collectors (pure / testable) ----------

    _getTaskProjects() {
        const plugin = typeof window !== 'undefined' ? window.TaskPlugin : null;
        if (plugin && plugin._dbReady && plugin.state && Array.isArray(plugin.state.projects)) {
            return plugin.state.projects;
        }
        const saved = DB.getPluginData ? DB.getPluginData('task') : null;
        if (saved && Array.isArray(saved.projects)) return saved.projects;
        if (plugin && plugin.state && Array.isArray(plugin.state.projects)) return plugin.state.projects;
        return [];
    },

    collectTasksSummary({ maxItems = 6, now = new Date() } = {}) {
        const projects = this._getTaskProjects();
        const todayKey = isoDateKey(now);
        const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59, 999);
        const nowMs = now.getTime();
        const active = [];

        projects.forEach((proj, pIdx) => {
            const cols = Array.isArray(proj?.columns) ? proj.columns : [];
            cols.forEach((col, cIdx) => {
                // Single-column boards never hide all tasks as "Done"
                const isDoneCol = cols.length > 1 && DONE_COL_RX.test(String(col?.title || ''));
                if (isDoneCol) return;
                const tasks = Array.isArray(col?.tasks) ? col.tasks : [];
                tasks.forEach((task, tIdx) => {
                    if (task && task.done) return;
                    const parsed = parseDeadlineParts(task.deadline);
                    let bucket = 4;
                    let isOverdue = false;
                    let isToday = false;
                    let sortTs = Number.MAX_SAFE_INTEGER;

                    if (parsed) {
                        sortTs = parsed.date.getTime();
                        if (parsed.hasTime ? (sortTs < nowMs) : (parsed.dateKey < todayKey)) {
                            isOverdue = true;
                            bucket = 0;
                        } else if (parsed.dateKey === todayKey) {
                            isToday = true;
                            bucket = 1;
                        } else if (sortTs <= weekEnd.getTime()) {
                            bucket = 2;
                        } else {
                            bucket = 3;
                        }
                    }

                    const subs = Array.isArray(task.subtasks) ? task.subtasks : [];
                    active.push({
                        projectId: proj.id,
                        projectName: proj.name || '',
                        colId: col.id,
                        colTitle: col.title || '',
                        taskId: task.id,
                        title: task.title || '',
                        desc: task.desc || '',
                        deadline: task.deadline || '',
                        priority: String(task.priority || '').toLowerCase(),
                        tags: Array.isArray(task.tags) ? task.tags : [],
                        subtaskDone: subs.filter(s => s && s.done).length,
                        subtaskTotal: subs.length,
                        dateKey: parsed ? parsed.dateKey : '',
                        timeLabel: parsed ? parsed.timeLabel : '',
                        isOverdue,
                        isToday,
                        bucket,
                        sortTs,
                        orderKey: pIdx * 100000 + cIdx * 1000 + tIdx
                    });
                });
            });
        });

        let overdueCount = 0;
        let todayCount = 0;
        let upcomingCount = 0;
        active.forEach(t => {
            if (t.isOverdue) overdueCount++;
            else if (t.isToday) todayCount++;
            else if (t.bucket === 2) upcomingCount++;
        });

        const prioWeight = { urgent: 0, high: 1, medium: 2, low: 3, none: 4, '': 4 };
        active.sort((a, b) => {
            if (a.bucket !== b.bucket) return a.bucket - b.bucket;
            if (a.sortTs !== b.sortTs) return a.sortTs - b.sortTs;
            const pa = prioWeight[a.priority] ?? 4;
            const pb = prioWeight[b.priority] ?? 4;
            if (pa !== pb) return pa - pb;
            return a.orderKey - b.orderKey;
        });

        return {
            hasProjects: projects.length > 0,
            totalActive: active.length,
            overdueCount,
            todayCount,
            upcomingCount,
            items: active.slice(0, Math.max(0, maxItems))
        };
    },

    collectCalendarEvents(year, month, now = new Date()) {
        const firstKey = `${year}-${pad2(month + 1)}-01`;
        const lastDay = new Date(year, month + 1, 0).getDate();
        const lastKey = `${year}-${pad2(month + 1)}-${pad2(lastDay)}`;
        const todayKey = isoDateKey(now);
        const nowMs = now.getTime();
        const map = {};
        const ensure = (k) => {
            if (!map[k]) map[k] = { overdue: [], tasks: [], fitWorkouts: [], fitPlans: [], hasFitLog: false };
            return map[k];
        };

        // 1. Task deadlines
        const projects = this._getTaskProjects();
        for (const proj of projects) {
            const cols = Array.isArray(proj?.columns) ? proj.columns : [];
            for (const col of cols) {
                const isDoneCol = cols.length > 1 && DONE_COL_RX.test(String(col?.title || ''));
                if (isDoneCol) continue;
                for (const task of (col?.tasks || [])) {
                    if (task && task.done) continue;
                    const parsed = parseDeadlineParts(task.deadline);
                    if (!parsed) continue;
                    const entry = ensure(parsed.dateKey);
                    const isOverdue = parsed.hasTime ? (parsed.date.getTime() < nowMs) : (parsed.dateKey < todayKey);
                    const row = {
                        projectId: proj.id,
                        projectName: proj.name || '',
                        colId: col.id,
                        taskId: task.id,
                        title: task.title || '',
                        timeLabel: parsed.timeLabel,
                        isOverdue
                    };
                    if (isOverdue) entry.overdue.push(row);
                    else entry.tasks.push(row);
                }
            }
        }

        // 2. Fit & Care workouts & training plans (strictly excluded in Child Mode; no cycle/intimacy)
        const cfg = this.getConfig();
        if (!cfg.isChild && DB.db) {
            try {
                if (typeof DB.getFitWorkouts === 'function') {
                    const workouts = DB.getFitWorkouts(firstKey, lastKey) || [];
                    for (const w of workouts) {
                        const wDate = w && (w.log_date || w.workout_date);
                        if (!wDate || w.status === 'skipped') continue;
                        ensure(wDate).fitWorkouts.push({
                            title: w.title || '',
                            status: w.status || 'done',
                            time: w.log_time || w.workout_time || '',
                            duration: w.duration_min || null
                        });
                    }
                }
                if (typeof DB.getFitDailyLogs === 'function') {
                    const logs = DB.getFitDailyLogs(firstKey, lastKey) || [];
                    for (const l of logs) {
                        if (!l || !l.log_date) continue;
                        if (l.steps || l.calories || l.sleep_hours || l.water_ml || l.weight || l.workout_status) {
                            ensure(l.log_date).hasFitLog = true;
                        }
                    }
                }
                if (typeof DB.getFitMeals === 'function') {
                    const calMeals = DB.getFitMeals(firstKey, lastKey) || [];
                    for (const m of calMeals) {
                        if (m && m.log_date) ensure(m.log_date).hasFitLog = true;
                    }
                }
                if (typeof DB.getFitPlans === 'function' && typeof DB.getFitPlanDays === 'function') {
                    const activePlans = DB.getFitPlans('active') || [];
                    const plan = activePlans[0];
                    if (plan) {
                        const planDays = DB.getFitPlanDays(plan.id) || [];
                        if (planDays.length > 0) {
                            const startKey = plan.start_date || firstKey;
                            const startDate = new Date(`${startKey}T12:00:00`);
                            const weekStart = new Date(startDate);
                            weekStart.setDate(startDate.getDate() - ((startDate.getDay() + 6) % 7));
                            const totalWeeks = Math.max(1, Number(plan.weeks) || 4);
                            for (let dNum = 1; dNum <= lastDay; dNum++) {
                                const cur = new Date(year, month, dNum, 12, 0, 0);
                                const key = isoDateKey(cur);
                                if (key < startKey) continue;
                                const diffFromWeek = Math.floor((cur.getTime() - weekStart.getTime()) / 86400000);
                                if (diffFromWeek < 0 || diffFromWeek >= totalWeeks * 7) continue;
                                const weekNum = Math.floor(diffFromWeek / 7) + 1;
                                const weekday = WEEKDAY_MAP[cur.getDay()] + 1; // 1=Mon..7=Sun
                                const match = planDays.find(pd => Number(pd.week_index) === weekNum && Number(pd.weekday) === weekday)
                                    || planDays.find(pd => Number(pd.week_index) === 0 && Number(pd.weekday) === weekday);
                                if (match && (match.title || match.focus) && !ensure(key).fitWorkouts.length) {
                                    ensure(key).fitPlans.push({
                                        title: match.title || match.focus || '',
                                        planTitle: plan.title || ''
                                    });
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('Dashboard.collectCalendarEvents fit query failed:', e);
            }
        }

        return map;
    },

    collectDayAgenda(dateKey, now = new Date()) {
        const parts = String(dateKey || '').split('-').map(Number);
        const y = parts[0] || now.getFullYear();
        const m = (parts[1] || (now.getMonth() + 1)) - 1;
        const map = this.collectCalendarEvents(y, m, now);
        const day = map[dateKey] || { overdue: [], tasks: [], fitWorkouts: [], fitPlans: [], hasFitLog: false };
        return {
            dateKey,
            overdue: day.overdue,
            tasks: day.tasks,
            fitWorkouts: day.fitWorkouts,
            fitPlans: day.fitPlans,
            hasFitLog: day.hasFitLog,
            isEmpty: !day.overdue.length && !day.tasks.length && !day.fitWorkouts.length && !day.fitPlans.length && !day.hasFitLog
        };
    },

    collectFitSummary(now = new Date()) {
        const cfg = this.getConfig();
        if (cfg.isChild) {
            return { allowed: false, hasData: false };
        }
        if (!DB.db || typeof DB.hasFitData !== 'function' || !DB.hasFitData()) {
            return { allowed: true, hasData: false };
        }

        const todayKey = isoDateKey(now);
        const daily = DB.getFitDailyLog?.(todayKey) || {};
        const meals = DB.getFitMeals?.(todayKey, todayKey) || [];
        const workouts = (DB.getFitWorkouts?.(todayKey, todayKey) || []).filter(w => w && w.status !== 'skipped');
        const primaryWorkout = workouts.find(w => w.status === 'done') || workouts[0] || null;
        const plans = DB.getFitPlans?.('active') || [];
        const todayDow = WEEKDAY_MAP[now.getDay()] + 1;
        const protocols = (DB.getFitProtocols?.(true) || []).filter(p => {
            if (!p || !p.active) return false;
            try {
                const sched = typeof p.schedule === 'string' ? JSON.parse(p.schedule || '{}') : (p.schedule || {});
                const days = Array.isArray(sched.days) ? sched.days.map(Number).filter(Boolean) : [];
                return !days.length || days.includes(todayDow);
            } catch (_) {
                return true;
            }
        });
        const healthLogs = DB.getFitHealthLogs?.(todayKey, todayKey) || [];

        let calories = null;
        if (typeof DB.getFitDayNutrition === 'function') {
            calories = DB.getFitDayNutrition(todayKey, daily, meals).calories;
        } else {
            calories = daily.calories ?? null;
            if (calories === null && meals.length > 0) {
                const sum = meals.reduce((acc, m) => acc + (Number(m.calories) || 0), 0);
                if (sum > 0) calories = Math.round(sum);
            }
        }

        let planToday = null;
        if (plans[0] && typeof DB.getFitPlanDayForDate === 'function') {
            try {
                const startKey = plans[0].start_date || todayKey;
                if (todayKey >= startKey) {
                    const startDate = new Date(`${startKey}T12:00:00`);
                    const weekStart = new Date(startDate);
                    weekStart.setDate(startDate.getDate() - ((startDate.getDay() + 6) % 7));
                    const diffFromWeek = Math.floor((now.getTime() - weekStart.getTime()) / 86400000);
                    const totalWeeks = Math.max(1, Number(plans[0].weeks) || 4);
                    if (diffFromWeek >= 0 && diffFromWeek < totalWeeks * 7) {
                        const weekIdx = Math.floor(diffFromWeek / 7) + 1;
                        const weekday = WEEKDAY_MAP[now.getDay()] + 1;
                        planToday = DB.getFitPlanDayForDate(plans[0].id, weekIdx, weekday) || null;
                    }
                }
            } catch (_) {
                planToday = null;
            }
        }

        const medsTotal = protocols.length;
        const medsTaken = medsTotal > 0
            ? protocols.filter(p => healthLogs.some(l => l.protocol_id === p.id && l.status === 'taken')).length
            : 0;

        let weight = null;
        if (!cfg.fitPrivate) {
            weight = daily.weight ?? DB.getFitLatestWeight?.()?.weight ?? null;
        }

        return {
            allowed: true,
            hasData: true,
            fitPrivate: cfg.fitPrivate,
            waterMl: daily.water_ml ?? null,
            calories,
            sleepHours: daily.sleep_hours ?? null,
            steps: daily.steps ?? null,
            weight,
            workout: primaryWorkout,
            planToday: planToday && (planToday.title || planToday.focus) ? planToday : null,
            medsTaken,
            medsTotal
        };
    },

    weatherVisual(code, isDay = true) {
        const c = Number(code);
        if (c === 0) {
            return {
                theme: isDay ? 'is-clear-day' : 'is-night',
                icon: isDay ? 'sun' : 'moon',
                labelKey: isDay ? 'dashboard_weather_clear' : 'dashboard_weather_clear_night',
                fallback: isDay ? 'Clear' : 'Clear night'
            };
        }
        if (c === 1 || c === 2) {
            return {
                theme: isDay ? 'is-partly-day' : 'is-night',
                icon: isDay ? 'cloud-sun' : 'cloud-moon',
                labelKey: 'dashboard_weather_partly',
                fallback: 'Partly cloudy'
            };
        }
        if (c === 3 || c === 45 || c === 48) {
            return {
                theme: isDay ? 'is-cloudy' : 'is-night',
                icon: 'cloud',
                labelKey: c >= 45 ? 'dashboard_weather_fog' : 'dashboard_weather_cloudy',
                fallback: c >= 45 ? 'Fog' : 'Cloudy'
            };
        }
        if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) {
            return {
                theme: 'is-rain',
                icon: 'cloud-rain',
                labelKey: 'dashboard_weather_rain',
                fallback: 'Rain'
            };
        }
        if ((c >= 71 && c <= 77) || c === 85 || c === 86) {
            return {
                theme: 'is-snow',
                icon: 'cloud-snow',
                labelKey: 'dashboard_weather_snow',
                fallback: 'Snow'
            };
        }
        if (c >= 95) {
            return {
                theme: 'is-storm',
                icon: 'cloud-lightning',
                labelKey: 'dashboard_weather_storm',
                fallback: 'Thunderstorm'
            };
        }
        return {
            theme: isDay ? 'is-partly-day' : 'is-night',
            icon: 'cloud-sun',
            labelKey: 'dashboard_weather_partly',
            fallback: 'Cloudy'
        };
    },

    // ---------- Actions ----------

    markTaskDone(projectId, colId, taskId) {
        const plugin = typeof window !== 'undefined' ? window.TaskPlugin : null;
        if (plugin && !plugin._dbReady && typeof plugin.loadFromDB === 'function') {
            plugin._dbReady = !!(DB && DB.db);
            plugin.loadFromDB();
        }
        const projects = this._getTaskProjects();
        const proj = projects.find(p => String(p.id) === String(projectId));
        if (!proj || !Array.isArray(proj.columns)) return false;

        const srcCol = proj.columns.find(c => String(c.id) === String(colId));
        if (!srcCol || !Array.isArray(srcCol.tasks)) return false;
        const idx = srcCol.tasks.findIndex(t => String(t.id) === String(taskId));
        if (idx === -1) return false;

        const doneCol = proj.columns.find(c => c.id !== srcCol.id && DONE_COL_RX.test(String(c.title || '')))
            || (proj.columns.length > 1 ? proj.columns[proj.columns.length - 1] : null);
        const task = srcCol.tasks[idx];
        task.done = true;
        task.completedAt = new Date().toISOString();

        if (doneCol && doneCol.id !== srcCol.id) {
            srcCol.tasks.splice(idx, 1);
            doneCol.tasks = Array.isArray(doneCol.tasks) ? doneCol.tasks : [];
            doneCol.tasks.unshift(task);
        }

        if (plugin) {
            plugin.state.projects = projects;
            plugin.saveState();
            if (plugin._domMounted) {
                plugin.renderProjects?.();
                plugin.renderBoard?.();
            }
        } else if (DB && typeof DB.savePluginData === 'function') {
            DB.savePluginData('task', { projects, activeProjectId: proj.id });
        }

        UI.showToast?.(this.t('dashboard_task_completed', 'Задача выполнена'), 'check');
        if (this._open) this.renderStandardView();
        if (this._desktopHost && window.DesktopMode?.active) this.renderDesktopRail();
        return true;
    },

    quickAddTask(title, deadlineDate = '') {
        const cleanTitle = String(title || '').trim();
        if (!cleanTitle) return false;
        const plugin = typeof window !== 'undefined' ? window.TaskPlugin : null;
        if (plugin && !plugin._dbReady && DB && DB.db) {
            plugin._dbReady = true;
            plugin.loadFromDB();
        }
        const projects = this._getTaskProjects();
        let targetProj = projects.find(p => String(p.id) === String(plugin?.state?.activeProjectId)) || projects[0];
        if (!targetProj && plugin && typeof plugin.getDefaultColumns === 'function') {
            targetProj = {
                id: 'p-' + Date.now().toString(36),
                name: this.t('task_seed_project', 'My Tasks'),
                columns: plugin.getDefaultColumns()
            };
            projects.push(targetProj);
        }
        if (!targetProj || !Array.isArray(targetProj.columns) || !targetProj.columns.length) return false;

        const targetCol = targetProj.columns.find(c => !DONE_COL_RX.test(String(c.title || ''))) || targetProj.columns[0];
        targetCol.tasks = Array.isArray(targetCol.tasks) ? targetCol.tasks : [];
        targetCol.tasks.push({
            id: 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            title: cleanTitle,
            desc: '',
            deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(deadlineDate || '').trim()) ? `${deadlineDate.trim()}T12:00` : ''
        });

        if (plugin) {
            plugin.state.projects = projects;
            if (!plugin.state.activeProjectId) plugin.state.activeProjectId = targetProj.id;
            plugin.saveState();
            if (plugin._domMounted) {
                plugin.renderProjects?.();
                plugin.renderBoard?.();
            }
        } else if (DB && typeof DB.savePluginData === 'function') {
            DB.savePluginData('task', { projects, activeProjectId: targetProj.id });
        }

        UI.showToast?.(this.t('dashboard_task_added', 'Задача добавлена'), 'plus');
        return true;
    },

    // ---------- Async Widget Loaders ----------

    _ensureAsyncWidgets(force = false) {
        const cfg = this.getConfig();
        const activeSurface = this._open || (this._desktopHost && window.DesktopMode?.active);
        if (!activeSurface) return;

        if (cfg.widgets.weather && (force || this._weatherState.status === 'idle' || this._weatherState.city !== cfg.weatherCity)) {
            this.loadWeather(force);
        }
        if (cfg.widgets.news && (force || this._newsState.status === 'idle')) {
            this.loadNews(force);
        }
    },

    async loadWeather(force = false) {
        const cfg = this.getConfig();
        if (!cfg.widgets.weather) return;
        const targetCity = cfg.weatherCity;
        this._weatherState = { status: 'loading', data: this._weatherState.data, error: '', city: targetCity };
        this._refreshRenderedSurfaces();

        try {
            const data = await Tools.fetchWeatherData(targetCity, { force });
            if (this.getConfig().weatherCity !== targetCity) return;
            this._weatherState = { status: 'ready', data, error: '', city: targetCity };
        } catch (err) {
            if (this.getConfig().weatherCity !== targetCity) return;
            this._weatherState = {
                status: 'error',
                data: null,
                error: err?.code === 'CITY_NOT_FOUND'
                    ? this.t('dashboard_weather_city_not_found', 'Город не найден')
                    : this.t('dashboard_weather_error', 'Не удалось загрузить погоду'),
                city: targetCity
            };
        }
        this._refreshRenderedSurfaces();
    },

    async loadNews(force = false) {
        const cfg = this.getConfig();
        if (!cfg.widgets.news) return;
        const urls = this.app?.getRSSUrls ? this.app.getRSSUrls() : String(state.userSettings?.rss_urls || '').split('\n').map(s => s.trim()).filter(Boolean);
        this._newsState = { status: 'loading', data: this._newsState.data, error: '' };
        this._refreshRenderedSurfaces();

        try {
            const data = await Tools.fetchNewsItems(urls, { filterTag: this._newsTag, maxItems: 10, force });
            this._newsState = { status: 'ready', data, error: '' };
        } catch (err) {
            this._newsState = {
                status: 'error',
                data: null,
                error: this.t('dashboard_news_error', 'Не удалось загрузить ленту новостей')
            };
        }
        this._refreshRenderedSurfaces();
    },

    _refreshRenderedSurfaces() {
        if (this._open) this.renderStandardView();
        if (this._desktopHost && window.DesktopMode?.active) this.renderDesktopRail();
    },

    // ---------- HTML Builders ----------

    _greetingInfo() {
        const hour = new Date().getHours();
        let key = 'dashboard_greeting_morning';
        let fb = 'Доброе утро';
        if (hour >= 12 && hour < 17) { key = 'dashboard_greeting_day'; fb = 'Добрый день'; }
        else if (hour >= 17 && hour < 23) { key = 'dashboard_greeting_evening'; fb = 'Добрый вечер'; }
        else if (hour < 5) { key = 'dashboard_greeting_night'; fb = 'Доброй ночи'; }

        const mood = Number(state.personality?.mood ?? 50);
        let mascot = 'normal';
        if (mood > 85) mascot = 'wow';
        else if (mood > 65) mascot = 'happy';
        else if (mood < 25) mascot = 'sad';
        else if (mood < 42) mascot = 'thinking';

        const rawName = String(state.userSettings?.user_name || '').trim();
        const showName = rawName && !/^(user|пользователь)$/i.test(rawName);
        const dateLabel = new Date().toLocaleDateString(this.locale(), { weekday: 'long', day: 'numeric', month: 'long' });

        return {
            greeting: showName ? `${this.t(key, fb)}, ${rawName}!` : `${this.t(key, fb)}!`,
            mascot,
            dateLabel: dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)
        };
    },

    _renderWeatherCardHTML({ compact = false, macRail = false } = {}) {
        const cfg = this.getConfig();
        const st = this._weatherState;
        const clsExtra = `${compact ? 'is-compact' : ''} ${macRail ? 'wd-widget-card' : ''}`.trim();

        if (st.status === 'loading' && !st.data) {
            return `
            <section class="dash-weather-card is-partly-day ${clsExtra}" aria-label="${this.esc(this.t('dashboard_w_weather', 'Погода'))}">
                <div class="dash-weather-head">
                    <div>
                        <div class="dash-weather-city">${this.esc(cfg.weatherCity)}</div>
                        <div class="dash-weather-cond">${this.esc(this.t('dashboard_loading', 'Загрузка...'))}</div>
                    </div>
                    <div class="dash-weather-temp">--°</div>
                </div>
            </section>`;
        }

        if (st.status === 'error' || !st.data) {
            return `
            <section class="dash-weather-card is-cloudy ${clsExtra}">
                <div class="dash-weather-head">
                    <div class="min-w-0">
                        <div class="dash-weather-city flex items-center gap-1.5">
                            <i data-lucide="map-pin" class="w-3.5 h-3.5 shrink-0"></i>
                            <span class="truncate">${this.esc(cfg.weatherCity)}</span>
                        </div>
                        <div class="dash-weather-cond mt-1">${this.esc(st.error || this.t('dashboard_weather_error', 'Погода недоступна'))}</div>
                    </div>
                    <button type="button" data-dash-action="refresh-weather" class="dash-weather-refresh" title="${this.esc(this.t('dashboard_refresh', 'Обновить'))}">
                        <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                    </button>
                </div>
            </section>`;
        }

        const w = st.data;
        const cur = w.current;
        const vis = this.weatherVisual(cur.code, cur.isDay);
        const condText = this.t(vis.labelKey, vis.fallback);
        const todayDaily = w.daily[0] || { min: cur.temp, max: cur.temp };
        const hourSlice = w.hourly.slice(0, compact ? 4 : 6);

        if (compact) {
            return `
            <section class="dash-weather-card ${vis.theme} ${clsExtra}">
                <div class="dash-weather-head">
                    <div class="min-w-0">
                        <div class="dash-weather-city flex items-center gap-1.5">
                            <i data-lucide="map-pin" class="w-3.5 h-3.5 shrink-0 opacity-90"></i>
                            <span class="truncate">${this.esc(w.name)}</span>
                        </div>
                        <div class="dash-weather-cond">${this.esc(condText)} · ${this.esc(this.t('dashboard_weather_feels', 'Ощущ.'))} ${cur.feelsLike}°</div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <i data-lucide="${vis.icon}" class="w-6 h-6 opacity-95"></i>
                        <span class="dash-weather-temp">${cur.temp}°</span>
                        <button type="button" data-dash-action="refresh-weather" class="dash-weather-refresh" title="${this.esc(this.t('dashboard_refresh', 'Обновить'))}">
                            <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </div>
                ${hourSlice.length ? `
                <div class="dash-weather-hourly is-compact">
                    ${hourSlice.map((h, idx) => {
                        const hVis = this.weatherVisual(h.code, h.isDay);
                        return `
                        <div class="dash-hour-item">
                            <span class="dash-hour-time">${idx === 0 ? this.esc(this.t('dashboard_now', 'Сейчас')) : this.esc(h.hourLabel)}</span>
                            <i data-lucide="${hVis.icon}" class="w-4 h-4"></i>
                            <span class="dash-hour-temp">${h.temp}°</span>
                        </div>`;
                    }).join('')}
                </div>` : ''}
            </section>`;
        }

        const weekAllTemps = w.daily.flatMap(d => [d.min, d.max]);
        const weekMin = Math.min(...weekAllTemps);
        const weekSpan = Math.max(1, Math.max(...weekAllTemps) - weekMin);
        const loc = this.locale();

        return `
        <section class="dash-weather-card ${vis.theme} ${clsExtra}">
            <div class="dash-weather-head">
                <div class="min-w-0">
                    <div class="dash-weather-city flex items-center gap-1.5">
                        <i data-lucide="map-pin" class="w-4 h-4 shrink-0 opacity-90"></i>
                        <span class="truncate">${this.esc(w.name)}</span>
                        ${w.country ? `<span class="dash-weather-country truncate">${this.esc(w.country)}</span>` : ''}
                    </div>
                    <div class="dash-weather-cond">${this.esc(condText)}</div>
                    <div class="dash-weather-meta">
                        <span>${this.esc(this.t('dashboard_weather_feels', 'Ощущ.'))} ${cur.feelsLike}°</span>
                        <span>·</span>
                        <span>H:${todayDaily.max}° L:${todayDaily.min}°</span>
                        <span>·</span>
                        <span><i data-lucide="wind" class="w-3 h-3 inline -mt-0.5"></i> ${cur.wind} ${this.esc(cur.windUnit)}</span>
                        <span>·</span>
                        <span><i data-lucide="droplets" class="w-3 h-3 inline -mt-0.5"></i> ${cur.humidity}%</span>
                    </div>
                </div>
                <div class="flex items-start gap-2 shrink-0">
                    <div class="dash-weather-now-right">
                        <i data-lucide="${vis.icon}" class="w-8 h-8 opacity-95"></i>
                        <span class="dash-weather-temp">${cur.temp}°</span>
                    </div>
                    <button type="button" data-dash-action="refresh-weather" class="dash-weather-refresh" title="${this.esc(this.t('dashboard_refresh', 'Обновить'))}">
                        <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            </div>

            ${hourSlice.length ? `
            <div class="dash-weather-hourly">
                ${hourSlice.map((h, idx) => {
                    const hVis = this.weatherVisual(h.code, h.isDay);
                    return `
                    <div class="dash-hour-item">
                        <span class="dash-hour-time">${idx === 0 ? this.esc(this.t('dashboard_now', 'Сейчас')) : this.esc(h.hourLabel)}</span>
                        <i data-lucide="${hVis.icon}" class="w-4 h-4"></i>
                        <span class="dash-hour-temp">${h.temp}°</span>
                    </div>`;
                }).join('')}
            </div>` : ''}

            ${w.daily.length > 1 ? `
            <div class="dash-weather-daily">
                ${w.daily.slice(0, 4).map((d, idx) => {
                    const dVis = this.weatherVisual(d.code, true);
                    const dayObj = new Date(`${d.date}T12:00:00`);
                    const dayLabel = idx === 0
                        ? this.t('dashboard_today', 'Сегодня')
                        : dayObj.toLocaleDateString(loc, { weekday: 'short' });
                    const leftPct = Math.round(((d.min - weekMin) / weekSpan) * 100);
                    const widthPct = Math.max(12, Math.round(((d.max - d.min) / weekSpan) * 100));
                    return `
                    <div class="dash-day-row">
                        <span class="dash-day-name">${this.esc(dayLabel)}</span>
                        <i data-lucide="${dVis.icon}" class="w-4 h-4 shrink-0"></i>
                        <span class="dash-day-low">${d.min}°</span>
                        <div class="dash-temp-bar">
                            <span class="dash-temp-fill" style="left:${leftPct}%;width:${Math.min(100 - leftPct, widthPct)}%"></span>
                        </div>
                        <span class="dash-day-high">${d.max}°</span>
                    </div>`;
                }).join('')}
            </div>` : ''}
        </section>`;
    },

    _renderCalendarCardHTML({ macRail = false } = {}) {
        const now = new Date();
        const year = this._calYear;
        const month = this._calMonth;
        const loc = this.locale();
        const todayKey = isoDateKey(now);
        const events = this.collectCalendarEvents(year, month, now);

        const first = new Date(year, month, 1);
        const startOffset = (first.getDay() + 6) % 7;
        const prevDays = new Date(year, month, 0).getDate();
        const currentDays = new Date(year, month + 1, 0).getDate();

        const cells = [];
        for (let i = 0; i < 42; i++) {
            const num = i - startOffset + 1;
            let date;
            let other = false;
            if (num < 1) {
                date = new Date(year, month - 1, prevDays + num);
                other = true;
            } else if (num > currentDays) {
                date = new Date(year, month + 1, num - currentDays);
                other = true;
            } else {
                date = new Date(year, month, num);
            }
            const key = isoDateKey(date);
            const ev = events[key];
            const dots = [];
            if (ev?.overdue?.length) dots.push('<span class="dash-cal-dot is-overdue"></span>');
            if (ev?.tasks?.length) dots.push('<span class="dash-cal-dot is-task"></span>');
            if (ev?.fitWorkouts?.length || ev?.fitPlans?.length || ev?.hasFitLog) dots.push('<span class="dash-cal-dot is-fit"></span>');

            const cls = [
                'dash-cal-cell',
                other ? 'is-other' : '',
                key === todayKey ? 'is-today' : '',
                key === this._calSelected ? 'is-selected' : ''
            ].filter(Boolean).join(' ');

            cells.push(`
                <button type="button" class="${cls}" data-dash-cal-date="${key}">
                    <span>${date.getDate()}</span>
                    <span class="dash-cal-dots">${dots.join('')}</span>
                </button>
            `);
        }

        const dows = Array.from({ length: 7 }, (_, idx) => {
            const lbl = new Date(2024, 0, 1 + idx).toLocaleDateString(loc, { weekday: 'short' });
            return `<div class="dash-cal-dow">${this.esc(lbl)}</div>`;
        }).join('');

        const title = first.toLocaleDateString(loc, { month: 'long', year: 'numeric' });
        const agenda = this.collectDayAgenda(this._calSelected, now);
        const selDateObj = new Date(`${this._calSelected}T12:00:00`);
        const selLabel = this._calSelected === todayKey
            ? this.t('dashboard_today', 'Сегодня')
            : selDateObj.toLocaleDateString(loc, { day: 'numeric', month: 'short' });

        const agendaRows = [];
        agenda.overdue.slice(0, macRail ? 2 : 4).forEach(t => {
            agendaRows.push(`
                <button type="button" class="dash-agenda-row is-overdue" data-dash-action="launch-task">
                    <span class="dash-agenda-dot"></span>
                    <span class="truncate">${this.esc(t.title)}</span>
                    ${t.timeLabel ? `<span class="dash-agenda-time">${this.esc(t.timeLabel)}</span>` : ''}
                </button>`);
        });
        agenda.tasks.slice(0, macRail ? 2 : 4).forEach(t => {
            agendaRows.push(`
                <button type="button" class="dash-agenda-row is-task" data-dash-action="launch-task">
                    <span class="dash-agenda-dot"></span>
                    <span class="truncate">${this.esc(t.title)}</span>
                    ${t.timeLabel ? `<span class="dash-agenda-time">${this.esc(t.timeLabel)}</span>` : ''}
                </button>`);
        });
        agenda.fitWorkouts.slice(0, 2).forEach(w => {
            agendaRows.push(`
                <button type="button" class="dash-agenda-row is-fit" data-dash-action="launch-fit" data-date="${this.esc(this._calSelected)}">
                    <span class="dash-agenda-dot"></span>
                    <span class="truncate">${this.esc(w.title || this.t('dashboard_fit_workout', 'Тренировка'))}</span>
                    ${w.time ? `<span class="dash-agenda-time">${this.esc(w.time)}</span>` : ''}
                </button>`);
        });
        if (!agenda.fitWorkouts.length && agenda.fitPlans.length) {
            agenda.fitPlans.slice(0, 1).forEach(p => {
                agendaRows.push(`
                    <button type="button" class="dash-agenda-row is-fit" data-dash-action="launch-fit" data-date="${this.esc(this._calSelected)}">
                        <span class="dash-agenda-dot"></span>
                        <span class="truncate">${this.esc(p.title)}</span>
                    </button>`);
            });
        }

        return `
        <section class="dash-card ${macRail ? 'wd-widget-card' : ''}">
            <div class="dash-card-head">
                <div class="dash-card-title">
                    <i data-lucide="calendar" class="w-4 h-4 text-aru-500 shrink-0"></i>
                    <span class="capitalize">${this.esc(title)}</span>
                </div>
                <div class="flex items-center gap-1">
                    <button type="button" class="dash-icon-btn" data-dash-action="cal-prev" title="${this.esc(this.t('dashboard_prev_month', 'Предыдущий месяц'))}">
                        <i data-lucide="chevron-left" class="w-4 h-4"></i>
                    </button>
                    <button type="button" class="dash-mini-pill" data-dash-action="cal-today">${this.esc(this.t('dashboard_today', 'Сегодня'))}</button>
                    <button type="button" class="dash-icon-btn" data-dash-action="cal-next" title="${this.esc(this.t('dashboard_next_month', 'Следующий месяц'))}">
                        <i data-lucide="chevron-right" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
            <div class="dash-cal-dows">${dows}</div>
            <div class="dash-cal-grid">${cells.join('')}</div>
            <div class="dash-cal-agenda">
                <div class="dash-cal-agenda-head">${this.esc(selLabel)}</div>
                ${agendaRows.length
                    ? `<div class="space-y-1">${agendaRows.join('')}</div>`
                    : `<p class="dash-empty-inline">${this.esc(this.t('dashboard_cal_no_events', 'На этот день дел нет'))}</p>`}
            </div>
        </section>`;
    },

    _renderTasksCardHTML({ maxItems = 6, macRail = false } = {}) {
        const sum = this.collectTasksSummary({ maxItems });
        const todayKey = isoDateKey(new Date());

        return `
        <section class="dash-card ${macRail ? 'wd-widget-card' : ''}">
            <div class="dash-card-head">
                <button type="button" class="dash-card-title hover:text-aru-500 transition-colors" data-dash-action="launch-task">
                    <i data-lucide="check-square" class="w-4 h-4 text-aru-500 shrink-0"></i>
                    <span>${this.esc(this.t('dashboard_tasks_focus', 'Фокус задач'))}</span>
                </button>
                <div class="flex items-center gap-1.5">
                    ${!macRail ? `
                    <button type="button" class="dash-icon-btn ${this._showQuickAddTask ? 'is-active' : ''}" data-dash-action="toggle-quick-task" title="${this.esc(this.t('dashboard_task_add', 'Быстрая задача'))}">
                        <i data-lucide="plus" class="w-4 h-4"></i>
                    </button>` : ''}
                </div>
            </div>

            <div class="dash-task-counters">
                <button type="button" class="dash-counter-pill is-overdue" data-dash-action="launch-task">
                    <span class="dash-counter-num">${sum.overdueCount}</span>
                    <span class="dash-counter-lbl">${this.esc(this.t('dashboard_tasks_overdue', 'Просрочено'))}</span>
                </button>
                <button type="button" class="dash-counter-pill is-today" data-dash-action="launch-task">
                    <span class="dash-counter-num">${sum.todayCount}</span>
                    <span class="dash-counter-lbl">${this.esc(this.t('dashboard_today', 'Сегодня'))}</span>
                </button>
                <button type="button" class="dash-counter-pill" data-dash-action="launch-task">
                    <span class="dash-counter-num">${sum.totalActive}</span>
                    <span class="dash-counter-lbl">${this.esc(this.t('dashboard_tasks_active', 'Всего'))}</span>
                </button>
            </div>

            ${(!macRail && this._showQuickAddTask) ? `
            <form class="dash-quick-task-form" data-dash-form="quick-task">
                <input type="text" name="title" required maxlength="140" class="dash-quick-task-input"
                    placeholder="${this.esc(this.t('dashboard_task_placeholder', 'Новая задача...'))}">
                <input type="date" name="deadline" value="${todayKey}" class="dash-quick-task-date">
                <button type="submit" class="dash-quick-task-save">${this.esc(this.t('dashboard_add', 'Добавить'))}</button>
            </form>` : ''}

            ${sum.items.length ? `
            <div class="dash-task-list">
                ${sum.items.map(t => {
                    const cls = t.isOverdue ? 'is-overdue' : (t.isToday ? 'is-today' : '');
                    const dlLabel = t.dateKey
                        ? (t.dateKey === todayKey
                            ? `${this.t('dashboard_today', 'Сегодня')}${t.timeLabel ? ` ${t.timeLabel}` : ''}`
                            : `${new Date(`${t.dateKey}T12:00:00`).toLocaleDateString(this.locale(), { day: 'numeric', month: 'short' })}${t.timeLabel ? ` ${t.timeLabel}` : ''}`)
                        : '';
                    return `
                    <div class="dash-task-row ${cls}">
                        <button type="button" class="dash-task-check"
                            data-dash-action="complete-task"
                            data-proj-id="${this.esc(t.projectId)}"
                            data-col-id="${this.esc(t.colId)}"
                            data-task-id="${this.esc(t.taskId)}"
                            title="${this.esc(this.t('dashboard_task_complete', 'Отметить выполненной'))}">
                            <i data-lucide="check" class="w-3 h-3"></i>
                        </button>
                        <div class="min-w-0 flex-1">
                            <div class="dash-task-title truncate flex items-center gap-1.5">
                                ${(t.priority === 'urgent' || t.priority === 'high') ? `<span class="w-1.5 h-1.5 rounded-full shrink-0 ${t.priority === 'urgent' ? 'bg-red-500' : 'bg-orange-500'}"></span>` : ''}
                                <span class="truncate">${this.esc(t.title)}</span>
                            </div>
                            <div class="dash-task-sub">
                                <span class="truncate">${this.esc(t.projectName)}</span>
                                ${t.subtaskTotal > 0 ? `<span class="dash-task-due">${t.subtaskDone}/${t.subtaskTotal}</span>` : ''}
                                ${dlLabel ? `<span class="dash-task-due ${cls}">${this.esc(dlLabel)}</span>` : ''}
                            </div>
                        </div>
                    </div>`;
                }).join('')}
            </div>` : `
            <div class="dash-empty-box">
                <i data-lucide="sparkles" class="w-5 h-5 text-aru-500 opacity-80"></i>
                <span>${this.esc(this.t('dashboard_tasks_empty', 'Активных задач нет — можно выдохнуть!'))}</span>
            </div>`}

            <button type="button" class="dash-card-footer-link" data-dash-action="launch-task">
                <span>${this.esc(this.t('dashboard_tasks_all', 'Открыть доску задач'))}${sum.totalActive > 0 ? ` (${sum.totalActive})` : ''}</span>
                <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
            </button>
        </section>`;
    },

    _renderFitCardHTML({ macRail = false } = {}) {
        const fit = this.collectFitSummary();
        if (!fit.allowed) return '';

        if (!fit.hasData) {
            return `
            <section class="dash-card ${macRail ? 'wd-widget-card' : ''}">
                <div class="dash-card-head">
                    <button type="button" class="dash-card-title hover:text-aru-500 transition-colors" data-dash-action="launch-fit">
                        <i data-lucide="heart-pulse" class="w-4 h-4 text-emerald-500 shrink-0"></i>
                        <span>${this.esc(this.t('plugin_fit_care_name', 'Fit & Care'))}</span>
                    </button>
                </div>
                <div class="dash-empty-box">
                    <i data-lucide="activity" class="w-5 h-5 text-emerald-500 opacity-80"></i>
                    <span>${this.esc(this.t('dashboard_fit_empty', 'Записывайте воду, питание, сон и тренировки прямо в чате или в журнале Fit & Care.'))}</span>
                </div>
                <button type="button" class="dash-card-footer-link" data-dash-action="launch-fit">
                    <span>${this.esc(this.t('dashboard_fit_open', 'Открыть Fit & Care'))}</span>
                    <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                </button>
            </section>`;
        }

        const tiles = [
            { icon: 'droplets', color: 'text-sky-500', label: this.t('dashboard_fit_water', 'Вода'), val: fit.waterMl !== null ? `${fit.waterMl} ml` : '—' },
            { icon: 'flame', color: 'text-orange-500', label: this.t('dashboard_fit_kcal', 'Ккал'), val: fit.calories !== null ? String(fit.calories) : '—' },
            { icon: 'moon', color: 'text-indigo-500', label: this.t('dashboard_fit_sleep', 'Сон'), val: fit.sleepHours !== null ? `${fit.sleepHours} h` : '—' },
            { icon: 'footprints', color: 'text-emerald-500', label: this.t('dashboard_fit_steps', 'Шаги'), val: fit.steps !== null ? Number(fit.steps).toLocaleString(this.locale()) : '—' }
        ];
        if (!fit.fitPrivate && fit.weight !== null && !macRail) {
            tiles.push({ icon: 'scale', color: 'text-violet-500', label: this.t('dashboard_fit_weight', 'Вес'), val: `${fit.weight} kg` });
        }

        const workoutLine = fit.workout
            ? `${fit.workout.title || this.t('dashboard_fit_workout', 'Тренировка')} · ${fit.workout.status === 'done' ? this.t('dashboard_done', 'выполнено') : this.t('dashboard_planned', 'по плану')}`
            : (fit.planToday ? `${this.t('dashboard_planned', 'По плану')}: ${fit.planToday.title || fit.planToday.focus}` : '');

        return `
        <section class="dash-card ${macRail ? 'wd-widget-card' : ''}">
            <div class="dash-card-head">
                <button type="button" class="dash-card-title hover:text-aru-500 transition-colors" data-dash-action="launch-fit">
                    <i data-lucide="heart-pulse" class="w-4 h-4 text-emerald-500 shrink-0"></i>
                    <span>${this.esc(this.t('dashboard_fit_today', 'Здоровье сегодня'))}</span>
                </button>
                ${fit.medsTotal > 0 ? `
                <span class="dash-mini-pill">
                    <i data-lucide="pill" class="w-3 h-3 text-emerald-500"></i>
                    ${fit.medsTaken}/${fit.medsTotal}
                </span>` : ''}
            </div>

            <div class="dash-fit-grid ${macRail ? 'is-compact' : ''}">
                ${tiles.slice(0, macRail ? 4 : 5).map(tile => `
                <div class="dash-fit-tile">
                    <i data-lucide="${tile.icon}" class="w-4 h-4 ${tile.color}"></i>
                    <span class="dash-fit-val">${this.esc(tile.val)}</span>
                    <span class="dash-fit-lbl">${this.esc(tile.label)}</span>
                </div>`).join('')}
            </div>

            ${workoutLine ? `
            <div class="dash-fit-status">
                <i data-lucide="dumbbell" class="w-3.5 h-3.5 text-emerald-500 shrink-0"></i>
                <span class="truncate">${this.esc(workoutLine)}</span>
            </div>` : ''}

            <button type="button" class="dash-card-footer-link" data-dash-action="launch-fit">
                <span>${this.esc(this.t('dashboard_fit_open', 'Открыть Fit & Care'))}</span>
                <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
            </button>
        </section>`;
    },

    _renderNewsCardHTML(rootEl, { maxItems = 8, macRail = false } = {}) {
        const st = this._newsState;
        const urls = this.app?.getRSSUrls ? this.app.getRSSUrls() : String(state.userSettings?.rss_urls || '').split('\n').map(s => s.trim()).filter(Boolean);

        if (!urls.length) {
            return `
            <section class="dash-card ${macRail ? 'wd-widget-card' : ''}">
                <div class="dash-card-head">
                    <div class="dash-card-title">
                        <i data-lucide="rss" class="w-4 h-4 text-aru-500 shrink-0"></i>
                        <span>${this.esc(this.t('dashboard_w_news', 'Новости'))}</span>
                    </div>
                </div>
                <div class="dash-empty-box">
                    <i data-lucide="newspaper" class="w-5 h-5 text-aru-500 opacity-80"></i>
                    <span>${this.esc(this.t('dashboard_news_no_feeds', 'Добавьте RSS-ленты в настройках, чтобы видеть свежие заголовки и обсуждать их с Ару.'))}</span>
                </div>
                <button type="button" class="dash-card-footer-link" data-dash-action="open-rss-settings">
                    <span>${this.esc(this.t('dashboard_news_setup', 'Настроить RSS'))}</span>
                    <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                </button>
            </section>`;
        }

        const data = st.data || { items: [], availableTags: [], feedErrors: 0 };
        const items = Array.isArray(data.items) ? data.items.slice(0, maxItems) : [];
        if (rootEl) this._renderedNewsByRoot.set(rootEl, items);

        const tags = Array.isArray(data.availableTags) ? data.availableTags : [];
        const tagBar = (!macRail && tags.length > 0) ? `
            <div class="dash-news-tags">
                <button type="button" class="dash-tag-chip ${!this._newsTag ? 'is-active' : ''}" data-dash-news-tag="">${this.esc(this.t('dashboard_all', 'Все'))}</button>
                ${tags.map(tag => `
                    <button type="button" class="dash-tag-chip ${this._newsTag.toLowerCase() === tag.toLowerCase() ? 'is-active' : ''}" data-dash-news-tag="${this.esc(tag)}">#${this.esc(tag)}</button>
                `).join('')}
            </div>` : '';

        let bodyHTML = '';
        if (st.status === 'loading' && !items.length) {
            bodyHTML = `<div class="dash-empty-box"><i data-lucide="loader-2" class="w-5 h-5 text-aru-500 animate-spin"></i><span>${this.esc(this.t('dashboard_loading', 'Загрузка...'))}</span></div>`;
        } else if (st.status === 'error' && !items.length) {
            bodyHTML = `<div class="dash-empty-box"><i data-lucide="cloud-off" class="w-5 h-5 text-gray-400"></i><span>${this.esc(st.error || this.t('dashboard_news_error', 'Не удалось загрузить новости'))}</span></div>`;
        } else if (!items.length) {
            bodyHTML = `<div class="dash-empty-box"><i data-lucide="rss" class="w-5 h-5 text-gray-400"></i><span>${this.esc(this.t('msg_rss_no_news', 'Новостей не найдено'))}</span></div>`;
        } else {
            bodyHTML = `
            <div class="dash-news-grid ${macRail ? 'is-rail' : ''}">
                ${items.map((item, idx) => `
                <article class="dash-news-item">
                    ${(!macRail && item.imgUrl) ? `
                    <div class="dash-news-thumb">
                        <img src="${this.esc(item.imgUrl)}" alt="" loading="lazy" onerror="this.parentElement.remove()">
                    </div>` : ''}
                    <div class="min-w-0 flex-1 flex flex-col justify-between gap-1.5">
                        <div class="dash-news-title">${this.esc(item.title)}</div>
                        <div class="dash-news-meta">
                            <span class="dash-news-source truncate">${this.esc(item.source)}</span>
                            <div class="flex items-center gap-1 shrink-0 ml-auto">
                                ${item.link ? `<a href="${this.esc(item.link)}" target="_blank" rel="noopener noreferrer" class="dash-news-btn" title="${this.esc(this.t('action_open', 'Открыть'))}"><i data-lucide="external-link" class="w-3.5 h-3.5"></i></a>` : ''}
                                <button type="button" class="dash-news-btn is-accent" data-dash-action="discuss-news" data-news-idx="${idx}" title="${this.esc(this.t('news_discuss_btn', 'Обсудить с Ару'))}">
                                    <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </article>`).join('')}
            </div>`;
        }

        return `
        <section class="dash-card ${macRail ? 'wd-widget-card' : ''}">
            <div class="dash-card-head">
                <div class="dash-card-title">
                    <i data-lucide="rss" class="w-4 h-4 text-aru-500 shrink-0"></i>
                    <span>${this.esc(this.t('dashboard_w_news', 'Новости'))}</span>
                </div>
                <div class="flex items-center gap-1">
                    <button type="button" class="dash-icon-btn" data-dash-action="refresh-news" title="${this.esc(this.t('dashboard_refresh', 'Обновить'))}">
                        <i data-lucide="refresh-cw" class="w-3.5 h-3.5 ${st.status === 'loading' ? 'animate-spin' : ''}"></i>
                    </button>
                </div>
            </div>
            ${tagBar}
            ${bodyHTML}
        </section>`;
    },

    // ---------- View Renderers ----------

    renderStandardView() {
        if (typeof document === 'undefined') return;
        const root = document.getElementById('dashboard-view');
        if (!root) return;

        const cfg = this.getConfig();
        const w = cfg.widgets;
        const greet = this._greetingInfo();
        const canCloseToChat = state.tabs.length > 0;
        const isMobile = window.innerWidth < 768;

        const headerHTML = `
        <header class="dash-header">
            <div class="dash-header-greet">
                <img src="media/emotions/${greet.mascot}.png" alt="Aru" class="dash-fox-badge">
                <div class="min-w-0">
                    <h2 class="dash-greet-title truncate">${this.esc(greet.greeting)}</h2>
                    <p class="dash-greet-date truncate">${this.esc(greet.dateLabel)}</p>
                </div>
            </div>
            ${canCloseToChat ? `
            <div class="dash-header-actions">
                <button type="button" class="dash-icon-btn" data-dash-action="close-dashboard" title="${this.esc(this.t('dashboard_back_to_chat', 'Вернуться к чату'))}">
                    <i data-lucide="x" class="w-4 h-4"></i>
                </button>
            </div>` : ''}
        </header>`;

        const anyWidgetEnabled = w.weather || w.calendar || w.tasks || w.news || w.fit;
        if (!anyWidgetEnabled) {
            root.innerHTML = `
            <div class="dash-shell">
                ${headerHTML}
                <div class="dash-card dash-all-off">
                    <i data-lucide="layout-dashboard" class="w-8 h-8 text-aru-500 opacity-80"></i>
                    <p class="text-sm font-medium">${this.esc(this.t('dashboard_all_widgets_off', 'Все виджеты скрыты. Включите нужные в настройках дашборда.'))}</p>
                    <button type="button" class="dash-chip is-primary" data-dash-action="open-dash-settings">${this.esc(this.t('dashboard_open_settings', 'Настроить виджеты'))}</button>
                </div>
            </div>`;
            window.lucide?.createIcons?.();
            return;
        }

        if (isMobile) {
            // Smart mobile layout: compact Weather strip + segmented [Tasks/Calendar] | [News] | [Fit & Care]
            const segs = [];
            if (w.tasks || w.calendar) segs.push({ id: 'tasks', icon: w.tasks ? 'check-square' : 'calendar', label: this.t('dashboard_tab_agenda', 'Дела') });
            if (w.news) segs.push({ id: 'news', icon: 'rss', label: this.t('dashboard_w_news', 'Новости') });
            if (w.fit) segs.push({ id: 'fit', icon: 'heart-pulse', label: this.t('dashboard_tab_fit', 'Здоровье') });

            if (!segs.some(s => s.id === this._mobileTab)) {
                this._mobileTab = segs[0]?.id || 'tasks';
            }

            let tabBodyHTML = '';
            if (this._mobileTab === 'tasks') {
                const parts = [];
                if (w.tasks) parts.push(this._renderTasksCardHTML({ maxItems: 6 }));
                if (w.calendar) parts.push(this._renderCalendarCardHTML());
                tabBodyHTML = `<div class="space-y-3">${parts.join('')}</div>`;
            } else if (this._mobileTab === 'news') {
                tabBodyHTML = this._renderNewsCardHTML(root, { maxItems: 6 });
            } else if (this._mobileTab === 'fit') {
                tabBodyHTML = this._renderFitCardHTML();
            }

            root.innerHTML = `
            <div class="dash-shell is-mobile">
                ${headerHTML}
                ${w.weather ? this._renderWeatherCardHTML({ compact: true }) : ''}
                ${segs.length > 1 ? `
                <div class="dash-mobile-tabs" role="tablist">
                    ${segs.map(s => `
                    <button type="button" role="tab" aria-selected="${this._mobileTab === s.id}"
                        class="dash-mobile-tab ${this._mobileTab === s.id ? 'is-active' : ''}"
                        data-dash-mobile-tab="${s.id}">
                        <i data-lucide="${s.icon}" class="w-3.5 h-3.5"></i>
                        <span>${this.esc(s.label)}</span>
                    </button>`).join('')}
                </div>` : ''}
                ${tabBodyHTML}
            </div>`;
            window.lucide?.createIcons?.();
            return;
        }

        // Desktop Bento 12-column responsive layout (auto-expands cards cleanly when neighbors are disabled)
        const slots = [];
        if (w.weather && w.calendar) {
            slots.push(`<div class="dash-slot span-7">${this._renderWeatherCardHTML()}</div>`);
            slots.push(`<div class="dash-slot span-5">${this._renderCalendarCardHTML()}</div>`);
        } else if (w.weather) {
            slots.push(`<div class="dash-slot span-12">${this._renderWeatherCardHTML()}</div>`);
        } else if (w.calendar) {
            slots.push(`<div class="dash-slot span-12">${this._renderCalendarCardHTML()}</div>`);
        }

        if (w.tasks) {
            slots.push(`<div class="dash-slot span-12">${this._renderTasksCardHTML({ maxItems: 6 })}</div>`);
        }
        if (w.fit) {
            slots.push(`<div class="dash-slot span-12">${this._renderFitCardHTML()}</div>`);
        }

        if (w.news) {
            slots.push(`<div class="dash-slot span-12">${this._renderNewsCardHTML(root, { maxItems: 8 })}</div>`);
        }

        root.innerHTML = `
        <div class="dash-shell">
            ${headerHTML}
            <div class="dash-bento">${slots.join('')}</div>
        </div>`;
        window.lucide?.createIcons?.();
    },

    renderDesktopRail() {
        const rail = this._desktopHost;
        if (!rail || !this.shouldShowOnDesktop()) return;

        const cfg = this.getConfig();
        const w = cfg.widgets;

        const leftBlocks = [];
        if (w.weather) leftBlocks.push(this._renderWeatherCardHTML({ compact: false, macRail: true }));
        if (w.news) leftBlocks.push(this._renderNewsCardHTML(rail, { maxItems: w.weather ? 4 : 6, macRail: true }));

        const rightBlocks = [];
        if (w.calendar) rightBlocks.push(this._renderCalendarCardHTML({ macRail: true }));
        if (w.tasks) rightBlocks.push(this._renderTasksCardHTML({ maxItems: (w.calendar && w.fit) ? 3 : 4, macRail: true }));
        if (w.fit) rightBlocks.push(this._renderFitCardHTML({ macRail: true }));

        const cleanLeft = leftBlocks.filter(Boolean);
        const cleanRight = rightBlocks.filter(Boolean);

        const cols = [];
        if (cleanLeft.length) cols.push(`<div class="wd-widgets-col is-wide">${cleanLeft.join('')}</div>`);
        if (cleanRight.length) cols.push(`<div class="wd-widgets-col is-side">${cleanRight.join('')}</div>`);

        if (!cols.length) {
            rail.innerHTML = '';
            return;
        }
        rail.innerHTML = cols.join('');
        window.lucide?.createIcons?.();
    },

    // ---------- Delegated Interactions ----------

    _bindInteractiveRoot(root) {
        if (!root || root.dataset.dashBound === '1') return;
        root.dataset.dashBound = '1';

        root.addEventListener('click', async (e) => {
            const tabBtn = e.target.closest('[data-dash-mobile-tab]');
            if (tabBtn && root.contains(tabBtn)) {
                this._mobileTab = tabBtn.dataset.dashMobileTab || 'tasks';
                this.renderStandardView();
                return;
            }

            const tagBtn = e.target.closest('[data-dash-news-tag]');
            if (tagBtn && root.contains(tagBtn)) {
                this._newsTag = tagBtn.dataset.dashNewsTag || '';
                this.loadNews(false);
                return;
            }

            const calDateBtn = e.target.closest('[data-dash-cal-date]');
            if (calDateBtn && root.contains(calDateBtn)) {
                const key = calDateBtn.dataset.dashCalDate;
                if (key) {
                    const [y, m] = key.split('-').map(Number);
                    this._calSelected = key;
                    if (y && m) {
                        this._calYear = y;
                        this._calMonth = m - 1;
                    }
                    if (this._open && root.id === 'dashboard-view') this.renderStandardView();
                    else if (this._desktopHost && window.DesktopMode?.active) this.renderDesktopRail();
                }
                return;
            }

            const actionEl = e.target.closest('[data-dash-action]');
            if (!actionEl || !root.contains(actionEl)) return;

            const action = actionEl.dataset.dashAction;
            const hostApp = this.app || window.app;
            const isRail = root.id === 'wd-widgets';

            switch (action) {
                case 'close-dashboard':
                    this.close({ restoreTab: true });
                    break;
                case 'open-dash-settings':
                    hostApp?.openSettings?.('dashboard');
                    break;
                case 'open-rss-settings':
                    hostApp?.openSettings?.('rss');
                    break;
                case 'launch-task':
                    if (!isRail) this.close({ silent: true });
                    hostApp?.launchPlugin?.('task');
                    break;
                case 'launch-fit': {
                    const targetDate = actionEl.dataset.date;
                    if (!isRail) this.close({ silent: true });
                    hostApp?.launchPlugin?.('fit-care');
                    if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) && !this.getConfig().isChild) {
                        setTimeout(() => {
                            if (window.FitCarePlugin?.openDayPanel && window.FitCarePlugin?._root) {
                                window.FitCarePlugin.openDayPanel(targetDate, 'day');
                            }
                        }, 60);
                    }
                    break;
                }
                case 'refresh-weather':
                    this.loadWeather(true);
                    break;
                case 'refresh-news':
                    this.loadNews(true);
                    break;
                case 'cal-prev': {
                    const d = new Date(this._calYear, this._calMonth - 1, 1);
                    this._calYear = d.getFullYear();
                    this._calMonth = d.getMonth();
                    if (this._open && !isRail) this.renderStandardView();
                    else if (this._desktopHost && window.DesktopMode?.active) this.renderDesktopRail();
                    break;
                }
                case 'cal-next': {
                    const d = new Date(this._calYear, this._calMonth + 1, 1);
                    this._calYear = d.getFullYear();
                    this._calMonth = d.getMonth();
                    if (this._open && !isRail) this.renderStandardView();
                    else if (this._desktopHost && window.DesktopMode?.active) this.renderDesktopRail();
                    break;
                }
                case 'cal-today': {
                    const now = new Date();
                    this._calYear = now.getFullYear();
                    this._calMonth = now.getMonth();
                    this._calSelected = isoDateKey(now);
                    if (this._open && !isRail) this.renderStandardView();
                    else if (this._desktopHost && window.DesktopMode?.active) this.renderDesktopRail();
                    break;
                }
                case 'toggle-quick-task':
                    this._showQuickAddTask = !this._showQuickAddTask;
                    this.renderStandardView();
                    if (this._showQuickAddTask) {
                        root.querySelector('.dash-quick-task-input')?.focus();
                    }
                    break;
                case 'complete-task':
                    this.markTaskDone(
                        actionEl.dataset.projId,
                        actionEl.dataset.colId,
                        actionEl.dataset.taskId
                    );
                    break;
                case 'discuss-news': {
                    const list = this._renderedNewsByRoot.get(root) || [];
                    const idx = Number(actionEl.dataset.newsIdx);
                    const item = Number.isInteger(idx) ? list[idx] : null;
                    if (!item) return;
                    if (!isRail) this.close({ silent: true });
                    window.ChatController?.discussNews?.(
                        item.title,
                        item.link || '',
                        item.desc || '',
                        item.full || item.desc || '',
                        { forceNewChat: true }
                    );
                    break;
                }
                default:
                    break;
            }
        });

        root.addEventListener('submit', (e) => {
            const form = e.target.closest('[data-dash-form="quick-task"]');
            if (!form || !root.contains(form)) return;
            e.preventDefault();
            const title = form.querySelector('[name="title"]')?.value || '';
            const deadline = form.querySelector('[name="deadline"]')?.value || '';
            if (this.quickAddTask(title, deadline)) {
                this._showQuickAddTask = false;
                this.renderStandardView();
                if (this._desktopHost && window.DesktopMode?.active) this.renderDesktopRail();
            }
        });
    }
};
