/*
---ARU-LAB.SPACE---ALMATY---2026---
Overhauled Web Search Module (Grounding) supporting Tavily and SearXNG.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { Network } from './network.js';

export const Search = {
    /**
     * Performs a web search using the configured provider.
     * @param {string} text - The user query to search for.
     * @returns {Promise<string|null>} - A string of gathered information or error message.
     */
    async query(text) {
        if (!text || text.trim().length < 2) return null;

        const provider = state.userSettings.search_provider || 'none';
        if (provider === 'none') {
            console.log('Search: Provider is disabled.');
            return null;
        }

        // Errors propagate to the caller (chatController) so grounding
        // can degrade gracefully to a knowledge-based answer
        if (provider === 'tavily') {
            return await this.queryTavily(text);
        } else if (provider === 'searxng') {
            return await this.querySearXNG(text);
        }

        return null;
    },

    /**
     * Queries the Tavily API.
     */
    async queryTavily(query) {
        const apiKey = state.userSettings.tavily_key;
        if (!apiKey) throw new Error('Tavily API Key is missing in settings.');

        console.log('Search: Querying Tavily API...');
        const response = await Network.fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: apiKey,
                query: query,
                search_depth: 'basic',
                max_results: 5
            })
        }, 'cors_safe');

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(`Tavily API error: ${err.detail || response.statusText}`);
        }

        const data = await response.json();
        if (!data.results || data.results.length === 0) return null;

        return data.results.map(r => `[${r.title}]: ${r.content}`).join('\n\n');
    },

    /**
     * Queries a SearXNG instance with global Network strategy.
     */
    async querySearXNG(query) {
        let instanceUrl = (state.userSettings.searxng_url || '').trim();
        if (!instanceUrl) throw new Error('SearXNG Instance URL is missing in settings.');

        // Tolerate "searx.be" or "localhost:8888" (no scheme) and trailing slashes;
        // local instances default to http, public ones to https
        if (!/^https?:\/\//i.test(instanceUrl)) {
            const isLocal = /^(localhost(\.|:|$)|127\.|0\.0\.0\.0|::1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(instanceUrl);
            instanceUrl = (isLocal ? 'http://' : 'https://') + instanceUrl;
        }
        instanceUrl = instanceUrl.replace(/\/+$/, '');

        const targetUrl = `${instanceUrl}/search?q=${encodeURIComponent(query)}&format=json`;

        console.log(`Search: Querying SearXNG via Network module...`);
        const response = await Network.fetch(targetUrl, {}, 'local_api');

        if (!response.ok) {
            if (response.status === 403 || response.status === 404) {
                throw new Error(`SearXNG returned ${response.status}. The instance most likely has the JSON format disabled — add "json" to search.formats in the instance settings.`);
            }
            throw new Error(`Network error: ${response.statusText} (${response.status})`);
        }

        let contents;
        try {
            contents = await response.json();
        } catch (e) {
            throw new Error('SearXNG did not return valid JSON. The instance may have the JSON format disabled, or a proxy returned an HTML error page.');
        }

        const results = contents.results || [];

        if (results.length === 0) return null;

        return results.slice(0, 5).map(r => `[${r.title}]: ${r.content || r.snippet || ''}`).join('\n\n');
    }
};
