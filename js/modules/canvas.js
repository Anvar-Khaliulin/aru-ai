/*
---ARU-LAB.SPACE---ALMATY---2026---
Canvas manager responsible for rendering generated artifacts like games, apps, and documents.
---chat.aru-lab.space---PWA---
*/
import { DB } from './db.js';
import { UI } from './ui.js';

export const CanvasManager = {
    containers: {}, // chatId -> { container, iframe }
    panel: document.getElementById('canvas-panel'),
    currentArtifact: null,

    init() {
        const renderArea = document.getElementById('canvas-render-area');
        if (renderArea) renderArea.innerHTML = '';
        this.containers = {};

        try {
            if (typeof MutationObserver !== 'undefined') {
                this._themeObserver = new MutationObserver(() => {
                    const isDark = document.documentElement.classList.contains('dark');
                    Object.values(this.containers).forEach(({ iframe }) => {
                        if (!iframe) return;
                        try {
                            const doc = iframe.contentWindow.document;
                            doc.documentElement.classList.toggle('dark', isDark);
                            if (doc.body) doc.body.classList.toggle('dark', isDark);
                        } catch (e) {
                            // Artifacts run in a sandbox without same-origin access, so the
                            // theme can only be applied at srcdoc render time.
                            iframe.dataset.lastTheme = '';
                        }
                    });
                    const renderArea = document.getElementById('canvas-render-area');
                    if (this.currentArtifact && renderArea && !renderArea.classList.contains('hidden')) {
                        this.renderPreview();
                    }
                });
                this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            }
        } catch (e) {
            console.warn('CanvasManager.init: failed to attach theme observer', e);
        }
    },

    open() {
        this.panel.classList.remove('hidden');
        // Artifacts can open the panel without going through ChatController.toggleCanvas,
        // so the split handle has to follow the panel state here as well.
        const resizer = document.getElementById('canvas-resizer');
        if (resizer) resizer.classList.remove('hidden');
        if (window.innerWidth < 768) {
            this.panel.classList.add('absolute', 'z-50', 'w-full');
        }
    },

    close() {
        this.panel.classList.add('hidden');
        const resizer = document.getElementById('canvas-resizer');
        if (resizer) resizer.classList.add('hidden');
    },

    renderArtifact(type, title, code) {
        this.currentArtifact = { type, title, code };
        this.open();

        document.getElementById('canvas-empty-state').classList.add('hidden');
        document.getElementById('canvas-render-area').classList.remove('hidden');

        const tabsEl = document.getElementById('canvas-tabs');
        const btnEdit = document.getElementById('btn-canvas-edit');
        const showTabs = (type === 'app' || type === 'game' || type === 'analytics' || type === 'doc');
        if (tabsEl) tabsEl.classList.toggle('hidden', !showTabs);
        if (btnEdit) btnEdit.classList.toggle('hidden', type !== 'doc');
        document.getElementById('canvas-title-text').textContent = title;

        this.switchTab('preview');
    },

    switchTab(tab) {
        const renderArea = document.getElementById('canvas-render-area');
        const codeArea = document.getElementById('canvas-code-area');
        const editArea = document.getElementById('canvas-edit-area');
        const btnPreview = document.getElementById('btn-canvas-preview');
        const btnCode = document.getElementById('btn-canvas-code');
        const btnEdit = document.getElementById('btn-canvas-edit');

        if (!this.currentArtifact) tab = 'preview';
        if (this.currentArtifact && this.currentArtifact.type !== 'doc' && tab === 'edit') tab = 'preview';

        const activeCls = 'flex-1 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-gray-700 shadow-sm transition-all';
        const idleCls = 'flex-1 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-700 dark:text-gray-400 transition-all';
        btnPreview.className = tab === 'preview' ? activeCls : idleCls;
        btnCode.className = tab === 'code' ? activeCls : idleCls;
        if (btnEdit) {
            const isDoc = this.currentArtifact && this.currentArtifact.type === 'doc';
            btnEdit.className = (tab === 'edit' ? activeCls : idleCls) + (isDoc ? '' : ' hidden');
        }

        renderArea.classList.toggle('hidden', tab !== 'preview');
        codeArea.classList.toggle('hidden', tab !== 'code');
        if (editArea) editArea.classList.toggle('hidden', tab !== 'edit');

        if (tab === 'preview') {
            this.renderPreview();
        } else if (tab === 'code') {
            this.renderCode();
        } else if (tab === 'edit') {
            this.loadDocEditor();
        }
    },

    renderPreview() {
        if (!this.currentArtifact) return;
        const state = window.aruState;
        if (!state || state.activeTabIndex === -1) return;

        const chatId = state.tabs[state.activeTabIndex].chatId;
        const { type, title, code } = this.currentArtifact;
        const renderArea = document.getElementById('canvas-render-area');

        if (!this.containers[chatId]) {
            const container = document.createElement('div');
            container.className = 'w-full h-full chat-artifact-container';
            container.dataset.chatId = chatId;
            renderArea.appendChild(container);

            const iframe = document.createElement('iframe');
            iframe.className = 'w-full h-full border-none';
            iframe.sandbox = 'allow-scripts allow-forms allow-modals allow-popups';

            container.appendChild(iframe);
            this.containers[chatId] = { container, iframe };
        }

        const { iframe, container } = this.containers[chatId];

        renderArea.querySelectorAll('.chat-artifact-container').forEach(el => el.classList.add('hidden'));
        container.classList.remove('hidden');

        const isDark = document.documentElement.classList.contains('dark');
        const theme = isDark ? 'dark' : 'light';

        if (iframe.dataset.lastCode === code && iframe.dataset.lastTheme === theme) {
            return;
        }

        iframe.dataset.lastCode = code;
        iframe.dataset.lastTheme = theme;
        this.renderInto(iframe, { type, title, code });
    },

    renderInto(iframe, { type, title, code }) {
        const isDark = document.documentElement.classList.contains('dark');
        let finalCode = code;
        if (type === 'doc') {
            if (typeof marked !== 'undefined') {
                const docHtml = marked.parse(code);
                let safeHtml = (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(docHtml) : docHtml;
                // The chat markdown renderer injects a copy button that relies on the
                // parent page cache; inside the sandbox it would be a dead icon.
                try {
                    const holder = document.createElement('div');
                    holder.innerHTML = safeHtml;
                    holder.querySelectorAll('div.rounded-xl > div:first-child > button').forEach(btn => btn.remove());
                    safeHtml = holder.innerHTML;
                } catch (e) { /* keep sanitized markup as-is */ }
                finalCode = `<article class="aru-doc">${safeHtml}</article>`;
            } else {
                finalCode = `<pre class="aru-doc">${code}</pre>`;
            }
        } else if (type === 'app' || type === 'game' || type === 'analytics') {
            if (!/<!DOCTYPE html>/i.test(code) && !/^\s*<html/i.test(code)) {
                if (!/<\w+[^>]*>/.test(code)) {
                    finalCode = `<div id="root"></div><script>try { ${code} } catch(e) { console.error(e); document.getElementById('root').innerText = 'Runtime error: ' + e.message; }</script>`;
                } else {
                    finalCode = code;
                }
            } else {
                finalCode = code;
            }
        }

        const gameScaling = (type === 'game') ? `
            canvas, img, svg, video { max-width: 100% !important; height: auto !important; object-fit: contain; }
            body { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; min-height: 100vh; margin: 0; padding: 10px; overflow-x: hidden; }
            #app, #root, #game-container { max-width: 100%; width: 100%; }
        ` : '';

        // Text documents must read exactly like the "Edit" tab, which renders inside
        // #doc-editor with the app transcript styles. The typography plugin is not
        // available in the sandbox, so the document rules are spelled out here.
        const docStyles = (type === 'doc') ? `
            body {
                margin: 0;
                padding: 20px;
                background: #ffffff;
                color: #1f2937;
                font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                font-size: 14px;
                line-height: 1.65;
                -webkit-font-smoothing: antialiased;
            }
            .dark body { background: #1c1c1e; color: #e5e7eb; }
            .aru-doc { max-width: none; word-break: break-word; }
            .aru-doc > :first-child { margin-top: 0; }
            .aru-doc > :last-child { margin-bottom: 0; }
            .aru-doc h1, .aru-doc h2, .aru-doc h3,
            .aru-doc h4, .aru-doc h5, .aru-doc h6 {
                margin: 0.9em 0 0.45em;
                font-weight: 700;
                line-height: 1.3;
                letter-spacing: -0.01em;
            }
            .aru-doc h1 { font-size: 1.45em; }
            .aru-doc h2 { font-size: 1.25em; }
            .aru-doc h3 { font-size: 1.1em; }
            .aru-doc h4, .aru-doc h5, .aru-doc h6 { font-size: 1em; }
            .aru-doc p { margin: 0.5em 0; }
            .aru-doc ul, .aru-doc ol { margin: 0.5em 0; padding-left: 1.4em; }
            .aru-doc ul { list-style: disc; }
            .aru-doc ol { list-style: decimal; }
            .aru-doc li { margin: 0.2em 0; }
            .aru-doc li > ul, .aru-doc li > ol { margin: 0.2em 0; }
            .aru-doc input[type="checkbox"] { margin: 0 0.45em 0 0; vertical-align: middle; accent-color: #f97316; }
            .aru-doc blockquote {
                margin: 0.6em 0;
                padding-left: 0.9em;
                border-left: 3px solid #f97316;
                color: #6b7280;
            }
            .dark .aru-doc blockquote { color: #9ca3af; }
            .aru-doc a { color: #f97316; text-decoration: underline; }
            .aru-doc strong { font-weight: 700; }
            .aru-doc :not(pre) > code {
                padding: 0.1em 0.35em;
                border-radius: 4px;
                background: #f3f4f6;
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-size: 0.9em;
            }
            .dark .aru-doc :not(pre) > code { background: #1f2937; }
            .aru-doc pre {
                margin: 0.6em 0;
                padding: 0.8em 1em;
                border-radius: 8px;
                background: #f3f4f6;
                overflow-x: auto;
            }
            .dark .aru-doc pre { background: #1f2937; }
            .aru-doc pre code { background: transparent; padding: 0; font-size: 0.92em; }
            .aru-doc hr { margin: 1em 0; border: 0; border-top: 1px solid #e9e9ec; }
            .dark .aru-doc hr { border-top-color: #2b2b2f; }
            .aru-doc table { width: 100%; margin: 0.65em 0; border-collapse: collapse; font-size: 0.95em; }
            .aru-doc th, .aru-doc td { padding: 6px 9px; text-align: left; }
            .aru-doc th { background: #f4f4f6; font-weight: 700; }
            .dark .aru-doc th { background: #232326; }
            .aru-doc tbody tr:nth-child(even) { background: #fafafa; }
            .dark .aru-doc tbody tr:nth-child(even) { background: #202023; }
            .aru-doc img { max-width: 100%; height: auto; border-radius: 8px; }
            /* Fenced code arrives as a chat-style card; keep its shape but drop the hairline. */
            .aru-doc > div.rounded-xl {
                margin: 0.9em 0 !important;
                border: 0 !important;
                box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 6px 14px -8px rgba(15, 23, 42, 0.22) !important;
            }
            .dark .aru-doc > div.rounded-xl {
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45), 0 8px 18px -10px rgba(0, 0, 0, 0.65) !important;
            }
            .aru-doc > div.rounded-xl > div:first-child {
                border-bottom: 0 !important;
                background: #f4f4f6 !important;
            }
            .dark .aru-doc > div.rounded-xl > div:first-child { background: #232326 !important; }
            .aru-doc > div.rounded-xl pre { background: #fafafa !important; }
            .dark .aru-doc > div.rounded-xl pre { background: #18181b !important; }
        ` : '';

        // Sandboxed iframes get an opaque origin, so native localStorage/sessionStorage
        // throw SecurityError. Generated artifacts often persist small state there;
        // without a fallback the whole artifact script aborts before it renders.
        const storageShim = `<script>(function(){
            function makeStore(){
                var data = {};
                return {
                    getItem: function(k){ k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
                    setItem: function(k, v){ data[String(k)] = String(v); },
                    removeItem: function(k){ delete data[String(k)]; },
                    clear: function(){ data = {}; },
                    key: function(i){ var keys = Object.keys(data); return i >= 0 && i < keys.length ? keys[i] : null; },
                    get length(){ return Object.keys(data).length; }
                };
            }
            var localStore = makeStore(), sessionStore = makeStore();
            try { window.localStorage.getItem('__aru_probe__'); } catch (e) {
                try { Object.defineProperty(window, 'localStorage', { configurable: true, get: function(){ return localStore; } }); } catch (e2) {}
            }
            try { window.sessionStorage.getItem('__aru_probe__'); } catch (e) {
                try { Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function(){ return sessionStore; } }); } catch (e2) {}
            }
        })();</script>`;

        const sandboxHTML = `
            <!DOCTYPE html>
            <html lang="en" class="${isDark ? 'dark' : ''}">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                ${storageShim}
                ${type === 'doc' ? '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">' : ''}
                <script src="https://cdn.tailwindcss.com"></script>
                <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
                <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
                <style>
                    body { background-color: #ffffff; color: #1f2937; padding: 20px; font-family: sans-serif; transition: background-color 0.3s; }
                    .dark body { background-color: #111827; color: #f3f4f6; }
                    ::-webkit-scrollbar { width: 6px; }
                    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
                    ${gameScaling}
                    ${docStyles}
                </style>
                <script>tailwind.config = { darkMode: 'class' };</script>
            </head>
            <body class="${type === 'doc' ? 'aru-doc-body' : 'bg-white dark:bg-gray-900'}">
                ${finalCode}
                <script>document.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el));</script>
            </body>
            </html>
        `;

        iframe.srcdoc = sandboxHTML;
    },

    switchChat(chatId) {
        const renderArea = document.getElementById('canvas-render-area');
        if (!renderArea) return;

        renderArea.querySelectorAll('.chat-artifact-container').forEach(el => el.classList.add('hidden'));

        if (this.containers[chatId]) {
            this.containers[chatId].container.classList.remove('hidden');
            const empty = document.getElementById('canvas-empty-state');
            if (empty) empty.classList.add('hidden');
            renderArea.classList.remove('hidden');
        } else {
            this.clearCanvas();
        }
    },

    destroyContainer(chatId) {
        if (this.containers[chatId]) {
            this.containers[chatId].container.remove();
            delete this.containers[chatId];
        }
    },

    renderCode() {
        if (!this.currentArtifact) return;
        const { type, code } = this.currentArtifact;
        const codeDisplay = document.getElementById('code-display');
        let lang = 'javascript';
        if (type === 'doc') lang = 'markdown';
        else if (/^\s*</.test(code) || /<!DOCTYPE html>/i.test(code)) lang = 'xml';
        codeDisplay.className = `language-${lang}`;
        codeDisplay.textContent = code;
        if (typeof hljs !== 'undefined') {
            if (hljs.getLanguage(lang)) {
                codeDisplay.removeAttribute('data-highlighted');
                hljs.highlightElement(codeDisplay);
            } else {
                codeDisplay.removeAttribute('data-highlighted');
                codeDisplay.className = 'language-plaintext';
            }
        }
    },

    loadDocEditor() {
        if (!this.currentArtifact || this.currentArtifact.type !== 'doc') return;
        const editor = document.getElementById('doc-editor');
        if (!editor) return;
        const code = this.currentArtifact.code;
        if (typeof marked !== 'undefined') {
            const docHtml = marked.parse(code);
            editor.innerHTML = (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(docHtml) : docHtml;
        } else {
            editor.textContent = code;
        }
        if (window.lucide) window.lucide.createIcons();
    },

    docEditCommand(cmd, value = null) {
        const editor = document.getElementById('doc-editor');
        if (!editor) return;
        editor.focus();
        if (cmd === 'formatBlock') {
            document.execCommand('formatBlock', false, value);
        } else if (cmd === 'createLink') {
            const t = window.aruState && window.aruState.translations ? window.aruState.translations : {};
            const url = window.prompt(t.edit_link_prompt || 'URL:', 'https://');
            if (url) document.execCommand('createLink', false, url);
        } else {
            document.execCommand(cmd, false, value);
        }
    },

    saveDocEdit() {
        if (!this.currentArtifact || this.currentArtifact.type !== 'doc') return;
        const editor = document.getElementById('doc-editor');
        if (!editor) return;
        let markdown = editor.innerText;
        if (typeof TurndownService !== 'undefined') {
            const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
            td.addRule('strikethrough', {
                filter: ['del', 's'],
                replacement: (content) => `~~${content}~~`
            });
            markdown = td.turndown(editor.innerHTML);
        }
        this.currentArtifact.code = markdown;

        const state = window.aruState;
        const tab = state && state.tabs[state.activeTabIndex];
        if (tab) {
            tab.artifact = { ...this.currentArtifact };
            const cacheKey = (tab.chatId !== null && tab.chatId !== undefined) ? `${tab.chatId}:${this.currentArtifact.title}` : this.currentArtifact.title;
            if (!window.aruArtifactsCache) window.aruArtifactsCache = {};
            window.aruArtifactsCache[cacheKey] = { type: 'doc', title: this.currentArtifact.title, code: markdown };
            if (!tab.isPrivate && tab.chatId !== null && tab.chatId !== undefined && window.DB && DB.saveChatArtifact) {
                DB.saveChatArtifact(tab.chatId, this.currentArtifact.title, 'doc', markdown);
            }
        }
        this.switchTab('preview');
    },

    cancelDocEdit() {
        this.switchTab('preview');
    },

    copyCode() {
        if (!this.currentArtifact) return;
        navigator.clipboard.writeText(this.currentArtifact.code);
    },

    clearCanvas(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        this.currentArtifact = null;
        this.panel.classList.remove('canvas-fullscreen');
        const icon = document.getElementById('canvas-maximize-icon');
        if (icon) icon.setAttribute('data-lucide', 'maximize-2');
        if (window.lucide) window.lucide.createIcons();
        
        const empty = document.getElementById('canvas-empty-state'); if (empty) empty.classList.remove('hidden');
        const render = document.getElementById('canvas-render-area'); if (render) {
            render.classList.add('hidden');
            render.querySelectorAll('.chat-artifact-container').forEach(el => el.classList.add('hidden'));
        }
        const codeArea = document.getElementById('canvas-code-area'); if (codeArea) codeArea.classList.add('hidden');
        const editArea = document.getElementById('canvas-edit-area'); if (editArea) editArea.classList.add('hidden');
        const tabs = document.getElementById('canvas-tabs'); if (tabs) tabs.classList.add('hidden');
        const title = document.getElementById('canvas-title-text'); if (title) title.textContent = 'Canvas';
    },

    toggleFullscreen(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        this.panel.classList.toggle('canvas-fullscreen');
        const isFullscreen = this.panel.classList.contains('canvas-fullscreen');
        
        const icon = document.getElementById('canvas-maximize-icon');
        const btn = icon ? icon.closest('button') : null;
        
        if (icon) {
            icon.setAttribute('data-lucide', isFullscreen ? 'minimize-2' : 'maximize-2');
            if (window.lucide) window.lucide.createIcons();
        }
        
        if (btn) {
            const state = window.aruState || {};
            const t = state.translations || {};
            btn.title = isFullscreen ? 
                (t.canvas_minimize_tooltip || 'Restore') : 
                (t.canvas_expand_tooltip || 'Maximize');
        }
    },

    toggleDownloadDropdown(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        const dropdown = document.getElementById('download-dropdown');
        if (dropdown) dropdown.classList.toggle('hidden');

        const closeDropdown = (e) => {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.add('hidden');
                document.removeEventListener('click', closeDropdown);
            }
        };
        if (!dropdown.classList.contains('hidden')) {
            document.addEventListener('click', closeDropdown);
        }
    },

    downloadAsHTML(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        if (!this.currentArtifact) return;
        const { title, code } = this.currentArtifact;

        let outHtml = code;
        if (!/<!DOCTYPE html>/i.test(code) && !/^\s*<html/i.test(code)) {
            outHtml = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${title}</title>\n<script src="https://cdn.tailwindcss.com"></script>\n</head>\n<body class="p-6">\n${code}\n</body>\n</html>`;
        }

        const blob = new Blob([outHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '_')}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        document.getElementById('download-dropdown')?.classList.add('hidden');
    },

    async downloadAsPDF(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        if (!this.currentArtifact) return;
        const { title, type } = this.currentArtifact;
        const state = window.aruState;
        if (!state || state.activeTabIndex === -1) return;

        const chatId = state.tabs[state.activeTabIndex].chatId;
        const container = this.containers[chatId];
        if (!container || !container.iframe) return;

        try {
            document.getElementById('download-dropdown')?.classList.add('hidden');

            const iframeDoc = container.iframe.contentWindow.document;
            // Create a wrapper for PDF generation
            const element = document.createElement('div');
            element.style.padding = '20px';
            element.style.backgroundColor = 'white';
            element.style.color = 'black';
            element.classList.add('pdf-export-container');

            // Clone body to manipulate
            const bodyClone = iframeDoc.body.cloneNode(true);
            element.appendChild(bodyClone);

            const originalCanvases = iframeDoc.querySelectorAll('canvas');
            const clonedCanvases = element.querySelectorAll('canvas');

            originalCanvases.forEach((canv, idx) => {
                try {
                    const img = document.createElement('img');
                    img.src = canv.toDataURL('image/png');
                    img.style.width = '100%';
                    img.style.height = 'auto';
                    img.className = canv.className;
                    if (clonedCanvases[idx]) {
                        clonedCanvases[idx].parentNode.replaceChild(img, clonedCanvases[idx]);
                    }
                } catch (e) {
                    console.warn('CanvasManager: Failed to convert canvas to image', e);
                }
            });

            const opt = {
                margin: 10,
                filename: `${title.replace(/\s+/g, '_')}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true, logging: false },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            // @ts-ignore
            await html2pdf().set(opt).from(element).save();
        } catch (e) {
            console.error('PDF Generation Error:', e);
            await UI.alert('Error generating PDF: ' + e.message);
        }
    },

    downloadCurrentArtifact(evt) {
        this.downloadAsHTML(evt);
    },

    async saveCurrentArtifact() {
        if (!this.currentArtifact) return;
        const appState = window.aruState || {};
        const t = appState.translations || {};

        let title = this.currentArtifact.title;
        let type = this.currentArtifact.type;

        if (DB.moduleExists(type, title)) {
            const overwrite = await UI.confirm(t.confirm_overwrite_artifact || 'Artifact with this name already exists. Overwrite?');
            if (!overwrite) {
                const newTitle = await UI.prompt(t.prompt_rename_chat || 'Enter new title:', title + ' (Copy)');
                if (!newTitle || !newTitle.trim()) return;
                title = newTitle.trim();
                this.currentArtifact.title = title;
                document.getElementById('canvas-title-text').textContent = title;
            }
        }

        const tags = await UI.prompt(t.canvas_save_prompt || 'Enter comma separated tags:', 'general');
        if (!tags) return;

        try {
            DB.saveModule(type, title, this.currentArtifact.code, tags);
            UI.showToast(t.toast_saved || 'Saved successfully', 'check-circle');
        } catch (e) {
            console.error(e);
            await UI.alert(t.lib_error || 'Save sequence encountered an error');
        }
    }
};
window.CanvasManager = CanvasManager;

