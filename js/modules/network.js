/*
---ARU-LAB.SPACE---ALMATY---2026---
Centralized Network Module for Aru Ai.
Handles proxies, CORS, and localhost priority.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';

export const Network = {
    /**
     * Enhanced fetch with proxy, localhost support, and context-based routing.
     * @param {string} url - Target URL.
     * @param {object} options - Fetch options.
     * @param {string} context - The context of the request: 'general', 'cors_safe', 'cors_unsafe', 'local_api'
     * @returns {Promise<Response>}
     */
    async fetch(url, options = {}, context = 'general') {
        const settings = state.userSettings || {};
        const strategy = settings.proxy_strategy || 'auto'; // 'none', 'auto', 'custom'
        const customProxy = settings.proxy_custom_url || '';
        const localhostPriority = settings.localhost_priority !== 'false';

        // 1. Detect Address Space
        const isLoopback = url.includes('localhost') || url.includes('127.0.0.1');
        const isLocalIP = !!url.match(/^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/);
        const isLocal = isLoopback || isLocalIP;

        // 2. Direct Routes (Always direct if cors_safe or localhost with priority)
        if (context === 'cors_safe' || (localhostPriority && isLocal)) {
            console.log(`Network: Direct route for ${url} (Context: ${context}, Local: ${isLocal})`);
            
            const localOptions = { ...options };
            if (isLocal) {
                localOptions.targetAddressSpace = isLoopback ? 'loopback' : 'local';
            }

            try {
                return await fetch(url, localOptions);
            } catch (e) {
                if (e.name === 'TypeError' && e.message === 'Failed to fetch') {
                    if (window.location.protocol === 'https:' && url.startsWith('http:')) {
                        throw new Error("Mixed Content: Browser blocked HTTP request from HTTPS. Allow 'Insecure content' in site settings or use local version of the app.");
                    }
                    throw new Error("Network Error: Failed to fetch. Check if the server is running, CORS is enabled, and 'Insecure content' is allowed if using HTTPS.");
                }
                throw e;
            }
        }

        // 3. Strategy: Direct
        if (strategy === 'none') {
            const directOptions = { ...options };
            if (isLocal) {
                directOptions.targetAddressSpace = isLoopback ? 'loopback' : 'local';
            }
            return await fetch(url, directOptions);
        }

        // 4. Strategy: Custom
        if (strategy === 'custom' && customProxy) {
            const proxyUrl = customProxy.includes('%URL%')
                ? customProxy.replace('%URL%', encodeURIComponent(url))
                : customProxy + encodeURIComponent(url);

            console.log(`Network: Using custom proxy for ${url}`);
            return await this._fetchWrapped(proxyUrl, options);
        }

        // 5. Strategy: Auto (Public Proxies with logic and fallbacks especially for pure HTML feeds)
        // For API data or RSS, try corsproxy.io first as it's cleaner, then fallback to AllOrigins
        console.log(`Network: Using auto proxy for ${url}`);
        return await this._fetchAutoProxy(url, options);
    },

    /**
     * Tries multiple free public proxies to ensure maximum uptime
     */
    async _fetchAutoProxy(url, options) {
        // Primary: corsproxy.io (returns raw content, good for RSS)
        try {
            const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, options);
            if (res.ok) return res;
        } catch (e) {
            console.warn("Primary CORS proxy failed, falling back...");
        }

        // Fallback: AllOrigins (returns wrapped JSON)
        try {
            const allOriginsUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
            return await this._fetchWrapped(allOriginsUrl, options);
        } catch (e) {
            throw new Error("All public CORS proxies failed. Try custom proxy or direct connection.");
        }
    },

    /**
     * Internal fetch wrapper that handles proxy-specific response formats (like AllOrigins JSON wrapping)
     */
    async _fetchWrapped(proxyUrl, options) {
        const res = await fetch(proxyUrl, options);
        if (!res.ok) return res;

        // If it's AllOrigins, we need to unwrap the JSON
        if (proxyUrl.includes('allorigins.win')) {
            const json = await res.json();
            // Create a fake response object that looks like a real fetch response
            return new Response(json.contents, {
                status: 200,
                headers: { 'Content-Type': 'text/html' } // AllOrigins usually returns HTML/XML
            });
        }

        return res;
    }
};
