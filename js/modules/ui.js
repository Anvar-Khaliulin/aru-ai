/*
---ARU-LAB.SPACE---ALMATY---2026---
User interface controller managing DOM manipulations, animations, and toast notifications.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState } from './aruState.js';

export const UI = {
    container: document.getElementById('messages-container'),
    modalContainer: document.getElementById('modal-container'),

    closeModal() {
        if (this.modalContainer) this.modalContainer.innerHTML = '';
        else document.getElementById('modal-container').innerHTML = '';
    },

    showToast(message, icon = 'info') {
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs py-1.5 px-3 rounded-full opacity-0 transition-opacity duration-500 z-50 flex items-center gap-2 max-w-[90vw] shadow-lg';
        toast.innerHTML = `<i data-lucide="${icon}" class="w-3 h-3 text-aru-400 shrink-0"></i> <span class="truncate">${UI.escapeHTML(message)}</span>`;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.remove('opacity-0'));
        setTimeout(() => {
            toast.classList.add('opacity-0');
            setTimeout(() => toast.remove(), 500);
        }, 3500);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    scrollToBottom() {
        if (this.container) this.container.scrollTop = this.container.scrollHeight;
    },

    escapeHTML(text) {
        if (!text) return '';
        return text.toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    initMarked() {
        if (typeof marked === 'undefined') return;
        const renderer = new marked.Renderer();
        renderer.code = (codeOrObj, language) => {
            let code = codeOrObj;
            let lang = language;
            if (typeof codeOrObj === 'object' && codeOrObj !== null) {
                code = codeOrObj.text;
                lang = codeOrObj.lang || language;
            }
            if (typeof code !== 'string') code = String(code || '');

            const codeId = 'c-' + Math.random().toString(36).substring(2, 9);
            if (!window.aruContentCache) window.aruContentCache = {};
            window.aruContentCache[codeId] = code;

            const validLang = !!(lang && hljs.getLanguage(lang));
            const highlighted = validLang ? hljs.highlight(code, { language: lang }).value : hljs.highlightAuto(code).value;
            const langLabel = lang || 'code';

            return `
            <div class="my-4 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
                <div class="bg-gray-100 dark:bg-gray-800 px-4 py-2 flex justify-between items-center border-b border-gray-200 dark:border-gray-700">
                    <span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">${langLabel}</span>
                    <button class="text-xs text-gray-500 hover:text-aru-500 transition-colors flex items-center gap-1" onclick="navigator.clipboard.writeText(window.aruContentCache['${codeId}'])">
                        <i data-lucide="copy" class="w-3 h-3"></i>
                    </button>
                </div>
                <pre class="m-0 p-4 bg-gray-50 dark:bg-gray-900/50 overflow-x-auto"><code class="hljs language-${lang}">${highlighted}</code></pre>
            </div>`;
        };
        marked.setOptions({ renderer });
    },

    showTyping() {
        const id = 'typing-indicator';
        if (document.getElementById(id)) return;
        const html = `
        <div id="${id}" class="flex gap-3 mb-4 animate-fade-in-up">
            <div class="w-8 h-8 rounded-full bg-aru-100 dark:bg-aru-900 flex items-center justify-center overflow-hidden border border-aru-200 dark:border-aru-800">
                 <img src="media/emotions/thinking.png" class="w-full h-full object-cover animate-pulse">
            </div>
            <div class="bg-white dark:bg-gray-800 p-3 rounded-2xl rounded-tl-none border border-gray-200 dark:border-gray-700 shadow-sm flex items-center gap-1">
                <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></span>
                <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.4s"></span>
            </div>
        </div>`;
        if (this.container) this.container.insertAdjacentHTML('beforeend', html);
        this.scrollToBottom();
    },

    hideTyping() {
        const el = document.getElementById('typing-indicator');
        if (el) el.remove();
    },

    // The send button doubles as a stop button while a reply is generating.
    setComposerSending(isSending) {
        const btn = document.getElementById('send-btn');
        if (!btn) return;
        const t = (aruGlobalState && aruGlobalState.translations) || {};
        const label = isSending
            ? (t.btn_stop || 'Stop')
            : (t.btn_send || 'Send');
        btn.innerHTML = `<i data-lucide="${isSending ? 'square' : 'send'}" class="w-5 h-5"></i>`;
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.dataset.sending = isSending ? 'true' : 'false';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    appendMessage(msg) {
        if (!this.container) this.container = document.getElementById('messages-container');

        const isUser = msg.role === 'user';
        let parsedContent = '';

        if (msg.isHTML) {
            parsedContent = msg.content;
            // Legacy rows may hold fully escaped HTML; decode only those, otherwise
            // legitimate entities (code samples, TeX like `a &lt; b`) would flatten the markup
            try {
                const looksEscaped = typeof parsedContent === 'string' &&
                    parsedContent.indexOf('&lt;') !== -1 &&
                    !/<[a-zA-Z!/]/.test(parsedContent);
                if (looksEscaped) {
                    const doc = new DOMParser().parseFromString(parsedContent, 'text/html');
                    const decoded = doc.documentElement.textContent || parsedContent;
                    if (decoded && decoded.indexOf('<') !== -1) parsedContent = decoded;
                }
            } catch (e) {
                // Fallback to original content in case of decoding errors
            }
        } else {
            parsedContent = this.parseMarkdownWithMath(msg.content);
        }

        const msgId = 'm-' + Math.random().toString(36).substring(2, 9);
        if (!window.aruContentCache) window.aruContentCache = {};
        window.aruContentCache[msgId] = msg.content;

        const dbIdAttr = (msg.id !== undefined && msg.id !== null) ? ` data-msg-id="${msg.id}"` : '';

        let html = '';

        // Implements safe access to the global application state object
        const appState = aruGlobalState || window.aruState || {};
        const settings = appState.userSettings || {};

        if (isUser) {
            // Message file names (sent attachments) — stored as an array or a JSON string from DB
            let fileNames = Array.isArray(msg.fileNames) ? msg.fileNames : null;
            if (!fileNames && typeof msg.attachments === 'string' && msg.attachments) {
                try {
                    const parsed = JSON.parse(msg.attachments);
                    if (Array.isArray(parsed)) fileNames = parsed;
                } catch (e) { /* legacy rows without attachments */ }
            }

            let filesBadgeHTML = '';
            if (fileNames && fileNames.length > 0) {
                if (!window.aruFilesCache) window.aruFilesCache = {};
                window.aruFilesCache[msgId] = fileNames;
                const badgeTitle = (appState.translations && appState.translations.msg_files_badge) || 'Файлы сообщения';
                filesBadgeHTML = `
                <div class="msg-files-badge-wrap" onmouseenter="window.aruMsgFiles.show('${msgId}', this)" onmouseleave="window.aruMsgFiles.hide(this)">
                    <button type="button" class="msg-files-badge" onclick="window.aruMsgFiles.toggle('${msgId}', this)" title="${UI.escapeHTML(badgeTitle)}" aria-label="${UI.escapeHTML(badgeTitle)}">
                        <i data-lucide="paperclip" class="w-3.5 h-3.5"></i>
                        <span>${fileNames.length}</span>
                    </button>
                    <div class="msg-files-popover chapters-panel hidden" role="tooltip"></div>
                </div>`;
            }

            html = `
            <div class="flex gap-3 mb-6 flex-row-reverse animate-fade-in-up group${filesBadgeHTML ? ' relative z-10' : ''}"${dbIdAttr}>
                <div class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 overflow-hidden">
                    <i data-lucide="user" class="w-5 h-5"></i>
                </div>
                <div class="max-w-[80%] flex flex-col items-end gap-1.5">
                    <div class="bg-aru-500 text-white p-3 px-4 rounded-2xl rounded-tr-none shadow-md text-sm selection:bg-white/30">
                        <div class="prose prose-invert prose-sm max-w-none break-words">
                            ${parsedContent}
                        </div>
                    </div>
                    ${filesBadgeHTML}
                </div>
            </div>`;
        } else {
            const showStickers = settings.show_stickers !== 'false';
            const moodClass = msg.emotion ? `aru-${msg.emotion}` : '';

            // Renders clickable quick-reply buttons proposed by the model; clicking one
            // sends its label as the user's next message
            let suggestionsHTML = '';
            if (Array.isArray(msg.suggestions) && msg.suggestions.length > 0) {
                if (!window.aruSuggestionsCache) window.aruSuggestionsCache = {};
                window.aruSuggestionsCache[msgId] = msg.suggestions;
                suggestionsHTML = `
                <div class="flex flex-wrap gap-2 mt-2 ml-12 mr-4">
                    ${msg.suggestions.map((s, i) => `
                        <button type="button" onclick="window.aruSendSuggestion('${msgId}', ${i})"
                            class="text-xs bg-aru-50 dark:bg-aru-900/50 border border-aru-200 dark:border-aru-800 text-aru-700 dark:text-aru-300 rounded-full px-3 py-1.5 hover:bg-aru-100 dark:hover:bg-aru-900 hover:border-aru-300 dark:hover:border-aru-700 transition-colors animate-fade-in-up text-left max-w-full">
                            ${UI.escapeHTML(s)}
                        </button>`).join('')}
                </div>`;
            }

            // Generates and appends HTML for character stickers if enabled in user settings
            let stickerHTML = '';
            if (showStickers && msg.emotion) {
                stickerHTML = `
                <div class="mt-2 ml-10 animate-fade-in-up">
                    <img src="media/emotions/${msg.emotion}.png" class="w-24 h-24 object-contain transition-transform hover:scale-110 ${moodClass}" onerror="this.style.display='none'">
                </div>`;
            }

            html = `
            <div class="flex flex-col mb-8 animate-fade-in-up group"${dbIdAttr}>
                <div class="flex gap-4">
                    <div class="flex flex-col items-center">
                        <div class="w-10 h-10 rounded-full bg-aru-50 dark:bg-aru-900/50 flex items-center justify-center border border-aru-100 dark:border-aru-800 shadow-sm relative text-xl">
                            🦊
                        </div>
                    </div>
                    <div class="flex-1 max-w-[85%]">
                        <div class="bg-white dark:bg-gray-800 p-4 rounded-2xl rounded-tl-none border border-gray-100 dark:border-gray-700 shadow-sm text-gray-800 dark:text-gray-100 text-sm">
                            <div class="prose prose-sm dark:prose-invert max-w-none break-words">
                                ${parsedContent}
                            </div>
                        </div>
                         <div class="flex gap-2 mt-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                             <button class="text-xs text-gray-400 hover:text-aru-500 flex items-center gap-1" onclick="navigator.clipboard.writeText(window.aruContentCache['${msgId}'])">
                                <i data-lucide="copy" class="w-3 h-3"></i> ${settings.translations?.action_copy || appState.translations?.action_copy || 'Copy'}
                             </button>
                         </div>
                    </div>
                </div>
                ${suggestionsHTML}
                ${stickerHTML}
            </div>`;
        }

        if (this.container) {
            this.container.insertAdjacentHTML('beforeend', html);
            this.renderMath(this.container.lastElementChild);
            if (typeof hljs !== 'undefined') {
                document.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el));
            }
            if (typeof lucide !== 'undefined') lucide.createIcons();
            this.scrollToBottom();
        }
    },

    /**
     * Markdown → HTML with TeX math shielded from the parser.
     * marked would otherwise eat `\(`, `\[` and treat `_`/`*` inside formulas as
     * emphasis, so math segments are swapped for placeholders and restored as
     * plain text for renderMath() to pick up.
     */
    parseMarkdownWithMath(text) {
        if (typeof text !== 'string') return text;
        if (typeof marked === 'undefined') return text;

        const MATH_RULES = [
            /\$\$[\s\S]+?\$\$/g,
            /\\\[[\s\S]+?\\\]/g,
            /\\\([\s\S]+?\\\)/g,
            // Inline $...$: non-space inner edges keep prose like "$5 and $10" as text
            /\$[^$\s](?:[^$\n]*[^$\s])?\$/g
        ];

        const vault = [];
        const nonce = Math.random().toString(36).slice(2, 8);
        const shieldMath = (part) => {
            for (const re of MATH_RULES) {
                re.lastIndex = 0;
                part = part.replace(re, (match) => {
                    vault.push(match);
                    return `@@ARUMATH${nonce}_${vault.length - 1}@@`;
                });
            }
            return part;
        };

        const shielded = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
            .map((part, i) => (i % 2 === 1) ? part : shieldMath(part))
            .join('');

        const restore = new RegExp(`@@ARUMATH${nonce}_(\\d+)@@`, 'g');
        const rendered = marked.parse(shielded).replace(restore, (placeholder, index) => {
            const raw = vault[Number(index)] || '';
            return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        });
        return this.sanitizeHTML(rendered);
    },

    // Strips executable markup from rendered markdown. Marked passes raw HTML
    // through, so any pasted text, RSS snippet or model reply could run script
    // with access to the user's keys and database.
    sanitizeHTML(html) {
        if (typeof DOMPurify === 'undefined') {
            console.warn('UI: DOMPurify is unavailable, rendered HTML was not sanitized');
            return html;
        }
        if (!this._sanitizerReady) {
            // The artifact card is built by the app, not by the model. Keep only
            // that exact handler shape; every other inline event is stripped.
            DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
                if (data.attrName !== 'onclick') return;
                const value = String(data.attrValue || '').trim();
                if (/^window\.app\.openArtifact\("(?:doc|app|game|analytics)",\s*"(?:[^"\\]|\\.)*"\)$/.test(value)) {
                    data.forceKeepAttr = true;
                }
            });
            this._sanitizerReady = true;
        }
        return DOMPurify.sanitize(html);
    },

    /**
     * Renders LaTeX math ($...$, $$...$$, \( \), \[ \]) inside a message bubble with KaTeX.
     * Works on the live DOM only: stored message HTML keeps raw TeX, so existing
     * databases and the copy button are unaffected.
     */
    renderMath(root) {
        if (!root || typeof katex === 'undefined') return;

        const SKIP = { PRE: 1, CODE: 1, SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, BUTTON: 1 };
        const RULES = [
            { re: /\$\$([\s\S]+?)\$\$/g, display: true },
            { re: /\\\[([\s\S]+?)\\\]/g, display: true },
            { re: /\\\(([\s\S]+?)\\\)/g, display: false },
            // Inline $...$: inner edges must be non-space so prose like "$5 and $10" is not treated as math
            { re: /\$([^$\s](?:[^$\n]*[^$\s])?)\$/g, display: false }
        ];

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                let el = node.parentElement;
                while (el && el !== root) {
                    if (SKIP[el.tagName] || el.classList.contains('katex')) return NodeFilter.FILTER_REJECT;
                    el = el.parentElement;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);

        for (const node of textNodes) {
            const text = node.nodeValue;
            if (text.indexOf('$') === -1 && text.indexOf('\\(') === -1 && text.indexOf('\\[') === -1) continue;

            const matches = [];
            for (const rule of RULES) {
                rule.re.lastIndex = 0;
                let m;
                while ((m = rule.re.exec(text)) !== null) {
                    matches.push({ start: m.index, end: m.index + m[0].length, tex: m[1], display: rule.display });
                    if (m[0] === '') rule.re.lastIndex++;
                }
            }
            if (!matches.length) continue;

            matches.sort((a, b) => a.start - b.start);
            const picked = [];
            let lastEnd = -1;
            for (const m of matches) {
                if (m.start >= lastEnd) {
                    picked.push(m);
                    lastEnd = m.end;
                }
            }

            const frag = document.createDocumentFragment();
            let pos = 0;
            for (const m of picked) {
                if (m.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, m.start)));
                const span = document.createElement('span');
                try {
                    katex.render(m.tex, span, { displayMode: m.display, throwOnError: false });
                } catch (e) {
                    span.textContent = text.slice(m.start, m.end);
                }
                frag.appendChild(span);
                pos = m.end;
            }
            if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
            node.parentNode.replaceChild(frag, node);
        }
    },

    clearChat() {
        if (this.container) this.container.innerHTML = '';
    },

    renderAttachments(files) {
        const preview = document.getElementById('attachments-preview');
        if (!preview) return;

        if (!files || files.length === 0) {
            preview.innerHTML = '';
            preview.classList.add('hidden');
            return;
        }

        preview.classList.remove('hidden');
        preview.innerHTML = files.map((f, i) => `
            <div class="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-600 shadow-sm animate-fade-in group">
                <i data-lucide="file-text" class="w-3.5 h-3.5 text-aru-500"></i>
                <span class="text-[10px] font-bold text-gray-700 dark:text-gray-200 truncate max-w-[120px]">${this.escapeHTML(f.name)}</span>
                <button onclick="app.removeFile(${i})" class="text-gray-400 hover:text-red-500 transition-colors">
                    <i data-lucide="x" class="w-3.5 h-3.5"></i>
                </button>
            </div>
        `).join('');

        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    clearAttachments() {
        this.renderAttachments([]);
    },

    // --- Message attachments popover (file names of a sent message) ---

    showMsgFiles(msgId, wrapEl) {
        const pop = wrapEl && wrapEl.querySelector('.msg-files-popover');
        if (!pop) return;
        clearTimeout(wrapEl._filesHideTimer);
        if (pop.dataset.rendered !== msgId) {
            const names = (window.aruFilesCache && window.aruFilesCache[msgId]) || [];
            pop.innerHTML = `<div class="msg-files-list">${names.map(n => `
                <div class="msg-files-row">
                    <i data-lucide="file-text" class="w-3.5 h-3.5 shrink-0 text-aru-500"></i>
                    <span>${this.escapeHTML(n)}</span>
                </div>`).join('')}</div>`;
            pop.dataset.rendered = msgId;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
        pop.classList.remove('hidden');
    },

    hideMsgFiles(wrapEl) {
        const pop = wrapEl && wrapEl.querySelector('.msg-files-popover');
        if (!pop || pop.classList.contains('hidden') || pop.dataset.pinned === '1') return;
        clearTimeout(wrapEl._filesHideTimer);
        wrapEl._filesHideTimer = setTimeout(() => pop.classList.add('hidden'), 250);
    },

    toggleMsgFiles(msgId, btnEl) {
        const wrapEl = btnEl && btnEl.closest('.msg-files-badge-wrap');
        const pop = wrapEl && wrapEl.querySelector('.msg-files-popover');
        if (!pop) return;
        if (!pop.classList.contains('hidden') && pop.dataset.pinned === '1') {
            pop.classList.add('hidden');
            pop.dataset.pinned = '';
            if (this._msgFilesOutside) document.removeEventListener('click', this._msgFilesOutside, true);
            return;
        }
        this.showMsgFiles(msgId, wrapEl);
        pop.dataset.pinned = '1';
        if (this._msgFilesOutside) document.removeEventListener('click', this._msgFilesOutside, true);
        this._msgFilesOutside = (e) => {
            if (wrapEl.contains(e.target)) return;
            pop.classList.add('hidden');
            pop.dataset.pinned = '';
            document.removeEventListener('click', this._msgFilesOutside, true);
        };
        setTimeout(() => document.addEventListener('click', this._msgFilesOutside, true), 0);
    },

    updateModelProgress(progress) {
        let overlay = document.getElementById('model-loading-overlay');
        const t = aruGlobalState.translations || {};

        if (progress >= 100) {
            if (overlay) overlay.classList.add('fade-out');
            setTimeout(() => overlay?.remove(), 500);
            return;
        }

        if (!overlay) {
            const html = `
            <div id="model-loading-overlay" class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 dark:bg-black/75 transition-opacity duration-500">
                <div class="max-w-sm w-full mx-4 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-8 text-center space-y-6 border border-gray-100 dark:border-gray-700">
                    <div class="relative w-24 h-24 mx-auto">
                        <div class="absolute inset-0 rounded-full border-4 border-aru-100 dark:border-aru-800"></div>
                        <div id="model-progress-circle" class="absolute inset-0 rounded-full border-4 border-aru-500 border-t-transparent animate-spin"></div>
                        <div class="absolute inset-0 flex items-center justify-center text-2xl">🦊</div>
                    </div>
                    <div class="space-y-2">
                        <h3 class="text-xl font-bold text-gray-900 dark:text-white">${t.model_loading_title || 'Загрузка ИИ-мозга'}</h3>
                        <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">${t.model_loading_desc || 'Семантическое ядро обеспечивает долговременную память Ару.'}</p>
                    </div>
                    <div class="space-y-2">
                        <div class="h-1.5 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                            <div id="model-progress-bar" class="h-full bg-aru-500 transition-all duration-300" style="width: 0%"></div>
                        </div>
                        <div id="model-progress-text" class="text-[10px] font-bold text-aru-500 uppercase tracking-widest">
                            ${(t.model_loading_progress || 'Загрузка: {p}%').replace('{p}', '0')}
                        </div>
                    </div>
                </div>
            </div>`;
            document.body.insertAdjacentHTML('beforeend', html);
            overlay = document.getElementById('model-loading-overlay');
        }

        const bar = document.getElementById('model-progress-bar');
        const text = document.getElementById('model-progress-text');

        if (bar) bar.style.width = `${progress}%`;
        if (text) text.innerText = (t.model_loading_progress || 'Загрузка: {p}%').replace('{p}', progress);
    }
};

// Sends a quick-reply label as the user's next message
window.aruSendSuggestion = (msgId, idx) => {
    const suggestion = ((window.aruSuggestionsCache || {})[msgId] || [])[idx];
    if (!suggestion) return;
    const input = document.getElementById('prompt-input');
    if (input) input.value = suggestion;
    if (window.app && typeof window.app.sendMessage === 'function') window.app.sendMessage();
};

// Inline handlers for the message attachments popover (UI is module-scoped)
window.aruMsgFiles = {
    show: (msgId, el) => UI.showMsgFiles(msgId, el),
    hide: (el) => UI.hideMsgFiles(el),
    toggle: (msgId, el) => UI.toggleMsgFiles(msgId, el)
};
