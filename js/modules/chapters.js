/*
---ARU-LAB.SPACE---ALMATY---2026---
In-chat Sections & Chapters navigator: transparent overlay panel, message anchors, mobile-first UX.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { DB } from './db.js';

export const Chapters = {
    _inited: false,
    _open: false,
    _pickChapterId: null,
    _flashTimer: null,

    init() {
        if (this._inited) return;
        this._inited = true;

        const fab = document.getElementById('chapters-fab');
        const panel = document.getElementById('chapters-panel');
        if (!fab || !panel) return;

        fab.addEventListener('click', (e) => {
            e.stopPropagation();
            Chapters.toggle();
        });

        panel.addEventListener('click', (e) => Chapters._onPanelClick(e));

        const addSectionBtn = document.getElementById('chapters-add-section');
        if (addSectionBtn) {
            addSectionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                Chapters._addSection();
            });
        }

        const pickCancel = document.getElementById('chapters-pick-cancel');
        if (pickCancel) {
            pickCancel.addEventListener('click', (e) => {
                e.stopPropagation();
                Chapters.cancelPick();
            });
        }

        document.addEventListener('click', (e) => Chapters._onDocClickCapture(e), true);

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (Chapters._pickChapterId) {
                Chapters.cancelPick();
            } else if (Chapters._open) {
                const renaming = document.activeElement && document.activeElement.classList.contains('chapters-rename-input');
                if (!renaming) Chapters.close();
            }
        });

        document.addEventListener('click', (e) => {
            if (!Chapters._open || Chapters._pickChapterId) return;
            if (panel.contains(e.target)) return;
            if (fab.contains(e.target)) return;
            Chapters.close();
        });

        Chapters.refreshVisibility();
    },

    _t(key, fallback) {
        const tr = state.translations || {};
        return tr[key] || fallback;
    },

    _escape(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    _activeTab() {
        if (!state.tabs || state.currentChatId === null || state.currentChatId === undefined) return null;
        const tab = state.tabs.find(t => t.chatId == state.currentChatId);
        if (!tab) return null;
        if (tab.isPrivate) return null;
        if (tab.type && tab.type !== 'chat') return null;
        if (typeof tab.chatId === 'string' && tab.chatId.startsWith('ephemeral-')) return null;
        return tab;
    },

    refreshVisibility() {
        const fab = document.getElementById('chapters-fab');
        if (!fab) return;
        const show = !!Chapters._activeTab();
        fab.classList.toggle('hidden', !show);
        if (!show) {
            Chapters.close(true);
        } else if (Chapters._open) {
            Chapters.render();
        }
    },

    toggle() {
        if (Chapters._open) Chapters.close();
        else Chapters.open();
    },

    open() {
        if (!Chapters._activeTab()) return;
        const panel = document.getElementById('chapters-panel');
        if (!panel) return;
        Chapters._open = true;
        panel.classList.remove('hidden');
        Chapters.render();
    },

    close(silent) {
        const panel = document.getElementById('chapters-panel');
        Chapters._open = false;
        if (!silent && Chapters._pickChapterId) Chapters.cancelPick();
        if (panel) panel.classList.add('hidden');
    },

    // --- Rendering ---

    render() {
        const tab = Chapters._activeTab();
        const panel = document.getElementById('chapters-panel');
        const list = document.getElementById('chapters-list');
        if (!panel || !list) return;
        if (!tab) { Chapters.close(true); return; }

        const chatId = tab.chatId;
        const sections = DB.getSections(chatId);
        const chapters = DB.getChaptersByChat(chatId);
        const bySection = {};
        chapters.forEach(c => (bySection[c.section_id] = bySection[c.section_id] || []).push(c));

        if (sections.length === 0) {
            list.innerHTML = `<div class="chapters-empty">${Chapters._escape(Chapters._t('chapters_empty', 'Пока нет разделов'))}</div>`;
        } else {
            list.innerHTML = sections.map(section => {
                const rows = [Chapters._sectionHTML(section)];
                (bySection[section.id] || []).forEach(chapter => rows.push(Chapters._chapterHTML(chapter)));
                return rows.join('');
            }).join('');
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    _iconButtonHTML(act, icon, title, extraClass) {
        return `<button type="button" class="chapters-icon-btn${extraClass ? ' ' + extraClass : ''}" data-act="${act}" title="${Chapters._escape(title)}"><i data-lucide="${icon}" class="w-3.5 h-3.5"></i></button>`;
    },

    _sectionHTML(section) {
        return `
        <div class="chapters-row chapters-section-row" data-row-type="section" data-row-id="${section.id}">
            <span class="chapters-title" data-role="title">${Chapters._escape(section.title)}</span>
            <span class="chapters-actions">
                ${Chapters._iconButtonHTML('add-chapter', 'plus', Chapters._t('chapters_add_chapter', 'Добавить главу'))}
                ${Chapters._iconButtonHTML('rename', 'pencil', Chapters._t('btn_rename', 'Переименовать'))}
                ${Chapters._iconButtonHTML('delete', 'trash-2', Chapters._t('btn_delete', 'Удалить'))}
            </span>
        </div>`;
    },

    _chapterHTML(chapter) {
        const hasAnchor = chapter.anchor_message_id !== null && chapter.anchor_message_id !== undefined;
        const anchorTitle = hasAnchor
            ? Chapters._t('chapters_anchor_change', 'Перепривязать к сообщению')
            : Chapters._t('chapters_anchor_set', 'Привязать к сообщению');
        return `
        <div class="chapters-row chapters-chapter-row${hasAnchor ? '' : ' chapters-no-anchor'}" data-row-type="chapter" data-row-id="${chapter.id}" data-anchor="${hasAnchor ? chapter.anchor_message_id : ''}">
            <span class="chapters-dot" data-role="jump"></span>
            <span class="chapters-title" data-role="title" title="${Chapters._escape(chapter.title)}">${Chapters._escape(chapter.title)}</span>
            <span class="chapters-actions">
                ${Chapters._iconButtonHTML('anchor', 'crosshair', anchorTitle, hasAnchor ? 'is-on' : '')}
                ${Chapters._iconButtonHTML('rename', 'pencil', Chapters._t('btn_rename', 'Переименовать'))}
                ${Chapters._iconButtonHTML('delete', 'trash-2', Chapters._t('btn_delete', 'Удалить'))}
            </span>
        </div>`;
    },

    // --- Interactions ---

    _onPanelClick(e) {
        const btn = e.target.closest('button[data-act]');
        const row = e.target.closest('.chapters-row');
        if (btn && row) {
            e.stopPropagation();
            Chapters._handleAction(btn.dataset.act, row.dataset.rowType, parseInt(row.dataset.rowId, 10));
            return;
        }
        if (row && row.dataset.rowType === 'chapter' && e.target.closest('[data-role="title"], [data-role="jump"]')) {
            const anchor = row.dataset.anchor;
            if (anchor) Chapters.jumpTo(parseInt(anchor, 10));
        }
    },

    _handleAction(act, rowType, id) {
        if (act === 'add-chapter') {
            const tab = Chapters._activeTab();
            if (!tab) return;
            const chapterId = DB.createChapter(tab.chatId, id, Chapters._t('chapters_default_chapter', 'Новая глава'), null);
            Chapters.render();
            Chapters._startRename(chapterId, 'chapter');
            return;
        }
        if (act === 'rename') {
            Chapters._startRename(id, rowType);
            return;
        }
        if (act === 'delete') {
            const question = rowType === 'section'
                ? Chapters._t('chapters_delete_section_confirm', 'Удалить раздел и все его главы?')
                : Chapters._t('chapters_delete_chapter_confirm', 'Удалить главу?');
            if (!confirm(question)) return;
            if (rowType === 'section') DB.deleteSection(id);
            else DB.deleteChapter(id);
            Chapters.render();
            return;
        }
        if (act === 'anchor') {
            Chapters.startPick(id);
        }
    },

    _addSection() {
        const tab = Chapters._activeTab();
        if (!tab) return;
        const sectionId = DB.createSection(tab.chatId, Chapters._t('chapters_default_section', 'Новый раздел'));
        Chapters.render();
        Chapters._startRename(sectionId, 'section');
    },

    _startRename(id, rowType) {
        const row = document.querySelector(`.chapters-row[data-row-type="${rowType}"][data-row-id="${id}"]`);
        if (!row) return;
        const span = row.querySelector('[data-role="title"]');
        if (!span) return;

        const input = document.createElement('input');
        input.className = 'chapters-rename-input';
        input.type = 'text';
        input.value = span.textContent;
        span.replaceWith(input);
        input.focus();
        input.select();

        let finished = false;
        const commit = () => {
            if (finished) return;
            finished = true;
            const value = input.value.trim();
            if (value) {
                if (rowType === 'section') DB.renameSection(id, value);
                else DB.renameChapter(id, value);
            }
            Chapters.render();
        };

        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                input.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finished = true;
                Chapters.render();
            }
        });
        input.addEventListener('blur', commit);
    },

    // --- Anchor picking ---

    startPick(chapterId) {
        Chapters._pickChapterId = chapterId;
        const banner = document.getElementById('chapters-pick-banner');
        if (banner) banner.classList.remove('hidden');
        document.body.classList.add('chapters-picking');
    },

    cancelPick() {
        Chapters._pickChapterId = null;
        const banner = document.getElementById('chapters-pick-banner');
        if (banner) banner.classList.add('hidden');
        document.body.classList.remove('chapters-picking');
    },

    _onDocClickCapture(e) {
        if (!Chapters._pickChapterId) return;
        const banner = document.getElementById('chapters-pick-banner');
        if (banner && banner.contains(e.target)) return;
        const msgEl = e.target.closest ? e.target.closest('[data-msg-id]') : null;
        if (!msgEl) return;

        e.preventDefault();
        e.stopPropagation();
        const messageId = parseInt(msgEl.getAttribute('data-msg-id'), 10);
        if (!isNaN(messageId)) DB.updateChapterAnchor(Chapters._pickChapterId, messageId);
        Chapters.cancelPick();
        Chapters.render();
    },

    // --- Jump ---

    jumpTo(anchorMessageId) {
        const el = document.querySelector(`#messages-container [data-msg-id="${anchorMessageId}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('msg-anchor-flash');
        if (Chapters._flashTimer) clearTimeout(Chapters._flashTimer);
        Chapters._flashTimer = setTimeout(() => el.classList.remove('msg-anchor-flash'), 1900);
        if (window.innerWidth < 768) Chapters.close();
    },
};
