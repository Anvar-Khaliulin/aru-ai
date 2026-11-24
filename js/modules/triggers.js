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
import { Safety } from './safety.js';

// JS \b treats Cyrillic as a non-word character, so explicit lookarounds are
// needed for ru/kk cues ("создай", "Ару") to match at all (without lookbehind for Safari < 16.4).
const wordBoundary = (word) => new RegExp(
    `(?:^|[^a-zа-яёәіңөұүқғһ0-9])${String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zа-яёәіңөұүқғһ0-9])`,
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
            if (!DB.db || DB.query("SELECT 1 FROM memory_facts LIMIT 1").length === 0) {
                return '';
            }
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

    async processRecallModules(userQuery, tab = state.tabs[state.activeTabIndex]) {
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
                const storageScope = (DB && DB.getArtifactScopeKey)
                    ? DB.getArtifactScopeKey({ source: 'module', type: match.type, title: match.name })
                    : null;
                setTimeout(() => {
                    if (!state.tabs.includes(tab)) return;
                    tab.artifact = { type: match.type, title: match.name, code: match.content, source: 'module', storageScope };
                    tab.isCanvasOpen = true;
                    if (state.tabs[state.activeTabIndex] === tab) {
                        CanvasManager.renderArtifact(match.type, match.name, match.content, { source: 'module', storageScope });
                    }
                }, 500);
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
                cleanResponse = cleanResponse.replace(/\(\s*(?:System|Система|Status|Статус|MOOD|SARCASM|AFFINITY|FLAGS)\s*:[\s\S]*?\)/gi, '');
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
                cleanResponse = cleanResponse.replace(/\(\s*(?:System|Система|Status|Статус|MOOD|SARCASM|AFFINITY|FLAGS)\s*:[\s\S]*?\)/gi, '');
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
                    const nonNames = new Set(['как', 'что', 'где', 'там', 'тут', 'есть', 'да', 'нет', 'ару', 'aru', 'here', 'there', 'sure', 'yes', 'no', 'well', 'now', 'user']);
                    const isPlausibleName = (s) => {
                        const clean = (s || '').trim();
                        return clean.length >= 2 && !nonNames.has(clean.toLowerCase());
                    };

                    const nameRu = text.match(/(?:[Пп]ривет,\s*|[Яя] знаю, что тебя зовут\s*|[Тт]ебя зовут,?\s*)([А-ЯЁӘІҢҒҮҰҚӨҺA-Z][а-яёәіңғүұқөһa-z\-']{1,30})/);
                    // Year-word is MANDATORY and range-checked: bare "тебе 2/100" matched
                    // everything from "варианта" to "процентов" and poisoned memory with junk ages.
                    const ageRuM = text.match(/(?:тебе|вам)\s+(\d{1,3})\s*(?:год|года|годы|лет)(?![а-яё])/i);

                    if (nameRu && isPlausibleName(nameRu[1])) heuristics.push(`Имя: ${nameRu[1].trim()}`);
                    if (ageRuM) { const a = saneAge(ageRuM[1]); if (a) heuristics.push(`Возраст: ${a}`); }

                    // Identifies associative parameters utilizing generalized ASCII language bindings
                    const nameEn = text.match(/(?:[Hh]i,\s*|[Hh]ello,\s*|[Ii] know your name is\s*|[Yy]our name is\s*)([A-Z][a-z\-']{1,30})/);
                    const ageEnM = text.match(/(?:you are|you're)\s+(\d{1,3})\s*years?\s+old\b/i) || text.match(/\bage\s+is\s+(\d{1,3})\b/i);
                    if (nameEn && isPlausibleName(nameEn[1])) heuristics.push(`Name: ${nameEn[1].trim()}`);
                    if (ageEnM) { const a = saneAge(ageEnM[1]); if (a) heuristics.push(`Age: ${a}`); }

                    // Identifies associative parameters utilizing specific Turkic grammatical heuristics
                    const nameKz = text.match(/(?:[Сс]іздің атыңыз|[Сс]енің атың)\s*[:,\-]?\s*([А-ЯӘІҢҒҮҰҚӨҺA-Z][а-яәіңғүұқөһa-z\-']{1,30})/);
                    const ageKzM = text.match(/(?:жасыңыз|жасың|жасы)\s*(\d{1,3})/i);
                    if (nameKz && isPlausibleName(nameKz[1])) heuristics.push(`Аты: ${nameKz[1].trim()}`);
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
                        const sameText = String(best.content || '').trim().toLowerCase() === String(fact || '').trim().toLowerCase();
                        if (sameText || best.similarity >= 0.995) {
                            console.log('Triggers.saveMemories: duplicate memory already stored, skipping', { fact, id: best.id, similarity: best.similarity });
                        } else {
                            // Related fact with updated value (e.g. age 25 -> 26): update in place.
                            console.log('Triggers.saveMemories: updating related memory in place', { fact, id: best.id, similarity: best.similarity });
                            await DB.updateFact(best.id, fact, vecArr);
                            this.showMemoryToast();
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

    _parseTagAttrs(raw) {
        const attrs = {};
        const attrRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|&quot;([\s\S]*?)&quot;|([^\s\]]+))/g;
        let match;
        while ((match = attrRegex.exec(raw || '')) !== null) {
            attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? match[5] ?? '';
        }
        return attrs;
    },

    _stripCodeFence(code) {
        const value = String(code || '').trim();
        const fenced = /^```[a-z0-9_\-+]*\s*\n([\s\S]*?)\n?```$/i.exec(value);
        if (fenced) return fenced[1].trim();
        return value
            .replace(/^```[a-z0-9_\-+]*\s*\n/i, '')
            .replace(/\n?```\s*$/i, '')
            .trim();
    },

    _artifactTypeFrom(raw, code, userText = '') {
        const type = String(raw || '').toLowerCase().trim();
        if (['game', 'app', 'analytics', 'doc'].includes(type)) return type;

        const body = String(code || '').toLowerCase();
        if (/getcontext\(|requestanimationframe|new chart\(|chart\.js|<canvas/.test(body)) {
            return /chart|dashboard|дашборд/.test(body) ? 'analytics' : 'game';
        }
        if (/<html|<!doctype|<div|document\.|getelementbyid/.test(body)) return 'app';

        const query = String(userText || '').toLowerCase();
        if (/игр|game/.test(query)) return 'game';
        if (/аналитик|дашборд|analytics|dashboard/.test(query)) return 'analytics';
        if (/документ|document/.test(query)) return 'doc';
        return 'app';
    },

    // Cyrillic words do not honor \b, so intent checks use plain stems.
    _isArtifactRequest(userText) {
        const query = String(userText || '').toLowerCase();
        if (!query) return false;
        const action = /(созда|сдела|напиш|построй|сгенерир|придума|разработа|хочу|нужн|create|make|build|generate|write|want|need)/;
        const subject = /(игр|game|приложен|\bapp\b|документ|document|дашборд|dashboard|аналитик|analytics)/;
        return action.test(query) && subject.test(query);
    },

    _isDocRequest(userText) {
        const query = String(userText || '').toLowerCase();
        if (!query) return false;
        const action = /(созда|сдела|напиш|подготов|состав|оформ|нужен|нужна|нужно|хочу|create|make|write|draft|prepare|need|want)/;
        const subject = /(документ|document|\bdoc\b)/;
        return action.test(query) && subject.test(query);
    },

    _promoteCodeBlock(code, lang, fullMatch, userText, wantsArtifact) {
        if (!code || code.trim().length < 100) return null; // Ignore tiny snippets

        const artifactLangs = ['html', 'app', 'game', 'analytics', 'doc'];
        const lowerLang = String(lang || '').toLowerCase();
        const trimmed = code.trim();
        const domDriven = /document\.|getElementById|querySelector|createElement|addEventListener\(|requestAnimationFrame\(|getContext\(|window\./i.test(code);

        // Weaker models sometimes ignore the artifact protocol and answer a
        // clear "make me a game/app" request with a plain JS block. Promote it
        // only when the user asked for it and the code actually drives a DOM.
        const jsLangs = ['js', 'javascript', 'jsx', 'ts', 'tsx'];
        const promoteJs = wantsArtifact && jsLangs.includes(lowerLang) && trimmed.length >= 600 && domDriven;
        // A truncated reply can also leave an unclosed fence without a language.
        const promoteBareHtml = !lang && wantsArtifact && /^(?:<!doctype|<html|<div|<canvas)/i.test(trimmed) && domDriven;

        if (!promoteJs && !promoteBareHtml && (!lang || !artifactLangs.includes(lowerLang))) return null;

        let type;
        if (['app', 'game', 'analytics', 'doc'].includes(lowerLang)) {
            type = lowerLang;
        } else if (lowerLang === 'html') {
            // High-confidence check for app/game/analytics
            const isInteractive = code.includes('Canvas') || code.includes('Game') || code.includes('Chart') || code.includes('getContext(');
            type = isInteractive ? (code.includes('Chart') ? 'analytics' : 'game') : 'app';
        } else {
            type = this._artifactTypeFrom('', code, userText);
        }

        return {
            type,
            title: "Auto Generated " + (type.charAt(0).toUpperCase() + type.slice(1)),
            code: trimmed,
            fullMatch,
            autoTitle: true
        };
    },

    processResponseForArtifacts(llmResponse, chatId = null, isPrivate = false, userText = '') {
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

        // The strict tag regex can miss two common cases: the reply was cut off
        // by the output token limit (no closing tag), or the attributes were
        // malformed. Salvage the body between the tags (or up to the end) so the
        // user gets a card and a canvas instead of raw code in the chat.
        if (artifactsFound.length === 0) {
            const openTag = /\[\[\s*ARU_ARTIFACT\b([^\]]*)\]\]/i.exec(llmResponse);
            if (openTag) {
                const closeRegex = /\[\[\s*\/ARU_ARTIFACT\s*\]\]/gi;
                closeRegex.lastIndex = openTag.index + openTag[0].length;
                const closeTag = closeRegex.exec(llmResponse);
                const body = llmResponse.slice(
                    openTag.index + openTag[0].length,
                    closeTag ? closeTag.index : llmResponse.length
                );
                const code = this._stripCodeFence(body);
                if (code) {
                    const attrs = this._parseTagAttrs(openTag[1]);
                    const type = this._artifactTypeFrom(attrs.type, code, userText);
                    const title = String(attrs.title || '').trim();
                    artifactsFound.push({
                        type,
                        title: title || "Auto Generated " + (type.charAt(0).toUpperCase() + type.slice(1)),
                        code,
                        fullMatch: llmResponse.slice(
                            openTag.index,
                            closeTag ? closeTag.index + closeTag[0].length : llmResponse.length
                        ),
                        autoTitle: !title
                    });
                }
            }
        }

        // HEURISTIC FALLBACK: If no artifacts found, but there's a code block
        if (artifactsFound.length === 0) {
            const wantsArtifact = this._isArtifactRequest(userText);
            // Updated regex: capture ANY optional language identifier (e.g., python, js, html)
            const codeBlockRegex = /```([a-z0-9_\-+]+)?\s*\n([\s\S]*?)```/gi;
            let cbMatch;
            while ((cbMatch = codeBlockRegex.exec(llmResponse)) !== null) {
                const [fullMatch, lang, code] = cbMatch;
                const art = this._promoteCodeBlock(code, lang, fullMatch, userText, wantsArtifact);
                if (art) artifactsFound.push(art);
            }

            // Output truncated in the middle of a fenced block: promote the tail.
            if (artifactsFound.length === 0) {
                const fenceMarks = (llmResponse.match(/```/g) || []).length;
                const openings = [...llmResponse.matchAll(/```([a-z0-9_\-+]*)[ \t]*\n/gi)];
                if (fenceMarks % 2 === 1 && openings.length > 0) {
                    const last = openings[openings.length - 1];
                    const tail = llmResponse.slice(last.index + last[0].length);
                    const art = this._promoteCodeBlock(
                        tail,
                        last[1],
                        llmResponse.slice(last.index),
                        userText,
                        wantsArtifact
                    );
                    if (art) artifactsFound.push(art);
                }
            }
        }

        // Progressive fallback for weak/local models that answer with plain text:
        // a document request becomes a doc artifact, a game/app request answered
        // with bare HTML becomes an app. Guarded by length and intent so normal
        // explanations and clarifying questions stay in the chat.
        if (artifactsFound.length === 0) {
            const text = String(llmResponse || '').trim();
            const startsHtml = /^(?:<!doctype|<html|<body|<div|<canvas|<svg)/i.test(text);
            const hasMarkup = /<script|<canvas|<\/(?:div|body|html)>/i.test(text);
            const looksLikeApp = startsHtml && hasMarkup && text.length >= 400;

            if (text.length >= 400 && !/```/.test(text) && this._isDocRequest(userText) && !looksLikeApp) {
                const isQuestion = /^(?:какой|какую|какое|что|чем|how|what|which)[\s\S]{0,80}\?/i.test(text)
                    && text.length < 1200;
                if (!isQuestion) {
                    artifactsFound.push({
                        type: 'doc',
                        title: 'Auto Generated Doc',
                        code: text,
                        fullMatch: llmResponse,
                        autoTitle: true
                    });
                }
            } else if (looksLikeApp && this._isArtifactRequest(userText)) {
                artifactsFound.push({
                    type: this._artifactTypeFrom('', text, userText),
                    title: 'Auto Generated App',
                    code: text,
                    fullMatch: llmResponse,
                    autoTitle: true
                });
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
            const tab = chatId === null ? state.tabs[state.activeTabIndex]
                : state.tabs.find((item) => item.chatId === chatId);
            const effectiveChatId = (chatId !== null && chatId !== undefined) ? chatId : (tab ? tab.chatId : null);
            const storageScope = (DB && DB.getArtifactScopeKey)
                ? DB.getArtifactScopeKey({ source: 'chat', type: last.type, title: last.title, chatId: effectiveChatId, isPrivate })
                : null;
            setTimeout(() => {
                if (!state.tabs.includes(tab)) return;
                tab.artifact = { type: last.type, title: last.title, code: last.code, source: 'chat', storageScope };
                tab.isCanvasOpen = true;
                if (state.tabs[state.activeTabIndex] === tab) {
                    CanvasManager.renderArtifact(last.type, last.title, last.code, { source: 'chat', storageScope });
                }
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

    _normTaskText(s) {
        return String(s || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
    },

    _parseTaskPriority(raw) {
        const v = this._normTaskText(raw);
        if (v === 'urgent' || v === 'срочно' || v === 'срочный' || v === 'критичный') return 'urgent';
        if (v === 'high' || v === 'высокий' || v === 'важный') return 'high';
        if (v === 'medium' || v === 'средний') return 'medium';
        if (v === 'low' || v === 'низкий') return 'low';
        if (v === 'none' || v === 'нет' || v === 'обычный') return 'none';
        return null;
    },

    _parseTaskSubtasks(raw, uidFn) {
        return String(raw || '')
            .split(/[;\n|]+/)
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 20)
            .map(title => ({ id: uidFn('s'), title: title.slice(0, 160), done: false }));
    },

    processResponseForTasks(llmResponse, isPrivate = false) {
        if (!llmResponse) return llmResponse;
        let cleanResponse = llmResponse;
        this.PATTERNS.TASK.lastIndex = 0;
        const matches = [...cleanResponse.matchAll(this.PATTERNS.TASK)];

        if (matches.length === 0) return cleanResponse;

        // Write-only commands — blocked in private chats
        const WRITE_COMMANDS = new Set([
            'CREATE_PROJECT', 'RENAME_PROJECT', 'CREATE_COLUMN', 'RENAME_COLUMN',
            'CREATE_TASK', 'MOVE_TASK', 'UPDATE_TASK', 'COMPLETE_TASK', 'ADD_SUBTASK', 'DELETE_TASK'
        ]);
        const DONE_COL_RX = /готов|done|выполнен(?:о|ы|а|ные|ный|ная)|заверш|сделан|дайын|аяқтал|complete|finish/i;

        let privateBlockShown = false; // Show the notice only once per response
        const notices = []; // Localized system notices appended once at the end

        for (const match of matches) {
            const [fullMatch, command, argsStr] = match;
            const cmd = String(command || '').toUpperCase();
            const args = {};
            const argRegex = /(\w+)\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|&quot;([\s\S]*?)&quot;|([^\s\]]+))/g;
            let argMatch;
            while ((argMatch = argRegex.exec(argsStr)) !== null) {
                args[argMatch[1].toLowerCase()] = (argMatch[2] ?? argMatch[3] ?? argMatch[4] ?? argMatch[5] ?? '');
            }

            // In private mode — block all write commands
            if (isPrivate && WRITE_COMMANDS.has(cmd)) {
                console.log(`Trigger Task: BLOCKED in private mode — ${cmd}`);
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

            console.log(`Trigger Task: Executing ${cmd}`, args);

            if (window.TaskPlugin) {
                try {
                    const taskPlugin = window.TaskPlugin;

                    const norm = (s) => this._normTaskText(s);

                    // Fuzzy-safe project lookup: ID -> exact normalized -> unique substring
                    const findProject = (query) => {
                        const list = taskPlugin.state.projects || [];
                        if (!query) return list.find(p => p.id === taskPlugin.state.activeProjectId) || list[0];
                        const exact = list.find(p => String(p.id) === String(query) || norm(p.name) === norm(query));
                        if (exact) return exact;
                        const qn = norm(query);
                        if (qn.length >= 2) {
                            const subs = list.filter(p => norm(p.name).includes(qn));
                            if (subs.length === 1) return subs[0];
                        }
                        return null;
                    };

                    const findColumn = (project, query) => {
                        const cols = (project && project.columns) || [];
                        if (!query) return null;
                        const exact = cols.find(c => String(c.id) === String(query) || norm(c.title) === norm(query));
                        if (exact) return exact;
                        const qn = norm(query);
                        if (qn.length >= 2) {
                            const subs = cols.filter(c => norm(c.title).includes(qn));
                            if (subs.length === 1) return subs[0];
                        }
                        return null;
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

                    // Smart task finder: ID -> exact normalized (active project first) -> unique substring
                    const findTask = (query, projectScope) => {
                        if (!query) return null;
                        const allProjects = taskPlugin.state.projects || [];
                        const ordered = projectScope
                            ? [projectScope]
                            : [...allProjects].sort((a, b) => (a.id === taskPlugin.state.activeProjectId ? -1 : b.id === taskPlugin.state.activeProjectId ? 1 : 0));
                        const qn = norm(query);
                        for (const p of ordered) {
                            for (const c of (p.columns || [])) {
                                const t = (c.tasks || []).find(item => String(item.id) === String(query) || norm(item.title) === qn);
                                if (t) return { project: p, column: c, task: t };
                            }
                        }
                        if (qn.length >= 3) {
                            const candidates = [];
                            for (const p of ordered) {
                                for (const c of (p.columns || [])) {
                                    for (const item of (c.tasks || [])) {
                                        if (norm(item.title).includes(qn)) candidates.push({ project: p, column: c, task: item });
                                    }
                                }
                            }
                            if (candidates.length === 1) return candidates[0];
                            // If scoped to active project uniquely inside first project
                            if (candidates.length > 1 && ordered.length > 1) {
                                const activeHits = candidates.filter(c => c.project.id === taskPlugin.state.activeProjectId);
                                if (activeHits.length === 1) return activeHits[0];
                            }
                        }
                        return null;
                    };

                    switch (cmd) {
                        case 'CREATE_PROJECT': {
                            if (!args.name) break;
                            const existing = taskPlugin.state.projects.find(p => norm(p.name) === norm(args.name));
                            if (existing) {
                                notices.push(this.taskT('task_notice_project_exists', { project: args.name }, `Project "${args.name}" already exists.`));
                                break;
                            }
                            const newProj = {
                                id: uid('p'),
                                name: args.name,
                                columns: defaultColumns()
                            };
                            taskPlugin.state.projects.push(newProj);
                            if (!taskPlugin.state.activeProjectId) {
                                taskPlugin.selectProject(newProj.id);
                            } else {
                                taskPlugin.renderProjects();
                            }
                            taskPlugin.saveState();
                            break;
                        }

                        case 'RENAME_PROJECT': {
                            const proj = findProject(args.name || args.project);
                            if (!proj) {
                                notices.push(this.taskT('task_notice_project_not_found', { project: args.name || args.project || '' }, `Project "${args.name || args.project || ''}" was not found.`));
                                break;
                            }
                            const nextName = String(args.new_name || args.to || '').trim();
                            if (!nextName) break;
                            proj.name = nextName;
                            if (proj.id === taskPlugin.state.activeProjectId && typeof taskPlugin.selectProject === 'function') {
                                taskPlugin.selectProject(proj.id);
                            } else {
                                taskPlugin.renderProjects();
                            }
                            taskPlugin.saveState();
                            notices.push(this.taskT('task_notice_project_renamed', { project: nextName }, `Project renamed to "${nextName}".`));
                            break;
                        }

                        case 'CREATE_COLUMN': {
                            const colTitle = String(args.name || args.title || args.column || '').trim();
                            if (!colTitle) break;
                            const targetProject = args.project ? findProject(args.project) : findProject('');
                            if (!targetProject) {
                                notices.push(this.taskT('task_notice_project_not_found', { project: args.project || '' }, `Project "${args.project || ''}" was not found.`));
                                break;
                            }
                            ensureColumns(targetProject);
                            if (!findColumn(targetProject, colTitle)) {
                                targetProject.columns.push({ id: uid('c'), title: colTitle, tasks: [] });
                                taskPlugin.saveState();
                                taskPlugin.renderBoard();
                                notices.push(this.taskT('task_notice_column_created', { column: colTitle }, `Column "${colTitle}" added.`));
                            }
                            break;
                        }

                        case 'RENAME_COLUMN': {
                            const targetProject = args.project ? findProject(args.project) : findProject('');
                            if (!targetProject) {
                                notices.push(this.taskT('task_notice_project_not_found', { project: args.project || '' }, `Project "${args.project || ''}" was not found.`));
                                break;
                            }
                            const col = findColumn(targetProject, args.name || args.column);
                            const nextTitle = String(args.new_name || args.to || '').trim();
                            if (!col) {
                                notices.push(this.taskT('task_notice_column_not_found', { column: args.name || args.column || '', fallback: (targetProject.columns[0] && targetProject.columns[0].title) || '' }, `Column "${args.name || args.column || ''}" was not found.`));
                                break;
                            }
                            if (!nextTitle) break;
                            col.title = nextTitle;
                            taskPlugin.saveState();
                            taskPlugin.renderBoard();
                            notices.push(this.taskT('task_notice_column_renamed', { column: nextTitle }, `Column renamed to "${nextTitle}".`));
                            break;
                        }

                        case 'CREATE_TASK': {
                            const hadActiveProject = !!taskPlugin.state.activeProjectId;
                            let createdProject = false;
                            let targetProject = findProject(args.project);
                            if (!targetProject) {
                                const projName = args.project || (typeof taskPlugin.getT === 'function'
                                    ? taskPlugin.getT('task_seed_project', 'My First Project')
                                    : 'My First Project');
                                targetProject = { id: uid('p'), name: projName, columns: defaultColumns() };
                                taskPlugin.state.projects.push(targetProject);
                                createdProject = true;
                                if (!hadActiveProject) taskPlugin.state.activeProjectId = targetProject.id;
                                notices.push(this.taskT('task_notice_project_created', { project: projName }, `Project "${projName}" was created.`));
                            }

                            ensureColumns(targetProject);

                            let col = targetProject.columns[0];
                            if (args.column) {
                                const foundCol = findColumn(targetProject, args.column);
                                if (foundCol) col = foundCol;
                                else notices.push(this.taskT('task_notice_column_not_found', { column: args.column, fallback: col.title }, `Column "${args.column}" was not found, used "${col.title}" instead.`));
                            }
                            const newTask = {
                                id: uid('t'),
                                title: args.title || defaultTaskTitle(),
                                desc: args.desc || '',
                                deadline: this._normalizeTaskDeadline(args.deadline)
                            };
                            const prio = this._parseTaskPriority(args.priority);
                            if (prio) newTask.priority = prio;
                            if (args.tags) {
                                newTask.tags = this.fitList(args.tags, 10).map(s => s.replace(/^#+/, ''));
                            }
                            if (args.subtasks) {
                                newTask.subtasks = this._parseTaskSubtasks(args.subtasks, uid);
                            }
                            if (targetProject.columns.length > 1 && DONE_COL_RX.test(String(col.title || ''))) {
                                newTask.done = true;
                                newTask.completedAt = new Date().toISOString();
                            }
                            col.tasks.push(newTask);
                            taskPlugin.saveState();
                            if (createdProject) {
                                taskPlugin.selectProject(taskPlugin.state.activeProjectId || targetProject.id);
                            } else {
                                taskPlugin.renderProjects();
                                taskPlugin.renderBoard();
                            }
                            break;
                        }

                        case 'MOVE_TASK': {
                            const scopedProject = args.project ? findProject(args.project) : null;
                            if (args.project && !scopedProject) {
                                notices.push(this.taskT('task_notice_project_not_found', { project: args.project }, `Project "${args.project}" was not found.`));
                                break;
                            }
                            const found = findTask(args.id || args.title, scopedProject);
                            if (!found) {
                                notices.push(this.taskT('task_notice_task_not_found', { title: args.title || args.id || '' }, `Task "${args.title || args.id || ''}" was not found.`));
                                break;
                            }

                            let destProject = found.project;
                            if (args.to_project) {
                                const explicitDest = findProject(args.to_project);
                                if (!explicitDest) {
                                    notices.push(this.taskT('task_notice_project_not_found', { project: args.to_project }, `Project "${args.to_project}" was not found.`));
                                    break;
                                }
                                destProject = explicitDest;
                            }
                            ensureColumns(destProject);

                            let toCol = args.to_column ? findColumn(destProject, args.to_column) : null;
                            if (args.to_column && !toCol) {
                                notices.push(this.taskT('task_notice_column_not_found', { column: args.to_column, fallback: destProject.columns[0].title }, `Column "${args.to_column}" was not found, used "${destProject.columns[0].title}" instead.`));
                            }
                            toCol = toCol || destProject.columns[0];

                            found.column.tasks = found.column.tasks.filter(t => t !== found.task);
                            toCol.tasks.push(found.task);
                            if (destProject.columns.length > 1 && DONE_COL_RX.test(String(toCol.title || ''))) {
                                found.task.done = true;
                                found.task.completedAt = found.task.completedAt || new Date().toISOString();
                            } else if (found.project.columns.length > 1 && DONE_COL_RX.test(String(found.column.title || ''))) {
                                found.task.done = false;
                                found.task.completedAt = '';
                            }
                            taskPlugin.saveState();
                            taskPlugin.renderProjects();
                            taskPlugin.renderBoard();
                            break;
                        }

                        case 'UPDATE_TASK': {
                            const scopedProject = args.project ? findProject(args.project) : null;
                            if (args.project && !scopedProject) {
                                notices.push(this.taskT('task_notice_project_not_found', { project: args.project }, `Project "${args.project}" was not found.`));
                                break;
                            }
                            const found = findTask(args.id || args.title, scopedProject);
                            if (!found) {
                                notices.push(this.taskT('task_notice_task_not_found', { title: args.title || args.id || '' }, `Task "${args.title || args.id || ''}" was not found.`));
                                break;
                            }
                            if (args.new_title) found.task.title = args.new_title;
                            if ('desc' in args) found.task.desc = args.desc;
                            if ('deadline' in args) found.task.deadline = this._normalizeTaskDeadline(args.deadline);
                            if ('priority' in args) {
                                const prio = this._parseTaskPriority(args.priority);
                                if (prio) found.task.priority = prio;
                            }
                            if ('tags' in args) {
                                found.task.tags = this.fitList(args.tags, 10).map(s => s.replace(/^#+/, ''));
                            }
                            if ('subtasks' in args) {
                                found.task.subtasks = this._parseTaskSubtasks(args.subtasks, uid);
                            }
                            if ('done' in args) {
                                const wantDone = /^(1|true|yes|y|да)$/i.test(String(args.done || '').trim());
                                found.task.done = wantDone;
                                found.task.completedAt = wantDone ? (found.task.completedAt || new Date().toISOString()) : '';
                            }
                            taskPlugin.saveState();
                            taskPlugin.renderProjects();
                            taskPlugin.renderBoard();
                            break;
                        }

                        case 'COMPLETE_TASK': {
                            const scopedProject = args.project ? findProject(args.project) : null;
                            if (args.project && !scopedProject) {
                                notices.push(this.taskT('task_notice_project_not_found', { project: args.project }, `Project "${args.project}" was not found.`));
                                break;
                            }
                            const found = findTask(args.id || args.title, scopedProject);
                            if (!found) {
                                notices.push(this.taskT('task_notice_task_not_found', { title: args.title || args.id || '' }, `Task "${args.title || args.id || ''}" was not found.`));
                                break;
                            }
                            const wantDone = args.done === undefined
                                ? true
                                : /^(1|true|yes|y|да)$/i.test(String(args.done || '').trim());
                            found.task.done = wantDone;
                            found.task.completedAt = wantDone ? (found.task.completedAt || new Date().toISOString()) : '';
                            if (found.project.columns.length > 1) {
                                const doneCol = found.project.columns.find(c => DONE_COL_RX.test(String(c.title || '')));
                                const activeCol = found.project.columns.find(c => !DONE_COL_RX.test(String(c.title || ''))) || found.project.columns[0];
                                if (wantDone && doneCol && found.column !== doneCol) {
                                    found.column.tasks = found.column.tasks.filter(t => t !== found.task);
                                    doneCol.tasks.unshift(found.task);
                                } else if (!wantDone && DONE_COL_RX.test(String(found.column.title || '')) && activeCol && activeCol !== found.column) {
                                    found.column.tasks = found.column.tasks.filter(t => t !== found.task);
                                    activeCol.tasks.push(found.task);
                                }
                            }
                            taskPlugin.saveState();
                            taskPlugin.renderProjects();
                            taskPlugin.renderBoard();
                            notices.push(this.taskT('task_notice_completed', {
                                title: found.task.title,
                                status: wantDone ? this.taskT('task_col_done', null, 'Done') : this.taskT('task_col_todo', null, 'To Do')
                            }, `Task "${found.task.title}" updated.`));
                            break;
                        }

                        case 'ADD_SUBTASK': {
                            const scopedProject = args.project ? findProject(args.project) : null;
                            if (args.project && !scopedProject) {
                                notices.push(this.taskT('task_notice_project_not_found', { project: args.project }, `Project "${args.project}" was not found.`));
                                break;
                            }
                            const found = findTask(args.id || args.title, scopedProject);
                            if (!found) {
                                notices.push(this.taskT('task_notice_task_not_found', { title: args.title || args.id || '' }, `Task "${args.title || args.id || ''}" was not found.`));
                                break;
                            }
                            const items = this._parseTaskSubtasks(args.subtask || args.subtasks, uid);
                            if (!items.length) break;
                            found.task.subtasks = Array.isArray(found.task.subtasks) ? found.task.subtasks : [];
                            for (const item of items) found.task.subtasks.push(item);
                            taskPlugin.saveState();
                            taskPlugin.renderBoard();
                            notices.push(this.taskT('task_notice_subtask_added', { title: found.task.title }, `Added subtask(s) to "${found.task.title}".`));
                            break;
                        }

                        case 'DELETE_TASK': {
                            const scopedProject = args.project ? findProject(args.project) : null;
                            if (args.project && !scopedProject) {
                                notices.push(this.taskT('task_notice_project_not_found', { project: args.project }, `Project "${args.project}" was not found.`));
                                break;
                            }
                            const found = findTask(args.id || args.title, scopedProject);
                            if (!found) {
                                notices.push(this.taskT('task_notice_task_not_found', { title: args.title || args.id || '' }, `Task "${args.title || args.id || ''}" was not found.`));
                                break;
                            }
                            found.column.tasks = found.column.tasks.filter(t => t !== found.task);
                            taskPlugin.saveState();
                            taskPlugin.renderProjects();
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
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (!m) return fallback;
        const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
        const date = new Date(y, mo - 1, d, 12, 0, 0);
        if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return fallback;
        return text;
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
        return this.fitPlanExercises(value, 50);
    },

    fitParseRepsNumeric(reps) {
        if (reps === null || reps === undefined || reps === '') return 0;
        if (typeof reps === 'number') return Number.isFinite(reps) && reps > 0 ? reps : 0;
        const s = String(reps).trim();
        if (!s || /[sс]|сек|min|мин/i.test(s)) return 0;
        const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(s);
        if (range) return (Number(range[1]) + Number(range[2])) / 2;
        const single = /^(\d+)/.exec(s);
        return single ? Number(single[1]) : 0;
    },

    fitCalcVolume(exercisesJson) {
        let list = [];
        try {
            list = typeof exercisesJson === 'string' ? JSON.parse(exercisesJson || '[]') : exercisesJson;
        } catch (e) {
            list = [];
        }
        if (!Array.isArray(list)) return null;
        let total = 0;
        for (const ex of list) {
            if (!ex || typeof ex !== 'object') continue;
            const sets = Number(ex.sets);
            const repsNum = this.fitParseRepsNumeric(ex.reps);
            const weight = Number(ex.weight);
            if (sets > 0 && repsNum > 0 && weight > 0) {
                total += Math.round(sets * repsNum * weight);
            }
        }
        return total > 0 ? total : null;
    },

    // Plan-day & workout exercises: either a JSON array or compact strings like
    // "Жим лёжа 4x8 @50; Присед 3x10 80" → [{name, sets, reps, weight}].
    fitPlanExercises(value, maxItems = 30) {
        const text = String(value || '').trim();
        if (!text) return '[]';
        if (text.startsWith('[')) {
            try {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) return JSON.stringify(parsed.slice(0, maxItems));
            } catch (e) {
                // Fall through to the compact string format.
            }
        }
        const items = text.split(/[;\n|]+/).map((item) => item.trim()).filter(Boolean).slice(0, maxItems);
        const parsed = items.map((item) => {
            const normalized = item.replace(/\s*[·•]\s*/g, ' ').replace(/\s+/g, ' ').trim();
            let rest = normalized;
            const exercise = { name: item, sets: null, reps: null, weight: null };
            const full = /(\d{1,2})\s*[x×х]\s*(\d{1,3}(?:\s*[-–]\s*\d{1,3}|\s*(?:s|с|сек))?)(?:\s+@?\s*([\d.,]+)\s*(?:кг|kg)?)?\s*$/i.exec(rest);
            if (full) {
                exercise.sets = Number(full[1]);
                const rawReps = full[2].replace(/\s+/g, '');
                exercise.reps = /^\d+$/.test(rawReps) ? Number(rawReps) : rawReps.replace(/(?:с|сек)$/i, 's');
                if (full[3] !== undefined) exercise.weight = this.fitNumber(full[3]);
                rest = rest.slice(0, full.index);
            } else {
                const weightOnly = /\s*@\s*([\d.,]+)\s*(?:кг|kg)?\s*$/i.exec(rest);
                if (weightOnly) {
                    exercise.weight = this.fitNumber(weightOnly[1]);
                    rest = rest.slice(0, weightOnly.index);
                }
            }
            exercise.name = rest.replace(/[\s·•,\-–—]+$/, '').trim() || item;
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
    // `options.returnDetails` returns structured { text, wrote, actions, notices }
    // for the rich day-chat cards without trailing raw italic strings.
    processResponseForFitCare(llmResponse, isPrivate = false, fallbackDate = '', options = {}) {
        const wantDetails = !!(options && options.returnDetails);
        if (!llmResponse) return wantDetails ? { text: '', wrote: false, actions: [], notices: [] } : llmResponse;
        this.PATTERNS.FIT.lastIndex = 0;
        const matches = [...String(llmResponse).matchAll(this.PATTERNS.FIT)];
        if (!matches.length) {
            return wantDetails ? { text: String(llmResponse), wrote: false, actions: [], notices: [] } : llmResponse;
        }
        let clean = String(llmResponse);
        if ((state.userSettings?.user_mode || 'adult') === 'child') {
            for (const match of matches) clean = clean.replace(match[0], '');
            return wantDetails ? { text: clean.trim(), wrote: false, actions: [], notices: [] } : clean.trim();
        }
        const notices = [];
        const actions = [];
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
                    const curDaily = (args.water_add !== undefined || args.steps_add !== undefined) && typeof db.getFitDailyLog === 'function'
                        ? db.getFitDailyLog(date)
                        : null;
                    if (args.water_add !== undefined && patch.water_ml === undefined) {
                        const delta = this.fitNumber(args.water_add);
                        if (delta !== null && delta !== 0) {
                            patch.water_ml = Math.max(0, Math.round((Number(curDaily && curDaily.water_ml) || 0) + delta));
                        }
                    }
                    if (args.steps_add !== undefined && patch.steps === undefined) {
                        const delta = this.fitNumber(args.steps_add);
                        if (delta !== null && delta !== 0) {
                            patch.steps = Math.max(0, Math.round((Number(curDaily && curDaily.steps) || 0) + delta));
                        }
                    }
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
                        actions.push({ kind: 'log', date, patch });
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
                    const hasAnyMacro = meal.protein !== null || meal.carbs !== null || meal.fat !== null;
                    if (hasAnyMacro) {
                        const fromMacros = Math.round((meal.protein || 0) * 4 + (meal.carbs || 0) * 4 + (meal.fat || 0) * 9);
                        if (meal.calories === null) {
                            meal.calories = fromMacros;
                        } else if (meal.estimated === 1 && fromMacros > 0) {
                            const dev = Math.abs(meal.calories - fromMacros) / Math.max(meal.calories, fromMacros, 1);
                            if (dev > 0.22) meal.calories = fromMacros;
                        }
                    }
                    const mealId = db.saveFitMeal(meal);
                    notices.push(this.fitT('fit_notice_meal', { date }, `Meal saved to Fit & Care for ${date}.`) + (meal.estimated ? ' ' + this.fitT('fit_notice_meal_estimated', null, 'Macros are Aru\'s estimate.') : ''));
                    const conflicts = this.fitConflictNotices(meal);
                    notices.push(...conflicts);
                    actions.push({
                        kind: 'meal',
                        id: mealId,
                        date,
                        time,
                        title,
                        calories: meal.calories,
                        protein: meal.protein,
                        carbs: meal.carbs,
                        fat: meal.fat,
                        estimated: meal.estimated,
                        conflicts
                    });
                    wrote = true;
                } else if (name === 'WORKOUT') {
                    const title = String(args.title || args.name || args.workout || '').slice(0, 200);
                    if (!title) continue;
                    const status = String(args.status || args.workout || 'done').toLowerCase();
                    const finalStatus = ['done', 'planned', 'skipped'].includes(status) ? status : 'done';
                    let exercisesJson = this.fitExercises(args.exercises);
                    const explicitVolume = this.fitNumber(args.volume || args.volume_kg);
                    let volumeKg = explicitVolume !== null ? explicitVolume : this.fitCalcVolume(exercisesJson);
                    let durationMin = this.fitNumber(args.duration || args.duration_min);
                    let rpe = this.fitScale(args.rpe, 1, 10);
                    let note = String(args.note || args.workout_note || '').slice(0, 1000);

                    const sameDayWorkouts = typeof db.getFitWorkouts === 'function' ? (db.getFitWorkouts(date, date) || []) : [];
                    let matchedPlanned = null;
                    if (finalStatus === 'done' || finalStatus === 'skipped') {
                        const plannedSameDay = sameDayWorkouts.filter(w => w && w.status === 'planned');
                        const normTitle = title.trim().toLowerCase();
                        matchedPlanned = plannedSameDay.find(w => String(w.title || '').trim().toLowerCase() === normTitle) || null;
                        if (!matchedPlanned && plannedSameDay.length === 1) {
                            const onlyPlanned = plannedSameDay[0];
                            const words = String(onlyPlanned.title || '').toLowerCase().split(/\s+/).filter(w => w.length >= 3);
                            if (args.update === '1' || words.some(word => normTitle.includes(word))) {
                                matchedPlanned = onlyPlanned;
                            }
                        }
                    }

                    let planDayId = matchedPlanned ? (matchedPlanned.plan_day_id ?? null) : null;
                    if (!planDayId && typeof db.getFitPlans === 'function' && typeof db.getFitPlanDayForDate === 'function') {
                        try {
                            const activePlans = db.getFitPlans('active') || [];
                            const plan = activePlans[0];
                            if (plan && plan.start_date && date >= plan.start_date) {
                                const startDt = new Date(`${plan.start_date}T12:00:00`);
                                const weekStartDt = new Date(startDt);
                                weekStartDt.setDate(startDt.getDate() - ((startDt.getDay() + 6) % 7));
                                const targetDt = new Date(`${date}T12:00:00`);
                                const diffW = Math.round((targetDt.getTime() - weekStartDt.getTime()) / 86400000);
                                const totalWeeks = Math.max(1, Number(plan.weeks) || 1);
                                if (diffW >= 0 && diffW < totalWeeks * 7) {
                                    const weekIdx = Math.floor(diffW / 7) + 1;
                                    const weekday = ((targetDt.getDay() + 6) % 7) + 1;
                                    const pDay = db.getFitPlanDayForDate(plan.id, weekIdx, weekday);
                                    let pEx = [];
                                    try { pEx = JSON.parse((pDay && pDay.exercises) || '[]') || []; } catch (_) { pEx = []; }
                                    const isNonRest = pDay && (pDay.title || pDay.focus || pEx.length > 0);
                                    if (isNonRest && !sameDayWorkouts.some(w => Number(w.plan_day_id) === Number(pDay.id))) {
                                        planDayId = pDay.id;
                                    }
                                }
                            }
                        } catch (_) {
                            planDayId = null;
                        }
                    }

                    if (matchedPlanned) {
                        if (args.exercises === undefined && matchedPlanned.exercises) {
                            exercisesJson = matchedPlanned.exercises;
                            if (explicitVolume === null) {
                                volumeKg = this.fitCalcVolume(exercisesJson) ?? matchedPlanned.volume_kg ?? null;
                            }
                        }
                        if (durationMin === null && matchedPlanned.duration_min != null) durationMin = matchedPlanned.duration_min;
                        if (rpe === null && matchedPlanned.rpe != null) rpe = matchedPlanned.rpe;
                        if (!note && matchedPlanned.note) note = matchedPlanned.note;
                    }

                    const workoutId = db.saveFitWorkout({
                        id: matchedPlanned ? matchedPlanned.id : undefined,
                        log_date: date,
                        log_time: time || (matchedPlanned ? matchedPlanned.log_time : ''),
                        plan_day_id: planDayId,
                        title,
                        exercises: exercisesJson,
                        duration_min: durationMin,
                        volume_kg: volumeKg,
                        rpe,
                        status: finalStatus,
                        note
                    });
                    notices.push(this.fitT('fit_notice_workout', { date }, `Workout saved to Fit & Care for ${date}.`));
                    actions.push({
                        kind: 'workout',
                        id: workoutId,
                        date,
                        time,
                        title,
                        status: finalStatus,
                        duration_min: durationMin,
                        volume_kg: volumeKg,
                        rpe,
                        plan_day_id: planDayId
                    });
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
                    const medId = db.saveFitHealthLog({
                        log_date: date,
                        log_time: time,
                        protocol_id: protocol ? protocol.id : null,
                        type: 'medication',
                        name: protocol ? protocol.name : medName,
                        status,
                        note: String(args.note || '').slice(0, 1000)
                    });
                    notices.push(this.fitT('fit_notice_med', { date }, `Medication entry saved to Fit & Care for ${date}.`));
                    actions.push({
                        kind: 'med',
                        id: medId,
                        date,
                        time,
                        name: protocol ? protocol.name : medName,
                        status
                    });
                    wrote = true;
                } else if (name === 'HEALTH') {
                    const type = String(args.type || 'measurement').toLowerCase();
                    const allowed = ['glucose', 'pressure', 'temperature', 'symptom', 'measurement', 'other'];
                    const value = this.fitNumber(args.value);
                    const value2 = this.fitNumber(args.value2);
                    const unit = String(args.unit || '').slice(0, 20);
                    const finalType = allowed.includes(type) ? type : 'measurement';
                    const eventName = String(args.name || args.title || (value === null ? (args.value || '') : '') || type).slice(0, 200);
                    const healthId = db.saveFitHealthLog({
                        log_date: date,
                        log_time: time,
                        type: finalType,
                        name: eventName,
                        value,
                        value2,
                        unit,
                        status: 'logged',
                        tags: JSON.stringify(this.fitList(args.tags, 20)),
                        note: String(args.note || '').slice(0, 1000)
                    });
                    notices.push(this.fitT('fit_notice_health', { date }, `Health event saved to Fit & Care for ${date}.`));
                    actions.push({ kind: 'health', id: healthId, date, time, type: finalType, name: eventName, value, value2, unit });
                    wrote = true;
                } else if (name === 'CYCLE_START') {
                    if (!cycleTrackingOn) {
                        if (!cycleOffNotified) {
                            notices.push(this.fitT('fit_notice_cycle_off', null, 'Cycle tracking is turned off in Fit & Care settings, so nothing was saved.'));
                            cycleOffNotified = true;
                        }
                        continue;
                    }
                    const start = db.startFitCycle(date);
                    if (start && start.created) {
                        notices.push(this.fitT('fit_notice_cycle_start', { date: start.start_date }, `Cycle start saved for ${start.start_date}.`));
                        actions.push({ kind: 'cycle', event: 'CYCLE_START', date: start.start_date });
                        wrote = true;
                    } else if (start && start.reason === 'recent') {
                        notices.push(this.fitT('fit_notice_cycle_start_recent', { date: start.start_date, new_date: date }, `A period start is already logged on ${start.start_date}, so ${date} was not added: the dates are less than 10 days apart. If ${date} is the corrected first day, move the start in Fit & Care.`));
                    } else if (start) {
                        notices.push(this.fitT('fit_notice_cycle_start_exists', { date: start.start_date }, `A cycle already starts on ${start.start_date}, so the new start was not added.`));
                    } else {
                        notices.push(this.fitT('fit_notice_cycle_future', { date }, `The period start ${date} is not saved: it cannot be in the future.`));
                    }
                } else if (name === 'CYCLE_END') {
                    if (!cycleTrackingOn) {
                        if (!cycleOffNotified) {
                            notices.push(this.fitT('fit_notice_cycle_off', null, 'Cycle tracking is turned off in Fit & Care settings, so nothing was saved.'));
                            cycleOffNotified = true;
                        }
                        continue;
                    }
                    const cycles = db.getFitCycles ? (db.getFitCycles() || []) : [];
                    const current = cycles.filter((cycle) => cycle.start_date && cycle.start_date <= date).pop() || null;
                    const span = current
                        ? Math.round((new Date(`${date}T12:00:00`) - new Date(`${current.start_date}T12:00:00`)) / 86400000) + 1
                        : 0;
                    if (current && span > 15) {
                        notices.push(this.fitT('fit_notice_cycle_end_suspect', { date, start: current.start_date, days: span }, `The period end ${date} was not saved: the last logged start is ${current.start_date}, so that would be ${span} days of bleeding. If it is correct, mark the end in Fit & Care; otherwise add the missing period start first.`));
                    } else if (db.endFitCycle(date)) {
                        notices.push(this.fitT('fit_notice_cycle_end', { date }, `Cycle end saved for ${date}.`));
                        actions.push({ kind: 'cycle', event: 'CYCLE_END', date });
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
                    const validFlow = ['light', 'medium', 'heavy', 'none'].includes(flow) ? flow : '';
                    db.saveFitCycleLog({
                        log_date: date,
                        flow: validFlow,
                        note: String(args.note || '').slice(0, 1000)
                    });
                    notices.push(this.fitT('fit_notice_cycle_log', { date }, `Cycle flow saved for ${date}.`));
                    actions.push({ kind: 'cycle', event: 'CYCLE_LOG', date, flow: validFlow });
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
                    actions.push({ kind: 'plan', event: 'PLAN_CREATE', id: lastPlanId, title, weeks });
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
                    if (!plan) plan = plans.find((entry) => entry.status === 'active') || null;
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
                    actions.push({ kind: 'plan', event: 'PLAN_DAY', title: plan.title, dayTitle: args.title || args.focus || '', week, weekday });
                    wrote = true;
                } else if (name === 'PROFILE') {
                    if (typeof db.saveFitProfile !== 'function') continue;
                    const profPatch = {};
                    const h = this.fitNumber(args.height_cm);
                    if (h !== null && h >= 80 && h <= 250) profPatch.height_cm = h;
                    const by = this.fitScale(args.birth_year, 1900, new Date().getFullYear());
                    if (by !== null) profPatch.birth_year = by;
                    if (args.sex !== undefined) {
                        const sx = String(args.sex || '').trim().toLowerCase();
                        if (['female', 'male', 'other'].includes(sx)) profPatch.sex = sx;
                    }
                    if (args.activity_level !== undefined) {
                        const act = String(args.activity_level || '').trim().toLowerCase();
                        if (['sedentary', 'light', 'moderate', 'high', 'very_high'].includes(act)) profPatch.activity_level = act;
                    }
                    if (args.goal !== undefined) {
                        const g = String(args.goal || '').trim().toLowerCase();
                        if (['lose', 'maintain', 'gain', 'health', 'performance'].includes(g)) profPatch.goal = g;
                    }
                    const tw = this.fitNumber(args.target_weight);
                    if (tw !== null && tw >= 20 && tw <= 400) profPatch.target_weight = tw;
                    if (args.target_date !== undefined) {
                        const td = this.fitDate(args.target_date, '');
                        if (td) profPatch.target_date = td;
                    }
                    const wm = this.fitScale(args.water_target_ml, 500, 8000);
                    if (wm !== null) profPatch.water_target_ml = wm;

                    const isTeenProfile = (state.userSettings?.user_mode || 'adult') === 'teen';
                    if (isTeenProfile) {
                        if (profPatch.goal === 'lose') profPatch.goal = 'maintain';
                        if (profPatch.target_weight !== undefined && typeof db.getFitLatestWeight === 'function') {
                            const lw = db.getFitLatestWeight()?.weight;
                            if (lw != null && profPatch.target_weight < lw) delete profPatch.target_weight;
                        }
                    }

                    if (Object.keys(profPatch).length) {
                        db.saveFitProfile(profPatch);
                        notices.push(this.fitT('fit_notice_profile', null, 'Fit & Care profile updated.'));
                        actions.push({ kind: 'profile', patch: profPatch });
                        wrote = true;
                    }
                }
            } catch (e) {
                console.error(`Triggers: Fit command ${name} failed`, e);
            }
        }
        if (wrote && window.FitCarePlugin && typeof window.FitCarePlugin.refresh === 'function' && !(window.FitCarePlugin.state && window.FitCarePlugin.state.chatBusy)) {
            try { window.FitCarePlugin.refresh(); } catch (e) { /* plugin not mounted */ }
        }
        if (wantDetails) {
            return { text: clean.trim(), wrote, actions, notices };
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

    async processResponseForTools(llmResponse, options = {}) {
        let cleanResponse = llmResponse;

        // Find all tool tags: [[TOOL:name args]]
        const toolRegex = /\[\[\s*TOOL\s*:\s*(\w+)\s*([\s\S]*?)\s*\]\]/gi;
        const matches = [...cleanResponse.matchAll(toolRegex)];

        // Track seen tools to avoid duplication of widgets
        const seenTags = new Set();
        const replacements = [];

        for (const match of matches) {
            const fullMatch = match[0];
            const toolName = String(match[1] || '').toLowerCase();
            const argsStr = match[2] || '';
            const offset = match.index;

            // Check if inside <pre>, <code>, or an HTML tag attribute (prevents attribute breakout XSS)
            const before = cleanResponse.substring(0, offset);
            const insideCode = (before.lastIndexOf('<code') > before.lastIndexOf('</code>')) ||
                (before.lastIndexOf('<pre') > before.lastIndexOf('</pre>'));
            const insideTag = before.lastIndexOf('<') > before.lastIndexOf('>');

            if (insideCode || insideTag) continue;

            if (seenTags.has(fullMatch)) {
                replacements.push({ original: fullMatch, replacement: '', index: offset });
                continue;
            }

            seenTags.add(fullMatch);

            // Fetch widget HTML
            let replacementHTML = '';
            try {
                const decodedArgs = argsStr.replace(/&quot;/g, '"').replace(/&#0*39;/g, "'");
                const extractArg = (name) => {
                    const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(decodedArgs);
                    return m ? (m[1] ?? m[2] ?? '') : '';
                };
                if (toolName === 'weather') {
                    const city = extractArg('city') || 'Almaty';
                    replacementHTML = await Tools.getWeatherCard(city);
                } else if (toolName === 'news') {
                    const filter = extractArg('tag') || extractArg('lang') || '';
                    const urls = window.app.getRSSUrls();
                    replacementHTML = await Tools.getNewsCard(urls, filter);
                } else if (toolName === 'tasks') {
                    replacementHTML = await Tools.getTasksCard(extractArg('project'));
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
        // Cues are matched against prose only: a game's `showScreen()` or a
        // `tasks` array inside a code block must not spawn a kanban board.
        if (replacements.length === 0 && !(options && options.skipFallback)) {
            try {
                const hasArtifact = cleanResponse.includes('openArtifact(');
                const visibleText = cleanResponse
                    .replace(/```[\s\S]*?```/g, ' ')
                    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
                    .replace(/<code[\s\S]*?<\/code>/gi, ' ')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .toLowerCase();
                const lower = visibleText;
                const isChildRefusal = Safety.isChildMode() && /(?:не могу|нельзя|cannot|can't|sorry|кешір|болмайды|не подходит)/i.test(lower);
                const urls = window.app?.getRSSUrls ? window.app.getRSSUrls() : [];

                if (hasArtifact || isChildRefusal) {
                    // Artifact replies already have their own card; child refusals must not inject widgets.
                } else {
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
                    // Weather cues (require display/forecast intent, not mere prose mention of "weather")
                    const weatherIntent = /(покажи|какая|прогноз|show|what(?:'s| is)|forecast|көрсет|қандай).*(погод|weather|ауа рай)/;
                    if (weatherIntent.test(lower)) {
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
                }
            } catch (e) {
                console.warn('Tool fallback injection failed', e);
            }
        }

        return cleanResponse;
    }
};
