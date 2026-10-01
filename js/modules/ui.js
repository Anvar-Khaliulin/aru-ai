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

    appendMessage(msg) {
        if (!this.container) this.container = document.getElementById('messages-container');

        const isUser = msg.role === 'user';
        let parsedContent = '';

        if (msg.isHTML) {
            parsedContent = msg.content;
            // Decodes HTML entities if the content appears to be escaped for proper rendering
            try {
                if (typeof parsedContent === 'string' && parsedContent.indexOf('&lt;') !== -1) {
                    const doc = new DOMParser().parseFromString(parsedContent, 'text/html');
                    const decoded = doc.documentElement.textContent || parsedContent;
                    // Heuristic check: restricts replacement to strings that successfully decoded into HTML tags
                    if (decoded && decoded.indexOf('<') !== -1) parsedContent = decoded;
                }
            } catch (e) {
                // Fallback to original content in case of decoding errors
            }
        } else {
            parsedContent = typeof marked !== 'undefined' ? marked.parse(msg.content) : msg.content;
        }

        const msgId = 'm-' + Math.random().toString(36).substring(2, 9);
        if (!window.aruContentCache) window.aruContentCache = {};
        window.aruContentCache[msgId] = msg.content;

        let html = '';

        // Implements safe access to the global application state object
        const appState = aruGlobalState || window.aruState || {};
        const settings = appState.userSettings || {};

        if (isUser) {
            html = `
            <div class="flex gap-3 mb-6 flex-row-reverse animate-fade-in-up group">
                <div class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 overflow-hidden">
                    <i data-lucide="user" class="w-5 h-5"></i>
                </div>
                <div class="max-w-[80%] bg-aru-500 text-white p-3 px-4 rounded-2xl rounded-tr-none shadow-md text-sm selection:bg-white/30">
                    <div class="prose prose-invert prose-sm max-w-none break-words">
                        ${parsedContent}
                    </div>
                </div>
            </div>`;
        } else {
            const showStickers = settings.show_stickers !== 'false';
            const moodClass = msg.emotion ? `aru-${msg.emotion}` : '';

            // Generates and appends HTML for character stickers if enabled in user settings
            let stickerHTML = '';
            if (showStickers && msg.emotion) {
                stickerHTML = `
                <div class="mt-2 ml-10 animate-fade-in-up">
                    <img src="media/emotions/${msg.emotion}.png" class="w-24 h-24 object-contain transition-transform hover:scale-110 ${moodClass}" onerror="this.style.display='none'">
                </div>`;
            }

            html = `
            <div class="flex flex-col mb-8 animate-fade-in-up group">
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
                ${stickerHTML}
            </div>`;
        }

        if (this.container) {
            this.container.insertAdjacentHTML('beforeend', html);
            if (typeof hljs !== 'undefined') {
                document.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el));
            }
            if (typeof lucide !== 'undefined') lucide.createIcons();
            this.scrollToBottom();
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
