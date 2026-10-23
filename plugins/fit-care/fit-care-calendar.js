/*
---ARU-LAB.SPACE---ALMATY---2026---
Aru Fit & Care — calendar, day card and daily Aru chat.
---chat.aru-lab.space---PWA---
*/
window.FitCarePlugin = window.FitCarePlugin || {};

Object.assign(window.FitCarePlugin, {
    renderCalendarView() {
        const container = document.getElementById('fit-view');
        if (!container) return;
        const date = this.state.selectedDate || this.todayKey();
        const summary = this.calendarSummary();
        container.innerHTML = `
            <div class="fit-page">
                <div class="fit-page-head">
                    <div>
                        <p class="fit-kicker">Aru Fit &amp; Care</p>
                        <h2>${this.esc(this.t('nav_calendar'))}</h2>
                        <p>${this.esc(this.t('cal_sub'))}</p>
                    </div>
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
                <div class="fit-cal-layout">
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
        void date;
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
        const range = this.state.range;
        const daily = Array.from(this.state.dailyMap.values());
        const weighed = daily.filter((log) => log.weight !== null && log.weight !== undefined);
        const latest = weighed.length ? weighed[weighed.length - 1] : null;
        const workouts = Array.from(this.state.workoutsByDate.values()).flat().filter((workout) => workout.status === 'done');
        const cycle = this.getCycleInfo(this.todayKey());
        const badges = [];
        if (latest) {
            badges.push(`<span class="fit-badge fit-badge-violet"><i data-lucide="scale"></i>${this.esc(this.fmt(latest.weight))} ${this.esc(this.t('kg'))}</span>`);
        }
        badges.push(`<span class="fit-badge fit-badge-green"><i data-lucide="dumbbell"></i>${this.esc(this.t('workouts_done', { n: workouts.length }))}</span>`);
        if (cycle.tracking && cycle.hasData) {
            badges.push(`<span class="fit-badge fit-badge-accent"><i data-lucide="droplet"></i>${this.esc(this.t('cycle_day'))} ${cycle.day}</span>`);
        }
        if (this.state.activePlan) {
            badges.push(`<span class="fit-badge"><i data-lucide="target"></i>${this.esc(this.state.activePlan.title)}</span>`);
        }
        void range;
        return badges.join('');
    },

    renderCalendarLegend() {
        const items = [
            ['scale', 'cal_mark_weight', 'weight'],
            ['dumbbell', 'cal_mark_workout', 'workout-done'],
            ['utensils', 'cal_mark_meal', 'meal'],
            ['pill', 'cal_mark_med', 'med']
        ];
        if (this.cycleEnabled()) items.push(['droplet', 'cal_mark_cycle', 'cycle']);
        if (this.intimacyEnabled()) items.push(['lock', 'cal_mark_intimacy', 'intimacy']);
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
        const phaseClass = cycle.tracking && cycle.hasData && ['menstrual', 'fertile', 'ovulation'].includes(cycle.phase)
            ? ` is-${cycle.phase === 'menstrual' ? 'period' : cycle.phase}`
            : '';
        const phaseDot = cycle.tracking && cycle.hasData
            ? `<i class="fit-day-phase ${cycle.phase === 'menstrual' ? 'period' : cycle.phase}" title="${this.esc(this.t('cycle_day'))} ${cycle.day} · ${this.esc(this.t(`cycle_phase_${cycle.phase}`))}"></i>`
            : '';
        const intimacyEntries = this.intimacyEnabled() ? (this.getIntimacy(key) || []) : [];
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
            const weekIntimacy = this.intimacyEnabled() ? (this.getIntimacy(key) || []) : [];
            const weekLock = weekIntimacy.length
                ? `<span class="fit-day-lock ${weekIntimacy.some((entry) => !entry.protection) ? 'is-red' : ''}" title="${this.esc(this.t('intimacy_title'))}"><i data-lucide="lock"></i></span>`
                : '';
            cells += `
                <button type="button" class="${classes}" data-fit-action="select-date" data-date="${key}">
                    <span class="fit-week-day-head">
                        <b>${this.esc(this.t(`weekday_${this.weekdayIndex(key)}`))}</b>
                        <span>${this.formatShortDate(key)}${cycle.tracking && cycle.hasData ? ` · ${this.esc(this.t(`cycle_phase_${cycle.phase}`))}` : ''}</span>
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
        const panel = document.getElementById('fit-day-panel');
        if (!panel) return;
        panel.innerHTML = this.renderDayPanelContent();
        if (window.lucide) window.lucide.createIcons();
        if (this.state.dayTab === 'aru') setTimeout(() => this.scrollChatToBottom(), 30);
    },

    renderDayPanelContent() {
        const date = this.state.selectedDate || this.todayKey();
        const cycle = this.getCycleInfo(date);
        const phaseBadge = cycle.tracking && cycle.hasData
            ? `<span class="fit-badge fit-badge-accent"><i data-lucide="droplet"></i>${this.esc(this.t('cycle_day'))} ${cycle.day} · ${this.esc(this.t(`cycle_phase_${cycle.phase}`))}</span>`
            : '';
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
                    <div>
                        <p class="fit-kicker">${this.esc(this.t('nav_calendar'))}</p>
                        <h3>${this.esc(dateLabel)}</h3>
                        <p>${phaseBadge}</p>
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
            ${this.renderPlanSection(date)}
            ${this.renderActualSection(date)}
            ${this.renderMetricsSection(date, log)}
            ${this.renderMealsSection(date)}
            ${this.renderTimelineSection(date)}
            <section class="fit-day-section">
                <div class="fit-day-section-head"><h4><i data-lucide="notebook-pen"></i>${this.esc(this.t('day_note'))}</h4></div>
                <textarea id="fit-day-note" class="fit-note-box" placeholder="${this.esc(this.t('note_placeholder'))}">${this.esc(log.note || '')}</textarea>
                <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="save-note" data-date="${date}"><i data-lucide="save"></i>${this.esc(this.t('save_note'))}</button>
            </section>
        `;
    },

    renderPlanSection(date) {
        const session = this.getPlanSessionForDate(date);
        const workouts = this.getWorkouts(date);
        const plannedWorkouts = workouts.filter((workout) => workout.status === 'planned' && (!session || Number(workout.plan_day_id) !== Number(session.day.id)));
        let body = '';
        if (session && session.isRest) {
            body = `<div class="fit-empty"><i data-lucide="moon"></i><strong>${this.esc(this.t('rest_day'))}</strong><span>${this.esc(session.plan.title)}</span></div>`;
        } else if (session) {
            const exercises = this.parseExercises(session.day.exercises);
            const existing = workouts.find((workout) => Number(workout.plan_day_id) === Number(session.day.id));
            const badges = [
                `<span class="fit-badge fit-badge-accent">${this.esc(this.t('plan_week'))} ${session.week}/${session.plan.weeks}</span>`,
                session.fromTemplate ? `<span class="fit-badge">${this.esc(this.t('plan_template_badge'))}</span>` : `<span class="fit-badge fit-badge-violet">${this.esc(this.t('plan_override_badge'))}</span>`
            ];
            if (existing) {
                badges.push(`<span class="fit-badge ${existing.status === 'done' ? 'fit-badge-green' : 'fit-badge-amber'}">${this.esc(this.t(`workout_${existing.status}`))}</span>`);
            }
            body = `
                <div class="fit-plan-session">
                    <div class="fit-plan-session-top">
                        <div>
                            <strong>${this.esc(session.day.title || session.day.focus || this.t('day_plan'))}</strong>
                            <p>${this.esc(session.day.focus || '')}</p>
                        </div>
                        <div class="fit-row" style="gap:3px;justify-content:flex-end">${badges.join('')}</div>
                    </div>
                    ${exercises.length ? `<div class="fit-session-ex">${exercises.slice(0, 7).map((exercise) => `<span>${this.esc(this.exerciseLabel(exercise))}</span>`).join('')}${exercises.length > 7 ? `<span>+${exercises.length - 7}</span>` : ''}</div>` : ''}
                    ${session.day.notes ? `<p class="fit-muted" style="margin:0;font-size:.68rem">${this.esc(session.day.notes)}</p>` : ''}
                    ${!existing ? `
                        <div class="fit-row" style="margin-top:2px">
                            <button type="button" class="fit-btn fit-btn-primary fit-btn-xs" data-fit-action="log-plan-session" data-date="${date}" data-plan-day="${session.day.id}"><i data-lucide="play"></i>${this.esc(this.t('start_session'))}</button>
                            <button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="log-plan-skip" data-date="${date}" data-plan-day="${session.day.id}">${this.esc(this.t('mark_skipped'))}</button>
                        </div>
                    ` : `<button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" style="align-self:flex-start" data-fit-action="log-plan-session" data-date="${date}" data-plan-day="${session.day.id}">${this.esc(this.t('edit'))}</button>`}
                </div>
            `;
        }

        if (plannedWorkouts.length) {
            body += plannedWorkouts.map((workout) => {
                const details = [
                    workout.log_time,
                    workout.duration_min ? `${workout.duration_min} ${this.t('min')}` : '',
                    workout.volume_kg ? `${workout.volume_kg} ${this.t('kg')}` : '',
                    workout.rpe ? `RPE ${workout.rpe}` : ''
                ].filter(Boolean).map((part) => this.esc(part)).join(' · ');
                return `
                    <div class="fit-plan-session">
                        <div class="fit-plan-session-top">
                            <div>
                                <strong>${this.esc(workout.title)}</strong>
                                <p>${details}</p>
                            </div>
                            <span class="fit-badge fit-badge-amber">${this.esc(this.t('workout_planned'))}</span>
                        </div>
                        ${workout.note ? `<p class="fit-muted" style="margin:0;font-size:.68rem">${this.esc(workout.note)}</p>` : ''}
                        <div class="fit-row" style="margin-top:2px">
                            <button type="button" class="fit-btn fit-btn-primary fit-btn-xs" data-fit-action="complete-workout" data-date="${date}" data-id="${workout.id}"><i data-lucide="check"></i>${this.esc(this.t('plan_mark_done'))}</button>
                            <button type="button" class="fit-btn-icon" data-fit-action="edit-workout" data-date="${date}" data-id="${workout.id}" aria-label="${this.esc(this.t('edit'))}"><i data-lucide="pencil"></i></button>
                            <button type="button" class="fit-btn-icon" data-fit-action="delete-workout" data-date="${date}" data-id="${workout.id}" aria-label="${this.esc(this.t('delete'))}"><i data-lucide="trash-2"></i></button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        if (!body) {
            if (this.state.activePlan) {
                body = `<div class="fit-empty"><i data-lucide="calendar"></i><strong>${this.esc(this.t('no_plan_today'))}</strong></div>`;
            } else {
                body = `<div class="fit-empty"><i data-lucide="dumbbell"></i><strong>${this.esc(this.t('no_plan_today'))}</strong><span>${this.esc(this.t('no_plan_hint'))}</span><button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="view-plan">${this.esc(this.t('view_plan'))}</button></div>`;
            }
        }
        return `
            <section class="fit-day-section">
                <div class="fit-day-section-head"><h4><i data-lucide="target"></i>${this.esc(this.t('day_plan'))}</h4></div>
                ${body}
            </section>
        `;
    },

    renderActualSection(date) {
        const workouts = this.getWorkouts(date).filter((workout) => workout.status !== 'planned');
        const body = workouts.length
            ? workouts.map((workout) => `
                <div class="fit-actual-card ${workout.status === 'skipped' ? 'is-skipped' : ''}">
                    <span class="fit-actual-icon"><i data-lucide="${workout.status === 'skipped' ? 'x' : workout.status === 'planned' ? 'clock' : 'dumbbell'}"></i></span>
                    <div class="fit-grow">
                        <strong>${this.esc(workout.title)}</strong>
                        <small>${[
                            workout.log_time,
                            workout.duration_min ? `${workout.duration_min} ${this.t('min')}` : '',
                            workout.volume_kg ? `${workout.volume_kg} ${this.t('kg')}` : '',
                            workout.rpe ? `RPE ${workout.rpe}` : '',
                            this.t(`workout_${workout.status}`)
                        ].filter(Boolean).map((part) => this.esc(part)).join(' · ')}</small>
                        ${workout.note ? `<small style="display:block;margin-top:2px">${this.esc(workout.note)}</small>` : ''}
                    </div>
                    <div class="fit-row" style="gap:1px;flex-wrap:nowrap">
                        <button type="button" class="fit-btn-icon" data-fit-action="edit-workout" data-date="${date}" data-id="${workout.id}" aria-label="${this.esc(this.t('edit'))}"><i data-lucide="pencil"></i></button>
                        <button type="button" class="fit-btn-icon" data-fit-action="delete-workout" data-date="${date}" data-id="${workout.id}" aria-label="${this.esc(this.t('delete'))}"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
            `).join('')
            : `<div class="fit-empty" style="padding:14px"><span>${this.esc(this.t('no_actual_workouts'))}</span></div>`;
        return `
            <section class="fit-day-section">
                <div class="fit-day-section-head">
                    <h4><i data-lucide="dumbbell"></i>${this.esc(this.t('day_actual'))}</h4>
                    <button type="button" class="fit-btn-icon" data-fit-action="add-workout" data-date="${date}" aria-label="${this.esc(this.t('add_workout'))}"><i data-lucide="plus"></i></button>
                </div>
                ${body}
            </section>
        `;
    },

    renderMetricsSection(date, log) {
        const metrics = [
            { key: 'weight', label: 'metric_weight', unit: 'kg', digits: 1 },
            { key: 'body_fat', label: 'metric_body_fat', unit: '%', digits: 1 },
            { key: 'muscle_mass', label: 'metric_muscle', unit: 'kg', digits: 1 },
            { key: 'water_pct', label: 'metric_water_pct', unit: '%', digits: 1 },
            { key: 'sleep_hours', label: 'metric_sleep', unit: 'h', digits: 1 },
            { key: 'steps', label: 'metric_steps', unit: '', digits: 0 },
            { key: 'water_ml', label: 'metric_water_ml', unit: 'unit_ml', digits: 0 },
            { key: 'energy', label: 'metric_energy', unit: '/5', digits: 0 },
            { key: 'mood', label: 'metric_mood', unit: '/5', digits: 0 },
            { key: 'stress', label: 'metric_stress', unit: '/5', digits: 0 },
            { key: 'calories', label: 'metric_calories', unit: 'kcal', digits: 0 }
        ];
        const any = metrics.some((metric) => log[metric.key] !== null && log[metric.key] !== undefined);
        const symptoms = this.parseJson(log.symptoms, []);
        const grid = metrics.map((metric) => {
            const value = log[metric.key];
            const shown = value !== null && value !== undefined ? `${this.fmt(value, metric.digits)}${metric.unit ? ' ' + this.t(metric.unit) : ''}` : '—';
            return `<div class="fit-metric"><span>${this.esc(this.t(metric.label))}</span><b>${this.esc(shown)}</b></div>`;
        }).join('');
        return `
            <section class="fit-day-section">
                <div class="fit-day-section-head">
                    <h4><i data-lucide="scale"></i>${this.esc(this.t('day_metrics'))}</h4>
                    <button type="button" class="fit-btn-icon" data-fit-action="add-metrics" data-date="${date}" aria-label="${this.esc(this.t('add_metrics'))}"><i data-lucide="pencil"></i></button>
                </div>
                ${any ? `<div class="fit-metric-grid">${grid}</div>` : `<div class="fit-empty" style="padding:14px"><span>${this.esc(this.t('no_metrics_today'))}</span><button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="add-metrics" data-date="${date}">${this.esc(this.t('add_metrics'))}</button></div>`}
                ${symptoms.length ? `<div class="fit-session-ex">${symptoms.slice(0, 8).map((symptom) => `<span>${this.esc(symptom)}</span>`).join('')}${symptoms.length > 8 ? `<span>+${symptoms.length - 8}</span>` : ''}</div>` : ''}
                ${log.measurement_note ? `<p class="fit-muted" style="margin:0;font-size:.68rem">${this.esc(log.measurement_note)}</p>` : ''}
            </section>
        `;
    },

    renderMealsSection(date) {
        const meals = this.getMeals(date);
        const total = meals.reduce((sum, meal) => sum + (Number(meal.calories) || 0), 0);
        const body = meals.length
            ? meals.map((meal) => {
                const tags = this.parseJson(meal.tags, []);
                return `
                    <div class="fit-meal-row">
                        <span class="fit-muted" style="font-size:.64rem;min-width:34px">${this.esc(meal.meal_time || '')}</span>
                        <span class="fit-grow">
                            <b style="font-size:.73rem">${this.esc(meal.title)}</b>
                            ${tags.length ? `<span class="fit-meal-tags"> · ${this.esc(tags.join(', '))}</span>` : ''}
                            ${Number(meal.estimated) ? `<span class="fit-est" title="${this.esc(this.t('estimated_hint'))}">~${this.esc(this.t('estimated'))}</span>` : ''}
                        </span>
                        ${meal.calories !== null && meal.calories !== undefined ? `<span class="fit-meal-kcal">${this.esc(this.fmt(meal.calories, 0))} ${this.esc(this.t('kcal'))}</span>` : ''}
                        <button type="button" class="fit-btn-icon" data-fit-action="edit-meal" data-date="${date}" data-id="${meal.id}" aria-label="${this.esc(this.t('edit'))}"><i data-lucide="pencil"></i></button>
                        <button type="button" class="fit-btn-icon" data-fit-action="delete-meal" data-date="${date}" data-id="${meal.id}" aria-label="${this.esc(this.t('delete'))}"><i data-lucide="trash-2"></i></button>
                    </div>
                `;
            }).join('')
            : `<div class="fit-empty" style="padding:14px"><span>${this.esc(this.t('no_meals_today'))}</span></div>`;
        return `
            <section class="fit-day-section">
                <div class="fit-day-section-head">
                    <h4><i data-lucide="utensils"></i>${this.esc(this.t('day_meals'))}${total ? ` · ${this.esc(this.t('meal_kcal_total', { n: this.fmt(total, 0) }))}` : ''}</h4>
                    <button type="button" class="fit-btn-icon" data-fit-action="add-meal" data-date="${date}" aria-label="${this.esc(this.t('add_meal'))}"><i data-lucide="plus"></i></button>
                </div>
                ${body}
            </section>
        `;
    },

    renderTimelineSection(date) {
        const events = [];
        for (const meal of this.getMeals(date)) {
            const tilde = Number(meal.estimated) ? '~' : '';
            const macros = [meal.calories ? `${tilde}${this.fmt(meal.calories, 0)} ${this.t('kcal')}` : '', meal.protein ? `${tilde}P ${this.fmt(meal.protein, 0)} ${this.t('g')}` : ''].filter(Boolean).join(' · ');
            events.push({
                time: meal.meal_time || '',
                icon: 'utensils',
                cls: 'meal',
                title: meal.title,
                sub: macros
            });
        }
        for (const workout of this.getWorkouts(date)) {
            events.push({
                time: workout.log_time || '',
                icon: 'dumbbell',
                cls: 'workout',
                title: workout.title,
                sub: [this.t(`workout_${workout.status}`), workout.duration_min ? `${workout.duration_min} ${this.t('min')}` : '', workout.rpe ? `RPE ${workout.rpe}` : ''].filter(Boolean).join(' · ')
            });
        }
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
                sub: `${valueBits.length ? `${valueBits.join('/')}${entry.unit ? ' ' + entry.unit : ''} · ` : ''}${entry.note || ''}`
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
        events.sort((a, b) => {
            const timeA = a.time || '12:00';
            const timeB = b.time || '12:00';
            return timeA.localeCompare(timeB);
        });
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
        ` : `<div class="fit-empty" style="padding:14px"><span>${this.esc(this.t('no_events_today'))}</span></div>`;
        return `
            <section class="fit-day-section">
                <div class="fit-day-section-head"><h4><i data-lucide="clock"></i>${this.esc(this.t('day_timeline'))}</h4></div>
                ${body}
            </section>
        `;
    },

    renderDayChat(date) {
        const messages = this.getChatMessages(date);
        const busy = this.state.chatBusy;
        const error = this.state.chatError;
        const thread = messages.length
            ? messages.map((message) => {
                const role = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system';
                const body = role === 'assistant' ? this.renderChatMarkdown(message.content) : this.esc(message.content);
                return `<div class="fit-chat-bubble ${role}">${body}</div>`;
            }).join('')
            : `<div class="fit-empty" style="border:0;padding:18px 10px"><i data-lucide="sparkles"></i><span>${this.esc(this.t('chat_empty'))}</span></div>`;
        return `
            <div class="fit-chat">
                <div class="fit-chat-note"><i data-lucide="shield-check"></i><span>${this.esc(this.t('chat_note'))}</span></div>
                <div id="fit-chat-thread" class="fit-chat-thread">${thread}</div>
                ${busy ? `<div class="fit-chat-typing">${this.esc(this.t('chat_thinking'))}</div>` : ''}
                ${error ? `<div class="fit-alert fit-alert-danger"><i data-lucide="circle-alert"></i><span>${this.esc(error)}</span></div>` : ''}
                <div class="fit-chat-composer">
                    <textarea id="fit-chat-input" rows="3" aria-label="${this.esc(this.t('aru_tab'))}">${this.esc(this.state.chatDraft || '')}</textarea>
                    <button type="button" class="fit-chat-send" data-fit-action="chat-send" aria-label="${this.esc(this.t('chat_send'))}" ${busy ? 'disabled' : ''}>
                        <i data-lucide="send"></i>
                    </button>
                </div>
                ${messages.length ? `<button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="chat-clear" data-date="${date}" style="align-self:flex-start"><i data-lucide="trash-2"></i>${this.esc(this.t('chat_clear'))}</button>` : ''}
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
        if (window.innerWidth <= 1080) {
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

    openDayPanel(date, tab, draft) {
        this.state.view = 'calendar';
        localStorage.setItem('aru_fit_view', 'calendar');
        this.state.selectedDate = date || this.todayKey();
        this.state.cursor = this.dateFromKey(this.state.selectedDate);
        this.state.dayTab = tab === 'day' ? 'day' : 'aru';
        this.state.chatDraft = draft || '';
        this.loadAll();
        this.render();
        const container = document.getElementById('fit-view');
        if (container) container.scrollTop = 0;
        setTimeout(() => {
            const panel = document.getElementById('fit-day-panel');
            if (panel && window.innerWidth <= 1080) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (this.state.dayTab === 'aru') {
                this.scrollChatToBottom();
                const input = document.getElementById('fit-chat-input');
                if (input && window.innerWidth > 760) input.focus({ preventScroll: true });
            }
        }, 60);
    }
});
