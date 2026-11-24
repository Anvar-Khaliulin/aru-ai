/*
---ARU-LAB.SPACE---ALMATY---2026---
Aru Skills v2 — Multi-Agent Orchestration Engine:
  - Parallel council stages (Promise.allSettled)
  - Role-specific protocols (planner / worker / critic / synthesizer)
  - Auto-revision loops driven by Critic VERDICT
  - Human-in-the-loop checkpoints (pause, edit, resume) & stage retry
  - Cyrillic-aware token budgeting & real URL fetching via Network.fetch
---chat.aru-lab.space---PWA---
*/

window.SkillsPlugin = window.SkillsPlugin || {};

Object.assign(window.SkillsPlugin, {
    VALID_ROLES: new Set(['planner', 'worker', 'critic', 'synthesizer']),

    estTokens(text) {
        if (!text) return 0;
        const s = String(text);
        if (window.app && typeof window.app.tokenEstimator === 'function') {
            return window.app.tokenEstimator(s);
        }
        const cyr = (s.match(/[\u0400-\u04FF]/g) || []).length;
        return Math.ceil(cyr / 2.5 + (s.length - cyr) / 4);
    },

    clipMiddle(text, maxChars) {
        const t = String(text || '');
        const max = Math.max(256, Math.floor(maxChars || 0));
        if (t.length <= max) return t;
        const head = Math.floor(max * 0.6);
        const tail = Math.max(0, max - head - 16);
        return `${t.slice(0, head)}\n\n[...]\n\n${tail > 0 ? t.slice(-tail) : ''}`;
    },

    clipToTokens(text, maxTokens) {
        const t = String(text || '');
        if (!t) return '';
        const limit = Math.max(128, Math.floor(maxTokens || 0));
        const curTok = this.estTokens(t);
        if (curTok <= limit) return t;
        const charsPerToken = t.length / Math.max(1, curTok);
        const maxChars = Math.max(256, Math.floor(limit * charsPerToken * 0.94));
        return this.clipMiddle(t, maxChars);
    },

    looksTruncated(text, maxOutputTokens) {
        const t = String(text || '').trimEnd();
        if (!t) return false;
        if (((t.match(/```/g) || []).length % 2) === 1) return true;
        return !!(maxOutputTokens && this.estTokens(t) >= maxOutputTokens * 0.92);
    },

    effectiveStepRole(step, skill, stageIdx = 0, totalStages = 1) {
        const sRole = step && typeof step.role === 'string' ? step.role.trim().toLowerCase() : '';
        if (this.VALID_ROLES.has(sRole)) return sRole;
        const kRole = skill && typeof skill.role === 'string' ? skill.role.trim().toLowerCase() : '';
        if (this.VALID_ROLES.has(kRole)) return kRole;
        if (stageIdx === 0 && totalStages === 1) return 'worker';
        return 'worker';
    },

    buildExecutionStages(activeSteps, skillById = {}) {
        const raw = Array.isArray(activeSteps) ? activeSteps.filter(Boolean) : [];
        if (raw.length === 0) return [];

        const grouped = [];
        raw.forEach((step, idx) => {
            const joinPrev = idx > 0 && (step.parallel_with_prev === 1 || step.parallel_with_prev === true);
            if (joinPrev && grouped.length > 0) {
                grouped[grouped.length - 1].push(step);
            } else {
                grouped.push([step]);
            }
        });

        // Respect explicit is_final flag by stopping pipeline at that stage instead of wasting downstream calls
        let finalGroupIdx = -1;
        grouped.forEach((stepsInGroup, gIdx) => {
            if (stepsInGroup.some(st => st.is_final === 1 || st.is_final === true)) {
                finalGroupIdx = gIdx;
            }
        });
        const sliced = finalGroupIdx >= 0 ? grouped.slice(0, finalGroupIdx + 1) : grouped;

        return sliced.map((stepsInGroup, idx) => {
            const first = stepsInGroup[0];
            const firstSkill = skillById[first.skill_id] || null;
            const role = this.effectiveStepRole(first, firstSkill, idx, sliced.length);
            return {
                stageIndex: idx,
                steps: stepsInGroup,
                isParallel: stepsInGroup.length > 1,
                role,
                pauseAfter: stepsInGroup.some(st => st.pause_after === 1 || st.pause_after === true)
            };
        });
    },

    parseCriticVerdict(text) {
        const head = String(text || '').slice(0, 600);
        const m = /(?:^|[\s*>`_#\["'(])(?:VERDICT|ВЕРДИКТ)\s*[:\-–—]+\s*\*?\*?(APPROVE|APPROVED|REVISE|REJECT|ОДОБРЕНО|ПРИНЯТО|ДОРАБОТАТЬ|ИСПРАВИТЬ)/i.exec(head);
        if (!m) return '';
        const word = m[1].toUpperCase();
        if (word === 'APPROVE' || word === 'APPROVED' || word === 'ОДОБРЕНО' || word === 'ПРИНЯТО') return 'approve';
        return 'revise';
    },

    async getLLMModule() {
        if (!this._llmMod) {
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

    async getNetworkModule() {
        if (!this._networkMod) {
            if (window.Network && typeof window.Network.fetch === 'function') {
                this._networkMod = { Network: window.Network };
            } else {
                const url = new URL('js/modules/network.js', document.baseURI).href;
                this._networkMod = await import(url);
            }
        }
        return this._networkMod;
    },

    _extractReadablePage(rawHtml, url) {
        const raw = String(rawHtml || '');
        if (!raw.trim()) return { title: '', body: '' };

        if (typeof DOMParser !== 'undefined') {
            try {
                const doc = new DOMParser().parseFromString(raw, 'text/html');
                const title = (doc.title || '').replace(/\s+/g, ' ').trim();
                doc.querySelectorAll('script, style, noscript, svg, iframe, nav, footer, header').forEach(el => el.remove());
                const root = doc.querySelector('article, main') || doc.body;
                const text = ((root && root.textContent) || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
                if (text) return { title, body: text };
            } catch (_) { /* fall back to regex stripping */ }
        }

        const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
        const stripped = raw
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
            .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return { title: title || this.linkName(url), body: stripped };
    },

    async fetchLinkContent(rawUrl) {
        const url = String(rawUrl || '').trim();
        let parsed;
        try {
            parsed = new URL(url);
        } catch (_) {
            return {
                ok: false,
                url,
                title: this.linkName(url),
                text: `[LINK_FETCH_FAILED: Invalid URL] ${url}`,
                error: 'Invalid URL'
            };
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return {
                ok: false,
                url,
                title: this.linkName(url),
                text: `[LINK_FETCH_FAILED: Unsupported protocol ${parsed.protocol}] ${url}`,
                error: `Unsupported protocol ${parsed.protocol}`
            };
        }

        try {
            const mod = await this.getNetworkModule();
            const res = await mod.Network.fetch(url, { timeoutMs: 20000 }, 'general');
            if (!res || !res.ok) {
                const statusMsg = res ? `HTTP ${res.status}` : 'Network failure';
                return {
                    ok: false,
                    url,
                    title: this.linkName(url),
                    text: `[LINK_FETCH_FAILED: ${statusMsg}] ${url}`,
                    error: statusMsg
                };
            }
            const raw = await res.text();
            const isHtml = /<(?:!doctype|html|head|body|article|main|p|div)\b/i.test(raw);
            let title = this.linkName(url);
            let body = '';
            if (isHtml) {
                const extracted = this._extractReadablePage(raw, url);
                if (extracted.title) title = extracted.title;
                body = extracted.body;
            } else {
                body = String(raw || '').replace(/\r/g, '').trim();
            }

            if (!body) {
                return {
                    ok: false,
                    url,
                    title,
                    text: `[LINK_FETCH_FAILED: Empty page content] ${url}`,
                    error: 'Empty page content'
                };
            }

            const capped = body.length > 24000 ? `${body.slice(0, 24000)}\n\n[... truncated at 24000 chars]` : body;
            return {
                ok: true,
                url,
                title,
                text: `Title: ${title}\nURL: ${url}\n\n${capped}`,
                error: ''
            };
        } catch (err) {
            const msg = String((err && err.message) || err || 'Fetch failed');
            return {
                ok: false,
                url,
                title: this.linkName(url),
                text: `[LINK_FETCH_FAILED: ${msg}] ${url}`,
                error: msg
            };
        }
    },

    buildMaterialsBlock(extra) {
        const rows = (this.state.items || [])
            .map(it => `### ${it.name} (${it.kind === 'link' ? 'link' : 'file'})\n${it.content}`);
        (Array.isArray(extra) ? extra : []).forEach(a => rows.push(`### ${a.name} (${a.kind === 'link' ? 'link' : 'file'})\n${a.content}`));
        return rows.join('\n\n');
    },

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

    buildRoleProtocol({ stageNo, totalStages, skillTitle, skillPrompt, role, isLastStage, isParallel, isRevision, iteration, willAutoRevise }) {
        const parts = [];
        if (skillPrompt && String(skillPrompt).trim()) {
            parts.push(`=== YOUR PERSONA & EXPERTISE ===\n${String(skillPrompt).trim()}`);
        }

        const runLabel = [
            `role: ${role}`,
            isParallel ? 'parallel council branch' : '',
            isRevision ? `revision pass #${Math.max(1, (iteration || 2) - 1)}` : ''
        ].filter(Boolean).join(', ');

        const lines = [
            '=== ORCHESTRATION CONTRACT ===',
            `You are "${skillTitle}" executing Stage ${stageNo} of ${totalStages} (${runLabel}).`,
            '',
            'Input sections:',
            '=== TASK ===             the original user request',
            '=== PROJECT CONTEXT ===  prior completed exchanges & artifacts in this project (when present)',
            '=== MATERIALS ===        project files, fetched links, and current attachments',
            '=== WEB SEARCH ===       fresh web search snippets (when enabled)',
            '=== DONE SO FAR ===      outputs produced by preceding stages',
            '=== REVISION FEEDBACK === critic report you must address now (present on revision passes)',
            '=== YOUR JOB ===         concrete expectation for this execution',
            '',
            'Universal rules:',
            '1. Zero filler greetings, meta-commentary about pipelines, or narrating what you are about to do.',
            '2. Answer in the exact same language as === TASK ===.',
            '3. Treat === WEB SEARCH === and === MATERIALS === as factual ground truth. If a material says [LINK_FETCH_FAILED], never fabricate its contents.',
            '4. If === TASK === asks to modify or improve work from === PROJECT CONTEXT ===, update it directly rather than giving generic advice.'
        ];

        if (role === 'planner') {
            lines.push(
                '',
                'ROLE CONTRACT — PLANNER / ARCHITECT:',
                '- Produce a crisp, high-signal blueprint: architecture, state model, edge cases, UI/mobile controls, data structures, or report outline.',
                '- Aim for clear structured Markdown under ~1200 tokens.',
                '- Do NOT output full HTML/JS source files or [[ARU_ARTIFACT]] tags — downstream stages implement the build.'
            );
        } else if (role === 'worker') {
            lines.push(
                '',
                'ROLE CONTRACT — BUILDER / WORKER:',
                '- Produce the COMPLETE, substantial deliverable — NEVER summarize or skip implementation details. There is NO artificial length limit.',
                '- If the task needs an app, game, interactive tool, dashboard, or rich document, emit the FULL runnable deliverable inside an artifact tag:',
                '[[ARU_ARTIFACT type="app" title="Short Title"]]',
                'complete self-contained raw HTML/CSS/JS or Markdown here — zero placeholders, zero TODOs, zero "..." omissions',
                '[[/ARU_ARTIFACT]]',
                '- Put raw source inside [[ARU_ARTIFACT]] (do NOT wrap the whole payload in ``` markdown fences).',
                '- Allowed artifact types: app (single-file HTML/CSS/JS web app), game (playable single-file HTML5 game with keyboard + mouse/touch controls and clean restart), analytics (interactive HTML dashboard/charts), doc (comprehensive Markdown document).',
                '- Downstream reviewers or the user will inspect your COMPLETE deliverable directly.'
            );
            if (isRevision) {
                lines.push('- THIS IS A REVISION PASS: Fix EVERY issue listed in === REVISION FEEDBACK === and emit the FULL updated deliverable cleanly.');
            }
            if (isParallel) {
                lines.push('- THIS IS A PARALLEL BRANCH: Deliver your strongest independent solution from your unique persona angle.');
            }
            if (isLastStage) {
                lines.push('- You are also the final output stage: keep prose outside [[ARU_ARTIFACT]] concise and ready for the user.');
            }
        } else if (role === 'critic') {
            lines.push(
                '',
                'ROLE CONTRACT — CRITIC / QA REVIEWER:',
                '- Thoroughly audit the preceding deliverable against === TASK === and === MATERIALS ===.',
                '- Check real syntax/DOM IDs, event listeners, restart/state leaks, responsive mobile layout, math/calculations, and edge cases.'
            );
            if (willAutoRevise) {
                lines.push(
                    '- CRITICAL: Your VERY FIRST LINE MUST be either:',
                    '  VERDICT: APPROVE   (if solid and ready to deliver without breaking issues)',
                    '  VERDICT: REVISE    (if there are real bugs, broken controls/logic, or missing core requirements)',
                    '- On REVISE, provide numbered, specific, actionable fixes with exact code/formula corrections.',
                    '- Do NOT emit [[ARU_ARTIFACT]] tags.'
                );
            } else if (!isLastStage) {
                lines.push(
                    '- Start with VERDICT: APPROVE or VERDICT: REVISE followed by concrete actionable fixes for the next stage.',
                    '- Do NOT emit [[ARU_ARTIFACT]] tags.'
                );
            } else {
                lines.push('- Give an honest verdict (VERDICT: APPROVE or VERDICT: REVISE) and clear findings; do NOT invent a brand new app unless requested.');
            }
        } else {
            lines.push(
                '',
                'ROLE CONTRACT — SYNTHESIZER / FINAL EDITOR:',
                '- Synthesize all parallel branches or apply Critic feedback onto the Worker deliverable into ONE polished, coherent final answer for the user.',
                '- Briefly highlight key synthesis choices when merging parallel branches; never expose raw pipeline scaffolding.',
                '- When the deliverable is an app, game, analytics dashboard, or structured document, output the complete finished result inside:',
                '[[ARU_ARTIFACT type="app" title="Short Title"]]',
                'complete self-contained raw HTML/CSS/JS or Markdown here — zero placeholders or omissions',
                '[[/ARU_ARTIFACT]]',
                '- Keep raw source inside [[ARU_ARTIFACT]] (do NOT wrap the whole artifact in ``` markdown fences).'
            );
        }

        parts.push(lines.join('\n'));
        return parts.join('\n\n');
    },

    buildStageBaton(project, step, skill, input, prevStages, opts = {}) {
        const rawSkillLimit = Number(skill && skill.input_limit);
        const projectLimit = Number(project && project.context_limit) || 65536;
        const limitTokens = rawSkillLimit > 0 ? Math.min(projectLimit, rawSkillLimit) : projectLimit;

        const sysTokens = opts.systemInstruction ? this.estTokens(opts.systemInstruction) : 350;
        const avail = Math.max(1500, limitTokens - sysTokens - 250);

        const hasPrev = Array.isArray(prevStages) && prevStages.length > 0;
        const isRevision = !!opts.isRevision;
        const inputMode = (step && step.input_mode) || 'auto';
        const materials = typeof opts.materials === 'string'
            ? opts.materials
            : this.buildMaterialsBlock(opts.materials || []);
        const search = String(opts.search || '');
        const projectContext = String(opts.projectContext || '');

        let taskBlock = '';
        let matBlock = '';
        let searchBlock = '';
        let projectBlock = '';
        let workBlock = '';
        let revFeedbackBlock = '';

        if (!hasPrev && !isRevision) {
            taskBlock = this.clipToTokens(input, Math.max(800, Math.floor(avail * 0.30)));
            const usedT = this.estTokens(taskBlock);
            const rem1 = Math.max(600, avail - usedT);
            matBlock = materials ? this.clipToTokens(materials, Math.floor(rem1 * 0.50)) : '';
            searchBlock = search ? this.clipToTokens(search, Math.floor(rem1 * 0.22)) : '';
            const usedTMS = usedT + this.estTokens(matBlock) + this.estTokens(searchBlock);
            const projCap = Math.max(400, avail - usedTMS - 120);
            projectBlock = projectContext ? this.clipToTokens(projectContext, projCap) : '';
        } else {
            taskBlock = this.clipToTokens(input, Math.max(700, Math.floor(avail * 0.20)));
            matBlock = materials ? this.clipToTokens(materials, Math.floor(avail * 0.14)) : '';
            searchBlock = search ? this.clipToTokens(search, Math.floor(avail * 0.08)) : '';
            const usedTMS = this.estTokens(taskBlock) + this.estTokens(matBlock) + this.estTokens(searchBlock) + 160;

            const rawProjTok = projectContext ? this.estTokens(projectContext) : 0;
            const projFloor = Math.min(rawProjTok, Math.floor(avail * 0.18));
            const workBudget = Math.max(1200, avail - usedTMS - projFloor);

            if (isRevision && opts.revisionContext) {
                const rc = opts.revisionContext;
                const priorStages = prevStages.filter(st => st.stageIndex < (rc.targetStageIndex ?? 999));
                const priorShare = priorStages.length ? Math.floor(workBudget * 0.15) : 0;
                const delivShare = Math.floor((workBudget - priorShare) * 0.65);
                const criticShare = Math.max(400, workBudget - priorShare - delivShare);

                if (priorStages.length) {
                    const each = Math.max(300, Math.floor(priorShare / priorStages.length));
                    workBlock = priorStages.map(st => this._formatDoneStage(st, each)).join('\n\n');
                }
                const prevDeliv = this.clipToTokens(rc.previousText || '', delivShare);
                const prevCritic = this.clipToTokens(rc.criticText || '', criticShare);
                workBlock = [
                    workBlock,
                    `=== PREVIOUS DELIVERABLE TO FIX ===\n${prevDeliv}`
                ].filter(Boolean).join('\n\n');
                revFeedbackBlock = `=== REVISION FEEDBACK (from ${rc.criticTitle || 'Critic'}) ===\n${prevCritic}`;
            } else {
                const relevant = (inputMode === 'prev' && prevStages.length > 1)
                    ? [prevStages[prevStages.length - 1]]
                    : prevStages;
                const n = relevant.length;
                if (n === 1) {
                    workBlock = this._formatDoneStage(relevant[0], workBudget);
                } else {
                    let remainingWorkBudget = workBudget;
                    const formatted = new Array(n);
                    const lastBudget = Math.floor(workBudget * 0.78);
                    formatted[n - 1] = this._formatDoneStage(relevant[n - 1], lastBudget);
                    remainingWorkBudget = Math.max(300, workBudget - this.estTokens(formatted[n - 1]));
                    const perEarlier = Math.max(250, Math.floor(remainingWorkBudget / (n - 1)));
                    for (let i = 0; i < n - 1; i++) {
                        formatted[i] = this._formatDoneStage(relevant[i], perEarlier);
                    }
                    workBlock = formatted.join('\n\n');
                }
            }

            if (projectContext) {
                const usedAll = usedTMS + this.estTokens(workBlock) + this.estTokens(revFeedbackBlock);
                const leftover = Math.max(projFloor, avail - usedAll - 80);
                projectBlock = this.clipToTokens(projectContext, leftover);
            }
        }

        const role = opts.effectiveRole || 'worker';
        let job = 'Perform your role cleanly within the pipeline.';
        if (isRevision) {
            job = 'Apply every correction from === REVISION FEEDBACK === to === PREVIOUS DELIVERABLE TO FIX === and emit the complete corrected deliverable.';
        } else if (role === 'planner') {
            job = 'Analyze the task and materials, and produce a clean architectural plan / specification for downstream stages.';
        } else if (role === 'critic') {
            job = 'Audit the preceding deliverable rigorously, issue your VERDICT line first, and detail any fixes needed.';
        } else if (role === 'synthesizer' || opts.isLastStage) {
            job = 'Synthesize and refine all completed work into the final user-ready answer (including complete [[ARU_ARTIFACT]] when appropriate).';
        } else if (!hasPrev) {
            job = 'Open the relay and produce complete foundational work in your role.';
        } else {
            job = 'Build on the preceding stages in your role and pass forward a complete deliverable.';
        }

        return [
            `=== TASK ===\n${taskBlock}`,
            projectBlock ? `=== PROJECT CONTEXT ===\n${projectBlock}` : '',
            matBlock ? `=== MATERIALS ===\n${matBlock}` : '',
            searchBlock ? `=== WEB SEARCH ===\n${searchBlock}` : '',
            workBlock ? `=== DONE SO FAR ===\n${workBlock}` : '',
            revFeedbackBlock || '',
            `=== YOUR JOB ===\n${job}`
        ].filter(Boolean).join('\n\n');
    },

    _formatDoneStage(stageEntry, tokenBudget) {
        const outs = (stageEntry && stageEntry.outputs) || [];
        if (outs.length === 0) return '';
        const sNo = (stageEntry.stageIndex || 0) + 1;
        if (outs.length === 1) {
            const o = outs[0];
            const cutTag = o.truncated ? ' [CUT OFF]' : '';
            const verTag = o.verdict ? ` [VERDICT: ${String(o.verdict).toUpperCase()}]` : '';
            const body = this.clipToTokens(o.text || '', Math.max(300, tokenBudget - 25));
            return `[Stage ${sNo} - ${o.skillTitle} (${o.role || 'worker'})]${verTag}${cutTag}\n${body}`;
        }
        const perBranch = Math.max(250, Math.floor((tokenBudget - 30 * outs.length) / outs.length));
        return outs.map((o, bIdx) => {
            const cutTag = o.truncated ? ' [CUT OFF]' : '';
            const body = this.clipToTokens(o.text || '', perBranch);
            return `[Stage ${sNo} - Branch ${bIdx + 1}: ${o.skillTitle} (${o.role || 'worker'})]${cutTag}\n${body}`;
        }).join('\n\n');
    },

    artifactAttribute(attrs, name) {
        const key = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\b${key}\\s*=\\s*(?:&quot;([\\s\\S]*?)&quot;|"([^"]*)"|'([^']*)'|([^\\s\\]]+))`, 'i');
        const match = re.exec(String(attrs || ''));
        return match ? (match[1] || match[2] || match[3] || match[4] || '').trim() : '';
    },

    normalizeArtifactCode(code, type) {
        let value = String(code || '').trim();
        const fenceCount = (value.match(/```/g) || []).length;
        const wrapped = fenceCount === 2
            ? /^```[^\r\n]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(value)
            : null;
        if (wrapped) value = wrapped[1].trim();

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

    extractArtifacts(text) {
        const src = String(text || '');
        const found = [];
        const re = /\[{1,2}\s*ARU[\s_-]*ARTIFACT\b([^\]]*)\]{1,2}([\s\S]*?)\[{1,2}\s*\/\s*ARU[\s_-]*ARTIFACT\s*\]{1,2}/gi;
        let m;
        while ((m = re.exec(src)) !== null) {
            const type = this.artifactAttribute(m[1], 'type').toLowerCase();
            const normalizedType = ['app', 'game', 'analytics', 'doc'].includes(type) ? type : 'doc';
            const code = this.normalizeArtifactCode(m[2], normalizedType);
            if (!code) continue;
            found.push({
                type: normalizedType,
                title: this.artifactAttribute(m[1], 'title') || this.getT('skills_default_artifact', 'Artifact'),
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

    stripArtifacts(text, artifacts) {
        let out = String(text || '');
        (artifacts || []).forEach(a => {
            if (a.full) out = out.replace(a.full, '');
        });
        out = out.replace(/\[{1,2}\s*ARU[\s_-]*ARTIFACT[\s\S]*?\]{1,2}/gi, '')
            .replace(/\[{1,2}\s*\/\s*ARU[\s_-]*ARTIFACT\s*\]{1,2}/gi, '');
        return out.replace(/\n{3,}/g, '\n\n').trim();
    },

    resolveSkillLLM(skill) {
        const us = (window.aruState && window.aruState.userSettings) || {};
        const type = (skill && skill.llm_type) || 'gemini';
        let apiKey = (skill && skill.api_key) || '';
        let baseUrl = (skill && skill.base_url) || '';
        let modelName = (skill && skill.model_name) || '';
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
        if (!isAuto) return title;
        const taken = (t) => !!(window.DB && window.DB.getSkillArtifactByTitle && window.DB.getSkillArtifactByTitle(projectId, t));
        if (!taken(title)) return title;
        let n = 2;
        while (taken(`${title} ${n}`)) n++;
        return `${title} ${n}`;
    },

    _outputCapFor(skill, role) {
        const raw = Number(skill && skill.max_output) || 0;
        if (role === 'worker' || role === 'synthesizer') {
            return Math.max(4096, raw || 8192);
        }
        return Math.max(1024, raw || 4096);
    },

    async _runSingleStepCall({ project, stage, step, skill, skillById, totalStages, runId, stepOrder, iteration, doneStages, input, materials, searchBlock, projectContext, controller, revisionContext }) {
        const role = this.effectiveStepRole(step, skill, stage.stageIndex, totalStages);
        const isLastStage = stage.stageIndex === totalStages - 1;
        const maxRevisions = Math.max(0, parseInt(step.max_revisions, 10) || 0);
        const targetStageAvailable = doneStages.some(d => d.role === 'worker' || !d.isParallel);
        const willAutoRevise = role === 'critic' && maxRevisions > 0 && targetStageAvailable && iteration <= maxRevisions;

        const sysPrompt = this.buildRoleProtocol({
            stageNo: stage.stageIndex + 1,
            totalStages,
            skillTitle: skill.title,
            skillPrompt: skill.system_prompt || '',
            role,
            isLastStage,
            isParallel: stage.isParallel,
            isRevision: !!revisionContext,
            iteration,
            willAutoRevise
        });

        const baton = this.buildStageBaton(project, step, skill, input, doneStages, {
            materials,
            search: searchBlock,
            projectContext,
            isParallel: stage.isParallel,
            isRevision: !!revisionContext,
            revisionContext,
            effectiveRole: role,
            isLastStage,
            systemInstruction: sysPrompt
        });

        const cfg = this.resolveSkillLLM(skill);
        const outputCap = this._outputCapFor(skill, role);
        const stepRowId = window.DB.addSkillRunStep(runId, {
            step_id: step.id,
            step_order: stepOrder,
            skill_id: skill.id,
            skill_title: skill.title,
            provider: cfg.type,
            model: cfg.modelName || skill.model_name || '',
            input_text: baton,
            status: 'running',
            stage_index: stage.stageIndex,
            role,
            iteration,
            duration_ms: 0,
            verdict: '',
            edited_by_user: 0
        });

        const mod = await this.getLLMModule();
        const LLMClient = mod.LLMClient;
        const startedAt = Date.now();
        this.setStepStatus && this.setStepStatus(step.id, 'running');

        try {
            const client = new LLMClient();
            client.setLLMConfig({
                llmType: cfg.type,
                apiKey: cfg.apiKey,
                baseUrl: cfg.baseUrl,
                modelName: cfg.modelName,
                maxOutputTokens: outputCap,
                aiTemp: skill.temperature
            });
            client.setSystemInstruction(sysPrompt);

            const out = await client.sendMessage([], baton, { signal: controller.signal });
            const durationMs = Math.max(0, Date.now() - startedAt);

            if (this._runStopped || controller.signal.aborted) {
                const stopMsg = this.getT('skills_run_stopped', 'Relay stopped by user');
                window.DB.updateSkillRunStep(stepRowId, { status: 'error', error: stopMsg, duration_ms: durationMs });
                this.setStepStatus && this.setStepStatus(step.id, 'error');
                const abortErr = new Error(stopMsg);
                abortErr.name = 'AbortError';
                throw abortErr;
            }

            const text = out == null ? '' : String(out).trim();
            if (!text) throw new Error(this.getT('skills_empty_response', 'Empty response from model'));

            const truncated = this.looksTruncated(text, outputCap);
            const verdict = (role === 'critic') ? this.parseCriticVerdict(text) : '';
            window.DB.updateSkillRunStep(stepRowId, {
                output_text: text,
                status: 'done',
                truncated: truncated ? 1 : 0,
                tokens_est: this.estTokens(baton) + this.estTokens(text),
                duration_ms: durationMs,
                verdict
            });
            this.setStepStatus && this.setStepStatus(step.id, 'done',
                truncated ? this.getT('skills_status_truncated', 'Done — answer cut off') : '');

            return {
                rowId: stepRowId,
                stepId: step.id,
                skillId: skill.id,
                skillTitle: skill.title,
                provider: cfg.type,
                model: cfg.modelName || skill.model_name || '',
                role,
                iteration,
                text,
                truncated,
                verdict,
                durationMs
            };
        } catch (err) {
            const durationMs = Math.max(0, Date.now() - startedAt);
            const isAbort = this._runStopped || controller.signal.aborted || (err && err.name === 'AbortError');
            const msg = isAbort ? this.getT('skills_run_stopped', 'Relay stopped by user') : String((err && err.message) || err);
            window.DB.updateSkillRunStep(stepRowId, { status: 'error', error: msg, duration_ms: durationMs });
            this.setStepStatus && this.setStepStatus(step.id, 'error');
            throw err;
        }
    },

    _pickFinalDeliverable(doneStages) {
        if (!Array.isArray(doneStages) || doneStages.length === 0) {
            return { text: '', title: '', role: 'worker', truncated: false, fromFinal: false, verifiedBy: '', verdict: '' };
        }
        const lastStage = doneStages[doneStages.length - 1];
        if (lastStage.role === 'critic' && lastStage.outputs.length > 0 && doneStages.length > 1) {
            const criticOut = lastStage.outputs[lastStage.outputs.length - 1];
            const priorDeliverable = [...doneStages.slice(0, -1)]
                .reverse()
                .find(st => (st.role === 'worker' || st.role === 'synthesizer') && st.outputs.length > 0);
            if (priorDeliverable && (criticOut.verdict === 'approve' || priorDeliverable.wasRevised)) {
                const chosen = priorDeliverable.outputs.length > 1
                    ? {
                        title: priorDeliverable.outputs.map(o => o.skillTitle).join(' ‖ '),
                        role: priorDeliverable.role,
                        truncated: priorDeliverable.outputs.some(o => o.truncated),
                        text: priorDeliverable.outputs.map(o => `## ${o.skillTitle}\n\n${o.text}`).join('\n\n---\n\n')
                    }
                    : priorDeliverable.outputs[0];
                return {
                    text: chosen.text,
                    title: chosen.skillTitle || chosen.title || '',
                    role: chosen.role || 'worker',
                    truncated: !!chosen.truncated,
                    fromFinal: false,
                    verifiedBy: criticOut.skillTitle || '',
                    verdict: priorDeliverable.wasRevised ? 'revised' : 'approve'
                };
            }
        }

        if (lastStage.outputs.length > 1) {
            return {
                text: lastStage.outputs.map(o => `## ${o.skillTitle}\n\n${o.text}`).join('\n\n---\n\n'),
                title: lastStage.outputs.map(o => o.skillTitle).join(' ‖ '),
                role: lastStage.role,
                truncated: lastStage.outputs.some(o => o.truncated),
                fromFinal: true,
                verifiedBy: '',
                verdict: ''
            };
        }

        const out = lastStage.outputs[0] || {};
        return {
            text: out.text || '',
            title: out.skillTitle || '',
            role: out.role || lastStage.role || 'worker',
            truncated: !!out.truncated,
            fromFinal: true,
            verifiedBy: '',
            verdict: out.verdict || ''
        };
    },

    _finalizeRunSuccess({ project, runId, runMsgId, doneStages }) {
        const source = this._pickFinalDeliverable(doneStages);
        const raw = source.text || '';
        const found = this.extractArtifacts(raw);
        const artifactIds = found.map(a => window.DB.saveSkillArtifact(
            project.id, runId, this.uniqueArtifactTitle(project.id, a.title, a.auto), a.type, a.code, source.title || ''
        ));
        const artifacts = artifactIds.map(id => window.DB.getSkillArtifact(id)).filter(Boolean);

        window.DB.updateSkillRun(runId, { status: 'done' });
        window.DB.trimSkillRuns(project.id, 30);
        this.setMsgMeta(runMsgId, {
            status: 'done',
            note: '',
            pausedStageIndex: null,
            nextStageIndex: null,
            failedStageIndex: null
        });
        if (this.state) {
            this.state.expandedRuns[runMsgId] = false;
            this.state.artifacts = window.DB.getSkillArtifacts(project.id);
        }

        window.DB.addSkillProjectMessage(project.id, 'answer', this.stripArtifacts(raw, found), {
            ts: Date.now(),
            runId,
            truncated: source.truncated,
            fromFinal: source.fromFinal,
            stepTitle: source.title,
            verifiedBy: source.verifiedBy,
            verdict: source.verdict,
            artifacts: artifactIds
        });

        this.toast('skills_run_done', 'check-circle', 'Relay finished');
        if (artifacts.length && typeof this.openArtifact === 'function') {
            this.openArtifact(artifacts[artifacts.length - 1].id);
        }
    },

    async _executePipeline({ project, runId, runMsgId, stages, startStageIndex, initialDone, input, attachments, searchBlock, projectContext }) {
        const controller = new AbortController();
        this._abortController = controller;
        this._runStopped = false;
        this.state.isRunning = true;
        this.state.liveRun = { msgId: runMsgId, runId, total: stages.length };
        this.syncComposer && this.syncComposer();

        const skillById = {};
        (this.state.skills || []).forEach(s => { skillById[s.id] = s; });

        const doneStages = Array.isArray(initialDone) ? initialDone.slice() : [];
        const totalStages = stages.length;
        const materials = this.buildMaterialsBlock(attachments || []);

        let errorStep = null;
        let errorText = '';
        let failedStageIndex = null;
        let aborted = false;
        let pausedStageIndex = null;

        try {
            if (searchBlock === '__PENDING__' && input) {
                this.setMsgMeta(runMsgId, { note: this.getT('skills_searching', 'Searching the web') + '…' });
                this.updateMsg && this.updateMsg(runMsgId);
                searchBlock = '';
                try {
                    const mod = await this.getSearchModule();
                    const searchQuery = input.replace(/\s+/g, ' ').trim().slice(0, 300);
                    const res = await mod.Search.query(searchQuery, { signal: controller.signal });
                    searchBlock = res || '';
                    if (!searchBlock && !this._runStopped && !controller.signal.aborted) {
                        this.toast('skills_search_empty', 'globe', 'No search results');
                    }
                } catch (e) {
                    if (this._runStopped || controller.signal.aborted || (e && e.name === 'AbortError')) {
                        aborted = true;
                    } else {
                        console.warn('Skills: web search failed', e);
                        this.toast('skills_search_failed', 'globe', 'Web search failed');
                    }
                }
                this.setMsgMeta(runMsgId, { searchBlock });
            }

            let stepOrderSeq = window.DB.getSkillRunSteps(runId).length;

            for (let sIdx = startStageIndex; sIdx < totalStages; sIdx++) {
                if (aborted || this._runStopped || controller.signal.aborted) {
                    aborted = true;
                    break;
                }

                const stage = stages[sIdx];
                const stageTitle = stage.steps.map(st => skillById[st.skill_id]?.title || st.skill_title || '?').join(' ‖ ');
                this.setMsgMeta(runMsgId, { index: sIdx + 1, title: stageTitle, note: '' });
                delete this.state.runStepsCache[runId];
                this.updateMsg && this.updateMsg(runMsgId);
                this.scrollThreadToBottom && this.scrollThreadToBottom();

                if (stage.isParallel) {
                    // Validate every branch skill exists
                    const missing = stage.steps.find(st => !skillById[st.skill_id]);
                    if (missing) {
                        errorStep = missing.skill_title || ('#' + missing.skill_id);
                        errorText = this.getT('skills_skill_missing', 'Skill not found');
                        failedStageIndex = sIdx;
                        break;
                    }

                    const baseOrder = stepOrderSeq;
                    stepOrderSeq += stage.steps.length;
                    const settled = await Promise.allSettled(stage.steps.map((step, bIdx) => {
                        const skill = skillById[step.skill_id];
                        return this._runSingleStepCall({
                            project,
                            stage,
                            step,
                            skill,
                            skillById,
                            totalStages,
                            runId,
                            stepOrder: baseOrder + bIdx,
                            iteration: 1,
                            doneStages,
                            input,
                            materials,
                            searchBlock,
                            projectContext,
                            controller
                        });
                    }));

                    if (this._runStopped || controller.signal.aborted) {
                        aborted = true;
                        break;
                    }

                    const successes = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
                    const failures = settled.filter(r => r.status === 'rejected').map(r => r.reason);
                    if (successes.length === 0) {
                        errorStep = stageTitle;
                        errorText = failures[0] ? String(failures[0].message || failures[0]) : 'All parallel branches failed';
                        failedStageIndex = sIdx;
                        break;
                    }

                    doneStages.push({
                        stageIndex: sIdx,
                        role: stage.role,
                        isParallel: true,
                        wasRevised: false,
                        outputs: successes
                    });
                } else {
                    const step = stage.steps[0];
                    const skill = skillById[step.skill_id];
                    if (!skill) {
                        errorStep = step.skill_title || ('#' + step.skill_id);
                        errorText = this.getT('skills_skill_missing', 'Skill not found');
                        failedStageIndex = sIdx;
                        break;
                    }

                    let res;
                    try {
                        res = await this._runSingleStepCall({
                            project,
                            stage,
                            step,
                            skill,
                            skillById,
                            totalStages,
                            runId,
                            stepOrder: stepOrderSeq++,
                            iteration: 1,
                            doneStages,
                            input,
                            materials,
                            searchBlock,
                            projectContext,
                            controller
                        });
                    } catch (err) {
                        if (this._runStopped || controller.signal.aborted || (err && err.name === 'AbortError')) {
                            aborted = true;
                        } else {
                            errorStep = skill.title;
                            errorText = String((err && err.message) || err);
                            failedStageIndex = sIdx;
                        }
                        break;
                    }

                    let currentCriticOut = res;
                    doneStages.push({
                        stageIndex: sIdx,
                        role: stage.role,
                        isParallel: false,
                        wasRevised: false,
                        outputs: [currentCriticOut]
                    });

                    // Auto-Revision Loop when Critic finds issues and max_revisions > 0
                    const maxRevisions = Math.max(0, parseInt(step.max_revisions, 10) || 0);
                    if (stage.role === 'critic' && maxRevisions > 0 && currentCriticOut.verdict === 'revise') {
                        const targetDone = [...doneStages.slice(0, -1)]
                            .reverse()
                            .find(d => d.role === 'worker' && !d.isParallel)
                            || [...doneStages.slice(0, -1)].reverse().find(d => !d.isParallel);

                        if (targetDone) {
                            const targetStageDef = stages[targetDone.stageIndex];
                            const targetStep = targetStageDef.steps[0];
                            const targetSkill = skillById[targetStep.skill_id];
                            let revCount = 0;
                            let verdictNow = currentCriticOut.verdict;
                            let latestCriticText = currentCriticOut.text;
                            let latestDeliverableText = (targetDone.outputs[0] && targetDone.outputs[0].text) || '';

                            while (verdictNow === 'revise' && revCount < maxRevisions && targetSkill) {
                                if (this._runStopped || controller.signal.aborted) {
                                    aborted = true;
                                    break;
                                }
                                revCount++;
                                const revNote = this.getT('skills_revising_note', 'Revision %s…')
                                    .replace('%s', `${targetSkill.title} (${revCount}/${maxRevisions})`);
                                this.setMsgMeta(runMsgId, { index: sIdx + 1, title: stageTitle, note: revNote });
                                delete this.state.runStepsCache[runId];
                                this.updateMsg && this.updateMsg(runMsgId);

                                try {
                                    const revisedOut = await this._runSingleStepCall({
                                        project,
                                        stage: targetStageDef,
                                        step: targetStep,
                                        skill: targetSkill,
                                        skillById,
                                        totalStages,
                                        runId,
                                        stepOrder: stepOrderSeq++,
                                        iteration: revCount + 1,
                                        doneStages: doneStages.slice(0, -1),
                                        input,
                                        materials,
                                        searchBlock,
                                        projectContext,
                                        controller,
                                        revisionContext: {
                                            targetStageIndex: targetDone.stageIndex,
                                            previousText: latestDeliverableText,
                                            criticText: latestCriticText,
                                            criticTitle: skill.title,
                                            iteration: revCount + 1
                                        }
                                    });
                                    targetDone.outputs = [revisedOut];
                                    targetDone.wasRevised = true;
                                    latestDeliverableText = revisedOut.text;
                                } catch (revErr) {
                                    if (this._runStopped || controller.signal.aborted || (revErr && revErr.name === 'AbortError')) {
                                        aborted = true;
                                    } else {
                                        errorStep = targetSkill.title;
                                        errorText = String((revErr && revErr.message) || revErr);
                                        failedStageIndex = targetDone.stageIndex;
                                    }
                                    break;
                                }

                                // Re-verify with Critic only if more revisions could still follow
                                if (revCount < maxRevisions) {
                                    this.setMsgMeta(runMsgId, { index: sIdx + 1, title: stageTitle, note: '' });
                                    delete this.state.runStepsCache[runId];
                                    this.updateMsg && this.updateMsg(runMsgId);
                                    try {
                                        const recheckOut = await this._runSingleStepCall({
                                            project,
                                            stage,
                                            step,
                                            skill,
                                            skillById,
                                            totalStages,
                                            runId,
                                            stepOrder: stepOrderSeq++,
                                            iteration: revCount + 1,
                                            doneStages: doneStages.slice(0, -1),
                                            input,
                                            materials,
                                            searchBlock,
                                            projectContext,
                                            controller
                                        });
                                        currentCriticOut = recheckOut;
                                        doneStages[doneStages.length - 1].outputs = [recheckOut];
                                        verdictNow = recheckOut.verdict || '';
                                        latestCriticText = recheckOut.text;
                                    } catch (recheckErr) {
                                        if (this._runStopped || controller.signal.aborted || (recheckErr && recheckErr.name === 'AbortError')) {
                                            aborted = true;
                                        } else {
                                            errorStep = skill.title;
                                            errorText = String((recheckErr && recheckErr.message) || recheckErr);
                                            failedStageIndex = sIdx;
                                        }
                                        break;
                                    }
                                } else {
                                    verdictNow = '';
                                }
                            }
                            if (aborted || errorStep) break;
                        }
                    }
                }

                delete this.state.runStepsCache[runId];
                this.updateMsg && this.updateMsg(runMsgId);
                this.scrollThreadToBottom && this.scrollThreadToBottom();

                // HITL Checkpoint: pause after stage when flag enabled and downstream stages remain
                if (stage.pauseAfter && sIdx < totalStages - 1) {
                    pausedStageIndex = sIdx;
                    break;
                }
            }
        } catch (err) {
            if (this._runStopped || controller.signal.aborted || (err && err.name === 'AbortError')) {
                aborted = true;
            } else {
                errorStep = errorStep || 'LLM';
                errorText = errorText || String((err && err.message) || err);
            }
        } finally {
            this._abortController = null;
            this._runStopped = false;
            this.state.isRunning = false;
            this.state.liveRun = null;
        }

        delete this.state.runStepsCache[runId];

        if (aborted) {
            window.DB.updateSkillRun(runId, { status: 'error' });
            const stopMsg = this.getT('skills_run_stopped', 'Relay stopped by user');
            this.setMsgMeta(runMsgId, {
                status: 'error',
                error: stopMsg,
                note: '',
                failedStageIndex: failedStageIndex !== null ? failedStageIndex : startStageIndex
            });
            this.state.expandedRuns[runMsgId] = true;
            this.toast('skills_run_stopped', 'square', 'Relay stopped by user');
        } else if (errorStep || doneStages.length === 0) {
            window.DB.updateSkillRun(runId, { status: 'error' });
            this.setMsgMeta(runMsgId, {
                status: 'error',
                error: errorText,
                note: '',
                failedStageIndex: failedStageIndex !== null ? failedStageIndex : startStageIndex
            });
            const failedLabel = this.getT('skills_step_failed', 'Step "%s" failed — relay stopped').replace('%s', errorStep || 'LLM');
            this.state.runError = failedLabel + (errorText ? ': ' + errorText : '');
            this.state.expandedRuns[runMsgId] = true;
            if (window.UI && UI.showToast) UI.showToast(failedLabel, 'alert-triangle');
        } else if (pausedStageIndex !== null) {
            window.DB.updateSkillRun(runId, { status: 'paused' });
            this.setMsgMeta(runMsgId, {
                status: 'paused',
                note: this.getT('skills_status_paused', 'Paused — review before continuing'),
                pausedStageIndex,
                nextStageIndex: pausedStageIndex + 1,
                failedStageIndex: null,
                error: ''
            });
            this.state.expandedRuns[runMsgId] = true;
            const rows = this.runStepsFor(runId);
            const lastRow = rows.filter(r => Number(r.stage_index) === pausedStageIndex && r.status === 'done').slice(-1)[0];
            if (lastRow) {
                this.state.activeRunTab[runMsgId] = 'row-' + lastRow.id;
            }
            this.toast('skills_run_paused', 'pause', 'Checkpoint reached');
        } else {
            this._finalizeRunSuccess({ project, runId, runMsgId, doneStages });
        }

        this.state.messages = window.DB.getSkillProjectMessages(project.id);
        this.state.stickToBottom = true;
        this.render && this.render();
    },

    _reconstructDoneStages(runId, beforeStageIndex, allRows = null) {
        const rows = allRows || (window.DB && window.DB.getSkillRunSteps ? window.DB.getSkillRunSteps(runId) : []);
        const byStage = new Map();
        rows.forEach(r => {
            if (r.status !== 'done') return;
            const sIdx = Number(r.stage_index ?? 0);
            if (sIdx >= beforeStageIndex) return;
            if (!byStage.has(sIdx)) byStage.set(sIdx, []);
            byStage.get(sIdx).push(r);
        });

        const stages = [];
        Array.from(byStage.keys()).sort((a, b) => a - b).forEach(sIdx => {
            const groupRows = byStage.get(sIdx);
            // When revisions ran, pick the latest iteration per branch/step
            const byBranch = new Map();
            groupRows.forEach(r => {
                const key = r.step_id != null ? `step:${r.step_id}` : `title:${r.skill_title}`;
                const prev = byBranch.get(key);
                if (!prev || Number(r.iteration || 1) >= Number(prev.iteration || 1)) {
                    byBranch.set(key, r);
                }
            });
            const latestRows = Array.from(byBranch.values());
            const anyRevised = groupRows.some(r => Number(r.iteration || 1) > 1);
            stages.push({
                stageIndex: sIdx,
                role: (latestRows[0] && latestRows[0].role) || 'worker',
                isParallel: latestRows.length > 1,
                wasRevised: anyRevised,
                outputs: latestRows.map(r => ({
                    rowId: r.id,
                    stepId: r.step_id,
                    skillId: r.skill_id,
                    skillTitle: r.skill_title,
                    provider: r.provider,
                    model: r.model,
                    role: r.role || 'worker',
                    iteration: r.iteration || 1,
                    text: r.output_text || '',
                    truncated: !!r.truncated,
                    verdict: r.verdict || '',
                    durationMs: r.duration_ms || 0
                }))
            });
        });
        return stages;
    },

    async send() {
        if (this.state.isRunning) return;
        const p = this.activeProject();
        if (!p) return;
        const input = (this.state.drafts[p.id] || '').trim();
        const attachments = (this.state.attachments || []).slice();
        if (!input && attachments.length === 0) return;

        const activeSteps = this.state.steps.filter(s => s.enabled);
        const skillById = {};
        (this.state.skills || []).forEach(s => { skillById[s.id] = s; });
        const stages = this.buildExecutionStages(activeSteps, skillById);

        if (stages.length === 0) {
            this.toggleRail && this.toggleRail(true);
            this.showComposerError && this.showComposerError(this.getT('skills_no_active_steps', 'No active steps in the relay'));
            return;
        }

        const searchOn = !!this.state.searchOn;
        const projectContext = this.buildProjectContext();
        this.state.drafts[p.id] = '';
        this.state.attachments = [];
        this.state.runError = '';
        this.state.stickToBottom = true;

        const files = attachments.filter(a => a.kind === 'file').map(a => a.name);
        const links = attachments.filter(a => a.kind === 'link').map(a => a.name);
        const summaryInput = input || files.concat(links).join(', ');

        window.DB.addSkillProjectMessage(p.id, 'user', summaryInput, { ts: Date.now(), files, links, search: searchOn });
        const runId = window.DB.createSkillRun(p.id, summaryInput);
        const runMsgId = window.DB.addSkillProjectMessage(p.id, 'run', '', {
            ts: Date.now(),
            runId,
            status: 'running',
            total: stages.length,
            index: 0,
            note: '',
            input: summaryInput,
            searchBlock: searchOn && input ? '__PENDING__' : '',
            projectContext,
            attachments
        });

        this.state.messages = window.DB.getSkillProjectMessages(p.id);
        this.state.expandedRuns[runMsgId] = true;
        this.renderThread && this.renderThread();
        this.toast('skills_run_started', 'play', 'Relay started');

        await this._executePipeline({
            project: p,
            runId,
            runMsgId,
            stages,
            startStageIndex: 0,
            initialDone: [],
            input: summaryInput,
            attachments,
            searchBlock: searchOn && input ? '__PENDING__' : '',
            projectContext
        });
    },

    async resumePausedRun(runMsgId, editedOutputsMap = null) {
        if (this.state.isRunning) return;
        const p = this.activeProject();
        if (!p) return;
        const runMsg = (this.state.messages || []).find(m => m.id === runMsgId);
        if (!runMsg) return;

        const meta = this.parseMeta(runMsg);
        const runId = meta.runId;
        if (!runId) return;

        // Persist user inline edits if provided (or collected from state.stepDrafts / state.editingStepRow)
        const drafts = editedOutputsMap || (this.state.stepDrafts || {});
        const rows = window.DB.getSkillRunSteps(runId);
        rows.forEach(r => {
            if (Object.prototype.hasOwnProperty.call(drafts, r.id) && drafts[r.id] !== undefined) {
                const nextText = String(drafts[r.id]);
                if (nextText !== (r.output_text || '')) {
                    window.DB.updateSkillRunStep(r.id, { output_text: nextText, edited_by_user: 1 });
                }
                delete this.state.stepDrafts[r.id];
            }
            if (this.state.editingStepRow) delete this.state.editingStepRow[r.id];
        });

        const nextStageIndex = Number(meta.nextStageIndex ?? ((meta.pausedStageIndex ?? 0) + 1));
        const activeSteps = this.state.steps.filter(s => s.enabled);
        const skillById = {};
        (this.state.skills || []).forEach(s => { skillById[s.id] = s; });
        const stages = this.buildExecutionStages(activeSteps, skillById);

        if (nextStageIndex >= stages.length) {
            return this.finalizePausedRun(runMsgId);
        }

        const initialDone = this._reconstructDoneStages(runId, nextStageIndex);
        this.state.runError = '';
        this.setMsgMeta(runMsgId, {
            status: 'running',
            total: stages.length,
            error: '',
            note: '',
            pausedStageIndex: null,
            nextStageIndex: null
        });
        window.DB.updateSkillRun(runId, { status: 'pending' });
        delete this.state.runStepsCache[runId];

        const runRow = window.DB.getSkillRun ? window.DB.getSkillRun(runId) : null;
        await this._executePipeline({
            project: p,
            runId,
            runMsgId,
            stages,
            startStageIndex: nextStageIndex,
            initialDone,
            input: meta.input || (runRow && runRow.input_text) || '',
            attachments: meta.attachments || [],
            searchBlock: meta.searchBlock === '__PENDING__' ? '' : (meta.searchBlock || ''),
            projectContext: meta.projectContext || ''
        });
    },

    async finalizePausedRun(runMsgId) {
        if (this.state.isRunning) return;
        const p = this.activeProject();
        if (!p) return;
        const runMsg = (this.state.messages || []).find(m => m.id === runMsgId);
        if (!runMsg) return;
        const meta = this.parseMeta(runMsg);
        const runId = meta.runId;
        if (!runId) return;

        const drafts = this.state.stepDrafts || {};
        const rows = window.DB.getSkillRunSteps(runId);
        rows.forEach(r => {
            if (Object.prototype.hasOwnProperty.call(drafts, r.id) && drafts[r.id] !== undefined) {
                const nextText = String(drafts[r.id]);
                if (nextText !== (r.output_text || '')) {
                    window.DB.updateSkillRunStep(r.id, { output_text: nextText, edited_by_user: 1 });
                }
                delete this.state.stepDrafts[r.id];
            }
            if (this.state.editingStepRow) delete this.state.editingStepRow[r.id];
        });

        const doneStages = this._reconstructDoneStages(runId, 999999);
        if (doneStages.length === 0) return;

        delete this.state.runStepsCache[runId];
        this._finalizeRunSuccess({ project: p, runId, runMsgId, doneStages });
        this.state.messages = window.DB.getSkillProjectMessages(p.id);
        this.state.stickToBottom = true;
        this.render && this.render();
    },

    async retryRunFromStage(runMsgId, fromStageIndex = 0) {
        if (this.state.isRunning) return;
        const p = this.activeProject();
        if (!p) return;
        const runMsg = (this.state.messages || []).find(m => m.id === runMsgId);
        if (!runMsg) return;
        const meta = this.parseMeta(runMsg);
        const runId = meta.runId;
        if (!runId) return;

        const targetIdx = Math.max(0, parseInt(fromStageIndex, 10) || 0);
        const activeSteps = this.state.steps.filter(s => s.enabled);
        const skillById = {};
        (this.state.skills || []).forEach(s => { skillById[s.id] = s; });
        const stages = this.buildExecutionStages(activeSteps, skillById);
        if (stages.length === 0 || targetIdx >= stages.length) return;

        const initialDone = this._reconstructDoneStages(runId, targetIdx);
        if (typeof window.DB.deleteSkillRunStepsFromStage === 'function') {
            window.DB.deleteSkillRunStepsFromStage(runId, targetIdx);
        }
        delete this.state.runStepsCache[runId];

        this.state.runError = '';
        this.state.expandedRuns[runMsgId] = true;
        this.setMsgMeta(runMsgId, {
            status: 'running',
            total: stages.length,
            index: targetIdx + 1,
            error: '',
            note: '',
            failedStageIndex: null,
            pausedStageIndex: null,
            nextStageIndex: null
        });
        window.DB.updateSkillRun(runId, { status: 'pending' });

        const runRow = window.DB.getSkillRun ? window.DB.getSkillRun(runId) : null;
        await this._executePipeline({
            project: p,
            runId,
            runMsgId,
            stages,
            startStageIndex: targetIdx,
            initialDone,
            input: meta.input || (runRow && runRow.input_text) || '',
            attachments: meta.attachments || [],
            searchBlock: meta.searchBlock === '__PENDING__' ? '' : (meta.searchBlock || ''),
            projectContext: meta.projectContext || ''
        });
    }
});

if (window.SkillsPlugin && typeof window.SkillsPlugin.init === 'function') {
    window.SkillsPlugin.init();
}
