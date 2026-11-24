/*
---ARU-LAB.SPACE---ALMATY---2026---
Aru Skills v2 — Studio UI, Project & Library Manager, Live Pipeline Strip,
Studio Run Inspector, Artifact Vault, and Tabbed Orchestration Rail.
Classic script preloaded in index.html; extended by skills-presets.js & skills-engine.js.
---chat.aru-lab.space---PWA---
*/

window.SkillsPlugin = window.SkillsPlugin || {};

Object.assign(window.SkillsPlugin, {
    state: Object.assign({
        projects: [],
        skills: [],
        activeProjectId: null,
        items: [],               // project materials (files & links)
        steps: [],               // relay steps of the open project
        messages: [],            // chat thread of the open project
        artifacts: [],           // saved artifacts of the open project
        runStepsCache: {},       // runId -> run step rows
        expandedRuns: {},        // message id -> inspector expanded
        activeRunTab: {},        // message id -> 'row-<id>' | 'compare-<stageIdx>'
        editingStepRow: {},      // run step rowId -> boolean
        stepDrafts: {},          // run step rowId -> edited text draft
        railTab: 'pipeline',     // 'pipeline' | 'artifacts' | 'context'
        editingSkillId: null,
        modalKind: null,         // 'projects' | 'library' | 'skill' | 'presets'
        drafts: {},              // projectId -> unsent composer text
        attachments: [],         // { kind: 'file'|'link', name, content }
        searchOn: false,
        railOpen: false,
        isRunning: false,
        runError: '',
        liveRun: null,           // { msgId, runId, total }
        lastArtifactId: null,
        stickToBottom: true
    }, window.SkillsPlugin.state || {}),

    MAX_ATTACH: 10,
    _dbReady: false,
    _domMounted: false,
    _llmMod: null,
    _filesMod: null,
    _searchMod: null,
    _networkMod: null,
    _fileTarget: 'composer',
    _abortController: null,
    _runStopped: false,
    _trackSortable: null,
    _stripResizeObserver: null,

    init() {
        this.bindGlobals();
        const root = document.getElementById('skills-plugin-root');
        if (!root) return; // Preload pass: no DOM yet; re-triggered by skills-engine.js on mount

        if (!(window.DB && window.DB.db)) {
            this._domMounted = false;
            return;
        }
        this._dbReady = true;
        this._domMounted = true;

        this.applyI18n();
        this.state.railOpen = window.innerWidth > 900;
        const saved = parseInt(localStorage.getItem('aru_skills_project') || '', 10);
        this.refresh(saved || null);
        if (window.lucide) lucide.createIcons();
    },

    bindGlobals() {
        if (!window._skillsGlobalsBound) {
            window._skillsGlobalsBound = true;
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                if (document.querySelector('#aru-dialog-host .aru-dialog-root')) return;
                const modal = document.getElementById('skills-modal');
                if (modal && !modal.classList.contains('hidden') && window.SkillsPlugin) {
                    window.SkillsPlugin.closeModal();
                }
            });
            window.addEventListener('resize', () => {
                if (window.SkillsPlugin && window.SkillsPlugin._domMounted) window.SkillsPlugin.applyRailState();
            });
            window.addEventListener('aru-lang-changed', () => {
                if (window.SkillsPlugin && window.SkillsPlugin._domMounted) {
                    window.SkillsPlugin.applyI18n();
                    window.SkillsPlugin.render();
                }
            });
            const onDataReady = () => {
                const sp = window.SkillsPlugin;
                if (!sp) return;
                if (!sp._domMounted && document.getElementById('skills-plugin-root')) {
                    sp.init();
                } else if (sp._domMounted && window.DB && window.DB.db) {
                    sp._dbReady = true;
                    sp.refresh();
                }
            };
            window.addEventListener('aru-db-initialized', onDataReady);
            window.addEventListener('aru-sync-applied', onDataReady);
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

    roleIcon(role) {
        return {
            planner: 'compass',
            worker: 'wrench',
            critic: 'shield-check',
            synthesizer: 'sparkles'
        }[role] || 'wrench';
    },

    roleLabel(role) {
        const key = {
            planner: 'skills_role_planner',
            worker: 'skills_role_worker',
            critic: 'skills_role_critic',
            synthesizer: 'skills_role_synthesizer'
        }[role] || 'skills_role_worker';
        return this.getT(key, role || 'worker');
    },

    fmtDuration(ms) {
        const v = Number(ms || 0);
        if (!v || v < 1) return '';
        if (v >= 1000) return (v / 1000).toFixed(1) + 's';
        return Math.round(v) + 'ms';
    },

    fmtTokens(n) {
        const v = Math.round(n || 0);
        return v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(v);
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
            this.state.artifacts = window.DB.getSkillArtifacts ? window.DB.getSkillArtifacts(p.id) : [];
            localStorage.setItem('aru_skills_project', String(p.id));
        } else {
            this.state.items = [];
            this.state.steps = [];
            this.state.messages = [];
            this.state.artifacts = [];
        }
        this.state.expandedRuns = {};
        this.state.activeRunTab = {};
        this.state.editingStepRow = {};
        this.state.stepDrafts = {};
        this.state.runStepsCache = {};

        // Running state cannot survive a reload; paused checkpoints DO survive so the user can resume.
        this.state.messages.forEach(m => {
            if (m.kind !== 'run') return;
            const meta = this.parseMeta(m);
            if (meta.status === 'running') {
                this.setMsgMeta(m.id, {
                    status: 'error',
                    error: this.getT('skills_run_interrupted', 'Interrupted by page reload'),
                    note: '',
                    failedStageIndex: Math.max(0, (meta.index || 1) - 1)
                });
            } else if (meta.status === 'paused') {
                this.state.expandedRuns[m.id] = true;
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
        this.renderPipelineStrip();
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
            const activeSteps = this.state.steps.filter(s => s.enabled);
            const stagesCount = this._stagesFromSteps(activeSteps).length;
            subEl.innerText = `${stagesCount} · ${activeSteps.length}/${this.state.steps.length} · ${this.getT('skills_badge_ctx', 'ctx')} ${this.fmtTokens(p.context_limit)}`;
        } else {
            titleEl.innerText = this.getT('plugin_skills_name', 'Aru Skills');
            subEl.innerText = this.getT('plugin_skills_desc', 'Build skills and agent relays');
        }
    },

    _stagesFromSteps(activeSteps) {
        const skillById = {};
        (this.state.skills || []).forEach(s => { skillById[s.id] = s; });
        if (typeof this.buildExecutionStages === 'function') {
            return this.buildExecutionStages(activeSteps, skillById);
        }
        return (activeSteps || []).map((st, idx) => ({
            stageIndex: idx,
            steps: [st],
            isParallel: false,
            role: st.role || 'worker',
            pauseAfter: !!st.pause_after
        }));
    },

    renderPipelineStrip() {
        const strip = document.getElementById('skills-pipeline-strip');
        if (!strip) return;
        const p = this.activeProject();
        const activeSteps = (this.state.steps || []).filter(s => s.enabled);
        const stages = this._stagesFromSteps(activeSteps);
        if (!p || stages.length === 0) {
            strip.classList.add('hidden');
            strip.innerHTML = '';
            return;
        }

        // Pull live/last run stage statuses for visual telemetry on the strip
        const lastRunMsg = [...(this.state.messages || [])].reverse().find(m => m.kind === 'run');
        const lastRunMeta = lastRunMsg ? this.parseMeta(lastRunMsg) : null;
        const lastRows = (lastRunMeta && lastRunMeta.runId && (lastRunMeta.status === 'running' || lastRunMeta.status === 'paused'))
            ? this.runStepsFor(lastRunMeta.runId)
            : [];
        const statusByStepId = {};
        lastRows.forEach(r => {
            if (r.step_id) statusByStepId[r.step_id] = r.status;
        });

        const skillById = {};
        (this.state.skills || []).forEach(s => { skillById[s.id] = s; });

        const renderPill = (step, stageIdx) => {
            const sk = skillById[step.skill_id] || {};
            const role = typeof this.effectiveStepRole === 'function'
                ? this.effectiveStepRole(step, sk, stageIdx, stages.length)
                : (step.role || sk.role || 'worker');
            const stCls = statusByStepId[step.id] ? ` is-${statusByStepId[step.id]}` : '';
            const modelShort = String(step.skill_model_name || sk.model_name || step.skill_llm_type || '').split('/').pop().slice(0, 18);
            const revBadge = (role === 'critic' && Number(step.max_revisions) > 0)
                ? `<span class="skills-strip-tag" title="${this.esc(this.getT('skills_step_revisions', 'Auto-loop'))}">↻${Number(step.max_revisions)}</span>`
                : '';
            const pauseBadge = step.pause_after
                ? `<span class="skills-strip-tag is-pause" title="${this.esc(this.getT('skills_step_pause', 'Pause'))}">⏸</span>`
                : '';

            return `
            <button type="button" class="skills-strip-node role-${this.esc(role)}${stCls}"
                onclick="SkillsPlugin.focusRailStep(${step.id})"
                title="${this.esc((step.skill_title || sk.title || '—') + ' · ' + this.roleLabel(role))}">
                <span class="skills-strip-num">${stageIdx + 1}</span>
                <i data-lucide="${this.roleIcon(role)}" class="w-3.5 h-3.5 shrink-0"></i>
                <span class="skills-strip-name">${this.esc(step.skill_title || sk.title || '—')}</span>
                ${modelShort ? `<span class="skills-strip-model">${this.esc(modelShort)}</span>` : ''}
                ${revBadge}${pauseBadge}
            </button>`;
        };

        const html = stages.map((stage, idx) => {
            const inner = stage.isParallel
                ? `<div class="skills-strip-parallel">${stage.steps.map(st => renderPill(st, idx)).join('<span class="skills-strip-par-sep">‖</span>')}</div>`
                : renderPill(stage.steps[0], idx);
            const arrow = idx < stages.length - 1
                ? `<i data-lucide="chevron-right" class="w-3.5 h-3.5 skills-strip-arrow shrink-0"></i>`
                : '';
            return inner + arrow;
        }).join('');

        strip.classList.remove('hidden');
        strip.innerHTML = `
        <div class="skills-strip-wrap">
            <button type="button" class="skills-strip-scroll-btn is-left hidden"
                aria-label="Scroll left" onclick="SkillsPlugin.scrollPipelineStrip(-1)">
                <i data-lucide="chevron-left" class="w-3.5 h-3.5"></i>
            </button>
            <div class="skills-pipeline-strip-inner no-scrollbar" id="skills-pipeline-strip-track">${html}</div>
            <button type="button" class="skills-strip-scroll-btn is-right hidden"
                aria-label="Scroll right" onclick="SkillsPlugin.scrollPipelineStrip(1)">
                <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
            </button>
        </div>`;

        const track = document.getElementById('skills-pipeline-strip-track');
        if (track) {
            track.addEventListener('scroll', () => this.updatePipelineStripArrows(), { passive: true });
            track.addEventListener('wheel', (e) => {
                if (track.scrollWidth <= track.clientWidth + 2) return;
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.deltaY !== 0) {
                    e.preventDefault();
                    track.scrollLeft += e.deltaY;
                    this.updatePipelineStripArrows();
                }
            }, { passive: false });
        }
        if (typeof ResizeObserver === 'function' && !this._stripResizeObserver) {
            this._stripResizeObserver = new ResizeObserver(() => this.updatePipelineStripArrows());
            this._stripResizeObserver.observe(strip);
        }

        this.updatePipelineStripArrows();
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => this.updatePipelineStripArrows());
        }
    },

    updatePipelineStripArrows() {
        const strip = document.getElementById('skills-pipeline-strip');
        const track = document.getElementById('skills-pipeline-strip-track');
        if (!strip || !track) return;
        const wrap = strip.querySelector('.skills-strip-wrap');
        const leftBtn = strip.querySelector('.skills-strip-scroll-btn.is-left');
        const rightBtn = strip.querySelector('.skills-strip-scroll-btn.is-right');

        const overflow = track.scrollWidth > track.clientWidth + 2;
        const canLeft = overflow && track.scrollLeft > 4;
        const canRight = overflow && (track.scrollLeft + track.clientWidth) < (track.scrollWidth - 4);

        if (leftBtn) leftBtn.classList.toggle('hidden', !canLeft);
        if (rightBtn) rightBtn.classList.toggle('hidden', !canRight);
        if (wrap) {
            wrap.classList.toggle('has-left', canLeft);
            wrap.classList.toggle('has-right', canRight);
        }
    },

    scrollPipelineStrip(dir) {
        const track = document.getElementById('skills-pipeline-strip-track');
        if (!track) return;
        const step = Math.max(140, Math.round((track.clientWidth || 240) * 0.6));
        const delta = (dir < 0 ? -1 : 1) * step;
        if (typeof track.scrollBy === 'function') {
            track.scrollBy({ left: delta, behavior: 'smooth' });
        } else {
            track.scrollLeft = Math.max(0, track.scrollLeft + delta);
        }
        this.updatePipelineStripArrows();
        setTimeout(() => this.updatePipelineStripArrows(), 220);
    },

    focusRailStep(stepId) {
        this.state.railTab = 'pipeline';
        this.state.railOpen = true;
        this.renderRail();
        this.applyRailState();
        if (window.lucide) lucide.createIcons();
        const card = document.getElementById('skills-step-' + stepId);
        if (card && typeof card.scrollIntoView === 'function') {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('st-highlight');
            setTimeout(() => card.classList.remove('st-highlight'), 1100);
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
        const presets = typeof this.getStudioPresets === 'function' ? this.getStudioPresets() : [];
        const targetId = p ? p.id : 'null';

        const presetCards = presets.map(pr => `
            <button type="button" class="skills-preset-quick-card" onclick="SkillsPlugin.installPreset('${this.esc(pr.id)}', { targetProjectId: ${targetId} })">
                <div class="skills-preset-quick-top">
                    <span class="skills-preset-quick-icon"><i data-lucide="${this.esc(pr.icon)}" class="w-4 h-4"></i></span>
                    <span class="skills-chip">${this.esc(pr.badge)}</span>
                </div>
                <div class="skills-preset-quick-title">${this.esc(pr.title)}</div>
                <div class="skills-preset-quick-desc">${this.esc(pr.desc)}</div>
            </button>`).join('');

        let cta = '';
        if (!p) {
            cta = `<button type="button" class="btn-skills btn-skills-primary" onclick="SkillsPlugin.addProject()">
                <i data-lucide="plus" class="w-4 h-4"></i> ${this.esc(this.getT('skills_new_project', 'New Project'))}
            </button>`;
        } else if (this.state.steps.length === 0) {
            cta = `<button type="button" class="btn-skills btn-skills-outline" onclick="SkillsPlugin.toggleRail(true)">
                <i data-lucide="sliders" class="w-4 h-4"></i> ${this.esc(this.getT('skills_open_relay', 'Build the relay'))}
            </button>`;
        }

        return `
        <div class="skills-thread-empty">
            <div class="skills-logo skills-logo-lg"><i data-lucide="blocks" class="w-7 h-7"></i></div>
            <h3>${this.esc(this.getT('plugin_skills_name', 'Aru Skills'))}</h3>
            <p>${this.esc(this.getT('skills_thread_empty_hint', 'Describe a task — the skills of the relay pass it along and the last one answers.'))}</p>
            ${presetCards ? `<div class="skills-preset-quick-grid">${presetCards}</div>` : ''}
            ${cta ? `<div class="mt-2">${cta}</div>` : ''}
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

    updateMsg(id) {
        const el = document.getElementById('skills-msg-' + id);
        const m = this.state.messages.find(x => x.id === id);
        if (!el || !m) return;
        el.innerHTML = this.renderMsgInner(m);
        this.hydrateRich(el);
        this.renderPipelineStrip();
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

    selectRunTab(msgId, tabKey) {
        this.state.expandedRuns[msgId] = true;
        this.state.activeRunTab[msgId] = tabKey;
        this.updateMsg(msgId);
    },

    toggleEditStepRow(msgId, rowId) {
        this.state.editingStepRow[rowId] = !this.state.editingStepRow[rowId];
        if (this.state.editingStepRow[rowId]) {
            const row = window.DB.getSkillRunStep(rowId);
            if (row && this.state.stepDrafts[rowId] === undefined) {
                this.state.stepDrafts[rowId] = row.output_text || '';
            }
        }
        this.updateMsg(msgId);
    },

    onStepDraftInput(rowId, val) {
        this.state.stepDrafts[rowId] = val;
    },

    saveStepRowEdit(msgId, rowId) {
        const draft = this.state.stepDrafts[rowId];
        if (draft !== undefined) {
            window.DB.updateSkillRunStep(rowId, { output_text: String(draft), edited_by_user: 1 });
            delete this.state.stepDrafts[rowId];
        }
        delete this.state.editingStepRow[rowId];
        const msg = this.state.messages.find(m => m.id === msgId);
        const meta = msg ? this.parseMeta(msg) : {};
        if (meta.runId) delete this.state.runStepsCache[meta.runId];
        this.toast('skills_saved', 'save', 'Saved');
        this.updateMsg(msgId);
    },

    copyStepOutput(runId, rowId) {
        const row = this.runStepsFor(runId).find(r => r.id === rowId);
        if (!row || !row.output_text) return;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(row.output_text)
                .then(() => this.toast('skills_copied', 'copy', 'Copied to clipboard'))
                .catch(() => {});
        }
    },

    openStepArtifact(runId, rowId) {
        const row = this.runStepsFor(runId).find(r => r.id === rowId);
        if (!row || !row.output_text || typeof this.extractArtifacts !== 'function') return;
        const found = this.extractArtifacts(row.output_text);
        if (!found.length || !window.CanvasManager) return;
        const art = found[found.length - 1];
        const p = this.activeProject();
        const storageScope = (p && window.DB.getArtifactScopeKey)
            ? window.DB.getArtifactScopeKey({ source: 'skill', type: art.type, title: art.title, projectId: p.id })
            : null;
        const st = window.aruState;
        const tab = st && st.tabs[st.activeTabIndex];
        if (tab) {
            tab.artifact = { type: art.type, title: art.title, code: art.code, source: 'skill', storageScope };
            tab.isCanvasOpen = true;
        }
        window.CanvasManager.renderArtifact(art.type, art.title, art.code, { source: 'skill', storageScope });
    },

    renderRunMsg(m, meta) {
        const status = meta.status || 'running';
        const running = status === 'running';
        const paused = status === 'paused';
        const isErr = status === 'error';
        const expanded = !!this.state.expandedRuns[m.id];
        const total = meta.total || 0;
        const idx = meta.index || 0;
        const rows = this.runStepsFor(meta.runId);

        let head;
        if (meta.note) head = this.esc(meta.note);
        else if (total > 0 && idx > 0 && meta.title) head = `${idx}/${total} · ${this.esc(meta.title)}`;
        else if (total > 0) head = this.esc(this.getT('skills_relay_block', 'Relay')) + ' · ' + total;
        else head = this.esc(this.getT('skills_relay_block', 'Relay'));

        const iconName = running ? 'loader' : (paused ? 'pause-circle' : (isErr ? 'alert-triangle' : 'workflow'));
        let badge;
        if (running) badge = `<span class="skills-run-badge">${this.esc(this.getT('skills_status_running', 'Running'))}</span>`;
        else if (paused) badge = `<span class="skills-run-badge pause">${this.esc(this.getT('skills_status_paused', 'Paused'))}</span>`;
        else if (isErr) badge = `<span class="skills-run-badge err">${this.esc(this.getT('skills_status_error', 'Error'))}</span>`;
        else badge = `<span class="skills-run-badge ok">${this.esc(this.getT('skills_status_done', 'Done'))}</span>`;

        const miniPills = rows.length > 0 ? `
            <div class="skills-run-minipills no-scrollbar">
                ${rows.map(r => {
                    const dur = this.fmtDuration(r.duration_ms);
                    const ver = r.verdict === 'approve' ? ' ✓' : (r.verdict === 'revise' ? ' ↻' : '');
                    const iter = Number(r.iteration) > 1 ? ` v${r.iteration}` : '';
                    const isAct = expanded && (this.state.activeRunTab[m.id] === ('row-' + r.id));
                    return `
                    <button type="button" class="skills-mini-pill st-${this.esc(r.status || 'pending')}${isAct ? ' is-selected' : ''}"
                        onclick="SkillsPlugin.selectRunTab(${m.id}, 'row-${r.id}')">
                        <span>${(r.stage_index ?? 0) + 1}. ${this.esc(r.skill_title || '—')}${iter}${ver}</span>
                        ${dur ? `<span class="skills-mini-dur">${this.esc(dur)}</span>` : ''}
                    </button>`;
                }).join('')}
            </div>` : '';

        const inspector = expanded ? this.renderRunInspector(m, meta, rows) : '';

        return `
        <div class="skills-run-block${running ? ' is-running' : ''}${paused ? ' is-paused' : ''}${isErr ? ' is-error' : ''}">
            <button type="button" class="skills-run-head" onclick="SkillsPlugin.toggleRunMsg(${m.id})">
                <i data-lucide="${expanded ? 'chevron-down' : 'chevron-right'}" class="w-4 h-4 shrink-0"></i>
                <i data-lucide="${iconName}" class="w-4 h-4 shrink-0${running ? ' animate-spin' : ''}"></i>
                <span class="skills-run-head-text">${head}</span>
                ${badge}
                <span class="skills-msg-time">${this.esc(this.fmtTime(m, meta))}</span>
            </button>
            ${miniPills}
            ${expanded ? `<div class="skills-run-body">${inspector}</div>` : ''}
        </div>`;
    },

    renderRunInspector(m, meta, rows) {
        const status = meta.status || 'running';
        const tabs = [];
        const stageBranches = new Map();

        rows.forEach(r => {
            const sIdx = Number(r.stage_index ?? 0);
            if (!stageBranches.has(sIdx)) stageBranches.set(sIdx, []);
            stageBranches.get(sIdx).push(r);
            const dur = this.fmtDuration(r.duration_ms);
            const iter = Number(r.iteration) > 1 ? ` v${r.iteration}` : '';
            const ver = r.verdict === 'approve' ? ' ✓' : (r.verdict === 'revise' ? ' ↻' : '');
            tabs.push({
                key: `row-${r.id}`,
                kind: 'row',
                row: r,
                label: `${sIdx + 1}. ${r.skill_title || '—'}${iter}${ver}`,
                sub: dur,
                status: r.status
            });
        });

        // Add side-by-side Compare tab for any stage with >= 2 parallel branches
        stageBranches.forEach((branchRows, sIdx) => {
            const uniqueSteps = new Set(branchRows.map(r => r.step_id || r.skill_title));
            if (uniqueSteps.size >= 2) {
                tabs.push({
                    key: `compare-${sIdx}`,
                    kind: 'compare',
                    stageIndex: sIdx,
                    rows: branchRows,
                    label: `‖ ${sIdx + 1}. ${this.getT('skills_tab_compare', 'Compare')}`,
                    sub: String(branchRows.length),
                    status: 'done'
                });
            }
        });

        if (tabs.length === 0) {
            return meta.error ? `<div class="skills-run-step-error">${this.esc(meta.error)}</div>` : '';
        }

        let activeKey = this.state.activeRunTab[m.id];
        if (!activeKey || !tabs.some(t => t.key === activeKey)) {
            const priorityRow = rows.find(r => r.status === 'running')
                || rows.find(r => r.status === 'error')
                || rows[rows.length - 1];
            activeKey = priorityRow ? `row-${priorityRow.id}` : tabs[0].key;
            this.state.activeRunTab[m.id] = activeKey;
        }
        const activeTab = tabs.find(t => t.key === activeKey) || tabs[0];

        const tabsBar = `
        <div class="skills-inspector-tabs no-scrollbar">
            ${tabs.map(t => `
            <button type="button" class="skills-inspector-tab st-${this.esc(t.status || 'done')}${t.key === activeTab.key ? ' is-active' : ''}"
                onclick="SkillsPlugin.selectRunTab(${m.id}, '${this.esc(t.key)}')">
                <span>${this.esc(t.label)}</span>
                ${t.sub ? `<span class="skills-inspector-sub">${this.esc(t.sub)}</span>` : ''}
            </button>`).join('')}
        </div>`;

        let panelHTML = '';
        if (activeTab.kind === 'compare') {
            panelHTML = this._renderComparePanel(meta.runId, activeTab.rows);
        } else if (activeTab.row) {
            panelHTML = this._renderStepInspectorPanel(m.id, meta, activeTab.row);
        }

        let actionBar = '';
        if (status === 'paused' && !this.state.isRunning) {
            actionBar = `
            <div class="skills-hitl-bar">
                <span class="skills-hitl-hint"><i data-lucide="pause-circle" class="w-4 h-4 shrink-0"></i> ${this.esc(this.getT('skills_paused_hint', 'Inspect or edit the output above, then continue or finish right here.'))}</span>
                <div class="skills-hitl-actions">
                    <button type="button" class="btn-skills btn-skills-outline" onclick="SkillsPlugin.finalizePausedRun(${m.id})">
                        <i data-lucide="check" class="w-3.5 h-3.5"></i> ${this.esc(this.getT('skills_finish_here', 'Finish here'))}
                    </button>
                    <button type="button" class="btn-skills btn-skills-primary" onclick="SkillsPlugin.resumePausedRun(${m.id})">
                        <i data-lucide="play" class="w-3.5 h-3.5"></i> ${this.esc(this.getT('skills_resume_run', 'Continue relay'))}
                    </button>
                </div>
            </div>`;
        } else if (status === 'error' && !this.state.isRunning) {
            const retryStageIdx = Number(meta.failedStageIndex ?? Math.max(0, (meta.index || 1) - 1));
            actionBar = `
            <div class="skills-error-bar">
                ${meta.error ? `<div class="skills-run-step-error flex-1">${this.esc(meta.error)}</div>` : ''}
                <button type="button" class="btn-skills btn-skills-primary shrink-0" onclick="SkillsPlugin.retryRunFromStage(${m.id}, ${retryStageIdx})">
                    <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> ${this.esc(this.getT('skills_retry_failed', 'Retry from failed step'))}
                </button>
            </div>`;
        }

        return tabsBar + panelHTML + actionBar;
    },

    _renderComparePanel(runId, branchRows) {
        return `
        <div class="skills-compare-grid">
            ${branchRows.map((r, bIdx) => {
                const dur = this.fmtDuration(r.duration_ms);
                const hasArt = r.output_text && typeof this.extractArtifacts === 'function' && this.extractArtifacts(r.output_text).length > 0;
                return `
                <div class="skills-compare-col">
                    <div class="skills-compare-head">
                        <div class="min-w-0">
                            <div class="skills-compare-title">${bIdx + 1}. ${this.esc(r.skill_title || '—')}</div>
                            <div class="skills-compare-meta">${this.esc(r.provider || '')}${r.model ? ' · ' + this.esc(r.model) : ''}${dur ? ' · ' + this.esc(dur) : ''}</div>
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                            ${hasArt ? `<button type="button" class="btn-skills btn-skills-icon" title="${this.esc(this.getT('skills_open_canvas', 'Canvas'))}" onclick="SkillsPlugin.openStepArtifact(${runId}, ${r.id})"><i data-lucide="panel-right-open" class="w-3.5 h-3.5"></i></button>` : ''}
                            ${r.output_text ? `<button type="button" class="btn-skills btn-skills-icon" title="${this.esc(this.getT('skills_copy_answer', 'Copy'))}" onclick="SkillsPlugin.copyStepOutput(${runId}, ${r.id})"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>` : ''}
                        </div>
                    </div>
                    <div class="skills-compare-body">
                        ${r.error ? `<div class="skills-run-step-error">${this.esc(r.error)}</div>` : this.renderRich(r.output_text || '')}
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    },

    _renderStepInspectorPanel(msgId, meta, r) {
        const runId = meta.runId;
        const role = r.role || 'worker';
        const dur = this.fmtDuration(r.duration_ms);
        const tok = r.tokens_est ? `~${this.fmtTokens(r.tokens_est)} tok` : '';
        const hasArt = r.output_text && typeof this.extractArtifacts === 'function' && this.extractArtifacts(r.output_text).length > 0;
        const isEditing = !!this.state.editingStepRow[r.id];
        const draftVal = this.state.stepDrafts[r.id] !== undefined ? this.state.stepDrafts[r.id] : (r.output_text || '');

        let verdictPill = '';
        if (r.verdict === 'approve') {
            verdictPill = `<span class="skills-run-badge ok">VERDICT: APPROVE</span>`;
        } else if (r.verdict === 'revise') {
            verdictPill = `<span class="skills-run-badge warn">VERDICT: REVISE</span>`;
        }

        const bodyHTML = isEditing ? `
            <div class="skills-step-editor">
                <textarea class="skills-modal-input skills-step-editor-area" rows="10"
                    oninput="SkillsPlugin.onStepDraftInput(${r.id}, this.value)">${this.esc(draftVal)}</textarea>
                <div class="flex justify-end gap-2 mt-2">
                    <button type="button" class="btn-skills btn-skills-outline" onclick="SkillsPlugin.toggleEditStepRow(${msgId}, ${r.id})">${this.esc(this.getT('skills_cancel', 'Cancel'))}</button>
                    <button type="button" class="btn-skills btn-skills-primary" onclick="SkillsPlugin.saveStepRowEdit(${msgId}, ${r.id})"><i data-lucide="save" class="w-3.5 h-3.5"></i> ${this.esc(this.getT('skills_save_edit', 'Save edit'))}</button>
                </div>
            </div>`
            : (r.output_text ? `<div class="skills-io-body">${this.renderRich(r.output_text)}</div>` : '');

        return `
        <div class="skills-run-step">
            <div class="skills-inspector-bar">
                <div class="skills-inspector-info">
                    <span class="skills-chip"><i data-lucide="${this.roleIcon(role)}" class="w-3 h-3"></i> ${this.esc(this.roleLabel(role))}</span>
                    <span class="skills-run-step-meta">${this.esc(r.provider || '')}${r.model ? ' · ' + this.esc(r.model) : ''}${dur ? ' · ' + this.esc(dur) : ''}${tok ? ' · ' + this.esc(tok) : ''}</span>
                    ${verdictPill}
                    ${r.truncated ? `<span class="skills-run-badge warn" title="${this.esc(this.getT('skills_answer_truncated', 'The answer hit the output limit'))}">${this.esc(this.getT('skills_badge_truncated', 'cut off'))}</span>` : ''}
                    ${r.edited_by_user ? `<span class="skills-run-badge">${this.esc(this.getT('skills_edited_badge', 'edited'))}</span>` : ''}
                </div>
                <div class="skills-inspector-actions">
                    ${hasArt ? `<button type="button" class="btn-skills btn-skills-outline skills-btn-xs" onclick="SkillsPlugin.openStepArtifact(${runId}, ${r.id})"><i data-lucide="panel-right-open" class="w-3.5 h-3.5"></i> ${this.esc(this.getT('skills_open_canvas', 'Canvas'))}</button>` : ''}
                    ${r.output_text ? `<button type="button" class="btn-skills btn-skills-icon" title="${this.esc(this.getT('skills_copy_answer', 'Copy'))}" onclick="SkillsPlugin.copyStepOutput(${runId}, ${r.id})"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>` : ''}
                    ${(!this.state.isRunning && r.status === 'done') ? `<button type="button" class="btn-skills btn-skills-icon" title="${this.esc(this.getT('skills_edit_output', 'Edit'))}" onclick="SkillsPlugin.toggleEditStepRow(${msgId}, ${r.id})"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>` : ''}
                    ${!this.state.isRunning ? `<button type="button" class="btn-skills btn-skills-icon" title="${this.esc(this.getT('skills_retry_from_here', 'Restart from here'))}" onclick="SkillsPlugin.retryRunFromStage(${msgId}, ${r.stage_index ?? 0})"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i></button>` : ''}
                </div>
            </div>
            ${bodyHTML}
            ${r.error ? `<div class="skills-run-step-error">${this.esc(r.error)}</div>` : ''}
            ${r.input_text ? `
            <details class="skills-io">
                <summary>${this.esc(this.getT('skills_step_input', 'Input'))}</summary>
                <pre>${this.esc(r.input_text)}</pre>
            </details>` : ''}
        </div>`;
    },

    renderAnswerMsg(m, meta) {
        const label = meta.fromFinal
            ? this.getT('skills_answer_by_final', 'final step')
            : this.getT('skills_answer_by_step', 'last active step');
        const verifiedBadge = meta.verifiedBy
            ? `<span class="skills-chip ${meta.verdict === 'revised' ? 'is-revised' : 'is-verified'}">
                <i data-lucide="${meta.verdict === 'revised' ? 'refresh-cw' : 'shield-check'}" class="w-3 h-3"></i>
                ${this.esc(this.getT(meta.verdict === 'revised' ? 'skills_verified_revised' : 'skills_verified_approve', meta.verdict === 'revised' ? 'Fixed after review by %s' : 'Verified by %s').replace('%s', meta.verifiedBy))}
              </span>`
            : '';
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
                ${verifiedBadge}
                <span class="skills-answer-actions">
                    ${m.content ? `<button type="button" class="btn-skills btn-skills-icon" title="${this.esc(this.getT('skills_copy_answer', 'Copy answer'))}" onclick="SkillsPlugin.copyAnswer(${m.id})"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>` : ''}
                    <span class="skills-msg-time">${this.esc(this.fmtTime(m, meta))}</span>
                </span>
            </div>
            ${warn}
            ${m.content ? `<div class="skills-answer-body">${this.renderRich(m.content)}</div>` : ''}
            ${arts ? `<div class="skills-answer-arts">${arts}</div>` : ''}
        </div>`;
    },

    copyAnswer(id) {
        const m = this.state.messages.find(x => x.id === id);
        if (!m || !m.content) return;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(m.content)
                .then(() => this.toast('skills_copied', 'copy', 'Copied to clipboard'))
                .catch(() => {});
        }
    },

    renderArtifactCard(art) {
        const cfg = {
            game: { icon: 'gamepad-2', label: this.getT('skills_art_game', 'Aru Game') },
            app: { icon: 'layout', label: this.getT('skills_art_app', 'Aru App') },
            analytics: { icon: 'bar-chart-3', label: this.getT('skills_art_analytics', 'Aru Analytics') },
            doc: { icon: 'file-text', label: this.getT('skills_art_doc', 'Aru Doc') }
        }[art.type] || { icon: 'file-text', label: this.getT('skills_art_doc', 'Aru Doc') };
        const verTag = Number(art.version) > 1 ? `<span class="skills-chip">v${Number(art.version)}</span>` : '';
        return `
        <div class="skills-artifact-card" onclick="SkillsPlugin.openArtifact(${art.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();SkillsPlugin.openArtifact(${art.id});}" role="button" tabindex="0">
            <span class="skills-artifact-icon"><i data-lucide="${cfg.icon}" class="w-5 h-5"></i></span>
            <span class="min-w-0 flex-1" style="text-align: left;">
                <span class="skills-artifact-title">${this.esc(art.title)}</span>
                <span class="skills-artifact-type">${this.esc(cfg.label)}${art.step_title ? ' · ' + this.esc(art.step_title) : ''}</span>
            </span>
            ${verTag}
            <i data-lucide="eye" class="w-4 h-4" style="color: var(--skills-subtle);"></i>
        </div>`;
    },

    // ---------- right rail ----------

    toggleRail(force) {
        this.state.railOpen = (typeof force === 'boolean') ? force : !this.state.railOpen;
        this.applyRailState();
    },

    setRailTab(tab) {
        this.state.railTab = tab || 'pipeline';
        this.renderRail();
        if (window.lucide) lucide.createIcons();
    },

    applyRailState() {
        const rail = document.getElementById('skills-rail');
        const toggle = document.getElementById('skills-rail-toggle');
        const backdrop = document.getElementById('skills-rail-backdrop');
        const layout = document.getElementById('skills-layout');
        if (!rail) return;
        rail.classList.toggle('open', this.state.railOpen);
        if (toggle) toggle.classList.toggle('active', this.state.railOpen);
        const isNarrow = (layout ? layout.clientWidth <= 820 : false) || window.innerWidth <= 900;
        if (backdrop) backdrop.classList.toggle('hidden', !(this.state.railOpen && isNarrow));
        this.updatePipelineStripArrows();
        setTimeout(() => this.updatePipelineStripArrows(), 240);
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
                <button type="button" class="btn-skills btn-skills-outline" onclick="SkillsPlugin.openPresetsModal()">
                    <i data-lucide="sparkles" class="w-4 h-4"></i> ${this.esc(this.getT('skills_presets_btn', 'Templates'))}
                </button>
            </div>`;
            return;
        }

        const tab = this.state.railTab || 'pipeline';
        const artCount = (this.state.artifacts || []).length;
        const matCount = (this.state.items || []).length;
        const nav = `
        <div class="skills-rail-tabs" role="tablist">
            <button type="button" role="tab" class="skills-rail-tab${tab === 'pipeline' ? ' is-active' : ''}" onclick="SkillsPlugin.setRailTab('pipeline')">
                ${this.esc(this.getT('skills_rail_tab_pipeline', 'Pipeline'))}
            </button>
            <button type="button" role="tab" class="skills-rail-tab${tab === 'artifacts' ? ' is-active' : ''}" onclick="SkillsPlugin.setRailTab('artifacts')">
                ${this.esc(this.getT('skills_rail_tab_artifacts', 'Artifacts'))}${artCount ? ` (${artCount})` : ''}
            </button>
            <button type="button" role="tab" class="skills-rail-tab${tab === 'context' ? ' is-active' : ''}" onclick="SkillsPlugin.setRailTab('context')">
                ${this.esc(this.getT('skills_rail_tab_context', 'Context'))}${matCount ? ` (${matCount})` : ''}
            </button>
        </div>`;

        let tabHTML = '';
        if (tab === 'artifacts') tabHTML = this.renderRailArtifacts(p);
        else if (tab === 'context') tabHTML = this.renderRailMaterials() + this.renderRailContext(p);
        else tabHTML = this.renderRailRelay();

        body.innerHTML = nav + tabHTML;
        if (tab === 'pipeline') this.initTrackSortable();
    },

    renderRailRelay() {
        const active = this.state.steps.filter(s => s.enabled).length;
        return `
        <div class="skills-rail-section">
            <div class="skills-rail-head">
                <h4 class="skills-rail-title">${this.esc(this.getT('skills_pipeline_title', 'Relay'))}</h4>
                <div class="flex items-center gap-1.5">
                    <button type="button" class="btn-skills btn-skills-outline skills-btn-xs" onclick="SkillsPlugin.openPresetsModal()">
                        <i data-lucide="sparkles" class="w-3 h-3"></i> ${this.esc(this.getT('skills_presets_btn', 'Templates'))}
                    </button>
                    <span class="skills-chip">${active}/${this.state.steps.length}</span>
                </div>
            </div>
            ${this.state.steps.length === 0
                ? `<div class="skills-pipeline-placeholder">${this.esc(this.getT('skills_pipeline_empty', 'Add skills from the library to build the relay.'))}</div>`
                : `<div class="skills-relay-track" id="skills-relay-track">${this.state.steps.map((st, idx) => this.renderStepCard(st, idx)).join('')}</div>`}
            ${this.renderAddStepControl()}
        </div>`;
    },

    renderStepCard(st, idx) {
        const role = (st.role && this.VALID_ROLES?.has(st.role)) ? st.role : (st.skill_role || 'worker');
        const isParallel = idx > 0 && (st.parallel_with_prev === 1 || st.parallel_with_prev === true);
        const maxRev = Math.max(0, parseInt(st.max_revisions, 10) || 0);
        const inputMode = st.input_mode || 'auto';

        return `
        <div class="skills-step-card${st.enabled ? '' : ' is-disabled'}${isParallel ? ' is-parallel' : ''}" data-step-id="${st.id}" id="skills-step-${st.id}">
            <div class="skills-step-top">
                <i data-lucide="grip-vertical" class="skills-step-drag w-4 h-4 shrink-0"></i>
                <span class="skills-step-num">${isParallel ? '‖' : (idx + 1)}</span>
                <div class="min-w-0 flex-1">
                    <div class="skills-step-title" title="${this.esc(st.skill_title || '')}">${this.esc(st.skill_title || '—')}</div>
                    <div class="skills-step-meta">${this.esc(st.skill_llm_type || '')}${st.skill_model_name ? ' · ' + this.esc(st.skill_model_name) : ''}</div>
                </div>
                <label class="skills-switch" title="${this.esc(this.getT('skills_step_enabled', 'Toggle step'))}">
                    <input type="checkbox" ${st.enabled ? 'checked' : ''} onchange="SkillsPlugin.toggleStep(${st.id}, this.checked)">
                    <span class="skills-switch-slider"></span>
                </label>
            </div>

            <div class="skills-step-studio-controls">
                <select class="skills-step-role-select" onchange="SkillsPlugin.updateStepProp(${st.id}, 'role', this.value)" title="${this.esc(this.getT('skills_role_label', 'Role'))}">
                    <option value="planner" ${role === 'planner' ? 'selected' : ''}>${this.esc(this.getT('skills_role_planner', 'Plan / Architect'))}</option>
                    <option value="worker" ${role === 'worker' ? 'selected' : ''}>${this.esc(this.getT('skills_role_worker', 'Builder / Worker'))}</option>
                    <option value="critic" ${role === 'critic' ? 'selected' : ''}>${this.esc(this.getT('skills_role_critic', 'Critic / QA'))}</option>
                    <option value="synthesizer" ${role === 'synthesizer' ? 'selected' : ''}>${this.esc(this.getT('skills_role_synthesizer', 'Synthesizer / Final'))}</option>
                </select>
                ${role === 'critic' ? `
                <select class="skills-step-mini-select" onchange="SkillsPlugin.updateStepProp(${st.id}, 'max_revisions', parseInt(this.value, 10))" title="${this.esc(this.getT('skills_step_revisions', 'Auto-loop'))}">
                    <option value="0" ${maxRev === 0 ? 'selected' : ''}>↻ 0</option>
                    <option value="1" ${maxRev === 1 ? 'selected' : ''}>↻ 1</option>
                    <option value="2" ${maxRev === 2 ? 'selected' : ''}>↻ 2</option>
                </select>` : `
                <button type="button" class="skills-final-btn${inputMode === 'prev' ? ' is-active-soft' : ''}"
                    title="${this.esc(this.getT('skills_step_input_mode_title', 'Context passed to this step'))}"
                    onclick="SkillsPlugin.updateStepProp(${st.id}, 'input_mode', '${inputMode === 'prev' ? 'auto' : 'prev'}')">
                    ${this.esc(this.getT(inputMode === 'prev' ? 'skills_step_input_mode_prev' : 'skills_step_input_mode_auto', inputMode === 'prev' ? 'Prev only' : 'Auto'))}
                </button>`}
            </div>

            <div class="skills-step-status" id="skills-step-status-${st.id}"></div>
            <div class="skills-step-bottom">
                ${idx > 0 ? `
                <button type="button" class="skills-final-btn${isParallel ? ' is-parallel-on' : ''}"
                    title="${this.esc(this.getT('skills_step_parallel_title', 'Run in parallel with the previous step (Council)'))}"
                    onclick="SkillsPlugin.toggleStepBool(${st.id}, 'parallel_with_prev')">
                    ‖ ${this.esc(this.getT('skills_step_parallel', 'Parallel'))}
                </button>` : ''}
                <button type="button" class="skills-final-btn${st.pause_after ? ' is-pause-on' : ''}"
                    title="${this.esc(this.getT('skills_step_pause_title', 'Pause after this step to review or edit before continuing'))}"
                    onclick="SkillsPlugin.toggleStepBool(${st.id}, 'pause_after')">
                    <i data-lucide="pause" class="w-3 h-3"></i> ${this.esc(this.getT('skills_step_pause', 'Pause'))}
                </button>
                <button type="button" class="skills-final-btn${st.is_final ? ' is-final' : ''}"
                    title="${this.esc(this.getT(st.is_final ? 'skills_unset_final' : 'skills_set_final', 'Final step'))}"
                    onclick="SkillsPlugin.toggleFinal(${st.id})">
                    <i data-lucide="flag" class="w-3 h-3"></i> ${this.esc(this.getT('skills_step_final', 'Final'))}
                </button>
                <span class="skills-step-bottom-right">
                    <button type="button" class="btn-skills btn-skills-icon" title="${this.esc(this.getT('skills_edit_skill', 'Edit skill'))}" onclick="SkillsPlugin.openSkillModal(${st.skill_id})">
                        <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
                    </button>
                    <button type="button" class="btn-skills btn-skills-icon hover:!text-red-500" title="${this.esc(this.getT('skills_remove_step', 'Remove step'))}" onclick="SkillsPlugin.removeStep(${st.id})">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </span>
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

    renderRailArtifacts() {
        const list = this.state.artifacts || [];
        const rows = list.map(art => {
            const cfg = {
                game: { icon: 'gamepad-2', label: this.getT('skills_art_game', 'Aru Game') },
                app: { icon: 'layout', label: this.getT('skills_art_app', 'Aru App') },
                analytics: { icon: 'bar-chart-3', label: this.getT('skills_art_analytics', 'Aru Analytics') },
                doc: { icon: 'file-text', label: this.getT('skills_art_doc', 'Aru Doc') }
            }[art.type] || { icon: 'file-text', label: this.getT('skills_art_doc', 'Aru Doc') };
            return `
            <div class="skills-item-row">
                <span class="skills-artifact-icon" style="width:30px;height:30px;"><i data-lucide="${cfg.icon}" class="w-4 h-4"></i></span>
                <button type="button" class="min-w-0 flex-1 text-left bg-transparent border-0 p-0 cursor-pointer" onclick="SkillsPlugin.openArtifact(${art.id})">
                    <div class="skills-material-name">${this.esc(art.title)}</div>
                    <div class="skills-material-preview">${this.esc(cfg.label)} · v${Number(art.version || 1)}${art.step_title ? ' · ' + this.esc(art.step_title) : ''}</div>
                </button>
                <button type="button" class="btn-skills btn-skills-icon" title="${this.esc(this.getT('skills_copy_answer', 'Copy'))}" onclick="SkillsPlugin.copyArtifact(${art.id})">
                    <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                </button>
                <button type="button" class="btn-skills btn-skills-icon hover:!text-red-500" title="${this.esc(this.getT('skills_artifact_delete', 'Delete artifact'))}" onclick="SkillsPlugin.deleteArtifact(${art.id})">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </div>`;
        }).join('');

        return `
        <div class="skills-rail-section">
            <div class="skills-rail-head">
                <h4 class="skills-rail-title">${this.esc(this.getT('skills_rail_tab_artifacts', 'Artifacts'))}</h4>
                <span class="skills-chip">${list.length}</span>
            </div>
            ${list.length === 0
                ? `<p class="skills-rail-note">${this.esc(this.getT('skills_no_artifacts', 'No artifacts built yet in this project.'))}</p>`
                : `<div class="skills-materials">${rows}</div>`}
        </div>`;
    },

    renderRailMaterials() {
        const rows = this.state.items.map(it => {
            const isLink = it.kind === 'link';
            const contentStr = String(it.content || '');
            const failed = isLink && contentStr.indexOf('[LINK_FETCH_FAILED') === 0;
            const fetched = isLink && !failed && /^Title:\s/m.test(contentStr);
            const badge = isLink
                ? `<span class="skills-chip ${failed ? 'over' : (fetched ? 'is-verified' : '')}" style="padding:1px 6px;font-size:0.6rem;">${this.esc(this.getT(failed ? 'skills_link_badge_err' : 'skills_link_badge_ok', failed ? 'blocked' : 'fetched'))}</span>`
                : '';
            return `
            <div class="skills-item-row">
                <i data-lucide="${isLink ? 'link' : 'file-text'}" class="w-4 h-4 shrink-0" style="color: var(--skills-subtle);"></i>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                        <div class="skills-material-name">${this.esc(it.name)}</div>
                        ${badge}
                    </div>
                    <div class="skills-material-preview">${this.esc(contentStr.slice(0, 120))}</div>
                </div>
                ${isLink ? `
                <button type="button" class="btn-skills btn-skills-icon" title="${this.esc(this.getT('skills_link_retry', 'Re-fetch link'))}" onclick="SkillsPlugin.refreshMaterialLink(${it.id})">
                    <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
                </button>` : ''}
                <button type="button" class="btn-skills btn-skills-icon hover:!text-red-500" onclick="SkillsPlugin.deleteItem(${it.id})">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </div>`;
        }).join('');
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
        const quickCtx = [16384, 32768, 65536, 131072].map(v => `
            <button type="button" class="skills-final-btn${Number(p.context_limit) === v ? ' is-final' : ''}"
                onclick="SkillsPlugin.saveContext(${v})">${this.fmtTokens(v)}</button>`).join('');

        return `
        <div class="skills-rail-section">
            <div class="skills-rail-head">
                <h4 class="skills-rail-title">${this.esc(this.getT('skills_context_title', 'Context'))}</h4>
            </div>
            <div id="sk-estimate">${this.renderEstimateHtml(p)}</div>
            <div class="flex flex-wrap gap-1.5">${quickCtx}</div>
            <label class="skills-modal-label" for="sk-p-ctx">${this.esc(this.getT('skills_context_limit', 'Context limit (tokens)'))}</label>
            <input type="number" id="sk-p-ctx" class="skills-modal-input" min="1024" step="1024" value="${this.esc(p.context_limit)}"
                onchange="SkillsPlugin.saveContext(this.value)">
            <button type="button" class="skills-rail-clear" onclick="SkillsPlugin.clearThread()">
                <i data-lucide="eraser" class="w-4 h-4"></i> ${this.esc(this.getT('skills_clear_thread', 'Clear chat'))}
            </button>
        </div>`;
    },

    initTrackSortable() {
        if (this._trackSortable) {
            try { this._trackSortable.destroy(); } catch (_) {}
            this._trackSortable = null;
        }
        const track = document.getElementById('skills-relay-track');
        if (!track || typeof Sortable === 'undefined') return;
        this._trackSortable = Sortable.create(track, {
            animation: 150,
            delay: 200,
            delayOnTouchOnly: true,
            touchStartThreshold: 5,
            handle: '.skills-step-drag',
            draggable: '.skills-step-card',
            onEnd: () => {
                if (this.state.isRunning) {
                    this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
                    this.render();
                    return;
                }
                const ids = Array.from(track.querySelectorAll('.skills-step-card'))
                    .map(el => parseInt(el.getAttribute('data-step-id'), 10));
                window.DB.setPipelineOrder(this.state.activeProjectId, ids);
                this.state.steps = window.DB.getPipelineSteps(this.state.activeProjectId);
                this.render();
            }
        });
    },

    // ---------- composer ----------

    onSendClick() {
        if (this.state.isRunning) this.stopRun();
        else if (typeof this.send === 'function') this.send();
    },

    stopRun() {
        this._runStopped = true;
        if (this._abortController) {
            try { this._abortController.abort(); } catch (_) {}
        }
    },

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
            if (this.state.isRunning) {
                sendBtn.disabled = false;
                sendBtn.classList.add('is-stop');
                sendBtn.innerHTML = '<i data-lucide="square" class="w-4 h-4"></i>';
                sendBtn.title = this.getT('skills_stop', 'Stop relay');
            } else {
                sendBtn.classList.remove('is-stop');
                sendBtn.disabled = !p || (draft.trim().length === 0 && this.state.attachments.length === 0);
                sendBtn.innerHTML = '<i data-lucide="arrow-up" class="w-4 h-4"></i>';
                sendBtn.title = this.getT('skills_send', 'Send');
            }
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
        if (sendBtn && !this.state.isRunning) {
            sendBtn.disabled = !el.value.trim() && this.state.attachments.length === 0;
        }
        this.updateEstimate();
    },

    onComposerKey(e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            if (typeof this.send === 'function') this.send();
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
            window.UI.showToast(this.getT('skills_file_error', 'Could not read the file'), 'alert-circle');
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
                        window.UI.showToast(this.getT('skills_attach_limit', 'Up to 10 attachments per message'), 'alert-circle');
                        break;
                    }
                    this.state.attachments.push({ kind: 'file', name: file.name, content });
                }
            } catch (e) {
                console.warn('Skills: file parse failed', file.name, e);
                window.UI.showToast(this.getT('skills_file_error', 'Could not read the file') + ': ' + file.name, 'alert-circle');
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

    _extractUrlFromItem(item) {
        const content = String((item && item.content) || '');
        const lineMatch = /^URL:\s*(https?:\/\/\S+)/im.exec(content);
        if (lineMatch) return lineMatch[1].trim();
        const rawMatch = /(https?:\/\/[^\s\]"'<>]+)/i.exec(content);
        if (rawMatch) return rawMatch[1].trim();
        return '';
    },

    async addComposerLink() {
        const p = this.activeProject();
        if (!p) return;
        if (this.state.attachments.length >= this.MAX_ATTACH) {
            window.UI.showToast(this.getT('skills_attach_limit', 'Up to 10 attachments per message'), 'alert-circle');
            return;
        }
        const url = await window.UI.prompt(this.getT('skills_link_prompt', 'Paste a link'));
        if (!url || !url.trim()) return;
        const cleanUrl = url.trim();

        this.toast('skills_fetching_link', 'globe', 'Loading link…');
        const fetched = typeof this.fetchLinkContent === 'function'
            ? await this.fetchLinkContent(cleanUrl)
            : { ok: false, title: this.linkName(cleanUrl), text: cleanUrl };

        this.state.attachments.push({
            kind: 'link',
            name: fetched.title || this.linkName(cleanUrl),
            content: fetched.text || cleanUrl
        });
        if (!fetched.ok) {
            this.toast('skills_link_failed', 'alert-triangle', 'Could not fetch page text (saved error note)');
        }
        this.syncComposer();
    },

    async addMaterialLink() {
        const p = this.activeProject();
        if (!p) return;
        const url = await window.UI.prompt(this.getT('skills_link_prompt', 'Paste a link'));
        if (!url || !url.trim()) return;
        const cleanUrl = url.trim();

        this.toast('skills_fetching_link', 'globe', 'Loading link…');
        const fetched = typeof this.fetchLinkContent === 'function'
            ? await this.fetchLinkContent(cleanUrl)
            : { ok: false, title: this.linkName(cleanUrl), text: cleanUrl };

        window.DB.addSkillProjectItem(p.id, {
            kind: 'link',
            name: fetched.title || this.linkName(cleanUrl),
            content: fetched.text || cleanUrl
        });
        this.state.items = window.DB.getSkillProjectItems(p.id);
        this.renderRail();
        this.updateEstimate();
        if (fetched.ok) this.toast('skills_created', 'link', 'Added');
        else this.toast('skills_link_failed', 'alert-triangle', 'Could not fetch page text (saved error note)');
    },

    async refreshMaterialLink(itemId) {
        const p = this.activeProject();
        if (!p || this.state.isRunning) return;
        const item = this.state.items.find(it => it.id === itemId);
        if (!item) return;
        const url = this._extractUrlFromItem(item);
        if (!url || typeof this.fetchLinkContent !== 'function') return;

        this.toast('skills_fetching_link', 'refresh-cw', 'Loading link…');
        const fetched = await this.fetchLinkContent(url);
        window.DB.updateSkillProjectItem(itemId, {
            name: fetched.title || item.name,
            content: fetched.text || item.content
        });
        this.state.items = window.DB.getSkillProjectItems(p.id);
        this.renderRail();
        this.updateEstimate();
        if (fetched.ok) this.toast('skills_saved', 'check', 'Saved');
        else this.toast('skills_link_failed', 'alert-triangle', 'Could not fetch page text (saved error note)');
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

    _tokEstimate(text) {
        if (typeof this.estTokens === 'function') return this.estTokens(text);
        if (!text) return 0;
        const s = String(text);
        const cyr = (s.match(/[\u0400-\u04FF]/g) || []).length;
        return Math.ceil(cyr / 2.5 + (s.length - cyr) / 4);
    },

    computeEstimate(p) {
        const input = (p && this.state.drafts[p.id]) || '';
        const materials = typeof this.buildMaterialsBlock === 'function'
            ? this.buildMaterialsBlock(this.state.attachments)
            : '';
        const projCtx = typeof this.buildProjectContext === 'function'
            ? this.buildProjectContext()
            : '';
        const activeSteps = this.state.steps.filter(s => s.enabled);
        const skillById = {};
        this.state.skills.forEach(s => { skillById[s.id] = s; });

        const providers = new Set();
        let minSkillLimit = Infinity;
        let minSkillTitle = '';
        activeSteps.forEach(st => {
            const sk = skillById[st.skill_id];
            if (sk && sk.llm_type) providers.add(sk.llm_type);
            const rawLim = Number(sk && sk.input_limit);
            if (sk && rawLim > 0 && rawLim < minSkillLimit) {
                minSkillLimit = rawLim;
                minSkillTitle = sk.title || '';
            }
        });

        const baseTokens = this._tokEstimate(input) + this._tokEstimate(materials) + this._tokEstimate(projCtx) + 350;

        let totalIn = 0;
        let carried = 0;
        activeSteps.forEach(st => {
            const cur = skillById[st.skill_id];
            if (!cur) return;
            const rawLim = Number(cur.input_limit);
            const cap = rawLim > 0 ? Math.min(p.context_limit || 65536, rawLim) : (p.context_limit || 65536);
            totalIn += Math.min(baseTokens + carried + this._tokEstimate(cur.system_prompt), cap);
            carried += Number(cur.max_output) || 8192;
        });

        const limitWarning = (minSkillLimit < Infinity && minSkillLimit < (p.context_limit || 65536) && baseTokens > minSkillLimit)
            ? this.getT('skills_limit_warning', 'Active skill "%s" has a lower input limit (%s tok) and may clip context.')
                .replace('%s', minSkillTitle)
                .replace('%s', this.fmtTokens(minSkillLimit))
            : '';

        return {
            batonTokens: baseTokens,
            materialsTokens: this._tokEstimate(materials),
            inputTokens: this._tokEstimate(input),
            requests: activeSteps.length,
            providers: providers.size,
            totalIn,
            minSkillLimit: minSkillLimit < Infinity ? minSkillLimit : null,
            minSkillTitle,
            limitWarning
        };
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
            ${est.limitWarning ? `<div class="skills-est-warn"><i data-lucide="alert-triangle" class="w-3.5 h-3.5 shrink-0"></i><span>${this.esc(est.limitWarning)}</span></div>` : ''}
        </div>`;
    },

    updateEstimate() {
        const p = this.activeProject();
        if (!p) return;
        const wrap = document.getElementById('sk-estimate');
        if (wrap) wrap.innerHTML = this.renderEstimateHtml(p);
        const mini = document.getElementById('skills-composer-estimate');
        if (mini) {
            const est = this.computeEstimate(p);
            const over = est.batonTokens > p.context_limit || !!est.limitWarning;
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

    async addProject() {
        const name = await window.UI.prompt(this.getT('skills_project_name', 'Project name') + ':');
        if (!name || !name.trim()) return;
        const id = window.DB.createSkillProject(name.trim(), 65536);
        this.toast('skills_created', 'folder-plus', 'Created');
        this.state.projects = window.DB.getSkillProjects();
        this.closeModal();
        this.state.attachments = [];
        this.state.runError = '';
        this.state.activeProjectId = id;
        this.loadProject();
        this.render();
    },

    async renameProject(id) {
        const p = this.state.projects.find(x => x.id === id);
        if (!p) return;
        const name = await window.UI.prompt(this.getT('skills_project_name', 'Project name') + ':', p.title);
        if (!name || !name.trim()) return;
        window.DB.updateSkillProject(id, { title: name.trim() });
        this.toast('skills_saved', 'save', 'Saved');
        this.state.projects = window.DB.getSkillProjects();
        this.render();
        this.refreshModal();
    },

    async deleteProject(id) {
        if (this.state.isRunning) {
            this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
            return;
        }
        if (!(await window.UI.confirm(this.getT('skills_confirm_delete_project', 'Delete this project with all its files, pipeline and run history?')))) return;
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
        const ctx = Math.max(1024, parseInt(value, 10) || 65536);
        window.DB.updateSkillProject(p.id, { context_limit: ctx });
        this.state.projects = window.DB.getSkillProjects();
        this.toast('skills_saved', 'save', 'Saved');
        this.render();
    },

    async clearThread() {
        if (this.state.isRunning) {
            this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
            return;
        }
        const p = this.activeProject();
        if (!p) return;
        if (!(await window.UI.confirm(this.getT('skills_confirm_clear_thread', 'Delete the whole chat, runs and artifacts of this project?')))) return;
        window.DB.getSkillRuns(p.id, 1000).forEach(r => window.DB.deleteSkillRun(r.id));
        window.DB.getSkillArtifacts(p.id).forEach(a => window.DB.deleteSkillArtifact(a.id));
        window.DB.clearSkillProjectMessages(p.id);
        this.state.lastArtifactId = null;
        this.loadProject();
        this.render();
        this.toast('skills_deleted', 'trash-2', 'Deleted');
    },

    async deleteItem(id) {
        if (this.state.isRunning) {
            this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
            return;
        }
        if (!(await window.UI.confirm(this.getT('skills_confirm_delete_item', 'Remove this material from the project?')))) return;
        window.DB.deleteSkillProjectItem(id);
        const p = this.activeProject();
        if (p) this.state.items = window.DB.getSkillProjectItems(p.id);
        this.toast('skills_deleted', 'trash-2', 'Deleted');
        this.renderRail();
        this.updateEstimate();
    },

    addStep() {
        if (this.state.isRunning) {
            this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
            return;
        }
        const sel = document.getElementById('sk-add-step-skill');
        const p = this.activeProject();
        if (!sel || !sel.value || !p) return;
        const skillId = parseInt(sel.value, 10);
        const sk = this.state.skills.find(x => x.id === skillId);
        const role = (sk && sk.role) || 'worker';
        window.DB.addPipelineStep(p.id, skillId, {
            role,
            max_revisions: role === 'critic' ? 1 : 0
        });
        this.toast('skills_step_added', 'plus', 'Added');
        this.reloadSteps();
        this.render();
    },

    addToRelay(skillId) {
        if (this.state.isRunning) {
            this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
            return;
        }
        const p = this.activeProject();
        if (!p) return;
        const sk = this.state.skills.find(x => x.id === skillId);
        const role = (sk && sk.role) || 'worker';
        window.DB.addPipelineStep(p.id, skillId, {
            role,
            max_revisions: role === 'critic' ? 1 : 0
        });
        this.toast('skills_step_added', 'plus', 'Added');
        this.closeModal();
        this.reloadSteps();
        this.state.railTab = 'pipeline';
        this.render();
        this.toggleRail(true);
    },

    reloadSteps() {
        const p = this.activeProject();
        this.state.steps = p ? window.DB.getPipelineSteps(p.id) : [];
    },

    toggleStep(id, enabled) {
        if (this.state.isRunning) {
            this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
            this.renderRail();
            return;
        }
        window.DB.updatePipelineStep(id, { enabled: enabled ? 1 : 0 });
        this.reloadSteps();
        this.render();
    },

    updateStepProp(id, field, value) {
        if (this.state.isRunning) {
            this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
            this.renderRail();
            return;
        }
        const patch = { [field]: value };
        if (field === 'role' && value === 'critic') {
            const st = this.state.steps.find(x => x.id === id);
            if (st && !st.max_revisions) patch.max_revisions = 1;
        }
        window.DB.updatePipelineStep(id, patch);
        this.reloadSteps();
        this.render();
    },

    toggleStepBool(id, field) {
        if (this.state.isRunning) {
            this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
            return;
        }
        const st = this.state.steps.find(x => x.id === id);
        if (!st) return;
        window.DB.updatePipelineStep(id, { [field]: st[field] ? 0 : 1 });
        this.reloadSteps();
        this.render();
    },

    toggleFinal(id) {
        if (this.state.isRunning) {
            this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
            return;
        }
        const st = this.state.steps.find(x => x.id === id);
        if (!st) return;
        window.DB.updatePipelineStep(id, { is_final: st.is_final ? 0 : 1 });
        this.reloadSteps();
        this.render();
    },

    removeStep(id) {
        if (this.state.isRunning) {
            this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
            return;
        }
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

    // ---------- artifacts ----------

    openArtifact(id) {
        const art = window.DB.getSkillArtifact(id);
        if (!art || !window.CanvasManager) return;
        this.state.lastArtifactId = art.id;
        const storageScope = window.DB.getArtifactScopeKey
            ? window.DB.getArtifactScopeKey({ source: 'skill', type: art.type, title: art.title, projectId: art.project_id })
            : null;
        const st = window.aruState;
        const tab = st && st.tabs[st.activeTabIndex];
        if (tab) {
            tab.artifact = { type: art.type, title: art.title, code: art.code, source: 'skill', storageScope };
            tab.isCanvasOpen = true;
        }
        window.CanvasManager.renderArtifact(art.type, art.title, art.code, { source: 'skill', storageScope });
    },

    copyArtifact(id) {
        const art = window.DB.getSkillArtifact(id);
        if (!art || !art.code) return;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(art.code)
                .then(() => this.toast('skills_copied', 'copy', 'Copied to clipboard'))
                .catch(() => {});
        }
    },

    async deleteArtifact(id) {
        if (this.state.isRunning) {
            this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
            return;
        }
        if (!(await window.UI.confirm(this.getT('skills_confirm_delete_artifact', 'Delete this artifact from the project?')))) return;
        window.DB.deleteSkillArtifact(id);
        const p = this.activeProject();
        this.state.artifacts = p ? window.DB.getSkillArtifacts(p.id) : [];
        if (this.state.lastArtifactId === id) this.state.lastArtifactId = null;
        this.toast('skills_deleted', 'trash-2', 'Deleted');
        this.render();
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
        else if (this.state.modalKind === 'presets') this.openPresetsModal();
    },

    openPresetsModal() {
        this.state.modalKind = 'presets';
        this.openModal(this.getT('skills_nav_presets', 'Studio presets'), this.renderPresetsBody(), '48rem');
    },

    renderPresetsBody() {
        const presets = typeof this.getStudioPresets === 'function' ? this.getStudioPresets() : [];
        const p = this.activeProject();
        const canApplyCurrent = !!(p && this.state.steps.length === 0);

        const cards = presets.map(pr => {
            const chain = pr.steps.map((st, idx) => {
                const par = (idx > 0 && st.parallel_with_prev) ? '‖ ' : '';
                const arrow = idx > 0 && !st.parallel_with_prev ? '<span class="skills-preset-arrow">→</span>' : '';
                const rev = st.max_revisions ? ` ↻${st.max_revisions}` : '';
                return `${arrow}<span class="skills-chip">${this.esc(par + st.title + rev)}</span>`;
            }).join('');

            return `
            <div class="skills-card">
                <div class="skills-card-head">
                    <div class="skills-card-icon"><i data-lucide="${this.esc(pr.icon)}" class="w-4 h-4"></i></div>
                    <div class="min-w-0 flex-1">
                        <h4 class="skills-card-title">${this.esc(pr.title)}</h4>
                        <div class="skills-card-meta">${this.esc(pr.badge)}</div>
                    </div>
                </div>
                <p class="skills-card-preview">${this.esc(pr.desc)}</p>
                <div class="skills-preset-chain">${chain}</div>
                <div class="skills-card-actions">
                    ${canApplyCurrent ? `
                    <button type="button" class="btn-skills btn-skills-outline flex-1" onclick="SkillsPlugin.installPreset('${this.esc(pr.id)}', { targetProjectId: ${p.id} })">
                        ${this.esc(this.getT('skills_preset_apply_current', 'Use in open project'))}
                    </button>` : ''}
                    <button type="button" class="btn-skills btn-skills-primary flex-1" onclick="SkillsPlugin.installPreset('${this.esc(pr.id)}')">
                        <i data-lucide="plus" class="w-4 h-4"></i> ${this.esc(this.getT('skills_preset_create_new', 'Create new project'))}
                    </button>
                </div>
            </div>`;
        }).join('');

        return `
        <p class="text-xs mb-4" style="color: var(--skills-subtle);">${this.esc(this.getT('skills_presets_sub', 'Launch a proven multi-agent workflow in one click.'))}</p>
        <div class="skills-cards-grid">${cards}</div>`;
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
                        <span class="skills-modal-row-meta">${active}/${steps.length} · ${this.esc(this.getT('skills_badge_ctx', 'ctx'))} ${this.fmtTokens(p.context_limit)}</span>
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
        const tTemp = this.esc(this.getT('skills_badge_temp', 'temp'));
        const tIn = this.esc(this.getT('skills_badge_in', 'in'));
        const tOut = this.esc(this.getT('skills_badge_out', 'out'));
        const tKey = this.esc(this.getT('skills_badge_aru_key', 'aru key'));
        const cards = skills.map(s => {
            const role = s.role || 'worker';
            return `
            <div class="skills-card">
                <div class="skills-card-head">
                    <div class="skills-card-icon"><i data-lucide="${this.roleIcon(role)}" class="w-4 h-4"></i></div>
                    <div class="min-w-0 flex-1">
                        <h4 class="skills-card-title">${this.esc(s.title)}</h4>
                        <div class="skills-card-meta">${this.esc(providerLabel(s))}${s.model_name ? ' · ' + this.esc(s.model_name) : ''}</div>
                    </div>
                </div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    <span class="skills-chip">${this.esc(this.roleLabel(role))}</span>
                    <span class="skills-chip">${tTemp} ${this.esc(String(s.temperature))}</span>
                    <span class="skills-chip">${tIn} ${Number(s.input_limit) > 0 ? this.esc(this.fmtTokens(s.input_limit)) : '∞'}</span>
                    <span class="skills-chip">${tOut} ${this.esc(this.fmtTokens(s.max_output))}</span>
                    ${s.api_key ? '' : `<span class="skills-chip" title="${this.esc(this.getT('skills_api_key_hint', 'Leave empty to use the key from Aru settings.'))}">${tKey}</span>`}
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
            </div>`;
        }).join('');
        return `
        <div class="flex gap-2 mb-4 flex-wrap">
            <button type="button" class="btn-skills btn-skills-primary flex-1" onclick="SkillsPlugin.openSkillModal(null)">
                <i data-lucide="plus" class="w-4 h-4"></i> ${this.esc(this.getT('skills_new_skill', 'New Skill'))}
            </button>
            <button type="button" class="btn-skills btn-skills-outline" onclick="SkillsPlugin.openPresetsModal()">
                <i data-lucide="sparkles" class="w-4 h-4"></i> ${this.esc(this.getT('skills_presets_btn', 'Templates'))}
            </button>
        </div>
        ${skills.length === 0 ? `
        <div class="skills-empty">
            <i data-lucide="sparkles" class="w-14 h-14"></i>
            <p>${this.esc(this.getT('skills_no_skills', 'No skills yet. Create your first one.'))}</p>
        </div>` : `<div class="skills-cards-grid">${cards}</div>`}`;
    },

    // ---------- skills ----------

    _defaultModelForProvider(type) {
        const us = (window.aruState && window.aruState.userSettings) || {};
        if (type === 'gemini') return us.gemini_model || '';
        if (type === 'openrouter') return us.openrouter_model || '';
        return us.custom_model || '';
    },

    _modelDatalistOptionsHtml(provider) {
        const list = typeof this.getModelSuggestions === 'function' ? this.getModelSuggestions(provider) : [];
        return list.map(m => `<option value="${this.esc(m)}"></option>`).join('');
    },

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
            temperature: 0.5,
            input_limit: 32768,
            max_output: 8192,
            role: 'worker'
        };
        if (!s) {
            defaults.model_name = this._defaultModelForProvider(defaults.llm_type);
            if (defaults.llm_type === 'custom') defaults.base_url = us.custom_url || '';
        }
        const v = s ? Object.assign({ role: 'worker' }, s) : defaults;

        this.openModal(s ? this.getT('skills_skill_settings', 'Skill settings') : this.getT('skills_new_skill', 'New Skill'), `
            <div class="space-y-4">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="skills-modal-label" for="sk-f-title">${this.esc(this.getT('skills_skill_name', 'Name'))}</label>
                        <input type="text" id="sk-f-title" class="skills-modal-input" value="${this.esc(v.title)}"
                            placeholder="${this.esc(this.getT('skills_skill_name_placeholder', 'e.g. Developer'))}">
                    </div>
                    <div>
                        <label class="skills-modal-label" for="sk-f-role">${this.esc(this.getT('skills_role_label', 'Role'))}</label>
                        <select id="sk-f-role" class="skills-modal-input">
                            <option value="planner" ${v.role === 'planner' ? 'selected' : ''}>${this.esc(this.getT('skills_role_planner', 'Plan / Architect'))}</option>
                            <option value="worker" ${v.role === 'worker' || !v.role ? 'selected' : ''}>${this.esc(this.getT('skills_role_worker', 'Builder / Worker'))}</option>
                            <option value="critic" ${v.role === 'critic' ? 'selected' : ''}>${this.esc(this.getT('skills_role_critic', 'Critic / QA'))}</option>
                            <option value="synthesizer" ${v.role === 'synthesizer' ? 'selected' : ''}>${this.esc(this.getT('skills_role_synthesizer', 'Synthesizer / Final'))}</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label class="skills-modal-label" for="sk-f-prompt">${this.esc(this.getT('skills_system_prompt', 'System prompt'))}</label>
                    <textarea id="sk-f-prompt" class="skills-modal-input" rows="5"
                        placeholder="${this.esc(this.getT('skills_system_prompt_placeholder', 'You are an expert...'))}">${this.esc(v.system_prompt)}</textarea>
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
                        <input type="text" id="sk-f-model" list="sk-model-suggestions" class="skills-modal-input" value="${this.esc(v.model_name)}">
                        <datalist id="sk-model-suggestions">${this._modelDatalistOptionsHtml(v.llm_type || 'gemini')}</datalist>
                    </div>
                </div>
                <div id="sk-f-base-url-wrap" class="${v.llm_type === 'custom' ? '' : 'hidden'}">
                    <label class="skills-modal-label" for="sk-f-base-url">${this.esc(this.getT('skills_base_url', 'Base URL'))}</label>
                    <input type="text" id="sk-f-base-url" class="skills-modal-input" value="${this.esc(v.base_url)}" placeholder="http://localhost:11434/v1/chat/completions">
                </div>
                <div>
                    <label class="skills-modal-label" for="sk-f-key">${this.esc(this.getT('skills_api_key', 'API key'))}</label>
                    <input type="password" id="sk-f-key" class="skills-modal-input" value="${this.esc(v.api_key)}" autocomplete="off">
                    <p class="skills-field-hint">${this.esc(this.getT('skills_api_key_hint', 'Leave empty to use the key from Aru settings.'))}</p>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                        <label class="skills-modal-label" for="sk-f-temp">${this.esc(this.getT('skills_temperature', 'Temperature'))}</label>
                        <input type="number" id="sk-f-temp" class="skills-modal-input" min="0" max="2" step="0.1" value="${this.esc(String(v.temperature))}">
                    </div>
                    <div>
                        <label class="skills-modal-label" for="sk-f-in">${this.esc(this.getT('skills_input_limit', 'Input limit (tokens)'))}</label>
                        <input type="number" id="sk-f-in" class="skills-modal-input" min="0" step="1024" value="${this.esc(String(v.input_limit))}">
                    </div>
                    <div>
                        <label class="skills-modal-label" for="sk-f-out">${this.esc(this.getT('skills_max_output', 'Max output (tokens)'))}</label>
                        <input type="number" id="sk-f-out" class="skills-modal-input" min="256" step="512" value="${this.esc(String(v.max_output))}">
                    </div>
                </div>
                <p class="skills-field-hint !mt-1">${this.esc(this.getT('skills_input_limit_hint', 'Use 0 to inherit the project\'s full context limit.'))}</p>
                <div class="flex gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
                    <button type="button" class="btn-skills btn-skills-primary flex-1" onclick="SkillsPlugin.saveSkill()">
                        <i data-lucide="save" class="w-4 h-4"></i> ${this.esc(this.getT('skills_save', 'Save'))}
                    </button>
                    <button type="button" class="btn-skills btn-skills-outline" onclick="SkillsPlugin.cancelSkillModal()">
                        ${this.esc(this.getT('skills_cancel', 'Cancel'))}
                    </button>
                </div>
            </div>
        `, '36rem');
    },

    cancelSkillModal() {
        this.openLibraryModal();
    },

    onProviderChange() {
        const type = document.getElementById('sk-f-provider').value;
        const wrap = document.getElementById('sk-f-base-url-wrap');
        const urlEl = document.getElementById('sk-f-base-url');
        const modelEl = document.getElementById('sk-f-model');
        const listEl = document.getElementById('sk-model-suggestions');
        if (wrap) wrap.classList.toggle('hidden', type !== 'custom');
        if (urlEl) {
            if (type === 'custom' && !urlEl.value) {
                const us = (window.aruState && window.aruState.userSettings) || {};
                urlEl.value = us.custom_url || '';
            } else if (type !== 'custom') {
                urlEl.value = '';
            }
        }
        if (listEl) listEl.innerHTML = this._modelDatalistOptionsHtml(type);
        if (modelEl) {
            const cur = modelEl.value.trim();
            const us = (window.aruState && window.aruState.userSettings) || {};
            const knownDefaults = [us.gemini_model || '', us.openrouter_model || '', us.custom_model || ''].filter(Boolean);
            if (!cur || knownDefaults.includes(cur)) {
                modelEl.value = this._defaultModelForProvider(type);
            }
        }
    },

    saveSkill() {
        const title = document.getElementById('sk-f-title').value.trim();
        if (!title) return window.UI.showToast(this.getT('skills_title_required', 'Name is required'), 'alert-circle');
        const llmType = document.getElementById('sk-f-provider').value;
        const rawTemp = parseFloat(document.getElementById('sk-f-temp').value);
        const rawIn = parseInt(document.getElementById('sk-f-in').value, 10);
        const roleEl = document.getElementById('sk-f-role');
        const data = {
            title,
            role: (roleEl && roleEl.value) || 'worker',
            system_prompt: document.getElementById('sk-f-prompt').value,
            llm_type: llmType,
            api_key: document.getElementById('sk-f-key').value.trim(),
            base_url: llmType === 'custom' ? document.getElementById('sk-f-base-url').value.trim() : '',
            model_name: document.getElementById('sk-f-model').value.trim(),
            temperature: Math.min(2, Math.max(0, Number.isFinite(rawTemp) ? rawTemp : 0)),
            input_limit: Number.isFinite(rawIn) ? (rawIn <= 0 ? 0 : Math.max(256, rawIn)) : 32768,
            max_output: Math.max(256, parseInt(document.getElementById('sk-f-out').value, 10) || 8192)
        };
        if (this.state.editingSkillId) {
            window.DB.updateSkill(this.state.editingSkillId, data);
            this.toast('skills_saved', 'save', 'Saved');
        } else {
            window.DB.createSkill(data);
            this.toast('skills_created', 'sparkles', 'Created');
        }
        this.state.skills = window.DB.getSkills();
        this.reloadSteps();
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
            max_output: s.max_output,
            role: s.role || 'worker'
        });
        this.toast('skills_created', 'copy', 'Created');
        this.state.skills = window.DB.getSkills();
        this.render();
        this.refreshModal();
    },

    async deleteSkill(id) {
        if (this.state.isRunning) {
            this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
            return;
        }
        if (!(await window.UI.confirm(this.getT('skills_confirm_delete_skill', 'Delete this skill? It will be removed from all project pipelines.')))) return;
        window.DB.deleteSkill(id);
        this.toast('skills_deleted', 'trash-2', 'Deleted');
        this.state.skills = window.DB.getSkills();
        this.reloadSteps();
        this.render();
        this.refreshModal();
    },

    // ---------- rich markdown rendering ----------

    neutralizeHtml(text) {
        let source = String(text || '');
        if ((source.match(/```/g) || []).length % 2 === 1) source += '\n```';
        return source
            .split(/(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\s](?:[^$\n]*[^$\s])?\$)/g)
            .map((part, i) => (i % 2 === 1) ? part : part.replace(/</g, '&lt;'))
            .join('');
    },

    renderRich(text) {
        const safe = this.neutralizeHtml(text);
        const html = (window.UI && UI.parseMarkdownWithMath)
            ? UI.parseMarkdownWithMath(safe)
            : this.esc(safe);
        return `<div class="skills-rich prose prose-sm dark:prose-invert max-w-none">${html}</div>`;
    },

    hydrateRich(root) {
        if (!root || !window.UI || !UI.renderMath) return;
        root.querySelectorAll('.skills-rich').forEach(el => {
            try { UI.renderMath(el); } catch (e) { /* formulas stay as plain text */ }
        });
    },

    onActivate(payload = {}) {
        if (!this._domMounted || !document.getElementById('skills-plugin-root')) {
            this.init();
        } else {
            this.applyI18n();
            this.render();
        }
        if (payload && payload.tab && payload.tab.isCanvasOpen && this.state.lastArtifactId) {
            this.openArtifact(this.state.lastArtifactId);
        }
    },

    onDeactivate() {
        this.closeModal();
    },

    onClose() {
        this.closeModal();
        this.stopRun();
        if (this._trackSortable) {
            try { this._trackSortable.destroy(); } catch (_) {}
            this._trackSortable = null;
        }
        if (this._stripResizeObserver) {
            try { this._stripResizeObserver.disconnect(); } catch (_) {}
            this._stripResizeObserver = null;
        }
        this._domMounted = false;
    }
});

SkillsPlugin.init();
