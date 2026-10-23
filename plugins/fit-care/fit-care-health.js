/*
---ARU-LAB.SPACE---ALMATY---2026---
Aru Fit & Care — health screen: protocols and doses, health events,
cycle tracking and the adult-only private section.
---chat.aru-lab.space---PWA---
*/
window.FitCarePlugin = window.FitCarePlugin || {};

Object.assign(window.FitCarePlugin, {
    renderHealth() {
        const container = document.getElementById('fit-view');
        if (!container) return;
        const today = this.todayKey();
        const range = this.state.range;
        const protocols = this.state.protocols || [];
        const doses = this.getDosesForDate(today);
        const takenDoses = doses.filter((dose) => dose.status === 'taken').length;
        const allHealth = window.DB.getFitHealthLogs(range.from, range.to) || [];
        const events = allHealth
            .filter((event) => event.type !== 'medication')
            .sort((a, b) => `${b.log_date} ${b.log_time || ''}`.localeCompare(`${a.log_date} ${a.log_time || ''}`));
        const cycle = this.cycleEnabled() ? this.getCycleInfo(today) : { tracking: false, hasData: false };
        const cycles = this.cycleEnabled() ? [...(this.state.cycles || [])].reverse() : [];
        const intimacyLogs = this.intimacyEnabled()
            ? (window.DB.getFitIntimacyLogs(range.from, range.to) || []).slice().sort((a, b) => b.log_date.localeCompare(a.log_date))
            : [];

        container.innerHTML = `
            <div class="fit-page">
                <div class="fit-page-head">
                    <div>
                        <p class="fit-kicker">Aru Fit &amp; Care</p>
                        <h2>${this.esc(this.t('health_title'))}</h2>
                        <p>${this.esc(this.t('health_sub'))}</p>
                    </div>
                    <div class="fit-row">
                        <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="add-med" data-date="${today}">
                            <i data-lucide="pill"></i>${this.esc(this.t('quick_med'))}
                        </button>
                        <button type="button" class="fit-btn fit-btn-primary" data-fit-action="add-health" data-date="${today}">
                            <i data-lucide="plus"></i>${this.esc(this.t('health_log_new'))}
                        </button>
                    </div>
                </div>
                <div class="fit-disclaimer-bar">
                    <i data-lucide="info"></i>
                    <span>${this.esc(this.t('health_disclaimer'))}</span>
                </div>
                <div class="fit-health-layout">
                    <div class="fit-stack">
                        <section class="fit-card">
                            <div class="fit-card-head">
                                <div>
                                    <h3>${this.esc(this.t('protocols'))}</h3>
                                    <p>${this.esc(this.t('protocols_sub'))}</p>
                                </div>
                                <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="health-new-protocol">
                                    <i data-lucide="plus"></i>${this.esc(this.t('new_protocol'))}
                                </button>
                            </div>
                            ${protocols.length
                                ? `<div class="fit-stack" style="gap:8px">${protocols.map((protocol) => this.renderProtocolCard(protocol)).join('')}</div>`
                                : `<div class="fit-empty" style="border:0"><i data-lucide="pill"></i><span>${this.esc(this.t('protocol_empty'))}</span></div>`}
                        </section>
                        <section class="fit-card">
                            <div class="fit-card-head">
                                <div>
                                    <h3>${this.esc(this.t('health_log_title'))}</h3>
                                    <p>${this.esc(this.t('health_log_sub'))}</p>
                                </div>
                                <span class="fit-badge">${events.length}</span>
                            </div>
                            ${events.length
                                ? `<div class="fit-stack" style="gap:6px">${this.pageSlice('healthPage', events, 10).map((event) => this.renderHealthEvent(event)).join('')}</div>${this.renderPager('healthPage', events.length, 10)}`
                                : `<div class="fit-empty" style="border:0"><i data-lucide="heart-pulse"></i><span>${this.esc(this.t('health_history_empty'))}</span></div>`}
                        </section>
                    </div>
                    <div class="fit-stack">
                        <section class="fit-card">
                            <div class="fit-card-head">
                                <div>
                                    <h3>${this.esc(this.t('today_doses'))}</h3>
                                    <p>${this.esc(this.formatDate(today))}</p>
                                </div>
                                <span class="fit-badge ${takenDoses === doses.length && doses.length ? 'fit-badge-green' : 'fit-badge-sky'}">${takenDoses}/${doses.length}</span>
                            </div>
                            ${doses.length
                                ? `<div class="fit-dose-list">${doses.map((dose) => this.renderDose(dose, today)).join('')}</div>`
                                : `<div class="fit-empty" style="border:0;padding:14px"><i data-lucide="pill"></i><span>${this.esc(this.t('no_doses'))}</span></div>`}
                            <p class="fit-muted" style="margin:10px 0 0;font-size:.64rem;line-height:1.45">${this.esc(this.t('rules_own'))}</p>
                        </section>
                        ${this.renderCycleSection(cycle, cycles)}
                        ${this.renderIntimacySection(intimacyLogs)}
                    </div>
                </div>
            </div>
        `;
    },

    renderProtocolCard(protocol) {
        const schedule = this.parseJson(protocol.schedule, {});
        const rules = this.parseJson(protocol.rules, {});
        const times = Array.isArray(schedule.times) ? schedule.times : [];
        const days = Array.isArray(schedule.days) ? schedule.days.map(Number) : [];
        const avoid = Array.isArray(rules.avoid_tags) ? rules.avoid_tags : [];
        const active = Number(protocol.active);
        const kind = this.t(`kind_${protocol.kind || 'medication'}`);
        const dayText = days.length
            ? days.map((day) => this.t(`weekday_${day}`)).join(' ')
            : this.t('applies_to_all_days');
        const chips = [];
        for (const time of times) chips.push(`<span>${this.esc(time)}</span>`);
        chips.push(`<span>${this.esc(dayText)}</span>`);
        if (Number(rules.min_delay_min) > 0) {
            chips.push(`<span class="rule" title="${this.esc(this.t('protocol_rule_delay_hint'))}">${this.esc(this.t('protocol_rule_delay'))}: ${this.esc(rules.min_delay_min)} ${this.esc(this.t('min'))}</span>`);
        }
        if (avoid.length) {
            chips.push(`<span class="rule">${this.esc(this.t('protocol_rule_avoid'))}: ${this.esc(avoid.join(', '))}</span>`);
        }
        return `
            <div class="fit-protocol ${active ? '' : 'is-inactive'}">
                <div class="fit-protocol-head">
                    <div style="min-width:0">
                        <h4>${this.esc(protocol.name || this.t('protocols'))}</h4>
                        <p>${this.esc(kind)}${protocol.dosage ? ` · ${this.esc(protocol.dosage)}` : ''}${protocol.notes ? ` · ${this.esc(protocol.notes)}` : ''}</p>
                    </div>
                    <div class="fit-protocol-actions">
                        <button type="button" class="fit-btn-icon" data-fit-action="health-edit-protocol" data-id="${protocol.id}" aria-label="${this.esc(this.t('edit'))}"><i data-lucide="pencil"></i></button>
                        <button type="button" class="fit-btn-icon" data-fit-action="health-delete-protocol" data-id="${protocol.id}" aria-label="${this.esc(this.t('delete'))}"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
                <div class="fit-schedule-chips">${chips.join('')}</div>
                ${rules.note ? `<p class="fit-muted" style="margin:0;font-size:.64rem">${this.esc(rules.note)}</p>` : ''}
                <div class="fit-row" style="justify-content:space-between">
                    <small class="fit-muted" style="font-size:.64rem">${this.esc(this.t(active ? 'protocol_active' : 'protocol_inactive'))}</small>
                    <button type="button" class="fit-switch ${active ? 'is-on' : ''}" data-fit-action="health-protocol-toggle" data-id="${protocol.id}" aria-pressed="${active ? 'true' : 'false'}" aria-label="${this.esc(this.t('protocol_active'))}"></button>
                </div>
            </div>
        `;
    },

    renderDose(dose, date) {
        const taken = dose.status === 'taken';
        const skipped = dose.status === 'skipped';
        const missed = !taken && !skipped && dose.time && dose.time < this.nowTime();
        const label = `${dose.protocol.name || ''}${dose.protocol.dosage ? ` · ${dose.protocol.dosage}` : ''}`;
        return `
            <div class="fit-dose ${missed ? 'is-missed' : ''}">
                <span class="fit-dose-time">${this.esc(dose.time || '—')}</span>
                <div class="fit-dose-name">
                    <b>${this.esc(dose.protocol.name || this.t('med_protocol'))}</b>
                    <small>${this.esc(dose.protocol.dosage || '')}${skipped ? ` · ${this.esc(this.t('med_skipped'))}` : ''}${missed ? ` · ${this.esc(this.t('missed'))}` : ''}</small>
                </div>
                <button type="button" class="fit-dose-check ${taken ? 'is-taken' : ''}"
                    data-fit-action="mark-dose" data-date="${date}" data-taken="${taken ? '1' : '0'}"
                    data-log-id="${dose.log ? dose.log.id : ''}" data-protocol="${dose.protocol.id}"
                    data-name="${this.esc(dose.protocol.name || '')}" data-time="${this.esc(dose.time || '')}"
                    aria-label="${this.esc(label)}" aria-pressed="${taken ? 'true' : 'false'}">
                    <i data-lucide="${taken ? 'check' : 'circle'}"></i>
                </button>
            </div>
        `;
    },

    renderHealthEvent(event) {
        const value = (event.value !== null && event.value !== undefined)
            ? `${this.fmt(event.value, 2)}${event.value2 !== null && event.value2 !== undefined ? `/${this.fmt(event.value2, 2)}` : ''}${event.unit ? ` ${event.unit}` : ''}`
            : '';
        const tags = this.parseJson(event.tags, []);
        const type = this.t(`health_type_${event.type}`) || event.type;
        return `
            <div class="fit-dose" style="align-items:flex-start">
                <span class="fit-dose-time">${this.esc(event.log_time || '—')}</span>
                <div class="fit-dose-name">
                    <b>${this.esc(event.name || type)}</b>
                    <small>${this.esc(this.formatShortDate(event.log_date))} · ${this.esc(type)}${value ? ` · ${this.esc(value)}` : ''}</small>
                    ${tags.length ? `<div class="fit-schedule-chips" style="margin-top:4px">${tags.map((tag) => `<span>${this.esc(tag)}</span>`).join('')}</div>` : ''}
                    ${event.note ? `<small style="display:block;margin-top:3px">${this.esc(event.note)}</small>` : ''}
                </div>
                <div class="fit-row" style="gap:1px;flex:none">
                    <button type="button" class="fit-btn-icon" data-fit-action="health-edit-event" data-id="${event.id}" data-date="${event.log_date}" aria-label="${this.esc(this.t('edit'))}"><i data-lucide="pencil"></i></button>
                    <button type="button" class="fit-btn-icon" data-fit-action="delete-health" data-id="${event.id}" aria-label="${this.esc(this.t('delete'))}"><i data-lucide="trash-2"></i></button>
                </div>
            </div>
        `;
    },

    renderCycleSection(cycle, cycles) {
        if (!cycle.tracking) return '';
        if (!cycle.hasData) {
            return `
                <section class="fit-card">
                    <div class="fit-card-head">
                        <div><h3>${this.esc(this.t('cycle_title'))}</h3><p>${this.esc(this.t('cycle_sub'))}</p></div>
                        <span class="fit-badge fit-badge-accent">${this.esc(this.t('cycle_day'))}</span>
                    </div>
                    <div class="fit-empty" style="border:0">
                        <i data-lucide="droplet"></i>
                        <strong>${this.esc(this.t('cycle_no_history'))}</strong>
                        <span>${this.esc(this.t('cycle_prediction_note'))}</span>
                        <button type="button" class="fit-btn fit-btn-primary fit-btn-xs" data-fit-action="add-cycle" data-date="${this.todayKey()}">${this.esc(this.t('cycle_start'))}</button>
                    </div>
                </section>
            `;
        }
        const lengths = (this.state.cycles || [])
            .map((item) => Number(item.cycle_length))
            .filter((value) => Number.isFinite(value) && value >= 15 && value <= 60);
        const irregular = lengths.length >= 2 && (Math.max(...lengths) - Math.min(...lengths)) > 4;
        const currentPhase = cycle.phase === 'fertile' ? 'ovulation' : cycle.phase;
        const periodLength = cycle.periodLength;
        const ovulationDay = cycle.ovulationDay;
        const phaseRanges = {
            menstrual: `1–${periodLength}`,
            follicular: `${periodLength + 1}–${Math.max(periodLength + 1, cycle.fertileStart - 1)}`,
            ovulation: `${ovulationDay}`,
            luteal: `${Math.min(ovulationDay + 1, cycle.avg)}–${cycle.avg}`
        };
        const phases = ['menstrual', 'follicular', 'ovulation', 'luteal'].map((phase) => `
            <div class="fit-cycle-phase ${currentPhase === phase ? 'is-current' : ''}">
                <b>${this.esc(this.t(`cycle_phase_${phase}`))}</b>
                <span>${this.esc(phaseRanges[phase])}</span>
            </div>
        `).join('');
        const history = this.pageSlice('cyclesPage', cycles, 5).map((item) => `
            <div class="fit-cycle-history-row">
                <b>${this.esc(this.formatShortDate(item.start_date))}</b>
                <span title="${this.esc(this.t('cycle_avg'))} / ${this.esc(this.t('period_length'))}">
                    ${item.cycle_length ? `${this.esc(item.cycle_length)} / ${this.esc(item.period_length || '—')}` : this.esc(this.t('cycle_regular'))}
                </span>
                <button type="button" class="fit-btn-icon" data-fit-action="health-cycle-delete" data-id="${item.id}" aria-label="${this.esc(this.t('delete'))}" style="width:22px;height:22px"><i data-lucide="x"></i></button>
            </div>
        `).join('');
        return `
            <section class="fit-card">
                <div class="fit-card-head">
                    <div><h3>${this.esc(this.t('cycle_title'))}</h3><p>${this.esc(this.t('cycle_sub'))}</p></div>
                    <span class="fit-badge fit-badge-accent">${this.esc(this.t(`cycle_phase_${cycle.phase}`))}</span>
                </div>
                <div class="fit-cycle-mini" style="margin-bottom:12px">
                    <div class="fit-cycle-ring" style="--pct:${Math.min(100, (cycle.day / cycle.avg) * 100).toFixed(1)}">
                        <div class="fit-cycle-ring-inner"><b>${cycle.day}</b><span>${this.esc(this.t('cycle_day'))}</span></div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:5px;min-width:0">
                        <b style="font-size:.84rem">${this.esc(this.t('cycle_next_period'))}: ${this.esc(this.formatShortDate(cycle.nextPeriod))}</b>
                        <span class="fit-muted" style="font-size:.68rem">${this.esc(this.t('cycle_fertile'))}: ${this.esc(this.formatShortDate(this.addDays(cycle.cycleStart, cycle.fertileStart - 1)))} – ${this.esc(this.formatShortDate(this.addDays(cycle.cycleStart, cycle.fertileEnd - 1)))}</span>
                        <span class="fit-muted" style="font-size:.68rem">${this.esc(this.t('cycle_avg'))}: ${cycle.avg} · ${this.esc(this.t(irregular ? 'cycle_irregular' : 'cycle_regular'))}</span>
                    </div>
                </div>
                <div class="fit-cycle-phases">${phases}</div>
                <div class="fit-data-actions" style="margin-top:12px">
                    <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="cycle-start" data-date="${this.todayKey()}"><i data-lucide="play"></i>${this.esc(this.t('cycle_start'))}</button>
                    <button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="cycle-end" data-date="${this.todayKey()}"><i data-lucide="square"></i>${this.esc(this.t('cycle_end'))}</button>
                    <button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="add-cycle" data-date="${this.todayKey()}"><i data-lucide="droplet"></i>${this.esc(this.t('cycle_log_title'))}</button>
                </div>
                ${cycles.length ? `<div class="fit-section-title" style="margin-top:14px"><i data-lucide="history"></i>${this.esc(this.t('cycle_history'))}</div><div class="fit-cycle-history">${history}</div>${this.renderPager('cyclesPage', cycles.length, 5)}` : ''}
                <p class="fit-muted" style="margin:11px 0 0;font-size:.63rem;line-height:1.45">${this.esc(this.t('cycle_prediction_note'))}</p>
            </section>
        `;
    },

    renderIntimacySection(allLogs) {
        if (!this.intimacyEnabled()) return '';
        const revealed = !!this.state.showPrivate;
        const head = `
            <div class="fit-card-head">
                <div><h3>${this.esc(this.t('intimacy_title'))}</h3><p>${this.esc(this.t('intimacy_sub'))}</p></div>
                <button type="button" class="fit-btn fit-btn-ghost fit-btn-xs" data-fit-action="health-reveal-private">
                    <i data-lucide="${revealed ? 'eye-off' : 'eye'}"></i>${this.esc(this.t(revealed ? 'intimacy_hide' : 'intimacy_reveal'))}
                </button>
            </div>
        `;
        if (!revealed) {
            return `
                <section class="fit-card">
                    ${head}
                    <div class="fit-privacy-lock">
                        <i data-lucide="lock"></i>
                        <strong>${this.esc(this.t('intimacy_title'))}</strong>
                        <span>${this.esc(this.t('intimacy_private_note'))}</span>
                        <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="health-reveal-private">${this.esc(this.t('intimacy_reveal'))}</button>
                    </div>
                </section>
            `;
        }
        const monthKey = this.todayKey().slice(0, 7);
        const logs = (allLogs || [])
            .filter((entry) => String(entry.log_date || '').slice(0, 7) === monthKey)
            .sort((a, b) => `${b.log_date} ${b.log_time || ''}`.localeCompare(`${a.log_date} ${a.log_time || ''}`));
        return `
            <section class="fit-card">
                ${head}
                <div class="fit-row" style="justify-content:space-between;margin-bottom:9px">
                    <button type="button" class="fit-btn fit-btn-soft fit-btn-xs" data-fit-action="add-intimacy" data-date="${this.todayKey()}"><i data-lucide="plus"></i>${this.esc(this.t('intimacy_add'))}</button>
                    <span class="fit-muted" style="font-size:.64rem">${this.esc(this.t('intimacy_month_hint'))}</span>
                </div>
                ${logs.length ? `
                    <div class="fit-stack" style="gap:5px">
                        ${this.pageSlice('intimacyPage', logs, 10).map((entry) => `
                            <div class="fit-dose">
                                <span class="fit-dose-time">${this.esc(entry.log_time || '—')}</span>
                                <div class="fit-dose-name">
                                    <b class="fit-row" style="gap:5px">
                                        <span class="fit-day-lock ${entry.protection ? '' : 'is-red'}"><i data-lucide="lock"></i></span>
                                        ${this.esc(this.formatShortDate(entry.log_date))} · ${this.esc(this.t(entry.protection ? `protection_${entry.protection}` : 'protection_none'))}
                                    </b>
                                    ${entry.note ? `<small>${this.esc(entry.note)}</small>` : ''}
                                </div>
                                <div class="fit-row" style="gap:1px;flex:none">
                                    <button type="button" class="fit-btn-icon" data-fit-action="edit-intimacy" data-id="${entry.id}" aria-label="${this.esc(this.t('edit'))}"><i data-lucide="pencil"></i></button>
                                    <button type="button" class="fit-btn-icon" data-fit-action="health-intimacy-delete" data-id="${entry.id}" aria-label="${this.esc(this.t('delete'))}"><i data-lucide="trash-2"></i></button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    ${this.renderPager('intimacyPage', logs.length, 10)}
                ` : `<div class="fit-empty" style="border:0;padding:14px"><i data-lucide="lock"></i><span>${this.esc(this.t('intimacy_empty'))}</span></div>`}
                <div class="fit-privacy-note" style="margin-top:10px"><i data-lucide="shield-check"></i><span>${this.esc(this.t('intimacy_private_note'))}</span></div>
            </section>
        `;
    },

    openProtocolModal(protocol) {
        const existing = protocol || null;
        const schedule = existing ? this.parseJson(existing.schedule, {}) : {};
        const rules = existing ? this.parseJson(existing.rules, {}) : {};
        const times = Array.isArray(schedule.times) ? schedule.times.join(', ') : '';
        const days = Array.isArray(schedule.days) ? schedule.days.join(', ') : '';
        const avoid = Array.isArray(rules.avoid_tags) ? rules.avoid_tags.join(', ') : '';
        const body = `
            <form id="fit-form-protocol" data-fit-form="protocol" data-id="${existing ? existing.id : ''}" class="fit-form-grid">
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('name'))}</span>
                    <input class="fit-input" name="name" required maxlength="120" value="${this.esc(existing ? existing.name : '')}" placeholder="${this.esc(this.t('protocols'))}">
                </label>
                <label class="fit-field"><span>${this.esc(this.t('protocol_kind'))}</span>
                    <select class="fit-select" name="kind">
                        ${['medication', 'supplement', 'condition'].map((kind) => `<option value="${kind}" ${existing && existing.kind === kind ? 'selected' : ''}>${this.esc(this.t(`kind_${kind}`))}</option>`).join('')}
                    </select>
                </label>
                <label class="fit-field"><span>${this.esc(this.t('protocol_dosage'))}</span>
                    <input class="fit-input" name="dosage" maxlength="80" value="${this.esc(existing ? existing.dosage : '')}" placeholder="1 tab, 500 mg…">
                </label>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('protocol_times'))} <small>${this.esc(this.t('protocol_times_hint'))}</small></span>
                    <input class="fit-input" name="times" value="${this.esc(times)}" placeholder="08:00, 20:00">
                </label>
                <label class="fit-field fit-span-2"><span>${this.esc(this.t('protocol_days'))} <small>${this.esc(this.t('protocol_days_hint'))}</small></span>
                    <input class="fit-input" name="days" value="${this.esc(days)}" placeholder="1, 2, 3, 4, 5">
                </label>
                <div class="fit-span-2">
                    <div class="fit-section-title"><i data-lucide="shield-check"></i>${this.esc(this.t('protocol_rules'))}</div>
                    <div class="fit-form-grid">
                        <label class="fit-field"><span>${this.esc(this.t('protocol_rule_delay'))}</span>
                            <input class="fit-input" name="delay" type="number" min="0" step="1" value="${this.esc(rules.min_delay_min || '')}" placeholder="30">
                            <small>${this.esc(this.t('protocol_rule_delay_hint'))}</small>
                        </label>
                        <label class="fit-field"><span>${this.esc(this.t('protocol_rule_window'))}</span>
                            <input class="fit-input" name="window" type="number" min="0" step="10" value="${this.esc(rules.tag_window_min || '')}" placeholder="240">
                            <small>${this.esc(this.t('protocol_rule_window_hint'))}</small>
                        </label>
                        <label class="fit-field fit-span-2"><span>${this.esc(this.t('protocol_rule_avoid'))}</span>
                            <input class="fit-input" name="avoid" value="${this.esc(avoid)}" placeholder="${this.esc(this.t('protocol_rule_avoid_hint'))}">
                        </label>
                        <label class="fit-field fit-span-2"><span>${this.esc(this.t('protocol_rule_note'))} <small>${this.esc(this.t('optional'))}</small></span>
                            <input class="fit-input" name="rule_note" maxlength="160" value="${this.esc(rules.note || '')}">
                        </label>
                    </div>
                </div>
                <label class="fit-field"><span>${this.esc(this.t('status'))}</span>
                    <select class="fit-select" name="active">
                        <option value="1" ${!existing || Number(existing.active) ? 'selected' : ''}>${this.esc(this.t('protocol_active'))}</option>
                        <option value="0" ${existing && !Number(existing.active) ? 'selected' : ''}>${this.esc(this.t('protocol_inactive'))}</option>
                    </select>
                </label>
                <label class="fit-field"><span>${this.esc(this.t('note'))} <small>${this.esc(this.t('optional'))}</small></span>
                    <input class="fit-input" name="notes" maxlength="160" value="${this.esc(existing ? existing.notes : '')}">
                </label>
                <p class="fit-muted fit-span-2" style="margin:0;font-size:.65rem">${this.esc(this.t('rules_own'))}</p>
            </form>
        `;
        this.openModal({
            title: this.t('modal_protocol'),
            subtitle: this.t('protocols_sub'),
            wide: true,
            body,
            footer: `
                <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                <button type="button" class="fit-btn fit-btn-primary" data-fit-action="submit-form" data-form="fit-form-protocol">${this.esc(this.t('save'))}</button>
            `
        });
    },

    saveProtocolForm(form) {
        const name = this.fieldValue(form, 'name');
        if (!name) return;
        const times = this.fieldValue(form, 'times')
            .split(/[,\s]+/)
            .map((value) => {
                const match = /^(\d{1,2}):(\d{2})$/.exec(value);
                return match ? `${String(Number(match[1])).padStart(2, '0')}:${match[2]}` : '';
            })
            .filter(Boolean);
        const days = this.fieldValue(form, 'days')
            .split(/[,\s]+/)
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7)
            .filter((value, index, list) => list.indexOf(value) === index)
            .sort((a, b) => a - b);
        const delay = this.fieldNumber(form, 'delay');
        const windowMin = this.fieldNumber(form, 'window');
        window.DB.saveFitProtocol({
            id: Number(form.dataset.id) || null,
            name,
            kind: this.fieldValue(form, 'kind') || 'medication',
            dosage: this.fieldValue(form, 'dosage'),
            schedule: { times, days },
            rules: {
                min_delay_min: delay && delay > 0 ? delay : 0,
                tag_window_min: windowMin && windowMin > 0 ? windowMin : 240,
                avoid_tags: this.splitList(this.fieldValue(form, 'avoid')),
                note: this.fieldValue(form, 'rule_note')
            },
            notes: this.fieldValue(form, 'notes'),
            active: this.fieldValue(form, 'active') === '0' ? 0 : 1
        });
        this.closeModal();
        this.refresh();
        this.toast(this.t('protocol_saved'), 'success');
    },

    handleHealthForm(name, form) {
        if (name === 'protocol') {
            this.saveProtocolForm(form);
            return true;
        }
        return false;
    },

    handleHealthAction(action, el) {
        switch (action) {
            case 'health-new-protocol':
                this.openProtocolModal(null);
                return true;
            case 'health-edit-protocol': {
                const protocol = window.DB.getFitProtocol(Number(el.dataset.id));
                if (protocol) this.openProtocolModal(protocol);
                return true;
            }
            case 'health-protocol-toggle': {
                const protocol = window.DB.getFitProtocol(Number(el.dataset.id));
                if (!protocol) return true;
                window.DB.saveFitProtocol(Object.assign({}, protocol, { active: Number(protocol.active) ? 0 : 1 }));
                this.refresh();
                this.toast(this.t('protocol_saved'), 'success');
                return true;
            }
            case 'health-delete-protocol': {
                const id = Number(el.dataset.id);
                if (!id) return true;
                this.openConfirm(this.t('delete'), this.t('protocol_delete_confirm'), () => {
                    window.DB.deleteFitProtocol(id);
                    this.refresh();
                    this.toast(this.t('protocol_deleted'), 'success');
                });
                return true;
            }
            case 'health-edit-event': {
                const date = el.dataset.date;
                const id = Number(el.dataset.id);
                const log = (window.DB.getFitHealthLogs(date, date) || []).find((entry) => Number(entry.id) === id);
                if (log) this.openHealthModal(log.log_date, log.type, log);
                return true;
            }
            case 'health-cycle-delete': {
                const id = Number(el.dataset.id);
                if (!id) return true;
                this.openConfirm(this.t('delete'), this.t('cycle_delete_confirm'), () => {
                    window.DB.deleteFitCycle(id);
                    this.refresh();
                    this.toast(this.t('toast_deleted'), 'success');
                });
                return true;
            }
            case 'health-reveal-private':
                if (!this.intimacyEnabled()) return true;
                if (this.state.showPrivate) {
                    this.state.showPrivate = false;
                    this.render();
                    return true;
                }
                this.openModal({
                    title: this.t('intimacy_reveal'),
                    body: `<p style="margin:0;color:var(--fit-subtle);font-size:.8rem;line-height:1.55">${this.esc(this.t('intimacy_reveal_confirm'))}</p>`,
                    footer: `
                        <button type="button" class="fit-btn fit-btn-ghost" data-fit-action="close-modal">${this.esc(this.t('cancel'))}</button>
                        <button type="button" class="fit-btn fit-btn-primary" data-fit-action="health-private-accept">${this.esc(this.t('intimacy_reveal'))}</button>
                    `
                });
                return true;
            case 'health-private-accept':
                this.state.showPrivate = true;
                this.closeModal();
                this.render();
                return true;
            case 'health-intimacy-delete': {
                const id = Number(el.dataset.id);
                if (!id) return true;
                this.openConfirm(this.t('delete'), this.t('intimacy_delete_confirm'), () => {
                    window.DB.deleteFitIntimacyLog(id);
                    this.refresh();
                    this.toast(this.t('toast_deleted'), 'success');
                });
                return true;
            }
            default:
                return false;
        }
    }
});
