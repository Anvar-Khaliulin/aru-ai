/*
---ARU-LAB.SPACE---ALMATY---2026---
Aru Skills Plugin — a project chat driven by a relay of skills.
Classic script: window.SkillsPlugin must exist before the plugin tab opens,
so this file is preloaded from index.html and re-executed when skills.html
is injected into the plugin viewport (the <script> tag at its bottom).
---chat.aru-lab.space---PWA---
*/

window.SkillsPlugin = {
    state: {
        projects: [],
        skills: [],
        activeProjectId: null,
        items: [],               // project materials (files & links)
        steps: [],               // relay steps of the open project
        messages: [],            // chat thread of the open project
        runStepsCache: {},       // runId -> run step rows
        expandedRuns: {},        // message id -> relay block unfolded
        editingSkillId: null,
        modalKind: null,         // 'projects' | 'library' | 'skill'
        drafts: {},              // projectId -> unsent composer text
        attachments: [],         // { kind: 'file'|'link', name, content } of the next message
        searchOn: false,
        railOpen: false,
        isRunning: false,
        runError: '',
        liveRun: null,           // { msgId, runId, total }
        lastArtifactId: null,
        stickToBottom: true
    },
    MAX_ATTACH: 10,
    _dbReady: false,
    _llmMod: null,
    _filesMod: null,
    _searchMod: null,
    _fileTarget: 'composer',

    init() {
        const root = document.getElementById('skills-plugin-root');
        if (!root) return; // Preload pass: no DOM yet, init runs again from the injected skills.html

        if (!(window.DB && window.DB.db)) {
            window.addEventListener('aru-db-initialized', () => this.init(), { once: true });
            return;
        }
        this._dbReady = true;

        this.bindGlobals();
        this.applyI18n();
        this.state.railOpen = window.innerWidth > 900;
        const saved = parseInt(localStorage.getItem('aru_skills_project') || '', 10);
        this.refresh(saved || null);
        if (window.lucide) lucide.createIcons();
    },

    // The script re-executes on every injection of skills.html, so window-level
    // listeners are bound once and delegate to whatever instance is current.
    bindGlobals() {
        if (!window._skillsGlobalsBound) {
            window._skillsGlobalsBound = true;
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                const modal = document.getElementById('skills-modal');
                if (modal && !modal.classList.contains('hidden') && window.SkillsPlugin) {
                    window.SkillsPlugin.closeModal();
                }
            });
            window.addEventListener('resize', () => {
                if (window.SkillsPlugin) window.SkillsPlugin.applyRailState();
            });
        }

        const thread = document.getElementById('skills-thread');
        if (thread && !thread._skillsBound) {
            thread._skillsBound = true;
            thread.addEventListener('scroll', () => {
                this.state.stickToBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 90;
            });
        }
    },

    getT(key, fallback) {
        const raw = window.PluginManager ? window.PluginManager.getTranslation(key) : key;
        return (raw && raw !== key) ? raw : (fallback || key);
    },

    toast(key, icon, fallback) {
        if (window.UI && UI.showToast) UI.showToast(this.getT(key, fallback), icon || 'check');
    },

    esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    applyI18n() {
        const root = document.getElementById('skills-plugin-root');
        if (!root) return;
        root.querySelectorAll('[data-skills-i18n]').forEach(el => {
            const key = el.getAttribute('data-skills-i18n');
            el.innerText = this.getT(key, el.innerText.trim() || undefined);
        });
        root.querySelectorAll('[data-skills-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-skills-i18n-title');
            el.title = this.getT(key, el.title || undefined);
        });
    },

    // ---------- data ----------

    refresh(preferredId) {
        this.state.projects = window.DB.getSkillProjects();
        this.state.skills = window.DB.getSkills();
        if (preferredId) this.state.activeProjectId = preferredId;
        if (!this.state.projects.some(p => p.id === this.state.activeProjectId)) {
            this.state.activeProjectId = this.state.projects.length > 0 ? this.state.projects[0].id : null;
        }
        this.loadProject();
        this.render();
    },

    loadProject() {
        const p = this.activeProject();
        if (p) {
            this.state.items = window.DB.getSkillProjectItems(p.id);
            this.state.steps = window.DB.getPipelineSteps(p.id);
            this.state.messages = window.DB.getSkillProjectMessages(p.id);
            localStorage.setItem('aru_skills_project', String(p.id));
        } else {
            this.state.items = [];
            this.state.steps = [];
            this.state.messages = [];
        }
        this.state.expandedRuns = {};
        this.state.runStepsCache = {};

        // A reload kills the in-flight relay, so a "running" block restored from
        // the DB would spin forever — mark it as interrupted right away.
        this.state.messages.forEach(m => {
            if (m.kind !== 'run') return;
            const meta = this.parseMeta(m);
            if (meta.status === 'running') {
                this.setMsgMeta(m.id, { status: 'error', error: this.getT('skills_run_interrupted', 'Interrupted by page reload'), note: '' });
            }
        });
    },

    activeProject() {
        return this.state.projects.find(p => p.id === this.state.activeProjectId) || null;
    },

    parseMeta(m) {
        if (!m || !m.meta) return {};
        if (typeof m.meta === 'object') return m.meta;
        try { return JSON.parse(m.meta) || {}; } catch (e) { return {}; }
    },

    // created_at comes from SQLite CURRENT_TIMESTAMP: UTC without a zone marker
    fmtTime(m, meta) {
        let d = null;
        if (meta && meta.ts) d = new Date(meta.ts);
        else if (m && m.created_at) d = new Date(String(m.created_at) + 'Z');
        if (!d || isNaN(d.getTime())) return '';
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },

    // ---------- render ----------

    render() {
        const root = document.getElementById('skills-plugin-root');
        if (!root) return;
        this.renderHeader();
        this.renderThread();
        this.renderRail();
        this.syncComposer();
        this.applyRailState();
        this.hydrateRich(document.getElementById('skills-thread'));
        if (window.lucide) lucide.createIcons();
    },

    renderHeader() {
        const titleEl = document.getElementById('skills-project-title');
        const subEl = document.getElementById('skills-project-sub');
        if (!titleEl || !subEl) return;
        const p = this.activeProject();
        if (p) {
            titleEl.innerText = p.title;
            const active = this.state.steps.filter(s => s.enabled).length;
            subEl.innerText = `${active}/${this.state.steps.length} · ctx ${this.fmtTokens(p.context_limit)}`;
        } else {
            titleEl.innerText = this.getT('plugin_skills_name', 'Aru Skills');
            subEl.innerText = this.getT('plugin_skills_desc', 'Build skills and agent relays');
        }
    },

    renderThread() {
        const thread = document.getElementById('skills-thread');
        if (!thread) return;
        const p = this.activeProject();
        if (!p || this.state.messages.length === 0) {
            thread.innerHTML = this.renderThreadEmpty(p);
        } else {
            thread.innerHTML = `<div class="skills-thread-inner">${this.state.messages.map(m => this.renderMsg(m)).join('')}</div>`;
        }
        this.scrollThreadToBottom();
    },

    scrollThreadToBottom() {
        const thread = document.getElementById('skills-thread');
        if (!thread || !this.state.stickToBottom) return;
        thread.scrollTop = thread.scrollHeight;
    },

    renderThreadEmpty(p) {
        let cta = '';
        if (!p) {
            cta = `<button type="button" class="btn-skills btn-skills-primary" onclick="SkillsPlugin.addProject()">
                <i data-lucide="plus" class="w-4 h-4"></i> ${this.esc(this.getT('skills_new_project', 'New Project'))}
            </button>`;
        } else if (this.state.skills.length === 0) {
            cta = `<button type="button" class="btn-skills btn-skills-primary" onclick="SkillsPlugin.openLibraryModal()">
                <i data-lucide="plus" class="w-4 h-4"></i> ${this.esc(this.getT('skills_new_skill', 'New Skill'))}
            </button>`;
        } else if (this.state.steps.length === 0) {
            cta = `<button type="button" class="btn-skills btn-skills-primary" onclick="SkillsPlugin.toggleRail(true)">
                <i data-lucide="plus" class="w-4 h-4"></i> ${this.esc(this.getT('skills_open_relay', 'Build the relay'))}
            </button>`;
        }
        return `
        <div class="skills-thread-empty">
            <div class="skills-logo skills-logo-lg"><i data-lucide="blocks" class="w-7 h-7"></i></div>
            <h3>${this.esc(this.getT('plugin_skills_name', 'Aru Skills'))}</h3>
            <p>${this.esc(this.getT('skills_thread_empty_hint', 'Describe a task — the skills of the relay pass it along and the last one answers.'))}</p>
            ${cta}
        </div>`;
    },

    renderMsg(m) {
        return `<div class="skills-msg skills-msg-${this.esc(m.kind)}" id="skills-msg-${m.id}">${this.renderMsgInner(m)}</div>`;
    },

    renderMsgInner(m) {
        const meta = this.parseMeta(m);
        if (m.kind === 'user') return this.renderUserMsg(m, meta);
        if (m.kind === 'run') return this.renderRunMsg(m, meta);
        return this.renderAnswerMsg(m, meta);
    },

    // During a run only the touched message is patched: a full re-render would
    // kill the composer caret and the thread scroll position.
    updateMsg(id) {
        const el = document.getElementById('skills-msg-' + id);
        const m = this.state.messages.find(x => x.id === id);
        if (!el || !m) return;
        el.innerHTML = this.renderMsgInner(m);
        this.hydrateRich(el);
        if (window.lucide) lucide.createIcons();
    },

    setMsgMeta(id, patch) {
        const m = this.state.messages.find(x => x.id === id);
        if (!m) return;
        const meta = Object.assign(this.parseMeta(m), patch);
        m.meta = JSON.stringify(meta);
        window.DB.updateSkillProjectMessage(id, { meta });
    },

    renderUserMsg(m, meta) {
        const chips = [];
        (meta.files || []).forEach(f => chips.push(`<span class="skills-msg-chip"><i data-lucide="file-text" class="w-3 h-3"></i> ${this.esc(f)}</span>`));
        (meta.links || []).forEach(l => chips.push(`<span class="skills-msg-chip"><i data-lucide="link" class="w-3 h-3"></i> ${this.esc(l)}</span>`));
        if (meta.search) chips.push(`<span class="skills-msg-chip"><i data-lucide="globe" class="w-3 h-3"></i> ${this.esc(this.getT('skills_web_search', 'Web search'))}</span>`);
        return `
        <div class="skills-bubble">
            <div class="skills-msg-text">${this.esc(m.content)}</div>
            ${chips.length ? `<div class="skills-msg-chips">${chips.join('')}</div>` : ''}
            <div class="skills-msg-time">${this.esc(this.fmtTime(m, meta))}</div>
        </div>`;
    },

    // The run block mirrors Aru's "Thinking" line: grey, collapsed by default,
    // expandable into per-step input/output.
    renderRunMsg(m, meta) {
        const status = meta.status || 'running';
        const running = status === 'running';
        const expanded = !!this.state.expandedRuns[m.id];
        const total = meta.total || 0;
        const idx = meta.index || 0;

        let head;
        if (meta.note) head = this.esc(meta.note);
        else if (total > 0 && idx > 0 && meta.title) head = `${idx}/${total} · ${this.esc(meta.title)}`;
        else if (total > 0) head = this.esc(this.getT('skills_relay_block', 'Relay')) + ' · ' + total;
        else head = this.esc(this.getT('skills_relay_block', 'Relay'));

        const badge = running
            ? `<span class="skills-run-badge">${this.esc(this.getT('skills_status_running', 'Running'))}</span>`
            : (status === 'error'
                ? `<span class="skills-run-badge err">${this.esc(this.getT('skills_status_error', 'Error'))}</span>`
                : `<span class="skills-run-badge ok">${this.esc(this.getT('skills_status_done', 'Done'))}</span>`);

        const steps = expanded ? this.renderRunSteps(this.runStepsFor(meta.runId)) : '';
        const err = (status === 'error' && meta.error) ? `<div class="skills-run-step-error">${this.esc(meta.error)}</div>` : '';

        return `
        <div class="skills-run-block${running ? ' is-running' : ''}">
            <button type="button" class="skills-run-head" onclick="SkillsPlugin.toggleRunMsg(${m.id})">
                <i data-lucide="${expanded ? 'chevron-down' : 'chevron-right'}" class="w-4 h-4 shrink-0"></i>
                <i data-lucide="${running ? 'loader' : 'workflow'}" class="w-4 h-4 shrink-0${running ? ' animate-spin' : ''}"></i>
                <span class="skills-run-head-text">${head}</span>
                ${badge}
                <span class="skills-msg-time">${this.esc(this.fmtTime(m, meta))}</span>
            </button>
            ${expanded ? `<div class="skills-run-body">${steps}${err}</div>` : ''}
        </div>`;
    },

    runStepsFor(runId) {
        if (!runId) return [];
        if (!this.state.runStepsCache[runId]) {
            this.state.runStepsCache[runId] = window.DB.getSkillRunSteps(runId);
        }
        return this.state.runStepsCache[runId];
    },

    toggleRunMsg(id) {
        this.state.expandedRuns[id] = !this.state.expandedRuns[id];
        this.updateMsg(id);
    },

    renderRunSteps(steps) {
        if (!steps || steps.length === 0) return '';
        return steps.map((s, i) => `
        <div class="skills-run-step">
            <div class="skills-run-step-head">
                <span class="skills-step-num">${i + 1}</span>
                <span class="skills-run-step-title">${this.esc(s.skill_title || '—')}</span>
                <span class="skills-run-step-meta">${this.esc(s.provider || '')}${s.model ? ' · ' + this.esc(s.model) : ''}</span>
                ${s.truncated ? `<span class="skills-run-badge warn" title="${this.esc(this.getT('skills_answer_truncated', 'The answer hit the output limit and may be incomplete — raise "Max output" in the skill settings.'))}">${this.esc(this.getT('skills_badge_truncated', 'cut off'))}</span>` : ''}
                <span class="skills-run-badge ${s.status === 'done' ? 'ok' : (s.status === 'error' ? 'err' : '')}">${this.esc(this.getT('skills_status_' + s.status, s.status || 'pending'))}</span>
            </div>
            ${s.input_text ? `
            <details class="skills-io">
                <summary>${this.esc(this.getT('skills_step_input', 'Input'))}</summary>
                <pre>${this.esc(s.input_text)}</pre>
            </details>` : ''}
            ${s.output_text ? `
            <details class="skills-io">
                <summary>${this.esc(this.getT('skills_step_output', 'Output'))}</summary>
                <div class="skills-io-body">${this.renderRich(s.output_text)}</div>
            </details>` : ''}
            ${s.error ? `<div class="skills-run-step-error">${this.esc(s.error)}</div>` : ''}
        </div>`).join('');
    },

    renderAnswerMsg(m, meta) {
        const label = meta.fromFinal
            ? this.getT('skills_answer_by_final', 'final step')
            : this.getT('skills_answer_by_step', 'last active step');
        const warn = meta.truncated ? `
            <div class="skills-warn">
                <i data-lucide="scissors" class="w-3.5 h-3.5"></i>
                <span>${this.esc(this.getT('skills_answer_truncated', 'The answer hit the output limit and may be incomplete — raise "Max output" in the skill settings.'))}</span>
            </div>` : '';
        const arts = (meta.artifacts || [])
            .map(id => window.DB.getSkillArtifact(id))
            .filter(Boolean)
            .map(a => this.renderArtifactCard(a))
            .join('');
        return `
        <div class="skills-answer">
            <div class="skills-answer-head">
                <i data-lucide="message-square-text" class="w-4 h-4"></i>
                <span>${this.esc(this.getT('skills_run_answer', 'Answer'))}</span>
                <span class="skills-chip">${this.esc(label)}${meta.stepTitle ? ' · ' + this.esc(meta.stepTitle) : ''}</span>
                <span class="skills-msg-time">${this.esc(this.fmtTime(m, meta))}</span>
            </div>
            ${warn}
            ${m.content ? `<div class="skills-answer-body">${this.renderRich(m.content)}</div>` : ''}
            ${arts ? `<div class="skills-answer-arts">${arts}</div>` : ''}
        </div>`;
    },

    renderArtifactCard(art) {
        const cfg = {
            game: { icon: 'gamepad-2', label: this.getT('skills_art_game', 'Aru Game') },
            app: { icon: 'layout', label: this.getT('skills_art_app', 'Aru App') },
            analytics: { icon: 'bar-chart-3', label: this.getT('skills_art_analytics', 'Aru Analytics') },
            doc: { icon: 'file-text', label: this.getT('skills_art_doc', 'Aru Doc') }
        }[art.type] || { icon: 'file-text', label: this.getT('skills_art_doc', 'Aru Doc') };
        return `
        <div class="skills-artifact-card" onclick="SkillsPlugin.openArtifact(${art.id})" role="button" tabindex="0">
            <span class="skills-artifact-icon"><i data-lucide="${cfg.icon}" class="w-5 h-5"></i></span>
            <span class="min-w-0 flex-1" style="text-align: left;">
                <span class="skills-artifact-title">${this.esc(art.title)}</span>
                <span class="skills-artifact-type">${this.esc(cfg.label)}</span>
            </span>
            <i data-lucide="eye" class="w-4 h-4" style="color: var(--skills-subtle);"></i>
        </div>`;
    },

    // ---------- right rail ----------

    toggleRail(force) {
        this.state.railOpen = (typeof force === 'boolean') ? force : !this.state.railOpen;
        this.applyRailState();
    },

    applyRailState() {
        const rail = document.getElementById('skills-rail');
        const toggle = document.getElementById('skills-rail-toggle');
        const backdrop = document.getElementById('skills-rail-backdrop');
        if (!rail) return;
        rail.classList.toggle('open', this.state.railOpen);
        if (toggle) toggle.classList.toggle('active', this.state.railOpen);
        if (backdrop) backdrop.classList.toggle('hidden', !(this.state.railOpen && window.innerWidth <= 900));
    },

    renderRail() {
        const body = document.getElementById('skills-rail-body');
        if (!body) return;
        const p = this.activeProject();
        if (!p) {
            body.innerHTML = `
            <div class="skills-empty">
                <i data-lucide="folder-open" class="w-10 h-10"></i>
                <p>${this.esc(this.getT('skills_no_projects', 'No projects yet. Create one to get started.'))}</p>
                <button type="button" class="btn-skills btn-skills-primary" onclick="SkillsPlugin.addProject()">
                    <i data-lucide="plus" class="w-4 h-4"></i> ${this.esc(this.getT('skills_new_project', 'New Project'))}
                </button>
            </div>`;
            return;
        }
        body.innerHTML = this.renderRailRelay() + this.renderRailMaterials() + this.renderRailContext(p);
        this.initTrackSortable();
    },

    renderRailRelay() {
        const active = this.state.steps.filter(s => s.enabled).length;
        return `
        <div class="skills-rail-section">
            <div class="skills-rail-head">
                <h4 class="skills-rail-title">${this.esc(this.getT('skills_pipeline_title', 'Relay'))}</h4>
                <span class="skills-chip">${active}/${this.state.steps.length}</span>
            </div>
            ${this.state.steps.length === 0
                ? `<div class="skills-pipeline-placeholder">${this.esc(this.getT('skills_pipeline_empty', 'Add skills from the library to build the relay.'))}</div>`
                : `<div class="skills-relay-track" id="skills-relay-track">${this.state.steps.map((st, idx) => this.renderStepCard(st, idx)).join('')}</div>`}
            ${this.renderAddStepControl()}
        </div>`;
    },

    renderStepCard(st, idx) {
        return `
        <div class="skills-step-card${st.enabled ? '' : ' is-disabled'}" data-step-id="${st.id}" id="skills-step-${st.id}">
            <div class="skills-step-top">
                <i data-lucide="grip-vertical" class="skills-step-drag w-4 h-4 shrink-0"></i>
                <span class="skills-step-num">${idx + 1}</span>
                <div class="min-w-0 flex-1">
                    <div class="skills-step-title" title="${this.esc(st.skill_title || '')}">${this.esc(st.skill_title || '—')}</div>
                    <div class="skills-step-meta">${this.esc(st.skill_llm_type || '')}${st.skill_model_name ? ' · ' + this.esc(st.skill_model_name) : ''}</div>
                </div>
                <label class="skills-switch" title="${this.esc(this.getT('skills_step_enabled', 'Toggle step'))}">
                    <input type="checkbox" ${st.enabled ? 'checked' : ''} onchange="SkillsPlugin.toggleStep(${st.id}, this.checked)">
                    <span class="skills-switch-slider"></span>
                </label>
            </div>
            <div class="skills-step-status" id="skills-step-status-${st.id}"></div>
            <div class="skills-step-bottom">
                <button type="button" class="skills-final-btn${st.is_final ? ' is-final' : ''}"
                    title="${this.esc(this.getT(st.is_final ? 'skills_unset_final' : 'skills_set_final', 'Final step'))}"
                    onclick="SkillsPlugin.toggleFinal(${st.id})">
                    <i data-lucide="flag" class="w-3.5 h-3.5"></i> ${this.esc(this.getT('skills_step_final', 'Final'))}
                </button>
                <button type="button" class="btn-skills btn-skills-icon hover:!text-red-500" title="${this.esc(this.getT('skills_remove_step', 'Remove step'))}" onclick="SkillsPlugin.removeStep(${st.id})">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        </div>`;
    },

    renderAddStepControl() {
        if (this.state.skills.length === 0) {
            return `
            <div class="skills-add-step">
                <span class="text-xs" style="color: var(--skills-subtle);">${this.esc(this.getT('skills_library_empty_hint', 'Skill library is empty'))}</span>
                <button type="button" class="btn-skills btn-skills-outline" onclick="SkillsPlugin.openLibraryModal()">
                    <i data-lucide="plus" class="w-4 h-4"></i> ${this.esc(this.getT('skills_new_skill', 'New Skill'))}
                </button>
            </div>`;
        }
        const options = this.state.skills.map(s => `<option value="${s.id}">${this.esc(s.title)}</option>`).join('');
        return `
        <div class="skills-add-step">
            <select id="sk-add-step-skill" class="skills-add-step-select">${options}</select>
            <button type="button" class="btn-skills btn-skills-outline" onclick="SkillsPlugin.addStep()">
                <i data-lucide="plus" class="w-4 h-4"></i> ${this.esc(this.getT('skills_add_step', 'Add step'))}
            </button>
        </div>`;
    },

    renderRailMaterials() {
        const rows = this.state.items.map(it => `
            <div class="skills-item-row">
                <i data-lucide="${it.kind === 'link' ? 'link' : 'file-text'}" class="w-4 h-4 shrink-0" style="color: var(--skills-subtle);"></i>
                <div class="min-w-0 flex-1">
                    <div class="skills-material-name">${this.esc(it.name)}</div>
                    <div class="skills-material-preview">${this.esc(String(it.content || '').slice(0, 120))}</div>
                </div>
                <button type="button" class="btn-skills btn-skills-icon hover:!text-red-500" onclick="SkillsPlugin.deleteItem(${it.id})">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>`).join('');
        return `
        <div class="skills-rail-section">
            <div class="skills-rail-head">
                <h4 class="skills-rail-title">${this.esc(this.getT('skills_items', 'Files & Links'))}</h4>
            </div>
            ${this.state.items.length === 0
                ? `<p class="skills-rail-note">${this.esc(this.getT('skills_no_items', 'No files or links yet.'))}</p>`
                : `<div class="skills-materials">${rows}</div>`}
            <div class="skills-rail-actions">
                <button type="button" class="btn-skills btn-skills-outline" onclick="SkillsPlugin.pickFiles('material')">
                    <i data-lucide="paperclip" class="w-4 h-4"></i> ${this.esc(this.getT('skills_item_kind_file', 'File'))}
                </button>
                <button type="button" class="btn-skills btn-skills-outline" onclick="SkillsPlugin.addMaterialLink()">
                    <i data-lucide="link" class="w-4 h-4"></i> ${this.esc(this.getT('skills_item_kind_link', 'Link'))}
                </button>
            </div>
        </div>`;
    },

    renderRailContext(p) {
        return `
        <div class="skills-rail-section">
            <div class="skills-rail-head">
                <h4 class="skills-rail-title">${this.esc(this.getT('skills_context_title', 'Context'))}</h4>
            </div>
            <div id="sk-estimate">${this.renderEstimateHtml(p)}</div>
            <label class="skills-modal-label" for="sk-p-ctx">${this.esc(this.getT('skills_context_limit', 'Context limit (tokens)'))}</label>
            <input type="number" id="sk-p-ctx" class="skills-modal-input" min="512" step="512" value="${this.esc(p.context_limit)}"
                onchange="SkillsPlugin.saveContext(this.value)">
            <button type="button" class="skills-rail-clear" onclick="SkillsPlugin.clearThread()">
                <i data-lucide="eraser" class="w-4 h-4"></i> ${this.esc(this.getT('skills_clear_thread', 'Clear chat'))}
            </button>
        </div>`;
    },

    initTrackSortable() {
        const track = document.getElementById('skills-relay-track');
        if (!track || typeof Sortable === 'undefined') return;
        Sortable.create(track, {
            animation: 150,
            handle: '.skills-step-drag',
            draggable: '.skills-step-card',
            onEnd: () => {
                const ids = Array.from(track.querySelectorAll('.skills-step-card'))
                    .map(el => parseInt(el.getAttribute('data-step-id'), 10));
                window.DB.setPipelineOrder(this.state.activeProjectId, ids);
                this.state.steps = window.DB.getPipelineSteps(this.state.activeProjectId);
                this.render();
            }
        });
    },

    // ---------- composer ----------

    syncComposer() {
        const input = document.getElementById('skills-composer-input');
        const sendBtn = document.getElementById('skills-send-btn');
        const searchBtn = document.getElementById('skills-search-btn');
        const errEl = document.getElementById('skills-composer-error');
        const attachEl = document.getElementById('skills-composer-attachments');
        if (!input) return;
        const p = this.activeProject();

        input.disabled = !p;
        input.placeholder = this.getT('skills_run_input_placeholder', 'Describe the task for the relay…');
        const draft = p ? (this.state.drafts[p.id] || '') : '';
        if (input.value !== draft) input.value = draft;
        this.autogrow(input);

        if (sendBtn) {
            sendBtn.disabled = !!p && this.state.isRunning ? true : (!p || draft.trim().length === 0);
            sendBtn.innerHTML = this.state.isRunning
                ? '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i>'
                : '<i data-lucide="arrow-up" class="w-4 h-4"></i>';
            sendBtn.title = this.getT('skills_send', 'Send');
        }

        if (searchBtn) {
            searchBtn.classList.toggle('active', this.state.searchOn);
            searchBtn.title = this.getT(this.state.searchOn ? 'skills_search_on' : 'skills_web_search', this.state.searchOn ? 'Search on' : 'Web search');
        }

        if (errEl) {
            errEl.classList.toggle('hidden', !this.state.runError);
            if (this.state.runError) {
                errEl.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i> ${this.esc(this.state.runError)}`;
            }
        }

        if (attachEl) {
            const chips = this.state.attachments.map((a, i) => `
                <span class="skills-attach-chip">
                    <i data-lucide="${a.kind === 'link' ? 'link' : 'file-text'}" class="w-3 h-3"></i>
                    <span class="skills-attach-name">${this.esc(a.name)}</span>
                    <button type="button" onclick="SkillsPlugin.removeAttachment(${i})"><i data-lucide="x" class="w-3 h-3"></i></button>
                </span>`).join('');
            attachEl.classList.toggle('hidden', this.state.attachments.length === 0);
            attachEl.innerHTML = chips;
        }

        this.updateEstimate();
    },

    autogrow(el) {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 180) + 'px';
    },

    onComposerInput(el) {
        const p = this.activeProject();
        if (p) this.state.drafts[p.id] = el.value;
        if (this.state.runError) {
            this.state.runError = '';
            this.syncComposer();
        }
        this.autogrow(el);
        const sendBtn = document.getElementById('skills-send-btn');
        if (sendBtn) sendBtn.disabled = this.state.isRunning || !el.value.trim();
        this.updateEstimate();
    },

    onComposerKey(e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            this.send();
        }
    },

    showComposerError(text) {
        this.state.runError = text || '';
        this.syncComposer();
    },

    removeAttachment(i) {
        this.state.attachments.splice(i, 1);
        this.syncComposer();
    },

    pickFiles(target) {
        const input = document.getElementById('skills-file-input');
        if (!input) return;
        this._fileTarget = target === 'material' ? 'material' : 'composer';
        input.value = '';
        input.click();
    },

    async getFilesModule() {
        if (!this._filesMod) {
            const url = new URL('js/modules/files.js', document.baseURI).href;
            this._filesMod = await import(url);
        }
        return this._filesMod;
    },

    async onFilesPicked(input) {
        const p = this.activeProject();
        if (!p || !input.files || input.files.length === 0) return;
        let mod;
        try {
            mod = await this.getFilesModule();
        } catch (e) {
            console.warn('Skills: files module failed', e);
            alert(this.getT('skills_file_error', 'Could not read the file'));
            return;
        }
        const target = this._fileTarget;
        for (const file of Array.from(input.files)) {
            try {
                const content = String(await mod.FileProcessor.parseFile(file));
                if (target === 'material') {
                    window.DB.addSkillProjectItem(p.id, { kind: 'file', name: file.name, content });
                } else {
                    if (this.state.attachments.length >= this.MAX_ATTACH) {
                        alert(this.getT('skills_attach_limit', 'Up to 10 attachments per message'));
                        break;
                    }
                    this.state.attachments.push({ kind: 'file', name: file.name, content });
                }
            } catch (e) {
                console.warn('Skills: file parse failed', file.name, e);
                alert(this.getT('skills_file_error', 'Could not read the file') + ': ' + file.name);
            }
        }
        input.value = '';
        if (target === 'material') {
            this.state.items = window.DB.getSkillProjectItems(p.id);
            this.renderRail();
            this.toast('skills_created', 'paperclip', 'Added');
        } else {
            this.syncComposer();
        }
        this.updateEstimate();
    },

    linkName(value) {
        const v = String(value || '').trim();
        try {
            const u = new URL(v);
            const tail = (u.pathname && u.pathname !== '/') ? u.pathname.slice(0, 24) : '';
            return (u.hostname + tail) || v.slice(0, 40);
        } catch (e) {
            return v.slice(0, 40);
        }
    },

    addComposerLink() {
        const p = this.activeProject();
        if (!p) return;
        if (this.state.attachments.length >= this.MAX_ATTACH) {
            alert(this.getT('skills_attach_limit', 'Up to 10 attachments per message'));
            return;
        }
        const url = prompt(this.getT('skills_link_prompt', 'Paste a link'));
        if (!url || !url.trim()) return;
        this.state.attachments.push({ kind: 'link', name: this.linkName(url), content: url.trim() });
        this.syncComposer();
    },

    addMaterialLink() {
        const p = this.activeProject();
        if (!p) return;
        const url = prompt(this.getT('skills_link_prompt', 'Paste a link'));
        if (!url || !url.trim()) return;
        window.DB.addSkillProjectItem(p.id, { kind: 'link', name: this.linkName(url), content: url.trim() });
        this.state.items = window.DB.getSkillProjectItems(p.id);
        this.renderRail();
        this.updateEstimate();
        this.toast('skills_created', 'link', 'Added');
    },

    toggleSearch() {
        const us = (window.aruState && window.aruState.userSettings) || {};
        if (!this.state.searchOn && us.search_provider === 'none') {
            this.toast('skills_search_disabled', 'globe', 'Web search is disabled in settings');
            return;
        }
        this.state.searchOn = !this.state.searchOn;
        this.syncComposer();
    },

    updateEstimate() {
        const p = this.activeProject();
        if (!p) return;
        const wrap = document.getElementById('sk-estimate');
        if (wrap) wrap.innerHTML = this.renderEstimateHtml(p);
        const mini = document.getElementById('skills-composer-estimate');
        if (mini) {
            const est = this.computeEstimate(p);
            const over = est.batonTokens > p.context_limit;
            mini.innerHTML = `
                <span class="skills-chip" title="${this.esc(this.getT('skills_est_requests', 'requests'))}"><i data-lucide="workflow" class="w-3 h-3"></i> ${est.requests}</span>
                <span class="skills-chip${over ? ' over' : ''}" title="${this.esc(this.getT('skills_est_tokens_in', 'input tokens'))}"><i data-lucide="arrow-down-to-line" class="w-3 h-3"></i> ~${this.fmtTokens(est.totalIn)}</span>`;
        }
        if (window.lucide) lucide.createIcons();
    },

    // ---------- projects & steps ----------

    openProject(id) {
        if (this.state.isRunning) return;
        this.state.attachments = [];
        this.state.runError = '';
        this.state.stickToBottom = true;
        this.state.activeProjectId = id;
        this.loadProject();
        this.render();
    },

    chooseProject(id) {
        this.closeModal();
        this.openProject(id);
    },

    addProject() {
        const name = prompt(this.getT('skills_project_name', 'Project name') + ':');
        if (!name || !name.trim()) return;
        const id = window.DB.createSkillProject(name.trim());
        this.toast('skills_created', 'folder-plus', 'Created');
        this.state.projects = window.DB.getSkillProjects();
        this.closeModal();
        this.state.attachments = [];
        this.state.runError = '';
        this.state.activeProjectId = id;
        this.loadProject();
        this.render();
    },

    renameProject(id) {
        const p = this.state.projects.find(x => x.id === id);
        if (!p) return;
        const name = prompt(this.getT('skills_project_name', 'Project name') + ':', p.title);
        if (!name || !name.trim()) return;
        window.DB.updateSkillProject(id, { title: name.trim() });
        this.toast('skills_saved', 'save', 'Saved');
        this.state.projects = window.DB.getSkillProjects();
        this.render();
        this.refreshModal();
    },

    deleteProject(id) {
        if (!confirm(this.getT('skills_confirm_delete_project', 'Delete this project with all its files, pipeline and run history?'))) return;
        window.DB.deleteSkillProject(id);
        this.toast('skills_deleted', 'trash-2', 'Deleted');
        this.state.projects = window.DB.getSkillProjects();
        if (this.state.activeProjectId === id) {
            this.state.activeProjectId = this.state.projects.length > 0 ? this.state.projects[0].id : null;
            this.loadProject();
        }
        this.render();
        this.refreshModal();
    },

    saveContext(value) {
        const p = this.activeProject();
        if (!p) return;
        const ctx = Math.max(512, parseInt(value, 10) || 16384);
        window.DB.updateSkillProject(p.id, { context_limit: ctx });
        this.state.projects = window.DB.getSkillProjects();
        this.toast('skills_saved', 'save', 'Saved');
        this.render();
    },

    clearThread() {
        const p = this.activeProject();
        if (!p) return;
        if (!confirm(this.getT('skills_confirm_clear_thread', 'Delete the whole chat, runs and artifacts of this project?'))) return;
        window.DB.getSkillRuns(p.id, 1000).forEach(r => window.DB.deleteSkillRun(r.id));
        window.DB.getSkillArtifacts(p.id).forEach(a => window.DB.deleteSkillArtifact(a.id));
        window.DB.clearSkillProjectMessages(p.id);
        this.state.lastArtifactId = null;
        this.loadProject();
        this.render();
        this.toast('skills_deleted', 'trash-2', 'Deleted');
    },

    deleteItem(id) {
        window.DB.deleteSkillProjectItem(id);
        const p = this.activeProject();
        if (p) this.state.items = window.DB.getSkillProjectItems(p.id);
        this.toast('skills_deleted', 'trash-2', 'Deleted');
        this.renderRail();
        this.updateEstimate();
    },

    addStep() {
        const sel = document.getElementById('sk-add-step-skill');
        const p = this.activeProject();
        if (!sel || !sel.value || !p) return;
        window.DB.addPipelineStep(p.id, parseInt(sel.value, 10));
        this.toast('skills_step_added', 'plus', 'Added');
        this.reloadSteps();
        this.render();
    },

    addToRelay(skillId) {
        const p = this.activeProject();
        if (!p) return;
        window.DB.addPipelineStep(p.id, skillId);
        this.toast('skills_step_added', 'plus', 'Added');
        this.closeModal();
        this.reloadSteps();
        this.render();
        this.toggleRail(true);
    },

    reloadSteps() {
        const p = this.activeProject();
        this.state.steps = p ? window.DB.getPipelineSteps(p.id) : [];
    },

    toggleStep(id, enabled) {
        window.DB.updatePipelineStep(id, { enabled: enabled ? 1 : 0 });
        this.reloadSteps();
        this.render();
    },

    toggleFinal(id) {
        const st = this.state.steps.find(x => x.id === id);
        if (!st) return;
        window.DB.updatePipelineStep(id, { is_final: st.is_final ? 0 : 1 });
        this.reloadSteps();
        this.render();
    },

    removeStep(id) {
        window.DB.deletePipelineStep(id);
        this.toast('skills_deleted', 'trash-2', 'Deleted');
        this.reloadSteps();
        this.render();
    },

    setStepStatus(stepId, status, label) {
        const card = document.getElementById('skills-step-' + stepId);
        if (card) {
            card.classList.remove('st-done', 'st-error', 'st-running');
            if (status) card.classList.add('st-' + status);
        }
        const badge = document.getElementById('skills-step-status-' + stepId);
        if (badge) {
            badge.className = 'skills-step-status' + (status ? ' st-' + status : '');
            badge.innerText = label || (status ? this.getT('skills_status_' + status, status) : '');
        }
    },

    // ---------- modals ----------

    openModal(title, bodyHtml, width) {
        const modal = document.getElementById('skills-modal');
        const titleEl = document.getElementById('skills-modal-title');
        const body = document.getElementById('skills-modal-body');
        const card = document.getElementById('skills-modal-card');
        if (!modal || !body) return;
        if (titleEl) titleEl.innerText = title;
        if (card) card.style.maxWidth = width || '32rem';
        body.innerHTML = bodyHtml;
        modal.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    },

    closeModal() {
        const modal = document.getElementById('skills-modal');
        if (modal) modal.classList.add('hidden');
        this.state.modalKind = null;
        this.state.editingSkillId = null;
    },

    refreshModal() {
        if (this.state.modalKind === 'projects') this.openProjectsModal();
        else if (this.state.modalKind === 'library') this.openLibraryModal();
    },

    openProjectsModal() {
        this.state.modalKind = 'projects';
        this.openModal(this.getT('skills_nav_projects', 'Projects'), this.renderProjectsBody(), '30rem');
    },

    renderProjectsBody() {
        const rows = this.state.projects.map(p => {
            const steps = window.DB.getPipelineSteps(p.id);
            const active = steps.filter(s => s.enabled).length;
            return `
            <div class="skills-modal-row${p.id === this.state.activeProjectId ? ' is-active' : ''}">
                <button type="button" class="skills-modal-row-main" onclick="SkillsPlugin.chooseProject(${p.id})">
                    <i data-lucide="${p.id === this.state.activeProjectId ? 'folder-open' : 'folder-kanban'}" class="w-4 h-4 shrink-0"></i>
                    <span class="min-w-0 flex-1" style="text-align: left;">
                        <span class="skills-modal-row-title">${this.esc(p.title)}</span>
                        <span class="skills-modal-row-meta">${active}/${steps.length} · ctx ${this.fmtTokens(p.context_limit)}</span>
                    </span>
                </button>
                <button type="button" class="btn-skills btn-skills-icon" title="${this.esc(this.getT('skills_rename', 'Rename'))}" onclick="SkillsPlugin.renameProject(${p.id})">
                    <i data-lucide="pencil" class="w-4 h-4"></i>
                </button>
                <button type="button" class="btn-skills btn-skills-icon hover:!text-red-500" title="${this.esc(this.getT('skills_delete', 'Delete'))}" onclick="SkillsPlugin.deleteProject(${p.id})">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>`;
        }).join('');
        return `
        <div class="skills-modal-list">${rows || `<p class="skills-rail-note">${this.esc(this.getT('skills_no_projects', 'No projects yet. Create one to get started.'))}</p>`}</div>
        <button type="button" class="btn-skills btn-skills-primary" style="width: 100%; margin-top: 14px;" onclick="SkillsPlugin.addProject()">
            <i data-lucide="plus" class="w-4 h-4"></i> ${this.esc(this.getT('skills_new_project', 'New Project'))}
        </button>`;
    },

    openLibraryModal() {
        this.state.modalKind = 'library';
        this.openModal(this.getT('skills_nav_library', 'Skill Library'), this.renderLibraryBody(), '48rem');
    },

    renderLibraryBody() {
        const skills = this.state.skills;
        const p = this.activeProject();
        const providerLabel = (s) => {
            const key = { gemini: 'skills_prov_gemini', openrouter: 'skills_prov_openrouter', custom: 'skills_prov_custom' }[s.llm_type] || 'skills_provider';
            return this.getT(key, s.llm_type || '');
        };
        const cards = skills.map(s => `
            <div class="skills-card">
                <div class="skills-card-head">
                    <div class="skills-card-icon"><i data-lucide="sparkles" class="w-4 h-4"></i></div>
                    <div class="min-w-0 flex-1">
                        <h4 class="skills-card-title">${this.esc(s.title)}</h4>
                        <div class="skills-card-meta">${this.esc(providerLabel(s))}${s.model_name ? ' · ' + this.esc(s.model_name) : ''}</div>
                    </div>
                </div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    <span class="skills-chip">temp ${this.esc(String(s.temperature))}</span>
                    <span class="skills-chip">in ${this.esc(String(s.input_limit))}</span>
                    <span class="skills-chip">out ${this.esc(String(s.max_output))}</span>
                    ${s.api_key ? '' : `<span class="skills-chip" title="${this.esc(this.getT('skills_api_key_hint', 'Leave empty to use the key from Aru settings.'))}">aru key</span>`}
                </div>
                <p class="skills-card-preview">${this.esc(s.system_prompt || '')}</p>
                <div class="skills-card-actions">
                    <button type="button" class="btn-skills btn-skills-primary flex-1"${p ? '' : ' disabled'} onclick="SkillsPlugin.addToRelay(${s.id})">
                        <i data-lucide="plus" class="w-4 h-4"></i> ${this.esc(this.getT('skills_add_to_relay', 'Add to relay'))}
                    </button>
                    <button type="button" class="btn-skills btn-skills-icon" title="${this.esc(this.getT('skills_skill_settings', 'Skill settings'))}" onclick="SkillsPlugin.openSkillModal(${s.id})">
                        <i data-lucide="pencil" class="w-4 h-4"></i>
                    </button>
                    <button type="button" class="btn-skills btn-skills-icon" title="${this.esc(this.getT('skills_duplicate', 'Duplicate'))}" onclick="SkillsPlugin.duplicateSkill(${s.id})">
                        <i data-lucide="copy" class="w-4 h-4"></i>
                    </button>
                    <button type="button" class="btn-skills btn-skills-icon hover:!text-red-500" title="${this.esc(this.getT('skills_delete_skill', 'Delete skill'))}" onclick="SkillsPlugin.deleteSkill(${s.id})">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>`).join('');
        return `
        <button type="button" class="btn-skills btn-skills-primary" style="width: 100%; margin-bottom: 14px;" onclick="SkillsPlugin.openSkillModal(null)">
            <i data-lucide="plus" class="w-4 h-4"></i> ${this.esc(this.getT('skills_new_skill', 'New Skill'))}
        </button>
        ${skills.length === 0 ? `
        <div class="skills-empty">
            <i data-lucide="sparkles" class="w-14 h-14"></i>
            <p>${this.esc(this.getT('skills_no_skills', 'No skills yet. Create your first one.'))}</p>
        </div>` : `<div class="skills-cards-grid">${cards}</div>`}`;
    },

    // ---------- skills ----------

    openSkillModal(id) {
        this.state.editingSkillId = id;
        this.state.modalKind = 'skill';
        const s = id ? window.DB.getSkill(id) : null;
        const us = (window.aruState && window.aruState.userSettings) || {};
        const defaults = {
            title: '',
            system_prompt: '',
            llm_type: us.llm_type || 'gemini',
            api_key: '',
            base_url: '',
            model_name: '',
            temperature: 0.9,
            input_limit: 4096,
            max_output: 2048
        };
        if (!s) {
            if (defaults.llm_type === 'gemini') defaults.model_name = us.gemini_model || '';
            else if (defaults.llm_type === 'openrouter') defaults.model_name = us.openrouter_model || '';
            else {
                defaults.model_name = us.custom_model || '';
                defaults.base_url = us.custom_url || '';
            }
        }
        const v = s || defaults;

        this.openModal(s ? this.getT('skills_skill_settings', 'Skill settings') : this.getT('skills_new_skill', 'New Skill'), `
            <div class="space-y-4">
                <div>
                    <label class="skills-modal-label" for="sk-f-title">${this.esc(this.getT('skills_skill_name', 'Name'))}</label>
                    <input type="text" id="sk-f-title" class="skills-modal-input" value="${this.esc(v.title)}"
                        placeholder="${this.esc(this.getT('skills_skill_name_placeholder', 'e.g. Text cleaner'))}">
                </div>
                <div>
                    <label class="skills-modal-label" for="sk-f-prompt">${this.esc(this.getT('skills_system_prompt', 'System prompt'))}</label>
                    <textarea id="sk-f-prompt" class="skills-modal-input" rows="6"
                        placeholder="${this.esc(this.getT('skills_system_prompt_placeholder', 'You are an expert editor...'))}">${this.esc(v.system_prompt)}</textarea>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="skills-modal-label" for="sk-f-provider">${this.esc(this.getT('skills_provider', 'Provider'))}</label>
                        <select id="sk-f-provider" class="skills-modal-input" onchange="SkillsPlugin.onProviderChange()">
                            <option value="gemini" ${v.llm_type === 'gemini' ? 'selected' : ''}>${this.esc(this.getT('skills_prov_gemini', 'Gemini'))}</option>
                            <option value="openrouter" ${v.llm_type === 'openrouter' ? 'selected' : ''}>${this.esc(this.getT('skills_prov_openrouter', 'OpenRouter'))}</option>
                            <option value="custom" ${v.llm_type === 'custom' ? 'selected' : ''}>${this.esc(this.getT('skills_prov_custom', 'Custom (OpenAI-compatible)'))}</option>
                        </select>
                    </div>
                    <div>
                        <label class="skills-modal-label" for="sk-f-model">${this.esc(this.getT('skills_model', 'Model'))}</label>
                        <input type="text" id="sk-f-model" class="skills-modal-input" value="${this.esc(v.model_name)}">
                    </div>
                </div>
                <div id="sk-f-base-url-wrap" class="${v.llm_type === 'custom' ? '' : 'hidden'}">
                    <label class="skills-modal-label" for="sk-f-base-url">${this.esc(this.getT('skills_base_url', 'Base URL'))}</label>
                    <input type="text" id="sk-f-base-url" class="skills-modal-input" value="${this.esc(v.base_url)}" placeholder="http://localhost:11434/v1">
                </div>
                <div>
                    <label class="skills-modal-label" for="sk-f-key">${this.esc(this.getT('skills_api_key', 'API key'))}</label>
                    <input type="password" id="sk-f-key" class="skills-modal-input" value="${this.esc(v.api_key)}" autocomplete="off">
                    <p class="skills-field-hint">${this.esc(this.getT('skills_api_key_hint', 'Leave empty to use the key from Aru settings.'))}</p>
                </div>
                <div class="grid grid-cols-3 gap-4">
                    <div>
                        <label class="skills-modal-label" for="sk-f-temp">${this.esc(this.getT('skills_temperature', 'Temperature'))}</label>
                        <input type="number" id="sk-f-temp" class="skills-modal-input" min="0" max="2" step="0.1" value="${this.esc(String(v.temperature))}">
                    </div>
                    <div>
                        <label class="skills-modal-label" for="sk-f-in">${this.esc(this.getT('skills_input_limit', 'Input limit (tokens)'))}</label>
                        <input type="number" id="sk-f-in" class="skills-modal-input" min="256" step="256" value="${this.esc(String(v.input_limit))}">
                    </div>
                    <div>
                        <label class="skills-modal-label" for="sk-f-out">${this.esc(this.getT('skills_max_output', 'Max output (tokens)'))}</label>
                        <input type="number" id="sk-f-out" class="skills-modal-input" min="256" step="256" value="${this.esc(String(v.max_output))}">
                    </div>
                </div>
                <div class="flex gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
                    <button type="button" class="btn-skills btn-skills-primary flex-1" onclick="SkillsPlugin.saveSkill()">
                        <i data-lucide="save" class="w-4 h-4"></i> ${this.esc(this.getT('skills_save', 'Save'))}
                    </button>
                    <button type="button" class="btn-skills btn-skills-outline" onclick="SkillsPlugin.cancelSkillModal()">
                        ${this.esc(this.getT('skills_cancel', 'Cancel'))}
                    </button>
                </div>
            </div>
        `, '34rem');
    },

    cancelSkillModal() {
        this.openLibraryModal();
    },

    onProviderChange() {
        const type = document.getElementById('sk-f-provider').value;
        const wrap = document.getElementById('sk-f-base-url-wrap');
        if (wrap) wrap.classList.toggle('hidden', type !== 'custom');
    },

    saveSkill() {
        const title = document.getElementById('sk-f-title').value.trim();
        if (!title) return alert(this.getT('skills_title_required', 'Name is required'));
        const data = {
            title,
            system_prompt: document.getElementById('sk-f-prompt').value,
            llm_type: document.getElementById('sk-f-provider').value,
            api_key: document.getElementById('sk-f-key').value.trim(),
            base_url: document.getElementById('sk-f-base-url').value.trim(),
            model_name: document.getElementById('sk-f-model').value.trim(),
            temperature: Math.min(2, Math.max(0, parseFloat(document.getElementById('sk-f-temp').value) || 0)),
            input_limit: Math.max(256, parseInt(document.getElementById('sk-f-in').value, 10) || 4096),
            max_output: Math.max(256, parseInt(document.getElementById('sk-f-out').value, 10) || 2048)
        };
        if (this.state.editingSkillId) {
            window.DB.updateSkill(this.state.editingSkillId, data);
            this.toast('skills_saved', 'save', 'Saved');
        } else {
            window.DB.createSkill(data);
            this.toast('skills_created', 'sparkles', 'Created');
        }
        this.state.skills = window.DB.getSkills();
        this.render();
        this.openLibraryModal();
    },

    duplicateSkill(id) {
        const s = window.DB.getSkill(id);
        if (!s) return;
        window.DB.createSkill({
            title: s.title + this.getT('skills_copy_suffix', ' (copy)'),
            system_prompt: s.system_prompt,
            llm_type: s.llm_type,
            api_key: s.api_key,
            base_url: s.base_url,
            model_name: s.model_name,
            temperature: s.temperature,
            input_limit: s.input_limit,
            max_output: s.max_output
        });
        this.toast('skills_created', 'copy', 'Created');
        this.state.skills = window.DB.getSkills();
        this.render();
        this.refreshModal();
    },

    deleteSkill(id) {
        if (!confirm(this.getT('skills_confirm_delete_skill', 'Delete this skill? It will be removed from all project pipelines.'))) return;
        window.DB.deleteSkill(id);
        this.toast('skills_deleted', 'trash-2', 'Deleted');
        this.state.skills = window.DB.getSkills();
        this.reloadSteps();
        this.render();
        this.refreshModal();
    },

    // ---------- relay engine ----------

    estTokens(text) {
        return text ? Math.ceil(String(text).length / 4) : 0;
    },

    // Keeps head and tail: a plan loses its structure if the head is cut, and code
    // loses its ending if the tail is cut — the relay needs both.
    clipMiddle(text, maxChars) {
        const t = String(text || '');
        const max = Math.max(256, Math.floor(maxChars || 0));
        if (t.length <= max) return t;
        const head = Math.floor(max * 0.55);
        const tail = Math.max(0, max - head - 16);
        return `${t.slice(0, head)}\n\n[...]\n\n${tail > 0 ? t.slice(-tail) : ''}`;
    },

    // Reliable cut-off signals only: an unclosed code fence, or output that reached
    // the model's own cap. Anything guessier would flag healthy answers.
    looksTruncated(text, maxOutputTokens) {
        const t = String(text || '').trimEnd();
        if (!t) return false;
        if (((t.match(/```/g) || []).length % 2) === 1) return true;
        return !!(maxOutputTokens && this.estTokens(t) >= maxOutputTokens * 0.92);
    },

    buildMaterialsBlock(extra) {
        const rows = this.state.items
            .map(it => `### ${it.name} (${it.kind === 'link' ? 'link' : 'file'})\n${it.content}`);
        (Array.isArray(extra) ? extra : []).forEach(a => rows.push(`### ${a.name} (${a.kind === 'link' ? 'link' : 'file'})\n${a.content}`));
        return rows.join('\n\n');
    },

    // A project is a continuing conversation, not a collection of isolated runs.
    // Keep the recent visible exchange and, crucially, the source of any artifact:
    // the short note displayed beside a document is not enough to edit that document.
    buildProjectContext() {
        const recent = (this.state.messages || [])
            .filter(m => m && (m.kind === 'user' || m.kind === 'answer'))
            .slice(-6);
        const rows = [];
        recent.forEach(m => {
            if (m.kind === 'user') {
                rows.push(`[Previous user request]\n${m.content || ''}`);
                return;
            }
            rows.push(`[Previous completed answer]\n${m.content || ''}`);
            const meta = this.parseMeta(m);
            (meta.artifacts || []).forEach(id => {
                const art = window.DB && window.DB.getSkillArtifact ? window.DB.getSkillArtifact(id) : null;
                if (!art) return;
                rows.push(`[Current artifact: ${art.title} (${art.type})]\n${art.code || ''}`);
            });
        });
        return rows.join('\n\n');
    },

    // Machine instruction for the chain. Deliberately not localized: it is a protocol
    // for the model rather than UI copy, and the answer language is taken from the task.
    relayProtocol(stepNo, total, skillTitle, isFinal) {
        const lines = [
            `You are step ${stepNo} of ${total} in a relay pipeline. Every step does its own part of the user's task and hands the result to the next step.`,
            `Your role in the pipeline: ${skillTitle}.`,
            '',
            'The user message you receive has these sections:',
            '=== TASK ===         the original user request, identical for every step',
            '=== PROJECT CONTEXT === completed results from earlier runs in this project, when present',
            '=== MATERIALS ===    project files, links and the attachments of this message',
            '=== WEB SEARCH ===   fresh search results, present only when the user turned search on',
            '=== DONE SO FAR ===  outputs of the previous steps, numbered',
            '=== YOUR JOB ===     what you must produce now',
            '',
            'Hard rules:',
            '1. No greetings, no self-introduction, no thanks, no narration of what you are about to do.',
            '2. Do not restate or quote the input back, do not repeat previous steps.',
            '3. Never restart the work from scratch: continue, refine and complete what the previous steps produced.',
            '4. If a previous output is marked as cut off, finish that work instead of rewriting it.',
            '5. Output only your own deliverable as clean markdown.',
            '6. Answer in the same language as the TASK section.',
            '7. If the task does not need code, do not invent any.',
            '8. Treat the WEB SEARCH section as facts when it is present and mention the sources you relied on.',
            '9. When TASK asks to revise, replace, continue or transform prior work, apply that request to PROJECT CONTEXT itself. Do not answer with generic instructions for another editor.'
        ];
        if (!isFinal) {
            lines.push(
                '10. This is a handoff, not the user-facing answer. Be concise (normally under 900 tokens) and pass concrete decisions, requirements, edge cases and test results to the next step.',
                '11. Do not emit a complete app, an artifact tag, or a long source file. If you review or change code, describe the exact fix; the final step writes the complete deliverable.'
            );
        }
        if (isFinal) {
            lines.push(
                '',
                'You are the FINAL step: your output is shown to the user as the finished answer.',
                '- Merge the work of all steps into one coherent, ready-to-use result. The user must not see the pipeline transcript.',
                '- If the result is a web app, a game, a dashboard or a document, put the complete deliverable into an artifact tag:',
                '[[ARU_ARTIFACT type="app" title="Short name"]]',
                'full content here, without placeholders and without omissions',
                '[[/ARU_ARTIFACT]]',
                '- Put raw source inside the artifact tag: do not wrap the whole artifact in a ``` code fence.',
                '- Allowed type values: app (web app, interface or a single HTML file), game, analytics (dashboard or charts), doc (markdown document).',
                '- One artifact is enough. Outside the tag write only a short note for the user.'
            );
        }
        return lines.join('\n');
    },

    // Every step sees the original task and the whole chain so far, budgeted by the
    // project context limit and the receiving skill's own input_limit.
    buildStepBaton(p, skill, input, prev, isFinal, ctx) {
        const limitTokens = Math.min(p.context_limit || 16384, skill.input_limit || 4096);
        const budget = Math.max(2048, limitTokens * 4);
        const c = ctx || {};

        const projectContext = String(c.projectContext || '');
        const hasProjectContext = !!projectContext;
        const taskBlock = this.clipMiddle(input, Math.floor(budget * (hasProjectContext ? 0.18 : 0.25)));
        // send() pre-builds project materials once. Accept that string directly;
        // treating it as an array used to throw when a project had attachments.
        const materials = typeof c.materials === 'string'
            ? c.materials
            : this.buildMaterialsBlock(c.materials || []);
        const matBlock = materials ? this.clipMiddle(materials, Math.floor(budget * (hasProjectContext ? 0.12 : 0.3))) : '';
        const searchBlock = c.search ? this.clipMiddle(c.search, Math.floor(budget * (hasProjectContext ? 0.1 : 0.15))) : '';
        const projectBlock = projectContext ? this.clipMiddle(projectContext, Math.floor(budget * 0.52)) : '';

        let workBlock = '';
        if (prev.length > 0) {
            const used = taskBlock.length + projectBlock.length + matBlock.length + searchBlock.length + 360;
            const workBudget = Math.max(1024, budget - used);
            const n = prev.length;
            // The most recent handoff is the source of truth (for example, the
            // tester's corrected plan). Preserve it almost whole; clipping every
            // earlier result evenly used to cut code in half before the next role.
            const shareOf = (i) => (n === 1) ? 1 : ((i === n - 1) ? 0.78 : 0.22 / (n - 1));
            workBlock = prev.map((it, i) => {
                const body = this.clipMiddle(it.text, Math.floor(workBudget * shareOf(i)));
                const note = it.truncated ? ' [CUT OFF — finish it]' : '';
                return `[Step ${i + 1} - ${it.title}]${note}\n${body}`;
            }).join('\n\n');
        }

        const job = isFinal
            ? 'Collect the results of every step into the final answer for the user.'
            : (prev.length === 0
                ? 'You open the relay. Do your role and produce a result the next step can build on.'
                : 'Continue the work of the previous steps within your role.');

        return [
            `=== TASK ===\n${taskBlock}`,
            projectBlock ? `=== PROJECT CONTEXT ===\n${projectBlock}` : '',
            matBlock ? `=== MATERIALS ===\n${matBlock}` : '',
            searchBlock ? `=== WEB SEARCH ===\n${searchBlock}` : '',
            workBlock ? `=== DONE SO FAR ===\n${workBlock}` : '',
            `=== YOUR JOB ===\n${job}`
        ].filter(Boolean).join('\n\n');
    },

    artifactAttribute(attrs, name) {
        // Models occasionally swap attributes, use single quotes, or HTML-escape
        // double quotes. Keep the protocol forgiving: an otherwise valid artifact
        // must not silently turn into a plain (and usually very large) code block.
        const key = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\b${key}\\s*=\\s*(?:&quot;([\\s\\S]*?)&quot;|"([^"]*)"|'([^']*)'|([^\\s\\]]+))`, 'i');
        const match = re.exec(String(attrs || ''));
        return match ? (match[1] || match[2] || match[3] || match[4] || '').trim() : '';
    },

    normalizeArtifactCode(code, type) {
        let value = String(code || '').trim();
        // The artifact protocol asks for raw content, but models commonly put the
        // entire payload in a Markdown fence. Canvas receives source, not Markdown,
        // so leaving that fence in place makes otherwise valid HTML/JS appear blank.
        const fenceCount = (value.match(/```/g) || []).length;
        const wrapped = fenceCount === 2
            ? /^```[^\r\n]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(value)
            : null;
        if (wrapped) value = wrapped[1].trim();

        // Some models split a web app into HTML, CSS and JS fences even inside
        // the artifact tag. A canvas cannot execute Markdown, so rebuild a single
        // source document from those fences rather than storing the wrappers.
        if (type !== 'doc') {
            const blocks = [];
            const blockRe = /```([a-z0-9_+-]+)?\s*\r?\n([\s\S]*?)```/gi;
            let block;
            while ((block = blockRe.exec(value)) !== null) {
                blocks.push({ lang: String(block[1] || '').toLowerCase(), code: block[2].trim() });
            }
            if (blocks.length > 1) {
                const html = blocks.find(b => ['html', 'htm', 'app', 'game', 'analytics'].includes(b.lang));
                const css = blocks.filter(b => b.lang === 'css').map(b => b.code).join('\n\n');
                const js = blocks.filter(b => ['js', 'javascript', 'ts', 'typescript'].includes(b.lang)).map(b => b.code).join('\n\n');
                if (html) {
                    value = html.code;
                    if (css) {
                        const style = `<style>\n${css}\n</style>`;
                        value = /<\/head\s*>/i.test(value) ? value.replace(/<\/head\s*>/i, `${style}\n</head>`) : `${value}\n${style}`;
                    }
                    if (js) {
                        const script = `<script>\n${js}\n</script>`;
                        value = /<\/body\s*>/i.test(value) ? value.replace(/<\/body\s*>/i, `${script}\n</body>`) : `${value}\n${script}`;
                    }
                } else if (css || js) {
                    value = `${css ? `<style>\n${css}\n</style>` : ''}${js ? `\n<script>\n${js}\n</script>` : ''}`.trim();
                }
            }
        }
        return value;
    },

    // Same contract as Triggers.processResponseForArtifacts: explicit tags first,
    // then a conservative fallback for heavy code blocks only.
    extractArtifacts(text) {
        const src = String(text || '');
        const found = [];
        // Accept one or two brackets and minor spelling/spacing variants. Model
        // output must not fall through to the raw Markdown answer just because it
        // wrote [ARU ARTIFACT] instead of the exact documented spelling.
        const re = /\[{1,2}\s*ARU[\s_-]*ARTIFACT\b([^\]]*)\]{1,2}([\s\S]*?)\[{1,2}\s*\/\s*ARU[\s_-]*ARTIFACT\s*\]{1,2}/gi;
        let m;
        while ((m = re.exec(src)) !== null) {
            const type = this.artifactAttribute(m[1], 'type').toLowerCase();
            const normalizedType = ['app', 'game', 'analytics', 'doc'].includes(type) ? type : 'doc';
            const code = this.normalizeArtifactCode(m[2], normalizedType);
            if (!code) continue;
            found.push({
                type: normalizedType,
                title: this.artifactAttribute(m[1], 'title') || 'Artifact',
                code,
                full: m[0]
            });
        }
        if (found.length === 0) {
            const cb = /```([a-z0-9_\-+]+)?\s*\n([\s\S]*?)```/gi;
            while ((m = cb.exec(src)) !== null) {
                const lang = String(m[1] || '').toLowerCase();
                const code = this.normalizeArtifactCode(m[2], lang === 'html' ? 'app' : lang);
                const interactive = /\b(canvas|getcontext|requestanimationframe|chart\.?js|new\s+chart)\b/i.test(code);
                const explicitArtifact = ['html', 'app', 'game', 'analytics', 'doc'].includes(lang);
                // A Tetris response is often labelled `javascript` rather than
                // `game`. Promote it only when it has a clear interactive signal;
                // ordinary programming snippets must remain normal chat code.
                if (code.length < 100 || (!explicitArtifact && !(interactive && ['js', 'javascript'].includes(lang)))) continue;
                let type = 'doc';
                if (lang === 'html' || code.includes('<script') || code.includes('<div')) {
                    type = interactive ? (code.includes('Chart') ? 'analytics' : 'game') : 'app';
                } else if (interactive) {
                    type = /chart\.?js|new\s+chart/i.test(code) ? 'analytics' : 'game';
                }
                found.push({ type, title: 'Auto Generated ' + type.charAt(0).toUpperCase() + type.slice(1), code, auto: true, full: m[0] });
            }
        }
        return found;
    },

    // The whole artifact region leaves the answer: its code lives on the canvas, and
    // keeping it inline would dump raw markup into the chat bubble.
    stripArtifacts(text, found) {
        let out = String(text || '');
        for (const a of (found || [])) {
            if (a.full) out = out.split(a.full).join('');
        }
        out = out.replace(/\[\[\s*ARU_ARTIFACT[\s\S]*?\]\]/gi, '')
            .replace(/\[\[?\s*\/ARU_ARTIFACT\s*\]?\]/gi, '');
        return out.replace(/\n{3,}/g, '\n\n').trim();
    },

    computeEstimate(p) {
        const input = (p && this.state.drafts[p.id]) || '';
        const materials = this.buildMaterialsBlock(this.state.attachments);
        const activeSteps = this.state.steps.filter(s => s.enabled);
        const skillById = {};
        this.state.skills.forEach(s => { skillById[s.id] = s; });

        const providers = new Set();
        activeSteps.forEach(st => {
            const sk = skillById[st.skill_id];
            if (sk && sk.llm_type) providers.add(sk.llm_type);
        });

        // 300 ≈ relay protocol + section headers of the baton
        const baseTokens = this.estTokens(input) + this.estTokens(materials) + 300;

        // Each next step also carries every previous output, so the load grows along the chain
        let totalIn = 0, carried = 0;
        activeSteps.forEach(st => {
            const cur = skillById[st.skill_id];
            if (!cur) return;
            const cap = Math.min(p.context_limit || 16384, cur.input_limit || 4096);
            totalIn += Math.min(baseTokens + carried + this.estTokens(cur.system_prompt), cap);
            carried += cur.max_output || 2048;
        });

        return {
            batonTokens: baseTokens,
            materialsTokens: this.estTokens(materials),
            inputTokens: this.estTokens(input),
            requests: activeSteps.length,
            providers: providers.size,
            totalIn
        };
    },

    fmtTokens(n) {
        const v = Math.round(n);
        return v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(v);
    },

    renderEstimateHtml(p) {
        const est = this.computeEstimate(p);
        const pct = Math.min(100, Math.round(est.batonTokens / Math.max(1, p.context_limit) * 100));
        const over = est.batonTokens > p.context_limit;
        return `
        <div class="skills-estimate">
            <div class="skills-est-bar"><span class="${over ? 'over' : ''}" style="width:${pct}%"></span></div>
            <div class="skills-est-line">
                <span class="${over ? 'skills-est-over' : ''}">${this.fmtTokens(est.batonTokens)} / ${this.fmtTokens(p.context_limit)}</span>
                <span class="skills-est-chips">
                    <span class="skills-chip" title="${this.esc(this.getT('skills_est_materials', 'Project materials'))}"><i data-lucide="paperclip" class="w-3 h-3"></i> ${this.fmtTokens(est.materialsTokens)}</span>
                    <span class="skills-chip" title="${this.esc(this.getT('skills_est_requests', 'requests'))}"><i data-lucide="zap" class="w-3 h-3"></i> ${est.requests}</span>
                    <span class="skills-chip" title="${this.esc(this.getT('skills_est_providers', 'providers'))}"><i data-lucide="server" class="w-3 h-3"></i> ${est.providers}</span>
                </span>
            </div>
        </div>`;
    },

    // Step output and answers are inserted as HTML by the markdown renderer, and they
    // are built from project materials that can come from any web page. Raw tags in
    // prose are never meant to be live markup (artifact code goes to the canvas), so
    // "<" is escaped outside code spans. ">" stays: blockquotes need it.
    neutralizeHtml(text) {
        let source = String(text || '');
        // A model that reaches its output cap can leave one opening fence behind.
        // Close it only for presentation, so marked renders the partial source as
        // code rather than consuming the rest of the answer in a malformed block.
        if ((source.match(/```/g) || []).length % 2 === 1) source += '\n```';
        return source
            .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
            .map((part, i) => (i % 2 === 1) ? part : part.replace(/</g, '&lt;'))
            .join('');
    },

    // Markdown is rendered by the app's own parser so relay output looks like an Aru
    // answer: code blocks with highlighting, tables, KaTeX formulas.
    renderRich(text) {
        const safe = this.neutralizeHtml(text);
        const html = (window.UI && UI.parseMarkdownWithMath)
            ? UI.parseMarkdownWithMath(safe)
            : this.esc(safe);
        return `<div class="skills-rich prose prose-sm dark:prose-invert max-w-none">${html}</div>`;
    },

    // KaTeX works on the live DOM only, so formulas are mounted after innerHTML
    hydrateRich(root) {
        if (!root || !window.UI || !UI.renderMath) return;
        root.querySelectorAll('.skills-rich').forEach(el => {
            try { UI.renderMath(el); } catch (e) { /* formulas stay as plain text */ }
        });
    },

    async getLLMModule() {
        if (!this._llmMod) {
            // Classic script: dynamic import resolves against the document base URL
            const url = new URL('js/modules/llm.js', document.baseURI).href;
            this._llmMod = await import(url);
        }
        return this._llmMod;
    },

    async getSearchModule() {
        if (!this._searchMod) {
            const url = new URL('js/modules/search.js', document.baseURI).href;
            this._searchMod = await import(url);
        }
        return this._searchMod;
    },

    // Empty skill key/base_url/model fall back to the keys configured in Aru settings
    resolveSkillLLM(skill) {
        const us = (window.aruState && window.aruState.userSettings) || {};
        const type = skill.llm_type || 'gemini';
        let apiKey = skill.api_key || '';
        let baseUrl = skill.base_url || '';
        let modelName = skill.model_name || '';
        if (!apiKey) {
            if (type === 'gemini') apiKey = us.gemini_key || '';
            else if (type === 'openrouter') apiKey = us.openrouter_key || '';
            else apiKey = us.custom_key || '';
        }
        if (!baseUrl) {
            if (type === 'openrouter') baseUrl = us.openrouter_url || '';
            else if (type === 'custom') baseUrl = us.custom_url || '';
        }
        if (!modelName) {
            if (type === 'gemini') modelName = us.gemini_model || '';
            else if (type === 'openrouter') modelName = us.openrouter_model || '';
            else modelName = us.custom_model || '';
        }
        return { type, apiKey, baseUrl, modelName };
    },

    uniqueArtifactTitle(projectId, title, isAuto) {
        // An explicit title means "the same deliverable again", so it updates in place;
        // auto titles must not collide with each other.
        if (!isAuto) return title;
        const taken = (t) => !!window.DB.getSkillArtifactByTitle(projectId, t);
        if (!taken(title)) return title;
        let n = 2;
        while (taken(`${title} ${n}`)) n++;
        return `${title} ${n}`;
    },

    openArtifact(id) {
        const art = window.DB.getSkillArtifact(id);
        if (!art || !window.CanvasManager) return;
        this.state.lastArtifactId = art.id;
        window.CanvasManager.renderArtifact(art.type, art.title, art.code);
    },

    // Returning to the plugin tab hides the shared canvas iframe; put it back
    // when the user had the canvas open.
    onActivate() {
        const panel = document.getElementById('canvas-panel');
        if (panel && !panel.classList.contains('hidden') && this.state.lastArtifactId) {
            this.openArtifact(this.state.lastArtifactId);
        }
    },

    // ---------- send ----------

    async send() {
        if (this.state.isRunning) return;
        const p = this.activeProject();
        if (!p) return;
        const input = (this.state.drafts[p.id] || '').trim();
        if (!input) return;

        const activeSteps = this.state.steps.filter(s => s.enabled);
        if (activeSteps.length === 0) {
            this.toggleRail(true);
            this.showComposerError(this.getT('skills_no_active_steps', 'No active steps in the relay'));
            return;
        }

        const attachments = this.state.attachments.slice();
        const searchOn = this.state.searchOn;
        // Capture context before the new user row is added, so only completed
        // project work (rather than the current request duplicated twice) is sent.
        const projectContext = this.buildProjectContext();
        this.state.drafts[p.id] = '';
        this.state.attachments = [];
        this.state.runError = '';
        this.state.isRunning = true;
        this.state.stickToBottom = true;
        this.syncComposer();

        const files = attachments.filter(a => a.kind === 'file').map(a => a.name);
        const links = attachments.filter(a => a.kind === 'link').map(a => a.name);

        window.DB.addSkillProjectMessage(p.id, 'user', input, { ts: Date.now(), files, links, search: searchOn });
        const runId = window.DB.createSkillRun(p.id, input);
        const runMsgId = window.DB.addSkillProjectMessage(p.id, 'run', '', {
            ts: Date.now(), runId, status: 'running', total: activeSteps.length, index: 0, note: ''
        });
        this.state.messages = window.DB.getSkillProjectMessages(p.id);
        this.state.expandedRuns[runMsgId] = true;
        this.state.liveRun = { msgId: runMsgId, runId, total: activeSteps.length };
        this.renderThread();
        this.toast('skills_run_started', 'play', 'Relay started');

        const skillById = {};
        this.state.skills.forEach(s => { skillById[s.id] = s; });

        const done = []; // { title, text, truncated } — the chain every next step can see
        const total = activeSteps.length;
        const hasFinalFlag = activeSteps.some(s => s.is_final);
        let last = null, final = null;
        let errorStep = null, errorText = '';
        let searchBlock = '';

        try {
            if (searchOn) {
                this.setMsgMeta(runMsgId, { note: this.getT('skills_searching', 'Searching the web') + '…' });
                this.updateMsg(runMsgId);
                try {
                    const mod = await this.getSearchModule();
                    const res = await mod.Search.query(input);
                    searchBlock = res || '';
                    if (!searchBlock) this.toast('skills_search_empty', 'globe', 'No search results');
                } catch (e) {
                    console.warn('Skills: web search failed', e);
                    this.toast('skills_search_failed', 'globe', 'Web search failed');
                }
            }

            const mod = await this.getLLMModule();
            const LLMClient = mod.LLMClient;
            const materials = this.buildMaterialsBlock(attachments);

            for (let i = 0; i < total; i++) {
                const step = activeSteps[i];
                const skill = skillById[step.skill_id];
                if (!skill) {
                    errorStep = step.skill_title || '#' + step.skill_id;
                    errorText = this.getT('skills_skill_missing', 'Skill not found');
                    break;
                }
                const isFinal = hasFinalFlag ? !!step.is_final : (i === total - 1);
                const baton = this.buildStepBaton(p, skill, input, done, isFinal, {
                    materials,
                    search: searchBlock,
                    projectContext
                });

                this.setMsgMeta(runMsgId, { index: i + 1, title: skill.title, note: '' });
                delete this.state.runStepsCache[runId];
                this.updateMsg(runMsgId);
                this.setStepStatus(step.id, 'running');
                this.scrollThreadToBottom();

                const stepRowId = window.DB.addSkillRunStep(runId, {
                    step_id: step.id,
                    step_order: i,
                    skill_id: skill.id,
                    skill_title: skill.title,
                    provider: skill.llm_type,
                    model: skill.model_name,
                    input_text: baton,
                    status: 'running'
                });

                try {
                    const cfg = this.resolveSkillLLM(skill);
                    const client = new LLMClient();
                    // A final artifact is a complete deliverable, not a handoff.
                    // The old 2K default cut a one-file game before its closing
                    // tags; reserve a practical minimum while preserving a higher
                    // limit explicitly chosen for the skill.
                    const outputCap = isFinal ? Math.max(4096, skill.max_output || 0) : skill.max_output;
                    client.setLLMConfig({
                        llmType: cfg.type,
                        apiKey: cfg.apiKey,
                        baseUrl: cfg.baseUrl,
                        modelName: cfg.modelName,
                        maxOutputTokens: outputCap,
                        aiTemp: skill.temperature
                    });
                    client.setSystemInstruction(
                        this.relayProtocol(i + 1, total, skill.title, isFinal) + '\n\n' + (skill.system_prompt || '')
                    );

                    const out = await client.sendMessage([], baton);
                    const text = out == null ? '' : String(out).trim();
                    if (!text) throw new Error(this.getT('skills_empty_response', 'Empty response from model'));

                    const truncated = this.looksTruncated(text, outputCap);
                    window.DB.updateSkillRunStep(stepRowId, {
                        output_text: text,
                        status: 'done',
                        truncated: truncated ? 1 : 0,
                        tokens_est: this.estTokens(baton) + this.estTokens(text)
                    });
                    this.setStepStatus(step.id, 'done',
                        truncated ? this.getT('skills_status_truncated', 'Done — answer cut off') : '');

                    const record = { title: skill.title, text, truncated, isFinal };
                    done.push(record);
                    last = record;
                    if (isFinal) final = record;
                } catch (err) {
                    const msg = String((err && err.message) || err);
                    window.DB.updateSkillRunStep(stepRowId, { status: 'error', error: msg });
                    this.setStepStatus(step.id, 'error');
                    errorStep = skill.title;
                    errorText = msg;
                    break;
                }
                delete this.state.runStepsCache[runId];
                this.updateMsg(runMsgId);
                this.scrollThreadToBottom();
            }
        } catch (err) {
            errorStep = errorStep || 'LLM';
            errorText = errorText || String((err && err.message) || err);
        }

        const failed = !!errorStep;
        window.DB.updateSkillRun(runId, { status: failed ? 'error' : 'done' });
        window.DB.trimSkillRuns(p.id, 30);

        this.state.isRunning = false;
        this.state.liveRun = null;
        delete this.state.runStepsCache[runId];

        if (failed || !last) {
            this.setMsgMeta(runMsgId, { status: 'error', error: errorText, note: '' });
            this.state.runError = this.getT('skills_step_failed', 'Step "%s" failed — relay stopped').replace('%s', errorStep)
                + (errorText ? ': ' + errorText : '');
            this.state.expandedRuns[runMsgId] = true;
            this.toast('skills_step_failed', 'alert-triangle', 'Step failed');
        } else {
            const source = final || last;
            const raw = source.text;
            const found = this.extractArtifacts(raw);
            const artifactIds = found.map(a => window.DB.saveSkillArtifact(
                p.id, runId, this.uniqueArtifactTitle(p.id, a.title, a.auto), a.type, a.code
            ));
            const artifacts = artifactIds.map(id => window.DB.getSkillArtifact(id)).filter(Boolean);

            this.setMsgMeta(runMsgId, { status: 'done', note: '' });
            this.state.expandedRuns[runMsgId] = false; // folds like Aru's Thinking block
            window.DB.addSkillProjectMessage(p.id, 'answer', this.stripArtifacts(raw, found), {
                ts: Date.now(), runId, truncated: source.truncated,
                fromFinal: !!final, stepTitle: source.title, artifacts: artifactIds
            });
            this.toast('skills_run_done', 'check-circle', 'Relay finished');
            if (artifacts.length) this.openArtifact(artifacts[artifacts.length - 1].id);
        }

        this.state.messages = window.DB.getSkillProjectMessages(p.id);
        this.state.stickToBottom = true;
        this.render();
    }
};

SkillsPlugin.init();
