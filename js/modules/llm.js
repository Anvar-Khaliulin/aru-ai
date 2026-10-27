/*
---ARU-LAB.SPACE---ALMATY---2026---
Large Language Model client facilitating API communications with Gemini, OpenRouter, and custom endpoints.
---chat.aru-lab.space---PWA---
*/
import { Network } from './network.js';

// Long local generations are legitimate; the Stop button covers the rest.
const LLM_TIMEOUT_MS = 180000;

export class LLMClient {
    constructor() {
        this.llmType = 'gemini'; // 'gemini', 'openrouter', 'custom'
        this.apiKey = '';
        this.baseUrl = '';
        this.modelName = 'gemini-1.5-flash';
        this.systemInstruction = '';
        this.maxOutputTokens = 2048;
        this.temperature = 0.9;
        this.ageMode = 'adult'; // 'child', 'teen', 'adult' — set from updateSystemPrompt
    }

    setLLMConfig(config) {
        this.llmType = config.llmType || 'gemini';
        this.apiKey = config.apiKey || '';
        this.baseUrl = config.baseUrl || '';
        this.modelName = config.modelName || (this.llmType === 'gemini' ? 'gemini-1.5-flash' : '');
        this.maxOutputTokens = parseInt(config.maxOutputTokens) || 2048;
        this.temperature = parseFloat(config.aiTemp) || 0.9;
    }

    setTemperature(t) { this.temperature = parseFloat(t) || 0.9; }
    setMaxTokens(n) { this.maxOutputTokens = parseInt(n) || 2048; }
    setApiKey(key) { this.apiKey = key; }
    setBaseUrl(url) { this.baseUrl = url; }
    setModelName(name) { this.modelName = name; }
    setSystemInstruction(text) { this.systemInstruction = text; }
    setAgeMode(m) { this.ageMode = m || 'adult'; }

    // Child/teen profiles get a hard temperature ceiling: high temperature degrades
    // instruction-following on weak local models, which is exactly where mode rules fail.
    effectiveTemperature() {
        if (this.ageMode === 'child' || this.ageMode === 'teen') {
            return Math.min(this.temperature, 0.5);
        }
        return this.temperature;
    }

    async sendMessage(history, currentMessage, options = {}) {
        if (this.llmType === 'gemini') {
            return this.sendGemini(history, currentMessage, options);
        } else {
            return this.sendOpenAI(history, currentMessage, options);
        }
    }

    async sendGemini(history, currentMessage, options = {}) {
        if (!this.apiKey) throw new Error('Gemini API Key missing');

        const model = this.modelName || 'gemini-1.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

        const contents = history.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));
        contents.push({ role: 'user', parts: [{ text: currentMessage }] });

        console.log(`Gemini Request: ${contents.length} blocks in payload`);

        const payload = {
            contents,
            generationConfig: {
                temperature: this.effectiveTemperature(),
                maxOutputTokens: this.maxOutputTokens,
            }
        };

        if (this.systemInstruction) {
            payload.systemInstruction = { parts: [{ text: this.systemInstruction }] };
        }

        // Native Google safety filters as a backstop for child profiles (no cost, server-side)
        if (this.ageMode === 'child') {
            payload.safetySettings = [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
            ];
        }

        const res = await Network.fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: options.signal,
            timeoutMs: LLM_TIMEOUT_MS
        }, 'cors_safe');

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error?.message || 'Gemini error');
        }

        const data = await res.json();

        const candidate = data.candidates && data.candidates[0];
        if (!candidate || !candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
            // Gemini blocked the prompt/response on safety grounds — handled upstream as a soft refusal
            if (this.ageMode === 'child' && data.promptFeedback && data.promptFeedback.blockReason) {
                console.warn('Gemini safety block:', data.promptFeedback.blockReason);
                return null;
            }
            console.error('Gemini Response Error:', data);
            throw new Error('Invalid response from LLM (missing candidates)');
        }

        return candidate.content.parts[0].text;
    }

    async sendOpenAI(history, currentMessage, options = {}) {
        const url = this.baseUrl || (this.llmType === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : '');
        if (!url) throw new Error('LLM Base URL missing');
        if (!this.modelName) throw new Error('LLM Model Name missing (check settings)');

        const messages = [];
        if (this.systemInstruction) {
            messages.push({ role: 'system', content: this.systemInstruction });
        }
        history.forEach(msg => {
            const role = msg.role === 'model' ? 'assistant' : msg.role;
            messages.push({ role: role, content: msg.content });
        });
        messages.push({ role: 'user', content: currentMessage });

        console.log(`OpenAI/OR Request: ${messages.length} messages in payload`);

        const payload = {
            model: this.modelName,
            messages: messages,
            temperature: this.effectiveTemperature(),
            max_tokens: this.maxOutputTokens
        };

        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

        if (this.llmType === 'openrouter') {
            headers['HTTP-Referer'] = window.location.href;
            headers['X-Title'] = 'Aru Ai';
        }

        const res = await Network.fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload),
            signal: options.signal,
            timeoutMs: LLM_TIMEOUT_MS
        }, 'local_api');

        if (!res.ok) {
            let errorMsg = `HTTP ${res.status}`;
            try {
                const err = await res.json();
                errorMsg = err.error?.message || err.message || JSON.stringify(err);
            } catch (e) {
                // Fallback
            }
            throw new Error(errorMsg);
        }

        const data = await res.json();

        if (data.error) {
            throw new Error(data.error.message || JSON.stringify(data.error));
        }

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error("LLM Provider Response Error:", data);
            throw new Error("Invalid response from LLM (missing choices)");
        }

        return data.choices[0].message.content;
    }
}