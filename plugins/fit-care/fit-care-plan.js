/*
---ARU-LAB.SPACE---ALMATY---2026---
Aru Fit & Care — training plans: weekly template, per-week overrides,
session builder and logging a completed session.
---chat.aru-lab.space---PWA---
*/
window.FitCarePlugin = window.FitCarePlugin || {};

Object.assign(window.FitCarePlugin, {
    renderPlan() {
        const container = document.getElementById('fit-view');
        if (!container) return;
        const plan = this.currentPlan();
        const plans = this.state.plans || [];
        if (!plan) {
            container.innerHTML = `
                <div class="fit-page">
                    <div class="fit-page-head">
                        <div>
                            <p class="fit-kicker">Aru Fit &amp; Care</p>
                            <h2>${this.esc(this.t('plan_title'))}</h2>
                            <p>${this.esc(this.t('plan_sub'))}</p>
                        </div>
                        <button type="button" class="fit-btn fit-btn-primary" data-fit-action="plan-new">
                            <i data-lucide="plus"></i>${this.esc(this.t('new_plan'))}
                        </button>
                    </div>
                    <div class="fit-card">
                        <div class="fit-empty" style="border:0">
                            <i data-lucide="clipboard-list"></i>
                            <strong>${this.esc(this.t('no_plan_title'))}</strong>
                            <span>${this.esc(this.t('no_plan_sub'))}</span>
                            <button type="button" class="fit-btn fit-btn-primary fit-btn-xs" data-fit-action="plan-new" style="margin-top:6px">
                                <i data-lucide="plus"></i>${this.esc(this.t('new_plan'))}
                            </button>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        const days = window.DB.getFitPlanDays(plan.id) || [];
        const progress = this.getPlanDisplayProgress(plan);
        const sessionsPerWeek = days.filter((day) => (
            Number(day.week_index) === 0 &&
            (day.title || day.focus || this.parseExercises(day.exercises).length)
        )).length;
        const selectedWeek = this.state.planWeek === 'template' ? 0 : Number(this.state.planWeek);
        const weekIndex = Number.isFinite(selectedWeek) ? selectedWeek : 0;
        const weekTabs = [`<button type="button" class="fit-week-tab ${weekIndex === 0 ? 'is-active' : ''}" data-fit-action="plan-week" data-week="template">${this.esc(this.t('plan_template'))}</button>`];
        for (let week = 1; week <= Number(plan.weeks || 0); week++) {
            weekTabs.push(`<button type="button" class="fit-week-tab ${weekIndex === week ? 'is-active' : ''}" data-fit-action="plan-week" data-week="${week}">${this.esc(this.t('plan_week'))} ${week}</button>`);
        }

        const chips = plans.length > 1 ? `
            <div class="fit-row" style="margin-bottom:14px">
                ${plans.map((item) => `
                    <button type="button" class="fit-btn fit-btn-xs ${Number(item.id) === Number(plan.id) ? 'fit-btn-primary' : 'fit-btn-ghost'}" data-fit-action="plan-select" data-id="${item.id}">
                        ${this.esc(item.title || this.t('plan_title'))}
                        ${item.status === 'active' ? `<span class="fit-badge fit-badge-green" style="padding:1px 5px">${this.esc(this.t('plan_active'))}</span>` : ''}
                    </button>
                `).join('')}
            </div>
        ` : '';

        const goalLabel = plan.goal ? this.t(`plan_goal_${plan.goal}`) : '';
        const bannerBits = [];
        if (goalLabel) bannerBits.push(goalLabel);
        if (plan.start_date) bannerBits.push(`${this.t('plan_start')}: ${this.formatShortDate(plan.start_date)}`);
        const weekHint = weekIndex === 0
            ? this.t('plan_template_hint')
            : this.t('plan_edit_week_hint', { n: weekIndex });

        container.innerHTML = `
            <div class="fit-page">
                <div class="fit-page-head">
                    <div>
                        <p class="fit-kicker">Aru Fit &amp; Care</p>
                        <h2>${this.esc(this.t('plan_title'))}</h2>
                        <p>${this.esc(this.t('plan_sub'))}</p>
                    </div>
                    <button type="button" class="fit-btn fit-btn-primary" data-fit-action="plan-new">
                        <i data-lucide="plus"></i>${this.esc(this.t('new_plan'))}
                    </button>
                </div>
                ${chips}
                <div class="fit-plan-banner">
                    <div style="min-width:0">
                        <span class="fit-badge ${plan.status === 'active' ? 'fit-badge-green' : ''}">
                            <i data-lucide="${plan.status === 'active' ? 'play' : 'archive'}"></i>
                            ${this.esc(this.t(plan.status === 'active' ? 'plan_active' : 'plan_archived'))}
                        </span>
                        <h2 style="margin-top:6px">${this.esc(plan.title || this.t('plan_title'))}</h2>
                        ${bannerBits.length ? `<p>${this.esc(bannerBits.join(' · '))}</p>` : ''}
                        ${plan.notes ? `<p style="font-size:.7rem;opacity:.85">${this.esc(plan.notes)}</p>` : ''}
                    </div>
                    <div class="fit-plan-banner-stats">
                        <div class="fit-plan-banner-stat"><b>${plan.weeks}</b><span>${this.esc(this.t('plan_weeks'))}</span></div>
                        <div class="fit-plan-banner-stat"><b>${sessionsPerWeek}</b><span>${this.esc(this.t('plan_sessions'))}</span></div>
                        ${progress ? `<div class="fit-plan-banner-stat"><b>${progress.percent}%</b><span>${this.esc(this.t('plan_progress'))}</span></div>` : ''}
                    </div>
                    <div class="fit-row" style="width:100%">
                        <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="plan-edit">
                            <i data-lucide="pencil"></i>${this.esc(this.t('edit_plan'))}
                        </button>
                        ${plan.status === 'active'
                            ? `<button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="plan-archive"><i data-lucide="archive"></i>${this.esc(this.t('archive_plan'))}</button>`
                            : `<button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="plan-activate"><i data-lucide="play"></i>${this.esc(this.t('activate_plan'))}</button>`}
                        <button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="plan-delete" style="color:var(--fit-accent)">
                            <i data-lucide="trash-2"></i>${this.esc(this.t('delete_plan'))}
                        </button>
                    </div>
                </div>
                ${progress ? `
                    <div class="fit-card" style="margin-bottom:14px;padding:13px 16px">
                        <div class="fit-row" style="justify-content:space-between;margin-bottom:7px">
                            <span class="fit-section-title" style="margin:0"><i data-lucide="calendar-range"></i>${this.esc(this.t('plan_progress'))}</span>
                            <span class="fit-muted" style="font-size:.68rem">${this.esc(this.t('plan_week_of', { n: progress.currentWeek, total: progress.totalWeeks }))}</span>
                        </div>
                        <div class="fit-progress"><i style="width:${progress.percent}%"></i></div>
                    </div>
                ` : ''}
                <div class="fit-card">
                    <div class="fit-week-tabs">${weekTabs.join('')}</div>
                    <p class="fit-muted" style="margin:0 0 12px;font-size:.7rem">${this.esc(weekHint)}</p>
                    <div class="fit-plan-days">
                        ${[1, 2, 3, 4, 5, 6, 7].map((weekday) => this.renderPlanDayCard(plan, days, weekIndex, weekday)).join('')}
                    </div>
                </div>
            </div>
        `;
    },

    currentPlan() {
        const plans = this.state.plans || [];
        if (!plans.length) {
            this.state.planViewId = null;
            return null;
        }
        let plan = plans.find((item) => Number(item.id) === Number(this.state.planViewId));
        if (!plan) plan = this.state.activePlan || plans[0];
        this.state.planViewId = plan.id;
        if (this.state.planWeek !== 'template' && Number(this.state.planWeek) > Number(plan.weeks || 0)) {
            this.state.planWeek = 'template';
        }
        return plan;
    },

    getPlanDisplayProgress(plan) {
        if (!plan || !plan.start_date) return null;
        const totalWeeks = Number(plan.weeks) || 0;
        const totalDays = totalWeeks * 7;
        const elapsed = Math.min(Math.max(this.diffDays(plan.start_date, this.todayKey()) + 1, 0), totalDays);
        return {
            percent: totalDays ? Math.round((elapsed / totalDays) * 100) : 0,
            currentWeek: Math.min(Math.floor(elapsed / 7) + 1, Math.max(totalWeeks, 1)),
            totalWeeks
        };
    },

    planDateForWeekday(plan, weekIndex, weekday) {
        if (!plan || !plan.start_date || !weekIndex) return '';
        return this.addDays(plan.start_date, (Number(weekIndex) - 1) * 7 + (Number(weekday) - 1));
    },

    renderPlanDayCard(plan, days, weekIndex, weekday) {
        const exact = days.find((day) => Number(day.week_index) === weekIndex && Number(day.weekday) === weekday) || null;
        const template = days.find((day) => Number(day.week_index) === 0 && Number(day.weekday) === weekday) || null;
        const day = exact || template;
        const exercises = day ? this.parseExercises(day.exercises) : [];
        const isRest = !day || (!day.title && !day.focus && !exercises.length);
        const inherited = weekIndex > 0 && !exact && !!day;
        const title = isRest ? this.t('rest_day') : (day.title || day.focus || this.t('day_plan'));
        const sessionDate = weekIndex > 0 ? this.planDateForWeekday(plan, weekIndex, weekday) : '';
        const planEnd = plan.start_date ? this.addDays(plan.start_date, Number(plan.weeks || 0) * 7 - 1) : '';
        const canLog = plan.status === 'active' && !!sessionDate && sessionDate <= this.todayKey() && (!planEnd || sessionDate <= planEnd);
        let existing = null;
        if (canLog && day) {
            const workouts = window.DB.getFitWorkouts(sessionDate, sessionDate) || [];
            existing = workouts.find((workout) => Number(workout.plan_day_id) === Number(day.id)) || null;
        }
        const badges = [];
        if (inherited) badges.push(`<span class="fit-badge" style="padding:1px 6px">${this.esc(this.t('plan_template_badge'))}</span>`);
        if (exact && weekIndex > 0) badges.push(`<span class="fit-badge fit-badge-accent" style="padding:1px 6px">${this.esc(this.t('plan_override_badge'))}</span>`);
        if (existing) badges.push(`<span class="fit-badge fit-badge-green" style="padding:1px 6px"><i data-lucide="check"></i>${this.esc(this.t('plan_logged'))}</span>`);
        const headMeta = `${this.t(`weekday_${weekday}`)}${sessionDate ? ` · ${this.formatShortDate(sessionDate)}` : ''}`;
        const exerciseChips = exercises.slice(0, 4).map((exercise) => (
            `<span>${this.esc(this.exerciseLabel(exercise))}</span>`
        )).join('');
        const more = exercises.length > 4 ? `<span class="fit-badge">+${exercises.length - 4}</span>` : '';

        return `
            <div class="fit-plan-day ${isRest ? 'is-rest' : ''} ${sessionDate === this.todayKey() ? 'is-today' : ''}"
                role="button" tabindex="0" data-fit-action="plan-edit-day" data-plan="${plan.id}" data-week="${weekIndex}" data-weekday="${weekday}">
                <div class="fit-plan-day-head">
                    <span>${this.esc(headMeta)}</span>
                    <div class="fit-row" style="gap:4px">${badges.join('')}</div>
                </div>
                <h4>${this.esc(title)}</h4>
                ${!isRest && day.title && day.focus ? `<p>${this.esc(day.focus)}</p>` : ''}
                ${exercises.length ? `<div class="fit-session-ex">${exerciseChips}${more}</div>` : ''}
                ${day && day.notes ? `<p style="font-size:.64rem">${this.esc(day.notes)}</p>` : ''}
                ${canLog && !isRest ? `
                    <div class="fit-row" style="gap:5px;margin-top:auto">
                        <button type="button" class="fit-btn ${existing ? 'fit-btn-ghost' : 'fit-btn-soft'} fit-btn-xs" data-fit-action="plan-log" data-plan-day="${day.id}" data-date="${sessionDate}">
                            <i data-lucide="${existing ? 'pencil' : 'check'}"></i>${this.esc(this.t(existing ? 'plan_logged' : 'plan_mark_done'))}
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    },

    openPlanModal(plan) {
        const existing = plan || null;
        const goalOptions = ['strength', 'fat_loss', 'endurance', 'mobility', 'general']
            .map((goal) => `<option value="${goal}" ${existing && existing.goal === goal ? 'selected' : ''}>${this.esc(this.t(`plan_goal_${goal}`))}</option>`)
            .join('');
        const body = `
            <form id="fit-form-plan" data-fit-form="plan" data-id="${existing ? existing.id : ''}" class="fit-form-grid">
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('plan_name'))}</span>
                    <input class="fit-input" name="title" required maxlength="120" value="${this.esc(existing ? existing.title : '')}" placeholder="${this.esc(this.t('plan_name_placeholder'))}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('plan_goal'))}</span>
                    <select class="fit-select" name="goal">${goalOptions}</select>
                </label>
                <label class="fit-field"><span>${this.esc(this.t('plan_status'))}</span>
                    <select class="fit-select" name="status">
                        <option value="active" ${!existing || existing.status === 'active' ? 'selected' : ''}>${this.esc(this.t('plan_active'))}</option>
                        <option value="archived" ${existing && existing.status === 'archived' ? 'selected' : ''}>${this.esc(this.t('plan_archived'))}</option>
                    </select>
                </label>
                <label class="fit-field"><span>${this.esc(this.t('plan_start'))}</span>
                    <input class="fit-input" name="start_date" type="date" value="${this.esc(existing && existing.start_date ? existing.start_date : this.todayKey())}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('plan_weeks'))}</span>
                    <input class="fit-input" name="weeks" type="number" min="1" max="52" step="1" value="${this.esc(existing ? existing.weeks : 4)}">
                </label>
                <p class="fit-muted fit-span-2" style="margin:0;font-size:.66rem">${this.esc(this.t('plan_start_hint'))} ${this.esc(this.t('plan_weeks_hint'))}</p>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('plan_notes'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <textarea class="fit-textarea" name="notes" rows="3">${this.esc(existing ? existing.notes : '')}</textarea>
                </label>
            </form>
        `;
        this.openModal({
            title: existing ? this.t('edit_plan') : this.t('new_plan'),
            subtitle: this.t('plan_title'),
            body,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="submit-form" data-form="fit-form-plan">${this.esc(this.t('save'))}</button>
            `
        });
    },

    savePlanForm(form) {
        const title = this.fieldValue(form, 'title');
        if (!title) return;
        const id = window.DB.saveFitPlan({
            id: Number(form.dataset.id) || null,
            title,
            goal: this.fieldValue(form, 'goal') || 'general',
            start_date: this.fieldValue(form, 'start_date'),
            weeks: Math.min(52, Math.max(1, this.fieldNumber(form, 'weeks') || 4)),
            status: this.fieldValue(form, 'status') || 'active',
            notes: this.fieldValue(form, 'notes')
        });
        this.state.planViewId = id;
        this.state.planWeek = 'template';
        this.closeModal();
        this.loadAll();
        this.render();
        this.toast(this.t('plan_saved'), 'success');
    },

    openPlanDayModal(planId, weekIndex, weekday) {
        const plan = window.DB.getFitPlan(planId);
        if (!plan) return;
        const days = window.DB.getFitPlanDays(planId) || [];
        const index = Number(weekIndex) || 0;
        const dayNumber = Number(weekday) || 1;
        const exact = days.find((day) => Number(day.week_index) === index && Number(day.weekday) === dayNumber) || null;
        const template = days.find((day) => Number(day.week_index) === 0 && Number(day.weekday) === dayNumber) || null;
        const source = exact || template || {};
        const exercises = this.parseExercises(source.exercises);
        const weekLabel = index === 0 ? this.t('plan_template') : `${this.t('plan_week')} ${index}`;
        const body = `
            <form id="fit-form-plan-day" data-fit-form="plan-day" data-plan="${planId}" data-week="${index}" data-weekday="${dayNumber}" data-id="${exact ? exact.id : ''}" class="fit-form-grid">
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('plan_day_title'))}</span>
                    <input class="fit-input" name="title" maxlength="120" value="${this.esc(source.title || '')}" placeholder="${this.esc(this.t('workout_title_placeholder'))}">
                </label>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('plan_focus'))}</span>
                    <input class="fit-input" name="focus" maxlength="120" value="${this.esc(source.focus || '')}" placeholder="${this.esc(this.t('plan_focus_placeholder'))}">
                </label>
                <div class="fit-span-2">
                    <div class="fit-exercise-list">
                        <div class="fit-exercise-row fit-exercise-head">
                            <span>${this.esc(this.t('plan_exercises'))}</span>
                            <span>${this.esc(this.t('plan_sets'))}</span>
                            <span>${this.esc(this.t('plan_reps'))}</span>
                            <span>${this.esc(this.t('plan_weight'))}</span>
                            <span></span>
                        </div>
                        <div id="fit-exercise-rows" class="fit-exercise-list">
                            ${(exercises.length ? exercises : [{}]).map((exercise) => this.planExerciseRow(exercise)).join('')}
                        </div>
                    </div>
                    <button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="plan-add-exercise" style="margin-top:8px">
                        <i data-lucide="plus"></i>${this.esc(this.t('plan_add_exercise'))}
                    </button>
                </div>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('plan_notes'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <textarea class="fit-textarea" name="notes" rows="2">${this.esc(source.notes || '')}</textarea>
                </label>
                <p class="fit-muted fit-span-2" style="margin:0;font-size:.66rem">
                    ${this.esc(this.t('plan_rest_hint'))}
                    ${index > 0 ? ` ${this.esc(this.t('plan_override_hint'))}` : ''}
                </p>
            </form>
        `;
        const reset = exact && index > 0
            ? `<button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="plan-reset-day" data-id="${exact.id}" style="margin-right:auto"><i data-lucide="rotate-ccw"></i>${this.esc(this.t('plan_reset'))}</button>`
            : exact && index === 0
                ? `<button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="plan-clear-day" data-id="${exact.id}" style="margin-right:auto"><i data-lucide="eraser"></i>${this.esc(this.t('plan_delete_day'))}</button>`
                : '';
        this.openModal({
            title: this.t('modal_plan_day'),
            subtitle: `${this.t(`weekday_full_${dayNumber}`)} · ${weekLabel}`,
            wide: true,
            body,
            footer: `
                ${reset}
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="submit-form" data-form="fit-form-plan-day">${this.esc(this.t('save'))}</button>
            `
        });
    },

    planExerciseRow(exercise) {
        const item = exercise || {};
        return `
            <div class="fit-exercise-row">
                <input name="ex_name" maxlength="120" value="${this.esc(item.name || '')}" placeholder="${this.esc(this.t('plan_exercises'))}">
                <input name="ex_sets" type="number" min="0" step="1" value="${this.esc(item.sets ?? '')}" placeholder="${this.esc(this.t('plan_sets'))}">
                <input name="ex_reps" type="number" min="0" step="1" value="${this.esc(item.reps ?? '')}" placeholder="${this.esc(this.t('plan_reps'))}">
                <input name="ex_weight" type="number" min="0" step="0.5" value="${this.esc(item.weight ?? '')}" placeholder="${this.esc(this.t('plan_weight'))}">
                <button type="button" class="fit-btn-icon" data-fit-action="plan-remove-exercise" aria-label="${this.esc(this.t('delete'))}"><i data-lucide="x"></i></button>
            </div>
        `;
    },

    savePlanDayForm(form) {
        const planId = Number(form.dataset.plan);
        const weekIndex = Number(form.dataset.week) || 0;
        const weekday = Number(form.dataset.weekday) || 1;
        const rows = form.querySelectorAll('#fit-exercise-rows .fit-exercise-row');
        const exercises = [];
        rows.forEach((row) => {
            const name = row.querySelector('[name="ex_name"]');
            if (!name || !String(name.value).trim()) return;
            const valueOf = (selector) => {
                const input = row.querySelector(selector);
                return input && input.value !== '' ? Number(input.value) : null;
            };
            exercises.push({
                name: String(name.value).trim(),
                sets: valueOf('[name="ex_sets"]'),
                reps: valueOf('[name="ex_reps"]'),
                weight: valueOf('[name="ex_weight"]')
            });
        });
        window.DB.saveFitPlanDay({
            id: Number(form.dataset.id) || null,
            plan_id: planId,
            week_index: weekIndex,
            weekday,
            title: this.fieldValue(form, 'title'),
            focus: this.fieldValue(form, 'focus'),
            exercises,
            notes: this.fieldValue(form, 'notes')
        });
        this.state.planViewId = planId;
        this.state.planWeek = weekIndex === 0 ? 'template' : String(weekIndex);
        this.closeModal();
        this.loadAll();
        this.render();
        this.toast(this.t('plan_saved'), 'success');
    },

    handlePlanForm(name, form) {
        if (name === 'plan') {
            this.savePlanForm(form);
            return true;
        }
        if (name === 'plan-day') {
            this.savePlanDayForm(form);
            return true;
        }
        return false;
    },

    handlePlanAction(action, el) {
        switch (action) {
            case 'plan-select': {
                const id = Number(el.dataset.id);
                if (!id) return true;
                this.state.planViewId = id;
                this.state.planWeek = 'template';
                this.render();
                return true;
            }
            case 'plan-new':
                this.openPlanModal(null);
                return true;
            case 'plan-edit': {
                const plan = this.currentPlan();
                if (plan) this.openPlanModal(plan);
                return true;
            }
            case 'plan-activate': {
                const plan = this.currentPlan();
                if (plan) {
                    window.DB.saveFitPlan(Object.assign({}, plan, { status: 'active' }));
                    this.loadAll();
                    this.render();
                    this.toast(this.t('plan_saved'), 'success');
                }
                return true;
            }
            case 'plan-archive': {
                const plan = this.currentPlan();
                if (plan) {
                    window.DB.saveFitPlan(Object.assign({}, plan, { status: 'archived' }));
                    this.loadAll();
                    this.render();
                    this.toast(this.t('plan_saved'), 'success');
                }
                return true;
            }
            case 'plan-delete': {
                const plan = this.currentPlan();
                if (!plan) return true;
                this.confirmDelete(() => {
                    if (Number(this.state.planViewId) === Number(plan.id)) {
                        this.state.planViewId = null;
                        this.state.planWeek = 'template';
                    }
                    window.DB.deleteFitPlan(plan.id);
                }, this.t('delete_plan'));
                return true;
            }
            case 'plan-week': {
                const week = el.dataset.week;
                this.state.planWeek = week === 'template' ? 'template' : String(Number(week) || 1);
                this.render();
                return true;
            }
            case 'plan-edit-day':
                this.openPlanDayModal(
                    Number(el.dataset.plan) || Number(this.state.planViewId),
                    Number(el.dataset.week) || 0,
                    Number(el.dataset.weekday) || 1
                );
                return true;
            case 'plan-add-exercise': {
                const rows = document.getElementById('fit-exercise-rows');
                if (!rows) return true;
                rows.insertAdjacentHTML('beforeend', this.planExerciseRow({}));
                if (window.lucide) window.lucide.createIcons();
                const last = rows.lastElementChild;
                if (last) {
                    const input = last.querySelector('input');
                    if (input) input.focus();
                }
                return true;
            }
            case 'plan-remove-exercise': {
                const row = el.closest('.fit-exercise-row');
                if (row) row.remove();
                return true;
            }
            case 'plan-reset-day':
            case 'plan-clear-day': {
                const id = Number(el.dataset.id);
                if (!id) return true;
                this.confirmDelete(() => window.DB.deleteFitPlanDay(id));
                return true;
            }
            case 'plan-log': {
                const planDayId = Number(el.dataset.planDay);
                const date = el.dataset.date;
                if (!planDayId || !date) return true;
                const day = window.DB.getFitPlanDay(planDayId);
                if (!day) return true;
                const existing = (window.DB.getFitWorkouts(date, date) || []).find((workout) => (
                    Number(workout.plan_day_id) === planDayId
                )) || null;
                this.openWorkoutModal(date, existing ? { workout: existing, planDay: day } : { planDay: day });
                return true;
            }
            default:
                return false;
        }
    }
});
