/*
---ARU-LAB.SPACE---ALMATY---2026---
Aru Fit & Care — settings: profile and goals, Aru context, cycle defaults,
JSON/CSV export and import, local data controls and disclaimers.
---chat.aru-lab.space---PWA---
*/
window.FitCarePlugin = window.FitCarePlugin || {};

Object.assign(window.FitCarePlugin, {
    renderSettings() {
        const container = document.getElementById('fit-view');
        if (!container) return;
        const profile = this.state.profile || (window.DB && window.DB.getFitProfile()) || {};
        const cycleTracking = Number(profile.cycle_tracking) ? 1 : 0;
        const intimacyTracking = Number(profile.intimacy_tracking) ? 1 : 0;
        const adult = this.isAdult();
        const cycleLength = Number(profile.cycle_length) || 28;
        const periodLength = Number(profile.period_length) || 5;
        const lutealLength = Number(profile.luteal_length) || 14;
        const accepted = Number(profile.disclaimer_accepted) ? 1 : 0;
        const currentYear = new Date().getFullYear();
        const latestWeightRow = (window.DB && typeof window.DB.getFitLatestWeight === 'function') ? window.DB.getFitLatestWeight() : null;
        const latestWeight = latestWeightRow ? latestWeightRow.weight : null;
        const option = (value, label, selected) => `
            <option value="${this.esc(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${this.esc(label)}</option>
        `;
        const num = (value) => (value === null || value === undefined ? '' : String(value));

        container.innerHTML = `
            <div class="fit-page">
                <div class="fit-page-head">
                    <div>
                        <p class="fit-kicker">Aru Fit &amp; Care</p>
                        <h2>${this.esc(this.t('settings_title'))}</h2>
                        <p>${this.esc(this.t('settings_sub'))}</p>
                    </div>
                </div>
                <div class="fit-settings-grid">
                    <section class="fit-card fit-span-2">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('profile'))}</h3>
                                <p>${this.esc(this.t('profile_sub'))}</p>
                            </div>
                            <span class="fit-badge"><i data-lucide="user-round"></i>${this.esc(profile.display_name || this.t('profile'))}</span>
                        </div>
                        <form data-fit-form="profile" class="fit-settings-grid">
                            <label class="fit-field">
                                <span>${this.esc(this.t('name'))}</span>
                                <input class="fit-input" name="display_name" maxlength="80" autocomplete="name"
                                    value="${this.esc(profile.display_name || '')}">
                            </label>
                            <label class="fit-field">
                                <span>${this.esc(this.t('sex'))}</span>
                                <select class="fit-select" name="sex">
                                    ${option('', this.t('none'), profile.sex || '')}
                                    ${option('female', this.t('sex_female'), profile.sex)}
                                    ${option('male', this.t('sex_male'), profile.sex)}
                                    ${option('other', this.t('sex_other'), profile.sex)}
                                </select>
                            </label>
                            <label class="fit-field">
                                <span>${this.esc(this.t('birth_year'))}</span>
                                <input class="fit-input" type="number" inputmode="numeric" name="birth_year"
                                    min="1900" max="${currentYear}" step="1" value="${this.esc(num(profile.birth_year))}">
                            </label>
                            <label class="fit-field">
                                <span>${this.esc(this.t('height'))}</span>
                                <input class="fit-input" type="number" inputmode="decimal" name="height_cm"
                                    min="80" max="250" step="0.1" value="${this.esc(num(profile.height_cm))}">
                            </label>
                            <label class="fit-field">
                                <span>${this.esc(this.t('current_weight'))}</span>
                                <input class="fit-input" type="number" inputmode="decimal" name="current_weight"
                                    min="20" max="400" step="0.1" value="${this.esc(num(latestWeight))}">
                                <small>${this.esc(latestWeightRow ? this.t('weight_logged_at', { date: this.formatShortDate(latestWeightRow.log_date) }) : this.t('current_weight_hint'))}</small>
                            </label>
                            <label class="fit-field">
                                <span>${this.esc(this.t('activity'))}</span>
                                <select class="fit-select" name="activity_level">
                                    ${option('sedentary', this.t('activity_sedentary'), profile.activity_level)}
                                    ${option('light', this.t('activity_light'), profile.activity_level)}
                                    ${option('moderate', this.t('activity_moderate'), profile.activity_level)}
                                    ${option('high', this.t('activity_high'), profile.activity_level)}
                                </select>
                            </label>
                            <label class="fit-field">
                                <span>${this.esc(this.t('goal'))}</span>
                                <select class="fit-select" name="goal">
                                    ${option('lose', this.t('goal_lose'), profile.goal)}
                                    ${option('maintain', this.t('goal_maintain'), profile.goal)}
                                    ${option('gain', this.t('goal_gain'), profile.goal)}
                                    ${option('health', this.t('goal_health'), profile.goal)}
                                    ${option('performance', this.t('goal_performance'), profile.goal)}
                                </select>
                            </label>
                            <label class="fit-field">
                                <span>${this.esc(this.t('target_weight'))}</span>
                                <input class="fit-input" type="number" inputmode="decimal" name="target_weight"
                                    min="20" max="400" step="0.1" value="${this.esc(num(profile.target_weight))}">
                            </label>
                            <label class="fit-field">
                                <span>${this.esc(this.t('target_date'))}</span>
                                <input class="fit-input" type="date" name="target_date" value="${this.esc(profile.target_date || '')}">
                            </label>
                            <label class="fit-field">
                                <span>${this.esc(this.t('calorie_min'))}</span>
                                <input class="fit-input" type="number" inputmode="numeric" name="calorie_min"
                                    min="500" max="10000" step="10" value="${this.esc(num(profile.calorie_min))}">
                            </label>
                            <label class="fit-field">
                                <span>${this.esc(this.t('calorie_max'))}</span>
                                <input class="fit-input" type="number" inputmode="numeric" name="calorie_max"
                                    min="500" max="10000" step="10" value="${this.esc(num(profile.calorie_max))}">
                            </label>
                            <div class="fit-field">
                                <span>${this.esc(this.t('calc_calories'))}</span>
                                <button type="button" class="fit-btn fit-btn-soft" data-fit-action="calc-calories">
                                    <i data-lucide="calculator"></i>${this.esc(this.t('calc_calories_btn'))}
                                </button>
                                <small>${this.esc(this.t('calc_calories_hint'))}</small>
                            </div>
                            <div class="fit-span-2 fit-row" style="justify-content:flex-end">
                                <button type="submit" class="fit-btn fit-btn-primary">
                                    <i data-lucide="check"></i>${this.esc(this.t('save'))}
                                </button>
                            </div>
                        </form>
                    </section>

                    <section class="fit-card">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('aru_section'))}</h3>
                                <p>${this.esc(this.t('aru_sub'))}</p>
                            </div>
                            <span class="fit-badge"><i data-lucide="sparkles"></i>Aru</span>
                        </div>
                        <form data-fit-form="aru" class="fit-stack" style="gap:12px">
                            <label class="fit-field">
                                <span>${this.esc(this.t('tone'))}</span>
                                <select class="fit-select" name="aru_tone">
                                    ${option('supportive', this.t('tone_supportive'), profile.aru_tone)}
                                    ${option('neutral', this.t('tone_neutral'), profile.aru_tone)}
                                    ${option('coach', this.t('tone_coach'), profile.aru_tone)}
                                </select>
                            </label>
                            <label class="fit-field">
                                <span>${this.esc(this.t('aru_notes'))}</span>
                                <textarea class="fit-textarea" name="aru_notes" maxlength="1200"
                                    placeholder="${this.esc(this.t('aru_notes_hint'))}">${this.esc(profile.aru_notes || '')}</textarea>
                                <small>${this.esc(this.t('aru_notes_hint'))}</small>
                            </label>
                            <div class="fit-field">
                                <span>${this.esc(this.t('snapshot_title'))}</span>
                                <small>${this.esc(this.t('snapshot_desc'))}</small>
                            </div>
                            <div class="fit-privacy-note">
                                <i data-lucide="shield-check"></i>
                                <span>${this.esc(this.t('aru_privacy'))}</span>
                            </div>
                            <div class="fit-row" style="justify-content:flex-end">
                                <button type="submit" class="fit-btn fit-btn-primary">
                                    <i data-lucide="check"></i>${this.esc(this.t('save'))}
                                </button>
                            </div>
                        </form>
                    </section>

                    <section class="fit-card">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('cycle_settings'))}</h3>
                                <p>${this.esc(this.t('cycle_settings_hint'))}</p>
                            </div>
                            <span class="fit-badge"><i data-lucide="droplets"></i>${this.esc(this.t('cycle'))}</span>
                        </div>
                        <form data-fit-form="cycle-settings" class="fit-stack" style="gap:12px">
                            <div class="fit-switch-row">
                                <div>
                                    <b>${this.esc(this.t('cycle_tracking'))}</b>
                                    <small>${this.esc(this.t('cycle_tracking_hint'))}</small>
                                </div>
                                <input type="hidden" name="cycle_tracking" value="${cycleTracking}">
                                <button type="button" class="fit-switch ${cycleTracking ? 'is-on' : ''}"
                                    data-fit-action="settings-switch" data-target="cycle_tracking"
                                    aria-pressed="${cycleTracking ? 'true' : 'false'}"
                                    aria-label="${this.esc(this.t('cycle_tracking'))}"></button>
                            </div>
                            <div class="fit-form-grid">
                                <label class="fit-field">
                                    <span>${this.esc(this.t('cycle_length'))}</span>
                                    <input class="fit-input" type="number" inputmode="numeric" name="cycle_length"
                                        min="15" max="60" step="1" value="${cycleLength}">
                                </label>
                                <label class="fit-field">
                                    <span>${this.esc(this.t('period_length'))}</span>
                                    <input class="fit-input" type="number" inputmode="numeric" name="period_length"
                                        min="1" max="15" step="1" value="${periodLength}">
                                </label>
                                <label class="fit-field">
                                    <span>${this.esc(this.t('luteal_length'))}</span>
                                    <input class="fit-input" type="number" inputmode="numeric" name="luteal_length"
                                        min="7" max="20" step="1" value="${lutealLength}">
                                </label>
                            </div>
                            <div class="fit-privacy-note">
                                <i data-lucide="shield-check"></i>
                                <span>${this.esc(this.t('cycle_settings_hint'))}</span>
                            </div>
                            <div class="fit-row" style="justify-content:flex-end">
                                <button type="submit" class="fit-btn fit-btn-primary">
                                    <i data-lucide="check"></i>${this.esc(this.t('save'))}
                                </button>
                            </div>
                        </form>
                    </section>

                    ${adult ? `
                    <section class="fit-card">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('intimacy_settings'))}</h3>
                                <p>${this.esc(this.t('intimacy_settings_hint'))}</p>
                            </div>
                            <span class="fit-badge"><i data-lucide="lock"></i>${this.esc(this.t('intimacy_title'))}</span>
                        </div>
                        <form data-fit-form="intimacy-settings" class="fit-stack" style="gap:12px">
                            <div class="fit-switch-row">
                                <div>
                                    <b>${this.esc(this.t('intimacy_tracking'))}</b>
                                    <small>${this.esc(this.t('intimacy_tracking_hint'))}</small>
                                </div>
                                <input type="hidden" name="intimacy_tracking" value="${intimacyTracking}">
                                <button type="button" class="fit-switch ${intimacyTracking ? 'is-on' : ''}"
                                    data-fit-action="settings-switch" data-target="intimacy_tracking"
                                    aria-pressed="${intimacyTracking ? 'true' : 'false'}"
                                    aria-label="${this.esc(this.t('intimacy_tracking'))}"></button>
                            </div>
                            <div class="fit-privacy-note">
                                <i data-lucide="shield-check"></i>
                                <span>${this.esc(this.t('intimacy_private_note'))}</span>
                            </div>
                            <div class="fit-row" style="justify-content:flex-end">
                                <button type="submit" class="fit-btn fit-btn-primary">
                                    <i data-lucide="check"></i>${this.esc(this.t('save'))}
                                </button>
                            </div>
                        </form>
                    </section>
                    ` : ''}

                    <section class="fit-card fit-span-2">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('data_section'))}</h3>
                                <p>${this.esc(this.t('data_sub'))}</p>
                            </div>
                        </div>
                        <div class="fit-data-actions">
                            <button type="button" class="fit-btn fit-btn-soft" data-fit-action="settings-export-json">
                                <i data-lucide="download"></i>${this.esc(this.t('export_json'))}
                            </button>
                            <button type="button" class="fit-btn fit-btn-soft" data-fit-action="settings-export-csv">
                                <i data-lucide="table"></i>${this.esc(this.t('export_csv'))}
                            </button>
                            <button type="button" class="fit-btn fit-btn-soft" data-fit-action="settings-import">
                                <i data-lucide="upload"></i>${this.esc(this.t('import_data'))}
                            </button>
                            <button type="button" class="fit-btn fit-btn-danger" data-fit-action="settings-clear">
                                <i data-lucide="trash-2"></i>${this.esc(this.t('clear_data'))}
                            </button>
                        </div>
                        <div class="fit-stack" style="gap:4px;margin-top:10px">
                            <small class="fit-muted" style="font-size:.68rem;line-height:1.5">${this.esc(this.t('import_hint'))}</small>
                            <small class="fit-muted" style="font-size:.68rem;line-height:1.5">${this.esc(this.t('backup_hint'))}</small>
                        </div>
                    </section>

                    <section class="fit-card">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('disclaimer_section'))}</h3>
                                <p>${this.esc(this.t('privacy_local'))}</p>
                            </div>
                            <i data-lucide="shield-alert" style="color:var(--fit-accent)"></i>
                        </div>
                        <p class="fit-muted" style="margin:0 0 12px;font-size:.74rem;line-height:1.6">${this.esc(this.t('disclaimer_text'))}</p>
                        ${accepted
                            ? `<div class="fit-privacy-note"><i data-lucide="shield-check"></i><span>${this.esc(this.t('disclaimer_ok'))}</span></div>`
                            : `<button type="button" class="fit-btn fit-btn-primary" data-fit-action="accept-disclaimer">${this.esc(this.t('accept_disclaimer'))}</button>`}
                    </section>

                    <section class="fit-card">
                        <div class="fit-card-head">
                            <div>
                                <h3>${this.esc(this.t('about_section'))}</h3>
                                <p>Aru Fit &amp; Care</p>
                            </div>
                            <span class="fit-badge"><i data-lucide="heart-pulse"></i>${this.esc(this.t('privacy_local'))}</span>
                        </div>
                        <p class="fit-muted" style="margin:0;font-size:.74rem;line-height:1.6">${this.esc(this.t('about_text'))}</p>
                    </section>
                </div>
            </div>
        `;
        this.bindSettingsFileInput();
    },

    bindSettingsFileInput() {
        const input = document.getElementById('fit-import-file');
        if (!input || input._fitBound) return;
        input._fitBound = true;
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            input.value = '';
            if (file) void this.importSettingsFile(file);
        });
    },

    // ---------- actions ----------
    handleSettingsAction(action, el) {
        switch (action) {
            case 'settings-switch': {
                const name = el.dataset.target;
                const input = el.closest('form') ? el.closest('form').elements.namedItem(name) : null;
                const next = input ? input.value !== '1' : !el.classList.contains('is-on');
                if (input) input.value = next ? '1' : '0';
                el.classList.toggle('is-on', next);
                el.setAttribute('aria-pressed', next ? 'true' : 'false');
                return true;
            }
            case 'calc-calories':
                this.calcCalories(el);
                return true;
            case 'settings-export-json':
                this.exportSettingsJson();
                return true;
            case 'settings-export-csv':
                this.exportSettingsCsv();
                return true;
            case 'settings-import': {
                const input = document.getElementById('fit-import-file');
                if (input) input.click();
                return true;
            }
            case 'settings-clear':
                this.openSettingsConfirm({
                    title: this.t('clear_data'),
                    message: this.t('clear_confirm'),
                    confirmLabel: this.t('clear_data'),
                    danger: true,
                    onConfirm: () => this.clearSettingsData()
                });
                return true;
            default:
                return false;
        }
    },

    handleSettingsForm(name, form) {
        if (name === 'profile') {
            this.saveProfileSettings(form);
            return true;
        }
        if (name === 'aru') {
            this.saveAruSettings(form);
            return true;
        }
        if (name === 'cycle-settings') {
            this.saveCycleSettings(form);
            return true;
        }
        if (name === 'intimacy-settings') {
            this.saveIntimacySettings(form);
            return true;
        }
        return false;
    },

    saveProfileSettings(form) {
        let calorieMin = this.fieldNumber(form, 'calorie_min');
        let calorieMax = this.fieldNumber(form, 'calorie_max');
        if (calorieMin !== null && calorieMax !== null && calorieMin > calorieMax) {
            [calorieMin, calorieMax] = [calorieMax, calorieMin];
        }
        window.DB.saveFitProfile({
            display_name: this.fieldValue(form, 'display_name'),
            sex: this.fieldValue(form, 'sex'),
            birth_year: this.fieldNumber(form, 'birth_year'),
            height_cm: this.fieldNumber(form, 'height_cm'),
            activity_level: this.fieldValue(form, 'activity_level') || 'moderate',
            goal: this.fieldValue(form, 'goal') || 'maintain',
            target_weight: this.fieldNumber(form, 'target_weight'),
            target_date: this.fieldValue(form, 'target_date'),
            calorie_min: calorieMin,
            calorie_max: calorieMax
        });
        const currentWeight = this.fieldNumber(form, 'current_weight');
        if (currentWeight !== null) {
            window.DB.saveFitDailyLog({ log_date: this.todayKey(), weight: currentWeight });
            this.loadAll();
        }
        this.state.profile = window.DB.getFitProfile();
        this.render();
        this.toast(this.t('settings_saved'), 'success');
    },

    calcCalories(button) {
        const form = button.closest('form');
        if (!form) return;
        const sex = this.fieldValue(form, 'sex');
        const birthYear = this.fieldNumber(form, 'birth_year');
        const height = this.fieldNumber(form, 'height_cm');
        let weight = this.fieldNumber(form, 'current_weight');
        if (weight === null && window.DB && typeof window.DB.getFitLatestWeight === 'function') {
            const latest = window.DB.getFitLatestWeight();
            weight = latest ? Number(latest.weight) : null;
        }
        const age = birthYear ? new Date().getFullYear() - birthYear : null;
        if (!weight || !height || !age || age < 10 || age > 100) {
            this.toast(this.t('calc_need_data'), 'error');
            return;
        }
        // Mifflin-St Jeor with activity and goal adjustments — an estimate to
        // pre-fill the range, never a medical recommendation.
        let bmr = 10 * weight + 6.25 * height - 5 * age;
        if (sex === 'male') bmr += 5;
        else if (sex === 'female') bmr -= 161;
        else bmr -= 78;
        const factors = { sedentary: 1.2, light: 1.375, moderate: 1.55, high: 1.725 };
        const tdee = bmr * (factors[this.fieldValue(form, 'activity_level')] || 1.55);
        const goal = this.fieldValue(form, 'goal') || 'maintain';
        const goalFactor = goal === 'lose' ? 0.85 : goal === 'gain' ? 1.12 : 1;
        const floor = sex === 'male' ? 1500 : 1200;
        const target = Math.max(tdee * goalFactor, floor);
        const round10 = (value) => Math.round(value / 10) * 10;
        const clamp = (value) => Math.min(10000, Math.max(500, value));
        const min = clamp(round10(target - 150));
        const max = clamp(round10(target + 150));
        const minInput = form.elements.namedItem('calorie_min');
        const maxInput = form.elements.namedItem('calorie_max');
        if (minInput) minInput.value = String(min);
        if (maxInput) maxInput.value = String(max);
        this.toast(this.t('calc_done', { min, max }), 'success');
    },

    saveAruSettings(form) {
        window.DB.saveFitProfile({
            aru_tone: this.fieldValue(form, 'aru_tone') || 'supportive',
            aru_notes: this.fieldValue(form, 'aru_notes')
        });
        this.state.profile = window.DB.getFitProfile();
        this.render();
        this.toast(this.t('settings_saved'), 'success');
    },

    saveCycleSettings(form) {
        const cycleLength = Math.min(60, Math.max(15, Math.round(this.fieldNumber(form, 'cycle_length') || 28)));
        const periodLength = Math.min(15, Math.max(1, Math.round(this.fieldNumber(form, 'period_length') || 5)));
        const lutealLength = Math.min(20, Math.max(7, Math.round(this.fieldNumber(form, 'luteal_length') || 14)));
        window.DB.saveFitProfile({
            cycle_tracking: this.fieldValue(form, 'cycle_tracking') === '1' ? 1 : 0,
            cycle_length: cycleLength,
            period_length: periodLength,
            luteal_length: lutealLength
        });
        this.state.profile = window.DB.getFitProfile();
        this.loadAll();
        this.render();
        this.toast(this.t('settings_saved'), 'success');
    },

    saveIntimacySettings(form) {
        window.DB.saveFitProfile({
            intimacy_tracking: this.fieldValue(form, 'intimacy_tracking') === '1' ? 1 : 0
        });
        this.state.profile = window.DB.getFitProfile();
        this.state.showPrivate = false;
        this.loadAll();
        this.render();
        this.toast(this.t('settings_saved'), 'success');
    },

    openSettingsConfirm(options) {
        const opts = options || {};
        this._confirmCallback = opts.onConfirm || null;
        this.openModal({
            title: opts.title || this.t('settings_title'),
            body: `<p class="fit-muted" style="margin:0;font-size:.8rem;line-height:1.55">${this.esc(opts.message || '')}</p>`,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn ${opts.danger ? 'fit-btn-danger' : 'fit-btn-primary'}" data-fit-action="confirm-yes">${this.esc(opts.confirmLabel || this.t('save'))}</button>
            `
        });
    },

    // ---------- export ----------
    downloadFile(name, content, mime) {
        const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1200);
    },

    exportSettingsJson() {
        try {
            const data = window.DB.getFitAllData();
            this.downloadFile(
                `aru-fit-care-backup-${this.todayKey()}.json`,
                JSON.stringify(data, null, 2),
                'application/json;charset=utf-8'
            );
            this.toast(this.t('export_ok'), 'success');
        } catch (error) {
            console.error('FitCare: JSON export failed', error);
            this.toast(this.t('toast_error'), 'error');
        }
    },

    csvColumns() {
        return ['log_date', 'weight', 'body_fat', 'muscle_mass', 'water_pct', 'bone_mass',
            'visceral_fat', 'sleep_hours', 'energy', 'steps', 'calories', 'protein',
            'carbs', 'fat', 'water_ml', 'mood', 'stress', 'note'];
    },

    csvCell(value) {
        const text = value === null || value === undefined ? '' : String(value);
        return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    },

    exportSettingsCsv() {
        try {
            const data = window.DB.getFitAllData();
            const columns = this.csvColumns();
            const lines = [columns.join(';')];
            for (const row of data.daily_logs || []) {
                lines.push(columns.map((column) => this.csvCell(row[column])).join(';'));
            }
            this.downloadFile(
                `aru-fit-care-daily-${this.todayKey()}.csv`,
                `\ufeff${lines.join('\r\n')}`,
                'text/csv;charset=utf-8'
            );
            this.toast(this.t('export_ok'), 'success');
        } catch (error) {
            console.error('FitCare: CSV export failed', error);
            this.toast(this.t('toast_error'), 'error');
        }
    },

    // ---------- import ----------
    readSettingsFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Read failed'));
            reader.readAsText(file);
        });
    },

    async importSettingsFile(file) {
        try {
            const text = await this.readSettingsFile(file);
            const trimmed = text.trim();
            if (!trimmed) throw new Error('Empty file');
            if (trimmed.startsWith('{')) {
                let data = null;
                try { data = JSON.parse(trimmed); } catch (error) { data = null; }
                if (!this.isFitBackup(data)) throw new Error('Unsupported JSON');
                this.openSettingsConfirm({
                    title: this.t('import_data'),
                    message: this.t('import_confirm'),
                    confirmLabel: this.t('import_data'),
                    onConfirm: () => this.applySettingsJson(data)
                });
                return;
            }
            const rows = this.parseSettingsCsv(text);
            if (rows.length < 2) throw new Error('No CSV rows');
            const records = this.csvRecords(rows);
            if (!records.length) throw new Error('No dated rows');
            for (const record of records) window.DB.saveFitDailyLog(record, false);
            window.DB.save();
            this.loadAll();
            this.render();
            this.toast(this.t('imported_ok'), 'success');
        } catch (error) {
            console.warn('FitCare: import failed', error);
            this.toast(this.t('import_error'), 'error');
        }
    },

    isFitBackup(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
        if (data.app === 'aru-fit-care') return true;
        return ['profile', 'daily_logs', 'plans', 'plan_days', 'workouts', 'meals',
            'protocols', 'health_logs', 'cycles', 'cycle_logs', 'intimacy_logs', 'chat_messages']
            .some((key) => key in data);
    },

    applySettingsJson(data) {
        try {
            window.DB.replaceFitData(data, true);
            this.state.view = 'settings';
            this.loadAll();
            this.render();
            this.toast(this.t('imported_ok'), 'success');
        } catch (error) {
            console.error('FitCare: JSON import failed', error);
            this.toast(this.t('import_error'), 'error');
        }
    },

    parseSettingsCsv(text) {
        const source = String(text || '').replace(/^\ufeff/, '');
        const semicolons = (source.match(/;/g) || []).length;
        const commas = (source.match(/,/g) || []).length;
        const tabs = (source.match(/\t/g) || []).length;
        const delimiter = tabs > semicolons && tabs > commas ? '\t' : (semicolons >= commas ? ';' : ',');
        const rows = [];
        let row = [];
        let field = '';
        let quoted = false;
        for (let index = 0; index < source.length; index++) {
            const char = source[index];
            if (quoted) {
                if (char === '"') {
                    if (source[index + 1] === '"') {
                        field += '"';
                        index++;
                    } else {
                        quoted = false;
                    }
                } else {
                    field += char;
                }
            } else if (char === '"') {
                quoted = true;
            } else if (char === delimiter) {
                row.push(field);
                field = '';
            } else if (char === '\n') {
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
            } else if (char !== '\r') {
                field += char;
            }
        }
        if (field !== '' || row.length) {
            row.push(field);
            rows.push(row);
        }
        return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ''));
    },

    normalizeCsvHeader(value) {
        return String(value || '')
            .replace(/\(.*?\)/g, '')
            .toLowerCase()
            .replace(/[\s_\-./%]+/g, '')
            .trim();
    },

    csvHeaderAliases() {
        return {
            log_date: ['date', 'logdate', 'day', 'дата', 'күні', 'куни'],
            weight: ['weight', 'weightkg', 'вес', 'салмак', 'салмақ', 'салмагы', 'салмағы'],
            body_fat: ['bodyfat', 'fatpct', 'fatpercent', 'жир', 'процентжира', 'денемайы'],
            muscle_mass: ['muscle', 'musclemass', 'мышцы', 'бұлшықет', 'булшыкет'],
            water_pct: ['water', 'waterpct', 'вода', 'су'],
            bone_mass: ['bone', 'bonemass', 'кости', 'сүйек', 'суйек'],
            visceral_fat: ['visceral', 'visceralfat', 'висцеральныйжир', 'ішмайы', 'ишмайы'],
            sleep_hours: ['sleep', 'sleephours', 'сон', 'ұйқы', 'уйкы'],
            steps: ['steps', 'шаги', 'қадамдар', 'кадамдар'],
            calories: ['calories', 'calorie', 'kcal', 'калории', 'калория'],
            protein: ['protein', 'белки', 'ақуыз', 'акуыз'],
            carbs: ['carbs', 'carbohydrates', 'углеводы', 'көмірсу', 'комирсу'],
            fat: ['fat', 'fats', 'dietaryfat', 'жиры'],
            water_ml: ['waterml', 'водамл'],
            mood: ['mood', 'настроение', 'көңілкүй', 'конилки'],
            stress: ['stress', 'стресс'],
            energy: ['energy', 'энергия'],
            note: ['note', 'notes', 'заметка', 'ескерту']
        };
    },

    csvRecords(rows) {
        const aliases = this.csvHeaderAliases();
        const lookup = new Map();
        for (const [field, names] of Object.entries(aliases)) {
            for (const name of names) lookup.set(name, field);
        }
        const header = rows[0].map((cell) => lookup.get(this.normalizeCsvHeader(cell)) || '');
        if (!header.includes('log_date')) throw new Error('No date column');
        const numericFields = ['weight', 'body_fat', 'muscle_mass', 'water_pct', 'bone_mass',
            'visceral_fat', 'sleep_hours', 'energy', 'steps', 'calories', 'protein',
            'carbs', 'fat', 'water_ml', 'mood', 'stress'];
        const records = [];
        for (const cells of rows.slice(1)) {
            const record = {};
            header.forEach((field, index) => {
                if (!field) return;
                const raw = cells[index];
                if (field === 'log_date') {
                    const date = this.parseSettingsDate(raw);
                    if (date) record.log_date = date;
                } else if (field === 'note') {
                    const note = String(raw === undefined ? '' : raw).trim();
                    if (note) record.note = note;
                } else if (numericFields.includes(field)) {
                    const number = this.parseSettingsNumber(raw);
                    if (number !== null) record[field] = number;
                }
            });
            if (record.log_date) records.push(record);
        }
        return records;
    },

    parseSettingsDate(value) {
        const text = String(value === null || value === undefined ? '' : value).trim();
        let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
        if (match) {
            return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
        }
        match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(text);
        if (match) {
            const first = Number(match[1]);
            const second = Number(match[2]);
            let day = first;
            let month = second;
            if (first > 12 && second <= 12) {
                day = first;
                month = second;
            } else if (second > 12 && first <= 12) {
                day = second;
                month = first;
            }
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            }
        }
        return '';
    },

    parseSettingsNumber(value) {
        const text = String(value === null || value === undefined ? '' : value)
            .replace(/\s/g, '')
            .replace(',', '.');
        if (!text) return null;
        const number = Number(text.replace(/[^0-9.+-]/g, ''));
        return Number.isFinite(number) ? number : null;
    },

    clearSettingsData() {
        try {
            window.DB.clearFitData();
            this.state.showPrivate = false;
            this.loadAll();
            this.render();
            this.toast(this.t('cleared_ok'), 'success');
        } catch (error) {
            console.error('FitCare: clear failed', error);
            this.toast(this.t('toast_error'), 'error');
        }
    }
});
