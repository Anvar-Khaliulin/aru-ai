/*
---ARU-LAB.SPACE---ALMATY---2026---
Chat operations controller managing message routing, news discussions, and LLM communication flow.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { UI } from './ui.js';
import { DB } from './db.js';
import { Search } from './search.js';
import { Heuristics } from './heuristics.js';
import { Triggers } from './triggers.js';
import { CanvasManager } from './canvas.js';
import { PluginManager } from './pluginManager.js';

export const ChatController = {
    app: null,
    init(appInstance) {
        ChatController.app = appInstance;
        window.addEventListener('resize', () => ChatController.updateTabNavigation());
    },

    loadChatsList: async () => {
        const chats = DB.getChats();
        const list = document.getElementById('chat-list');
        const t = state.translations || {};
        if (!list) return;
        list.innerHTML = chats.map(chat => `
            <div data-id="${chat.id}" onclick="app.loadChat(${chat.id})" class="chat-item p-3 mb-1 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition flex items-center justify-between group ${state.currentChatId == chat.id ? 'bg-aru-50 dark:bg-aru-900/30 border border-aru-100 dark:border-aru-800' : ''}">
                <div class="flex items-center gap-3 overflow-hidden">
                    <i data-lucide="message-circle" class="w-4 h-4 text-gray-400"></i>
                    <span class="text-sm truncate select-none">${UI.escapeHTML(chat.title) || (t.sidebar_new_chat || 'Новый чат')}</span>
                </div>
                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="event.stopPropagation(); app.renameChat(${chat.id})" class="p-1 text-gray-400 hover:text-aru-500 transition" title="${t.btn_rename || 'Rename'}">
                        <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                    </button>
                    <button onclick="event.stopPropagation(); app.deleteChat(${chat.id})" class="p-1 text-gray-400 hover:text-red-500 transition" title="${t.btn_delete || 'Delete'}">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            </div>`).join('');

        lucide.createIcons();
        ChatController.app.initChatSorting();
        ChatController.renderTabs();
    },

    renderTabs: () => {
        const bar = document.getElementById('tabs-bar');
        const navigation = document.getElementById('tabs-navigation');
        if (!bar) return;

        if (state.tabs.length === 0) {
            bar.innerHTML = '';
            if (navigation) navigation.classList.add('hidden');
            return;
        }
        if (navigation) navigation.classList.remove('hidden');

        bar.innerHTML = state.tabs.map((tab, index) => {
            const isPrivate = tab.isPrivate;
            const activeClass = state.activeTabIndex === index ? 'active bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 pb-2.5' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 pb-2';

            let tabClass = '';
            if (tab.type === 'plugin') {
                tabClass = 'text-purple-600 dark:text-purple-400 border-purple-200/50 dark:border-purple-800/50 bg-purple-50/10';
            } else if (isPrivate) {
                tabClass = 'text-blue-600 dark:text-blue-400 border-blue-200/50 dark:border-blue-800/50 bg-blue-50/10';
            }

            return `
            <div onclick="app.switchTab(${index})" class="tab-item shrink-0 px-4 py-2 text-xs font-medium rounded-t-xl border-x border-t border-transparent cursor-pointer flex items-center gap-2 group ${activeClass} ${tabClass}">
                ${tab.type === 'plugin' ? '<i data-lucide="app-window" class="w-3 h-3"></i>' : (isPrivate ? '<i data-lucide="shield-check" class="w-3 h-3"></i>' : '')}
                ${tab.isSending ? '<i data-lucide="loader-2" class="w-3 h-3 animate-spin text-aru-500"></i>' : ''}
                <span class="truncate max-w-[120px]">${UI.escapeHTML(tab.title)}</span>
                <button onclick="app.closeTab(${index}, event)" class="p-0.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 opacity-0 group-hover:opacity-100 transition-opacity">
                    <i data-lucide="x" class="w-3 h-3"></i>
                </button>
            </div>
        `}).join('');

        lucide.createIcons();
        ChatController.updateTabBadge();
        bar.onscroll = () => ChatController.updateTabNavigation();
        requestAnimationFrame(() => {
            const activeTab = bar.querySelector('.tab-item.active');
            activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            ChatController.updateTabNavigation();
        });
    },

    scrollTabs: (direction) => {
        const bar = document.getElementById('tabs-bar');
        if (!bar) return;

        const distance = Math.max(Math.round(bar.clientWidth * 0.7), 180);
        bar.scrollBy({ left: direction * distance, behavior: 'smooth' });
        window.setTimeout(() => ChatController.updateTabNavigation(), 250);
    },

    updateTabNavigation: () => {
        const bar = document.getElementById('tabs-bar');
        const navigation = document.getElementById('tabs-navigation');
        const left = document.getElementById('tabs-scroll-left');
        const right = document.getElementById('tabs-scroll-right');
        if (!bar || !navigation || !left || !right) return;

        const hasOverflow = bar.scrollWidth > bar.clientWidth + 2;
        navigation.classList.toggle('has-overflow', hasOverflow);
        left.disabled = !hasOverflow || bar.scrollLeft <= 1;
        right.disabled = !hasOverflow || bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 1;
    },

    updateTabBadge: () => {
        const badge = document.getElementById('mobile-tabs-count');
        if (!badge) return;
        const count = state.tabs.length;
        badge.textContent = count;
        badge.classList.toggle('hidden', count === 0);
    },

    toggleCanvas: (force) => {
        const panel = document.getElementById('canvas-panel');
        if (!panel) return;

        const isHidden = typeof force === 'boolean' ? !force : !panel.classList.contains('hidden');
        
        // If we're closing, just do it. If we're opening, we ideally need a tab, 
        // but let the UI toggle anyway to avoid "stuck" states.
        panel.classList.toggle('hidden', isHidden);
        
        const activeTab = state.tabs[state.activeTabIndex];
        if (activeTab) {
            activeTab.isCanvasOpen = !isHidden;
        }
    },

    renderTabCards: () => {
        const container = document.getElementById('tab-cards-container');
        if (!container) return;

        container.innerHTML = state.tabs.map((tab, index) => {
            const isPrivate = tab.isPrivate;
            let messages = [];
            if (tab.type === 'chat') {
                // Try tab.messages first (active session cache), then DB
                messages = (tab.messages && tab.messages.length > 0) ? tab.messages : (tab.chatId ? DB.getMessages(tab.chatId) : []);
            }
            const lastMsg = (messages && messages.length > 0) ? messages[messages.length - 1].content : (tab.type === 'plugin' ? 'Plugin active' : '');
            const preview = UI.escapeHTML(lastMsg).slice(0, 80) + (lastMsg.length > 80 ? '...' : '');

            const activeBorder = state.activeTabIndex === index ? 'border-aru-500 ring-2 ring-aru-100 dark:ring-aru-900/30' : 'border-gray-200 dark:border-gray-800';

            let typeBorder = '';
            let cardBg = 'bg-white dark:bg-gray-900';
            let iconBg = 'bg-aru-50 dark:bg-aru-900/20';
            let iconColor = 'text-aru-500';
            let icon = 'message-square';

            if (tab.type === 'plugin') {
                typeBorder = 'border-purple-400 dark:border-purple-600 ring-1 ring-purple-100 dark:ring-purple-900/20';
                cardBg = 'bg-purple-50/30 dark:bg-purple-950/40';
                iconBg = 'bg-purple-100 dark:bg-purple-900/40';
                iconColor = 'text-purple-600 dark:text-purple-400';
                icon = tab.icon || 'app-window';
            } else if (isPrivate) {
                typeBorder = 'border-blue-400 dark:border-blue-600 ring-1 ring-blue-100 dark:ring-blue-900/20';
                cardBg = 'bg-blue-50/30 dark:bg-blue-950/40';
                iconBg = 'bg-blue-100 dark:bg-blue-900/40';
                iconColor = 'text-blue-600 dark:text-blue-400';
                icon = 'shield-check';
            }

            return `
            <div onclick="app.switchTab(${index}); app.closeTabSwitcher();" class="tab-card ${cardBg} border ${activeBorder} ${typeBorder} rounded-3xl p-4 flex flex-col shadow-sm relative overflow-hidden transition-all active:scale-[0.98]">
                <div class="flex justify-between items-start mb-3">
                    <div class="flex items-center gap-2.5 overflow-hidden">
                        <div class="p-2 ${iconBg} rounded-xl shrink-0">
                            <i data-lucide="${icon}" class="w-5 h-5 ${iconColor}"></i>
                        </div>
                        <span class="font-bold text-sm truncate text-gray-800 dark:text-gray-100">${UI.escapeHTML(tab.title)}</span>
                    </div>
                    <button onclick="app.closeTab(${index}, event)" class="p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition shrink-0">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </button>
                </div>
                <div class="flex-1 bg-gray-50 dark:bg-gray-950/50 rounded-2xl border border-gray-100 dark:border-gray-800/50 p-3 overflow-hidden">
                    <p class="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 italic">
                        ${preview || '<span class="opacity-50">' + ((state.translations && state.translations.empty_conversation) || 'Empty conversation') + '</span>'}
                    </p>
                </div>
            </div>`;
        }).join('');

        lucide.createIcons();
        ChatController.updateTabBadge();
    },

    switchTab: async (index) => {
        if (index < 0 || index >= state.tabs.length) return;

        const previousIndex = state.activeTabIndex;
        const previousTab = previousIndex >= 0 && previousIndex < state.tabs.length ? state.tabs[previousIndex] : null;

        if (state.activeTabIndex >= 0 && state.activeTabIndex < state.tabs.length) {
            state.tabs[state.activeTabIndex].artifact = CanvasManager.currentArtifact ? { ...CanvasManager.currentArtifact } : null;
        }

        if (previousTab && previousTab.type === 'plugin' && previousIndex !== index) {
            PluginManager.handleLifecycle(previousTab.pluginId, 'deactivate', { tab: previousTab });
        }

        state.activeTabIndex = index;
        const tab = state.tabs[index];
        state.currentChatId = tab.chatId;
        localStorage.setItem('aru_last_chat', tab.chatId);

        UI.clearChat();
        ChatController.app.loadChatsList();

        const placeholder = document.getElementById('chat-placeholder');
        const msgContainer = document.getElementById('messages-container');
        const pluginViewport = document.getElementById('plugin-viewport');

        if (tab.type === 'plugin') {
            if (msgContainer) msgContainer.classList.add('hidden');
            if (placeholder) placeholder.classList.add('hidden');
            if (document.getElementById('chat-input-area')) document.getElementById('chat-input-area').classList.add('hidden');
            if (document.getElementById('btn-tools-trigger')) document.getElementById('btn-tools-trigger').classList.add('hidden');
            if (pluginViewport) {
                pluginViewport.classList.remove('hidden');
                if (pluginViewport.dataset.pluginId !== tab.pluginId) {
                    const plugin = PluginManager.getPluginDefinition(tab.pluginId);
                    if (plugin) await PluginManager.loadPluginContent(plugin, pluginViewport);
                }
            }
            PluginManager.handleLifecycle(tab.pluginId, 'activate', { tab, container: pluginViewport });
            return; // Exit early for plugins
        } else {
            if (msgContainer) msgContainer.classList.remove('hidden');
            if (pluginViewport) pluginViewport.classList.add('hidden');
            if (document.getElementById('chat-input-area')) document.getElementById('chat-input-area').classList.remove('hidden');
            if (document.getElementById('btn-tools-trigger')) document.getElementById('btn-tools-trigger').classList.remove('hidden');
        }

        if (placeholder) placeholder.classList.add('hidden');

        const messages = tab.isPrivate ? tab.messages : DB.getMessages(tab.chatId);
        messages.forEach(msg => {
            const m = { ...msg };
            m.isHTML = !!m.is_html || !!m.isHTML;
            UI.appendMessage(m);
        });

        if (tab.artifact) {
            CanvasManager.currentArtifact = { ...tab.artifact };
            CanvasManager.switchChat(tab.chatId);
            // Optionally update UI for artifact view (tabs, title)
            const tabsEl = document.getElementById('canvas-tabs');
            const showTabs = (tab.artifact.type === 'app' || tab.artifact.type === 'game' || tab.artifact.type === 'analytics');
            if (tabsEl) tabsEl.classList.toggle('hidden', !showTabs);
            document.getElementById('canvas-title-text').textContent = tab.artifact.title;
        } else {
            CanvasManager.switchChat(tab.chatId); // This will clear/hide if no container exists
        }

        // Sync Canvas visibility
        const panel = document.getElementById('canvas-panel');
        if (panel) {
            panel.classList.toggle('hidden', !tab.isCanvasOpen);
        }

        // Sync Attachments UI
        UI.renderAttachments(tab.attachments || []);

        UI.scrollToBottom();

        if (window.innerWidth < 768) {
            const sidebar = document.getElementById('sidebar');
            const backdrop = document.getElementById('sidebar-backdrop');
            if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
                sidebar.classList.add('-translate-x-full');
                if (backdrop) backdrop.classList.add('hidden');
            }
        }
    },

    closeTab: (index, event) => {
        if (event) event.stopPropagation();
        const closedTab = state.tabs[index];
        if (closedTab) CanvasManager.destroyContainer(closedTab.chatId);
        if (closedTab && closedTab.type === 'plugin') {
            PluginManager.handleLifecycle(closedTab.pluginId, 'close', { tab: closedTab, isActive: index === state.activeTabIndex });
        }

        state.tabs.splice(index, 1);
        if (state.tabs.length === 0) {
            state.activeTabIndex = -1;
            state.currentChatId = null;
            ChatController.app.loadChatsList();
            UI.clearChat();
            const placeholder = document.getElementById('chat-placeholder');
            if (placeholder) placeholder.classList.remove('hidden');
            CanvasManager.clearCanvas();
            ChatController.renderTabs(); // Sync tab bar UI
        } else {
            if (state.activeTabIndex >= index) {
                state.activeTabIndex = Math.max(0, state.activeTabIndex - 1);
            }
            ChatController.switchTab(state.activeTabIndex);
        }
        if (!document.getElementById('tab-switcher').classList.contains('hidden')) {
            ChatController.renderTabCards();
        }
    },

    openTabSwitcher: () => {
        ChatController.renderTabCards();
        document.getElementById('tab-switcher').classList.remove('hidden');
    },

    closeTabSwitcher: () => {
        document.getElementById('tab-switcher').classList.add('hidden');
    },

    initChatSorting: () => {
        const list = document.getElementById('chat-list');
        if (!list || typeof Sortable === 'undefined') return;

        Sortable.create(list, {
            animation: 150,
            ghostClass: 'bg-aru-100',
            handle: '.chat-item',
            delay: 500, // 500ms delay to allow scrolling
            delayOnTouchOnly: true,
            touchStartThreshold: 5,
            onEnd: function (evt) {
                const items = list.querySelectorAll('.chat-item');
                items.forEach((el, index) => {
                    const id = el.getAttribute('data-id');
                    // autoSave=false for batch update
                    DB.updateChatOrder(id, index, false);
                });
                DB.save(); // Single save after all updates
            },
        });
    },

    renameChat: async (id) => {
        const chats = DB.getChats();
        const chat = chats.find(c => c.id == id);
        if (!chat) return;
        const t = state.translations || {};
        const newTitle = prompt(t.prompt_rename_chat || 'Enter new chat title:', chat.title);
        if (newTitle && newTitle.trim()) {
            DB.updateChatTitle(id, newTitle.trim());
            const tab = state.tabs.find(t => t.chatId == id);
            if (tab) tab.title = newTitle.trim();
            ChatController.app.loadChatsList();
        }
    },

    newChat: async (isPrivate = false) => {
        const t = state.translations || {};
        let title = t.sidebar_new_chat || 'Новый чат';
        let id;

        if (isPrivate) {
            id = 'ephemeral-' + Date.now();
            title = t.private_chat_title || 'Приватный чат';
            state.tabs.push({
                chatId: id,
                type: 'chat',
                title: title,
                artifact: null,
                isSending: false,
                isCanvasOpen: false,
                attachments: [],
                isSearchEnabled: false,
                isPrivate: true,
                messages: []
            });
        } else {
            id = DB.createChat(title);
            state.tabs.push({
                chatId: id,
                type: 'chat',
                title: title,
                artifact: null,
                isSending: false,
                isCanvasOpen: false,
                attachments: [],
                isSearchEnabled: false,
                isPrivate: false,
                messages: null
            });
        }

        await ChatController.switchTab(state.tabs.length - 1);
        if (ChatController.app.updateSearchUI) ChatController.app.updateSearchUI();
    },

    loadChat: async (id) => {
        if (id === null || id === undefined) return;
        const existingTabIndex = state.tabs.findIndex(t => t.chatId == id);
        if (existingTabIndex !== -1) {
            await ChatController.switchTab(existingTabIndex);
            return;
        }
        const chat = DB.getChats().find(c => c.id == id);
        if (!chat) return;
        state.tabs.push({ chatId: id, type: 'chat', title: chat.title || 'Chat', artifact: null, isSending: false, isCanvasOpen: false, attachments: [] });
        await ChatController.switchTab(state.tabs.length - 1);
    },

    deleteChat: async (id) => {
        const t = state.translations || {};
        if (!confirm(t.confirm_delete_chat || 'Удалить этот чат?')) return;
        const tabIndex = state.tabs.findIndex(t => t.chatId == id);
        if (tabIndex !== -1) {
            state.tabs.splice(tabIndex, 1);
            if (state.activeTabIndex >= tabIndex) {
                state.activeTabIndex = Math.max(-1, state.activeTabIndex - 1);
            }
        }
        if (id && !id.toString().startsWith('ephemeral-')) {
            DB.deleteChat(id);
        }
        if (state.currentChatId == id) {
            state.currentChatId = null;
            localStorage.removeItem('aru_last_chat');
            UI.clearChat();
            if (state.tabs.length > 0) {
                if (state.activeTabIndex === -1) state.activeTabIndex = 0;
                ChatController.switchTab(state.activeTabIndex);
                // ChatLock removed
                const placeholder = document.getElementById('chat-placeholder');
                if (placeholder) placeholder.classList.remove('hidden');
                CanvasManager.clearCanvas();
            }
        }
        ChatController.app.loadChatsList();
        ChatController.renderTabs(); // Sync tab bar UI after deletion
    },

    sendMessage: async (e) => {
        if (e) e.preventDefault();

        // Auto-create chat if none exists
        if (state.currentChatId === null || state.tabs.length === 0) {
            await ChatController.newChat();
        }

        const targetChatId = state.currentChatId;
        const activeTab = state.tabs.find(t => t.chatId == targetChatId);

        if (!activeTab || activeTab.isSending) return;

        const input = document.getElementById('prompt-input');
        const text = input.value.trim();
        const attachments = [...(activeTab.attachments || [])];

        if (!text && attachments.length === 0) return;

        activeTab.isSending = true;
        ChatController.renderTabs(); // Show loading in tab

        // Clear input and tab attachments
        input.value = ''; input.style.height = '';
        activeTab.attachments = [];
        UI.renderAttachments([]);

        try {
            Heuristics.adjustMood(text);
            ChatController.app.updateSystemPrompt();
            input.value = ''; input.style.height = '';

            const placeholder = document.getElementById('chat-placeholder');
            if (placeholder && targetChatId === state.currentChatId) placeholder.classList.add('hidden');

            if (targetChatId === state.currentChatId) {
                UI.appendMessage({ role: 'user', content: text });
                UI.showTyping();
            }

            if (!activeTab.isPrivate) {
                DB.saveMessage(targetChatId, 'user', text);
            } else {
                activeTab.messages.push({ role: 'user', content: text });
            }

            let searchContext = '';
            if (activeTab.isSearchEnabled) {
                console.log("Grounding: Web Search active, querying...");
                try {
                    const snippets = await Search.query(text);
                    if (snippets) {
                        const prefix = state.translations.search_prefix || "According to search results:";
                        searchContext = `\n\n[SYSTEM: WEB SEARCH RESULTS]\n${snippets}\n\nINSTRUCTION: Using ONLY the search results provided above, generate a helpful answer. MUST start your response with "${prefix}". If results are completely irrelevant, still use the prefix but explain you found nothing specifically matching.`;
                        console.log("Grounding: Results injected into context");
                    }
                } catch (e) { console.error("Grounding: Search failed", e); }
            }

            const context = await Triggers.getRelevantContext(text);
            const recall = await Triggers.processRecallModules(text);
            let toSend = text;
            if (context) toSend = `[SYSTEM_MEMORY_CONTEXT]\n${context}\n[/SYSTEM_MEMORY_CONTEXT]\n\nUser: ${text}`;
            if (searchContext) toSend = `${searchContext}\n\n${toSend}`;
            if (recall) toSend = `[RECALL: ${recall}]\n\n${toSend}`;

            // Per-tab artifact context
            if (activeTab.artifact) {
                const art = activeTab.artifact;
                toSend = `[CURRENT_CANVAS_ARTIFACT type="${art.type}" title="${art.title}"]\n${art.code}\n[/CURRENT_CANVAS_ARTIFACT]\n\nUser: ${toSend}`;
            }

            // Include local attachments in the prompt
            if (attachments && attachments.length > 0) {
                let attachmentPayload = "";
                attachments.forEach(file => {
                    attachmentPayload += `[ATTACHED_FILE: ${file.name}]\n${file.content}\n[/ATTACHED_FILE]\n`;
                });
                toSend = `${attachmentPayload}\n${toSend}`;
            }

            const allMessages = activeTab.isPrivate ? activeTab.messages : DB.getMessages(targetChatId);
            const contextLimit = parseInt(state.userSettings.token_limit) || 2048;
            const history = ChatController.app.buildContextHistory(
                allMessages.slice(0, -1),
                ChatController.app.tokenEstimator(ChatController.app.llm.systemInstruction),
                ChatController.app.tokenEstimator(toSend),
                contextLimit
            );

            const raw = await ChatController.app.llm.sendMessage(history, toSend);
            const responseAfterMemoryCheck = await Triggers.processResponseForMemory(raw, activeTab.isPrivate);
            const responseAfterTasks = await Triggers.processResponseForTasks(responseAfterMemoryCheck, activeTab.isPrivate);
            const emotion = Heuristics.determineEmotion(responseAfterTasks, { userText: text });
            const artifactsProcessed = await Triggers.processResponseForArtifacts(responseAfterTasks);
            const finalHtml = await Triggers.processResponseForTools((typeof marked !== 'undefined') ? marked.parse(artifactsProcessed) : artifactsProcessed);

            if (targetChatId === state.currentChatId) {
                UI.hideTyping();
                UI.appendMessage({ role: 'model', content: finalHtml, emotion: emotion, isHTML: true });
            }

            if (!activeTab.isPrivate) {
                DB.saveMessage(targetChatId, 'model', finalHtml, emotion, 1);
            } else {
                activeTab.messages.push({ role: 'model', content: finalHtml, emotion: emotion, isHTML: true });
            }

            if (!activeTab.isPrivate) {
                const count = DB.query("SELECT COUNT(*) as c FROM messages WHERE chat_id = ?", [targetChatId])[0].c;
                if (count <= 2) {
                    const title = text.slice(0, 30) + (text.length > 30 ? '...' : '');
                    DB.updateChatTitle(targetChatId, title);
                    activeTab.title = title;
                    ChatController.app.loadChatsList();
                }
            } else {
                if (activeTab.messages.length <= 2) {
                    const title = text.slice(0, 30) + (text.length > 30 ? '...' : '');
                    activeTab.title = title;
                    ChatController.renderTabs();
                }
            }
        } catch (err) {
            if (targetChatId === state.currentChatId) {
                UI.hideTyping();
                UI.appendMessage({ role: 'model', content: `**Error:** ${err.message}`, emotion: 'sad' });
            }
            console.error(err);
        } finally {
            activeTab.isSending = false;
            ChatController.renderTabs();
        }
    },

    discussNewsFromEl: (el) => {
        try {
            const parent = el.closest('[data-news-title]');
            if (!parent) return;
            const title = parent.dataset.newsTitle || '';
            const link = parent.dataset.newsLink ? decodeURIComponent(parent.dataset.newsLink) : '';
            const desc = parent.dataset.newsDesc || '';
            const full = parent.dataset.newsFull ? decodeURIComponent(parent.dataset.newsFull) : '';
            ChatController.discussNews(title, link, desc, full);
        } catch (e) {
            console.error('discussNewsFromEl failed', e);
        }
    },

    /**
     * Prepare prompt for discussing a news item and send it as a user message.
     */
    discussNews: async (title, link, desc, fullText) => {
        let targetChatId = state.currentChatId;
        if (!targetChatId) {
            const id = DB.createChat(state.translations?.sidebar_new_chat || 'New Chat');
            state.tabs.push({ chatId: id, type: 'chat', title: title.slice(0, 20), artifact: null, isSending: false });
            await ChatController.switchTab(state.tabs.length - 1);
            targetChatId = id;
        }

        const activeTab = state.tabs.find(t => t.chatId == targetChatId);
        if (!activeTab || activeTab.isSending) return;

        const visibleText = `#### [${title}](${link})\n\n${fullText || desc || ''}`;
        if (targetChatId === state.currentChatId) UI.appendMessage({ role: 'user', content: visibleText });

        const payload = `[[NEWS_FULL]]\n${fullText || desc || ''}\n[[/NEWS_FULL]]\n${title}`;
        DB.saveMessage(targetChatId, 'user', payload);

        activeTab.isSending = true;
        ChatController.renderTabs();

        try {
            if (targetChatId === state.currentChatId) UI.showTyping();
            let toSend = payload;
            const context = await Triggers.getRelevantContext(title);
            if (context) toSend = `[SYSTEM_MEMORY_CONTEXT]\n${context}\n[/SYSTEM_MEMORY_CONTEXT]\n\nUser: ${toSend}`;

            if (activeTab.artifact) {
                const art = activeTab.artifact;
                toSend = `[CURRENT_CANVAS_ARTIFACT type="${art.type}" title="${art.title}"]\n${art.code}\n[/CURRENT_CANVAS_ARTIFACT]\n\nUser: ${toSend}`;
            }

            const allMessages = DB.getMessages(targetChatId);
            const contextLimit = parseInt(state.userSettings.token_limit) || 2048;
            const history = ChatController.app.buildContextHistory(
                allMessages.slice(0, -1),
                ChatController.app.tokenEstimator(ChatController.app.llm.systemInstruction),
                ChatController.app.tokenEstimator(toSend),
                contextLimit
            );
            const raw = await ChatController.app.llm.sendMessage(history, toSend);
            const responseAfterMemoryCheck = await Triggers.processResponseForMemory(raw);
            const responseAfterTasks = await Triggers.processResponseForTasks(responseAfterMemoryCheck, false);
            const emotion = Heuristics.determineEmotion(responseAfterTasks, { userText: payload });
            const artifactsProcessed = await Triggers.processResponseForArtifacts(responseAfterTasks);
            const finalHtml = await Triggers.processResponseForTools(typeof marked !== 'undefined' ? marked.parse(artifactsProcessed) : artifactsProcessed);

            if (targetChatId === state.currentChatId) {
                UI.hideTyping();
                UI.appendMessage({ role: 'model', content: finalHtml, emotion: emotion, isHTML: true });
            }
            DB.saveMessage(targetChatId, 'model', finalHtml, emotion, 1);
        } catch (err) {
            if (targetChatId === state.currentChatId) {
                UI.hideTyping();
                UI.appendMessage({ role: 'model', content: `**Error:** ${err.message}`, emotion: 'sad' });
            }
            console.error(err);
        } finally {
            activeTab.isSending = false;
            ChatController.renderTabs();
        }
    },
    searchChats: (query) => {
        const q = (query || '').toLowerCase().trim();
        const items = document.querySelectorAll('.chat-item');
        items.forEach(el => {
            const title = el.querySelector('span')?.innerText.toLowerCase() || '';
            if (title.includes(q)) {
                el.classList.remove('hidden');
                el.classList.add('flex');
            } else {
                el.classList.add('hidden');
                el.classList.remove('flex');
            }
        });
    },
};
