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
            const langParam = state.lang || 'ru';
            const geoRes = await Network.fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationName)}&count=1&language=${langParam}&format=json`, {}, 'cors_safe');
            const geoData = await geoRes.json();

            const labels = {
                kk: { wind: 'Жел', error: 'Қала табылмады', fail: 'Қате', now: 'Қазір', humidity: 'Ылғал', forecast: 'болжам' },
                ru: { wind: 'Ветер', error: 'Город не найден', fail: 'Ошибка', now: 'Сейчас', humidity: 'Влажн', forecast: 'прогноз' },
                en: { wind: 'Wind', error: 'City not found', fail: 'Error', now: 'Now', humidity: 'Humidity', forecast: 'forecast' }
            }[langParam || 'ru'];

            if (!geoData.results) return `<div class="p-3 bg-red-50 dark:bg-red-900/10 text-red-500 rounded-xl text-xs flex items-center gap-2"><i data-lucide="alert-circle" class="w-4 h-4"></i> ${labels.error}: ${locationName}</div>`;

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
                const date = new Date(daily.time[i]);
                const dayName = date.toLocaleDateString(state.lang, { weekday: 'short' });
                forecastHtml += `
                <div class="flex flex-col items-center p-2 rounded-xl bg-gray-50/50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50">
                    <span class="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">${dayName}</span>
                    <i data-lucide="${getIcon(daily.weather_code[i])}" class="w-5 h-5 text-aru-500 mb-1"></i>
                    <span class="text-xs font-bold text-gray-800 dark:text-gray-100">${Math.round(daily.temperature_2m_max[i])}°</span>
                </div>`;
            }

            return `
            <div class="my-4 max-w-sm bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-5 shadow-xl animate-fade-in relative overflow-hidden">
                <div class="absolute -top-12 -right-12 w-32 h-32 bg-aru-500/10 rounded-full blur-3xl"></div>
                
                <div class="flex justify-between items-center mb-6 relative z-10">
                    <div>
                        <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                            <i data-lucide="map-pin" class="w-4 h-4 text-aru-500"></i> ${name}
                        </h3>
                        <p class="text-[10px] text-gray-400 uppercase tracking-widest font-bold mt-0.5">${country}</p>
                    </div>
                    <div class="text-right">
                        <span class="text-3xl font-black text-aru-500">${Math.round(current.temperature_2m)}°</span>
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-3 mb-4 relative z-10">
                    ${forecastHtml}
                </div>

                <div class="flex justify-between items-center text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-4 pt-4 border-t border-gray-50 dark:border-gray-800 relative z-10 px-1">
                    <span class="flex items-center gap-1.5"><i data-lucide="wind" class="w-3 h-3 text-blue-400"></i> ${current.wind_speed_10m} ${wData.current_units.wind_speed_10m}</span>
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

        const palette = ['bg-aru-500', 'bg-amber-400', 'bg-emerald-500', 'bg-sky-500', 'bg-rose-500', 'bg-violet-500'];

        let html = `<div class="my-4 space-y-3 animate-fade-in" data-tasks-card>`;

        for (const p of projects) {
            const allTasks = (p.columns || []).flatMap(c => c.tasks || []);
            html += `
            <div class="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-4 shadow-xl overflow-hidden" data-tasks-project="${Tools._esc(p.name)}">
                <div class="flex items-center justify-between gap-2 mb-3">
                    <h3 class="font-bold text-sm text-gray-800 dark:text-gray-100 flex items-center gap-2 min-w-0">
                        <i data-lucide="folder-kanban" class="w-4 h-4 text-aru-500 shrink-0"></i>
                        <span class="truncate">${Tools._esc(p.name)}</span>
                    </h3>
                    <span class="text-[9px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 dark:bg-gray-800 px-2 py-1 rounded-lg border border-gray-100 dark:border-gray-800 shrink-0">${allTasks.length} ${t('task_count_' + Tools._pluralForm(allTasks.length, state.lang), 'tasks')}</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    ${(p.columns || []).map((c, ci) => `
                        <div class="rounded-2xl bg-gray-50/70 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 p-3" data-tasks-column="${Tools._esc(c.title)}">
                            <div class="flex items-center gap-2 mb-2">
                                <span class="w-2 h-2 rounded-full ${palette[ci % palette.length]}"></span>
                                <span class="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 truncate">${Tools._esc(c.title)}</span>
                                <span class="ml-auto text-[10px] font-bold text-gray-300 dark:text-gray-600">${(c.tasks || []).length}</span>
                            </div>
                            <div class="space-y-2">
                                ${(c.tasks && c.tasks.length) ? c.tasks.map(task => Tools._renderTaskRow(task, t)).join('') : `<p class="text-[10px] text-gray-300 dark:text-gray-600 italic">&mdash;</p>`}
                            </div>
                        </div>
                    `).join('')}
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

    _renderTaskRow(task, t) {
        const dl = Tools._parseTaskDate(task.deadline);
        let badge = '';
        if (dl) {
            const isOverdue = dl.getTime() < Date.now();
            const isToday = !isOverdue && dl.toDateString() === new Date().toDateString();
            const cls = isOverdue
                ? 'bg-red-50 dark:bg-red-900/20 text-red-500'
                : (isToday ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600' : 'bg-gray-100/70 dark:bg-gray-800 text-gray-400');
            badge = `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${cls}">
                <i data-lucide="clock" class="w-2.5 h-2.5"></i>
                ${Tools._esc(dl.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))}
            </span>`;
        }
        return `
            <div class="p-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm" data-task-title="${Tools._esc(task.title)}">
                <p class="text-[11px] font-bold text-gray-700 dark:text-gray-200 leading-snug">${Tools._esc(task.title)}</p>
                ${task.desc ? `<p class="text-[10px] text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">${Tools._esc(task.desc)}</p>` : ''}
                ${badge ? `<div class="mt-1.5">${badge}</div>` : ''}
            </div>`;
    },

    // Local-time parse: date-only values default to 12:00 so they are not
    // shifted by UTC interpretation (new Date('2026-10-08') => 05:00 in UTC+5).
    _parseTaskDate(raw) {
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(raw || ''));
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0);
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
            const langFeeds = feeds.filter(f => f.tag.toLowerCase() === currentLang);
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

    _stripHtml(html) {
        return (html || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },
};