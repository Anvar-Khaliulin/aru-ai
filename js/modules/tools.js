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
            const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationName)}&count=1&language=${langParam}&format=json`);
            const geoData = await geoRes.json();

            const labels = {
                kk: { wind: 'Жел', error: 'Қала табылмады', fail: 'Қате', now: 'Қазір', humidity: 'Ылғал', forecast: 'болжам' },
                ru: { wind: 'Ветер', error: 'Город не найден', fail: 'Ошибка', now: 'Сейчас', humidity: 'Влажн', forecast: 'прогноз' },
                en: { wind: 'Wind', error: 'City not found', fail: 'Error', now: 'Now', humidity: 'Humidity', forecast: 'forecast' }
            }[langParam || 'ru'];

            if (!geoData.results) return `<div class="p-3 bg-red-50 dark:bg-red-900/10 text-red-500 rounded-xl text-xs flex items-center gap-2"><i data-lucide="alert-circle" class="w-4 h-4"></i> ${labels.error}: ${locationName}</div>`;

            const { latitude, longitude, name, country } = geoData.results[0];
            const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4`);
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

    // --- NEWS RSS ---
    async getNewsCard(rssRawList, filterTag = '') {
        if (!rssRawList || rssRawList.length === 0) {
            return `<div class="p-3 bg-gray-50 dark:bg-gray-800/50 border rounded-xl text-gray-500 text-xs flex items-center gap-2"><i data-lucide="rss"></i> ${state.translations?.msg_rss_empty || 'Add RSS feeds in settings'}</div>`;
        }

        const feeds = rssRawList.map(item => {
            const parts = item.split('#').map(s => s.trim());
            return { url: parts[0], tag: parts[1] || '' };
        });

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

        for (const feed of targetFeeds) {
            if (count >= 10) break; // Increased individual feed limit but globally still capped
            try {
                console.log(`Tools: Fetching feed ${feed.url} (Tag: ${feed.tag})`);
                const res = await Network.fetch(feed.url, {}, 'cors_unsafe');
                if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);

                const xmlText = await res.text();
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlText, "text/xml");

                // Detect Parsing Error
                const parseError = xmlDoc.getElementsByTagName("parsererror");
                if (parseError.length > 0) {
                    console.error(`Tools: XML Parse Error for ${feed.url}`, parseError[0].textContent);
                    continue;
                }

                // Supports data normalization for both standard RSS (item) and Atom (entry) feeds
                let items = xmlDoc.querySelectorAll("item");
                let isAtom = false;
                if (items.length === 0) {
                    items = xmlDoc.querySelectorAll("entry");
                    isAtom = true;
                }

                console.log(`Tools: Found ${items.length} items in ${feed.url} (Format: ${isAtom ? 'Atom' : 'RSS'})`);

                for (const item of items) {
                    if (count >= 10) break;

                    let title = "", link = "#", desc = "", fullTextRaw = "", imgUrl = "";

                    if (isAtom) {
                        // Atom Format
                        title = item.querySelector("title")?.textContent || "No Title";
                        // Atom links are usually <link href="..."/>
                        const linkNode = item.querySelector("link[rel='alternate']") || item.querySelector("link:not([rel])") || item.querySelector("link");
                        link = linkNode ? (linkNode.getAttribute("href") || linkNode.textContent) : "#";

                        const summary = item.querySelector("summary")?.textContent || "";
                        const content = item.querySelector("content")?.textContent || "";
                        desc = summary || content || "";
                        fullTextRaw = content || summary;
                    } else {
                        // RSS Format
                        title = item.querySelector("title")?.textContent || "No Title";
                        link = item.querySelector("link")?.textContent || "#";
                        const contentEncoded = item.getElementsByTagName('content:encoded')[0];
                        const description = item.querySelector("description")?.textContent || "";
                        desc = description;
                        fullTextRaw = contentEncoded?.textContent || description;
                    }

                    // Sanitizes HTML elements from string payload and truncates text for safe UI preview rendering
                    const cleanDesc = desc.replace(/<[^>]*>/g, '').trim().slice(0, 150) + (desc.length > 150 ? '...' : '');

                    // Prepare safe full text for data attribute (URI-encoded)
                    // We remove excessive whitespace and safely encode
                    const safeFull = encodeURIComponent(fullTextRaw.replace(/\s+/g, ' ').trim());

                    // Analyzes enclosure targets to identify optimal image thumbnails
                    const enclosure = item.querySelector("enclosure[type^='image']");
                    if (enclosure) imgUrl = enclosure.getAttribute('url');

                    if (!imgUrl) {
                        const mediaContent = item.getElementsByTagName("media:content")[0] || item.getElementsByTagName("content")[0];
                        if (mediaContent) imgUrl = mediaContent.getAttribute('url');
                    }

                    if (!imgUrl) {
                        const imgMatch = desc.match(/<img[^>]+src="([^">]+)"/);
                        if (imgMatch) imgUrl = imgMatch[1];
                    }

                    const source = new URL(feed.url).hostname.replace('www.', '');

                    // Generates an isolated DOM wrapper component to encapsulate data tags and interactive actions safely
                    const safeTitle = title.replace(/"/g, '&quot;').replace(/\'/g, '&#39;').replace(/\n/g, ' ');
                    const safeLink = encodeURIComponent(link);
                    const safeDesc = cleanDesc.replace(/"/g, '&quot;').replace(/\'/g, '&#39;').replace(/\n/g, ' ');

                    html += `
                    <div class="flex gap-3 p-3 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl hover:border-aru-400 hover:shadow-lg transition-all group overflow-hidden" 
                         data-news-title="${safeTitle}" 
                         data-news-link="${safeLink}" 
                         data-news-desc="${safeDesc}" 
                         data-news-full="${safeFull}">
                        ${imgUrl ? `
                        <div class="w-20 h-20 flex-shrink-0 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-700">
                            <img src="${imgUrl}" class="w-full h-full object-cover transition-transform group-hover:scale-110" onerror="this.remove()">
                        </div>` : ''}
                        <div class="flex-1 min-w-0">
                            <h4 class="font-bold text-gray-800 dark:text-gray-100 text-xs mb-1 line-clamp-2 leading-relaxed group-hover:text-aru-600">${title}</h4>
                            <p class="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">${cleanDesc}</p>
                            <div class="flex items-center gap-2 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                                <span class="flex items-center gap-1 bg-gray-50 dark:bg-gray-900 px-1.5 py-0.5 rounded-lg border border-gray-100 dark:border-gray-800">
                                    <i data-lucide="rss" class="w-2.5 h-2.5"></i> ${source}
                                </span>
                            </div>
                        </div>
                        <div class="flex-shrink-0 flex flex-col justify-center items-center gap-2">
                            <a href="${link}" target="_blank" class="p-2 text-gray-400 hover:text-aru-500 rounded-lg transition hover:bg-gray-50 dark:hover:bg-gray-700" title="${state.translations?.action_open || 'Open'}">
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
                console.warn(`Tools: RSS Feed failed for ${feed.url}`, e);
            }
        }
        html += `</div>`;

        if (count === 0) return `<div class="p-4 text-center text-gray-400 text-xs italic">${state.translations?.msg_rss_no_news || 'No news found'}</div>`;

        return html;
    },
};