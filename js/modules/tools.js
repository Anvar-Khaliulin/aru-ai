/*
---ARU-LAB.SPACE---ALMATY---2026---
External tool integrator fetching and parsing dynamic data such as weather API results and RSS news feeds.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { Network } from './network.js';

export const Tools = {

    // --- WEATHER ---
    async getWeatherCard(locationName = 'Almaty') {
        try {
            const langParam = (state.lang || 'ru').split('-')[0];
            const geoRes = await Network.fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationName)}&count=1&language=${langParam}&format=json`, {}, 'cors_safe');
            const geoData = await geoRes.json();

            const labelsMap = {
                kk: { wind: 'Жел', error: 'Қала табылмады', fail: 'Қате', now: 'Қазір', humidity: 'Ылғал', forecast: 'болжам' },
                ru: { wind: 'Ветер', error: 'Город не найден', fail: 'Ошибка', now: 'Сейчас', humidity: 'Влажн', forecast: 'прогноз' },
                en: { wind: 'Wind', error: 'City not found', fail: 'Error', now: 'Now', humidity: 'Humidity', forecast: 'forecast' }
            };
            const labels = labelsMap[langParam] || labelsMap.ru;

            if (!geoData.results || !geoData.results.length) {
                return `<div class="p-3 bg-red-50 dark:bg-red-900/10 text-red-500 rounded-xl text-xs flex items-center gap-2"><i data-lucide="alert-circle" class="w-4 h-4"></i> ${Tools._esc(labels.error)}: ${Tools._esc(locationName)}</div>`;
            }

            const { latitude, longitude, name, country } = geoData.results[0];
            const weatherRes = await Network.fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4`, {}, 'cors_safe');
            const wData = await weatherRes.json();
            const current = wData.current;
            const daily = wData.daily;

            const getIcon = (code) => {
                if (code === 0) return 'sun';
                if (code < 3) return 'cloud-sun';
                if (code < 50) return 'cloud';
                if (code < 80) return 'cloud-rain';
                return 'cloud-lightning';
            };

            let forecastHtml = '';
            for (let i = 1; i < 4; i++) {
                const date = new Date(daily.time[i] + 'T12:00:00');
                const dayName = date.toLocaleDateString(state.lang || langParam, { weekday: 'short' });
                forecastHtml += `
                <div class="flex flex-col items-center p-2 rounded-xl bg-gray-50/50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50">
                    <span class="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">${Tools._esc(dayName)}</span>
                    <i data-lucide="${getIcon(daily.weather_code[i])}" class="w-5 h-5 text-aru-500 mb-1"></i>
                    <span class="text-xs font-bold text-gray-800 dark:text-gray-100">${Math.round(daily.temperature_2m_max[i])}°</span>
                </div>`;
            }

            const safeName = Tools._esc(name || locationName);
            const safeCountry = Tools._esc(country || '');
            const safeWindUnit = Tools._esc(wData.current_units?.wind_speed_10m || '');

            return `
            <div class="my-4 max-w-sm bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-5 shadow-xl animate-fade-in relative overflow-hidden">
                <div class="absolute -top-12 -right-12 w-32 h-32 bg-aru-500/10 rounded-full blur-3xl"></div>
                
                <div class="flex justify-between items-center mb-6 relative z-10">
                    <div>
                        <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                            <i data-lucide="map-pin" class="w-4 h-4 text-aru-500"></i> ${safeName}
                        </h3>
                        <p class="text-[10px] text-gray-400 uppercase tracking-widest font-bold mt-0.5">${safeCountry}</p>
                    </div>
                    <div class="text-right">
                        <span class="text-3xl font-black text-aru-500">${Math.round(current.temperature_2m)}°</span>
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-3 mb-4 relative z-10">
                    ${forecastHtml}
                </div>

                <div class="flex justify-between items-center text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-4 pt-4 border-t border-gray-50 dark:border-gray-800 relative z-10 px-1">
                    <span class="flex items-center gap-1.5"><i data-lucide="wind" class="w-3 h-3 text-blue-400"></i> ${current.wind_speed_10m} ${safeWindUnit}</span>
                    <span class="flex items-center gap-1.5"><i data-lucide="droplets" class="w-3 h-3 text-blue-400"></i> ${current.relative_humidity_2m}%</span>
                </div>
            </div>`;

        } catch (e) {
            console.error(e);
            return `<div class="p-3 bg-red-50 dark:bg-red-900/10 text-red-500 rounded-xl text-xs flex items-center gap-2"><i data-lucide="alert-triangle"></i> Weather API Error</div>`;
        }
    },

    // --- TASK BOARD ---
    async getTasksCard(projectQuery = '') {
        const plugin = window.TaskPlugin;
        const t = (key, fallback) => {
            const raw = window.PluginManager ? window.PluginManager.getTranslation(key) : key;
            return (raw && raw !== key) ? raw : fallback;
        };

        if (!plugin || !plugin.state || !Array.isArray(plugin.state.projects) || plugin.state.projects.length === 0) {
            return `<div class="p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 rounded-xl text-gray-500 text-xs flex items-center gap-2"><i data-lucide="folder-kanban"></i> ${t('task_show_no_projects', 'No projects yet. Ask Aru to create one.')}</div>`;
        }

        const query = (projectQuery || '').trim().toLowerCase();
        let projects = plugin.state.projects;
        if (query) {
            const filtered = projects.filter(p => p.name.toLowerCase().includes(query));
            if (filtered.length > 0) projects = filtered;
        }

        const DONE_COL_RX = /готов|done|выполнен(?:о|ы|а|ные|ный|ная)|заверш|сделан|дайын|аяқтал|complete|finish/i;
        const palette = ['bg-aru-500', 'bg-amber-400', 'bg-emerald-500', 'bg-sky-500', 'bg-rose-500', 'bg-violet-500'];

        let html = `<div class="my-4 space-y-3 animate-fade-in" data-tasks-card>`;

        for (const p of projects) {
            const cols = Array.isArray(p.columns) ? p.columns : [];
            const allTasks = cols.flatMap(c => c.tasks || []);
            html += `
            <div class="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-4 shadow-xl overflow-hidden" data-tasks-project="${Tools._esc(p.name)}">
                <div class="flex items-center justify-between gap-2 mb-3">
                    <h3 class="font-bold text-sm text-gray-800 dark:text-gray-100 flex items-center gap-2 min-w-0">
                        <i data-lucide="folder-kanban" class="w-4 h-4 text-aru-500 shrink-0"></i>
                        <span class="truncate">${Tools._esc(p.name)}</span>
                    </h3>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <span class="text-[9px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 dark:bg-gray-800 px-2 py-1 rounded-lg border border-gray-100 dark:border-gray-800">${allTasks.length} ${t('task_count_' + Tools._pluralForm(allTasks.length, state.lang), 'tasks')}</span>
                        <button type="button" class="text-[10px] font-bold text-aru-500 hover:underline px-2 py-1 rounded-lg bg-aru-50/70 dark:bg-aru-900/20" data-task-card-action="open-board" data-project-id="${Tools._esc(p.id)}">${Tools._esc(t('task_open_board', 'Open'))}</button>
                    </div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    ${cols.map((c, ci) => {
                        const isDoneCol = cols.length > 1 && DONE_COL_RX.test(String(c.title || ''));
                        return `
                        <div class="rounded-2xl bg-gray-50/70 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 p-3" data-tasks-column="${Tools._esc(c.title)}">
                            <div class="flex items-center gap-2 mb-2">
                                <span class="w-2 h-2 rounded-full ${isDoneCol ? 'bg-emerald-500' : palette[ci % palette.length]}"></span>
                                <span class="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 truncate">${Tools._esc(c.title)}</span>
                                <span class="ml-auto text-[10px] font-bold text-gray-300 dark:text-gray-600">${(c.tasks || []).length}</span>
                            </div>
                            <div class="space-y-2">
                                ${(c.tasks && c.tasks.length) ? c.tasks.map(task => Tools._renderTaskRow(task, t, { isDoneCol, projectId: p.id, colId: c.id })).join('') : `<p class="text-[10px] text-gray-300 dark:text-gray-600 italic">&mdash;</p>`}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        html += `</div>`;
        return html;
    },

    // Count word form: ru uses 1/2-4/5+ rules, kk keeps a single form after numerals
    _pluralForm(n, lang) {
        const l = String(lang || 'en').split('-')[0];
        if (l === 'ru') {
            const m10 = Math.abs(n) % 10, m100 = Math.abs(n) % 100;
            if (m10 === 1 && m100 !== 11) return 'one';
            if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'few';
            return 'many';
        }
        if (l === 'kk') return 'many';
        return n === 1 ? 'one' : 'many';
    },

    _renderTaskRow(task, t, ctx = {}) {
        const isDone = Boolean(task && task.done) || !!ctx.isDoneCol;
        const dl = Tools._parseTaskDate(task.deadline);
        const hasTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(String(task.deadline || '').trim());
        let badge = '';
        if (dl) {
            const isOverdue = !isDone && dl.getTime() < Date.now();
            const isToday = !isDone && !isOverdue && dl.toDateString() === new Date().toDateString();
            const cls = isDone
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                : (isOverdue
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-500'
                    : (isToday ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600' : 'bg-gray-100/70 dark:bg-gray-800 text-gray-400'));
            const dlLabel = hasTime
                ? dl.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                : dl.toLocaleDateString([], { dateStyle: 'short' });
            badge = `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${cls}">
                <i data-lucide="clock" class="w-2.5 h-2.5"></i>
                ${Tools._esc(dlLabel)}
            </span>`;
        }
        const prioColors = { urgent: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-amber-400', low: 'bg-blue-400' };
        const prioDot = (task.priority && prioColors[task.priority])
            ? `<span class="w-1.5 h-1.5 rounded-full ${prioColors[task.priority]} shrink-0 mt-1.5" title="${Tools._esc(task.priority)}"></span>`
            : '';
        const subs = Array.isArray(task.subtasks) ? task.subtasks : [];
        const subBadge = subs.length
            ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-gray-100/70 dark:bg-gray-800 text-gray-500">${subs.filter(s => s && s.done).length}/${subs.length}</span>`
            : '';
        const tags = (Array.isArray(task.tags) ? task.tags.slice(0, 3) : [])
            .map(tag => `<span class="inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-aru-50 dark:bg-aru-900/30 text-aru-600 dark:text-aru-300">#${Tools._esc(tag)}</span>`).join('');
        const checkBtn = (ctx.projectId && ctx.colId && task.id)
            ? `<button type="button" class="w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 transition ${isDone ? 'is-checked bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 dark:border-gray-600 text-transparent hover:border-emerald-500'}" data-task-card-action="toggle-done" data-project-id="${Tools._esc(ctx.projectId)}" data-col-id="${Tools._esc(ctx.colId)}" data-task-id="${Tools._esc(task.id)}" aria-label="${Tools._esc(t('task_mark_done', 'Done'))}"><i data-lucide="check" class="w-2.5 h-2.5"></i></button>`
            : '';

        return `
            <div class="p-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm ${isDone ? 'is-done opacity-75' : ''}" data-task-row data-task-title="${Tools._esc(task.title)}">
                <div class="flex items-start gap-1.5">
                    ${checkBtn}${prioDot}
                    <p class="text-[11px] font-bold leading-snug min-w-0 flex-1 ${isDone ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-200'}">${Tools._esc(task.title)}</p>
                </div>
                ${task.desc ? `<p class="text-[10px] text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">${Tools._esc(task.desc)}</p>` : ''}
                ${(badge || subBadge || tags) ? `<div class="mt-1.5 flex flex-wrap items-center gap-1">${badge}${subBadge}${tags}</div>` : ''}
            </div>`;
    },

    // Local-time parse: date-only values default to 23:59:59 so end-of-day
    // tasks on today are never flipped to overdue at noon (matching Dashboard & TaskPlugin).
    _parseTaskDate(raw) {
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(raw || '').trim());
        if (!m) return null;
        const hasTime = m[4] !== undefined;
        return new Date(+m[1], +m[2] - 1, +m[3], hasTime ? +m[4] : 23, hasTime ? +m[5] : 59, hasTime ? 0 : 59, hasTime ? 0 : 999);
    },

    _esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    _safeUrl(value) {
        const raw = String(value == null ? '' : value).trim();
        return /^https?:\/\//i.test(raw) ? raw : '';
    },

    // --- NEWS RSS ---
    async getNewsCard(rssRawList, filterTag = '') {
        if (!rssRawList || rssRawList.length === 0) {
            return `<div class="p-3 bg-gray-50 dark:bg-gray-800/50 border rounded-xl text-gray-500 text-xs flex items-center gap-2"><i data-lucide="rss"></i> ${state.translations?.msg_rss_empty || 'Add RSS feeds in settings'}</div>`;
        }

        const feeds = rssRawList.map(item => {
            const parts = item.split('#').map(s => s.trim());
            return { url: Tools._normalizeFeedUrl(parts[0]), tag: parts.slice(1).filter(Boolean).join(' ') };
        }).filter(f => f.url);

        const currentLang = state.lang || 'ru';
        let targetFeeds = feeds;

        if (filterTag) {
            const normalizedFilter = filterTag.toLowerCase().replace('#', '');
            targetFeeds = feeds.filter(f => {
                const normalizedTag = f.tag.toLowerCase().replace('#', '');
                return normalizedTag.includes(normalizedFilter);
            });

            // Fallback protocol: Bypasses filters if specific constraints return empty datasets
            if (targetFeeds.length === 0) {
                console.log(`Tools: No matches for tag "${filterTag}", falling back to all news from relevant feeds.`);
                targetFeeds = feeds;
            }
        } else {
            const langCode = String(currentLang).toLowerCase().split('-')[0];
            const langFeeds = feeds.filter(f => f.tag.toLowerCase().split(/[\s,#]+/).filter(Boolean).includes(langCode));
            if (langFeeds.length > 0) targetFeeds = langFeeds;
        }

        if (targetFeeds.length === 0) targetFeeds = feeds;

        let html = `<div class="my-4 grid grid-cols-1 gap-3 animate-fade-in">`;
        let count = 0;
        let feedErrors = 0;

        for (const feed of targetFeeds) {
            if (count >= 10) break; // Global cap across all feeds
            try {
                console.log(`Tools: Fetching feed ${feed.url} (Tag: ${feed.tag})`);
                const items = await Tools._fetchFeedItems(feed.url);
                console.log(`Tools: Found ${items.length} items in ${feed.url}`);

                for (const item of items) {
                    if (count >= 10) break;

                    const title = item.title;
                    const link = item.link;
                    const desc = item.desc;
                    const imgUrl = item.imgUrl;

                    // Sanitizes HTML elements from string payload and truncates text for safe UI preview rendering
                    const cleanText = Tools._stripHtml(desc);
                    const cleanDesc = cleanText.slice(0, 150) + (cleanText.length > 150 ? '...' : '');

                    // Prepare safe full text for data attribute (URI-encoded, HTML stripped)
                    const safeFull = encodeURIComponent(Tools._stripHtml(item.full));

                    const source = new URL(feed.url).hostname.replace('www.', '');

                    // Generates an isolated DOM wrapper component to encapsulate data tags and interactive actions safely
                    const safeTitle = Tools._esc(String(title || '').replace(/\n/g, ' '));
                    const safeLink = encodeURIComponent(link || '');
                    const safeDesc = Tools._esc(String(cleanDesc || '').replace(/\n/g, ' '));
                    const safeHref = Tools._esc(Tools._safeUrl(link));
                    const safeImg = Tools._esc(Tools._safeUrl(imgUrl));

                    html += `
                    <div class="flex gap-3 p-3 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl hover:border-aru-400 hover:shadow-lg transition-all group overflow-hidden" 
                         data-news-title="${safeTitle}" 
                         data-news-link="${safeLink}" 
                         data-news-desc="${safeDesc}" 
                         data-news-full="${safeFull}">
                        ${safeImg ? `
                        <div class="w-20 h-20 flex-shrink-0 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-700">
                            <img src="${safeImg}" class="w-full h-full object-cover transition-transform group-hover:scale-110" onerror="this.remove()">
                        </div>` : ''}
                        <div class="flex-1 min-w-0">
                            <h4 class="font-bold text-gray-800 dark:text-gray-100 text-xs mb-1 line-clamp-2 leading-relaxed group-hover:text-aru-600">${safeTitle}</h4>
                            <p class="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">${safeDesc}</p>
                            <div class="flex items-center gap-2 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                                <span class="flex items-center gap-1 bg-gray-50 dark:bg-gray-900 px-1.5 py-0.5 rounded-lg border border-gray-100 dark:border-gray-800">
                                    <i data-lucide="rss" class="w-2.5 h-2.5"></i> ${Tools._esc(source)}
                                </span>
                            </div>
                        </div>
                        <div class="flex-shrink-0 flex flex-col justify-center items-center gap-2">
                            <a href="${safeHref || '#'}" target="_blank" rel="noopener noreferrer" class="p-2 text-gray-400 hover:text-aru-500 rounded-lg transition hover:bg-gray-50 dark:hover:bg-gray-700" title="${state.translations?.action_open || 'Open'}">
                                <i data-lucide="external-link" class="w-4 h-4"></i>
                            </a>
                            <button onclick="window.app.discussNewsFromEl(this)" class="p-2 bg-aru-500 hover:bg-aru-600 text-white rounded-lg transition shadow-md hover:scale-105" title="${state.translations?.news_discuss_btn || 'Discuss'}">
                                <i data-lucide="message-circle" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>`;
                    count++;
                }
            } catch (e) {
                feedErrors++;
                console.warn(`Tools: RSS Feed failed for ${feed.url}`, e);
            }
        }
        html += `</div>`;

        if (count === 0) {
            if (feedErrors > 0) {
                return `<div class="p-4 text-center text-gray-400 text-xs italic">${state.translations?.msg_rss_unreachable || 'Could not load the feeds. Check your internet, feed URLs, or network settings.'}</div>`;
            }
            return `<div class="p-4 text-center text-gray-400 text-xs italic">${state.translations?.msg_rss_no_news || 'No news found'}</div>`;
        }

        return html;
    },

    // --- RSS HELPERS ---

    _normalizeFeedUrl(raw) {
        const s = (raw || '').trim();
        if (!s || /^https?:\/\//i.test(s)) return s;
        let hostname = '';
        try {
            hostname = new URL(`http://${s}`).hostname.toLowerCase();
        } catch (e) {
            return s;
        }
        const isLocal = Network._isLoopback(hostname) || Network._isPrivateNetwork(hostname);
        return `${isLocal ? 'http' : 'https'}://${s}`;
    },

    async _fetchFeedItems(feedUrl) {
        const strategy = (state.userSettings || {}).proxy_strategy || 'auto';

        // In auto mode prefer rss2json: it parses the feed server-side and also
        // rescues feeds that do not send CORS headers.
        if (strategy === 'auto') {
            try {
                return await Tools._fetchFeedViaRss2Json(feedUrl);
            } catch (e) {
                console.warn(`Tools: rss2json failed for ${feedUrl}, falling back to raw feed`, e);
            }
        }

        const xmlText = await Tools._fetchFeedXml(feedUrl);
        return Tools._parseFeedXml(xmlText, feedUrl);
    },

    async _fetchFeedViaRss2Json(feedUrl) {
        const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let res;
        try {
            res = await Network.fetch(apiUrl, { signal: controller.signal }, 'cors_safe');
        } finally {
            clearTimeout(timer);
        }
        if (!res.ok) throw new Error(`rss2json HTTP ${res.status}`);

        const data = await res.json();
        if (data.status !== 'ok' || !Array.isArray(data.items)) {
            throw new Error(`rss2json error: ${data.message || data.status}`);
        }

        return data.items.map(it => {
            const desc = it.description || '';
            return {
                title: it.title || 'No Title',
                link: it.link || '#',
                desc: desc,
                full: it.content || desc,
                imgUrl: it.thumbnail || it.enclosure?.link || Tools._firstImage(desc) || ''
            };
        });
    },

    async _fetchFeedXml(feedUrl) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        let res;
        try {
            res = await Network.fetch(feedUrl, { signal: controller.signal }, 'cors_unsafe');
        } finally {
            clearTimeout(timer);
        }
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.text();
    },

    _parseFeedXml(xmlText, feedUrl) {
        const xmlDoc = new DOMParser().parseFromString(xmlText, 'text/xml');
        const parseError = xmlDoc.getElementsByTagName('parsererror');
        if (parseError.length > 0) {
            throw new Error(`Invalid XML from ${feedUrl}`);
        }

        // Supports data normalization for both standard RSS (item) and Atom (entry) feeds
        let nodes = xmlDoc.querySelectorAll('item');
        let isAtom = false;
        if (nodes.length === 0) {
            nodes = xmlDoc.querySelectorAll('entry');
            isAtom = true;
        }

        const items = [];
        for (const node of nodes) {
            let title = '', link = '#', desc = '', full = '', imgUrl = '';

            if (isAtom) {
                // Atom Format
                title = node.querySelector('title')?.textContent || 'No Title';
                // Atom links are usually <link href="..."/>
                const linkNode = node.querySelector("link[rel='alternate']") || node.querySelector("link:not([rel])") || node.querySelector('link');
                link = linkNode ? (linkNode.getAttribute('href') || linkNode.textContent) : '#';

                const summary = node.querySelector('summary')?.textContent || '';
                const content = node.querySelector('content')?.textContent || '';
                desc = summary || content || '';
                full = content || summary;
            } else {
                // RSS Format
                title = node.querySelector('title')?.textContent || 'No Title';
                link = node.querySelector('link')?.textContent || '#';
                const contentEncoded = node.getElementsByTagName('content:encoded')[0];
                const description = node.querySelector('description')?.textContent || '';
                desc = description;
                full = contentEncoded?.textContent || description;
            }

            // Analyzes enclosure targets to identify optimal image thumbnails
            const enclosure = node.querySelector("enclosure[type^='image']");
            if (enclosure) imgUrl = enclosure.getAttribute('url') || '';

            if (!imgUrl) {
                const mediaContent = node.getElementsByTagName('media:content')[0] || node.getElementsByTagName('content')[0];
                if (mediaContent) imgUrl = mediaContent.getAttribute('url') || '';
            }

            if (!imgUrl) imgUrl = Tools._firstImage(desc) || '';

            items.push({ title, link, desc, full, imgUrl });
        }
        return items;
    },

    _firstImage(html) {
        const m = (html || '').match(/<img[^>]+src="([^">]+)"/);
        return m ? m[1] : '';
    },

    // --- DASHBOARD STRUCTURED FETCHERS (with in-memory TTL caches) ---

    _weatherCache: new Map(),
    _newsCache: new Map(),

    clearWeatherCache() {
        this._weatherCache.clear();
    },

    clearNewsCache() {
        this._newsCache.clear();
    },

    async fetchWeatherData(locationName = 'Almaty', { force = false } = {}) {
        const city = String(locationName || 'Almaty').trim() || 'Almaty';
        const langParam = String(state.lang || 'ru').split('-')[0].toLowerCase();
        const cacheKey = `${langParam}:${city.toLowerCase()}`;
        const TTL_MS = 20 * 60 * 1000;

        if (!force) {
            const cached = this._weatherCache.get(cacheKey);
            if (cached && (Date.now() - cached.ts) < TTL_MS) {
                return cached.data;
            }
        }

        const geoRes = await Network.fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=${langParam}&format=json`,
            {},
            'cors_safe'
        );
        if (!geoRes.ok) throw new Error(`Geocoding HTTP ${geoRes.status}`);
        const geoData = await geoRes.json();

        if (!geoData.results || !geoData.results.length) {
            const err = new Error('CITY_NOT_FOUND');
            err.code = 'CITY_NOT_FOUND';
            throw err;
        }

        const { latitude, longitude, name, country } = geoData.results[0];
        const weatherRes = await Network.fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&hourly=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`,
            {},
            'cors_safe'
        );
        if (!weatherRes.ok) throw new Error(`Forecast HTTP ${weatherRes.status}`);
        const wData = await weatherRes.json();
        if (!wData || !wData.current || !wData.daily) {
            throw new Error('Incomplete forecast payload');
        }

        const cur = wData.current;
        const hourlyRaw = wData.hourly || {};
        const hourlyTimes = Array.isArray(hourlyRaw.time) ? hourlyRaw.time : [];
        const hourlyTemps = Array.isArray(hourlyRaw.temperature_2m) ? hourlyRaw.temperature_2m : [];
        const hourlyCodes = Array.isArray(hourlyRaw.weather_code) ? hourlyRaw.weather_code : [];
        const hourlyIsDay = Array.isArray(hourlyRaw.is_day) ? hourlyRaw.is_day : [];

        const curHourPrefix = String(cur.time || '').slice(0, 13);
        let startIdx = curHourPrefix ? hourlyTimes.findIndex(t => String(t) >= curHourPrefix) : 0;
        if (startIdx < 0) startIdx = 0;

        const hourly = [];
        for (let i = startIdx; i < hourlyTimes.length && hourly.length < 6; i++) {
            const iso = String(hourlyTimes[i] || '');
            hourly.push({
                time: iso,
                hourLabel: iso.length >= 16 ? iso.slice(11, 16) : iso,
                temp: Math.round(Number(hourlyTemps[i] ?? cur.temperature_2m ?? 0)),
                code: Number(hourlyCodes[i] ?? cur.weather_code ?? 0),
                isDay: hourlyIsDay[i] !== undefined ? Number(hourlyIsDay[i]) === 1 : (Number(cur.is_day ?? 1) === 1)
            });
        }

        const dailyRaw = wData.daily || {};
        const dailyTimes = Array.isArray(dailyRaw.time) ? dailyRaw.time : [];
        const dailyCodes = Array.isArray(dailyRaw.weather_code) ? dailyRaw.weather_code : [];
        const dailyMax = Array.isArray(dailyRaw.temperature_2m_max) ? dailyRaw.temperature_2m_max : [];
        const dailyMin = Array.isArray(dailyRaw.temperature_2m_min) ? dailyRaw.temperature_2m_min : [];

        const daily = dailyTimes.slice(0, 5).map((dateStr, i) => ({
            date: String(dateStr),
            code: Number(dailyCodes[i] ?? 0),
            min: Math.round(Number(dailyMin[i] ?? 0)),
            max: Math.round(Number(dailyMax[i] ?? 0))
        }));

        const data = {
            name: String(name || city),
            country: String(country || ''),
            fetchedAt: Date.now(),
            current: {
                temp: Math.round(Number(cur.temperature_2m ?? 0)),
                feelsLike: Math.round(Number(cur.apparent_temperature ?? cur.temperature_2m ?? 0)),
                humidity: Math.round(Number(cur.relative_humidity_2m ?? 0)),
                wind: Number(cur.wind_speed_10m ?? 0),
                windUnit: String(wData.current_units?.wind_speed_10m || 'km/h'),
                code: Number(cur.weather_code ?? 0),
                isDay: Number(cur.is_day ?? 1) === 1,
                time: String(cur.time || '')
            },
            hourly,
            daily
        };

        this._weatherCache.set(cacheKey, { ts: Date.now(), data });
        return data;
    },

    _parseRssFeedList(rssRawList) {
        const list = Array.isArray(rssRawList) ? rssRawList : [];
        const seenTags = new Map();
        const feeds = list.map(entry => {
            const parts = String(entry || '').split('#').map(s => s.trim());
            const url = Tools._normalizeFeedUrl(parts[0]);
            const rawTags = parts.slice(1).filter(Boolean);
            rawTags.forEach(t => {
                const norm = t.toLowerCase();
                if (norm && !seenTags.has(norm)) seenTags.set(norm, t);
            });
            return {
                url,
                tag: rawTags.join(' '),
                tags: rawTags
            };
        }).filter(f => f.url);
        return {
            feeds,
            availableTags: Array.from(seenTags.values())
        };
    },

    async fetchNewsItems(rssRawList, { filterTag = '', maxItems = 12, force = false } = {}) {
        const { feeds, availableTags } = Tools._parseRssFeedList(rssRawList);
        if (!feeds.length) {
            return { items: [], availableTags: [], feedErrors: 0, emptyConfig: true };
        }

        const langCode = String(state.lang || 'ru').toLowerCase().split('-')[0];
        const normFilter = String(filterTag || '').trim().toLowerCase().replace(/^#/, '');
        const cacheKey = `${langCode}|${normFilter}|${maxItems}|${feeds.map(f => `${f.url}#${f.tag}`).join('|')}`;
        const TTL_MS = 15 * 60 * 1000;

        if (!force) {
            const cached = this._newsCache.get(cacheKey);
            if (cached && (Date.now() - cached.ts) < TTL_MS) {
                return cached.data;
            }
        }

        let targetFeeds = feeds;
        if (normFilter) {
            const matched = feeds.filter(f =>
                f.tags.some(t => t.toLowerCase().includes(normFilter)) ||
                f.tag.toLowerCase().includes(normFilter)
            );
            if (matched.length > 0) targetFeeds = matched;
        }

        const settled = await Promise.allSettled(
            targetFeeds.map(async (feed) => {
                const rawItems = await Tools._fetchFeedItems(feed.url);
                let host = '';
                try { host = new URL(feed.url).hostname.replace(/^www\./i, ''); } catch (_) { host = feed.url; }
                return (Array.isArray(rawItems) ? rawItems : []).map(it => {
                    const cleanTitle = Tools._stripHtml(it.title || '') || 'Untitled';
                    const cleanFull = Tools._stripHtml(it.full || it.desc || '');
                    const cleanDesc = Tools._stripHtml(it.desc || cleanFull);
                    return {
                        title: cleanTitle,
                        link: Tools._safeUrl(it.link) || '',
                        desc: cleanDesc.slice(0, 160) + (cleanDesc.length > 160 ? '...' : ''),
                        full: cleanFull,
                        imgUrl: Tools._safeUrl(it.imgUrl) || '',
                        source: host,
                        tag: feed.tags[0] || ''
                    };
                });
            })
        );

        const buckets = [];
        let feedErrors = 0;
        for (const res of settled) {
            if (res.status === 'fulfilled') {
                if (res.value.length > 0) buckets.push(res.value);
            } else {
                feedErrors++;
                console.warn('Tools.fetchNewsItems feed failed:', res.reason);
            }
        }

        // Round-robin across feeds so one high-volume feed never hides the rest.
        const items = [];
        let round = 0;
        while (items.length < maxItems) {
            let pushedInRound = false;
            for (const list of buckets) {
                if (round < list.length && items.length < maxItems) {
                    items.push(list[round]);
                    pushedInRound = true;
                }
            }
            if (!pushedInRound) break;
            round++;
        }

        const result = {
            items,
            availableTags,
            feedErrors,
            emptyConfig: false,
            fetchedAt: Date.now()
        };
        this._newsCache.set(cacheKey, { ts: Date.now(), data: result });
        return result;
    },

    _stripHtml(html) {
        const raw = String(html || '');
        if (!raw) return '';
        let text = raw.replace(/<[^>]*>/g, ' ');
        if (typeof DOMParser !== 'undefined') {
            try {
                const doc = new DOMParser().parseFromString(text, 'text/html');
                text = doc.body ? (doc.body.textContent || '') : text;
            } catch (_) {}
        }
        return text
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },
};