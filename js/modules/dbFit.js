/*
---ARU-LAB.SPACE---ALMATY---2026---
Fit & Care SQLite persistence, cycle math, and AI snapshot helpers extracted from db.js.
---chat.aru-lab.space---PWA---
*/

export const DBFitMethods = {
    // --- Aru Fit & Care ---

    _fitDateKey(date) {
        const d = date instanceof Date ? date : new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    _fitDateFromKey(key) {
        return new Date(`${key}T12:00:00`);
    },

    _fitAddDays(key, days) {
        const d = this._fitDateFromKey(key);
        d.setDate(d.getDate() + Number(days || 0));
        return this._fitDateKey(d);
    },

    _fitDiffDays(fromKey, toKey) {
        const a = this._fitDateFromKey(fromKey).getTime();
        const b = this._fitDateFromKey(toKey).getTime();
        return Math.round((b - a) / 86400000);
    },

    _emitFitUpdate() {
        try {
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                window.dispatchEvent(new CustomEvent('fit-care-update'));
            }
        } catch (_) {}
    },

    _fitProfileDefaults() {
        return {
            id: 1, display_name: '', target_weight: null, sex: '', birth_year: null,
            height_cm: null, activity_level: 'moderate', goal: 'maintain', target_date: '',
            calorie_min: null, calorie_max: null, protein_target: null, carbs_target: null,
            fat_target: null, water_target_ml: null, aru_tone: 'supportive', aru_notes: '',
            cycle_tracking: 0, cycle_length: 28, period_length: 5, luteal_length: 14,
            disclaimer_accepted: 0, intimacy_tracking: 0
        };
    },

    hasFitData() {
        if (!this.db) return false;
        const tables = ['fit_profiles', 'fit_daily_logs', 'fit_plans', 'fit_plan_days',
            'fit_workouts', 'fit_meals', 'fit_protocols', 'fit_health_logs',
            'fit_cycles', 'fit_cycle_logs', 'fit_intimacy_logs', 'fit_chat_messages'];
        try {
            for (const table of tables) {
                if (!this.tableExists(table)) continue;
                const rows = this.query(`SELECT 1 AS has FROM ${table} LIMIT 1`);
                if (rows.length > 0) return true;
            }
        } catch (e) {
            return false;
        }
        return false;
    },

    getFitProfile() {
        const rows = this.query("SELECT * FROM fit_profiles WHERE id = 1 LIMIT 1");
        const p = Object.assign(this._fitProfileDefaults(), rows.length ? rows[0] : {});
        p.cycle_tracking = Number(p.cycle_tracking) || 0;
        p.disclaimer_accepted = Number(p.disclaimer_accepted) || 0;
        p.intimacy_tracking = Number(p.intimacy_tracking) || 0;
        p.cycle_length = Math.min(60, Math.max(15, Number(p.cycle_length) || 28));
        p.period_length = Math.min(15, Math.max(1, Number(p.period_length) || 5));
        p.luteal_length = Math.min(20, Math.max(7, Number(p.luteal_length) || 14));
        return p;
    },

    saveFitProfile(data, autoSave = true) {
        const d = Object.assign(this.getFitProfile(), data || {});
        try {
            this.run(`INSERT INTO fit_profiles (id, display_name, target_weight, sex, birth_year, height_cm,
                activity_level, goal, target_date, calorie_min, calorie_max, protein_target, carbs_target,
                fat_target, water_target_ml, aru_tone, aru_notes,
                cycle_tracking, cycle_length, period_length, luteal_length, disclaimer_accepted,
                intimacy_tracking, updated_at)
                VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    display_name = excluded.display_name, target_weight = excluded.target_weight,
                    sex = excluded.sex, birth_year = excluded.birth_year, height_cm = excluded.height_cm,
                    activity_level = excluded.activity_level, goal = excluded.goal, target_date = excluded.target_date,
                    calorie_min = excluded.calorie_min, calorie_max = excluded.calorie_max,
                    protein_target = excluded.protein_target, carbs_target = excluded.carbs_target,
                    fat_target = excluded.fat_target, water_target_ml = excluded.water_target_ml,
                    aru_tone = excluded.aru_tone, aru_notes = excluded.aru_notes,
                    cycle_tracking = excluded.cycle_tracking, cycle_length = excluded.cycle_length,
                    period_length = excluded.period_length, luteal_length = excluded.luteal_length,
                    disclaimer_accepted = excluded.disclaimer_accepted,
                    intimacy_tracking = excluded.intimacy_tracking, updated_at = CURRENT_TIMESTAMP`,
            [d.display_name || '', d.target_weight ?? null, d.sex || '', d.birth_year ?? null, d.height_cm ?? null,
                d.activity_level || 'moderate', d.goal || 'maintain', d.target_date || '',
                d.calorie_min ?? null, d.calorie_max ?? null, d.protein_target ?? null,
                d.carbs_target ?? null, d.fat_target ?? null, d.water_target_ml ?? null,
                d.aru_tone || 'supportive', d.aru_notes || '',
                Number(d.cycle_tracking) || 0, Number(d.cycle_length) || 28, Number(d.period_length) || 5,
                Number(d.luteal_length) || 14, Number(d.disclaimer_accepted) || 0,
                Number(d.intimacy_tracking) || 0], false);
            if (autoSave) {
                this.save();
                this._emitFitUpdate();
            }
        } catch (e) {
            // Extremely old schema without the 2.0 columns: keep the legacy write working.
            console.warn('DB.saveFitProfile: extended write failed, using legacy columns', e);
            this.run(`INSERT INTO fit_profiles (id, display_name, target_weight, updated_at) VALUES (1, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, target_weight = excluded.target_weight, updated_at = CURRENT_TIMESTAMP`,
            [d.display_name || '', d.target_weight ?? null], autoSave);
            if (autoSave) this._emitFitUpdate();
        }
    },

    _fitDailyDefaults() {
        return {
            weight: null, workout_status: '', workout_note: '', meal_note: '', sleep_hours: null,
            energy: null, note: '', body_fat: null, muscle_mass: null, water_pct: null,
            bone_mass: null, visceral_fat: null, steps: null, calories: null, protein: null,
            carbs: null, fat: null, mood: null, stress: null, symptoms: '[]', water_ml: null,
            measurement_note: ''
        };
    },

    getFitDailyLogs(fromDate, toDate) {
        return this.query("SELECT * FROM fit_daily_logs WHERE log_date >= ? AND log_date <= ? ORDER BY log_date ASC", [fromDate, toDate]);
    },

    getFitDailyLog(date) {
        const rows = this.query("SELECT * FROM fit_daily_logs WHERE log_date = ? LIMIT 1", [date]);
        return rows.length ? rows[0] : null;
    },

    saveFitDailyLog(data, autoSave = true) {
        const d = data || {};
        if (!d.log_date) return null;
        const merged = Object.assign(this._fitDailyDefaults(), this.getFitDailyLog(d.log_date) || {}, d);
        const symptoms = Array.isArray(merged.symptoms) ? JSON.stringify(merged.symptoms) : (merged.symptoms || '[]');
        this.run(`INSERT INTO fit_daily_logs (log_date, weight, workout_status, workout_note, meal_note, sleep_hours,
            energy, note, body_fat, muscle_mass, water_pct, bone_mass, visceral_fat, steps, calories, protein,
            carbs, fat, mood, stress, symptoms, water_ml, measurement_note, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(log_date) DO UPDATE SET
                weight = excluded.weight, workout_status = excluded.workout_status, workout_note = excluded.workout_note,
                meal_note = excluded.meal_note, sleep_hours = excluded.sleep_hours, energy = excluded.energy,
                note = excluded.note, body_fat = excluded.body_fat, muscle_mass = excluded.muscle_mass,
                water_pct = excluded.water_pct, bone_mass = excluded.bone_mass, visceral_fat = excluded.visceral_fat,
                steps = excluded.steps, calories = excluded.calories, protein = excluded.protein,
                carbs = excluded.carbs, fat = excluded.fat, mood = excluded.mood, stress = excluded.stress,
                symptoms = excluded.symptoms, water_ml = excluded.water_ml, measurement_note = excluded.measurement_note,
                updated_at = CURRENT_TIMESTAMP`,
        [merged.log_date, merged.weight ?? null, merged.workout_status || '', merged.workout_note || '',
            merged.meal_note || '', merged.sleep_hours ?? null, merged.energy ?? null, merged.note || '',
            merged.body_fat ?? null, merged.muscle_mass ?? null, merged.water_pct ?? null,
            merged.bone_mass ?? null, merged.visceral_fat ?? null, merged.steps ?? null,
            merged.calories ?? null, merged.protein ?? null, merged.carbs ?? null, merged.fat ?? null,
            merged.mood ?? null, merged.stress ?? null, symptoms, merged.water_ml ?? null,
            merged.measurement_note || ''], false);
        if (autoSave) {
            this.save();
            this._emitFitUpdate();
        }
        return merged;
    },

    patchFitDailyLog(date, changes) {
        const next = Object.assign(this._fitDailyDefaults(), this.getFitDailyLog(date) || {}, changes || {}, { log_date: date });
        this.saveFitDailyLog(next);
        return next;
    },

    // --- Fit & Care: training plans (week_index = 0 is the repeating template) ---

    getFitPlans(status = '') {
        if (status) return this.query("SELECT * FROM fit_plans WHERE status = ? ORDER BY start_date DESC, id DESC", [status]);
        return this.query("SELECT * FROM fit_plans ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, start_date DESC, id DESC");
    },

    getFitPlan(id) {
        const rows = this.query("SELECT * FROM fit_plans WHERE id = ? LIMIT 1", [Number(id)]);
        return rows.length ? rows[0] : null;
    },

    saveFitPlan(data, autoSave = true) {
        const d = data || {};
        let id = Number(d.id) || null;
        const status = d.status || 'active';
        if (status === 'active') {
            this.run("UPDATE fit_plans SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE status = 'active' AND id <> ?", [id || 0], false);
        }
        if (id) {
            this.run(`UPDATE fit_plans SET title = ?, goal = ?, start_date = ?, weeks = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [d.title || '', d.goal || '', d.start_date || '', Number(d.weeks) || 4, status, d.notes || '', id], false);
        } else {
            this.run(`INSERT INTO fit_plans (title, goal, start_date, weeks, status, notes)
                VALUES (?, ?, ?, ?, ?, ?)`,
            [d.title || '', d.goal || '', d.start_date || '', Number(d.weeks) || 4, status, d.notes || ''], false);
            id = this._lastInsertId('fit_plans');
        }
        if (autoSave) {
            this.save();
            this._emitFitUpdate();
        }
        return id;
    },

    deleteFitPlan(id) {
        this.run("UPDATE fit_workouts SET plan_day_id = NULL WHERE plan_day_id IN (SELECT id FROM fit_plan_days WHERE plan_id = ?)", [Number(id)], false);
        this.run("DELETE FROM fit_plan_days WHERE plan_id = ?", [Number(id)], false);
        this.run("DELETE FROM fit_plans WHERE id = ?", [Number(id)], false);
        this.save();
        this._emitFitUpdate();
    },

    getFitPlanDays(planId) {
        return this.query("SELECT * FROM fit_plan_days WHERE plan_id = ? ORDER BY week_index ASC, weekday ASC, id ASC", [Number(planId)]);
    },

    getFitPlanDay(id) {
        const rows = this.query("SELECT * FROM fit_plan_days WHERE id = ? LIMIT 1", [Number(id)]);
        return rows.length ? rows[0] : null;
    },

    getFitPlanDayForDate(planId, weekIndex, weekday) {
        const rows = this.query(`SELECT * FROM fit_plan_days
            WHERE plan_id = ? AND weekday = ? AND week_index IN (?, 0)
            ORDER BY CASE WHEN week_index = ? THEN 0 ELSE 1 END, id DESC LIMIT 1`,
        [Number(planId), Number(weekday), Number(weekIndex), Number(weekIndex)]);
        return rows.length ? rows[0] : null;
    },

    saveFitPlanDay(data, autoSave = true) {
        const d = data || {};
        const planId = Number(d.plan_id);
        if (!planId || !d.weekday) return null;
        const weekIndex = Number(d.week_index) || 0;
        let id = Number(d.id) || null;
        if (!id) {
            const existing = this.query("SELECT id FROM fit_plan_days WHERE plan_id = ? AND week_index = ? AND weekday = ? LIMIT 1",
                [planId, weekIndex, Number(d.weekday)]);
            if (existing.length) id = existing[0].id;
        }
        const exercises = Array.isArray(d.exercises) ? JSON.stringify(d.exercises) : (d.exercises || '[]');
        if (id) {
            this.run(`UPDATE fit_plan_days SET week_index = ?, weekday = ?, title = ?, focus = ?, exercises = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [weekIndex, Number(d.weekday), d.title || '', d.focus || '', exercises, d.notes || '', id], false);
        } else {
            this.run(`INSERT INTO fit_plan_days (plan_id, week_index, weekday, title, focus, exercises, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [planId, weekIndex, Number(d.weekday), d.title || '', d.focus || '', exercises, d.notes || ''], false);
            id = this._lastInsertId('fit_plan_days');
        }
        if (autoSave) {
            this.save();
            this._emitFitUpdate();
        }
        return id;
    },

    deleteFitPlanDay(id) {
        this.run("UPDATE fit_workouts SET plan_day_id = NULL WHERE plan_day_id = ?", [Number(id)], false);
        this.run("DELETE FROM fit_plan_days WHERE id = ?", [Number(id)]);
        this._emitFitUpdate();
    },

    // --- Fit & Care: workouts, meals, protocols and health events ---

    getFitWorkouts(fromDate, toDate) {
        return this.query("SELECT * FROM fit_workouts WHERE log_date >= ? AND log_date <= ? ORDER BY log_date ASC, log_time ASC, id ASC", [fromDate, toDate]);
    },

    getFitWorkout(id) {
        const rows = this.query("SELECT * FROM fit_workouts WHERE id = ? LIMIT 1", [Number(id)]);
        return rows.length ? rows[0] : null;
    },

    _fitSyncWorkoutStatus(logDate, autoSave = false) {
        if (!logDate) return;
        const rows = this.getFitWorkouts(logDate, logDate) || [];
        let status = '';
        if (rows.some(w => w.status === 'done')) status = 'done';
        else if (rows.some(w => w.status === 'planned')) status = 'planned';
        else if (rows.some(w => w.status === 'skipped')) status = 'skipped';
        const existing = this.getFitDailyLog(logDate);
        if (existing || status) {
            this.saveFitDailyLog({ log_date: logDate, workout_status: status }, autoSave);
        }
    },

    saveFitWorkout(data, autoSave = true) {
        const d = data || {};
        if (!d.log_date) return null;
        const exercises = Array.isArray(d.exercises) ? JSON.stringify(d.exercises) : (d.exercises || '[]');
        let id = Number(d.id) || null;
        if (id) {
            this.run(`UPDATE fit_workouts SET log_date = ?, log_time = ?, plan_day_id = ?, title = ?, exercises = ?,
                duration_min = ?, volume_kg = ?, rpe = ?, status = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [d.log_date, d.log_time || '', d.plan_day_id ?? null, d.title || '', exercises,
                d.duration_min ?? null, d.volume_kg ?? null, d.rpe ?? null, d.status || 'done', d.note || '', id], false);
        } else {
            this.run(`INSERT INTO fit_workouts (log_date, log_time, plan_day_id, title, exercises, duration_min, volume_kg, rpe, status, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [d.log_date, d.log_time || '', d.plan_day_id ?? null, d.title || '', exercises,
                d.duration_min ?? null, d.volume_kg ?? null, d.rpe ?? null, d.status || 'done', d.note || ''], false);
            id = this._lastInsertId('fit_workouts');
        }
        this._fitSyncWorkoutStatus(d.log_date, false);
        if (autoSave) {
            this.save();
            this._emitFitUpdate();
        }
        return id;
    },

    deleteFitWorkout(id) {
        const existing = this.getFitWorkout(id);
        this.run("DELETE FROM fit_workouts WHERE id = ?", [Number(id)], false);
        if (existing && existing.log_date) this._fitSyncWorkoutStatus(existing.log_date, false);
        this.save();
        this._emitFitUpdate();
    },

    getFitDayNutrition(date, preloadedDaily = null, preloadedMeals = null) {
        const key = date || this._fitDateKey(new Date());
        const daily = preloadedDaily !== null ? preloadedDaily : this.getFitDailyLog(key);
        const meals = Array.isArray(preloadedMeals) ? preloadedMeals : (this.getFitMeals(key, key) || []);
        const fields = ['calories', 'protein', 'carbs', 'fat'];
        const sums = { calories: 0, protein: 0, carbs: 0, fat: 0 };
        const hasMealField = { calories: false, protein: false, carbs: false, fat: false };
        let hasEstimated = false;
        for (const meal of meals) {
            if (!meal) continue;
            if (Number(meal.estimated) === 1) hasEstimated = true;
            for (const f of fields) {
                const v = meal[f];
                if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) {
                    sums[f] += Number(v);
                    hasMealField[f] = true;
                }
            }
        }
        const out = {
            date: key,
            calories: null,
            protein: null,
            carbs: null,
            fat: null,
            mealCount: meals.length,
            hasEstimated,
            source: 'none'
        };
        let usedMeals = false;
        let usedDaily = false;
        for (const f of fields) {
            if (hasMealField[f]) {
                out[f] = f === 'calories' ? Math.round(sums[f]) : Math.round(sums[f] * 10) / 10;
                usedMeals = true;
            } else if (daily && daily[f] !== null && daily[f] !== undefined && daily[f] !== '' && Number.isFinite(Number(daily[f]))) {
                out[f] = f === 'calories' ? Math.round(Number(daily[f])) : Math.round(Number(daily[f]) * 10) / 10;
                usedDaily = true;
            }
        }
        out.source = usedMeals && usedDaily ? 'mixed' : usedMeals ? 'meals' : usedDaily ? 'daily' : 'none';
        return out;
    },

    getFitNutritionRange(fromDate, toDate) {
        const logs = this.getFitDailyLogs(fromDate, toDate) || [];
        const meals = this.getFitMeals(fromDate, toDate) || [];
        const dailyByDate = new Map(logs.map(l => [l.log_date, l]));
        const mealsByDate = new Map();
        for (const m of meals) {
            if (!m || !m.log_date) continue;
            if (!mealsByDate.has(m.log_date)) mealsByDate.set(m.log_date, []);
            mealsByDate.get(m.log_date).push(m);
        }
        const dates = Array.from(new Set([...dailyByDate.keys(), ...mealsByDate.keys()])).sort();
        const byDate = new Map();
        const buckets = { calories: [], protein: [], carbs: [], fat: [] };
        for (const d of dates) {
            const n = this.getFitDayNutrition(d, dailyByDate.get(d) || null, mealsByDate.get(d) || []);
            byDate.set(d, n);
            for (const f of ['calories', 'protein', 'carbs', 'fat']) {
                if (n[f] !== null && n[f] !== undefined) buckets[f].push(n[f]);
            }
        }
        const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
        return {
            byDate,
            days: dates,
            avgCalories: avg(buckets.calories),
            avgProtein: avg(buckets.protein),
            avgCarbs: avg(buckets.carbs),
            avgFat: avg(buckets.fat),
            calorieDays: buckets.calories.length,
            proteinDays: buckets.protein.length,
            carbsDays: buckets.carbs.length,
            fatDays: buckets.fat.length
        };
    },

    getFitMeals(fromDate, toDate) {
        return this.query("SELECT * FROM fit_meals WHERE log_date >= ? AND log_date <= ? ORDER BY log_date ASC, meal_time ASC, id ASC", [fromDate, toDate]);
    },

    saveFitMeal(data, autoSave = true) {
        const d = data || {};
        if (!d.log_date) return null;
        const tags = Array.isArray(d.tags) ? JSON.stringify(d.tags) : (d.tags || '[]');
        const estimated = Number(d.estimated) ? 1 : 0;
        let id = Number(d.id) || null;
        if (id) {
            this.run(`UPDATE fit_meals SET log_date = ?, meal_time = ?, title = ?, tags = ?, calories = ?, protein = ?, carbs = ?, fat = ?, note = ?, estimated = ? WHERE id = ?`,
                [d.log_date, d.meal_time || '', d.title || '', tags, d.calories ?? null, d.protein ?? null,
                    d.carbs ?? null, d.fat ?? null, d.note || '', estimated, id], false);
        } else {
            this.run(`INSERT INTO fit_meals (log_date, meal_time, title, tags, calories, protein, carbs, fat, note, estimated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [d.log_date, d.meal_time || '', d.title || '', tags, d.calories ?? null, d.protein ?? null,
                d.carbs ?? null, d.fat ?? null, d.note || '', estimated], false);
            id = this._lastInsertId('fit_meals');
        }
        if (autoSave) {
            this.save();
            this._emitFitUpdate();
        }
        return id;
    },

    deleteFitMeal(id) {
        this.run("DELETE FROM fit_meals WHERE id = ?", [Number(id)]);
        this._emitFitUpdate();
    },

    getFitProtocols(activeOnly = false) {
        return activeOnly
            ? this.query("SELECT * FROM fit_protocols WHERE active = 1 ORDER BY name COLLATE NOCASE ASC, id ASC")
            : this.query("SELECT * FROM fit_protocols ORDER BY active DESC, name COLLATE NOCASE ASC, id ASC");
    },

    getFitProtocol(id) {
        const rows = this.query("SELECT * FROM fit_protocols WHERE id = ? LIMIT 1", [Number(id)]);
        return rows.length ? rows[0] : null;
    },

    getFitProtocolByName(name) {
        const wanted = String(name || '').trim().toLowerCase();
        if (!wanted) return null;
        const rows = this.query("SELECT * FROM fit_protocols WHERE lower(name) = ? LIMIT 1", [wanted]);
        return rows.length ? rows[0] : null;
    },

    saveFitProtocol(data, autoSave = true) {
        const d = data || {};
        const schedule = Array.isArray(d.schedule) || (d.schedule && typeof d.schedule === 'object') ? JSON.stringify(d.schedule) : (d.schedule || '{"times":[],"days":[]}');
        const rules = Array.isArray(d.rules) || (d.rules && typeof d.rules === 'object') ? JSON.stringify(d.rules) : (d.rules || '{}');
        let id = Number(d.id) || null;
        if (id) {
            this.run(`UPDATE fit_protocols SET name = ?, kind = ?, dosage = ?, schedule = ?, rules = ?, notes = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [d.name || '', d.kind || 'medication', d.dosage || '', schedule, rules, d.notes || '', Number(d.active ?? 1) ? 1 : 0, id], false);
        } else {
            this.run(`INSERT INTO fit_protocols (name, kind, dosage, schedule, rules, notes, active)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [d.name || '', d.kind || 'medication', d.dosage || '', schedule, rules, d.notes || '', Number(d.active ?? 1) ? 1 : 0], false);
            id = this._lastInsertId('fit_protocols');
        }
        if (autoSave) {
            this.save();
            this._emitFitUpdate();
        }
        return id;
    },

    deleteFitProtocol(id) {
        this.run("UPDATE fit_health_logs SET protocol_id = NULL WHERE protocol_id = ?", [Number(id)], false);
        this.run("DELETE FROM fit_protocols WHERE id = ?", [Number(id)], false);
        this.save();
        this._emitFitUpdate();
    },

    getFitHealthLogs(fromDate, toDate) {
        return this.query("SELECT * FROM fit_health_logs WHERE log_date >= ? AND log_date <= ? ORDER BY log_date ASC, log_time ASC, id ASC", [fromDate, toDate]);
    },

    saveFitHealthLog(data, autoSave = true) {
        const d = data || {};
        if (!d.log_date) return null;
        let id = Number(d.id) || null;
        const tags = Array.isArray(d.tags) ? JSON.stringify(d.tags) : (d.tags || '[]');
        if (id) {
            this.run(`UPDATE fit_health_logs SET log_date = ?, log_time = ?, protocol_id = ?, type = ?, name = ?, value = ?, value2 = ?, unit = ?, status = ?, tags = ?, note = ? WHERE id = ?`,
                [d.log_date, d.log_time || '', d.protocol_id ?? null, d.type || 'measurement', d.name || '',
                    d.value ?? null, d.value2 ?? null, d.unit || '', d.status || 'logged', tags, d.note || '', id], false);
        } else {
            this.run(`INSERT INTO fit_health_logs (log_date, log_time, protocol_id, type, name, value, value2, unit, status, tags, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [d.log_date, d.log_time || '', d.protocol_id ?? null, d.type || 'measurement', d.name || '',
                d.value ?? null, d.value2 ?? null, d.unit || '', d.status || 'logged', tags, d.note || ''], false);
            id = this._lastInsertId('fit_health_logs');
        }
        if (autoSave) {
            this.save();
            this._emitFitUpdate();
        }
        return id;
    },

    deleteFitHealthLog(id) {
        this.run("DELETE FROM fit_health_logs WHERE id = ?", [Number(id)]);
        this._emitFitUpdate();
    },

    // --- Fit & Care: menstrual cycle and private logs ---

    getFitCycles() {
        return this.query("SELECT * FROM fit_cycles ORDER BY start_date ASC, id ASC");
    },

    getFitCycle(id) {
        const rows = this.query("SELECT * FROM fit_cycles WHERE id = ? LIMIT 1", [Number(id)]);
        return rows.length ? rows[0] : null;
    },

    // Cycle maths lives here alone so the Aru snapshot and the plugin UI cannot
    // drift apart. Confidence reflects real data honestly:
    // recorded = inside the current cycle (or a valid 15..60d historical cycle),
    // late = slightly past average (waiting up to pauseThreshold),
    // paused = tracking went quiet for months (no phantom ovulations/periods).
    getFitCycleStats() {
        const profile = this.getFitProfile();
        const cycles = this.getFitCycles().filter((cycle) => cycle.start_date);
        const lengths = cycles
            .map((cycle) => Number(cycle.cycle_length))
            .filter((length) => Number.isFinite(length) && length >= 15 && length <= 60)
            .slice(-6);
        const periodLengths = cycles
            .map((cycle) => Number(cycle.period_length))
            .filter((length) => Number.isFinite(length) && length >= 1 && length <= 15)
            .slice(-6);
        const profileLength = Math.min(Math.max(Number(profile.cycle_length) || 28, 15), 60);
        const profilePeriod = Math.min(Math.max(Number(profile.period_length) || 5, 1), 15);
        const avg = lengths.length >= 2
            ? Math.round(lengths.reduce((sum, length) => sum + length, 0) / lengths.length)
            : profileLength;
        const avgPeriod = periodLengths.length
            ? Math.round(periodLengths.reduce((sum, length) => sum + length, 0) / periodLengths.length)
            : profilePeriod;
        const pauseThreshold = Math.max(avg + 18, 45);
        const today = this._fitDateKey(new Date());
        const past = cycles.filter((cycle) => cycle.start_date <= today);
        const last = past.length ? past[past.length - 1] : null;
        const daysSince = last ? this._fitDiffDays(last.start_date, today) : null;
        const predictedCycles = last ? Math.max(0, Math.floor(daysSince / avg)) : 0;
        let confidence = 'none';
        if (last) {
            if (daysSince < avg) confidence = 'recorded';
            else if (daysSince < pauseThreshold) confidence = 'late';
            else confidence = 'paused';
        }
        return {
            tracking: Number(profile.cycle_tracking) === 1,
            cycles,
            lengths,
            periodLengths,
            avg,
            avgPeriod,
            pauseThreshold,
            profileLength,
            profilePeriod,
            last,
            daysSince,
            predictedCycles,
            confidence,
            paused: confidence === 'paused',
            stale: confidence === 'paused',
            irregular: lengths.length >= 2 && (
                (Math.max(...lengths) - Math.min(...lengths)) >= 8
                || lengths.some((len) => len < 21 || len > 38)
            )
        };
    },

    getFitCycleInfo(date, stats = null) {
        const key = date || this._fitDateKey(new Date());
        const info = stats || this.getFitCycleStats();
        if (!info.tracking) return { tracking: false, hasData: false, phase: '', day: null };
        if (!info.cycles.length) {
            return { tracking: true, hasData: false, phase: '', day: null, avg: info.avg, confidence: 'none', paused: false, stale: false };
        }
        let idxBefore = -1;
        for (let i = 0; i < info.cycles.length; i++) {
            if (info.cycles[i].start_date <= key) idxBefore = i;
            else break;
        }
        if (idxBefore < 0) {
            return { tracking: true, hasData: false, phase: '', day: null, avg: info.avg, confidence: 'none', paused: false, stale: false };
        }
        const reference = info.cycles[idxBefore];
        const nextCycle = idxBefore + 1 < info.cycles.length ? info.cycles[idxBefore + 1] : null;
        const profile = this.getFitProfile();
        const avg = info.avg;
        const today = this._fitDateKey(new Date());
        const offset = this._fitDiffDays(reference.start_date, key);

        const buildPhase = (cycleDay, cycleLen, periodLen) => {
            if (periodLen >= cycleLen) {
                return { phase: 'menstrual', ovulationDay: null, fertileStart: null, fertileEnd: null };
            }
            const luteal = Math.min(Math.max(Number(profile.luteal_length) || 14, 7), Math.max(cycleLen - 7, 7));
            const ovulationDay = Math.min(cycleLen, Math.max(periodLen + 1, cycleLen - luteal));
            const fertileStart = Math.max(periodLen + 1, ovulationDay - 5);
            const fertileEnd = Math.min(cycleLen, ovulationDay + 1);
            let phase = 'luteal';
            if (cycleDay <= periodLen) phase = 'menstrual';
            else if (cycleDay === ovulationDay) phase = 'ovulation';
            else if (cycleDay >= fertileStart && cycleDay <= fertileEnd) phase = 'fertile';
            else if (cycleDay < fertileStart) phase = 'follicular';
            return { phase, ovulationDay, fertileStart, fertileEnd };
        };

        // Case A: Historical cycle closed by a subsequent recorded start date
        if (nextCycle) {
            const actualSpan = this._fitDiffDays(reference.start_date, nextCycle.start_date);
            if (actualSpan >= 15 && actualSpan <= 60) {
                const cycleDay = offset + 1;
                const periodLength = Math.min(Math.max(Number(reference.period_length) || info.avgPeriod || 5, 1), actualSpan);
                const pInfo = buildPhase(cycleDay, actualSpan, periodLength);
                return {
                    tracking: true,
                    hasData: true,
                    phase: pInfo.phase,
                    day: cycleDay,
                    avg: actualSpan,
                    typicalAvg: avg,
                    periodLength,
                    cycleStart: reference.start_date,
                    ovulationDay: pInfo.ovulationDay,
                    fertileStart: pInfo.fertileStart,
                    fertileEnd: pInfo.fertileEnd,
                    nextPeriod: nextCycle.start_date,
                    predicted: false,
                    confidence: 'recorded',
                    paused: false,
                    stale: false,
                    predictedCycles: 0,
                    lastStart: reference.start_date,
                    daysSinceLastStart: offset,
                    daysSinceLastStartToday: info.daysSince,
                    periodEndRecorded: !!reference.end_date,
                    periodEnd: reference.end_date || this._fitAddDays(reference.start_date, periodLength - 1)
                };
            }
            if (offset < avg) {
                const cycleDay = offset + 1;
                const periodLength = Math.min(Math.max(Number(reference.period_length) || info.avgPeriod || 5, 1), avg);
                const pInfo = buildPhase(cycleDay, avg, periodLength);
                return {
                    tracking: true,
                    hasData: true,
                    phase: pInfo.phase,
                    day: cycleDay,
                    avg,
                    periodLength,
                    cycleStart: reference.start_date,
                    ovulationDay: pInfo.ovulationDay,
                    fertileStart: pInfo.fertileStart,
                    fertileEnd: pInfo.fertileEnd,
                    nextPeriod: '',
                    predicted: false,
                    confidence: 'recorded',
                    paused: false,
                    stale: false,
                    predictedCycles: 0,
                    lastStart: reference.start_date,
                    daysSinceLastStart: offset,
                    daysSinceLastStartToday: info.daysSince,
                    periodEndRecorded: !!reference.end_date,
                    periodEnd: reference.end_date || this._fitAddDays(reference.start_date, periodLength - 1)
                };
            }
            return {
                tracking: true,
                hasData: true,
                phase: 'paused',
                day: null,
                avg,
                periodLength: info.avgPeriod || 5,
                cycleStart: reference.start_date,
                ovulationDay: null,
                fertileStart: null,
                fertileEnd: null,
                nextPeriod: '',
                predicted: false,
                confidence: 'paused',
                paused: true,
                stale: true,
                predictedCycles: Math.floor(offset / avg),
                lastStart: reference.start_date,
                daysSinceLastStart: offset,
                daysSinceLastStartToday: info.daysSince,
                periodEndRecorded: !!reference.end_date,
                periodEnd: reference.end_date || ''
            };
        }

        // Case B: Latest open cycle
        if (offset < avg) {
            const cycleDay = offset + 1;
            const periodLength = Math.min(Math.max(Number(reference.period_length) || info.avgPeriod || 5, 1), avg);
            const pInfo = buildPhase(cycleDay, avg, periodLength);
            return {
                tracking: true,
                hasData: true,
                phase: pInfo.phase,
                day: cycleDay,
                avg,
                periodLength,
                cycleStart: reference.start_date,
                ovulationDay: pInfo.ovulationDay,
                fertileStart: pInfo.fertileStart,
                fertileEnd: pInfo.fertileEnd,
                nextPeriod: this._fitAddDays(reference.start_date, avg),
                predicted: false,
                confidence: 'recorded',
                paused: false,
                stale: false,
                predictedCycles: 0,
                lastStart: reference.start_date,
                daysSinceLastStart: offset,
                daysSinceLastStartToday: info.daysSince,
                periodEndRecorded: !!reference.end_date,
                periodEnd: reference.end_date || this._fitAddDays(reference.start_date, periodLength - 1)
            };
        }

        if (info.confidence === 'paused') {
            const totalSinceToday = info.daysSince != null ? info.daysSince : offset;
            return {
                tracking: true,
                hasData: true,
                phase: 'paused',
                day: null,
                avg,
                periodLength: info.avgPeriod || 5,
                cycleStart: reference.start_date,
                ovulationDay: null,
                fertileStart: null,
                fertileEnd: null,
                nextPeriod: '',
                predicted: false,
                confidence: 'paused',
                paused: true,
                stale: true,
                predictedCycles: Math.floor(offset / avg),
                missedCycles: Math.floor(totalSinceToday / avg),
                lastStart: reference.start_date,
                daysSinceLastStart: offset,
                daysSinceLastStartToday: totalSinceToday,
                periodEndRecorded: !!reference.end_date,
                periodEnd: reference.end_date || ''
            };
        }

        if (key <= today) {
            const periodLength = Math.min(Math.max(Number(reference.period_length) || info.avgPeriod || 5, 1), avg);
            return {
                tracking: true,
                hasData: true,
                phase: 'late',
                day: offset + 1,
                lateDays: offset - avg + 1,
                avg,
                periodLength,
                cycleStart: reference.start_date,
                ovulationDay: null,
                fertileStart: null,
                fertileEnd: null,
                nextPeriod: this._fitAddDays(reference.start_date, avg),
                predicted: true,
                confidence: 'late',
                paused: false,
                stale: false,
                predictedCycles: 1,
                lastStart: reference.start_date,
                daysSinceLastStart: offset,
                daysSinceLastStartToday: info.daysSince,
                periodEndRecorded: !!reference.end_date,
                periodEnd: reference.end_date || this._fitAddDays(reference.start_date, periodLength - 1)
            };
        }

        if (info.confidence === 'late') {
            const periodLength = Math.min(Math.max(Number(reference.period_length) || info.avgPeriod || 5, 1), avg);
            return {
                tracking: true,
                hasData: true,
                phase: '',
                day: null,
                lateDays: info.daysSince != null ? Math.max(1, info.daysSince - avg + 1) : 1,
                avg,
                periodLength,
                cycleStart: reference.start_date,
                ovulationDay: null,
                fertileStart: null,
                fertileEnd: null,
                nextPeriod: '',
                predicted: false,
                confidence: 'late',
                paused: false,
                stale: false,
                predictedCycles: 1,
                lastStart: reference.start_date,
                daysSinceLastStart: offset,
                daysSinceLastStartToday: info.daysSince,
                periodEndRecorded: !!reference.end_date,
                periodEnd: reference.end_date || ''
            };
        }

        const predictedCycles = Math.floor(offset / avg);
        if (predictedCycles > 2) {
            return {
                tracking: true,
                hasData: true,
                phase: '',
                day: null,
                avg,
                periodLength: info.avgPeriod || 5,
                cycleStart: reference.start_date,
                ovulationDay: null,
                fertileStart: null,
                fertileEnd: null,
                nextPeriod: '',
                predicted: false,
                confidence: 'too_far',
                paused: false,
                stale: false,
                predictedCycles,
                lastStart: reference.start_date,
                daysSinceLastStart: offset,
                daysSinceLastStartToday: info.daysSince,
                periodEndRecorded: false,
                periodEnd: ''
            };
        }

        const cycleStart = this._fitAddDays(reference.start_date, predictedCycles * avg);
        const cycleDay = this._fitDiffDays(cycleStart, key) + 1;
        const periodLength = Math.min(Math.max(info.avgPeriod || 5, 1), avg);
        const pInfo = buildPhase(cycleDay, avg, periodLength);
        return {
            tracking: true,
            hasData: true,
            phase: pInfo.phase,
            day: cycleDay,
            avg,
            periodLength,
            cycleStart,
            ovulationDay: pInfo.ovulationDay,
            fertileStart: pInfo.fertileStart,
            fertileEnd: pInfo.fertileEnd,
            nextPeriod: this._fitAddDays(cycleStart, avg),
            predicted: true,
            confidence: 'estimated',
            paused: false,
            stale: false,
            predictedCycles,
            lastStart: reference.start_date,
            daysSinceLastStart: offset,
            daysSinceLastStartToday: info.daysSince,
            periodEndRecorded: false,
            periodEnd: this._fitAddDays(cycleStart, periodLength - 1)
        };
    },

    _fitWeekKey(key) {
        const date = this._fitDateFromKey(key || this._fitDateKey(new Date()));
        date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
        return this._fitDateKey(date);
    },

    // A cycle_length is only valid inside 15..60 days; multi-month gaps leave
    // cycle_length as NULL so history never displays bogus 120-day "cycles".
    _fitRecalcCycleLengths() {
        const rows = this.query("SELECT id, start_date, cycle_length FROM fit_cycles ORDER BY start_date ASC, id ASC");
        for (let index = 0; index < rows.length - 1; index++) {
            const raw = this._fitDiffDays(rows[index].start_date, rows[index + 1].start_date);
            const validLength = (raw >= 15 && raw <= 60) ? raw : null;
            const current = (rows[index].cycle_length === undefined || rows[index].cycle_length === '') ? null : Number(rows[index].cycle_length);
            if (current !== validLength) {
                this.run("UPDATE fit_cycles SET cycle_length = ? WHERE id = ?", [validLength, rows[index].id], false);
            }
        }
        if (rows.length > 0) {
            const last = rows[rows.length - 1];
            if (last.cycle_length !== null && last.cycle_length !== undefined) {
                this.run("UPDATE fit_cycles SET cycle_length = NULL WHERE id = ?", [last.id], false);
            }
        }
    },

    updateFitCycle(id, data = {}) {
        const cycle = this.getFitCycle(id);
        if (!cycle) return null;
        const today = this._fitDateKey(new Date());
        const start = String(data.start_date || cycle.start_date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start > today) return null;
        const collision = this.query("SELECT id FROM fit_cycles WHERE start_date = ? AND id != ? LIMIT 1", [start, cycle.id]);
        if (collision.length) return null;
        let end = data.end_date !== undefined ? String(data.end_date || '').trim() : String(cycle.end_date || '').trim();
        if (end) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end > today) return null;
            if (end < start) end = start;
        }
        const periodLength = end
            ? (this._fitDiffDays(start, end) + 1)
            : (data.end_date === '' ? null : (cycle.period_length ?? null));
        const notes = data.notes !== undefined ? String(data.notes || '') : (cycle.notes || '');
        this.run("UPDATE fit_cycles SET start_date = ?, end_date = ?, period_length = ?, notes = ? WHERE id = ?",
            [start, end, periodLength, notes, cycle.id], false);
        this._fitRecalcCycleLengths();
        this.save();
        this._emitFitUpdate();
        return cycle.id;
    },

    saveFitCycle(data, autoSave = true) {
        const d = data || {};
        if (!d.start_date) return null;
        let id = Number(d.id) || null;
        if (id) {
            this.run("UPDATE fit_cycles SET start_date = ?, end_date = ?, cycle_length = ?, period_length = ?, notes = ? WHERE id = ?",
                [d.start_date, d.end_date || '', d.cycle_length ?? null, d.period_length ?? null, d.notes || '', id], false);
        } else {
            this.run("INSERT INTO fit_cycles (start_date, end_date, cycle_length, period_length, notes) VALUES (?, ?, ?, ?, ?)",
                [d.start_date, d.end_date || '', d.cycle_length ?? null, d.period_length ?? null, d.notes || ''], false);
            id = this._lastInsertId('fit_cycles');
        }
        this._fitRecalcCycleLengths();
        if (autoSave) {
            this.save();
            this._emitFitUpdate();
        }
        return id;
    },

    // Returns { id, created, reason, start_date }. A start less than 10 days after
    // the previous one is treated as the same period (a double tap or a corrected
    // date) and is not inserted; callers offer to move the existing start instead.
    startFitCycle(date) {
        const key = date || this._fitDateKey(new Date());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key))) return null;
        if (key > this._fitDateKey(new Date())) return null;
        const same = this.query("SELECT id, start_date FROM fit_cycles WHERE start_date = ? LIMIT 1", [key]);
        if (same.length) return { id: same[0].id, created: false, reason: 'same', start_date: same[0].start_date };
        const previous = this.query("SELECT * FROM fit_cycles WHERE start_date < ? ORDER BY start_date DESC LIMIT 1", [key]);
        if (previous.length) {
            const gap = this._fitDiffDays(previous[0].start_date, key);
            if (gap > 0 && gap < 10) {
                return { id: previous[0].id, created: false, reason: 'recent', start_date: previous[0].start_date };
            }
        }
        // period_length stays unknown until the user actually marks the end,
        // so the history never presents the profile default as a real period.
        this.run("INSERT INTO fit_cycles (start_date, end_date) VALUES (?, '')", [key], false);
        const id = this._lastInsertId('fit_cycles');
        this._fitRecalcCycleLengths();
        this.save();
        this._emitFitUpdate();
        return { id, created: true, reason: 'inserted', start_date: key };
    },

    moveFitCycleStart(id, date) {
        const cycle = this.getFitCycle(id);
        const key = date || this._fitDateKey(new Date());
        if (!cycle || !/^\d{4}-\d{2}-\d{2}$/.test(String(key))) return null;
        if (key > this._fitDateKey(new Date())) return null;
        const collision = this.query("SELECT id FROM fit_cycles WHERE start_date = ? AND id != ? LIMIT 1", [key, cycle.id]);
        if (collision.length) return null;
        // end_date means "the bleeding stopped", so it cannot stay before a moved start.
        const end = cycle.end_date && cycle.end_date >= key ? cycle.end_date : '';
        const periodLength = end ? this._fitDiffDays(key, end) + 1 : null;
        this.run("UPDATE fit_cycles SET start_date = ?, end_date = ?, period_length = ? WHERE id = ?",
            [key, end, periodLength, cycle.id], false);
        this._fitRecalcCycleLengths();
        this.save();
        this._emitFitUpdate();
        return cycle.id;
    },

    endFitCycle(date, cycleId = null) {
        const key = date || this._fitDateKey(new Date());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key))) return null;
        if (key > this._fitDateKey(new Date())) return null;
        let cycle = cycleId ? this.getFitCycle(cycleId) : null;
        if (!cycle) {
            const rows = this.query("SELECT * FROM fit_cycles WHERE start_date <= ? ORDER BY start_date DESC LIMIT 1", [key]);
            cycle = rows.length ? rows[0] : null;
        }
        if (!cycle) return null;
        const end = key < cycle.start_date ? cycle.start_date : key;
        const periodLength = this._fitDiffDays(cycle.start_date, end) + 1;
        this.run("UPDATE fit_cycles SET end_date = ?, period_length = ? WHERE id = ?",
            [end, periodLength, cycle.id], false);
        this.save();
        this._emitFitUpdate();
        return cycle.id;
    },

    deleteFitCycle(id) {
        this.run("DELETE FROM fit_cycles WHERE id = ?", [Number(id)], false);
        this._fitRecalcCycleLengths();
        this.save();
        this._emitFitUpdate();
    },

    getFitCycleLogs(fromDate, toDate) {
        return this.query("SELECT * FROM fit_cycle_logs WHERE log_date >= ? AND log_date <= ? ORDER BY log_date ASC", [fromDate, toDate]);
    },

    getFitCycleLog(date) {
        const rows = this.query("SELECT * FROM fit_cycle_logs WHERE log_date = ? LIMIT 1", [date]);
        return rows.length ? rows[0] : null;
    },

    saveFitCycleLog(data, autoSave = true) {
        const d = data || {};
        if (!d.log_date) return null;
        this.run(`INSERT INTO fit_cycle_logs (log_date, flow, note) VALUES (?, ?, ?)
            ON CONFLICT(log_date) DO UPDATE SET flow = excluded.flow, note = excluded.note`,
        [d.log_date, d.flow || '', d.note || ''], false);
        if (autoSave) {
            this.save();
            this._emitFitUpdate();
        }
    },

    deleteFitCycleLog(date) {
        this.run("DELETE FROM fit_cycle_logs WHERE log_date = ?", [date]);
        this._emitFitUpdate();
    },

    getFitIntimacyLogs(fromDate, toDate) {
        return this.query("SELECT * FROM fit_intimacy_logs WHERE log_date >= ? AND log_date <= ? ORDER BY log_date ASC, log_time ASC, id ASC", [fromDate, toDate]);
    },

    saveFitIntimacyLog(data, autoSave = true) {
        const d = data || {};
        if (!d.log_date) return null;
        let id = Number(d.id) || null;
        if (id) {
            this.run("UPDATE fit_intimacy_logs SET log_date = ?, protection = ?, note = ?, log_time = ? WHERE id = ?",
                [d.log_date, d.protection || '', d.note || '', d.log_time || '', id], false);
        } else {
            this.run("INSERT INTO fit_intimacy_logs (log_date, protection, note, log_time) VALUES (?, ?, ?, ?)",
                [d.log_date, d.protection || '', d.note || '', d.log_time || ''], false);
            id = this._lastInsertId('fit_intimacy_logs');
        }
        if (autoSave) this.save();
        return id;
    },

    deleteFitIntimacyLog(id) {
        this.run("DELETE FROM fit_intimacy_logs WHERE id = ?", [Number(id)]);
    },

    getFitLatestWeight() {
        const rows = this.query("SELECT weight, log_date FROM fit_daily_logs WHERE weight IS NOT NULL ORDER BY log_date DESC, id DESC LIMIT 1");
        return rows.length ? rows[0] : null;
    },

    // --- Fit & Care: per-day Aru chat ---

    getFitChatMessages(date, limit = 40) {
        return this.query(
            "SELECT * FROM (SELECT * FROM fit_chat_messages WHERE log_date = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
            [date, Number(limit) || 40]
        );
    },

    saveFitChatMessage(date, role, content, meta = '') {
        const metaText = typeof meta === 'string' ? meta : JSON.stringify(meta || '');
        try {
            this.run("INSERT INTO fit_chat_messages (log_date, role, content, meta) VALUES (?, ?, ?, ?)",
                [date, role || 'user', content || '', metaText]);
        } catch (e) {
            this.run("INSERT INTO fit_chat_messages (log_date, role, content) VALUES (?, ?, ?)",
                [date, role || 'user', content || '']);
        }
        return this._lastInsertId('fit_chat_messages');
    },

    clearFitChatMessages(date) {
        this.run("DELETE FROM fit_chat_messages WHERE log_date = ?", [date]);
    },

    // Local rule checker: compares a meal with medication doses logged on the same day.
    // Returns factual conflicts from the user's own protocol rules, never medical advice.
    getFitMealConflicts(meal) {
        const m = meal || {};
        if (!m.log_date) return [];
        const timeToMin = (value) => {
            const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
            return match ? (Number(match[1]) * 60 + Number(match[2])) : null;
        };
        const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const L = 'a-zа-яёәіңөұүқғһ0-9';
        const tagMatches = (tag, term) => {
            if (!term) return false;
            if (tag === term) return true;
            return new RegExp(`(?:^|[^${L}])${escapeRx(term)}(?![${L}])`, 'i').test(tag);
        };
        const mealMin = timeToMin(m.meal_time);
        const tags = Array.isArray(m.tags) ? m.tags : (() => {
            try { return JSON.parse(m.tags || '[]'); } catch (e) { return String(m.tags || '').split(',').map(s => s.trim()).filter(Boolean); }
        })();
        const normalizedTags = tags.map(t => String(t).trim().toLowerCase()).filter(Boolean);
        const protocols = new Map(this.getFitProtocols().map(p => [Number(p.id), p]));
        const logs = this.query(`SELECT * FROM fit_health_logs
            WHERE log_date = ? AND protocol_id IS NOT NULL AND type = 'medication' AND status = 'taken'`,
        [m.log_date]);
        const conflicts = [];
        for (const log of logs) {
            const protocol = protocols.get(Number(log.protocol_id));
            if (!protocol || !Number(protocol.active)) continue;
            let rules = {};
            try { rules = JSON.parse(protocol.rules || '{}') || {}; } catch (e) { rules = {}; }
            const doseMin = timeToMin(log.log_time);
            if (mealMin !== null && doseMin !== null) {
                const gap = mealMin - doseMin;
                const delay = Number(rules.min_delay_min) || 0;
                if (delay > 0 && gap >= 0 && gap < delay) {
                    conflicts.push({
                        kind: 'delay',
                        protocol_id: Number(protocol.id),
                        protocol: protocol.name,
                        minutes: gap,
                        required: delay,
                        dose_time: log.log_time,
                        meal_time: m.meal_time,
                        note: rules.note || ''
                    });
                }
            }
            const avoid = Array.isArray(rules.avoid_tags) ? rules.avoid_tags.map(t => String(t).trim().toLowerCase()).filter(Boolean) : [];
            const windowMin = Number(rules.tag_window_min) || 240;
            if (avoid.length && normalizedTags.length) {
                const hit = normalizedTags.find(tag => avoid.some(a => tagMatches(tag, a)));
                const withinWindow = mealMin === null || doseMin === null || Math.abs(mealMin - doseMin) <= windowMin;
                if (hit && withinWindow) {
                    conflicts.push({
                        kind: 'tag',
                        tag: hit,
                        protocol_id: Number(protocol.id),
                        protocol: protocol.name,
                        minutes: mealMin !== null && doseMin !== null ? Math.abs(mealMin - doseMin) : null,
                        dose_time: log.log_time,
                        meal_time: m.meal_time,
                        note: rules.note || ''
                    });
                }
            }
        }
        return conflicts;
    },

    getFitAllData() {
        return {
            app: 'aru-fit-care',
            version: 2,
            exported_at: new Date().toISOString(),
            profile: this.getFitProfile(),
            daily_logs: this.query("SELECT * FROM fit_daily_logs ORDER BY log_date ASC"),
            plans: this.query("SELECT * FROM fit_plans ORDER BY id ASC"),
            plan_days: this.query("SELECT * FROM fit_plan_days ORDER BY id ASC"),
            workouts: this.query("SELECT * FROM fit_workouts ORDER BY id ASC"),
            meals: this.query("SELECT * FROM fit_meals ORDER BY id ASC"),
            protocols: this.query("SELECT * FROM fit_protocols ORDER BY id ASC"),
            health_logs: this.query("SELECT * FROM fit_health_logs ORDER BY id ASC"),
            cycles: this.query("SELECT * FROM fit_cycles ORDER BY id ASC"),
            cycle_logs: this.query("SELECT * FROM fit_cycle_logs ORDER BY id ASC"),
            intimacy_logs: this.query("SELECT * FROM fit_intimacy_logs ORDER BY id ASC"),
            chat_messages: this.query("SELECT * FROM fit_chat_messages ORDER BY id ASC")
        };
    },

    clearFitData(autoSave = true) {
        const tables = ['fit_chat_messages', 'fit_intimacy_logs', 'fit_cycle_logs', 'fit_cycles',
            'fit_health_logs', 'fit_protocols', 'fit_meals', 'fit_workouts', 'fit_plan_days',
            'fit_plans', 'fit_daily_logs', 'fit_profiles'];
        for (const table of tables) this.run(`DELETE FROM ${table}`, [], false);
        if (autoSave) {
            this.save();
            this._emitFitUpdate();
        }
    },

    replaceFitData(data, autoSave = true) {
        const d = data || {};
        const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
        const asJson = (v, fallback) => typeof v === 'string' ? v : JSON.stringify(v ?? fallback);
        this.db.run('BEGIN TRANSACTION');
        try {
            this.clearFitData(false);
            this.saveFitProfile(d.profile || {}, false);
            const insert = (sql, params) => this.run(sql, params, false);
            for (const row of Array.isArray(d.daily_logs) ? d.daily_logs : []) {
                if (row && isYmd(row.log_date)) this.saveFitDailyLog(row, false);
            }
            for (const row of Array.isArray(d.plans) ? d.plans : []) {
                if (!row) continue;
                const weeks = Math.max(1, Math.min(52, Math.round(Number(row.weeks) || 4)));
                insert(`INSERT OR REPLACE INTO fit_plans (id, title, goal, start_date, weeks, status, notes, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [row.id ?? null, row.title || '', row.goal || '', isYmd(row.start_date) ? row.start_date : '', weeks,
                    row.status || 'active', row.notes || '', row.created_at || null, row.updated_at || null]);
            }
            for (const row of Array.isArray(d.plan_days) ? d.plan_days : []) {
                if (!row || row.plan_id == null) continue;
                insert(`INSERT OR REPLACE INTO fit_plan_days (id, plan_id, week_index, weekday, title, focus, exercises, notes, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [row.id ?? null, Number(row.plan_id), Number(row.week_index) || 0, Number(row.weekday) || 1, row.title || '',
                    row.focus || '', asJson(row.exercises, []), row.notes || '', row.created_at || null, row.updated_at || null]);
            }
            for (const row of Array.isArray(d.workouts) ? d.workouts : []) {
                if (!row || !isYmd(row.log_date)) continue;
                insert(`INSERT OR REPLACE INTO fit_workouts (id, log_date, log_time, plan_day_id, title, exercises, duration_min, volume_kg, rpe, status, note, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [row.id ?? null, row.log_date, row.log_time || '', row.plan_day_id ?? null, row.title || '',
                    asJson(row.exercises, []), row.duration_min ?? null, row.volume_kg ?? null, row.rpe ?? null,
                    row.status || 'done', row.note || '', row.created_at || null, row.updated_at || null]);
            }
            for (const row of Array.isArray(d.meals) ? d.meals : []) {
                if (!row || !isYmd(row.log_date)) continue;
                insert(`INSERT OR REPLACE INTO fit_meals (id, log_date, meal_time, title, tags, calories, protein, carbs, fat, note, estimated, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [row.id ?? null, row.log_date, row.meal_time || '', row.title || '', asJson(row.tags, []),
                    row.calories ?? null, row.protein ?? null, row.carbs ?? null, row.fat ?? null,
                    row.note || '', Number(row.estimated) ? 1 : 0, row.created_at || null]);
            }
            for (const row of Array.isArray(d.protocols) ? d.protocols : []) {
                if (!row) continue;
                insert(`INSERT OR REPLACE INTO fit_protocols (id, name, kind, dosage, schedule, rules, notes, active, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [row.id ?? null, row.name || '', row.kind || 'medication', row.dosage || '',
                    asJson(row.schedule, { times: [], days: [] }), asJson(row.rules, {}), row.notes || '',
                    Number(row.active ?? 1) ? 1 : 0, row.created_at || null, row.updated_at || null]);
            }
            for (const row of Array.isArray(d.health_logs) ? d.health_logs : []) {
                if (!row || !isYmd(row.log_date)) continue;
                insert(`INSERT OR REPLACE INTO fit_health_logs (id, log_date, log_time, protocol_id, type, name, value, value2, unit, status, tags, note, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [row.id ?? null, row.log_date, row.log_time || '', row.protocol_id ?? null, row.type || 'measurement',
                    row.name || '', row.value ?? null, row.value2 ?? null, row.unit || '', row.status || 'logged',
                    asJson(row.tags, []), row.note || '', row.created_at || null]);
            }
            for (const row of Array.isArray(d.cycles) ? d.cycles : []) {
                if (!row || !isYmd(row.start_date)) continue;
                insert(`INSERT OR REPLACE INTO fit_cycles (id, start_date, end_date, cycle_length, period_length, notes, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [row.id ?? null, row.start_date, isYmd(row.end_date) ? row.end_date : '', row.cycle_length ?? null,
                    row.period_length ?? null, row.notes || '', row.created_at || null]);
            }
            for (const row of Array.isArray(d.cycle_logs) ? d.cycle_logs : []) {
                if (!row || !isYmd(row.log_date)) continue;
                insert(`INSERT OR REPLACE INTO fit_cycle_logs (id, log_date, flow, note, created_at) VALUES (?, ?, ?, ?, ?)`,
                    [row.id ?? null, row.log_date, row.flow || '', row.note || '', row.created_at || null]);
            }
            for (const row of Array.isArray(d.intimacy_logs) ? d.intimacy_logs : []) {
                if (!row || !isYmd(row.log_date)) continue;
                insert(`INSERT OR REPLACE INTO fit_intimacy_logs (id, log_date, protection, note, log_time, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
                    [row.id ?? null, row.log_date, row.protection || '', row.note || '', row.log_time || '', row.created_at || null]);
            }
            for (const row of Array.isArray(d.chat_messages) ? d.chat_messages : []) {
                if (!row || !isYmd(row.log_date)) continue;
                const metaVal = typeof row.meta === 'string' ? row.meta : (row.meta ? JSON.stringify(row.meta) : '');
                insert(`INSERT OR REPLACE INTO fit_chat_messages (id, log_date, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
                    [row.id ?? null, row.log_date, row.role || 'user', row.content || '', metaVal, row.created_at || null]);
            }
            if (typeof this._fitRecalcCycleLengths === 'function') this._fitRecalcCycleLengths();
            this.db.run('COMMIT');
        } catch (e) {
            try { this.db.run('ROLLBACK'); } catch (_) {}
            throw e;
        }
        if (autoSave) {
            this.save();
            this._emitFitUpdate();
        }
    },

    // Compact, privacy-conscious snapshot used by the main chat system prompt.
    // Intimate logs and free-form notes are deliberately excluded here.
    getFitAruSnapshot(detailed = false) {
        try {
            const p = this.getFitProfile();
            const today = this._fitDateKey(new Date());
            const from = this._fitAddDays(today, detailed ? -13 : -6);
            const logs = this.getFitDailyLogs(from, today);
            const workouts = this.getFitWorkouts(from, today);
            const meals = this.getFitMeals(today, today);
            const nutRange = this.getFitNutritionRange(from, today);
            const plans = this.getFitPlans('active');
            const protocols = this.getFitProtocols(true);
            const cycles = this.getFitCycles();
            const hasData = p.display_name || p.target_weight != null || p.goal !== 'maintain' || logs.length || nutRange.days.length || workouts.length || plans.length || protocols.length || cycles.length;
            if (!hasData) return '';

            const lines = [];
            const userMode = (typeof window !== 'undefined' && window.aruState && window.aruState.userSettings && window.aruState.userSettings.user_mode) || 'adult';
            const profileAge = p.birth_year ? (new Date().getFullYear() - Number(p.birth_year)) : null;
            const teenSafe = userMode === 'teen' || (profileAge !== null && profileAge < 18);
            const goalLabels = { lose: 'lose weight', maintain: 'maintain weight', gain: 'gain weight', health: 'general health', performance: 'performance' };
            const profileBits = [];
            if (p.goal) {
                profileBits.push(`goal: ${teenSafe && p.goal === 'lose' ? 'healthy growth & maintenance (teen mode)' : (goalLabels[p.goal] || p.goal)}`);
            }
            if (p.target_weight != null && !(teenSafe && p.goal === 'lose')) {
                profileBits.push(`target weight: ${p.target_weight} kg${p.target_date ? ` by ${p.target_date}` : ''}`);
            }
            if (p.height_cm) profileBits.push(`height: ${p.height_cm} cm`);
            if (p.sex) profileBits.push(`sex: ${p.sex}`);
            if (p.birth_year) profileBits.push(`born ${p.birth_year}`);
            if (p.activity_level) profileBits.push(`activity: ${p.activity_level}`);
            const toneLabels = { supportive: 'supportive', neutral: 'neutral and factual', coach: 'concise coaching' };
            if (p.aru_tone && p.aru_tone !== 'supportive') profileBits.push(`preferred Aru tone: ${toneLabels[p.aru_tone] || p.aru_tone}`);
            if (p.calorie_min != null || p.calorie_max != null) {
                profileBits.push(`calorie corridor: ${p.calorie_min != null ? p.calorie_min : '—'}–${p.calorie_max != null ? p.calorie_max : '—'} kcal`);
            }
            const macroTargets = [];
            if (p.protein_target != null) macroTargets.push(`P ${p.protein_target}g`);
            if (p.carbs_target != null) macroTargets.push(`C ${p.carbs_target}g`);
            if (p.fat_target != null) macroTargets.push(`F ${p.fat_target}g`);
            if (p.water_target_ml != null) macroTargets.push(`water ${p.water_target_ml}ml`);
            if (macroTargets.length) profileBits.push(`macro targets: ${macroTargets.join(', ')}`);
            if (profileBits.length) lines.push(`Profile: ${profileBits.join(', ')}.`);

            const span = detailed ? 14 : 7;
            const avgOf = (rows, field) => {
                const values = rows
                    .map(r => r[field])
                    .filter(v => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v)))
                    .map(Number);
                return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
            };

            const weighted = logs.filter(l => l.weight != null);
            if (weighted.length) {
                const first = weighted[0];
                const last = weighted[weighted.length - 1];
                const delta = Number(last.weight) - Number(first.weight);
                lines.push(`Weight (last ${span} days): latest ${last.weight} kg on ${last.log_date}, ${weighted.length} entries, change ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} kg.`);
            }

            const doneWorkouts = workouts.filter(w => w.status === 'done');
            if (workouts.length) {
                const minutes = doneWorkouts.reduce((s, w) => s + (Number(w.duration_min) || 0), 0);
                const volume = doneWorkouts.reduce((s, w) => s + (Number(w.volume_kg) || 0), 0);
                const rpeAvg = avgOf(doneWorkouts, 'rpe');
                const bits = [
                    `${doneWorkouts.length} done`,
                    `${workouts.filter(w => w.status === 'planned').length} planned`,
                    `${workouts.filter(w => w.status === 'skipped').length} skipped`
                ];
                if (minutes) bits.push(`${minutes} min total`);
                if (volume) bits.push(`volume ${Math.round(volume)} kg`);
                if (rpeAvg != null) bits.push(`avg RPE ${rpeAvg.toFixed(1)}`);
                lines.push(`Training (last ${span} days): ${bits.join(', ')}.`);
                if (detailed && doneWorkouts.length) {
                    lines.push(`Recent sessions: ${doneWorkouts.slice(-6).map(w => `${w.log_date} "${w.title}"${w.duration_min ? ` ${w.duration_min}min` : ''}${w.rpe ? ` RPE${w.rpe}` : ''}`).join('; ')}.`);
                }
            }

            const nutritionBits = [];
            if (nutRange.avgCalories != null) nutritionBits.push(`avg ${Math.round(nutRange.avgCalories)} kcal (${nutRange.calorieDays}d)`);
            if (nutRange.avgProtein != null) nutritionBits.push(`protein ${Math.round(nutRange.avgProtein)} g`);
            if (nutRange.avgCarbs != null) nutritionBits.push(`carbs ${Math.round(nutRange.avgCarbs)} g`);
            if (nutRange.avgFat != null) nutritionBits.push(`fat ${Math.round(nutRange.avgFat)} g`);
            const waterAvg = avgOf(logs, 'water_ml');
            if (waterAvg != null) nutritionBits.push(`water ${Math.round(waterAvg)} ml`);
            const todayNut = this.getFitDayNutrition(today, logs.find(l => l.log_date === today) || null, meals);
            if (meals.length) nutritionBits.push(`today ${meals.length} meal(s)${todayNut.calories ? ` ${todayNut.hasEstimated ? '~' : ''}${Math.round(todayNut.calories)} kcal` : ''}`);
            if (nutritionBits.length) lines.push(`Nutrition (last ${span} days): ${nutritionBits.join(', ')}.`);

            const recoveryBits = [];
            const sleepAvg = avgOf(logs, 'sleep_hours');
            if (sleepAvg != null) recoveryBits.push(`sleep ${sleepAvg.toFixed(1)} h`);
            const energyAvg = avgOf(logs, 'energy');
            if (energyAvg != null) recoveryBits.push(`energy ${energyAvg.toFixed(1)}/5`);
            const moodAvg = avgOf(logs, 'mood');
            if (moodAvg != null) recoveryBits.push(`mood ${moodAvg.toFixed(1)}/5`);
            const stressAvg = avgOf(logs, 'stress');
            if (stressAvg != null) recoveryBits.push(`stress ${stressAvg.toFixed(1)}/5`);
            const symptomCounts = new Map();
            for (const log of logs) {
                let list = [];
                try { list = JSON.parse(log.symptoms || '[]') || []; } catch (e) { list = []; }
                if (Array.isArray(list)) for (const item of list) symptomCounts.set(item, (symptomCounts.get(item) || 0) + 1);
            }
            if (symptomCounts.size) {
                recoveryBits.push(`symptoms: ${[...symptomCounts.entries()].slice(0, 5).map(([name, count]) => `${name} ×${count}`).join(', ')}`);
            }
            if (recoveryBits.length) lines.push(`Recovery (last ${span} days): ${recoveryBits.join(', ')}.`);

            if (plans.length) {
                const plan = plans[0];
                let planLine = `Active plan: "${plan.title}" (${plan.weeks} weeks, started ${plan.start_date})`;
                if (plan.start_date) {
                    const weekStart = this._fitWeekKey(plan.start_date);
                    const planEnd = this._fitAddDays(weekStart, Number(plan.weeks) * 7 - 1);
                    if (today >= plan.start_date && today <= planEnd) {
                        const week = Math.floor(this._fitDiffDays(weekStart, today) / 7) + 1;
                        const weekday = ((this._fitDateFromKey(today).getDay() + 6) % 7) + 1;
                        const day = this.getFitPlanDayForDate(plan.id, week, weekday);
                        planLine += `, week ${week}/${plan.weeks} of the plan`;
                        if (day) planLine += `, today: "${day.title || day.focus || 'session'}"`;
                        else planLine += ', no session scheduled today';
                    } else if (today > planEnd) {
                        planLine += `, finished on ${planEnd}`;
                    } else {
                        planLine += `, starts on ${plan.start_date}`;
                    }
                }
                lines.push(planLine + '.');
            }

            const todayLog = logs.find(l => l.log_date === today);
            const todayBits = [];
            if (todayLog) {
                if (todayLog.weight != null) todayBits.push(`weight ${todayLog.weight} kg`);
                if (todayLog.body_fat != null) todayBits.push(`body fat ${todayLog.body_fat}%`);
                if (todayLog.muscle_mass != null) todayBits.push(`muscle ${todayLog.muscle_mass} kg`);
                if (todayLog.workout_status) todayBits.push(`workout ${todayLog.workout_status}`);
                if (todayLog.water_ml != null) todayBits.push(`water ${todayLog.water_ml} ml`);
                if (todayLog.steps != null) todayBits.push(`steps ${todayLog.steps}`);
                if (todayLog.sleep_hours != null) todayBits.push(`sleep ${todayLog.sleep_hours} h`);
                if (todayLog.energy != null) todayBits.push(`energy ${todayLog.energy}/5`);
                if (detailed && todayLog.mood != null) todayBits.push(`mood ${todayLog.mood}/5`);
                if (detailed && todayLog.stress != null) todayBits.push(`stress ${todayLog.stress}/5`);
            }
            if (detailed && meals.length) todayBits.push(`meals: ${meals.map(m => m.title).filter(Boolean).slice(0, 6).join('; ')}`);
            const todayWorkouts = workouts.filter(w => w && w.log_date === today);
            if (todayWorkouts.length) todayBits.push(`workouts: ${todayWorkouts.map(w => `"${w.title}" [${w.status}]`).slice(0, 4).join(', ')}`);
            if (todayBits.length) lines.push(`Today: ${todayBits.join('; ')}.`);

            const todayEvents = (typeof this.getFitHealthLogs === 'function' ? (this.getFitHealthLogs(today, today) || []) : [])
                .filter(h => h && h.type !== 'medication');
            if (todayEvents.length) {
                const measBits = todayEvents.slice(-5).map(h => {
                    const label = h.name || h.type;
                    const val = h.value != null ? ` ${h.value}${h.value2 != null ? `/${h.value2}` : ''}` : '';
                    const unit = h.unit ? ` ${h.unit}` : '';
                    return `${label}${val}${unit}`.trim();
                });
                lines.push(`Measurements today: ${measBits.join('; ')}.`);
            }

            const scheduled = [];
            const todayHealth = this.query("SELECT * FROM fit_health_logs WHERE log_date = ? AND type = 'medication'", [today]);
            const weekday = ((this._fitDateFromKey(today).getDay() + 6) % 7) + 1;
            for (const protocol of protocols) {
                let sched = {};
                try { sched = JSON.parse(protocol.schedule || '{}') || {}; } catch (e) {}
                const days = Array.isArray(sched.days) ? sched.days : [];
                if (days.length && !days.includes(weekday)) continue;
                const times = Array.isArray(sched.times) ? sched.times : [];
                const taken = todayHealth.filter(l => Number(l.protocol_id) === Number(protocol.id) && l.status === 'taken').length;
                scheduled.push(`${protocol.name || 'medication'}${protocol.dosage ? ' ' + protocol.dosage : ''}${times.length ? ' at ' + times.join('/') : ''}${taken ? ` (taken ${taken})` : ' (not taken yet)'}`);
            }
            if (scheduled.length) lines.push(`Medications today: ${scheduled.join('; ')}.`);

            if (Number(p.cycle_tracking)) {
                const cycle = this.getFitCycleInfo(today);
                if (cycle.hasData) {
                    if (cycle.paused) {
                        lines.push(`Cycle tracking: paused (last logged period start ${cycle.lastStart}, ${cycle.daysSinceLastStartToday ?? cycle.daysSinceLastStart} days ago, typical ${cycle.avg} days). Predictions are paused until a real start is logged; do NOT guess a phase or invent a start date. If the user mentions a period, ask for the exact first day and record CYCLE_START.`);
                    } else if (cycle.confidence === 'late') {
                        lines.push(`Cycle tracking: day ${cycle.day} since last start ${cycle.lastStart} (${cycle.lateDays} days past typical ${cycle.avg}-day average, status: waiting/late). Gently ask if a period started if relevant; never diagnose or treat forecasts as contraception.`);
                    } else {
                        const bits = [
                            `last logged period start ${cycle.lastStart}`,
                            `typical cycle ${cycle.avg} days${cycle.confidence === 'recorded' ? '' : ' (estimate)'}`
                        ];
                        if (cycle.periodEndRecorded) bits.push(`bleeding ended ${cycle.periodEnd}`);
                        else bits.push(`bleeding end not logged (phase estimates assume ${cycle.periodLength} days)`);
                        bits.push(`${cycle.confidence === 'recorded' ? 'cycle' : 'estimated cycle'} day ${cycle.day} (${cycle.phase})`);
                        if (cycle.nextPeriod) bits.push(`next period expected around ${cycle.nextPeriod} (forecast, not contraception)`);
                        lines.push(`Cycle tracking: ${bits.join(', ')}.`);
                        if (cycle.confidence === 'estimated') {
                            lines.push(`Cycle note: the current phase is forecast from the average because this period start is not logged yet. Ask the user to confirm or record the first day when it happens.`);
                        }
                    }
                } else {
                    lines.push('Cycle tracking is on, but no period start has been recorded yet, so no cycle facts or forecasts exist. If the user says her period started, record CYCLE_START with the real date.');
                }
            }
            if (p.aru_notes) lines.push(`User's instructions for Aru in Fit & Care: ${String(p.aru_notes).slice(0, 1200)}`);
            return lines.join('\n');
        } catch (e) {
            console.warn('DB.getFitAruSnapshot failed', e);
            return '';
        }
    }
};
