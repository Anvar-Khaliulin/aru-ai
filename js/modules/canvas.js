/*
---ARU-LAB.SPACE---ALMATY---2026---
Canvas manager responsible for rendering generated artifacts like games, apps, and documents.
---chat.aru-lab.space---PWA---
*/
import { DB } from './db.js';

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
                this._themeObserver = new MutationObserver(mutations => {
                    for (const m of mutations) {
                        if (m.attributeName === 'class') {
                            const isDark = document.documentElement.classList.contains('dark');
                            Object.values(this.containers).forEach(({ iframe }) => {
                                if (iframe && iframe.contentWindow && iframe.contentWindow.document) {
                                    const doc = iframe.contentWindow.document.documentElement;
                                    doc.classList.toggle('dark', isDark);
                                    const body = iframe.contentWindow.document.body;
                                    if (body) body.classList.toggle('dark', isDark);
                                }
                            });
                        }
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
        if (window.innerWidth < 768) {
            this.panel.classList.add('absolute', 'z-50', 'w-full');
        }
    },

    close() {
        this.panel.classList.add('hidden');
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
            iframe.sandbox = 'allow-scripts allow-forms allow-modals allow-popups allow-same-origin';

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

        let finalCode = code;
        if (type === 'doc') {
            if (typeof marked !== 'undefined') {
                finalCode = `<div class="prose prose-sm md:prose-base dark:prose-invert max-w-none">${marked.parse(code)}</div>`;
            } else {
                finalCode = `<pre>${code}</pre>`;
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

        const sandboxHTML = `
            <!DOCTYPE html>
            <html lang="en" class="${isDark ? 'dark' : ''}">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
                </style>
                <script>tailwind.config = { darkMode: 'class' };</script>
            </head>
            <body class="bg-white dark:bg-gray-900">
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
            editor.innerHTML = marked.parse(code);
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
            alert('Error generating PDF: ' + e.message);
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
            const overwrite = confirm(t.confirm_overwrite_artifact || 'Artifact with this name already exists. Overwrite?');
            if (!overwrite) {
                const newTitle = prompt(t.prompt_rename_chat || 'Enter new title:', title + ' (Copy)');
                if (!newTitle || !newTitle.trim()) return;
                title = newTitle.trim();
                this.currentArtifact.title = title;
                document.getElementById('canvas-title-text').textContent = title;
            }
        }

        const tags = prompt(t.canvas_save_prompt || 'Enter comma separated tags:', 'general');
        if (!tags) return;

        try {
            DB.saveModule(type, title, this.currentArtifact.code, tags);
            alert(t.toast_saved || 'Saved successfully');
        } catch (e) {
            console.error(e);
            alert(t.lib_error || 'Save sequence encountered an error');
        }
    }
};
window.CanvasManager = CanvasManager;

