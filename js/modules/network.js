/*
---ARU-LAB.SPACE---ALMATY---2026---
Centralized Network Module for Aru Ai.
Handles proxies, CORS, and localhost priority.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';

// Without a limit a stalled connection keeps the chat "typing" forever.
const DEFAULT_TIMEOUT_MS = 120000;

export const Network = {
    /**
     * Enhanced fetch with proxy, localhost support, and context-based routing.
     * Contexts:
     *  - 'general'     - follows the user's proxy strategy (RSS, plain sites)
     *  - 'cors_safe'   - always direct (target API serves CORS headers)
     *  - 'cors_unsafe' - follows the user's proxy strategy
     *  - 'local_api'   - API endpoint (LLM, SearXNG): public proxies are only used
     *                    when the request carries no credentials. Requests with
     *                    Authorization headers NEVER go through public proxies;
     *                    a user-configured custom proxy is always trusted.
     * @param {string} url - Target URL.
     * @param {object} options - Fetch options.
     * @param {string} context - The context of the request.
     * @returns {Promise<Response>}
     */
    async fetch(url, options = {}, context = 'general') {
        const { timeoutMs, ...requestOptions } = options;
        const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
        const settings = state.userSettings || {};
        const strategy = settings.proxy_strategy || 'auto'; // 'none', 'auto', 'custom'
        const customProxy = (settings.proxy_custom_url || '').trim();
        const localhostPriority = settings.localhost_priority !== 'false';

        const hostname = this._hostname(url);
        const isLoopback = this._isLoopback(hostname);
        const isLocal = isLoopback || this._isPrivateNetwork(hostname);

        // 1. Direct Routes (Always direct if cors_safe or localhost with priority)
        if (context === 'cors_safe' || (localhostPriority && isLocal)) {
            console.log(`Network: Direct route for ${this._redactUrl(url)} (Context: ${context}, Local: ${isLocal})`);
            return this._fetchDirect(url, this._withAddressSpace(requestOptions, isLocal, isLoopback), timeout);
        }

        // 2. Strategy: Direct
        if (strategy === 'none') {
            return this._fetchDirect(url, this._withAddressSpace(requestOptions, isLocal, isLoopback), timeout);
        }

        // 3. Strategy: Custom (trusted proxy chosen by the user)
        if (strategy === 'custom' && customProxy) {
            console.log(`Network: Using custom proxy for ${url}`);
            return this._fetchWrapped(this._buildProxyUrl(customProxy, url), requestOptions, timeout);
        }

        // 4. Context 'local_api' under auto strategy: try direct first so that
        // credentials never leak through public proxies. Fall back to public
        // proxies ONLY when the request has no Authorization header.
        if (context === 'local_api') {
            const hasCredentials = !!(requestOptions.headers && (requestOptions.headers['Authorization'] || requestOptions.headers.Authorization));
            try {
                console.log(`Network: Direct route for API ${this._redactUrl(url)}`);
                return await this._fetchDirect(url, this._withAddressSpace(requestOptions, isLocal, isLoopback), timeout);
            } catch (e) {
                if (e instanceof TypeError) {
                    if (hasCredentials) {
                        throw new Error(`Direct request to ${url} failed (CORS or network). For your safety, Aru never sends API keys through public proxies. Options: enable CORS on the server, run the app on the same machine/network, or configure a trusted custom proxy in Settings → Network.`);
                    }
                    console.warn('Network: local_api direct request failed, falling back to public proxies (request has no credentials)');
                    return this._fetchAutoProxy(url, requestOptions);
                }
                throw e;
            }
        }

        // 5. Strategy: Auto (Public Proxies with logic and fallbacks especially for pure HTML feeds)
        // For API data or RSS, try corsproxy.io first as it's cleaner, then fallback to AllOrigins
        console.log(`Network: Using auto proxy for ${this._redactUrl(url)}`);
        return this._fetchAutoProxy(url, requestOptions);
    },

    _hostname(url) {
        try {
            return new URL(url).hostname.toLowerCase();
        } catch (e) {
            return '';
        }
    },

    // Masks credentials in query strings before they reach the console
    // (e.g. the Gemini key travels as ?key=... and must not end up in logs).
    _redactUrl(url) {
        return (url || '').replace(/([?&](?:key|api_key|apikey|token)=)[^&\s]+/gi, '$1***');
    },

    _isLoopback(hostname) {
        if (!hostname) return false;
        const bare = hostname.replace(/^\[|\]$/g, '');
        return bare === 'localhost' || bare.endsWith('.localhost') ||
            bare === '::1' || bare === '[::]' || bare === '0.0.0.0' ||
            bare === '127.0.0.1' || /^127\.\d+\.\d+\.\d+$/.test(bare);
    },

    _isPrivateNetwork(hostname) {
        if (!hostname) return false;
        const bare = hostname.replace(/^\[|\]$/g, '').toLowerCase();
        // mDNS / LAN hostnames and IPv6 ULA / link-local
        if (bare.endsWith('.local') || bare.endsWith('.internal') || bare.endsWith('.home.arpa')) return true;
        if (/^(fd[0-9a-f]{2}|fe80):/i.test(bare)) return true;
        // RFC1918 + CGNAT range 100.64.0.0/10 (Tailscale, corporate VPNs)
        if (/^10\.\d+\.\d+\.\d+$/.test(bare)) return true;
        if (/^192\.168\.\d+\.\d+$/.test(bare)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(bare)) return true;
        if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(bare)) return true;
        return false;
    },

    _withAddressSpace(options, isLocal, isLoopback) {
        // Draft Private Network Access hint; browsers that don't support it ignore it
        if (!isLocal) return options;
        return { ...options, targetAddressSpace: isLoopback ? 'loopback' : 'local' };
    },

    _buildProxyUrl(proxyTemplate, url) {
        return proxyTemplate.includes('%URL%')
            ? proxyTemplate.replace('%URL%', encodeURIComponent(url))
            : proxyTemplate + encodeURIComponent(url);
    },

    async _fetchDirect(url, options, timeoutMs = DEFAULT_TIMEOUT_MS) {
        try {
            return await this._fetchWithTimeout(url, options, timeoutMs);
        } catch (e) {
            if (e && e.name === 'AbortError') {
                // A user-initiated stop keeps its AbortError; only our own timer
                // is converted into a readable message.
                if (options && options.signal && options.signal.aborted) throw e;
                throw new Error('Request timed out. The server is not responding.');
            }
            if (e instanceof TypeError) {
                if (window.location.protocol === 'https:' && url.startsWith('http:')) {
                    throw new Error("Mixed Content: Browser blocked HTTP request from HTTPS. Allow 'Insecure content' in site settings or use local version of the app.");
                }
                throw new Error("Network Error: Failed to fetch. Check if the server is running, CORS is enabled, and 'Insecure content' is allowed if using HTTPS.");
            }
            throw e;
        }
    },

    _fetchWithTimeout(url, options = {}, ms = DEFAULT_TIMEOUT_MS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        if (options && options.signal) {
            if (options.signal.aborted) controller.abort();
            else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
        return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
    },

    /**
     * Tries several free public proxies in order. Each attempt has its own
     * timeout so one dead proxy cannot stall the whole request.
     */
    async _fetchAutoProxy(url, options) {
        const hasCredentials = !!(options.headers && (options.headers['Authorization'] || options.headers.Authorization));
        if (hasCredentials) {
            throw new Error('For your safety, Aru never sends API keys through public proxies. Configure a trusted custom proxy in Settings → Network.');
        }

        const enc = encodeURIComponent(url);
        const attempts = [
            { name: 'allorigins', url: `https://api.allorigins.win/get?url=${enc}`, timeout: 9000 },
            { name: 'codetabs', url: `https://api.codetabs.com/v1/proxy?quest=${enc}`, timeout: 9000 },
            { name: 'cors.lol', url: `https://api.cors.lol/?url=${enc}`, timeout: 7000 },
        ];

        for (const attempt of attempts) {
            try {
                console.log(`Network: Trying public proxy ${attempt.name} for ${this._redactUrl(url)}`);
                const res = await this._fetchWrapped(attempt.url, options, attempt.timeout);
                if (res.ok) return res;
                console.warn(`Network: Public proxy ${attempt.name} responded with ${res.status}`);
            } catch (e) {
                console.warn(`Network: Public proxy ${attempt.name} failed: ${e.message}`);
            }
        }
        throw new Error("All public CORS proxies failed. Try custom proxy or direct connection.");
    },

    /**
     * Internal fetch wrapper that handles proxy-specific response formats (like AllOrigins JSON wrapping)
     */
    async _fetchWrapped(proxyUrl, options, timeout = DEFAULT_TIMEOUT_MS) {
        const res = await this._fetchWithTimeout(proxyUrl, options, timeout);
        if (!res.ok) return res;

        // If it's AllOrigins, we need to unwrap the JSON
        if (proxyUrl.includes('allorigins.win')) {
            const json = await res.json();
            const upstream = json && json.status ? json.status.http_code : 0;
            if (!json || !json.contents || (upstream && upstream >= 400)) {
                throw new Error(`AllOrigins could not fetch the target (upstream status ${upstream || 'unknown'})`);
            }
            // Create a fake response object that looks like a real fetch response
            return new Response(json.contents, {
                status: 200,
                headers: { 'Content-Type': 'text/html' } // AllOrigins usually returns HTML/XML
            });
        }

        return res;
    }
};
