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

export const Triggers = {

    // Similarity tolerance configuration for duplicate vector mapping
    DUPLICATE_SIMILARITY: 0.85,

    // Regex Constants
    PATTERNS: {
        // Resolves semantic captures interpreting flexible multidimensional memory brackets
        MEMORY: /(?:\[\[|\[)\s*MEMORY:\s*([\s\S]*?)\s*(?:\]\]|\])/gi,
        ARTIFACT: /\[\[\s*ARU_ARTIFACT\s+type\s*=\s*(?:"|'|&quot;|)(.*?)(?:"|'|&quot;|)\s+title\s*=\s*(?:"|'|&quot;|)(.*?)(?:"|'|&quot;|)\s*\]\]([\s\S]*?)\[\[?\s*\/ARU_ARTIFACT\s*\]?\]/gi,
        TOOL: /\[\[\s*TOOL\s*:\s*(\w+)\s*(.*?)\s*\]\]/gi,
        TASK: /\[\[\s*TASK\s*:\s*(\w+)\s*(.*?)\s*\]\]/gi
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
                const regex = new RegExp(`\\b${cue}\\b`, 'i');
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
                const nameRegex = new RegExp(`\\b${name}\\b`, 'i');
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
                    const nameRu = text.match(/(?:Привет,\s*|я знаю, что тебя зовут\s*|тебя зовут\s*|тебя зовут,?\s*)([А-ЯЁA-Z][а-яёА-ЯA-Za-z\-']{1,30})/i);
                    const ageRu = text.match(/(?:тебе|вам)\s*(\d{1,3})\s*(?:год|года|лет)?/i);

                    if (nameRu && nameRu[1]) heuristics.push(`Имя: ${nameRu[1].trim()}`);
                    if (ageRu && ageRu[1]) heuristics.push(`Возраст: ${ageRu[1].trim()}`);

                    // Identifies associative parameters utilizing generalized ASCII language bindings
                    const nameEn = text.match(/(?:Hi,\s*|Hello,\s*|I know your name is\s*|your name is\s*)([A-Z][a-z\-']{1,30})/i);
                    const ageEn = text.match(/(?:you are|you're|age is|you are )\s*(\d{1,3})\b/i);
                    if (nameEn && nameEn[1]) heuristics.push(`Name: ${nameEn[1].trim()}`);
                    if (ageEn && ageEn[1]) heuristics.push(`Age: ${ageEn[1].trim()}`);

                    // Identifies associative parameters utilizing specific Turkic grammatical heuristics
                    const nameKz = text.match(/(?:Менің атым|Сіздің атыңыз|сенің атың)\s*[:,\-]?\s*([А-ЯӘІӨҰҮA-Z][а-яәіөүұүА-ЯA-Za-z\-']{1,30})/i);
                    const ageKz = text.match(/(?:жасыңыз|жасың|жасы)\s*(\d{1,3})/i);
                    if (nameKz && nameKz[1]) heuristics.push(`Аты: ${nameKz[1].trim()}`);
                    if (ageKz && ageKz[1]) heuristics.push(`Жасы: ${ageKz[1].trim()}`);

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
                        console.log('Triggers.saveMemories: found similar memory, skipping save', { fact, similar: similar.map(s => ({ id: s.id, similarity: s.similarity })) });
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

            const item = config[type] || config.doc;

            const replacementCard = `
<div class="my-4 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex items-center justify-between gap-4 shadow-sm group hover:border-aru-400 transition cursor-pointer" onclick="window.app.openArtifact('${type}', '${title.replace(/'/g, "\\'")}')">
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
            window.aruArtifactsCache[cacheKey] = { type, title, code: code.trim() };

            if (!isPrivate && chatId !== null && chatId !== undefined && DB.saveChatArtifact) {
                DB.saveChatArtifact(chatId, title, type, code.trim());
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

    processResponseForTasks(llmResponse, isPrivate = false) {
        if (!llmResponse) return llmResponse;
        let cleanResponse = llmResponse;
        this.PATTERNS.TASK.lastIndex = 0;
        const matches = [...cleanResponse.matchAll(this.PATTERNS.TASK)];

        if (matches.length === 0) return cleanResponse;

        // Write-only commands — blocked in private chats
        const WRITE_COMMANDS = new Set(['CREATE_PROJECT', 'CREATE_TASK', 'MOVE_TASK', 'DELETE_TASK', 'UPDATE_TASK']);

        let privateBlockShown = false; // Show the notice only once per response

        for (const match of matches) {
            const [fullMatch, command, argsStr] = match;
            const args = {};
            const argRegex = /(\w+)\s*=\s*(?:"|'|&quot;)(.*?)(?:"|'|&quot;)/g;
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
                        if (!query) return taskPlugin.state.projects.find(p => p.id === taskPlugin.state.activeProjectId);
                        return taskPlugin.state.projects.find(p => p.id === query || p.name.toLowerCase() === query.toLowerCase());
                    };


                    // Localized default column names based on current app language
                    const getLang = () => {
                        try { return (window.aruGlobalState || state).lang || 'en'; } catch (e) { return 'en'; }
                    };
                    const defaultColumns = () => {
                        const lang = getLang();
                        if (lang === 'ru') return ['К выполнению', 'В работе', 'Готово'];
                        if (lang === 'kk') return ['Орындалатын', 'Жүріп жатыр', 'Дайын'];
                        return ['To Do', 'In Progress', 'Done'];
                    };

                    switch (command) {
                        case 'CREATE_PROJECT':
                            if (args.name) {
                                const colNames = defaultColumns();
                                taskPlugin.state.projects.push({
                                    id: 'p-' + Date.now(),
                                    name: args.name,
                                    columns: [
                                        { id: 'c1-' + Date.now(), title: colNames[0], tasks: [] },
                                        { id: 'c2-' + Date.now() + 1, title: colNames[1], tasks: [] },
                                        { id: 'c3-' + Date.now() + 2, title: colNames[2], tasks: [] }
                                    ]
                                });
                                taskPlugin.saveState();
                                taskPlugin.renderProjects();
                            }
                            break;

                        case 'CREATE_TASK': {
                            const targetProject = findProject(args.project);
                            if (targetProject) {
                                // Try to find column by name if specified, else default to first
                                let col = targetProject.columns[0];
                                if (args.column) {
                                    const found = targetProject.columns.find(c => c.title.toLowerCase() === args.column.toLowerCase());
                                    if (found) col = found;
                                }
                                col.tasks.push({
                                    id: 't-' + Date.now(),
                                    title: args.title || 'New Task',
                                    desc: args.desc || '',
                                    deadline: args.deadline || ''
                                });
                                taskPlugin.saveState();
                                taskPlugin.renderBoard();
                            }
                            break;
                        }

                        case 'MOVE_TASK': {
                            // Find task by title across all projects
                            let foundTask = null;
                            let sourceProject = null;

                            taskPlugin.state.projects.forEach(p => {
                                p.columns.forEach(c => {
                                    const idx = c.tasks.findIndex(t =>
                                        (args.id && t.id === args.id) ||
                                        (args.title && t.title.toLowerCase() === args.title.toLowerCase())
                                    );
                                    if (idx !== -1 && !foundTask) {
                                        sourceProject = p;
                                        foundTask = c.tasks.splice(idx, 1)[0];
                                    }
                                });
                            });

                            if (foundTask) {
                                const destProject = findProject(args.to_project) || sourceProject;
                                // Match target column by exact name (case-insensitive, works with any language)
                                const toCol = (args.to_column
                                    ? destProject.columns.find(c => c.title.toLowerCase() === args.to_column.toLowerCase())
                                    : null) || destProject.columns[0];
                                toCol.tasks.push(foundTask);
                                taskPlugin.saveState();
                                taskPlugin.renderBoard();
                            }
                            break;
                        }

                        case 'DELETE_TASK':
                            taskPlugin.state.projects.forEach(p => {
                                p.columns.forEach(c => {
                                    c.tasks = c.tasks.filter(t =>
                                        (!args.id || t.id !== args.id) &&
                                        (!args.title || t.title.toLowerCase() !== args.title.toLowerCase())
                                    );
                                });
                            });
                            taskPlugin.saveState();
                            taskPlugin.renderBoard();
                            break;
                    }
                } catch (e) {
                    console.error("Triggers: Task command failed", e);
                }
            }

            cleanResponse = cleanResponse.replace(fullMatch, '');
        }

        return cleanResponse.trim();
    },

    //4. TRIGGER ACTION (Tools)

    async processResponseForTools(llmResponse) {
        let cleanResponse = llmResponse;

        // Find all tool tags: [[TOOL:name args]]
        const toolRegex = /\[\[\s*TOOL\s*:\s*(\w+)\s*(.*?)\s*\]\]/gi;
        const matches = [...cleanResponse.matchAll(toolRegex)];
        if (matches.length === 0) return cleanResponse;

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
        // clearly asks to "show news" or "show weather", inject the appropriate widget.
        if (replacements.length === 0) {
            try {
                const lower = cleanResponse.toLowerCase();
                const urls = window.app?.getRSSUrls ? window.app.getRSSUrls() : [];
                // News cues
                if (/(покажи|показать|покажите|show).*(новост|news)/.test(lower)) {
                    const widget = await Tools.getNewsCard(urls, '');
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