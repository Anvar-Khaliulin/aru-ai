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
        this.modelName = 'gemini-2.5-flash';
        this.systemInstruction = '';
        this.maxOutputTokens = 2048;
        this.temperature = 0.9;
        this.ageMode = 'adult'; // 'child', 'teen', 'adult' — set from updateSystemPrompt
    }

    setLLMConfig(config) {
        this.llmType = config.llmType || 'gemini';
        this.apiKey = config.apiKey || '';
        this.baseUrl = config.baseUrl || '';
        this.modelName = config.modelName || (this.llmType === 'gemini' ? 'gemini-2.5-flash' : '');
        this.maxOutputTokens = parseInt(config.maxOutputTokens) || 2048;
        const parsedTemp = parseFloat(config.aiTemp);
        this.temperature = Number.isFinite(parsedTemp) ? parsedTemp : 0.9;
    }

    setTemperature(t) {
        const parsedTemp = parseFloat(t);
        this.temperature = Number.isFinite(parsedTemp) ? parsedTemp : 0.9;
    }
    setMaxTokens(n) { this.maxOutputTokens = parseInt(n) || 2048; }
    setApiKey(key) { this.apiKey = key; }
    setBaseUrl(url) { this.baseUrl = url; }
    setModelName(name) { this.modelName = name; }
    setSystemInstruction(text) { this.systemInstruction = text; }
    setAgeMode(m) { this.ageMode = m || 'adult'; }

    // Child/teen profiles get a hard temperature ceiling: high temperature degrades
    // instruction-following on weak local models, which is exactly where mode rules fail.
    effectiveTemperature(ageMode = this.ageMode) {
        if (ageMode === 'child' || ageMode === 'teen') {
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

        const sysInstr = options.systemInstruction !== undefined ? options.systemInstruction : this.systemInstruction;
        const ageMode = options.ageMode || this.ageMode;
        const model = this.modelName || 'gemini-2.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

        const contents = [];
        const pushGeminiTurn = (role, text) => {
            const contentText = String(text ?? '');
            const prev = contents[contents.length - 1];
            if (prev && prev.role === role) {
                prev.parts[0].text += '\n\n' + contentText;
            } else {
                contents.push({ role, parts: [{ text: contentText }] });
            }
        };
        history.forEach(msg => pushGeminiTurn(msg.role === 'user' ? 'user' : 'model', msg.content));
        pushGeminiTurn('user', currentMessage);

        console.log(`Gemini Request: ${contents.length} blocks in payload`);

        const payload = {
            contents,
            generationConfig: {
                temperature: this.effectiveTemperature(ageMode),
                maxOutputTokens: this.maxOutputTokens,
            }
        };

        if (sysInstr) {
            payload.systemInstruction = { parts: [{ text: sysInstr }] };
        }

        // Native Google safety filters as a backstop for child profiles (no cost, server-side)
        if (ageMode === 'child') {
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
            let errMsg = `HTTP ${res.status}`;
            try {
                const err = await res.json();
                errMsg = err.error?.message || err.message || errMsg;
            } catch (_) {}
            throw new Error(errMsg || 'Gemini error');
        }

        const data = await res.json();

        const candidate = data.candidates && data.candidates[0];
        const parts = candidate && candidate.content && Array.isArray(candidate.content.parts)
            ? candidate.content.parts
            : [];
        const text = parts
            .filter(p => p && !p.thought && typeof p.text === 'string')
            .map(p => p.text)
            .join('');

        if (!text) {
            // Gemini blocked the prompt/response on safety grounds — handled upstream as a soft refusal
            if (ageMode === 'child' && ((data.promptFeedback && data.promptFeedback.blockReason) || candidate?.finishReason === 'SAFETY')) {
                console.warn('Gemini safety block:', data.promptFeedback?.blockReason || candidate?.finishReason);
                return null;
            }
            console.error('Gemini Response Error:', data);
            throw new Error('Invalid response from LLM (missing candidates)');
        }

        return text;
    }

    async sendOpenAI(history, currentMessage, options = {}) {
        const url = this.baseUrl || (this.llmType === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : '');
        if (!url) throw new Error('LLM Base URL missing');
        if (!this.modelName) throw new Error('LLM Model Name missing (check settings)');

        const sysInstr = options.systemInstruction !== undefined ? options.systemInstruction : this.systemInstruction;
        const ageMode = options.ageMode || this.ageMode;

        const messages = [];
        if (sysInstr) {
            messages.push({ role: 'system', content: sysInstr });
        }
        const pushOpenAITurn = (role, content) => {
            const contentText = String(content ?? '');
            const prev = messages[messages.length - 1];
            if (prev && prev.role === role) {
                prev.content += '\n\n' + contentText;
            } else {
                messages.push({ role, content: contentText });
            }
        };
        history.forEach(msg => {
            const role = msg.role === 'model' ? 'assistant' : msg.role;
            pushOpenAITurn(role, msg.content);
        });
        pushOpenAITurn('user', currentMessage);

        console.log(`OpenAI/OR Request: ${messages.length} messages in payload`);

        const payload = {
            model: this.modelName,
            messages: messages,
            temperature: this.effectiveTemperature(ageMode),
            max_tokens: this.maxOutputTokens
        };

        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

        if (this.llmType === 'openrouter') {
            headers['HTTP-Referer'] = window.location.origin;
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