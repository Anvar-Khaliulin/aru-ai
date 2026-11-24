/*
---ARU-LAB.SPACE---ALMATY---2026---
Aru Fit & Care — calendar, de-duplicated day panel and modern Aru day chat.
---chat.aru-lab.space---PWA---
*/
window.FitCarePlugin = window.FitCarePlugin || {};

Object.assign(window.FitCarePlugin, {
    renderCalendarView() {
        const container = document.getElementById('fit-view');
        if (!container) return;
        const summary = this.calendarSummary();
        const wideChat = this.state.dayTab === 'aru' && this.state.chatWide;
        container.innerHTML = `
            <div class="fit-page">
                <div class="fit-page-head is-compact">
                    <h2>${this.esc(this.t('nav_calendar'))}</h2>
                    <div class="fit-row">${summary}</div>
                </div>
                <div class="fit-cal-toolbar">
                    <button type="button" class="fit-btn-icon" data-fit-action="cal-prev" aria-label="${this.esc(this.t('cal_prev'))}">
                        <i data-lucide="chevron-left"></i>
                    </button>
                    <h3 class="fit-cal-title">${this.esc(this.calendarTitle())}</h3>
                    <button type="button" class="fit-btn-icon" data-fit-action="cal-next" aria-label="${this.esc(this.t('cal_next'))}">
                        <i data-lucide="chevron-right"></i>
                    </button>
                    <button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="cal-today">${this.esc(this.t('today'))}</button>
                    <div class="fit-spacer"></div>
                    <div class="fit-range-switch" role="group">
                        <button type="button" data-fit-action="cal-mode" data-mode="month" class="${this.state.calendarMode === 'month' ? 'is-active' : ''}">${this.esc(this.t('cal_month_view'))}</button>
                        <button type="button" data-fit-action="cal-mode" data-mode="week" class="${this.state.calendarMode === 'week' ? 'is-active' : ''}">${this.esc(this.t('cal_week_view'))}</button>
                    </div>
                </div>
                ${this.renderCycleNotice()}
                <div class="fit-cal-layout ${wideChat ? 'is-chat-wide' : ''}">
                    <section class="fit-calendar-card">
                        ${this.state.calendarMode === 'week' ? this.renderWeekView() : this.renderMonthView()}
                        ${this.renderCalendarLegend()}
                    </section>
                    ${this.renderDayPanel()}
                </div>
            </div>
        `;
        if (this.state.dayTab === 'aru') {
            setTimeout(() => this.scrollChatToBottom(), 40);
        }
    },

    calendarTitle() {
        if (this.state.calendarMode === 'week') {
            const start = this.dateKey(this.startOfWeek(this.state.cursor));
            const end = this.addDays(start, 6);
            return `${this.formatShortDate(start)} – ${this.formatShortDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
        }
        return this.state.cursor.toLocaleDateString(this.state.lang, { month: 'long', year: 'numeric' });
    },

    calendarSummary() {
        const cursor = this.state.cursor;
        let activeFrom;
        let activeTo;
        if (this.state.calendarMode === 'week') {
            activeFrom = this.dateKey(this.startOfWeek(cursor));
            activeTo = this.addDays(activeFrom, 6);
        } else {
            activeFrom = this.dateKey(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
            activeTo = this.dateKey(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
        }
        const daily = Array.from(this.state.dailyMap.values());
        const weighed = daily.filter((log) => log.weight !== null && log.weight !== undefined && log.log_date);
        const latest = weighed.reduce((best, item) => (!best || item.log_date > best.log_date ? item : best), null);
        const workouts = Array.from(this.state.workoutsByDate.values()).flat().filter((workout) => (
            workout.status === 'done' && workout.log_date >= activeFrom && workout.log_date <= activeTo
        ));
        const cycle = this.getCycleInfo(this.todayKey());
        const badges = [];
        if (latest) {
            badges.push(`<span class="fit-badge fit-badge-violet"><i data-lucide="scale"></i>${this.esc(this.fmt(latest.weight))} ${this.esc(this.t('kg'))}</span>`);
        }
        badges.push(`<span class="fit-badge fit-badge-green"><i data-lucide="dumbbell"></i>${this.esc(this.t('workouts_done', { n: workouts.length }))}</span>`);
        if (cycle.tracking && cycle.hasData) {
            if (cycle.paused) {
                badges.push(`<span class="fit-badge"><i data-lucide="pause-circle"></i>${this.esc(this.t('cycle_phase_paused'))}</span>`);
            } else if (cycle.confidence === 'late') {
                badges.push(`<span class="fit-badge fit-badge-amber"><i data-lucide="clock"></i>${this.esc(this.t('cycle_late', { day: cycle.day, late: cycle.lateDays }))}</span>`);
            } else if (cycle.day) {
                const forecast = cycle.confidence !== 'recorded';
                badges.push(`<span class="fit-badge fit-badge-accent" title="${this.esc(this.t('cycle_day'))} ${cycle.day} · ${this.esc(this.t(`cycle_phase_${cycle.phase}`))}${forecast ? ` · ${this.esc(this.t('cycle_forecast'))}` : ''}"><i data-lucide="droplet"></i>${this.esc(this.t('cycle_day'))} ${cycle.day}${forecast ? ` · ${this.esc(this.t('cycle_forecast_short'))}` : ''}</span>`);
            }
        }
        if (this.state.activePlan) {
            badges.push(`<span class="fit-badge"><i data-lucide="target"></i>${this.esc(this.state.activePlan.title)}</span>`);
        }
        return badges.join('');
    },

    renderCycleNotice() {
        const cycle = this.getCycleInfo(this.todayKey());
        if (!cycle.tracking || !cycle.hasData) return '';
        if (cycle.confidence === 'recorded' || cycle.confidence === 'too_far') return '';

        if (cycle.paused || cycle.confidence === 'paused') {
            const days = cycle.daysSinceLastStartToday ?? cycle.daysSinceLastStart;
            const text = this.t('cycle_paused_desc', {
                date: this.formatShortDate(cycle.lastStart),
                days
            });
            return `<div class="fit-alert fit-alert-info" style="margin:0 0 12px;align-items:center">
                <i data-lucide="pause-circle"></i>
                <span class="fit-grow">${this.esc(text)}</span>
                <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="cycle-start" data-date="${this.todayKey()}">${this.esc(this.t('cycle_resume'))}</button>
            </div>`;
        }

        if (cycle.confidence === 'late') {
            const text = this.t('cycle_late_desc', {
                late: cycle.lateDays || 1,
                avg: cycle.avg,
                date: this.formatShortDate(cycle.lastStart)
            });
            return `<div class="fit-alert fit-alert-warn" style="margin:0 0 12px;align-items:center">
                <i data-lucide="calendar-clock"></i>
                <span class="fit-grow">${this.esc(text)}</span>
                <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="cycle-start" data-date="${this.todayKey()}">${this.esc(this.t('cycle_resume'))}</button>
            </div>`;
        }

        const text = this.t('cycle_forecast_warning', {
            date: this.formatShortDate(cycle.nextPeriod)
        });
        return `<div class="fit-alert fit-alert-warn" style="margin:0 0 12px;align-items:center">
            <i data-lucide="calendar-clock"></i>
            <span class="fit-grow">${this.esc(text)}</span>
            <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="cycle-start" data-date="${this.todayKey()}">${this.esc(this.t('cycle_mark_start'))}</button>
        </div>`;
    },

    renderCalendarLegend() {
        const items = [
            ['scale', 'cal_mark_weight', 'weight'],
            ['dumbbell', 'cal_mark_workout', 'workout-done'],
            ['utensils', 'cal_mark_meal', 'meal'],
            ['pill', 'cal_mark_med', 'med']
        ];
        if (this.cycleEnabled()) items.push(['droplet', 'cal_mark_cycle', 'cycle']);
        if (this.state.showPrivate && this.intimacyEnabled()) items.push(['lock', 'cal_mark_intimacy', 'intimacy']);
        return `
            <div class="fit-chart-legend" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--fit-border)">
                ${items.map(([icon, label, cls]) => `<span class="fit-legend-item"><span class="fit-mark ${cls}"><i data-lucide="${icon}"></i></span>${this.esc(this.t(label))}</span>`).join('')}
            </div>
        `;
    },

    renderMonthView() {
        const cursor = this.state.cursor;
        const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        const gridStart = this.startOfWeek(first);
        const startKey = this.dateKey(gridStart);
        const thisMonth = cursor.getMonth();
        let cells = '';
        for (let index = 0; index < 42; index++) {
            const key = this.addDays(startKey, index);
            const outside = this.dateFromKey(key).getMonth() !== thisMonth;
            cells += this.renderDayCell(key, outside);
        }
        const weekdays = [1, 2, 3, 4, 5, 6, 7]
            .map((day) => `<span>${this.esc(this.t(`weekday_${day}`))}</span>`)
            .join('');
        return `
            <div class="fit-weekdays">${weekdays}</div>
            <div class="fit-cal-grid">${cells}</div>
        `;
    },

    renderDayCell(key, outside) {
        const today = this.todayKey();
        const log = this.getDaily(key) || {};
        const workouts = this.getWorkouts(key);
        const meals = this.getMeals(key);
        const health = this.getHealthLogs(key);
        const cycleLog = this.getCycleLog(key);
        const cycle = this.getCycleInfo(key);
        const plan = this.getPlanSessionForDate(key);
        const done = workouts.find((workout) => workout.status === 'done');
        const skipped = workouts.find((workout) => workout.status === 'skipped');
        const workout = done || skipped || workouts[0] || null;
        const sessionTitle = plan && !plan.isRest ? (plan.day.title || plan.day.focus || this.t('day_plan')) : '';
        const label = sessionTitle || (workout ? workout.title : '');
        const marks = [];
        if (log.weight !== null && log.weight !== undefined) {
            marks.push(`<span class="fit-mark weight" title="${this.esc(this.t('cal_mark_weight'))}"><i data-lucide="scale"></i></span>`);
        }
        if (workout) {
            const cls = workout.status === 'done' ? 'workout-done' : workout.status === 'skipped' ? 'workout-skipped' : '';
            marks.push(`<span class="fit-mark ${cls}" title="${this.esc(workout.title)}"><i data-lucide="dumbbell"></i></span>`);
        }
        if (meals.length) {
            marks.push(`<span class="fit-mark meal" title="${this.esc(this.t('cal_mark_meal'))}"><i data-lucide="utensils"></i></span>`);
        }
        const medCount = health.filter((entry) => entry.type === 'medication' && entry.status === 'taken').length;
        if (medCount) {
            marks.push(`<span class="fit-mark med" title="${this.esc(this.t('cal_mark_med'))}"><i data-lucide="pill"></i></span>`);
        }
        if (cycleLog && cycleLog.flow) {
            marks.push(`<span class="fit-mark cycle" title="${this.esc(this.t('cal_mark_cycle'))}"><i data-lucide="droplet"></i></span>`);
        }
        if (log.note) {
            marks.push(`<span class="fit-mark note" title="${this.esc(this.t('day_note'))}"><i data-lucide="notebook-pen"></i></span>`);
        }

        const showCyclePhase = cycle.tracking && cycle.hasData && !cycle.paused && cycle.phase
            && !['paused', 'late', 'too_far'].includes(cycle.phase);
        const forecast = showCyclePhase && cycle.confidence !== 'recorded';
        const phaseClass = showCyclePhase && ['menstrual', 'fertile', 'ovulation'].includes(cycle.phase)
            ? ` is-${cycle.phase === 'menstrual' ? 'period' : cycle.phase}${forecast ? ' is-forecast' : ''}`
            : '';
        const phaseDot = showCyclePhase
            ? `<i class="fit-day-phase ${cycle.phase === 'menstrual' ? 'period' : cycle.phase}${forecast ? ' is-forecast' : ''}" title="${this.esc(this.t('cycle_day'))} ${cycle.day} · ${this.esc(this.t(`cycle_phase_${cycle.phase}`))}${forecast ? ` · ${this.esc(this.t('cycle_forecast'))}` : ''}"></i>`
            : '';

        const intimacyEntries = (this.state.showPrivate && this.intimacyEnabled()) ? (this.getIntimacy(key) || []) : [];
        const unsafeIntimacy = intimacyEntries.some((entry) => !entry.protection);
        const lockBadge = intimacyEntries.length
            ? `<span class="fit-day-lock ${unsafeIntimacy ? 'is-red' : ''}" title="${this.esc(this.t('intimacy_title'))}${intimacyEntries.length > 1 ? ` ×${intimacyEntries.length}` : ''}"><i data-lucide="lock"></i></span>`
            : '';
        const classes = [
            'fit-day',
            outside ? 'is-outside' : '',
            key === today ? 'is-today' : '',
            key === this.state.selectedDate ? 'is-selected' : '',
            phaseClass
        ].filter(Boolean).join(' ');
        const titleBits = [this.formatDate(key)];
        if (sessionTitle) titleBits.push(`${this.t('day_plan')}: ${sessionTitle}`);
        if (workout) titleBits.push(`${workout.title} (${this.t(`workout_${workout.status}`) || workout.status})`);
        if (log.weight !== null && log.weight !== undefined) titleBits.push(`${this.t('weight')}: ${log.weight} ${this.t('kg')}`);
        if (meals.length) titleBits.push(`${this.t('day_meals')}: ${meals.length}`);
        if (medCount) titleBits.push(`${this.t('cal_mark_med')}: ${medCount}`);
        if (cycleLog && cycleLog.flow) titleBits.push(`${this.t('cycle_flow')}: ${this.t(`flow_${cycleLog.flow}`)}`);
        if (showCyclePhase) {
            titleBits.push(`${this.t('cycle_day')} ${cycle.day} · ${this.t(`cycle_phase_${cycle.phase}`)}${forecast ? ` · ${this.t('cycle_forecast')}` : ''}`);
        } else if (cycle.confidence === 'late') {
            titleBits.push(cycle.day != null ? this.t('cycle_late', { day: cycle.day, late: cycle.lateDays }) : this.t('cycle_phase_late'));
        }
        if (intimacyEntries.length) titleBits.push(`${this.t('intimacy_title')}: ${intimacyEntries.map((entry) => entry.log_time || '—').join(', ')}`);
        if (log.note) titleBits.push(this.t('day_note'));
        return `
            <button type="button" class="${classes}" data-fit-action="select-date" data-date="${key}" title="${this.esc(titleBits.join(' · '))}" aria-label="${this.esc(titleBits.join(', '))}">
                <span class="fit-day-top">
                    <span class="fit-day-num">${this.dateFromKey(key).getDate()}</span>
                    <span class="fit-row" style="gap:3px">${phaseDot}${lockBadge}</span>
                </span>
                ${label ? `<span class="fit-day-label">${this.esc(label)}</span>` : ''}
                ${log.weight !== null && log.weight !== undefined ? `<span class="fit-day-weight">${this.esc(this.fmt(log.weight))} ${this.esc(this.t('kg'))}</span>` : ''}
                <span class="fit-day-marks">${marks.slice(0, 5).join('')}</span>
            </button>
        `;
    },

    renderWeekView() {
        const start = this.dateKey(this.startOfWeek(this.state.cursor));
        const today = this.todayKey();
        let cells = '';
        for (let index = 0; index < 7; index++) {
            const key = this.addDays(start, index);
            const log = this.getDaily(key) || {};
            const plan = this.getPlanSessionForDate(key);
            const workouts = this.getWorkouts(key);
            const meals = this.getMeals(key);
            const doses = this.getDosesForDate(key);
            const cycle = this.getCycleInfo(key);
            const done = workouts.find((workout) => workout.status === 'done');
            const skipped = workouts.find((workout) => workout.status === 'skipped');
            const workout = done || skipped || workouts[0] || null;
            let sessionHtml = '';
            if (workout) {
                const cls = workout.status === 'done' ? 'is-done' : workout.status === 'skipped' ? 'is-skipped' : '';
                sessionHtml = `<div class="fit-week-session ${cls}">${this.esc(workout.title)}<small>${this.esc(this.t(`workout_${workout.status}`))}</small></div>`;
            } else if (plan && !plan.isRest) {
                sessionHtml = `<div class="fit-week-session">${this.esc(plan.day.title || plan.day.focus || this.t('day_plan'))}<small>${this.esc(this.t('day_plan'))}</small></div>`;
            } else if (plan && plan.isRest) {
                sessionHtml = `<div class="fit-week-session rest">${this.esc(this.t('rest'))}</div>`;
            }
            const meta = [];
            if (log.weight !== null && log.weight !== undefined) meta.push(`<span><i data-lucide="scale" style="width:10px;height:10px;display:inline-block;vertical-align:-1px"></i> ${this.esc(this.fmt(log.weight))} ${this.esc(this.t('kg'))}</span>`);
            if (log.sleep_hours !== null && log.sleep_hours !== undefined) meta.push(`<span><i data-lucide="moon" style="width:10px;height:10px;display:inline-block;vertical-align:-1px"></i> ${this.esc(this.fmt(log.sleep_hours))} ${this.esc(this.t('h'))}</span>`);
            if (meals.length) meta.push(`<span><i data-lucide="utensils" style="width:10px;height:10px;display:inline-block;vertical-align:-1px"></i> ${meals.length}</span>`);
            const takenDoses = doses.filter((dose) => dose.status === 'taken').length;
            if (doses.length) meta.push(`<span><i data-lucide="pill" style="width:10px;height:10px;display:inline-block;vertical-align:-1px"></i> ${takenDoses}/${doses.length}</span>`);
            const classes = [
                'fit-week-day',
                key === today ? 'is-today' : '',
                key === this.state.selectedDate ? 'is-selected' : ''
            ].filter(Boolean).join(' ');
            const weekIntimacy = (this.state.showPrivate && this.intimacyEnabled()) ? (this.getIntimacy(key) || []) : [];
            const weekLock = weekIntimacy.length
                ? `<span class="fit-day-lock ${weekIntimacy.some((entry) => !entry.protection) ? 'is-red' : ''}" title="${this.esc(this.t('intimacy_title'))}"><i data-lucide="lock"></i></span>`
                : '';
            const showPhase = cycle.tracking && cycle.hasData && !cycle.paused && cycle.phase && !['paused', 'late', 'too_far'].includes(cycle.phase);
            cells += `
                <button type="button" class="${classes}" data-fit-action="select-date" data-date="${key}">
                    <span class="fit-week-day-head">
                        <b>${this.esc(this.t(`weekday_${this.weekdayIndex(key)}`))}</b>
                        <span>${this.formatShortDate(key)}${showPhase ? ` · ${this.esc(this.t(`cycle_phase_${cycle.phase}`))}` : ''}</span>
                        ${weekLock}
                    </span>
                    ${sessionHtml}
                    ${log.note ? `<div class="fit-muted" style="font-size:.64rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${this.esc(log.note)}</div>` : ''}
                    <span class="fit-week-meta">${meta.join('')}</span>
                </button>
            `;
        }
        return `<div class="fit-week">${cells}</div>`;
    },

    renderDayPanel() {
        return `<aside id="fit-day-panel" class="fit-day-panel">${this.renderDayPanelContent()}</aside>`;
    },

    updateDayPanel() {
        const layout = document.querySelector('#fit-view .fit-cal-layout');
        if (layout) layout.classList.toggle('is-chat-wide', this.state.dayTab === 'aru' && !!this.state.chatWide);
        const panel = document.getElementById('fit-day-panel');
        if (!panel) return;
        panel.innerHTML = this.renderDayPanelContent();
        if (window.lucide) window.lucide.createIcons();
        if (this.state.dayTab === 'aru') setTimeout(() => this.scrollChatToBottom(), 30);
    },

    renderDayPanelContent() {
        const date = this.state.selectedDate || this.todayKey();
        const cycle = this.getCycleInfo(date);
        let phaseBadge = '';
        if (cycle.tracking && cycle.hasData) {
            if (cycle.paused || cycle.confidence === 'paused') {
                phaseBadge = `<span class="fit-badge"><i data-lucide="pause-circle"></i>${this.esc(this.t('cycle_paused'))}</span>`;
            } else if (cycle.confidence === 'late') {
                const lateLabel = cycle.day != null ? this.t('cycle_late', { day: cycle.day, late: cycle.lateDays }) : this.t('cycle_phase_late');
                phaseBadge = `<span class="fit-badge fit-badge-amber"><i data-lucide="clock"></i>${this.esc(lateLabel)}</span>`;
            } else if (cycle.confidence !== 'too_far' && cycle.day) {
                const forecast = cycle.confidence !== 'recorded';
                phaseBadge = `<span class="fit-badge fit-badge-accent" title="${forecast ? this.esc(this.t('cycle_forecast_note')) : ''}"><i data-lucide="droplet"></i>${this.esc(this.t('cycle_day'))} ${cycle.day} · ${this.esc(this.t(`cycle_phase_${cycle.phase}`))}${forecast ? ` · ${this.esc(this.t('cycle_forecast'))}` : ''}</span>`;
            }
        }
        const dateLabel = this.formatDate(date);
        const tabs = `
            <div class="fit-day-tabs" role="tablist">
                <button type="button" class="fit-day-tab ${this.state.dayTab === 'day' ? 'is-active' : ''}" data-fit-action="day-tab" data-tab="day">
                    <i data-lucide="calendar-days"></i>${this.esc(this.t('day_tab'))}
                </button>
                <button type="button" class="fit-day-tab ${this.state.dayTab === 'aru' ? 'is-active' : ''}" data-fit-action="day-tab" data-tab="aru">
                    <i data-lucide="sparkles"></i>${this.esc(this.t('aru_tab'))}
                </button>
            </div>
        `;
        return `
            <header class="fit-day-head">
                <div class="fit-day-head-top">
                    <div style="min-width:0">
                        <h3>${this.esc(dateLabel)}</h3>
                        ${phaseBadge ? `<p>${phaseBadge}</p>` : ''}
                    </div>
                    <div class="fit-row" style="gap:2px;flex-wrap:nowrap">
                        <button type="button" class="fit-btn-icon" data-fit-action="day-prev" data-date="${date}" aria-label="${this.esc(this.t('cal_prev'))}"><i data-lucide="chevron-left"></i></button>
                        <button type="button" class="fit-btn-icon" data-fit-action="day-next" data-date="${date}" aria-label="${this.esc(this.t('cal_next'))}"><i data-lucide="chevron-right"></i></button>
                    </div>
                </div>
                ${tabs}
            </header>
            <div class="fit-day-body">
                ${this.state.dayTab === 'aru' ? this.renderDayChat(date) : this.renderDayContent(date)}
            </div>
        `;
    },

    renderDayContent(date) {
        const log = this.getDaily(date) || {};
        const alerts = this.getDayAlerts(date);
        return `
            ${alerts.length ? `
                <section class="fit-day-section">
                    <div class="fit-day-section-head"><h4><i data-lucide="shield-check"></i>${this.esc(this.t('day_alerts'))}</h4></div>
                    ${alerts.map((alert) => `<div class="fit-alert fit-alert-${alert.type}"><i data-lucide="${alert.icon}"></i><span>${this.esc(alert.text)}</span></div>`).join('')}
                </section>
            ` : ''}
            ${this.renderNutritionSection(date, log)}
            ${this.renderTrainingSection(date)}
            ${this.renderMetricsSection(date, log)}
            ${this.renderCareSection(date)}
            <section class="fit-day-section">
                <div class="fit-day-section-head"><h4><i data-lucide="notebook-pen"></i>${this.esc(this.t('day_note'))}</h4></div>
                <textarea id="fit-day-note" class="fit-note-box" data-date="${date}" placeholder="${this.esc(this.t('note_placeholder'))}">${this.esc((this.state.noteDrafts && Object.prototype.hasOwnProperty.call(this.state.noteDrafts, date)) ? this.state.noteDrafts[date] : (log.note || ''))}</textarea>
                <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="save-note" data-date="${date}" style="align-self:flex-start"><i data-lucide="save"></i>${this.esc(this.t('save_note'))}</button>
            </section>
        `;
    },

    renderNutritionSection(date, log) {
        const nut = this.getDayNutrition(date);
        const targets = this.getTargets(date);
        const meals = this.getMeals(date);
        const workouts = this.getWorkouts(date).filter((w) => w && w.status === 'done');
        const wKg = this.getLatestWeightKg() || 70;
        const burnTotal = window.FitCareEngine
            ? workouts.reduce((s, w) => s + (window.FitCareEngine.estimateWorkoutBurn(w, wKg) || 0), 0)
            : 0;

        const kcal = nut.calories;
        const calTarget = targets && targets.calorieTarget ? targets.calorieTarget : null;
        const calPct = calTarget && kcal !== null ? Math.min(100, Math.round((kcal / calTarget) * 100)) : 0;
        const overCorridor = targets && targets.calorieMax && kcal !== null && kcal > targets.calorieMax;

        const waterVal = log.water_ml !== null && log.water_ml !== undefined ? Number(log.water_ml) : null;
        const waterTarget = targets && targets.waterMl ? targets.waterMl : 2000;
        const waterPct = waterVal !== null ? Math.min(100, Math.round((waterVal / waterTarget) * 100)) : 0;

        const macroItem = (cls, shortKey, val, targetVal) => {
            const hasVal = val !== null && val !== undefined;
            const pct = targetVal && hasVal ? Math.min(100, Math.round((val / targetVal) * 100)) : 0;
            const valText = hasVal ? this.fmt(val, 0) : '—';
            const tgtText = targetVal ? `/${targetVal}${this.t('g')}` : this.t('g');
            return `
                <div class="fit-macro-bar ${cls}">
                    <div class="fit-macro-bar-top"><span>${this.esc(this.t(shortKey))}</span><b>${this.esc(valText)}<small>${this.esc(tgtText)}</small></b></div>
                    <div class="fit-macro-track"><i style="width:${pct}%"></i></div>
                </div>
            `;
        };

        const showMacros = kcal !== null || nut.protein !== null || nut.carbs !== null || nut.fat !== null || calTarget || waterVal !== null;
        const kcalSubtitleParts = [];
        if (targets && targets.calorieMin && targets.calorieMax) {
            kcalSubtitleParts.push(`${targets.calorieMin}–${targets.calorieMax} ${this.t('kcal')}`);
        }
        if (burnTotal > 0) {
            kcalSubtitleParts.push(this.t('workout_burn_est', { n: burnTotal }));
            if (kcal !== null) kcalSubtitleParts.push(this.t('net_kcal', { n: Math.max(0, Math.round(kcal - burnTotal)) }));
        }

        const mealsHtml = meals.length
            ? `<div class="fit-stack" style="gap:5px">${meals.map((meal) => {
                const tags = this.parseJson(meal.tags, []);
                const macroMini = [
                    meal.protein ? `${this.t('protein_short')}${this.fmt(meal.protein, 0)}` : '',
                    meal.carbs ? `${this.t('carbs_short')}${this.fmt(meal.carbs, 0)}` : '',
                    meal.fat ? `${this.t('fat_short')}${this.fmt(meal.fat, 0)}` : ''
                ].filter(Boolean).join(' · ');
                return `
                    <div class="fit-meal-row">
                        <span class="fit-muted" style="font-size:.63rem;min-width:32px">${this.esc(meal.meal_time || '')}</span>
                        <span class="fit-grow" style="min-width:0">
                            <b style="font-size:.73rem">${this.esc(meal.title)}</b>
                            ${macroMini ? `<span class="fit-meal-tags"> · ${this.esc(macroMini)}</span>` : ''}
                            ${tags.length ? `<span class="fit-meal-tags"> · ${this.esc(tags.join(', '))}</span>` : ''}
                            ${Number(meal.estimated) ? `<span class="fit-est" title="${this.esc(this.t('estimated_hint'))}">~</span>` : ''}
                        </span>
                        ${meal.calories !== null && meal.calories !== undefined ? `<span class="fit-meal-kcal">${this.esc(this.fmt(meal.calories, 0))} ${this.esc(this.t('kcal'))}</span>` : ''}
                        <button type="button" class="fit-btn-icon" data-fit-action="edit-meal" data-date="${date}" data-id="${meal.id}" aria-label="${this.esc(this.t('edit'))}"><i data-lucide="pencil"></i></button>
                        <button type="button" class="fit-btn-icon" data-fit-action="delete-meal" data-date="${date}" data-id="${meal.id}" aria-label="${this.esc(this.t('delete'))}"><i data-lucide="trash-2"></i></button>
                    </div>
                `;
            }).join('')}</div>`
            : `<div class="fit-empty" style="padding:11px"><span>${this.esc(this.t('no_meals_today'))}</span></div>`;

        return `
            <section class="fit-day-section">
                <div class="fit-day-section-head">
                    <h4><i data-lucide="utensils"></i>${this.esc(this.t('day_nutrition'))}</h4>
                    <div class="fit-row" style="gap:4px">
                        <button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="quick-water" data-date="${date}" data-ml="250" title="${this.esc(this.t('water_add_250'))}">
                            <i data-lucide="droplets"></i>${this.esc(this.t('water_add_250'))}
                        </button>
                        <button type="button" class="fit-btn-icon" data-fit-action="add-meal" data-date="${date}" aria-label="${this.esc(this.t('add_meal'))}"><i data-lucide="plus"></i></button>
                    </div>
                </div>
                ${showMacros ? `
                    <div class="fit-nut-card">
                        <div class="fit-nut-kcal-row">
                            <span class="fit-nut-kcal-val">${kcal !== null ? `${nut.hasEstimated ? '~' : ''}${this.esc(this.fmt(kcal, 0))}` : '—'} <small>${calTarget ? `/ ${this.esc(this.fmt(calTarget, 0))} ` : ''}${this.esc(this.t('kcal'))}</small></span>
                            <span class="fit-nut-water"><i data-lucide="droplets"></i>${waterVal !== null ? this.esc(this.fmt(waterVal, 0)) : '0'} / ${this.esc(this.fmt(waterTarget, 0))} ${this.esc(this.t('unit_ml'))}</span>
                        </div>
                        ${calTarget ? `<div class="fit-nut-track ${overCorridor ? 'is-over' : ''}"><i style="width:${calPct}%"></i></div>` : ''}
                        ${kcalSubtitleParts.length ? `<small class="fit-muted" style="font-size:.62rem">${this.esc(kcalSubtitleParts.join(' · '))}</small>` : ''}
                        <div class="fit-macro-bars">
                            ${macroItem('is-p', 'protein_short', nut.protein, targets ? targets.protein : null)}
                            ${macroItem('is-c', 'carbs_short', nut.carbs, targets ? targets.carbs : null)}
                            ${macroItem('is-f', 'fat_short', nut.fat, targets ? targets.fat : null)}
                        </div>
                        ${waterVal !== null ? `<div class="fit-nut-water-track"><i style="width:${waterPct}%"></i></div>` : ''}
                    </div>
                ` : ''}
                ${mealsHtml}
            </section>
        `;
    },

    renderTrainingSection(date) {
        const session = this.getPlanSessionForDate(date);
        const workouts = this.getWorkouts(date);
        const wKg = this.getLatestWeightKg() || 70;
        let linkedWorkout = null;
        if (session && !session.isRest) {
            linkedWorkout = workouts.find((w) => Number(w.plan_day_id) === Number(session.day.id)) || null;
        }
        const extraWorkouts = workouts.filter((w) => !linkedWorkout || Number(w.id) !== Number(linkedWorkout.id));

        let planHtml = '';
        if (session && session.isRest && !extraWorkouts.length) {
            planHtml = `<div class="fit-empty" style="padding:11px"><i data-lucide="moon"></i><strong>${this.esc(this.t('rest_day'))}</strong><span>${this.esc(session.plan.title)}</span></div>`;
        } else if (session && !session.isRest) {
            const exercises = this.parseExercises(linkedWorkout ? linkedWorkout.exercises : session.day.exercises);
            const badges = [
                `<span class="fit-badge fit-badge-accent">${this.esc(this.t('plan_week'))} ${this.esc(session.week)}/${this.esc(session.plan.weeks)}</span>`
            ];
            if (linkedWorkout) {
                badges.push(`<span class="fit-badge ${linkedWorkout.status === 'done' ? 'fit-badge-green' : 'fit-badge-amber'}">${this.esc(this.t(`workout_${linkedWorkout.status}`))}</span>`);
            }
            const statsLine = linkedWorkout ? (() => {
                const burn = window.FitCareEngine ? window.FitCareEngine.estimateWorkoutBurn(linkedWorkout, wKg) : null;
                return [
                    linkedWorkout.log_time,
                    linkedWorkout.duration_min ? `${linkedWorkout.duration_min} ${this.t('min')}` : '',
                    linkedWorkout.volume_kg ? `${linkedWorkout.volume_kg} ${this.t('kg')}` : '',
                    linkedWorkout.rpe ? `RPE ${linkedWorkout.rpe}` : '',
                    burn ? `~${burn} ${this.t('kcal')}` : ''
                ].filter(Boolean).map((p) => this.esc(p)).join(' · ');
            })() : '';

            planHtml = `
                <div class="fit-plan-session ${linkedWorkout && linkedWorkout.status === 'done' ? 'is-done' : ''}">
                    <div class="fit-plan-session-top">
                        <div>
                            <strong>${this.esc((linkedWorkout && linkedWorkout.title) || session.day.title || session.day.focus || this.t('day_plan'))}</strong>
                            <p>${this.esc(statsLine || session.day.focus || '')}</p>
                        </div>
                        <div class="fit-row" style="gap:3px;justify-content:flex-end">${badges.join('')}</div>
                    </div>
                    ${exercises.length ? `<div class="fit-session-ex">${exercises.slice(0, 7).map((ex) => `<span>${this.esc(this.exerciseLabel(ex))}</span>`).join('')}${exercises.length > 7 ? `<span>+${exercises.length - 7}</span>` : ''}</div>` : ''}
                    ${(linkedWorkout && linkedWorkout.note) || session.day.notes ? `<p class="fit-muted" style="margin:0;font-size:.66rem">${this.esc((linkedWorkout && linkedWorkout.note) || session.day.notes)}</p>` : ''}
                    <div class="fit-row" style="margin-top:2px">
                        ${!linkedWorkout ? `
                            <button type="button" class="fit-btn fit-btn-primary fit-btn-xs" data-fit-action="log-plan-session" data-date="${date}" data-plan-day="${session.day.id}"><i data-lucide="play"></i>${this.esc(this.t('start_session'))}</button>
                            <button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="log-plan-skip" data-date="${date}" data-plan-day="${session.day.id}">${this.esc(this.t('mark_skipped'))}</button>
                        ` : `
                            ${linkedWorkout.status === 'planned' ? `<button type="button" class="fit-btn fit-btn-primary fit-btn-xs" data-fit-action="complete-workout" data-date="${date}" data-id="${linkedWorkout.id}"><i data-lucide="check"></i>${this.esc(this.t('plan_mark_done'))}</button>` : ''}
                            <button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="log-plan-session" data-date="${date}" data-plan-day="${session.day.id}"><i data-lucide="pencil"></i>${this.esc(this.t('edit'))}</button>
                            <button type="button" class="fit-btn-icon" data-fit-action="delete-workout" data-date="${date}" data-id="${linkedWorkout.id}" aria-label="${this.esc(this.t('delete'))}"><i data-lucide="trash-2"></i></button>
                        `}
                    </div>
                </div>
            `;
        }

        const extrasHtml = extraWorkouts.map((workout) => {
            const exercises = this.parseExercises(workout.exercises);
            const burn = window.FitCareEngine ? window.FitCareEngine.estimateWorkoutBurn(workout, wKg) : null;
            const details = [
                workout.log_time,
                workout.duration_min ? `${workout.duration_min} ${this.t('min')}` : '',
                workout.volume_kg ? `${workout.volume_kg} ${this.t('kg')}` : '',
                workout.rpe ? `RPE ${workout.rpe}` : '',
                burn ? `~${burn} ${this.t('kcal')}` : '',
                this.t(`workout_${workout.status}`)
            ].filter(Boolean).map((p) => this.esc(p)).join(' · ');
            return `
                <div class="fit-actual-card ${workout.status === 'skipped' ? 'is-skipped' : ''}">
                    <span class="fit-actual-icon"><i data-lucide="${workout.status === 'skipped' ? 'x' : workout.status === 'planned' ? 'clock' : 'dumbbell'}"></i></span>
                    <div class="fit-grow">
                        <strong>${this.esc(workout.title)}</strong>
                        <small>${details}</small>
                        ${exercises.length ? `<div class="fit-session-ex" style="margin-top:5px">${exercises.slice(0, 5).map((ex) => `<span>${this.esc(this.exerciseLabel(ex))}</span>`).join('')}${exercises.length > 5 ? `<span>+${exercises.length - 5}</span>` : ''}</div>` : ''}
                        ${workout.note ? `<small style="display:block;margin-top:3px">${this.esc(workout.note)}</small>` : ''}
                    </div>
                    <div class="fit-row" style="gap:1px;flex-wrap:nowrap">
                        ${workout.status === 'planned' ? `<button type="button" class="fit-btn-icon" data-fit-action="complete-workout" data-date="${date}" data-id="${workout.id}" aria-label="${this.esc(this.t('plan_mark_done'))}"><i data-lucide="check"></i></button>` : ''}
                        <button type="button" class="fit-btn-icon" data-fit-action="edit-workout" data-date="${date}" data-id="${workout.id}" aria-label="${this.esc(this.t('edit'))}"><i data-lucide="pencil"></i></button>
                        <button type="button" class="fit-btn-icon" data-fit-action="delete-workout" data-date="${date}" data-id="${workout.id}" aria-label="${this.esc(this.t('delete'))}"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
            `;
        }).join('');

        const emptyHtml = (!planHtml && !extrasHtml)
            ? `<div class="fit-empty" style="padding:11px"><span>${this.esc(this.t('no_actual_workouts'))}</span>${!this.state.activePlan ? `<button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="view-plan">${this.esc(this.t('view_plan'))}</button>` : ''}</div>`
            : '';

        return `
            <section class="fit-day-section">
                <div class="fit-day-section-head">
                    <h4><i data-lucide="dumbbell"></i>${this.esc(this.t('day_training'))}</h4>
                    <button type="button" class="fit-btn-icon" data-fit-action="add-workout" data-date="${date}" aria-label="${this.esc(this.t('add_workout'))}"><i data-lucide="plus"></i></button>
                </div>
                ${planHtml}${extrasHtml}${emptyHtml}
            </section>
        `;
    },

    renderMetricsSection(date, log) {
        const metrics = [
            { key: 'weight', label: 'metric_weight', unit: 'kg', digits: 1 },
            { key: 'body_fat', label: 'metric_body_fat', unit: '%', digits: 1 },
            { key: 'muscle_mass', label: 'metric_muscle', unit: 'kg', digits: 1 },
            { key: 'water_pct', label: 'metric_water_pct', unit: '%', digits: 1 },
            { key: 'bone_mass', label: 'metric_bone', unit: 'kg', digits: 1 },
            { key: 'visceral_fat', label: 'metric_visceral', unit: '', digits: 1 },
            { key: 'sleep_hours', label: 'metric_sleep', unit: 'h', digits: 1 },
            { key: 'steps', label: 'metric_steps', unit: '', digits: 0 },
            { key: 'energy', label: 'metric_energy', unit: '/5', digits: 0 },
            { key: 'mood', label: 'metric_mood', unit: '/5', digits: 0 },
            { key: 'stress', label: 'metric_stress', unit: '/5', digits: 0 }
        ];
        const filled = metrics.filter((m) => log[m.key] !== null && log[m.key] !== undefined);
        const symptoms = this.parseJson(log.symptoms, []);
        const pills = filled.map((m) => {
            const val = log[m.key];
            const suffix = m.unit ? (m.unit === '%' || m.unit === '/5' ? m.unit : ' ' + this.t(m.unit)) : '';
            return `<div class="fit-metric-pill"><span>${this.esc(this.t(m.label))}</span><b>${this.esc(this.fmt(val, m.digits))}${this.esc(suffix)}</b></div>`;
        }).join('');
        return `
            <section class="fit-day-section">
                <div class="fit-day-section-head">
                    <h4><i data-lucide="scale"></i>${this.esc(this.t('day_metrics'))}</h4>
                    <button type="button" class="fit-btn-icon" data-fit-action="add-metrics" data-date="${date}" aria-label="${this.esc(this.t('add_metrics'))}"><i data-lucide="pencil"></i></button>
                </div>
                ${filled.length
                    ? `<div class="fit-metric-pills">${pills}</div>`
                    : `<button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" style="align-self:flex-start" data-fit-action="add-metrics" data-date="${date}"><i data-lucide="plus"></i>${this.esc(this.t('add_metrics'))}</button>`}
                ${symptoms.length ? `<div class="fit-session-ex">${symptoms.slice(0, 8).map((s) => `<span>${this.esc(s)}</span>`).join('')}${symptoms.length > 8 ? `<span>+${symptoms.length - 8}</span>` : ''}</div>` : ''}
                ${log.measurement_note ? `<p class="fit-muted" style="margin:0;font-size:.66rem">${this.esc(log.measurement_note)}</p>` : ''}
            </section>
        `;
    },

    renderCareSection(date) {
        const events = [];
        for (const dose of this.getDosesForDate(date)) {
            events.push({
                time: dose.time || '',
                icon: 'pill',
                cls: 'med',
                title: dose.protocol.name,
                sub: [dose.protocol.dosage, dose.status ? this.t(`med_${dose.status}`) : this.t('not_logged')].filter(Boolean).join(' · '),
                dose
            });
        }
        for (const entry of this.getHealthLogs(date).filter((log) => log.type !== 'medication')) {
            const valueBits = [];
            if (entry.value !== null && entry.value !== undefined) valueBits.push(entry.value);
            if (entry.value2 !== null && entry.value2 !== undefined) valueBits.push(entry.value2);
            events.push({
                time: entry.log_time || '',
                icon: entry.type === 'symptom' ? 'thermometer' : 'activity',
                cls: 'health',
                title: entry.name || this.t(`health_type_${entry.type}`),
                sub: `${valueBits.length ? `${valueBits.join('/')}${entry.unit ? ' ' + entry.unit : ''}` : ''}${entry.note ? `${valueBits.length ? ' · ' : ''}${entry.note}` : ''}`
            });
        }
        const cycleLog = this.getCycleLog(date);
        if (cycleLog && (cycleLog.flow || cycleLog.note)) {
            events.push({
                time: cycleLog.flow ? '08:00' : '',
                icon: 'droplet',
                cls: 'cycle',
                title: cycleLog.flow ? this.t(`flow_${cycleLog.flow}`) : this.t('cycle_log_title'),
                sub: cycleLog.note || ''
            });
        }
        if (this.state.showPrivate && this.intimacyEnabled()) {
            for (const entry of this.getIntimacy(date)) {
                events.push({
                    time: entry.log_time || '',
                    icon: 'lock',
                    cls: 'intimacy',
                    title: this.t('intimacy_title'),
                    sub: [entry.protection ? this.t(`protection_${entry.protection}`) : this.t('protection_none'), entry.note || ''].filter(Boolean).join(' · '),
                    intimacyId: entry.id
                });
            }
        }
        events.sort((a, b) => (a.time || '12:00').localeCompare(b.time || '12:00'));
        const body = events.length ? `
            <div class="fit-timeline">
                ${events.map((event, index) => `
                    <div class="fit-timeline-item">
                        <span class="fit-timeline-time">${this.esc(event.time || '')}</span>
                        <span class="fit-timeline-rail">
                            <span class="fit-timeline-dot ${event.cls}"><i data-lucide="${event.icon}"></i></span>
                            ${index < events.length - 1 ? '<span class="fit-timeline-line"></span>' : ''}
                        </span>
                        <span class="fit-timeline-content">
                            <span class="fit-inline" style="justify-content:space-between;width:100%">
                                <b>${this.esc(event.title)}</b>
                                <span class="fit-row" style="gap:1px;flex:none">
                                    ${event.intimacyId ? `<button type="button" class="fit-btn-icon" data-fit-action="edit-intimacy" data-id="${event.intimacyId}" aria-label="${this.esc(this.t('edit'))}"><i data-lucide="pencil"></i></button>` : ''}
                                    ${event.dose ? `<button type="button" class="fit-dose-check ${event.dose.status === 'taken' ? 'is-taken' : ''}" data-fit-action="mark-dose" data-date="${date}" data-protocol="${event.dose.protocol.id}" data-time="${this.esc(event.dose.time)}" data-name="${this.esc(event.dose.protocol.name)}" data-log-id="${event.dose.log ? event.dose.log.id : ''}" data-taken="${event.dose.status === 'taken' ? '1' : '0'}" aria-label="${this.esc(this.t('mark_taken'))}"><i data-lucide="check"></i></button>` : ''}
                                </span>
                            </span>
                            ${event.sub ? `<small>${this.esc(event.sub)}</small>` : ''}
                        </span>
                    </div>
                `).join('')}
            </div>
        ` : `<div class="fit-empty" style="padding:10px"><span>${this.esc(this.t('no_events_today'))}</span></div>`;

        return `
            <section class="fit-day-section">
                <div class="fit-day-section-head">
                    <h4><i data-lucide="heart-pulse"></i>${this.esc(this.t('day_care'))}</h4>
                    <div class="fit-row" style="gap:2px">
                        <button type="button" class="fit-btn-icon" data-fit-action="add-med" data-date="${date}" title="${this.esc(this.t('add_med'))}" aria-label="${this.esc(this.t('add_med'))}"><i data-lucide="pill"></i></button>
                        <button type="button" class="fit-btn-icon" data-fit-action="add-health" data-date="${date}" title="${this.esc(this.t('add_health'))}" aria-label="${this.esc(this.t('add_health'))}"><i data-lucide="plus"></i></button>
                    </div>
                </div>
                ${body}
            </section>
        `;
    },

    formatChatTime(timestamp) {
        if (!timestamp) return '';
        try {
            const iso = String(timestamp).includes('T') ? String(timestamp) : String(timestamp).replace(' ', 'T') + 'Z';
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return '';
            return d.toLocaleTimeString(this.state.lang, { hour: '2-digit', minute: '2-digit' });
        } catch (_) {
            return '';
        }
    },

    renderChatActionCards(metaRaw) {
        if (!metaRaw) return '';
        const meta = this.parseJson(metaRaw, null);
        const actions = meta && Array.isArray(meta.actions) ? meta.actions : [];
        if (!actions.length) return '';
        const cards = actions.map((act) => {
            if (!act || !act.kind) return '';
            let icon = 'check';
            let label = '';
            let sub = '';
            if (act.kind === 'meal') {
                icon = 'utensils';
                label = act.title || this.t('quick_meal');
                const bits = [];
                if (act.calories != null) bits.push(`${act.estimated ? '~' : ''}${act.calories} ${this.t('kcal')}`);
                if (act.protein != null) bits.push(`${this.t('protein_short')} ${act.protein}${this.t('g')}`);
                sub = bits.join(' · ');
            } else if (act.kind === 'workout') {
                icon = 'dumbbell';
                label = act.title || this.t('quick_workout');
                const bits = [this.t(`workout_${act.status || 'done'}`)];
                if (act.duration_min) bits.push(`${act.duration_min} ${this.t('min')}`);
                if (act.volume_kg) bits.push(`${act.volume_kg} ${this.t('kg')}`);
                sub = bits.join(' · ');
            } else if (act.kind === 'log') {
                icon = 'scale';
                label = this.t('quick_metrics');
                const p = act.patch || {};
                const bits = [];
                if (p.weight != null) bits.push(`${p.weight} ${this.t('kg')}`);
                if (p.sleep_hours != null) bits.push(`${p.sleep_hours} ${this.t('h')}`);
                if (p.water_ml != null) bits.push(`${p.water_ml} ${this.t('unit_ml')}`);
                if (p.steps != null) bits.push(`${p.steps}`);
                sub = bits.join(' · ');
            } else if (act.kind === 'med') {
                icon = 'pill';
                label = act.name || this.t('med_protocol');
                sub = this.t(`med_${act.status || 'taken'}`);
            } else if (act.kind === 'health') {
                icon = 'heart-pulse';
                label = act.name || this.t('quick_health');
                sub = act.value != null ? `${act.value}${act.value2 != null ? '/' + act.value2 : ''}${act.unit ? ' ' + act.unit : ''}` : '';
            } else if (act.kind === 'cycle') {
                icon = 'droplet';
                label = act.event === 'CYCLE_START' ? this.t('cycle_start') : act.event === 'CYCLE_END' ? this.t('cycle_end') : this.t('cycle_log_title');
                sub = act.date || '';
            } else if (act.kind === 'plan') {
                icon = 'clipboard-list';
                label = act.title || this.t('plan_title');
                sub = act.dayTitle || (act.weeks ? `${act.weeks} ${this.t('plan_weeks')}` : '');
            }
            if (!label) return '';
            return `
                <div class="fit-chat-action-card">
                    <span class="fit-chat-action-icon"><i data-lucide="${icon}"></i></span>
                    <span class="fit-chat-action-copy"><b>${this.esc(label)}</b>${sub ? `<small>${this.esc(sub)}</small>` : ''}</span>
                    <button type="button" class="fit-chat-action-link" data-fit-action="chat-open-day">${this.esc(this.t('chat_open_day'))}</button>
                </div>
            `;
        }).filter(Boolean);
        return cards.length ? `<div class="fit-chat-actions-wrap">${cards.join('')}</div>` : '';
    },

    renderDayChat(date) {
        const messages = this.getChatMessages(date);
        const busy = this.state.chatBusy;
        const error = this.state.chatError;
        const thread = messages.length
            ? messages.map((message) => {
                const role = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system';
                const time = this.formatChatTime(message.created_at);
                if (role === 'assistant') {
                    const body = this.renderChatMarkdown(message.content);
                    const actionCards = this.renderChatActionCards(message.meta);
                    return `
                        <div class="fit-chat-row is-assistant">
                            <img class="fit-chat-avatar" src="media/int/aru.png" alt="Aru">
                            <div class="fit-chat-msg-col">
                                <div class="fit-chat-bubble assistant">${body}${actionCards}</div>
                                <div class="fit-chat-msg-foot">
                                    ${time ? `<span class="fit-chat-time">${this.esc(time)}</span>` : ''}
                                    <button type="button" class="fit-chat-copy-btn" data-fit-action="chat-copy" data-id="${message.id}" title="${this.esc(this.t('chat_copy'))}"><i data-lucide="copy"></i></button>
                                </div>
                            </div>
                        </div>
                    `;
                }
                return `
                    <div class="fit-chat-row is-${role}">
                        <div class="fit-chat-msg-col">
                            <div class="fit-chat-bubble ${role}">${this.esc(message.content)}</div>
                            ${time ? `<div class="fit-chat-msg-foot"><span class="fit-chat-time">${this.esc(time)}</span></div>` : ''}
                        </div>
                    </div>
                `;
            }).join('')
            : `<div class="fit-chat-welcome"><img src="media/int/aru.png" alt="Aru"><strong>Aru Fit &amp; Care</strong><span>${this.esc(this.t('chat_empty'))}</span></div>`;

        const chips = [
            { label: this.t('chat_chip_summary'), prompt: this.t('chat_chip_summary_prompt') },
            { label: this.t('chat_chip_macros'), prompt: this.t('chat_chip_macros_prompt') },
            { label: this.t('chat_chip_workout'), prompt: this.t('chat_chip_workout_prompt') }
        ];
        if (!this.state.activePlan) {
            chips.push({ label: this.t('chat_chip_plan'), prompt: this.t('chat_chip_plan_prompt') });
        }

        return `
            <div class="fit-chat">
                <div class="fit-chat-head">
                    <div class="fit-chat-head-id">
                        <img class="fit-chat-avatar sm" src="media/int/aru.png" alt="Aru">
                        <div>
                            <b>Aru</b>
                            <span>${this.esc(this.t('chat_context_pill'))}</span>
                        </div>
                    </div>
                    <div class="fit-row" style="gap:3px">
                        <button type="button" class="fit-btn-icon" data-fit-action="chat-toggle-wide" title="${this.esc(this.t(this.state.chatWide ? 'chat_collapse' : 'chat_expand'))}" aria-label="${this.esc(this.t(this.state.chatWide ? 'chat_collapse' : 'chat_expand'))}">
                            <i data-lucide="${this.state.chatWide ? 'minimize-2' : 'maximize-2'}"></i>
                        </button>
                        ${messages.length ? `<button type="button" class="fit-btn-icon" data-fit-action="chat-clear" data-date="${date}" title="${this.esc(this.t('chat_clear'))}" aria-label="${this.esc(this.t('chat_clear'))}"><i data-lucide="trash-2"></i></button>` : ''}
                    </div>
                </div>
                <div id="fit-chat-thread" class="fit-chat-thread">
                    ${thread}
                    ${busy ? `<div class="fit-chat-row is-assistant"><img class="fit-chat-avatar" src="media/int/aru.png" alt="Aru"><div class="fit-chat-bubble assistant fit-chat-typing-dots"><i></i><i></i><i></i></div></div>` : ''}
                </div>
                ${error ? `<div class="fit-alert fit-alert-danger"><i data-lucide="circle-alert"></i><span>${this.esc(error)}</span></div>` : ''}
                <div class="fit-chat-chips">
                    ${chips.map((c) => `<button type="button" class="fit-chat-chip" data-fit-action="chat-chip" data-prompt="${this.esc(c.prompt)}" ${busy ? 'disabled' : ''}>${this.esc(c.label)}</button>`).join('')}
                </div>
                <div class="fit-chat-composer">
                    <textarea id="fit-chat-input" rows="2" placeholder="${this.esc(this.t('chat_placeholder'))}" aria-label="${this.esc(this.t('aru_tab'))}">${this.esc(this.state.chatDraft || '')}</textarea>
                    <button type="button" class="fit-chat-send" data-fit-action="chat-send" aria-label="${this.esc(this.t('chat_send'))}" ${busy ? 'disabled' : ''}>
                        <i data-lucide="arrow-up"></i>
                    </button>
                </div>
            </div>
        `;
    },

    handleCalendarAction(action, el) {
        const date = el.dataset.date || this.state.selectedDate || this.todayKey();
        switch (action) {
            case 'select-date':
                this.selectDate(el.dataset.date);
                return true;
            case 'cal-prev':
                this.shiftCalendar(-1);
                return true;
            case 'cal-next':
                this.shiftCalendar(1);
                return true;
            case 'cal-today':
                this.state.cursor = new Date();
                this.state.selectedDate = this.todayKey();
                this.loadAll();
                this.render();
                return true;
            case 'cal-mode':
                this.state.calendarMode = el.dataset.mode === 'week' ? 'week' : 'month';
                localStorage.setItem('aru_fit_cal_mode', this.state.calendarMode);
                this.loadAll();
                this.render();
                return true;
            case 'day-prev':
                this.selectDate(this.addDays(date, -1));
                return true;
            case 'day-next':
                this.selectDate(this.addDays(date, 1));
                return true;
            case 'day-tab':
                this.state.dayTab = el.dataset.tab === 'aru' ? 'aru' : 'day';
                this.updateDayPanel();
                return true;
            case 'log-plan-session': {
                const day = (this.state.planDays || []).find((item) => Number(item.id) === Number(el.dataset.planDay));
                if (!day) return true;
                const existing = this.getWorkouts(date).find((workout) => Number(workout.plan_day_id) === Number(day.id));
                this.openWorkoutModal(date, existing ? { workout: existing, planDay: day } : { planDay: day });
                return true;
            }
            case 'log-plan-skip': {
                const day = (this.state.planDays || []).find((item) => Number(item.id) === Number(el.dataset.planDay));
                if (!day) return true;
                const session = this.getPlanSessionForDate(date);
                const existing = this.getWorkouts(date).find((workout) => Number(workout.plan_day_id) === Number(day.id));
                window.DB.saveFitWorkout({
                    id: existing ? existing.id : null,
                    log_date: date,
                    log_time: this.nowTime(),
                    plan_day_id: day.id,
                    title: day.title || day.focus || (session && session.plan.title) || this.t('day_plan'),
                    exercises: day.exercises || '[]',
                    status: 'skipped',
                    note: ''
                });
                this.refresh();
                this.toast(this.t('toast_saved'), 'success');
                return true;
            }
            case 'edit-meal': {
                const meal = this.getMeals(date).find((item) => Number(item.id) === Number(el.dataset.id));
                if (meal) this.openMealModal(date, meal);
                return true;
            }
            case 'complete-workout': {
                const workout = this.getWorkouts(date).find((item) => Number(item.id) === Number(el.dataset.id));
                if (workout) {
                    window.DB.saveFitWorkout(Object.assign({}, workout, { status: 'done' }));
                    this.refresh();
                    this.toast(this.t('toast_saved'), 'success');
                }
                return true;
            }
            case 'edit-workout': {
                const workout = this.getWorkouts(date).find((item) => Number(item.id) === Number(el.dataset.id));
                if (workout) this.openWorkoutModal(date, { workout });
                return true;
            }
            case 'view-plan':
                this.setView('plan');
                return true;
            case 'edit-metrics':
            case 'edit-day':
                this.openMetricsModal(date);
                return true;
        }
        return false;
    },

    selectDate(date) {
        if (!date) return;
        this.state.selectedDate = date;
        this.state.cursor = this.dateFromKey(date);
        this.state.chatError = '';
        this.loadAll();
        this.render();
        if ((document.getElementById('fit-view')?.clientWidth || window.innerWidth) <= 1080) {
            setTimeout(() => {
                const panel = document.getElementById('fit-day-panel');
                if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 40);
        }
    },

    shiftCalendar(direction) {
        if (this.state.calendarMode === 'week') {
            const start = this.dateKey(this.startOfWeek(this.state.cursor));
            const next = this.addDays(start, direction * 7);
            this.state.cursor = this.dateFromKey(next);
            this.state.selectedDate = next;
        } else {
            const cursor = this.state.cursor;
            const next = new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
            this.state.cursor = next;
            const today = new Date();
            this.state.selectedDate = (next.getFullYear() === today.getFullYear() && next.getMonth() === today.getMonth())
                ? this.todayKey()
                : this.dateKey(next);
        }
        this.loadAll();
        this.render();
    },

    openDayPanel(date, tab, draft, autoSend = false) {
        this.state.view = 'calendar';
        localStorage.setItem('aru_fit_view', 'calendar');
        this.state.selectedDate = date || this.todayKey();
        this.state.cursor = this.dateFromKey(this.state.selectedDate);
        this.state.dayTab = tab === 'day' ? 'day' : 'aru';
        this.state.chatDraft = autoSend ? '' : (draft || '');
        this.loadAll();
        this.render();
        const container = document.getElementById('fit-view');
        if (container) container.scrollTop = 0;
        setTimeout(() => {
            const panel = document.getElementById('fit-day-panel');
            if (panel && (document.getElementById('fit-view')?.clientWidth || window.innerWidth) <= 1080) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (this.state.dayTab === 'aru') {
                this.scrollChatToBottom();
                if (autoSend && draft) {
                    void this.sendChat(draft);
                } else {
                    const input = document.getElementById('fit-chat-input');
                    if (input && window.innerWidth > 760) input.focus({ preventScroll: true });
                }
            }
        }, 60);
    }
});
