import { DB } from './db.js';

const HTML_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a'];
const FORMATS = [
    ['format_bold', 'bold', 'bold'],
    ['format_italic', 'italic', 'italic'],
    ['format_heading2', 'heading-2', 'formatBlock', 'h2'],
    ['format_heading3', 'heading-3', 'formatBlock', 'h3'],
    ['format_text', 'pilcrow', 'formatBlock', 'p'],
    ['format_bullets', 'list', 'insertUnorderedList'],
    ['format_numbers', 'list-ordered', 'insertOrderedList'],
    ['format_quote', 'quote', 'formatBlock', 'blockquote'],
    ['format_link', 'link', 'createLink']
];
let nextId = 0;

function refreshIcons() {
    try {
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    } catch {
        // icon rendering is cosmetic
    }
}

function safeLink(value) {
    const href = String(value ?? '').trim();
    if (!/^(https?:\/\/|mailto:)/i.test(href) || /[\u0000-\u0020\u007f]/.test(href)) return '';
    try {
        return ['http:', 'https:', 'mailto:'].includes(new URL(href).protocol) ? href : '';
    } catch {
        return '';
    }
}

function noteDate(note) {
    const value = note.updated_at || note.created_at;
    // SQLite CURRENT_TIMESTAMP is UTC, even though it has no timezone suffix.
    const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
        ? value.replace(' ', 'T') + 'Z' : value;
    const date = new Date(normalized);
    return value && Number.isFinite(date.getTime()) ? date : null;
}

export class DesktopNotes {
    constructor(body, { t, locale }) {
        this.t = t;
        this.locale = locale;
        this.document = body.ownerDocument;
        this.window = this.document.defaultView;
        this.events = new this.window.AbortController();
        this.notes = [];
        this.selectedId = null;
        this.title = '';
        this.baselineHTML = '';
        this.baselineTitle = '';
        this.selection = null;
        this.busy = true;
        this.destroyed = false;
        this.notice = '';
        this.failed = false;
        const id = `wd-notes-${++nextId}`;

        this.root = this._element('section', 'wd-notes');
        this.root.innerHTML = `
            <aside class="wd-notes-sidebar">
                <div class="wd-notes-sidebar-head">
                    <h2 data-label="notes"></h2>
                    <button type="button" data-action="new" data-label="new_note"></button>
                </div>
                <nav class="wd-notes-list"></nav>
            </aside>
            <div class="wd-notes-main">
                <header class="wd-notes-header">
                    <h2 class="wd-notes-title"></h2>
                    <div class="wd-notes-actions">
                        <button type="button" data-action="save" data-label="note_save"></button>
                    </div>
                </header>
                <form class="wd-notes-title-form" hidden>
                    <label for="${id}-title" data-label="note_title"></label>
                    <input id="${id}-title" type="text" required autocomplete="off">
                    <button type="submit" data-label="note_save"></button>
                    <button type="button" data-action="cancel-title" data-label="cancel"></button>
                </form>
                <div class="wd-notes-toolbar" role="toolbar"></div>
                <form class="wd-notes-link-form" hidden>
                    <label for="${id}-link" data-label="note_link_url"></label>
                    <input id="${id}-link" type="url" required autocomplete="off">
                    <button type="submit" data-label="format_link"></button>
                    <button type="button" data-action="cancel-link" data-label="cancel"></button>
                </form>
                <div class="wd-notes-editor" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true"></div>
                <div class="wd-notes-status" role="status" aria-live="polite"></div>
            </div>`;
        body.append(this.root);
        this.list = this.root.querySelector('.wd-notes-list');
        this.heading = this.root.querySelector('.wd-notes-title');
        this.editor = this.root.querySelector('.wd-notes-editor');
        this.toolbar = this.root.querySelector('.wd-notes-toolbar');
        this.titleForm = this.root.querySelector('.wd-notes-title-form');
        this.titleInput = this.titleForm.querySelector('input');
        this.linkForm = this.root.querySelector('.wd-notes-link-form');
        this.linkInput = this.linkForm.querySelector('input');
        this.status = this.root.querySelector('.wd-notes-status');
        this.saveButton = this.root.querySelector('[data-action="save"]');
        this.renameButton = this._iconButton('note_rename', 'pencil-line', 'rename');
        this.deleteButton = this._iconButton('note_delete', 'trash-2', 'delete');
        this.saveButton.before(this.renameButton, this.deleteButton);

        FORMATS.forEach(([key, icon, command, value]) => {
            const button = this._iconButton(key, icon);
            this.toolbar.append(button);
            this._on(button, 'mousedown', (event) => event.preventDefault());
            this._on(button, 'click', () => {
                if (this.busy) return;
                if (command === 'createLink') {
                    this._rememberSelection();
                    this.linkInput.value = '';
                    this.linkForm.hidden = false;
                    this.linkInput.focus();
                } else {
                    this._command(command, value);
                }
            });
        });
        this._on(this.root, 'click', (event) => {
            const button = event.target.closest('button');
            if (!button || this.busy) return;
            switch (button.dataset.action) {
                case 'new':
                    if (this.canClose()) this._openNote(null);
                    break;
                case 'save': this._requestSave(); break;
                case 'rename': this._openTitleForm(); break;
                case 'delete': void this._delete(); break;
                case 'cancel-title':
                    this.titleInput.value = this.title;
                    this.titleForm.hidden = true;
                    this._updateStatus();
                    this.editor.focus();
                    break;
                case 'cancel-link':
                    this.linkForm.hidden = true;
                    this._restoreSelection();
                    break;
                case 'select': {
                    const note = this.notes.find((item) => String(item.id) === button.dataset.id);
                    if (note && note.id !== this.selectedId && this.canClose()) this._openNote(note);
                    break;
                }
            }
        });
        this._on(this.editor, 'input', () => {
            this.notice = '';
            this.failed = false;
            this._rememberSelection();
            this._updateStatus();
        });
        this._on(this.titleInput, 'input', () => {
            this.notice = '';
            this.failed = false;
            this._updateStatus();
        });
        this._on(this.editor, 'focus', () => {
            this.document.execCommand('defaultParagraphSeparator', false, 'p');
        });
        this._on(this.document, 'selectionchange', () => this._rememberSelection());
        this._on(this.editor, 'paste', (event) => {
            event.preventDefault();
            if (this.busy || !event.clipboardData) return;
            const html = event.clipboardData.getData('text/html');
            try {
                this._command(html ? 'insertHTML' : 'insertText', html
                    ? this._sanitize(html) : event.clipboardData.getData('text/plain'));
            } catch (error) {
                this._error(error);
            }
        });
        // Block drag/drop so the browser cannot insert unsanitized HTML or files.
        this._on(this.editor, 'drop', (event) => event.preventDefault());
        this._on(this.editor, 'dragover', (event) => event.preventDefault());
        this._on(this.editor, 'click', (event) => {
            if (event.target.closest('a')) event.preventDefault();
        });
        this._on(this.root, 'keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                if (!this.busy) this._requestSave();
            } else if (event.key === 'Escape') {
                if (!this.linkForm.hidden) {
                    this.linkForm.hidden = true;
                    this._restoreSelection();
                } else if (!this.titleForm.hidden) {
                    this.titleInput.value = this.title;
                    this.titleForm.hidden = true;
                    this._updateStatus();
                    this.editor.focus();
                }
            }
        });
        this._on(this.titleForm, 'submit', (event) => {
            event.preventDefault();
            void this._save();
        });
        this._on(this.linkForm, 'submit', (event) => {
            event.preventDefault();
            const href = safeLink(this.linkInput.value);
            if (!href || this.busy) {
                this.linkInput.setCustomValidity(this.t('note_link_url'));
                this.linkInput.reportValidity();
                return;
            }
            this.linkForm.hidden = true;
            // A collapsed selection becomes linked URL text; selected text is kept.
            this._restoreSelection();
            const selection = this.window.getSelection();
            if (selection?.isCollapsed) {
                const anchor = this._element('a');
                anchor.href = href;
                anchor.textContent = href;
                this._command('insertHTML', this._sanitize(anchor.outerHTML));
            } else {
                this._command('createLink', href);
            }
        });
        this._on(this.linkInput, 'input', () => this.linkInput.setCustomValidity(''));
        this.renderTexts();
        this._setBusy(true);
        this.ready = this._load();
    }

    _element(tag, className) {
        const element = this.document.createElement(tag);
        if (className) element.className = className;
        return element;
    }

    _iconButton(tip, icon, action) {
        const button = this._element('button', 'wd-notes-icon-btn');
        button.type = 'button';
        button.dataset.tip = tip;
        if (action) button.dataset.action = action;
        const glyph = this._element('i');
        glyph.dataset.lucide = icon;
        button.append(glyph);
        return button;
    }

    _on(target, type, listener) {
        target.addEventListener(type, listener, { signal: this.events.signal });
    }

    _sanitize(html) {
        if (!window.DOMPurify) throw new Error('Desktop notes require DOMPurify');
        const fragment = window.DOMPurify.sanitize(String(html ?? ''), {
            ALLOWED_TAGS: HTML_TAGS,
            ALLOWED_ATTR: ['href'],
            ALLOW_DATA_ATTR: false,
            ALLOW_ARIA_ATTR: false,
            ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:)/i,
            RETURN_DOM_FRAGMENT: true
        });
        // Shared DOMPurify hooks may force-keep attributes for other app views.
        // Enforce this editor's whitelist without changing those global hooks.
        fragment.querySelectorAll('*').forEach((element) => {
            Array.from(element.attributes).forEach((attribute) => {
                if (element.localName !== 'a' || attribute.name !== 'href') {
                    element.removeAttribute(attribute.name);
                }
            });
            if (element.localName === 'a') {
                const href = safeLink(element.getAttribute('href'));
                if (href) element.setAttribute('href', href);
                else element.removeAttribute('href');
            }
        });
        const container = this._element('div');
        container.append(fragment);
        return container.innerHTML;
    }

    async _load() {
        try {
            const notes = await DB.getDesktopNotes();
            if (this.destroyed) return;
            this.notes = (notes || []).map((note) => ({
                ...note, title: String(note.title ?? ''), content: this._sanitize(note.content)
            }));
            this._sortNotes();
            this._openNote(this.notes[0] || null, false);
        } catch (error) {
            if (!this.destroyed) this._error(error);
        } finally {
            if (!this.destroyed) {
                this._setBusy(false);
                this._renderList();
            }
        }
    }

    _sortNotes() {
        this.notes.sort((a, b) => (noteDate(b)?.getTime() || 0) - (noteDate(a)?.getTime() || 0)
            || String(b.id).localeCompare(String(a.id), undefined, { numeric: true }));
    }

    _openNote(note, focus = true) {
        this.selectedId = note ? note.id : null;
        this.title = note?.title || '';
        this.titleInput.value = this.title;
        this.titleForm.hidden = true;
        this.linkForm.hidden = true;
        this.linkInput.setCustomValidity('');
        this.editor.innerHTML = note ? this._sanitize(note.content) : '';
        this.baselineHTML = this.editor.innerHTML;
        this.baselineTitle = this.title;
        this.selection = null;
        this.notice = '';
        this.failed = false;
        this._updateStatus();
        this._renderList();
        if (focus) this.editor.focus();
    }

    get dirty() {
        return this.editor.innerHTML !== this.baselineHTML || this.titleInput.value !== this.baselineTitle;
    }

    canClose() {
        if (this.destroyed) return true;
        if (this.busy) return false;
        return !this.dirty || this.window.confirm(this.t('notes_unsaved'));
    }

    _rememberSelection() {
        const selection = this.window.getSelection();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (this.editor.contains(range.startContainer) && this.editor.contains(range.endContainer)) {
            this.selection = range.cloneRange();
        }
    }

    _restoreSelection() {
        this.editor.focus();
        const selection = this.window.getSelection();
        if (!selection) return;
        const range = this.selection;
        selection.removeAllRanges();
        if (range && this.editor.contains(range.startContainer) && this.editor.contains(range.endContainer)) {
            selection.addRange(range);
        } else {
            const end = this.document.createRange();
            end.selectNodeContents(this.editor);
            end.collapse(false);
            selection.addRange(end);
        }
    }

    _command(command, value = null) {
        if (this.busy) return;
        this._restoreSelection();
        this.document.execCommand(command, false, value);
        this._rememberSelection();
        this.notice = '';
        this.failed = false;
        this._updateStatus();
    }

    _requestSave() {
        if (!this.titleForm.hidden) {
            this.titleForm.requestSubmit();
            return;
        }
        // A note that already has a title is updated in place; only a new one is named first.
        if (this.selectedId !== null && this.title.trim()) {
            void this._save();
            return;
        }
        this._openTitleForm();
    }

    _openTitleForm() {
        if (this.busy) return;
        this.linkForm.hidden = true;
        this.titleInput.value = this.title;
        this.titleForm.hidden = false;
        this.titleInput.focus();
        this.titleInput.select();
    }

    async _delete() {
        if (this.busy || this.destroyed || this.selectedId === null) return;
        const current = this.notes.find((note) => note.id === this.selectedId);
        const name = (current?.title || '').trim() || this.t('note_untitled');
        if (!this.window.confirm(this.t('note_delete_confirm').replace('{title}', name))) return;
        const removedId = this.selectedId;
        this._setBusy(true);
        try {
            await DB.deleteDesktopNote(removedId);
            if (this.destroyed) return;
            const index = this.notes.findIndex((note) => note.id === removedId);
            this.notes = this.notes.filter((note) => note.id !== removedId);
            this._setBusy(false);
            this._openNote(this.notes[Math.min(Math.max(index, 0), this.notes.length - 1)] || null, false);
            this.notice = 'note_deleted';
        } catch (error) {
            if (!this.destroyed) this._error(error);
        } finally {
            if (!this.destroyed) {
                this._setBusy(false);
                this._updateStatus();
            }
        }
    }

    async _save() {
        if (this.busy || this.destroyed) return;
        const title = this.titleInput.value.trim();
        if (!title) {
            this.titleInput.value = '';
            this.titleInput.reportValidity();
            return;
        }
        this._setBusy(true);
        try {
            const content = this._sanitize(this.editor.innerHTML);
            const id = await DB.saveDesktopNote(this.selectedId, title, content);
            if (this.destroyed) return;
            if (id === null || id === undefined) throw new Error('Desktop note was not saved');
            const previous = this.notes.find((note) => note.id === this.selectedId);
            const now = new Date().toISOString();
            const note = { id, title, content, created_at: previous?.created_at || now, updated_at: now };
            this.notes = this.notes.filter((item) => item.id !== id && item.id !== this.selectedId);
            this.notes.push(note);
            this.selectedId = id;
            this.title = title;
            this.titleInput.value = title;
            this.baselineTitle = title;
            // Keep the live DOM and caret intact; only the DB receives sanitized HTML.
            this.baselineHTML = this.editor.innerHTML;
            this.titleForm.hidden = true;
            this.notice = 'notes_saved';
            this.failed = false;
            this._sortNotes();
            this._renderList();
        } catch (error) {
            if (!this.destroyed) this._error(error);
        } finally {
            if (!this.destroyed) {
                this._setBusy(false);
                this._updateStatus();
            }
        }
    }

    _setBusy(busy) {
        this.busy = busy;
        this.root.setAttribute('aria-busy', String(busy));
        this.editor.contentEditable = busy ? 'false' : 'true';
        this.root.querySelectorAll('button, input').forEach((control) => { control.disabled = busy; });
        this._syncActions();
    }

    _syncActions() {
        const disabled = this.busy || this.selectedId === null;
        this.renameButton.disabled = disabled;
        this.deleteButton.disabled = disabled;
    }

    _error(error) {
        console.error('Desktop notes:', error);
        this.failed = true;
        this.notice = '';
        this._updateStatus();
    }

    _updateStatus() {
        this.heading.textContent = this.title.trim() || this.t(this.selectedId === null ? 'new_note' : 'note_untitled');
        this.status.textContent = this.dirty || this.failed ? this.t('notes_dirty') : this.notice ? this.t(this.notice) : '';
        this._syncActions();
    }

    _renderList() {
        const scrollTop = this.list.scrollTop;
        this.list.replaceChildren();
        if (!this.notes.length) {
            const empty = this._element('p', 'wd-notes-empty');
            empty.textContent = this.t('notes_empty');
            this.list.append(empty);
            return;
        }
        let formatter;
        try {
            formatter = new Intl.DateTimeFormat(this.locale(), { year: 'numeric', month: 'long', day: 'numeric' });
        } catch {
            formatter = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric' });
        }
        let groupKey;
        this.notes.forEach((note) => {
            const date = noteDate(note);
            const key = date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : '';
            if (key !== groupKey) {
                const group = this._element('h3', 'wd-notes-date');
                group.textContent = date ? formatter.format(date) : this.t('note_untitled');
                this.list.append(group);
                groupKey = key;
            }
            const button = this._element('button', 'wd-notes-item');
            button.type = 'button';
            button.dataset.action = 'select';
            button.dataset.id = String(note.id);
            button.disabled = this.busy;
            if (note.id === this.selectedId) button.setAttribute('aria-current', 'true');
            const title = this._element('span', 'wd-notes-item-title');
            title.textContent = note.title.trim() || this.t('note_untitled');
            const caption = this._element('span', 'wd-notes-caption');
            const content = this._element('div');
            content.innerHTML = note.content;
            content.querySelectorAll('p, h2, h3, li, blockquote, br').forEach((block) => block.append(' '));
            caption.textContent = content.textContent.replace(/\s+/g, ' ').trim().slice(0, 160);
            button.append(title, caption);
            this.list.append(button);
        });
        this.list.scrollTop = scrollTop;
    }

    renderTexts() {
        if (this.destroyed) return;
        this.root.querySelectorAll('[data-label]').forEach((element) => {
            element.textContent = this.t(element.dataset.label);
        });
        this.root.querySelectorAll('[data-tip]').forEach((element) => {
            const text = this.t(element.dataset.tip);
            element.title = text;
            element.setAttribute('aria-label', text);
        });
        this.root.setAttribute('aria-label', this.t('notes'));
        this.list.setAttribute('aria-label', this.t('notes'));
        this.toolbar.setAttribute('aria-label', this.t('notes'));
        this.editor.setAttribute('aria-label', this.t('notes'));
        this.titleInput.placeholder = this.t('note_title');
        this.linkInput.placeholder = this.t('note_link_url');
        if (this.linkInput.validationMessage && !this.linkInput.validity.valid) {
            this.linkInput.setCustomValidity(this.t('note_link_url'));
        }
        this._updateStatus();
        this._renderList();
        refreshIcons();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.events.abort();
        this.selection = null;
        this.root.remove();
        this.notes = [];
    }
}
