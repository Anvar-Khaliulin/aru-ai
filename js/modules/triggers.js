/*
---ARU-LAB.SPACE---ALMATY---2026---
Triggers engine analyzing LLM responses to extract memory tags, artifact code, and tool configurations.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { semanticCore } from './semantics.js';
import { CanvasManager } from './canvas.js';
import { Tools } from './tools.js';
import { DB } from './db.js';
import { UI } from './ui.js';

// JS \b treats Cyrillic as a non-word character, so explicit lookarounds are
// needed for ru/kk cues ("создай", "Ару") to match at all.
const wordBoundary = (word) => new RegExp(
    `(?<![a-zа-яёәіңөұүқғһ0-9])${String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zа-яёәіңөұүқғһ0-9])`,
    'i'
);

export const Triggers = {

    // Similarity tolerance configuration for duplicate vector mapping
    DUPLICATE_SIMILARITY: 0.85,

    // Regex Constants
    PATTERNS: {
        // Resolves semantic captures interpreting flexible multidimensional memory brackets
        MEMORY: /(?:\[\[|\[)\s*MEMORY:\s*([\s\S]*?)\s*(?:\]\]|\])/gi,
        ARTIFACT: /\[\[\s*ARU_ARTIFACT\s+type\s*=\s*(?:"|'|&quot;|)(.*?)(?:"|'|&quot;|)\s+title\s*=\s*(?:"|'|&quot;|)(.*?)(?:"|'|&quot;|)\s*\]\]([\s\S]*?)\[\[?\s*\/ARU_ARTIFACT\s*\]?\]/gi,
        TOOL: /\[\[\s*TOOL\s*:\s*(\w+)\s*([\s\S]*?)\s*\]\]/gi,
        TASK: /\[\[\s*TASK\s*:\s*(\w+)\s*([\s\S]*?)\s*\]\]/gi,
        FIT: /\[\[\s*FIT\s*:\s*(\w+)\s*([\s\S]*?)\s*\]\]/gi
    },

    // 1. TRIGGER ORGANIZATION (RAG)

    async getRelevantContext(userQuery) {
        try {
            // Initiates dimensional semantic text extraction and mapping arrays
            const vector = await semanticCore.getEmbedding(userQuery);

            // Retrieves highest-proximity matching embeddings from persistent vector libraries
            const facts = await DB.searchFacts(vector);

            if (facts.length > 0) {
                console.log("RAG Found facts:", facts);
                return facts.map(f => f.content).join("; ");
            }
            return null;

        } catch (e) {
            console.error("Trigger Organization Failed:", e);
            return null;
        }
    },

    async processRecallModules(userQuery) {
        try {
            const query = userQuery.toLowerCase().trim();

            // 1. Creation Intent Detection: If the user wants to CREATE something NEW, skip recall.
            const creationCues = [
                'create', 'make', 'build', 'generate', 'new', 'write', 'construct', 'compose', 'design', 'start',
                'создай', 'сделай', 'напиши', 'построй', 'сгенерируй', 'новый', 'новую', 'новое', 'составь', 'придумай', 'разработай', 'запусти',
                'жаса', 'құрастыр', 'жаз', 'жаңа', 'шығар'
            ];
            
            // Check if query starts with or contains creation verbs in a way that suggests a new task
            const isCreationRequest = creationCues.some(cue => {
                // Check for word boundary to avoid partial matches (e.g. "news" matching "new")
                const regex = wordBoundary(cue);
                return regex.test(query);
            });

            if (isCreationRequest) {
                console.log("Module Recall: Creation intent detected, skipping automatic recall.");
                return null;
            }

            const apps = DB.getModules('app');
            const docs = DB.getModules('doc');
            const modules = [...apps, ...docs];

            // 2. Selective Matching: Only recall if there's a strong, specific match.
            const match = modules.find(m => {
                const name = m.name.toLowerCase();
                if (query === name) return true; // Exact match
                
                // Primary recall commands (imperatives)
                const recallCues = ['open', 'show', 'recall', 'get', 'открой', 'покажи', 'найди', 'аш', 'көрсет'];
                const hasRecallCue = recallCues.some(cue => query.includes(cue));
                
                if (hasRecallCue) {
                    // If they explicitly ask to "open", allow softer substring matching
                    return query.includes(name) || name.split(' ').some(word => word.length > 3 && query.includes(word));
                }
                
                // If no explicit "open" command, require the query to contain the FULL name as a standalone phrase
                const nameRegex = wordBoundary(name);
                return nameRegex.test(query);
            });

            if (match) {
                console.log("Module Recall: Found match", match.name);
                // Commits execution pipeline launching interactive operational canvas endpoints
                setTimeout(() => CanvasManager.renderArtifact(match.type, match.name, match.content), 500);
                return `SUCCESS: Artifact already found and opened on Canvas (Type: ${match.type}, Title: "${match.name}"). DO NOT generate a new version of this artifact. Just confirm to the user that it is open.`;
            }
            return null;
        } catch (e) {
            console.error("Module Recall Failed:", e);
            return null;
        }
    },

    //2. TRIGGER EXTRACTION

    async processResponseForMemory(llmResponse, skipSave = false) {
        // Validates sequential processing paths verifying text execution boundaries
        try {
            if (skipSave) {
                console.debug('Triggers.processResponseForMemory: skipSave is true, only cleaning response');
                let cleanResponse = llmResponse || '';
                cleanResponse = cleanResponse.replace(/(?:\[\[|\[)\s*MEMORY:\s*[\s\S]*?\s*(?:\]\]|\])/gi, '');
                cleanResponse = cleanResponse.replace(/\(\s*(?:System|Система|Status|Статус|MOOD|SARCASM|AFFINITY|FLAGS):?[\s\S]*?\)/gi, '');
                cleanResponse = cleanResponse.replace(/<p>\s*<\/p>/gi, '');
                return cleanResponse.trim();
            }

            console.debug('Triggers.processResponseForMemory: entry', { len: llmResponse ? llmResponse.length : 0 });
            // Dynamically allocates expression target sequences for runtime evaluations
            this.PATTERNS.MEMORY.lastIndex = 0;
            const memoryRegex = this.PATTERNS.MEMORY;
            let match;
            const memoriesToSave = [];
            let cleanResponse = llmResponse || '';

            // Find all matches
            while ((match = memoryRegex.exec(llmResponse || '')) !== null) {
                try {
                    const captured = match[1] ? match[1].trim() : '';
                    if (captured) memoriesToSave.push(captured);
                } catch (e) {
                    console.warn('Triggers.processResponseForMemory: failed to extract match', e, match);
                }
            }

            // Cleanses visual string structure stripping internal operational boundaries and DOM clutter
            try {
                cleanResponse = cleanResponse.replace(/(?:\[\[|\[)\s*MEMORY:\s*[\s\S]*?\s*(?:\]\]|\])/gi, '');
                // Silences residual system inference logs preventing contextual interaction breakage
                cleanResponse = cleanResponse.replace(/\(\s*(?:System|Система|Status|Статус|MOOD|SARCASM|AFFINITY|FLAGS):?[\s\S]*?\)/gi, '');
                // Sanitizes empty paragraph node structures normalizing graphical visual layers
                cleanResponse = cleanResponse.replace(/<p>\s*<\/p>/gi, '');
                cleanResponse = cleanResponse.trim();
            } catch (e) { console.warn('Failed to strip internal tags', e); }

            if (!memoriesToSave.length) {
                console.debug('Triggers.processResponseForMemory: no [[MEMORY:]] tags found');

                // Applies heuristic language classification identifying structured user properties natively
                try {
                    const heuristics = [];
                    const text = (llmResponse || '').toString();

                    // Identifies associative parameters utilizing standard Cyrillic syntactic definitions
                    const saneAge = (s) => {
                        const n = parseInt(s, 10);
                        return (n >= 3 && n <= 99) ? String(n) : null;
                    };

                    const nameRu = text.match(/(?:Привет,\s*|я знаю, что тебя зовут\s*|тебя зовут\s*|тебя зовут,?\s*)([А-ЯЁA-Z][а-яёА-ЯA-Za-z\-']{1,30})/i);
                    // Year-word is MANDATORY and range-checked: bare "тебе 2/100" matched
                    // everything from "варианта" to "процентов" and poisoned memory with junk ages.
                    const ageRuM = text.match(/(?:тебе|вам)\s+(\d{1,3})\s*(?:год|года|годы|лет)(?![а-яё])/i);

                    if (nameRu && nameRu[1]) heuristics.push(`Имя: ${nameRu[1].trim()}`);
                    if (ageRuM) { const a = saneAge(ageRuM[1]); if (a) heuristics.push(`Возраст: ${a}`); }

                    // Identifies associative parameters utilizing generalized ASCII language bindings
                    const nameEn = text.match(/(?:Hi,\s*|Hello,\s*|I know your name is\s*|your name is\s*)([A-Z][a-z\-']{1,30})/i);
                    const ageEnM = text.match(/(?:you are|you're)\s+(\d{1,3})\s*years?\s+old\b/i) || text.match(/\bage\s+is\s+(\d{1,3})\b/i);
                    if (nameEn && nameEn[1]) heuristics.push(`Name: ${nameEn[1].trim()}`);
                    if (ageEnM) { const a = saneAge(ageEnM[1]); if (a) heuristics.push(`Age: ${a}`); }

                    // Identifies associative parameters utilizing specific Turkic grammatical heuristics
                    const nameKz = text.match(/(?:Менің атым|Сіздің атыңыз|сенің атың)\s*[:,\-]?\s*([А-ЯӘІӨҰҮA-Z][а-яәіөүұүА-ЯA-Za-z\-']{1,30})/i);
                    const ageKzM = text.match(/(?:жасыңыз|жасың|жасы)\s*(\d{1,3})/i);
                    if (nameKz && nameKz[1]) heuristics.push(`Аты: ${nameKz[1].trim()}`);
                    if (ageKzM) { const a = saneAge(ageKzM[1]); if (a) heuristics.push(`Жасы: ${a}`); }

                    if (heuristics.length > 0) {
                        console.log('Triggers.processResponseForMemory: heuristics extracted facts', heuristics);
                        try {
                            await this.saveMemories(heuristics);
                            console.debug('Triggers.processResponseForMemory: heuristics saved');
                        } catch (e) {
                            console.error('Triggers.processResponseForMemory: failed to save heuristics', e);
                        }
                    }
                } catch (e) {
                    console.warn('Triggers.processResponseForMemory: heuristic extraction failed', e);
                }

                return cleanResponse;
            }

            console.log('Triggers.processResponseForMemory: found memory tags', memoriesToSave);

            // Filters and rejects manipulation protocols intended to target the internal state system
            const filtered = memoriesToSave.filter(m => {
                const lower = (m || '').toLowerCase();
                if (/\b(mood|sarcasm|humor|affinity)\b/.test(lower)) {
                    console.warn('Blocked memory that attempts to set personality value:', m);
                    return false;
                }
                return true;
            });

            if (!filtered.length) {
                console.log('Trigger Extraction: No safe memories to save after filtering');
                return cleanResponse;
            }

            console.log('Trigger Extraction: Saving memories', filtered);
            // Executes internal asynchronous transactional payloads sequentially verifying completion states
            try {
                await this.saveMemories(filtered);
                console.debug('Trigger Extraction: saveMemories completed');
            } catch (e) {
                console.error('Trigger Extraction: saveMemories failed', e);
            }

            return cleanResponse;
        } catch (e) {
            console.error('Triggers.processResponseForMemory fatal error', e);
            return llmResponse;
        }
    },

    async saveMemories(facts) {
        for (const fact of facts) {
            try {
                console.debug('Triggers.saveMemories: processing fact', fact);
                // Executes neural transformation compiling standard string properties into mapped numerical lists
                const vector = await semanticCore.getEmbedding(fact);
                const vecArr = Array.isArray(vector) ? vector : (vector && vector.data ? Array.from(vector.data) : (vector && vector[0] ? vector[0] : []));
                console.debug('Triggers.saveMemories: embedding length', vecArr && vecArr.length);

                // Verifies exactness preventing memory clutter via dimensional spatial duplication mapping
                try {
                    const similar = await DB.searchFacts(vecArr, this.DUPLICATE_SIMILARITY, 3);
                    if (similar && similar.length > 0) {
                        const best = similar[0]; // sorted by similarity desc
                        if (best.similarity >= 0.97) {
                            // Same fact, changed value (e.g. new age): update in place so RAG
                            // never serves the stale value. Distinct-but-close facts stay untouched.
                            console.log('Triggers.saveMemories: near-identical memory, updating in place', { fact, id: best.id, similarity: best.similarity });
                            await DB.updateFact(best.id, fact, vecArr);
                            this.showMemoryToast();
                        } else {
                            console.log('Triggers.saveMemories: found similar memory, skipping save', { fact, similar: similar.map(s => ({ id: s.id, similarity: s.similarity })) });
                        }
                        continue; // Cancels write transaction maintaining dataset cleanliness
                    }
                } catch (e) {
                    console.warn('Triggers.saveMemories: duplicate check failed, proceeding to save', e);
                }

                // Persists extracted data targets committing them securely to local database instances
                if (DB.saveFact) await DB.saveFact(fact, 'auto', vecArr);

                // Initiates subtle feedback layer confirming runtime state executions visually
                this.showMemoryToast();
            } catch (e) {
                console.error("Failed to save memory", e, { fact });
            }
        }
    },

    showMemoryToast() {
        // Visual feedback that Aru remembered something
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs py-1 px-3 rounded-full opacity-0 transition-opacity duration-500 z-50 flex items-center gap-2';
        toast.innerHTML = '<i data-lucide="brain-circuit" class="w-3 h-3 text-aru-400"></i> New memory saved';
        document.body.appendChild(toast);
        lucide.createIcons(); // refresh icon

        requestAnimationFrame(() => toast.classList.remove('opacity-0'));
        setTimeout(() => {
            toast.classList.add('opacity-0');
            setTimeout(() => toast.remove(), 500);
        }, 2000);
    },

    //3. TRIGGER THINKING (Artifacts)

    processResponseForArtifacts(llmResponse, chatId = null, isPrivate = false) {
        this.PATTERNS.ARTIFACT.lastIndex = 0;
        const artifactRegex = this.PATTERNS.ARTIFACT;

        const artifactsFound = [];
        let cleanResponse = llmResponse;

        // Try standard artifact tags first
        let match;
        while ((match = artifactRegex.exec(llmResponse)) !== null) {
            const [fullMatch, typeRaw, title, code] = match;
            const type = typeRaw.toLowerCase().trim();
            artifactsFound.push({ type, title, code: code.trim(), fullMatch });
        }

        // HEURISTIC FALLBACK: If no artifacts found, but there's a code block
        if (artifactsFound.length === 0) {
            // Updated regex: capture ANY optional language identifier (e.g., python, js, html)
            const codeBlockRegex = /```([a-z0-9_\-+]+)?\s*\n([\s\S]*?)```/gi;
            let cbMatch;
            while ((cbMatch = codeBlockRegex.exec(llmResponse)) !== null) {
                const [fullMatch, lang, code] = cbMatch;
                if (!code || code.trim().length < 100) continue; // Ignore tiny snippets

                // ONLY auto-promote if the language is explicitly a "heavy" artifact type.
                // Standard code snippets (js, python, cpp, etc) stay in chat.
                // 'html' is allowed but only if it looks like a component.
                const artifactLangs = ['html', 'app', 'game', 'analytics', 'doc'];
                
                // If there's NO language tag, or it's NOT an artifact language, skip artifact creation.
                // This ensures snippets like ```python stay as normal markdown in the chat.
                if (!lang || !artifactLangs.includes(lang.toLowerCase())) continue;

                let type = 'doc';
                if (lang.toLowerCase() === 'html' || code.includes('<script') || code.includes('<div')) {
                    // High-confidence check for app/game/analytics
                    const isInteractive = code.includes('Canvas') || code.includes('Game') || code.includes('Chart') || code.includes('getContext(');
                    type = isInteractive ? (code.includes('Chart') ? 'analytics' : 'game') : 'app';
                }

                const title = "Auto Generated " + (type.charAt(0).toUpperCase() + type.slice(1));
                artifactsFound.push({ type, title, code: code.trim(), fullMatch, autoTitle: true });
            }
        }

        // Process all found artifacts (standard or heuristic)
        for (const art of artifactsFound) {
            let { type, title, code, fullMatch } = art;
            if (art.autoTitle) {
                title = this.makeUniqueArtifactTitle(title, chatId, isPrivate);
                art.title = title;
            }

            // Resolves explicit DOM operational references matching standardized classification identifiers
            const t = state.translations || {};
            const config = {
                game: { icon: 'gamepad-2', color: 'bg-orange-100 text-orange-600', label: t.lib_label_game || 'Aru Game' },
                app: { icon: 'layout', color: 'bg-purple-100 text-purple-600', label: t.lib_label_app || 'Aru App' },
                analytics: { icon: 'bar-chart-3', color: 'bg-blue-100 text-blue-600', label: t.lib_label_analytics || 'Aru Analytics' },
                doc: { icon: 'file-text', color: 'bg-emerald-100 text-emerald-600', label: t.lib_label_doc || 'Aru Doc' }
            };

            const safeType = Object.prototype.hasOwnProperty.call(config, type) ? type : 'doc';
            const item = config[safeType];
            const jsType = UI.escapeHTML(JSON.stringify(safeType));
            const jsTitle = UI.escapeHTML(JSON.stringify(title));

            const replacementCard = `
<div class="my-4 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex items-center justify-between gap-4 shadow-sm group hover:border-aru-400 transition cursor-pointer" onclick='window.app.openArtifact(${jsType}, ${jsTitle})'>
        <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg ${item.color} flex items-center justify-center transition-transform group-hover:scale-110">
            <i data-lucide="${item.icon}" class="w-6 h-6"></i>
        </div>
        <div>
            <h4 class="font-bold text-gray-800 dark:text-gray-100 text-sm">${UI.escapeHTML(title)}</h4>
            <p class="text-[10px] text-gray-500 font-bold uppercase tracking-wider">${item.label}</p>
        </div>
    </div>
    <div class="w-10 h-10 flex items-center justify-center bg-white dark:bg-gray-700 text-gray-400 group-hover:text-aru-500 border border-gray-200 dark:border-gray-600 rounded-xl shadow-sm group-hover:border-aru-400 transition-all">
        <i data-lucide="eye" class="w-5 h-5"></i>
    </div>
</div>`;

            if (!window.aruArtifactsCache) window.aruArtifactsCache = {};
            const cacheKey = (chatId !== null && chatId !== undefined) ? `${chatId}:${title}` : title;
            window.aruArtifactsCache[cacheKey] = { type: safeType, title, code: code.trim() };

            if (!isPrivate && chatId !== null && chatId !== undefined && DB.saveChatArtifact) {
                DB.saveChatArtifact(chatId, title, safeType, code.trim());
            }

            cleanResponse = cleanResponse.replace(fullMatch, replacementCard);
        }

        // Safety Cleanup: Remove any remaining artifact tags that might have failed full regex match
        // (e.g. malformed attributes) to prevent raw code/tags in chat.
        cleanResponse = cleanResponse.replace(/\[\[\s*ARU_ARTIFACT[\s\S]*?\]\]/gi, '');
        cleanResponse = cleanResponse.replace(/\[\[?\s*\/ARU_ARTIFACT\s*\]?\]/gi, '');

        if (artifactsFound.length > 0) {
            const last = artifactsFound[artifactsFound.length - 1];
            setTimeout(() => {
                CanvasManager.renderArtifact(last.type, last.title, last.code);
                const st = window.aruState;
                const tab = st && st.tabs[st.activeTabIndex];
                if (tab) tab.artifact = { type: last.type, title: last.title, code: last.code };
            }, 500);
        }

        return cleanResponse;
    },

    makeUniqueArtifactTitle(baseTitle, chatId, isPrivate) {
        const keyFor = (t) => (chatId !== null && chatId !== undefined) ? `${chatId}:${t}` : t;
        const taken = (t) => {
            if (window.aruArtifactsCache && window.aruArtifactsCache[keyFor(t)]) return true;
            if (!isPrivate && chatId !== null && chatId !== undefined && DB.getChatArtifact && DB.getChatArtifact(chatId, t)) return true;
            return false;
        };
        if (!taken(baseTitle)) return baseTitle;
        let n = 2;
        while (taken(`${baseTitle} ${n}`)) n++;
        return `${baseTitle} ${n}`;
    },

    // Localized text for task automation notices (falls back to English defaults)
    taskT(key, vars, fallback) {
        let text = window.PluginManager ? window.PluginManager.getTranslation(key) : key;
        if (!text || text === key) text = fallback || key;
        if (vars) {
            for (const k in vars) text = text.split(`{${k}}`).join(vars[k]);
        }
        return text;
    },

    // Normalizes LLM-provided deadlines to "YYYY-MM-DDTHH:MM" (local time).
    // Date-only values default to 12:00 and NOT to UTC midnight (which shifts the day in UTC+5).
    _normalizeTaskDeadline(raw) {
        if (!raw) return '';
        const s = String(raw).trim();
        let m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
        if (m) {
            // Absolute ISO timestamps (with Z or offset) are converted to local time as-is
            if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
                const d = new Date(s);
                if (!isNaN(d.getTime())) {
                    const pad = (n) => String(n).padStart(2, '0');
                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                }
            }
            return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
        }
        m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (m) return `${m[1]}-${m[2]}-${m[3]}T12:00`;
        return '';
    },

    // Fallback columns used when the task plugin build is stale (no getDefaultColumns)
    defaultTaskColumns() {
        const uid = () => 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        return [
            { id: uid(), title: this.taskT('task_col_todo', null, 'To Do'), tasks: [] },
            { id: uid(), title: this.taskT('task_col_progress', null, 'In Progress'), tasks: [] },
            { id: uid(), title: this.taskT('task_col_done', null, 'Done'), tasks: [] }
        ];
    },

    processResponseForTasks(llmResponse, isPrivate = false) {
        if (!llmResponse) return llmResponse;
        let cleanResponse = llmResponse;
        this.PATTERNS.TASK.lastIndex = 0;
        const matches = [...cleanResponse.matchAll(this.PATTERNS.TASK)];

        if (matches.length === 0) return cleanResponse;

        // Write-only commands — blocked in private chats
        const WRITE_COMMANDS = new Set(['CREATE_PROJECT', 'CREATE_TASK', 'MOVE_TASK', 'DELETE_TASK', 'UPDATE_TASK']);

        let privateBlockShown = false; // Show the notice only once per response
        const notices = []; // Localized system notices appended once at the end

        for (const match of matches) {
            const [fullMatch, command, argsStr] = match;
            const args = {};
            const argRegex = /(\w+)\s*=\s*(?:"|'|&quot;)([\s\S]*?)(?:"|'|&quot;)/g;
            let argMatch;
            while ((argMatch = argRegex.exec(argsStr)) !== null) {
                args[argMatch[1]] = argMatch[2];
            }

            // In private mode — block all write commands
            if (isPrivate && WRITE_COMMANDS.has(command)) {
                console.log(`Trigger Task: BLOCKED in private mode — ${command}`);
                cleanResponse = cleanResponse.replace(fullMatch, '');
                if (!privateBlockShown) {
                    const t = (window.aruState && window.aruState.translations) || {};
                    const notice = t.private_task_blocked || '🔒 Private mode: I can read and discuss your tasks, but I cannot create, move or delete them here.';
                    // Append notice at end of response (only once)
                    cleanResponse = cleanResponse.trim() + `\n\n*${notice}*`;
                    privateBlockShown = true;
                }
                continue;
            }

            console.log(`Trigger Task: Executing ${command}`, args);

            if (window.TaskPlugin) {
                try {
                    const taskPlugin = window.TaskPlugin;

                    // Helper to find project by name or ID
                    const findProject = (query) => {
                        if (!query) return taskPlugin.state.projects.find(p => p.id === taskPlugin.state.activeProjectId) || taskPlugin.state.projects[0];
                        return taskPlugin.state.projects.find(p => p.id === query || p.name.toLowerCase() === query.toLowerCase());
                    };

                    const uid = (prefix) => (typeof taskPlugin._uid === 'function')
                        ? taskPlugin._uid(prefix)
                        : prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

                    const defaultColumns = () => (typeof taskPlugin.getDefaultColumns === 'function')
                        ? taskPlugin.getDefaultColumns()
                        : this.defaultTaskColumns();

                    const defaultTaskTitle = () => (typeof taskPlugin.getDefaultTaskTitle === 'function')
                        ? taskPlugin.getDefaultTaskTitle()
                        : this.taskT('task_default_title', null, 'New Task');

                    const ensureColumns = (project) => {
                        if (!project.columns || project.columns.length === 0) project.columns = defaultColumns();
                    };

                    const findTask = (query, projectScope) => {
                        if (!query) return null;
                        const projects = projectScope ? [projectScope] : taskPlugin.state.projects;
                        for (const p of projects) {
                            for (const c of (p.columns || [])) {
                                const t = c.tasks.find(t => t.id === query || t.title.toLowerCase() === query.toLowerCase());
                                if (t) return { project: p, column: c, task: t };
                            }
                        }
                        return null;
                    };

                    switch (command) {
                        case 'CREATE_PROJECT': {
                            if (!args.name) break;
                            const existing = taskPlugin.state.projects.find(p => p.name.toLowerCase() === args.name.toLowerCase());
                            if (existing) {
                                notices.push(this.taskT('task_notice_project_exists', { project: args.name }, `Project "${args.name}" already exists.`));
                                break;
                            }
                            taskPlugin.state.projects.push({
                                id: uid('p'),
                                name: args.name,
                                columns: defaultColumns()
                            });
                            taskPlugin.saveState();
                            taskPlugin.renderProjects();
                            break;
                        }

                        case 'CREATE_TASK': {
                            let targetProject = findProject(args.project);
                            if (!targetProject) {
                                const projName = args.project || (typeof taskPlugin.getT === 'function'
                                    ? taskPlugin.getT('task_seed_project', 'My First Project')
                                    : 'My First Project');
                                targetProject = { id: uid('p'), name: projName, columns: defaultColumns() };
                                taskPlugin.state.projects.push(targetProject);
                                if (!taskPlugin.state.activeProjectId) taskPlugin.state.activeProjectId = targetProject.id;
                                notices.push(this.taskT('task_notice_project_created', { project: projName }, `Project "${projName}" was created.`));
                            }

                            ensureColumns(targetProject);

                            // Try to find column by name if specified, else default to first
                            let col = targetProject.columns[0];
                            if (args.column) {
                                const found = targetProject.columns.find(c => c.title.toLowerCase() === args.column.toLowerCase());
                                if (found) col = found;
                                else notices.push(this.taskT('task_notice_column_not_found', { column: args.column, fallback: col.title }, `Column "${args.column}" was not found, used "${col.title}" instead.`));
                            }
                            col.tasks.push({
                                id: uid('t'),
                                title: args.title || defaultTaskTitle(),
                                desc: args.desc || '',
                                deadline: this._normalizeTaskDeadline(args.deadline)
                            });
                            taskPlugin.saveState();
                            taskPlugin.renderBoard();
                            break;
                        }

                        case 'MOVE_TASK': {
                            const found = findTask(args.id || args.title);
                            if (!found) {
                                notices.push(this.taskT('task_notice_task_not_found', { title: args.title || args.id || '' }, `Task "${args.title || args.id || ''}" was not found.`));
                                break;
                            }

                            const destProject = findProject(args.to_project) || found.project;
                            ensureColumns(destProject);

                            let toCol = args.to_column
                                ? destProject.columns.find(c => c.title.toLowerCase() === args.to_column.toLowerCase())
                                : null;
                            if (args.to_column && !toCol) {
                                notices.push(this.taskT('task_notice_column_not_found', { column: args.to_column, fallback: destProject.columns[0].title }, `Column "${args.to_column}" was not found, used "${destProject.columns[0].title}" instead.`));
                            }
                            toCol = toCol || destProject.columns[0];

                            found.column.tasks = found.column.tasks.filter(t => t !== found.task);
                            toCol.tasks.push(found.task);
                            taskPlugin.saveState();
                            taskPlugin.renderBoard();
                            break;
                        }

                        case 'UPDATE_TASK': {
                            const scopedProject = args.project ? findProject(args.project) : null;
                            const found = findTask(args.id || args.title, scopedProject);
                            if (!found) {
                                notices.push(this.taskT('task_notice_task_not_found', { title: args.title || args.id || '' }, `Task "${args.title || args.id || ''}" was not found.`));
                                break;
                            }
                            if (args.new_title) found.task.title = args.new_title;
                            if ('desc' in args) found.task.desc = args.desc;
                            if ('deadline' in args) found.task.deadline = this._normalizeTaskDeadline(args.deadline);
                            taskPlugin.saveState();
                            taskPlugin.renderBoard();
                            break;
                        }

                        case 'DELETE_TASK': {
                            const found = findTask(args.id || args.title);
                            if (!found) {
                                notices.push(this.taskT('task_notice_task_not_found', { title: args.title || args.id || '' }, `Task "${args.title || args.id || ''}" was not found.`));
                                break;
                            }
                            found.column.tasks = found.column.tasks.filter(t => t !== found.task);
                            taskPlugin.saveState();
                            taskPlugin.renderBoard();
                            break;
                        }
                    }
                } catch (e) {
                    console.error("Triggers: Task command failed", e);
                }
            }

            cleanResponse = cleanResponse.replace(fullMatch, '');
        }

        if (notices.length > 0) {
            cleanResponse = cleanResponse.trim() + '\n\n' + notices.map(n => `*${n}*`).join('\n');
        }

        return cleanResponse.trim();
    },

    // Localized text for Fit & Care notices (falls back to English defaults).
    fitT(key, vars, fallback) {
        let text = window.PluginManager ? window.PluginManager.getTranslation(key) : key;
        if (!text || text === key) text = fallback || key;
        if (vars) {
            for (const k in vars) text = text.split(`{${k}}`).join(vars[k]);
        }
        return text;
    },

    fitDate(value, fallback) {
        const text = String(value || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return fallback;
        const date = new Date(`${text}T12:00:00`);
        return Number.isNaN(date.getTime()) ? fallback : text;
    },

    fitTime(value) {
        const match = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
        if (!match) return '';
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (hours > 23 || minutes > 59) return '';
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    },

    fitNowTime() {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    },

    fitNumber(value) {
        if (value === undefined || value === null) return null;
        const text = String(value).trim().replace(',', '.');
        if (!text) return null;
        const number = Number(text);
        return Number.isFinite(number) ? number : null;
    },

    fitScale(value, min, max) {
        const number = this.fitNumber(value);
        if (number === null) return null;
        const rounded = Math.round(number);
        return rounded >= min && rounded <= max ? rounded : null;
    },

    fitList(value, limit = 20) {
        return String(value || '')
            .split(/[,;]+/)
            .map((item) => item.trim())
            .filter(Boolean)
            .filter((item, index, list) => list.indexOf(item) === index)
            .slice(0, limit);
    },

    fitExercises(value) {
        const text = String(value || '').trim();
        if (!text) return '[]';
        if (text.startsWith('[')) {
            try {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) return JSON.stringify(parsed.slice(0, 50));
            } catch (e) {
                // Fall through to the plain-text format.
            }
        }
        const items = text.split(/[;|]+/).map((item) => item.trim()).filter(Boolean).slice(0, 50);
        return JSON.stringify(items);
    },

    // Plan-day exercises: either a JSON array or a compact string like
    // "Жим лёжа 4x8 @50; Присед 3x10" → [{name, sets, reps, weight}].
    fitPlanExercises(value) {
        const text = String(value || '').trim();
        if (!text) return '[]';
        if (text.startsWith('[')) {
            try {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) return JSON.stringify(parsed.slice(0, 30));
            } catch (e) {
                // Fall through to the compact string format.
            }
        }
        const items = text.split(/[;\n|]+/).map((item) => item.trim()).filter(Boolean).slice(0, 30);
        const parsed = items.map((item) => {
            let rest = item;
            const exercise = { name: item, sets: null, reps: null, weight: null };
            const weight = /@\s*([\d.,]+)\s*(?:кг|kg)?$/i.exec(rest);
            if (weight) {
                exercise.weight = this.fitNumber(weight[1]);
                rest = rest.slice(0, weight.index);
            }
            const setsReps = /(\d{1,2})\s*[x×]\s*(\d{1,3})\s*$/i.exec(rest);
            if (setsReps) {
                exercise.sets = Number(setsReps[1]);
                exercise.reps = Number(setsReps[2]);
                rest = rest.slice(0, setsReps.index);
            }
            exercise.name = rest.replace(/[\s,\-–—]+$/, '').trim() || item;
            return exercise;
        });
        return JSON.stringify(parsed);
    },

    fitConflictNotices(meal) {
        if (!(window.DB && typeof window.DB.getFitMealConflicts === 'function')) return [];
        let conflicts = [];
        try {
            conflicts = window.DB.getFitMealConflicts(meal) || [];
        } catch (e) {
            return [];
        }
        return conflicts.map((conflict) => {
            if (conflict.kind === 'delay') {
                return this.fitT('fit_notice_conflict_delay', {
                    name: conflict.protocol,
                    meal_time: conflict.meal_time || '—',
                    need: conflict.required,
                    dose_time: conflict.dose_time || '—'
                }, `${conflict.protocol}: the meal at ${conflict.meal_time || '—'} is less than ${conflict.required} min after the dose at ${conflict.dose_time || '—'}.`);
            }
            return this.fitT('fit_notice_conflict_tag', {
                name: conflict.protocol,
                tag: conflict.tag,
                dose_time: conflict.dose_time || '—'
            }, `${conflict.protocol}: "${conflict.tag}" is on your avoid list near the dose at ${conflict.dose_time || '—'}.`);
        });
    },

    // Fit & Care commands let Aru record the user's routine from any normal chat
    // and from the plugin's own day chat. They deliberately support logging only:
    // no diagnosis, medication advice or health interpretation happens here.
    // `fallbackDate` lets the day chat record into the day it is showing.
    processResponseForFitCare(llmResponse, isPrivate = false, fallbackDate = '') {
        if (!llmResponse) return llmResponse;
        this.PATTERNS.FIT.lastIndex = 0;
        const matches = [...String(llmResponse).matchAll(this.PATTERNS.FIT)];
        if (!matches.length) return llmResponse;
        let clean = String(llmResponse);
        const notices = [];
        const today = new Date();
        const todayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(fallbackDate))
            ? String(fallbackDate)
            : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const db = window.DB;
        const canWrite = !!(db && db.patchFitDailyLog);
        let cycleTrackingOn = false;
        if (canWrite && typeof db.getFitProfile === 'function') {
            try { cycleTrackingOn = Number(db.getFitProfile().cycle_tracking) === 1; } catch (e) { cycleTrackingOn = false; }
        }
        let wrote = false;
        let privateNotified = false;
        let cycleOffNotified = false;
        let lastPlanId = null;
        for (const match of matches) {
            const [full, command, source] = match;
            const args = {};
            const attr = /(\w+)\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|([^\s\]]+))/g;
            let item;
            while ((item = attr.exec(source)) !== null) args[item[1].toLowerCase()] = (item[2] ?? item[3] ?? item[4] ?? '').trim();
            clean = clean.replace(full, '');
            const name = String(command || '').toUpperCase();
            if (isPrivate) {
                if (!privateNotified) {
                    notices.push(this.fitT('fit_notice_private', null, 'Health entries are not saved from a private chat.'));
                    privateNotified = true;
                }
                continue;
            }
            if (!canWrite) continue;
            const date = this.fitDate(args.date, todayKey);
            const time = this.fitTime(args.time) || (date === todayKey ? this.fitNowTime() : '');
            try {
                if (name === 'LOG') {
                    const patch = {};
                    for (const field of ['weight', 'sleep_hours', 'body_fat', 'muscle_mass', 'water_pct',
                        'bone_mass', 'visceral_fat', 'steps', 'calories', 'protein', 'carbs', 'fat', 'water_ml']) {
                        if (args[field] === undefined) continue;
                        const value = this.fitNumber(args[field]);
                        if (value !== null) patch[field] = value;
                    }
                    const energy = this.fitScale(args.energy, 1, 5);
                    if (energy !== null) patch.energy = energy;
                    const mood = this.fitScale(args.mood, 1, 5);
                    if (mood !== null) patch.mood = mood;
                    const stress = this.fitScale(args.stress, 1, 5);
                    if (stress !== null) patch.stress = stress;
                    if (args.symptoms !== undefined) patch.symptoms = JSON.stringify(this.fitList(args.symptoms, 20));
                    if (args.workout !== undefined) {
                        const status = String(args.workout).toLowerCase();
                        if (['done', 'planned', 'skipped'].includes(status)) patch.workout_status = status;
                    }
                    if (args.workout_note !== undefined) patch.workout_note = String(args.workout_note).slice(0, 1000);
                    if (args.meal !== undefined) patch.meal_note = String(args.meal).slice(0, 1000);
                    if (args.note !== undefined) patch.note = String(args.note).slice(0, 4000);
                    if (Object.keys(patch).length) {
                        db.patchFitDailyLog(date, patch);
                        notices.push(this.fitT('fit_notice_daily', { date }, `Saved to Fit & Care for ${date}.`));
                        wrote = true;
                    }
                } else if (name === 'MEAL') {
                    const title = String(args.title || args.name || args.meal || '').slice(0, 200);
                    if (!title) continue;
                    const meal = {
                        log_date: date,
                        meal_time: time,
                        title,
                        tags: JSON.stringify(this.fitList(args.tags, 20)),
                        calories: this.fitNumber(args.calories),
                        protein: this.fitNumber(args.protein),
                        carbs: this.fitNumber(args.carbs),
                        fat: this.fitNumber(args.fat),
                        estimated: /^(1|true|yes|y|approx|approximate|estimated)$/i.test(String(args.estimated || '').trim()) ? 1 : 0,
                        note: String(args.note || '').slice(0, 1000)
                    };
                    db.saveFitMeal(meal);
                    notices.push(this.fitT('fit_notice_meal', { date }, `Meal saved to Fit & Care for ${date}.`) + (meal.estimated ? ' ' + this.fitT('fit_notice_meal_estimated', null, 'Macros are Aru\'s estimate.') : ''));
                    notices.push(...this.fitConflictNotices(meal));
                    wrote = true;
                } else if (name === 'WORKOUT') {
                    const title = String(args.title || args.name || args.workout || '').slice(0, 200);
                    if (!title) continue;
                    const status = String(args.status || args.workout || 'done').toLowerCase();
                    db.saveFitWorkout({
                        log_date: date,
                        log_time: time,
                        title,
                        exercises: this.fitExercises(args.exercises),
                        duration_min: this.fitNumber(args.duration || args.duration_min),
                        volume_kg: this.fitNumber(args.volume || args.volume_kg),
                        rpe: this.fitScale(args.rpe, 1, 10),
                        status: ['done', 'planned', 'skipped'].includes(status) ? status : 'done',
                        note: String(args.note || args.workout_note || '').slice(0, 1000)
                    });
                    notices.push(this.fitT('fit_notice_workout', { date }, `Workout saved to Fit & Care for ${date}.`));
                    wrote = true;
                } else if (name === 'MED') {
                    const medName = String(args.name || args.title || args.medication || '').slice(0, 200);
                    if (!medName) continue;
                    let protocol = null;
                    if (typeof db.getFitProtocolByName === 'function') {
                        protocol = db.getFitProtocolByName(medName);
                        if (!protocol && typeof db.getFitProtocols === 'function') {
                            const wanted = medName.toLowerCase();
                            protocol = (db.getFitProtocols(true) || []).find((entry) => {
                                const known = String(entry.name || '').toLowerCase();
                                return known && (known.includes(wanted) || wanted.includes(known));
                            }) || null;
                        }
                    }
                    const status = String(args.status || 'taken').toLowerCase() === 'skipped' ? 'skipped' : 'taken';
                    db.saveFitHealthLog({
                        log_date: date,
                        log_time: time,
                        protocol_id: protocol ? protocol.id : null,
                        type: 'medication',
                        name: protocol ? protocol.name : medName,
                        status,
                        note: String(args.note || '').slice(0, 1000)
                    });
                    notices.push(this.fitT('fit_notice_med', { date }, `Medication entry saved to Fit & Care for ${date}.`));
                    wrote = true;
                } else if (name === 'HEALTH') {
                    const type = String(args.type || 'measurement').toLowerCase();
                    const allowed = ['glucose', 'pressure', 'temperature', 'symptom', 'measurement', 'other'];
                    const value = this.fitNumber(args.value);
                    const value2 = this.fitNumber(args.value2);
                    const eventName = String(args.name || args.title || (value === null ? (args.value || '') : '') || type).slice(0, 200);
                    db.saveFitHealthLog({
                        log_date: date,
                        log_time: time,
                        type: allowed.includes(type) ? type : 'measurement',
                        name: eventName,
                        value,
                        value2,
                        unit: String(args.unit || '').slice(0, 20),
                        status: 'logged',
                        tags: JSON.stringify(this.fitList(args.tags, 20)),
                        note: String(args.note || '').slice(0, 1000)
                    });
                    notices.push(this.fitT('fit_notice_health', { date }, `Health event saved to Fit & Care for ${date}.`));
                    wrote = true;
                } else if (name === 'CYCLE_START') {
                    if (!cycleTrackingOn) {
                        if (!cycleOffNotified) {
                            notices.push(this.fitT('fit_notice_cycle_off', null, 'Cycle tracking is turned off in Fit & Care settings, so nothing was saved.'));
                            cycleOffNotified = true;
                        }
                        continue;
                    }
                    db.startFitCycle(date);
                    notices.push(this.fitT('fit_notice_cycle_start', { date }, `Cycle start saved for ${date}.`));
                    wrote = true;
                } else if (name === 'CYCLE_END') {
                    if (!cycleTrackingOn) {
                        if (!cycleOffNotified) {
                            notices.push(this.fitT('fit_notice_cycle_off', null, 'Cycle tracking is turned off in Fit & Care settings, so nothing was saved.'));
                            cycleOffNotified = true;
                        }
                        continue;
                    }
                    if (db.endFitCycle(date)) {
                        notices.push(this.fitT('fit_notice_cycle_end', { date }, `Cycle end saved for ${date}.`));
                        wrote = true;
                    }
                } else if (name === 'CYCLE_LOG') {
                    if (!cycleTrackingOn) {
                        if (!cycleOffNotified) {
                            notices.push(this.fitT('fit_notice_cycle_off', null, 'Cycle tracking is turned off in Fit & Care settings, so nothing was saved.'));
                            cycleOffNotified = true;
                        }
                        continue;
                    }
                    const flow = String(args.flow || '').toLowerCase();
                    if (!args.flow && !args.note) continue;
                    db.saveFitCycleLog({
                        log_date: date,
                        flow: ['light', 'medium', 'heavy', 'none'].includes(flow) ? flow : '',
                        note: String(args.note || '').slice(0, 1000)
                    });
                    notices.push(this.fitT('fit_notice_cycle_log', { date }, `Cycle flow saved for ${date}.`));
                    wrote = true;
                } else if (name === 'PLAN_CREATE') {
                    const title = String(args.title || args.name || '').slice(0, 200);
                    if (!title) continue;
                    const goal = String(args.goal || '').toLowerCase();
                    const weeks = this.fitScale(args.weeks, 1, 52) || 4;
                    lastPlanId = db.saveFitPlan({
                        title,
                        goal: ['strength', 'fat_loss', 'endurance', 'mobility', 'general'].includes(goal) ? goal : 'general',
                        start_date: this.fitDate(args.start_date, todayKey),
                        weeks,
                        status: 'active',
                        notes: String(args.notes || '').slice(0, 2000)
                    });
                    notices.push(this.fitT('fit_notice_plan_created', { title, weeks }, `Training plan "${title}" created (${weeks} weeks) and set as active.`));
                    wrote = true;
                } else if (name === 'PLAN_DAY') {
                    const plans = db.getFitPlans ? (db.getFitPlans() || []) : [];
                    let plan = null;
                    if (args.plan) {
                        plan = plans.find((entry) => String(entry.id) === String(args.plan))
                            || plans.find((entry) => String(entry.title || '').toLowerCase() === String(args.plan).toLowerCase())
                            || null;
                    }
                    if (!plan && lastPlanId) plan = plans.find((entry) => Number(entry.id) === Number(lastPlanId)) || null;
                    if (!plan) {
                        notices.push(this.fitT('fit_notice_plan_missing', null, 'No training plan found — create one with PLAN_CREATE first.'));
                        continue;
                    }
                    const week = Math.min(Number(plan.weeks) || 4, this.fitScale(args.week, 0, 52) || 0);
                    const weekday = this.fitScale(args.weekday || args.day, 1, 7) || 1;
                    db.saveFitPlanDay({
                        plan_id: plan.id,
                        week_index: week,
                        weekday,
                        title: String(args.title || '').slice(0, 200),
                        focus: String(args.focus || '').slice(0, 200),
                        exercises: this.fitPlanExercises(args.exercises),
                        notes: String(args.notes || '').slice(0, 1000)
                    });
                    const weekLabel = week === 0 ? this.fitT('fit_plan_template', null, 'Template') : week;
                    notices.push(this.fitT('fit_notice_plan_day', { plan: plan.title, week: weekLabel, weekday }, `Day added to plan "${plan.title}" (week ${weekLabel}, day ${weekday}).`));
                    wrote = true;
                }
            } catch (e) {
                console.error(`Triggers: Fit command ${name} failed`, e);
            }
        }
        if (wrote && window.FitCarePlugin && typeof window.FitCarePlugin.refresh === 'function') {
            try { window.FitCarePlugin.refresh(); } catch (e) { /* plugin not mounted */ }
        }
        return (clean.trim() + (notices.length ? `\n\n*${notices.join(' ')}*` : '')).trim();
    },

    //3.5 QUICK REPLIES (Suggestions): strips the invisible ARU_SUGGESTIONS tag
    //from the raw model output and returns clickable follow-up labels.
    //Runs BEFORE memory/artifact/tool processing so the tag never reaches the DB or the DOM.
    extractSuggestions(llmResponse) {
        const result = { cleanResponse: llmResponse, suggestions: [] };
        if (!llmResponse || typeof llmResponse !== 'string') return result;

        const tagRegex = /\[\[\s*ARU_SUGGESTIONS\s*\]\]([\s\S]*?)\[\[\s*\/\s*ARU_SUGGESTIONS\s*\]\]/i;
        const match = llmResponse.match(tagRegex);
        if (!match) return result;

        result.cleanResponse = llmResponse.replace(tagRegex, '').trim();

        let items = null;
        let inner = match[1].trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
        try {
            const parsed = JSON.parse(inner);
            if (Array.isArray(parsed)) items = parsed;
            else if (parsed && Array.isArray(parsed.suggestions)) items = parsed.suggestions;
        } catch (e) {
            // Tolerate loose local-model output: salvage quoted strings (single or double) inside the tag
            items = (inner.match(/"([^"\n]{2,120})"|'([^'\n]{2,120})'/g) || [])
                .map(s => s.replace(/^["']|["']$/g, ''));
        }

        if (Array.isArray(items)) {
            result.suggestions = items
                .filter(s => typeof s === 'string')
                .map(s => s.replace(/\s+/g, ' ').trim())
                .filter(s => s.length > 0 && s.length <= 120)
                .filter((s, i, arr) => arr.indexOf(s) === i)
                .slice(0, 3);
        }
        return result;
    },

    //4. TRIGGER ACTION (Tools)

    async processResponseForTools(llmResponse) {
        let cleanResponse = llmResponse;

        // Find all tool tags: [[TOOL:name args]]
        const toolRegex = /\[\[\s*TOOL\s*:\s*(\w+)\s*([\s\S]*?)\s*\]\]/gi;
        const matches = [...cleanResponse.matchAll(toolRegex)];

        // Track seen tools to avoid duplication of widgets
        const seenTags = new Set();
        const replacements = [];

        for (const match of matches) {
            const fullMatch = match[0];
            const toolName = match[1];
            const argsStr = match[2] || '';
            const offset = match.index;

            // Check if inside <pre> or <code>
            const before = cleanResponse.substring(0, offset);
            const insideCode = (before.lastIndexOf('<code') > before.lastIndexOf('</code>')) ||
                (before.lastIndexOf('<pre') > before.lastIndexOf('</pre>'));

            if (insideCode) continue;

            if (seenTags.has(fullMatch)) {
                replacements.push({ original: fullMatch, replacement: '', index: offset });
                continue;
            }

            seenTags.add(fullMatch);

            // Fetch widget HTML
            let replacementHTML = '';
            try {
                if (toolName === 'weather') {
                    const cityMatch = argsStr.replace(/&quot;/g, '"').match(/city="(.*?)"/);
                    const city = cityMatch ? cityMatch[1] : 'Almaty';
                    replacementHTML = await Tools.getWeatherCard(city);
                } else if (toolName === 'news') {
                    const tagMatch = argsStr.replace(/&quot;/g, '"').match(/tag="([^"]*)"/);
                    const langMatch = argsStr.replace(/&quot;/g, '"').match(/lang="([^"]*)"/);
                    const filter = tagMatch ? tagMatch[1] : (langMatch ? langMatch[1] : '');
                    const urls = window.app.getRSSUrls();
                    replacementHTML = await Tools.getNewsCard(urls, filter);
                } else if (toolName === 'tasks') {
                    const projMatch = argsStr.replace(/&quot;/g, '"').match(/project="([^"]*)"/);
                    replacementHTML = await Tools.getTasksCard(projMatch ? projMatch[1] : '');
                }
            } catch (e) {
                console.error("Tool Error", e);
                replacementHTML = `<div class="p-2 border border-red-200 rounded-lg text-red-500 text-[10px] flex items-center gap-2 mt-2 font-bold uppercase tracking-widest bg-red-50 dark:bg-red-900/10">
                        <i data-lucide="alert-triangle" class="w-3 h-3"></i> Tool Error: ${toolName}
                    </div>`;
            }

            replacements.push({ original: fullMatch, replacement: replacementHTML, index: offset });
        }

        // Apply replacements from back to front to maintain character offsets
        for (let i = replacements.length - 1; i >= 0; i--) {
            const rep = replacements[i];
            cleanResponse = cleanResponse.substring(0, rep.index) +
                rep.replacement +
                cleanResponse.substring(rep.index + rep.original.length);
        }

        // Fallback: if LLM didn't output any [[TOOL:...]] tags but the response
        // clearly asks to "show news", "show weather" or "show tasks", inject the appropriate widget.
        if (replacements.length === 0) {
            try {
                const lower = cleanResponse.toLowerCase();
                const urls = window.app?.getRSSUrls ? window.app.getRSSUrls() : [];
                // News cues
                if (/(покажи|показать|покажите|show).*(новост|news)/.test(lower)) {
                    const widget = await Tools.getNewsCard(urls, '');
                    cleanResponse += '\n\n' + widget;
                }
                // Task board cues (ru/kk/en)
                const showCue = /(покажи|показать|покажите|список|мои задачи|show|list|my tasks|көрсет|менің тапсырмаларым)/;
                const taskNoun = /(задач|тапсырма|task|board|доск|тақта)/;
                if (showCue.test(lower) && taskNoun.test(lower)) {
                    const widget = await Tools.getTasksCard('');
                    cleanResponse += '\n\n' + widget;
                }
                // Weather cues (supports Russian, English, and simple Kazakh heuristics)
                if (/(погода|weather|forecast|ауа райы|ауа рай)/.test(lower)) {
                    let city = 'Almaty';
                    const ruMatch = lower.match(/погода в ([a-zа-яё\-\s]+)/);
                    const enMatch = lower.match(/weather in ([a-z\-\s]+)/);
                    const kkMatch = lower.match(/ауа райы (?:қала|в|в?ы?)?\s*([a-zа-яё\-\s]+)/);
                    if (ruMatch && ruMatch[1]) city = ruMatch[1].trim();
                    else if (enMatch && enMatch[1]) city = enMatch[1].trim();
                    else if (kkMatch && kkMatch[1]) city = kkMatch[1].trim();
                    const w = await Tools.getWeatherCard(city);
                    cleanResponse += '\n\n' + w;
                }
            } catch (e) {
                console.warn('Tool fallback injection failed', e);
            }
        }

        return cleanResponse;
    }
};
