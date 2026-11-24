/*
---ARU-LAB.SPACE---ALMATY---2026---
Aru Fit & Care — sports science, nutrition targets, macro validation and
readiness/load calculations shared across all plugin screens.
---chat.aru-lab.space---PWA---
*/
(function () {
    'use strict';

    const ACTIVITY_FACTORS = {
        sedentary: 1.2,
        light: 1.375,
        moderate: 1.55,
        high: 1.725,
        very_high: 1.9
    };

    function numOrNull(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(String(v).replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    }

    function clamp(v, min, max) {
        return Math.min(max, Math.max(min, v));
    }

    function roundTo(v, step) {
        return Math.round(v / step) * step;
    }

    function dateFromKey(key) {
        return new Date(`${key}T12:00:00`);
    }

    function dateKey(date) {
        const d = date instanceof Date ? date : new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function addDays(key, days) {
        const d = dateFromKey(key);
        d.setDate(d.getDate() + Number(days || 0));
        return dateKey(d);
    }

    function diffDays(fromKey, toKey) {
        return Math.round((dateFromKey(toKey).getTime() - dateFromKey(fromKey).getTime()) / 86400000);
    }

    function startOfWeekKey(key) {
        const d = dateFromKey(key);
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        return dateKey(d);
    }

    function parseExerciseLine(item) {
        if (!item) return null;
        if (typeof item === 'object') {
            const name = String(item.name || item.title || '').trim();
            if (!name) return null;
            const sets = numOrNull(item.sets);
            const rawReps = item.reps;
            let reps = null;
            if (rawReps !== null && rawReps !== undefined && rawReps !== '') {
                const s = String(rawReps).trim();
                reps = /^\d+$/.test(s) ? Number(s) : s;
            }
            const weight = numOrNull(item.weight);
            return {
                name,
                sets: sets !== null && sets > 0 ? Math.round(sets) : null,
                reps,
                weight: weight !== null && weight >= 0 ? weight : null
            };
        }
        let text = String(item).trim();
        if (!text) return null;
        const normalized = text.replace(/\s*[·•]\s*/g, ' ').replace(/\s+/g, ' ').trim();
        let name = normalized;
        let sets = null;
        let reps = null;
        let weight = null;

        const rxFull = /(\d{1,2})\s*[x×х]\s*(\d{1,3}(?:\s*[-–]\s*\d{1,3}|\s*(?:s|с|сек))?)(?:\s+@?\s*([\d.,]+)\s*(?:кг|kg)?)?\s*$/i;
        const fullMatch = rxFull.exec(normalized);
        if (fullMatch) {
            sets = Number(fullMatch[1]);
            const rawReps = fullMatch[2].replace(/\s+/g, '');
            reps = /^\d+$/.test(rawReps) ? Number(rawReps) : rawReps.replace(/(?:с|сек)$/i, 's');
            if (fullMatch[3] !== undefined) {
                weight = numOrNull(fullMatch[3]);
            }
            name = normalized.slice(0, fullMatch.index).replace(/[\s·•,\-–—]+$/, '').trim() || text;
        } else {
            const wOnly = /\s*@\s*([\d.,]+)\s*(?:кг|kg)?\s*$/i.exec(normalized);
            if (wOnly) {
                weight = numOrNull(wOnly[1]);
                name = normalized.slice(0, wOnly.index).replace(/[\s·•,\-–—]+$/, '').trim() || text;
            }
        }
        return { name, sets, reps, weight };
    }

    function parseExercisesStructured(raw) {
        if (!raw) return [];
        let arr = null;
        if (Array.isArray(raw)) {
            arr = raw;
        } else if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (!trimmed) return [];
            if (trimmed.startsWith('[')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) arr = parsed;
                } catch (_) {
                    arr = null;
                }
            }
            if (!arr) {
                arr = trimmed.split(/[;\n|]+/).map(s => s.trim()).filter(Boolean);
            }
        }
        if (!Array.isArray(arr)) return [];
        const out = [];
        for (const entry of arr) {
            const parsed = parseExerciseLine(entry);
            if (parsed && parsed.name) out.push(parsed);
        }
        return out;
    }

    function formatExercise(ex, kgUnit = 'kg') {
        if (!ex) return '';
        if (typeof ex === 'string') return ex;
        const parts = [];
        if (ex.name) parts.push(ex.name);
        if (ex.sets || ex.reps) parts.push(`${ex.sets || '?'}×${ex.reps || '?'}`);
        if (ex.weight !== undefined && ex.weight !== null && ex.weight !== '') {
            parts.push(`${ex.weight} ${kgUnit}`);
        }
        return parts.join(' · ') || ex.name || '';
    }

    function parseRepsNumeric(reps) {
        if (reps === null || reps === undefined || reps === '') return 0;
        if (typeof reps === 'number') return Number.isFinite(reps) && reps > 0 ? reps : 0;
        const s = String(reps).trim();
        if (!s || /[sс]|сек|min|мин/i.test(s)) return 0;
        const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(s);
        if (range) return (Number(range[1]) + Number(range[2])) / 2;
        const single = /^(\d+)/.exec(s);
        return single ? Number(single[1]) : 0;
    }

    function calcExerciseVolume(ex) {
        if (!ex || typeof ex !== 'object') return 0;
        const sets = Number(ex.sets);
        const weight = Number(ex.weight);
        const repsNum = parseRepsNumeric(ex.reps);
        if (sets > 0 && repsNum > 0 && weight > 0) {
            return Math.round(sets * repsNum * weight);
        }
        return 0;
    }

    function calcWorkoutVolume(exercises) {
        const list = parseExercisesStructured(exercises);
        let total = 0;
        for (const ex of list) {
            total += calcExerciseVolume(ex);
        }
        return total > 0 ? total : null;
    }

    function calcE1RM(weight, reps) {
        const w = numOrNull(weight);
        const r = parseRepsNumeric(reps);
        if (!w || w <= 0 || !r || r < 1 || r > 15) return null;
        if (r === 1) return Math.round(w * 10) / 10;
        return Math.round(w * (1 + r / 30) * 10) / 10;
    }

    function estimateWorkoutBurn(workout, weightKg = 70) {
        if (!workout) return null;
        const duration = numOrNull(workout.duration_min);
        if (!duration || duration <= 0) return null;
        const wKg = (numOrNull(weightKg) && Number(weightKg) >= 25 && Number(weightKg) <= 300)
            ? Number(weightKg) : 70;
        const exNames = parseExercisesStructured(workout.exercises).map(e => e.name).join(' ');
        const text = `${workout.title || ''} ${workout.note || ''} ${exNames}`.toLowerCase();

        let met = 5.0; // Default resistance / strength training
        if (/(?:run|jog|бег|кроссфит|crossfit|hiit|табата|tabata|интервал|спринт|sprint|скакалк|jump|burpee|берпи|бокс|box|mma|борьб|жүгіру)/i.test(text)) {
            met = 8.0;
        } else if (/(?:cardio|кардио|вело|bike|cycl|swim|плав|гребл|row|эллипс|ellip|dance|танц|лыж|футбол|баскет|тенис|жүзу)/i.test(text)) {
            met = 6.5;
        } else if (/(?:yoga|йога|stretch|растяж|мобил|mobil|walk|ходьб|прогулк|пилатес|pilates|лфк|заминк|серуен)/i.test(text)) {
            met = 3.3;
        }

        const rpe = numOrNull(workout.rpe);
        if (rpe !== null) {
            if (rpe >= 8) met *= 1.15;
            else if (rpe <= 4) met *= 0.8;
        }
        return Math.round(met * wKg * (duration / 60));
    }

    function normalizeExerciseKey(name) {
        return String(name || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,:;!?\-–—]+$/g, '').trim();
    }

    function computeStrengthProgress(workouts) {
        const list = (workouts || [])
            .filter(w => w && w.status === 'done')
            .slice()
            .sort((a, b) => `${a.log_date} ${a.log_time || ''} ${a.id || 0}`.localeCompare(`${b.log_date} ${b.log_time || ''} ${b.id || 0}`));

        const map = new Map();
        for (const w of list) {
            const exercises = parseExercisesStructured(w.exercises);
            for (const ex of exercises) {
                const weight = numOrNull(ex.weight);
                if (!weight || weight <= 0) continue;
                const key = normalizeExerciseKey(ex.name);
                if (!key) continue;
                const e1rm = calcE1RM(weight, ex.reps);
                if (!map.has(key)) {
                    map.set(key, { key, name: ex.name, sessions: [] });
                }
                const entry = map.get(key);
                entry.name = ex.name;
                entry.sessions.push({
                    date: w.log_date,
                    weight,
                    sets: ex.sets,
                    reps: ex.reps,
                    e1rm
                });
            }
        }

        const items = [];
        for (const entry of map.values()) {
            const e1rmValues = entry.sessions.map(s => s.e1rm).filter(v => v !== null);
            const latest = entry.sessions[entry.sessions.length - 1];
            const first = entry.sessions[0];
            const bestE1RM = e1rmValues.length ? Math.max(...e1rmValues) : null;
            const latestE1RM = latest.e1rm;
            const firstE1RM = first.e1rm;
            const deltaE1RM = (entry.sessions.length >= 2 && latestE1RM !== null && firstE1RM !== null)
                ? Math.round((latestE1RM - firstE1RM) * 10) / 10
                : null;
            const deltaWeight = (entry.sessions.length >= 2)
                ? Math.round((latest.weight - first.weight) * 10) / 10
                : null;
            items.push({
                key: entry.key,
                name: entry.name,
                sessionCount: entry.sessions.length,
                latestDate: latest.date,
                latestWeight: latest.weight,
                latestSets: latest.sets,
                latestReps: latest.reps,
                latestE1RM,
                bestE1RM,
                deltaE1RM,
                deltaWeight,
                sessions: entry.sessions
            });
        }

        return items
            .sort((a, b) => {
                const multiA = a.sessionCount >= 2 ? 1 : 0;
                const multiB = b.sessionCount >= 2 ? 1 : 0;
                if (multiB !== multiA) return multiB - multiA;
                if (b.latestDate !== a.latestDate) return b.latestDate.localeCompare(a.latestDate);
                return b.sessionCount - a.sessionCount;
            })
            .slice(0, 6);
    }

    function computeTrainingLoad(workouts, dailyLogs, todayKey) {
        const today = todayKey || dateKey(new Date());
        const from28 = addDays(today, -27);
        const from7 = addDays(today, -6);

        const done28 = (workouts || []).filter(w => (
            w && w.status === 'done' && w.log_date >= from28 && w.log_date <= today
        ));
        let acute7 = 0;
        let sum28 = 0;
        for (const w of done28) {
            const dur = numOrNull(w.duration_min) || 35;
            const rpe = numOrNull(w.rpe) || 6;
            const load = Math.round(dur * rpe);
            sum28 += load;
            if (w.log_date >= from7) acute7 += load;
        }
        const chronic28 = Math.round(sum28 / 4);
        const workouts28 = done28.length;
        const acwr = (workouts28 >= 4 && chronic28 > 0)
            ? Math.round((acute7 / chronic28) * 100) / 100
            : null;
        let zone = '';
        if (acwr !== null) {
            if (acwr < 0.8) zone = 'low';
            else if (acwr <= 1.3) zone = 'optimal';
            else if (acwr <= 1.5) zone = 'high';
            else zone = 'overload';
        }

        // Readiness score (0..100) from up to 3 most recent logs within the last 7 days
        const recentLogs = (dailyLogs || [])
            .filter(l => l && l.log_date >= from7 && l.log_date <= today)
            .slice()
            .sort((a, b) => b.log_date.localeCompare(a.log_date))
            .slice(0, 3);

        const signals = { sleep: [], energy: [], stress: [], mood: [] };
        for (const l of recentLogs) {
            const sleep = numOrNull(l.sleep_hours);
            if (sleep !== null && sleep > 0) signals.sleep.push(clamp((sleep - 4) / 4, 0, 1) * 100);
            const energy = numOrNull(l.energy);
            if (energy !== null && energy >= 1 && energy <= 5) signals.energy.push(((energy - 1) / 4) * 100);
            const stress = numOrNull(l.stress);
            if (stress !== null && stress >= 1 && stress <= 5) signals.stress.push(((5 - stress) / 4) * 100);
            const mood = numOrNull(l.mood);
            if (mood !== null && mood >= 1 && mood <= 5) signals.mood.push(((mood - 1) / 4) * 100);
        }

        const factorMeans = [];
        for (const list of Object.values(signals)) {
            if (list.length) {
                factorMeans.push(list.reduce((s, v) => s + v, 0) / list.length);
            }
        }
        let readiness = null;
        if (factorMeans.length >= 2) {
            const score = Math.round(factorMeans.reduce((s, v) => s + v, 0) / factorMeans.length);
            readiness = {
                score,
                level: score >= 70 ? 'high' : score >= 45 ? 'moderate' : 'low',
                signalCount: factorMeans.length
            };
        }

        return {
            acute7,
            chronic28,
            workouts28,
            acwr,
            zone,
            readiness
        };
    }

    function computePlanCompletion(plan, planDays, workouts, fromDate, toDate, todayKey) {
        if (!plan || !plan.start_date) {
            return {
                plannedToDate: 0,
                doneToDate: 0,
                adherencePercent: null,
                totalPlanSessions: 0,
                totalPlanDone: 0,
                completionPercent: null
            };
        }
        const today = todayKey || dateKey(new Date());
        const weekStart = startOfWeekKey(plan.start_date);
        const totalWeeks = Math.max(1, Number(plan.weeks) || 1);
        const planEnd = addDays(weekStart, totalWeeks * 7 - 1);
        const daysList = (planDays || []).filter(d => Number(d.plan_id) === Number(plan.id));

        const doneByDate = new Map();
        for (const w of workouts || []) {
            if (!w || w.status !== 'done' || !w.log_date) continue;
            if (!doneByDate.has(w.log_date)) doneByDate.set(w.log_date, []);
            doneByDate.get(w.log_date).push(w);
        }

        const sessionForDate = (key) => {
            if (key < plan.start_date || key > planEnd) return null;
            const week = Math.floor(diffDays(weekStart, key) / 7) + 1;
            const dow = ((dateFromKey(key).getDay() + 6) % 7) + 1;
            const exact = daysList.find(d => Number(d.week_index) === week && Number(d.weekday) === dow);
            const tpl = daysList.find(d => Number(d.week_index) === 0 && Number(d.weekday) === dow);
            const day = exact || tpl || null;
            if (!day) return null;
            const hasEx = parseExercisesStructured(day.exercises).length > 0;
            if (!day.title && !day.focus && !hasEx) return null;
            return day;
        };

        const isCompleted = (key, day) => {
            const list = doneByDate.get(key) || [];
            if (!list.length) return false;
            return list.some(w => Number(w.plan_day_id) === Number(day.id)) || list.length > 0;
        };

        // Adherence across the dashboard window up to today
        const rangeEnd = toDate < today ? toDate : today;
        let plannedToDate = 0;
        let doneToDate = 0;
        if (fromDate <= rangeEnd) {
            for (let k = fromDate; k <= rangeEnd; k = addDays(k, 1)) {
                const day = sessionForDate(k);
                if (!day) continue;
                plannedToDate++;
                if (isCompleted(k, day)) doneToDate++;
            }
        }

        // Overall plan completion across full plan schedule
        let totalPlanSessions = 0;
        let totalPlanDone = 0;
        for (let k = plan.start_date; k <= planEnd; k = addDays(k, 1)) {
            const day = sessionForDate(k);
            if (!day) continue;
            totalPlanSessions++;
            if (k <= today && isCompleted(k, day)) totalPlanDone++;
        }

        return {
            plannedToDate,
            doneToDate,
            adherencePercent: plannedToDate ? Math.min(100, Math.round((doneToDate / plannedToDate) * 100)) : null,
            totalPlanSessions,
            totalPlanDone,
            completionPercent: totalPlanSessions ? Math.min(100, Math.round((totalPlanDone / totalPlanSessions) * 100)) : null
        };
    }

    function validateMealMacros(meal) {
        const m = meal || {};
        const p = numOrNull(m.protein);
        const c = numOrNull(m.carbs);
        const f = numOrNull(m.fat);
        const cal = numOrNull(m.calories);
        const hasMacros = p !== null || c !== null || f !== null;
        if (!hasMacros) {
            return {
                hasMacros: false,
                fromMacros: cal !== null ? Math.round(cal) : null,
                deviationPct: 0,
                mismatch: false,
                suggestedCalories: cal !== null ? Math.round(cal) : null
            };
        }
        const fromMacros = Math.round((p || 0) * 4 + (c || 0) * 4 + (f || 0) * 9);
        if (cal === null) {
            return {
                hasMacros: true,
                fromMacros,
                deviationPct: 0,
                mismatch: false,
                suggestedCalories: fromMacros
            };
        }
        const denom = Math.max(cal, fromMacros, 1);
        const deviationPct = Math.round((Math.abs(cal - fromMacros) / denom) * 100);
        return {
            hasMacros: true,
            fromMacros,
            deviationPct,
            mismatch: fromMacros > 0 && deviationPct > 22,
            suggestedCalories: fromMacros
        };
    }

    function computeMacroSplit(kcalBase, weightRef, lbm, goal, teenSafe) {
        if (!kcalBase || !weightRef) return { protein: null, carbs: null, fat: null };
        const pFactor = teenSafe
            ? 1.4
            : lbm
                ? (goal === 'lose' ? 2.1 : (goal === 'gain' || goal === 'performance') ? 2.0 : 1.7)
                : (goal === 'lose' ? 1.8 : (goal === 'gain' || goal === 'performance') ? 1.7 : 1.5);
        let protein = clamp(Math.round(weightRef * pFactor), 45, 260);
        const fatShare = goal === 'lose' ? 0.25 : 0.27;
        const fatMin = Math.max(weightRef * 0.8, (kcalBase * 0.22) / 9);
        let fat = clamp(Math.round(Math.max(fatMin, (kcalBase * fatShare) / 9)), 35, 160);
        const minCarbs = Math.min(100, Math.max(50, Math.round((kcalBase * 0.20) / 4)));
        if (protein * 4 + fat * 9 + minCarbs * 4 > kcalBase) {
            const fatFloor = Math.max(35, Math.round((kcalBase * 0.20) / 9));
            const fatNeed = Math.ceil((protein * 4 + fat * 9 + minCarbs * 4 - kcalBase) / 9);
            fat = Math.max(fatFloor, fat - fatNeed);
        }
        if (protein * 4 + fat * 9 + minCarbs * 4 > kcalBase) {
            const proFloor = Math.max(45, Math.round(weightRef * 1.4));
            const proNeed = Math.ceil((protein * 4 + fat * 9 + minCarbs * 4 - kcalBase) / 4);
            protein = Math.max(proFloor, protein - proNeed);
        }
        const carbs = Math.max(0, Math.round((kcalBase - protein * 4 - fat * 9) / 4));
        return { protein, carbs, fat };
    }

    function computeTargets(profile = {}, opts = {}) {
        const p = profile || {};
        const weight = numOrNull(opts.latestWeight);
        const height = numOrNull(p.height_cm);
        const birthYear = numOrNull(p.birth_year);
        const age = birthYear ? (new Date().getFullYear() - birthYear) : null;
        const sex = p.sex || '';
        const teenSafe = opts.ageMode === 'teen' || (age !== null && age < 18);
        const rawFat = numOrNull(opts.latestBodyFat);
        const bodyFat = (rawFat !== null && rawFat >= 5 && rawFat <= 60) ? rawFat : null;
        const todayKey = opts.todayKey || dateKey(new Date());
        const workoutMinutes = Math.max(0, numOrNull(opts.workoutMinutes) || 0);

        const lbm = (weight && bodyFat !== null) ? weight * (1 - bodyFat / 100) : null;
        const katchReady = !!(lbm && lbm > 15);
        const mifflinReady = !!(weight && height && age !== null && age >= 10 && age <= 100);

        let bmr = null;
        let formula = '';
        if (katchReady) {
            bmr = Math.round(370 + 21.6 * lbm);
            formula = 'katch';
        } else if (mifflinReady) {
            const s = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
            bmr = Math.round(10 * weight + 6.25 * height - 5 * age + s);
            formula = 'mifflin';
        }

        const factor = ACTIVITY_FACTORS[p.activity_level] || 1.55;
        const tdee = bmr ? Math.round(bmr * factor) : null;
        const goal = p.goal || 'maintain';

        const adultFloor = sex === 'male' ? 1500 : 1200;
        const teenFloor = sex === 'male' ? 1800 : 1600;
        const effectiveFloor = teenSafe ? teenFloor : adultFloor;

        let targetKcalAuto = null;
        let calorieMinAuto = null;
        let calorieMaxAuto = null;
        let weeklyRateKg = null;
        let paceWarning = false;

        if (tdee) {
            if (teenSafe) {
                targetKcalAuto = roundTo(Math.max(tdee, teenFloor), 10);
                weeklyRateKg = 0;
            } else {
                let dailyDelta = 0;
                if (goal === 'lose') dailyDelta = -tdee * 0.15;
                else if (goal === 'gain') dailyDelta = tdee * 0.10;
                else if (goal === 'performance') dailyDelta = tdee * 0.05;

                const targetWeight = numOrNull(p.target_weight);
                const targetDate = String(p.target_date || '').trim();
                if (goal === 'lose') {
                    if (targetWeight && weight && targetWeight >= weight) {
                        dailyDelta = 0;
                    } else if (targetWeight && targetDate && targetDate > todayKey && weight) {
                        const days = Math.max(1, diffDays(todayKey, targetDate));
                        const requestedDelta = ((targetWeight - weight) * 7700) / days;
                        const maxDeficit = -Math.min(750, tdee * 0.25);
                        if (requestedDelta < maxDeficit) paceWarning = true;
                        dailyDelta = clamp(requestedDelta, maxDeficit, 0);
                    }
                } else if (goal === 'gain') {
                    if (targetWeight && weight && targetWeight <= weight) {
                        dailyDelta = 0;
                    } else if (targetWeight && targetDate && targetDate > todayKey && weight) {
                        const days = Math.max(1, diffDays(todayKey, targetDate));
                        const requestedDelta = ((targetWeight - weight) * 7700) / days;
                        const maxSurplus = 500;
                        if (requestedDelta > maxSurplus) paceWarning = true;
                        dailyDelta = clamp(requestedDelta, 0, maxSurplus);
                    }
                }
                targetKcalAuto = roundTo(Math.max(tdee + dailyDelta, adultFloor), 10);
                weeklyRateKg = Math.round((((targetKcalAuto - tdee) * 7) / 7700) * 100) / 100;
            }
            calorieMinAuto = clamp(Math.max(effectiveFloor, roundTo(targetKcalAuto - 150, 10)), effectiveFloor, 10000);
            calorieMaxAuto = clamp(Math.max(calorieMinAuto + 100, roundTo(targetKcalAuto + 150, 10)), effectiveFloor, 10000);
        }

        const savedMin = numOrNull(p.calorie_min);
        const savedMax = numOrNull(p.calorie_max);
        const calorieMin = savedMin ?? calorieMinAuto;
        const calorieMax = savedMax ?? calorieMaxAuto;
        const calorieTarget = (calorieMin !== null && calorieMax !== null)
            ? Math.round((calorieMin + calorieMax) / 2)
            : (calorieMax ?? calorieMin ?? targetKcalAuto);

        let weightRef = weight;
        if (weight && !lbm && height) {
            const bmi = weight / Math.pow(height / 100, 2);
            if (bmi > 30) {
                const ideal = 24.9 * Math.pow(height / 100, 2);
                weightRef = ideal + 0.4 * (weight - ideal);
            }
        } else if (lbm) {
            weightRef = lbm;
        }

        const autoMacros = computeMacroSplit(targetKcalAuto, weightRef, lbm, goal, teenSafe);
        const effectiveMacroKcal = (savedMin !== null || savedMax !== null) ? calorieTarget : targetKcalAuto;
        const effMacros = (effectiveMacroKcal === targetKcalAuto)
            ? autoMacros
            : computeMacroSplit(effectiveMacroKcal, weightRef, lbm, goal, teenSafe);
        const proteinAuto = autoMacros.protein;
        const fatAuto = autoMacros.fat;
        const carbsAuto = autoMacros.carbs;

        const baseWaterAuto = weight ? clamp(roundTo(weight * 32, 50), 1500, 4000) : 2000;
        const workoutWaterExtra = workoutMinutes > 0 ? roundTo((workoutMinutes / 60) * 400, 50) : 0;
        const waterAuto = baseWaterAuto + workoutWaterExtra;

        const savedWater = numOrNull(p.water_target_ml);
        return {
            bmr,
            tdee,
            formula,
            lbm: lbm ? Math.round(lbm * 10) / 10 : null,
            teenSafe,
            paceWarning,
            weeklyRateKg,
            hasFullBodyData: !!(bmr && tdee),
            auto: {
                calorieMin: calorieMinAuto,
                calorieMax: calorieMaxAuto,
                calorieTarget: targetKcalAuto,
                protein: proteinAuto,
                carbs: carbsAuto,
                fat: fatAuto,
                waterMl: waterAuto
            },
            calorieMin,
            calorieMax,
            calorieTarget,
            protein: numOrNull(p.protein_target) ?? effMacros.protein,
            carbs: numOrNull(p.carbs_target) ?? effMacros.carbs,
            fat: numOrNull(p.fat_target) ?? effMacros.fat,
            waterMl: (savedWater ?? baseWaterAuto) + workoutWaterExtra
        };
    }

    window.FitCareEngine = {
        parseExerciseLine,
        parseExercisesStructured,
        formatExercise,
        parseRepsNumeric,
        calcExerciseVolume,
        calcWorkoutVolume,
        calcE1RM,
        estimateWorkoutBurn,
        computeStrengthProgress,
        computeTrainingLoad,
        computePlanCompletion,
        validateMealMacros,
        computeTargets
    };
})();
