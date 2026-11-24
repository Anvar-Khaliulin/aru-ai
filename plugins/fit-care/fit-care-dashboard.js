/*
---ARU-LAB.SPACE---ALMATY---2026---
Aru Fit & Care - dashboard: KPIs, nutrition macros, strength e1RM progression,
sRPE/ACWR training load, readiness, SVG charts, heatmap and honest cycle card.
---chat.aru-lab.space---PWA---
*/
window.FitCarePlugin = window.FitCarePlugin || {};

Object.assign(window.FitCarePlugin, {
    BODY_METRICS: [
        { field: 'body_fat', label: 'body_fat', unit: '%', max: 45 },
        { field: 'muscle_mass', label: 'muscle_mass', unit: 'kg', max: 55 },
        { field: 'water_pct', label: 'water_pct', unit: '%', max: 70 },
        { field: 'bone_mass', label: 'bone_mass', unit: 'kg', max: 6 },
        { field: 'visceral_fat', label: 'visceral_fat', unit: '', max: 20 }
    ],

    renderDashboard() {
        const container = document.getElementById('fit-view');
        if (!container) return;
        const stats = this.getDashboardStats();
        this._dashStats = stats;
        const ranges = [30, 90, 365].map((days) => `
            <button type="button" data-fit-action="dash-range" data-range="${days}" class="${this.state.dashRange === days ? 'is-active' : ''}">${this.esc(this.t(`range_${days}`))}</button>
        `).join('');
        container.innerHTML = `
            <div class="fit-page">
                <div class="fit-page-head is-compact">
                    <h2>${this.esc(this.t('dash_title'))}</h2>
                    <div class="fit-row">
                        <div class="fit-range-select" role="group">${ranges}</div>
                    </div>
                </div>
                <div class="fit-kpis">${this.renderDashboardKpis(stats)}</div>
                <div class="fit-dash-grid">
                    <section class="fit-card fit-span-2">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('weight_trend'))}</h3>
                                <p>${this.esc(this.t('range_summary', { n: stats.rangeDays, logged: stats.weights.length }))}</p>
                            </div>
                            <span class="fit-badge fit-badge-violet"><i data-lucide="scale"></i>${this.esc(this.t('kg'))}</span>
                        </div>
                        ${this.renderWeightChart(stats)}
                    </section>
                    <section class="fit-card">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('macro_balance'))}</h3>
                                <p>${this.esc(this.t('avg_per_logged_day'))}</p>
                            </div>
                            <i data-lucide="utensils" style="width:16px;height:16px;color:var(--fit-amber)"></i>
                        </div>
                        ${this.renderDashboardNutrition(stats)}
                    </section>
                    <section class="fit-card">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('insights'))}</h3>
                                <p>${this.esc(this.t('dash_sub'))}</p>
                            </div>
                        </div>
                        <div class="fit-insights">${this.renderDashboardInsights(stats)}</div>
                        <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="dash-ask-aru" style="margin-top:12px;width:100%">
                            <i data-lucide="sparkles"></i>${this.esc(this.t('ask_aru_dash'))}
                        </button>
                    </section>
                    <section class="fit-card">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('workout_volume'))}</h3>
                                <p>${this.esc(this.t('workouts_done', { n: stats.doneWorkouts.length }))}</p>
                            </div>
                            ${stats.load && stats.load.acwr !== null
                                ? `<span class="fit-badge ${stats.load.zone === 'optimal' ? 'fit-badge-green' : (stats.load.zone === 'overload' ? 'fit-badge-danger' : 'fit-badge-amber')}">${this.esc(this.t(`acwr_${stats.load.zone}`, { v: this.fmt(stats.load.acwr, 2) }))}</span>`
                                : `<i data-lucide="bar-chart-3" style="width:16px;height:16px;color:var(--fit-violet)"></i>`}
                        </div>
                        ${this.renderTrainingLoad(stats)}
                    </section>
                    <section class="fit-card">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('strength_progress'))}</h3>
                                <p>${this.esc(this.t('e1rm_label'))}</p>
                            </div>
                            <i data-lucide="trending-up" style="width:16px;height:16px;color:var(--fit-emerald)"></i>
                        </div>
                        ${this.renderStrengthProgress(stats)}
                    </section>
                    <section class="fit-card">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('body_comp'))}</h3>
                                <p>${stats.latestBody ? this.esc(this.formatShortDate(stats.latestBodyDate)) : this.esc(this.t('latest'))}</p>
                            </div>
                            ${stats.load && stats.load.readiness
                                ? `<span class="fit-badge ${stats.load.readiness.level === 'high' ? 'fit-badge-green' : stats.load.readiness.level === 'moderate' ? 'fit-badge-amber' : 'fit-badge-danger'}">${this.esc(this.t(`readiness_${stats.load.readiness.level}`, { n: stats.load.readiness.score }))}</span>`
                                : `<i data-lucide="activity" style="width:16px;height:16px;color:var(--fit-violet)"></i>`}
                        </div>
                        ${this.renderBodyComposition(stats)}
                    </section>
                    ${this.renderDashboardCycle(stats)}
                    <section class="fit-card fit-span-2">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('activity'))}</h3>
                                <p>${this.esc(this.t('range_summary', { n: stats.rangeDays, logged: stats.loggedDays }))}</p>
                            </div>
                            <span class="fit-badge fit-badge-green"><i data-lucide="flame"></i>${this.esc(this.t('insight_streak', { n: stats.streak }))}</span>
                        </div>
                        ${this.renderActivityHeatmap(stats)}
                    </section>
                    <p class="fit-muted" style="grid-column:1/-1;margin:0;text-align:center;font-size:.66rem">${this.esc(this.t('disclaimer_short'))}</p>
                </div>
            </div>
        `;
    },

    getDashboardStats() {
        const range = this.getViewRange();
        const days = [];
        for (let key = range.from; key <= range.to; key = this.addDays(key, 1)) days.push(key);
        const dailyLogs = (window.DB.getFitDailyLogs(range.from, range.to) || []);
        const workouts = (window.DB.getFitWorkouts(range.from, range.to) || []);
        const meals = (window.DB.getFitMeals(range.from, range.to) || []);
        const health = (window.DB.getFitHealthLogs(range.from, range.to) || []);
        const cycleLogs = this.cycleEnabled() ? (window.DB.getFitCycleLogs(range.from, range.to) || []) : [];

        const weights = dailyLogs
            .filter((log) => log.weight !== null && log.weight !== undefined && Number.isFinite(Number(log.weight)))
            .map((log) => ({ date: log.log_date, value: Number(log.weight) }))
            .sort((a, b) => a.date.localeCompare(b.date));

        const mealsByDate = this.groupByDate(meals);
        const workoutsByDate = this.groupByDate(workouts);
        const healthByDate = this.groupByDate(health);
        const cycleByDate = new Map(cycleLogs.map((log) => [log.log_date, log]));
        const dailyByDate = new Map(dailyLogs.map((log) => [log.log_date, log]));

        const nutRange = (window.DB && typeof window.DB.getFitNutritionRange === 'function')
            ? window.DB.getFitNutritionRange(range.from, range.to)
            : { avgCalories: null, avgProtein: null, avgCarbs: null, avgFat: null, calorieDays: 0, proteinDays: 0, carbsDays: 0, fatDays: 0 };

        const sleepValues = dailyLogs
            .filter((log) => log.sleep_hours !== null && log.sleep_hours !== undefined)
            .map((log) => ({ date: log.log_date, value: Number(log.sleep_hours) }));
        const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
        const latestOf = (list) => (list.length ? list[list.length - 1] : null);

        const doneWorkouts = workouts.filter((workout) => workout.status === 'done');
        const plan = this.getActivePlan();
        let plannedSessions = 0;
        let doneSessions = 0;
        let adherence = null;
        if (plan && window.FitCareEngine && typeof window.FitCareEngine.computePlanCompletion === 'function') {
            const comp = window.FitCareEngine.computePlanCompletion(plan, this.state.planDays, workouts, range.from, range.to, this.todayKey());
            plannedSessions = comp.plannedToDate;
            doneSessions = comp.doneToDate;
            adherence = comp.adherencePercent;
        } else {
            plannedSessions = workouts.length;
            doneSessions = doneWorkouts.length;
            adherence = plannedSessions ? Math.min(100, Math.round((doneSessions / plannedSessions) * 100)) : null;
        }

        const dayHasActivity = (log, dateWorkouts, dateMeals, dateHealth, cycleLog) => {
            const hasDaily = !!log && [
                'weight', 'body_fat', 'muscle_mass', 'water_pct', 'bone_mass', 'visceral_fat',
                'steps', 'sleep_hours', 'energy', 'mood', 'stress', 'water_ml', 'calories', 'protein', 'carbs', 'fat'
            ].some((field) => log[field] !== null && log[field] !== undefined)
                || !!(log && (log.note || log.workout_note || log.meal_note || log.workout_status));
            return dateWorkouts.length
                + dateMeals.length
                + dateHealth.length
                + (cycleLog && cycleLog.flow ? 1 : 0)
                + (hasDaily ? 1 : 0);
        };

        const activityByDate = new Map();
        let loggedDays = 0;
        const activitySet = new Set();
        for (const date of days) {
            const count = dayHasActivity(
                dailyByDate.get(date),
                workoutsByDate.get(date) || [],
                mealsByDate.get(date) || [],
                healthByDate.get(date) || [],
                cycleByDate.get(date)
            );
            activityByDate.set(date, count);
            if (count > 0) {
                loggedDays++;
                activitySet.add(date);
            }
        }

        let streakCursor = this.todayKey();
        if (!activitySet.has(streakCursor)) streakCursor = this.addDays(streakCursor, -1);
        let streak = 0;
        while (activitySet.has(streakCursor)) {
            streak++;
            streakCursor = this.addDays(streakCursor, -1);
        }
        if (streak > 0 && streakCursor < range.from) {
            const extraFrom = this.addDays(range.from, -365);
            const extraTo = this.addDays(range.from, -1);
            if (extraFrom <= extraTo) {
                const extraDaily = new Map((window.DB.getFitDailyLogs(extraFrom, extraTo) || []).map((row) => [row.log_date, row]));
                const extraWorkouts = this.groupByDate(window.DB.getFitWorkouts(extraFrom, extraTo) || []);
                const extraMeals = this.groupByDate(window.DB.getFitMeals(extraFrom, extraTo) || []);
                const extraHealth = this.groupByDate(window.DB.getFitHealthLogs(extraFrom, extraTo) || []);
                const extraCycle = new Map((this.cycleEnabled() ? (window.DB.getFitCycleLogs(extraFrom, extraTo) || []) : []).map((row) => [row.log_date, row]));
                for (let k = extraTo; k >= extraFrom; k = this.addDays(k, -1)) {
                    if (dayHasActivity(extraDaily.get(k), extraWorkouts.get(k) || [], extraMeals.get(k) || [], extraHealth.get(k) || [], extraCycle.get(k)) > 0) {
                        activitySet.add(k);
                    }
                }
                while (activitySet.has(streakCursor)) {
                    streak++;
                    streakCursor = this.addDays(streakCursor, -1);
                }
            }
        }

        const bodyConfig = this.BODY_METRICS;
        const latestBody = [...dailyLogs].reverse().find((log) => bodyConfig.some((metric) => (
            log[metric.field] !== null && log[metric.field] !== undefined
        ))) || null;
        const firstWeight = weights.length ? weights[0] : null;
        const lastWeight = weights.length ? weights[weights.length - 1] : null;
        const weightDelta = firstWeight && lastWeight ? Number((lastWeight.value - firstWeight.value).toFixed(1)) : null;
        const cycle = this.getCycleInfo(this.todayKey());
        const missedDoses = this.getDosesForDate(this.todayKey()).filter((dose) => (
            dose.time && dose.time < this.nowTime() && dose.status !== 'taken' && dose.status !== 'skipped'
        )).length;

        const targets = this.getTargets(this.todayKey());
        const strengthProgress = window.FitCareEngine ? window.FitCareEngine.computeStrengthProgress(workouts) : [];
        const load = window.FitCareEngine ? window.FitCareEngine.computeTrainingLoad(workouts, dailyLogs, this.todayKey()) : null;

        let planProgress = this.getActivePlanProgress();
        if (plan && window.FitCareEngine) {
            const span = this.planSpan(plan);
            const planWorkouts = span ? (window.DB.getFitWorkouts(plan.start_date, span.end) || []) : workouts;
            const fullComp = window.FitCareEngine.computePlanCompletion(plan, this.state.planDays, planWorkouts, plan.start_date, span ? span.end : this.todayKey(), this.todayKey());
            if (planProgress && fullComp.completionPercent !== null) {
                planProgress = Object.assign({}, planProgress, {
                    percent: fullComp.completionPercent,
                    doneSessions: fullComp.totalPlanDone,
                    totalSessions: fullComp.totalPlanSessions
                });
            }
        }

        return {
            from: range.from,
            to: range.to,
            days,
            rangeDays: days.length,
            dailyLogs,
            weights,
            firstWeight,
            lastWeight,
            weightDelta,
            weightDays: firstWeight && lastWeight ? this.diffDays(firstWeight.date, lastWeight.date) : 0,
            workouts,
            doneWorkouts,
            plannedSessions,
            doneSessions,
            adherence,
            sleepValues,
            latestSleep: latestOf(sleepValues),
            avgSleep: average(sleepValues.map((item) => item.value)),
            avgCalories: nutRange.avgCalories,
            calorieDays: nutRange.calorieDays,
            avgProtein: nutRange.avgProtein,
            proteinDays: nutRange.proteinDays,
            avgCarbs: nutRange.avgCarbs,
            carbsDays: nutRange.carbsDays,
            avgFat: nutRange.avgFat,
            fatDays: nutRange.fatDays,
            targets,
            strengthProgress,
            load,
            latestBody,
            latestBodyDate: latestBody ? latestBody.log_date : '',
            loggedDays,
            streak,
            activityByDate,
            cycle,
            cycleAvg: this.cycleStats().lengths.length >= 2 ? this.averageCycleLength() : null,
            missedDoses,
            plan,
            planProgress
        };
    },

    renderDashboardKpis(stats) {
        const kg = this.t('kg');
        const h = this.t('h');
        const kcal = this.t('kcal');
        const g = this.t('g');
        const t = stats.targets;

        const weightValue = stats.lastWeight ? `${this.fmt(stats.lastWeight.value)} ${kg}` : '—';
        const weightHint = stats.lastWeight && stats.firstWeight
            ? `${this.t('kpi_change')}: ${stats.weightDelta > 0 ? '+' : ''}${this.fmt(stats.weightDelta)} ${kg}`
            : this.t('not_logged');

        let calHint = this.t('avg_per_logged_day');
        if (stats.avgCalories !== null && t && t.calorieMin && t.calorieMax) {
            calHint = stats.avgCalories < t.calorieMin
                ? this.t('avg_corridor_low', { min: t.calorieMin, max: t.calorieMax })
                : stats.avgCalories > t.calorieMax
                    ? this.t('avg_corridor_high', { min: t.calorieMin, max: t.calorieMax })
                    : this.t('avg_corridor_in', { min: t.calorieMin, max: t.calorieMax });
        }

        const protHint = (t && t.protein)
            ? `${this.t('target')}: ${t.protein} ${g}`
            : this.t('avg_per_logged_day');

        const sleepHint = stats.latestSleep
            ? `${this.t('latest')}: ${this.fmt(stats.latestSleep.value)} ${h}`
            : this.t('not_logged');

        const readiness = stats.load && stats.load.readiness;
        const lastCard = readiness
            ? {
                icon: 'heart-pulse',
                label: 'readiness',
                value: `${readiness.score}/100`,
                hint: this.t(`readiness_${readiness.level}`, { n: readiness.score })
            }
            : {
                icon: 'flame',
                label: 'kpi_streak',
                value: stats.streak,
                hint: this.t('range_summary', { n: stats.rangeDays, logged: stats.loggedDays })
            };

        const cards = [
            { icon: 'scale', label: 'kpi_weight', value: weightValue, hint: weightHint },
            { icon: 'flame', label: 'kpi_calories', value: stats.avgCalories !== null ? `${this.fmt(stats.avgCalories, 0)} ${kcal}` : '—', hint: calHint },
            { icon: 'beef', label: 'kpi_protein', value: stats.avgProtein !== null ? `${this.fmt(stats.avgProtein, 0)} ${g}` : '—', hint: protHint },
            {
                icon: 'target',
                label: 'kpi_adherence',
                value: stats.adherence !== null ? `${stats.adherence}%` : stats.doneWorkouts.length,
                hint: stats.plannedSessions ? `${stats.doneSessions}/${stats.plannedSessions} ${this.t('sessions')}` : `${stats.doneWorkouts.length} ${this.t('sessions')}`
            },
            { icon: 'moon', label: 'kpi_sleep', value: stats.avgSleep !== null ? `${this.fmt(stats.avgSleep)} ${h}` : '—', hint: sleepHint },
            lastCard
        ];
        return cards.map((card) => `
            <div class="fit-kpi">
                <div class="fit-kpi-top"><span>${this.esc(this.t(card.label))}</span><i data-lucide="${card.icon}"></i></div>
                <b>${this.esc(card.value)}</b>
                <small>${this.esc(card.hint)}</small>
            </div>
        `).join('');
    },

    renderDashboardNutrition(stats) {
        if (stats.avgCalories === null && stats.avgProtein === null && stats.avgCarbs === null && stats.avgFat === null) {
            return `<div class="fit-chart-empty" style="min-height:130px"><i data-lucide="utensils"></i><span>${this.esc(this.t('no_meals_today'))}</span></div>`;
        }
        const t = stats.targets || {};
        const row = (cls, label, val, unit, target) => {
            const pct = target && val !== null ? Math.min(100, Math.round((val / target) * 100)) : (val ? 55 : 0);
            const tgtText = target ? ` / ${this.fmt(target, 0)} ${unit}` : ` ${unit}`;
            return `
                <div class="fit-dash-macro-row">
                    <span>${this.esc(label)}</span>
                    <div class="fit-compo-track"><div class="fit-compo-fill ${cls}" style="width:${pct}%"></div></div>
                    <b>${val !== null ? this.esc(this.fmt(val, 0)) : '—'}<small class="fit-muted">${this.esc(tgtText)}</small></b>
                </div>
            `;
        };
        return `
            <div class="fit-stack" style="gap:10px">
                ${row('is-cal', this.t('calories'), stats.avgCalories, this.t('kcal'), t.calorieTarget)}
                ${row('is-p', this.t('protein'), stats.avgProtein, this.t('g'), t.protein)}
                ${row('is-c', this.t('carbs'), stats.avgCarbs, this.t('g'), t.carbs)}
                ${row('is-f', this.t('fat'), stats.avgFat, this.t('g'), t.fat)}
            </div>
            ${t.bmr ? `<p class="fit-muted" style="margin:12px 0 0;font-size:.65rem">${this.esc(this.t('bmr_label'))}: ${this.esc(this.fmt(t.bmr, 0))} · ${this.esc(this.t('tdee_label'))}: ${this.esc(this.fmt(t.tdee, 0))} ${this.esc(this.t('kcal'))}</p>` : ''}
        `;
    },

    renderStrengthProgress(stats) {
        const list = stats.strengthProgress || [];
        if (!list.length) {
            return `<div class="fit-chart-empty" style="min-height:140px"><i data-lucide="dumbbell"></i><span>${this.esc(this.t('no_strength_data'))}</span></div>`;
        }
        return `
            <div class="fit-stack" style="gap:7px">
                ${list.map((item) => {
                    const delta = item.deltaE1RM !== null ? item.deltaE1RM : item.deltaWeight;
                    const deltaCls = delta > 0 ? 'positive' : delta < 0 ? 'negative' : '';
                    const deltaText = delta !== null && delta !== 0
                        ? `${delta > 0 ? '+' : ''}${this.fmt(delta, 1)} ${this.t('kg')}`
                        : `${item.sessionCount}×`;
                    const e1rmStr = item.latestE1RM ? `${this.t('e1rm_label')} ${this.fmt(item.latestE1RM, 1)} ${this.t('kg')}` : '';
                    return `
                        <div class="fit-strength-row">
                            <div class="fit-grow" style="min-width:0">
                                <b>${this.esc(item.name)}</b>
                                <small>${this.esc(this.fmt(item.latestWeight, 1))} ${this.esc(this.t('kg'))}${item.latestSets || item.latestReps ? ` · ${item.latestSets || '?'}×${item.latestReps || '?'}` : ''}${e1rmStr ? ` · ${this.esc(e1rmStr)}` : ''}</small>
                            </div>
                            <span class="fit-strength-delta ${deltaCls}">${this.esc(deltaText)}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderWeightChart(stats) {
        const t = (key, vars) => this.esc(this.t(key, vars));
        if (stats.weights.length < 2) {
            return `<div class="fit-chart-empty"><i data-lucide="line-chart"></i><span>${t('no_weight_data')}</span></div>`;
        }
        const W = 760;
        const H = 250;
        const pad = { l: 38, r: 18, t: 16, b: 28 };
        const points = stats.weights;
        const rawValues = points.map((point) => point.value);
        const rawMin = Math.min(...rawValues);
        const rawMax = Math.max(...rawValues);
        const spread = Math.max(rawMax - rawMin, 1);
        const target = Number((this.state.profile || {}).target_weight) || null;
        const showTarget = target && target > rawMin - Math.max(spread * 2, 15) && target < rawMax + Math.max(spread * 2, 15);
        const values = showTarget ? rawValues.concat(target) : rawValues;
        let min = Math.min(...values);
        let max = Math.max(...values);
        const padValue = Math.max((max - min) * 0.18, 0.5);
        min -= padValue;
        max += padValue;

        const startDate = this.dateFromKey(stats.from).getTime();
        const endDate = this.dateFromKey(stats.to).getTime();
        const span = Math.max(endDate - startDate, 86400000);
        const xFor = (date) => pad.l + ((this.dateFromKey(date).getTime() - startDate) / span) * (W - pad.l - pad.r);
        const yFor = (value) => pad.t + (1 - (value - min) / (max - min)) * (H - pad.t - pad.b);
        const pathFor = (list) => list.map((point, index) => (
            `${index ? 'L' : 'M'}${xFor(point.date).toFixed(1)},${yFor(point.value).toFixed(1)}`
        )).join(' ');

        const avgPoints = points.map((point) => {
            const windowStart = this.addDays(point.date, -6);
            const windowValues = points
                .filter((item) => item.date >= windowStart && item.date <= point.date)
                .map((item) => item.value);
            return {
                date: point.date,
                value: windowValues.reduce((sum, value) => sum + value, 0) / windowValues.length
            };
        });
        const avgPath = pathFor(avgPoints);
        const rawPath = pathFor(points);
        const areaPath = `${avgPath} L${xFor(avgPoints[avgPoints.length - 1].date).toFixed(1)},${(H - pad.b).toFixed(1)} L${xFor(avgPoints[0].date).toFixed(1)},${(H - pad.b).toFixed(1)} Z`;

        const grid = [];
        const tickCount = 4;
        for (let index = 0; index < tickCount; index++) {
            const value = max - ((max - min) * index) / (tickCount - 1);
            const y = yFor(value);
            grid.push(`<line class="grid-line" x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}"></line>`);
            grid.push(`<text x="${pad.l - 7}" y="${(y + 3).toFixed(1)}" text-anchor="end">${this.esc(this.fmt(value, 1))}</text>`);
        }

        const labelCount = 4;
        const labels = [];
        const seen = new Set();
        for (let index = 0; index < labelCount; index++) {
            const dayIndex = Math.round(((stats.days.length - 1) * index) / (labelCount - 1));
            const date = stats.days[dayIndex];
            if (!date || seen.has(date)) continue;
            seen.add(date);
            const anchor = index === 0 ? 'start' : index === labelCount - 1 ? 'end' : 'middle';
            labels.push(`<text x="${xFor(date).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${this.esc(this.formatShortDate(date))}</text>`);
        }

        const dots = points.length <= 60
            ? points.map((point) => `<circle class="dot-raw" cx="${xFor(point.date).toFixed(1)}" cy="${yFor(point.value).toFixed(1)}" r="2.4"><title>${t('chart_tooltip_weight', { date: this.formatShortDate(point.date), n: this.fmt(point.value) })}</title></circle>`).join('')
            : '';
        const targetLine = showTarget
            ? `<line class="line-target" x1="${pad.l}" y1="${yFor(target).toFixed(1)}" x2="${W - pad.r}" y2="${yFor(target).toFixed(1)}"></line>
               <text x="${W - pad.r}" y="${(yFor(target) - 5).toFixed(1)}" text-anchor="end">${t('target')} ${this.esc(this.fmt(target))}</text>`
            : '';

        return `
            <div class="fit-chart-wrap">
                <svg class="fit-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('weight_trend')}">
                    ${grid.join('')}
                    <path class="area-fill" d="${areaPath}"></path>
                    <path class="line-raw" d="${rawPath}"></path>
                    <path class="line-avg" d="${avgPath}"></path>
                    ${dots}
                    ${targetLine}
                    ${labels.join('')}
                </svg>
            </div>
            <div class="fit-chart-legend">
                <span class="fit-legend-item"><span class="fit-legend-swatch" style="opacity:.35"></span>${t('weight')}</span>
                <span class="fit-legend-item"><span class="fit-legend-swatch"></span>${t('avg_7d')}</span>
                ${showTarget ? `<span class="fit-legend-item"><span class="fit-legend-swatch dotted"></span>${t('target')}</span>` : ''}
            </div>
        `;
    },

    renderBodyComposition(stats) {
        if (!stats.latestBody) {
            return `<div class="fit-chart-empty" style="min-height:130px"><i data-lucide="ruler"></i><span>${this.esc(this.t('no_body_data'))}</span></div>`;
        }
        const logs = stats.dailyLogs || [];
        const rows = [];
        let newestDate = stats.latestBodyDate || '';
        for (const metric of this.BODY_METRICS) {
            let latestIdx = -1;
            for (let i = logs.length - 1; i >= 0; i--) {
                if (logs[i][metric.field] !== null && logs[i][metric.field] !== undefined) {
                    latestIdx = i;
                    break;
                }
            }
            if (latestIdx < 0) continue;
            const latestLog = logs[latestIdx];
            if (!newestDate || latestLog.log_date > newestDate) newestDate = latestLog.log_date;
            const value = latestLog[metric.field];
            let previous = null;
            for (let i = latestIdx - 1; i >= 0; i--) {
                if (logs[i][metric.field] !== null && logs[i][metric.field] !== undefined) {
                    previous = logs[i];
                    break;
                }
            }
            const delta = previous ? Number(value) - Number(previous[metric.field]) : null;
            const percent = Math.min(100, Math.max(2, (Number(value) / metric.max) * 100));
            const deltaText = delta === null ? '' : ` · ${delta > 0 ? '+' : ''}${this.fmt(delta, 1)}`;
            const unitSuffix = metric.unit ? (metric.unit === '%' ? '%' : ` ${this.t(metric.unit)}`) : '';
            rows.push(`
                <div class="fit-compo-row" title="${this.esc(`${this.t(metric.label)}: ${this.fmt(value)}${deltaText}`)}">
                    <span>${this.esc(this.t(metric.label))}</span>
                    <div class="fit-compo-track"><div class="fit-compo-fill" style="width:${percent.toFixed(1)}%"></div></div>
                    <b>${this.esc(this.fmt(value))}${this.esc(unitSuffix)}</b>
                </div>
            `);
        }
        if (!rows.length) {
            return `<div class="fit-chart-empty" style="min-height:130px"><i data-lucide="ruler"></i><span>${this.esc(this.t('no_body_data'))}</span></div>`;
        }
        return `
            <div style="display:flex;flex-direction:column;gap:11px">${rows.join('')}</div>
            <p class="fit-muted" style="margin:12px 0 0;font-size:.65rem">${this.esc(this.t('latest'))}: ${this.esc(this.formatShortDate(newestDate))}</p>
        `;
    },

    renderTrainingLoad(stats) {
        const workouts = stats.doneWorkouts;
        if (!workouts.length) {
            return `<div class="fit-chart-empty" style="min-height:150px"><i data-lucide="bar-chart-3"></i><span>${this.esc(this.t('no_workout_data'))}</span></div>`;
        }
        const bucketDays = stats.rangeDays > 120 ? 30 : 7;
        const buckets = [];
        let end = stats.to;
        while (end >= stats.from) {
            let from = this.addDays(end, -(bucketDays - 1));
            if (from < stats.from) from = stats.from;
            const list = workouts.filter((workout) => workout.log_date >= from && workout.log_date <= end);
            buckets.unshift({
                from,
                to: end,
                count: list.length,
                volume: list.reduce((sum, workout) => sum + (Number(workout.volume_kg) || 0), 0),
                srpe: list.reduce((sum, w) => sum + Math.round((Number(w.duration_min) || 35) * (Number(w.rpe) || 6)), 0),
                duration: list.reduce((sum, workout) => sum + (Number(workout.duration_min) || 0), 0)
            });
            end = this.addDays(from, -1);
        }
        const useVolume = buckets.some((bucket) => bucket.volume > 0);
        const useSrpe = !useVolume && buckets.some((bucket) => bucket.srpe > 0);
        const values = buckets.map((bucket) => (useVolume ? bucket.volume : (useSrpe ? bucket.srpe : bucket.count)));
        const maxValue = Math.max(...values, 1);
        const W = 460;
        const H = 190;
        const pad = { l: 44, r: 8, t: 14, b: 28 };
        const innerW = W - pad.l - pad.r;
        const innerH = H - pad.t - pad.b;
        const slot = innerW / buckets.length;
        const barW = Math.max(4, Math.min(26, slot * 0.62));
        const unit = useVolume ? this.t('kg') : (useSrpe ? 'AU' : this.t('sessions'));

        const bars = buckets.map((bucket, index) => {
            const value = values[index];
            const height = value > 0 ? Math.max(2, (value / maxValue) * innerH) : 0;
            const x = pad.l + slot * index + (slot - barW) / 2;
            const y = pad.t + innerH - height;
            const showLabel = buckets.length <= 8 || index % 2 === 0 || index === buckets.length - 1;
            const label = showLabel
                ? `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 9}" text-anchor="middle" style="font-size:8px">${this.esc(this.formatShortDate(bucket.from))}</text>`
                : '';
            if (!height) return label;
            const tooltip = `${this.formatShortDate(bucket.from)}–${this.formatShortDate(bucket.to)}: ${this.fmt(value)} ${unit} · ${bucket.count} ${this.t('sessions')}`;
            return `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(1)}"><title>${this.esc(tooltip)}</title></rect>${label}`;
        });

        const grid = [0, 0.5, 1].map((ratio) => {
            const y = pad.t + innerH * ratio;
            const value = maxValue * (1 - ratio);
            return `<line class="grid-line" x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}"></line>
                <text x="${pad.l - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${this.esc(this.fmt(value, value >= 1000 ? 0 : 1))}</text>`;
        }).join('');

        const total = values.reduce((sum, value) => sum + value, 0);
        return `
            <div class="fit-chart-wrap">
                <svg class="fit-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${this.esc(this.t('workout_volume'))}">
                    ${grid}
                    ${bars.join('')}
                </svg>
            </div>
            <div class="fit-chart-legend">
                <span class="fit-legend-item"><span class="fit-legend-swatch violet"></span>${this.esc(this.fmt(total, useVolume ? 0 : 0))} ${this.esc(unit)}</span>
                <span class="fit-legend-item">${this.esc(this.t('sessions'))}: ${stats.doneWorkouts.length}</span>
            </div>
        `;
    },

    renderDashboardCycle(stats) {
        const cycle = stats.cycle;
        if (!cycle.tracking) return '';
        if (!cycle.hasData) {
            return `
                <section class="fit-card">
                    <div class="fit-card-head">
                        <div>
                            <h3>${this.esc(this.t('cycle_title'))}</h3>
                            <p>${this.esc(this.t('cycle_sub'))}</p>
                        </div>
                        <i data-lucide="droplet" style="width:16px;height:16px;color:var(--fit-accent)"></i>
                    </div>
                    <div class="fit-empty" style="padding:16px">
                        <strong>${this.esc(this.t('cycle_no_history'))}</strong>
                        <span>${this.esc(this.t('cycle_prediction_note'))}</span>
                    </div>
                    <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="cycle-start" data-date="${this.todayKey()}" style="margin-top:10px;width:100%">
                        <i data-lucide="play"></i>${this.esc(this.t('cycle_mark_start'))}
                    </button>
                </section>
            `;
        }
        if (cycle.paused || cycle.confidence === 'paused') {
            return `
                <section class="fit-card">
                    <div class="fit-card-head">
                        <div>
                            <h3>${this.esc(this.t('cycle_title'))}</h3>
                            <p>${this.esc(this.t('cycle_avg'))}: ${cycle.avg}</p>
                        </div>
                        <span class="fit-badge"><i data-lucide="pause-circle"></i>${this.esc(this.t('cycle_phase_paused'))}</span>
                    </div>
                    <div class="fit-empty" style="padding:14px">
                        <strong>${this.esc(this.t('cycle_paused'))}</strong>
                        <span>${this.esc(this.t('cycle_paused_desc', { date: this.formatShortDate(cycle.lastStart), days: cycle.daysSinceLastStartToday ?? cycle.daysSinceLastStart }))}</span>
                    </div>
                    <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="cycle-start" data-date="${this.todayKey()}" style="margin-top:10px;width:100%">
                        <i data-lucide="play"></i>${this.esc(this.t('cycle_resume'))}
                    </button>
                </section>
            `;
        }
        if (cycle.confidence === 'late') {
            return `
                <section class="fit-card">
                    <div class="fit-card-head">
                        <div>
                            <h3>${this.esc(this.t('cycle_title'))}</h3>
                            <p>${this.esc(this.t('cycle_avg'))}: ${cycle.avg}</p>
                        </div>
                        <span class="fit-badge fit-badge-amber"><i data-lucide="clock"></i>${this.esc(this.t('cycle_late', { day: cycle.day, late: cycle.lateDays }))}</span>
                    </div>
                    <div class="fit-alert fit-alert-warn" style="margin:0 0 10px">
                        <i data-lucide="calendar-clock"></i>
                        <span>${this.esc(this.t('cycle_late_desc', { late: cycle.lateDays, avg: cycle.avg, date: this.formatShortDate(cycle.lastStart) }))}</span>
                    </div>
                    <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="cycle-start" data-date="${this.todayKey()}" style="width:100%">
                        <i data-lucide="play"></i>${this.esc(this.t('cycle_resume'))}
                    </button>
                </section>
            `;
        }

        const percent = Math.min(100, Math.max(2, (cycle.day / cycle.avg) * 100));
        const phase = this.t(`cycle_phase_${cycle.phase}`);
        const forecast = cycle.confidence !== 'recorded';
        const confidenceBadge = forecast
            ? `<span class="fit-badge fit-badge-amber" title="${this.esc(this.t('cycle_forecast_note'))}"><i data-lucide="calendar-clock"></i>${this.esc(this.t('cycle_forecast'))}</span>`
            : '';
        const nextLine = cycle.nextPeriod
            ? this.esc(forecast
                ? this.t('cycle_next_period_forecast', { date: this.formatShortDate(cycle.nextPeriod) })
                : `${this.t('cycle_next_period')}: ${this.formatShortDate(cycle.nextPeriod)}`)
            : '';
        return `
            <section class="fit-card">
                <div class="fit-card-head">
                    <div>
                        <h3>${this.esc(this.t('cycle_title'))}</h3>
                        <p>${this.esc(this.t('cycle_sub'))}</p>
                    </div>
                    <span class="fit-badge fit-badge-accent"><i data-lucide="sparkles"></i>${this.esc(phase)}</span>
                </div>
                <div class="fit-cycle-mini">
                    <div class="fit-cycle-ring" style="--pct:${percent.toFixed(1)}">
                        <div class="fit-cycle-ring-inner"><b>${cycle.day}</b><span>${this.esc(this.t('cycle_day'))}</span></div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:7px;min-width:0">
                        <b class="fit-row" style="font-size:.86rem;gap:5px">${this.esc(phase)}${confidenceBadge}</b>
                        ${nextLine ? `<span class="fit-muted" style="font-size:.68rem">${nextLine}</span>` : ''}
                        <div class="fit-row" style="gap:5px">
                            <span class="fit-badge fit-badge-violet"><i data-lucide="refresh-cw"></i>${this.esc(this.t('cycle_avg'))} ${cycle.avg}</span>
                            ${stats.cycleAvg && stats.cycleAvg !== cycle.avg ? `<span class="fit-badge">${this.esc(this.t('insight_cycle_long', { n: stats.cycleAvg }))}</span>` : ''}
                        </div>
                    </div>
                </div>
                <p class="fit-muted" style="margin:11px 0 0;font-size:.63rem;line-height:1.5">${this.esc(this.t('cycle_prediction_note'))}</p>
            </section>
        `;
    },

    renderDashboardInsights(stats) {
        const insights = [];
        const weight = this.state.profile || {};
        if (stats.weights.length >= 2) {
            const delta = stats.weightDelta;
            if (Math.abs(delta) < 0.4) {
                insights.push({ icon: 'minus', tone: 'green', title: this.t('weight_trend'), text: this.t('insight_weight_stable', { days: stats.weightDays }) });
            } else {
                const goal = weight.goal || 'maintain';
                const tone = goal === 'lose'
                    ? (delta < 0 ? 'green' : 'amber')
                    : goal === 'gain'
                        ? (delta > 0 ? 'green' : 'amber')
                        : 'violet';
                insights.push({
                    icon: delta < 0 ? 'trending-down' : 'trending-up',
                    tone,
                    title: this.t('weight_trend'),
                    text: this.t(delta < 0 ? 'insight_weight_down' : 'insight_weight_up', { delta: this.fmt(Math.abs(delta)), days: stats.weightDays })
                });
            }
        }
        if (stats.load && stats.load.acwr !== null && stats.load.zone === 'overload') {
            insights.push({
                icon: 'triangle-alert',
                tone: 'amber',
                title: this.t('training_load'),
                text: this.t('insight_acwr_overload', { acwr: this.fmt(stats.load.acwr, 2) })
            });
        }
        if (stats.load && stats.load.readiness && stats.load.readiness.level === 'low') {
            insights.push({
                icon: 'heart-pulse',
                tone: 'amber',
                title: this.t('readiness'),
                text: this.t('insight_readiness_low', { score: stats.load.readiness.score })
            });
        }
        if (stats.plannedSessions > 0) {
            const good = (stats.adherence || 0) >= 70;
            insights.push({
                icon: 'target',
                tone: good ? 'green' : 'amber',
                title: this.t('adherence'),
                text: this.t(good ? 'insight_adherence_good' : 'insight_adherence_low', { done: stats.doneSessions, planned: stats.plannedSessions })
            });
        }
        if (stats.avgSleep !== null) {
            const low = stats.avgSleep < 7;
            insights.push({
                icon: 'moon',
                tone: low ? 'amber' : 'violet',
                title: this.t('sleep'),
                text: this.t(low ? 'insight_sleep_low' : 'insight_sleep_ok', { h: this.fmt(stats.avgSleep) })
            });
        }
        const targetProtein = (stats.targets && stats.targets.protein) || (stats.lastWeight ? Math.round(stats.lastWeight.value * 1.4) : null);
        if (stats.avgProtein !== null && targetProtein && stats.avgProtein < targetProtein * 0.88) {
            insights.push({
                icon: 'beef',
                tone: 'amber',
                title: this.t('protein'),
                text: this.t('insight_protein_dynamic', { g: this.fmt(stats.avgProtein, 0), target: this.fmt(targetProtein, 0) })
            });
        }
        if (stats.avgCalories !== null && stats.calorieDays >= 2) {
            const min = stats.targets && stats.targets.calorieMin;
            const max = stats.targets && stats.targets.calorieMax;
            if (min && max) {
                if (stats.avgCalories < min) {
                    insights.push({ icon: 'flame', tone: 'amber', title: this.t('calories'), text: this.t('insight_calories_corridor_low', { n: this.fmt(stats.avgCalories, 0), min, max }) });
                } else if (stats.avgCalories > max) {
                    insights.push({ icon: 'flame', tone: 'amber', title: this.t('calories'), text: this.t('insight_calories_corridor_high', { n: this.fmt(stats.avgCalories, 0), min, max }) });
                } else {
                    insights.push({ icon: 'flame', tone: 'green', title: this.t('calories'), text: this.t('insight_calories_corridor_ok', { n: this.fmt(stats.avgCalories, 0), min, max }) });
                }
            } else {
                insights.push({ icon: 'flame', tone: 'violet', title: this.t('calories'), text: this.t('insight_calories_in', { n: this.fmt(stats.avgCalories, 0) }) });
            }
        }
        if (!stats.doneWorkouts.length) {
            insights.push({ icon: 'dumbbell', tone: 'amber', title: this.t('workouts'), text: this.t('insight_no_workouts') });
        }
        if (stats.streak >= 2) {
            insights.push({ icon: 'flame', tone: 'green', title: this.t('kpi_streak'), text: this.t('insight_streak', { n: stats.streak }) });
        }
        if (weight.target_weight && stats.firstWeight && stats.lastWeight) {
            const start = stats.firstWeight.value;
            const current = stats.lastWeight.value;
            const target = Number(weight.target_weight);
            const spanWeight = start - target;
            if (Math.abs(current - target) <= 0.5 || (Math.abs(spanWeight) > 0.5 && Math.round(((start - current) / spanWeight) * 100) >= 100)) {
                insights.push({ icon: 'flag', tone: 'green', title: this.t('target'), text: this.t('insight_target_reached') });
            } else if (Math.abs(spanWeight) > 0.5) {
                const progress = Math.round(((start - current) / spanWeight) * 100);
                if (progress > 0 && progress < 100) {
                    insights.push({ icon: 'flag', tone: 'green', title: this.t('target'), text: this.t('insight_target_progress', { pct: Math.min(99, progress) }) });
                }
            }
        }
        if (stats.missedDoses > 0) {
            insights.push({ icon: 'pill', tone: 'amber', title: this.t('today_doses'), text: this.t('insight_med_missed', { n: stats.missedDoses }) });
        }
        const selected = insights.slice(0, 6);
        if (!selected.length) {
            return `<div class="fit-chart-empty" style="min-height:110px;border:0;padding:8px"><i data-lucide="sparkles"></i><span>${this.esc(this.t('no_activity_data'))}</span></div>`;
        }
        return selected.map((insight) => `
            <div class="fit-insight">
                <span class="fit-insight-icon ${insight.tone}"><i data-lucide="${insight.icon}"></i></span>
                <div><b>${this.esc(insight.title)}</b><small>${this.esc(insight.text)}</small></div>
            </div>
        `).join('');
    },

    renderActivityHeatmap(stats) {
        const gridStart = this.dateKey(this.startOfWeek(stats.from));
        const gridEnd = this.addDays(this.dateKey(this.startOfWeek(stats.to)), 6);
        let cells = '';
        for (let key = gridStart; key <= gridEnd; key = this.addDays(key, 1)) {
            const inRange = key >= stats.from && key <= stats.to;
            const count = inRange ? (stats.activityByDate.get(key) || 0) : 0;
            const level = count === 0 ? '' : count === 1 ? 'l1' : count === 2 ? 'l2' : count === 3 ? 'l3' : 'l4';
            const classes = ['fit-heat-cell', level, inRange ? '' : 'is-empty'].filter(Boolean).join(' ');
            const label = this.t('heatmap_cell', { date: this.formatDate(key, { day: 'numeric', month: 'long' }), n: count });
            cells += `<span class="${classes}" title="${this.esc(label)}"></span>`;
        }
        return `
            <div class="fit-heatmap-wrap">
                <div class="fit-heatmap" role="img" aria-label="${this.esc(this.t('activity'))}">${cells}</div>
            </div>
            <div class="fit-heatmap-legend">
                <span>${this.esc(this.t('heatmap_less'))}</span>
                <i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i>
                <span>${this.esc(this.t('heatmap_more'))}</span>
            </div>
        `;
    },

    handleDashboardAction(action, el) {
        if (action === 'dash-range') {
            const range = Number(el.dataset.range);
            if (![30, 90, 365].includes(range)) return true;
            this.state.dashRange = range;
            localStorage.setItem('aru_fit_dash_range', String(range));
            this.loadAll();
            this.render();
            return true;
        }
        if (action === 'dash-ask-aru') {
            this.openDayPanel(this.todayKey(), 'aru', this.t('dash_aru_prompt', { n: this.state.dashRange }), true);
            return true;
        }
        return false;
    }
});
