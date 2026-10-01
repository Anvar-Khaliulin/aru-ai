/*
---ARU-LAB.SPACE---ALMATY---2026---
Heuristic engine analyzing user sentiment and calculating dynamic emotional responses and personality shifts.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { DB } from './db.js';

export const Heuristics = {

    // Tuning configuration parameters for emotional state calculation algorithms
    _config: {
        alpha: 0.2,
        beta: 0.1,
        gamma: 0.15,
        delta: 0.12,
        affinityRecoveryThreshold: 40,
        affinityPosScale: 10,
        affinityNegScaleBase: 30
    },

    // Updates runtime heuristic configuration values safely
    setConfig(cfg = {}) {
        if (typeof cfg !== 'object' || cfg === null) return;
        Object.assign(this._config, cfg);
    },

    // Topic dictionaries reused by both mood calculation and sticker selection
    _keywords: {
        geeky: [
            'код', 'программиров', 'скрипт', 'функция', 'баг', 'фича', 'алгоритм', 'запрос',
            'code', 'debug', 'script', 'function', 'python', 'javascript', 'sql', 'query', 'api', 'backend',
            'бағдарлама', 'скрипт', 'функция', 'алгоритм', 'деректер', 'жүйе', 'сұрау'
        ],
        musical: [
            'музыка', 'песня', 'рок', 'метал', 'рэп',
            'music', 'song', 'rock', 'metal', 'guitar',
            'ән', 'әуен', 'күй', 'рок', 'метал'
        ]
    },

    // Regex patterns for relationship sentiment and contextual sticker rules
    _patterns: {
        positiveFeedback: [
            /\b(?:спасибо|благодарю)\b/i,
            /\b(?:ты|ару)\s+(?:молодец|умница|лучшая|супер|классная|гений|красава)\b/i,
            /\b(?:thank you|thanks)\b/i,
            /\b(?:you(?:'re| are)|aru(?: is|'s)?)\s+(?:great|awesome|amazing|brilliant|helpful|the best|smart)\b/i,
            /\b(?:рахмет|алғыс)\b/i,
            /\b(?:сен|ару)\s+(?:кереметсің|жарайсың|ақылдысың|ең жақсысың)\b/i
        ],
        negativeFeedback: [
            /\b(?:дура|тупая|глупая|отстой|бесишь|заткнись|ненавижу)\b/i,
            /\b(?:ты|ару)\s+(?:тупая|бесполезная|ужасная|глупая|дура)\b/i,
            /\b(?:idiot|stupid|useless|shut up|hate you|worst|annoying)\b/i,
            /\b(?:you(?:'re| are)|aru(?: is|'s)?)\s+(?:stupid|useless|awful|terrible|annoying)\b/i,
            /\b(?:ақымақ|топас|мисыз|жек көрем|кет|жоғал)\b/i,
            /\b(?:сен|ару)\s+(?:жамансың|ақымақсың|топассың|пайдасызсың)\b/i
        ],
        affection: [
            /\b(?:люблю|обожаю)\b/i,
            /\b(?:love you|with love)\b/i,
            /❤️|🥰/i,
            /\b(?:сүйемін|ғашықпын)\b/i
        ],
        apology: [
            /\b(?:извини|прости|простите)\b/i,
            /\b(?:sorry|apolog(?:ize|ise))\b/i,
            /\b(?:кешір|кешіріңіз|өкінішті)\b/i
        ],
        request: [
            /\b(?:пожалуйста|прошу|умоляю)\b/i,
            /\b(?:please|kindly)\b/i,
            /\b(?:өтінемін|өтініп|сұраймын)\b/i
        ],
        humor: [
            /\b(?:ха-ха|ахаха|хаха|лол|смешно)\b/i,
            /\b(?:haha|funny|lol|lmao)\b/i,
            /\b(?:күлкілі|әзіл|жынды)\b/i
        ],
        positive: [
            /\b(?:ура|круто|отлично|супер|замечательно|прекрасно|поздравляю)\b/i,
            /\b(?:awesome|great|amazing|wonderful|excellent|congrats|congratulations)\b/i,
            /\b(?:қуаныш|алақай|керемет|тамаша|құттықтаймын)\b/i
        ],
        surprise: [
            /\b(?:ого|вау|ничего себе)\b/i,
            /\b(?:wow|whoa)\b/i,
            /\b(?:мәссаған|паһ)\b/i
        ],
        grief: [
            /\b(?:соболезную|жаль|скорб|погиб|погибли|умер|умерла|трагед|увы|печаль)\b/i,
            /\b(?:condolence|grief|mourning|tragic|died|dead|sadly|unfortunately)\b/i,
            /\b(?:қайғы|қаза|қайтыс|өкініш|көңіл айтам)\b/i
        ],
        heavy: [
            /\b(?:войн|конфликт|обстрел|бомб|ракет|дрон|убит|жертв|теракт|катастроф|трагед|насили|геноцид|заложник|беженц|армия|военн)\b/i,
            /\b(?:war|conflict|shelling|bomb|missile|drone|killed|casualt|terror|attack|disaster|traged|violence|massacre|genocide|hostage|refugee|military|army)\b/i,
            /\b(?:соғыс|қақтығыс|бомб|зымыран|дрон|өлім|қаза|құрбан|теракт|апат|қайғы|зорлық|геноцид|әскер|босқын)\b/i
        ],
        sleep: [
            /\b(?:спать|устал|устала|сонный|ночь)\b/i,
            /\b(?:sleep|sleepy|tired|late night)\b/i,
            /\b(?:ұйқы|ұйықтай|шаршадым)\b/i
        ],
        thinking: [
            /\b(?:хм+|хмм+|думаю|наверное|вероятно|возможно)\b/i,
            /\b(?:hm+|hmm+|thinking|maybe|perhaps|likely|consider)\b/i,
            /\b(?:ойлап|ойлаймын|мүмкін|бәлкім)\b/i,
            /\.\.\./
        ],
        sarcasm: [
            /\b(?:подмиг|ирони|сарказм)\b/i,
            /;\)|😉/i,
            /\b(?:yeah right|sure,? right)\b/i,
            /\b(?:қойшы)\b/i
        ],
        anger: [
            /\b(?:хватит|перестань|не смей|достало)\b/i,
            /\b(?:enough|stop that|do not do that)\b/i,
            /\b(?:тоқта|жетеді|істеме)\b/i
        ],
        cool: [
            /\b(?:мощно|стильно|легендарно|эпично)\b/i,
            /\b(?:slick|clean|legendary|epic|impressive)\b/i,
            /\b(?:әсерлі|кербез|эпик)\b/i
        ]
    },

    _normalizeText(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/<[^>]*>/g, ' ')
            .replace(/\[\[[\s\S]*?\]\]/g, ' ')
            .replace(/[`*_#>]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },

    _matchesAny(text, patterns = []) {
        return patterns.some(pattern => pattern.test(text));
    },

    _countMatches(text, patterns = []) {
        return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
    },

    _collectEmotionSignals(responseText, userText = '') {
        const response = this._normalizeText(responseText);
        const user = this._normalizeText(userText);
        const combined = `${user} ${response}`.trim();

        return {
            response,
            user,
            combined,
            isLongForm: response.length > 260,
            technical: this._keywords.geeky.some(w => combined.includes(w)) || String(responseText || '').includes('```'),
            musical: this._keywords.musical.some(w => combined.includes(w)) || combined.includes('🎸'),
            affection: this._matchesAny(combined, this._patterns.affection),
            apology: this._matchesAny(response, this._patterns.apology),
            request: this._matchesAny(response, this._patterns.request),
            humor: this._matchesAny(combined, this._patterns.humor),
            positive: this._matchesAny(combined, this._patterns.positive),
            surprise: this._matchesAny(response, this._patterns.surprise),
            grief: this._matchesAny(combined, this._patterns.grief),
            heavy: this._matchesAny(combined, this._patterns.heavy),
            sleep: this._matchesAny(combined, this._patterns.sleep),
            thinking: this._matchesAny(response, this._patterns.thinking),
            sarcasm: this._matchesAny(response, this._patterns.sarcasm),
            anger: this._matchesAny(response, this._patterns.anger),
            cool: this._matchesAny(response, this._patterns.cool)
        };
    },

    adjustMood(userText) {
        const text = this._normalizeText(userText);

        const posCount = this._countMatches(text, this._patterns.positiveFeedback);
        const negCount = this._countMatches(text, this._patterns.negativeFeedback);

        // Normalizes sentiment score to a continuous range of [-1, 1]
        let s = 0;
        if (posCount + negCount > 0) s = (posCount - negCount) / (posCount + negCount);

        // Loads algorithm parameters from the active configuration
        const { alpha, beta, gamma, delta, affinityRecoveryThreshold, affinityPosScale, affinityNegScaleBase } = this._config;

        const moodOld = Number.isFinite(state.personality.mood) ? state.personality.mood : 50;
        const sarcasmOld = Number.isFinite(state.personality.sarcasm) ? state.personality.sarcasm : 0;
        const affinityOld = Number.isFinite(state.personality.affinity) ? state.personality.affinity : 0;
        let moodNew = moodOld;
        let sarcasmNew = sarcasmOld;
        let affinityNew = affinityOld;

        // Applies dynamic mood and sarcasm adjustments based on direct treatment of Aru
        if (s < 0) {
            moodNew = Math.round(moodOld + Math.round(alpha * s * 100));
            sarcasmNew = Math.round(sarcasmOld + Math.round(beta * (-s) * 100));
            affinityNew = Math.max(0, affinityOld - (Math.round(Math.abs(s) * affinityNegScaleBase) + 10));
        } else if (s > 0) {
            affinityNew = Math.min(100, affinityOld + Math.round(s * affinityPosScale));
            if (affinityNew >= affinityRecoveryThreshold) {
                const scale = (affinityNew - affinityRecoveryThreshold) / (100 - affinityRecoveryThreshold);
                const effectiveScale = Math.max(0.15, scale);
                moodNew = Math.round(moodOld + Math.round(alpha * s * 100 * effectiveScale));
                sarcasmNew = Math.max(0, sarcasmOld - Math.round(beta * s * 100));
            } else {
                sarcasmNew = Math.max(0, sarcasmOld - Math.round(beta * s * 50));
            }
        }

        // Resolves interpersonal coupling logic (e.g. low mood increases sarcasm)
        if (moodNew < 30) sarcasmNew = sarcasmNew + Math.round(gamma * (30 - moodNew));
        if (sarcasmNew > 70) moodNew = moodNew - Math.round(delta * (sarcasmNew - 70));

        // Enforces boundary constraints on calculated vectors
        moodNew = Math.max(0, Math.min(100, moodNew));
        sarcasmNew = Math.max(0, Math.min(100, sarcasmNew));

        // Executes topic-specific humor corrections
        let humorNew = state.personality.humor || 50;
        if (this._keywords.geeky.some(w => text.includes(w))) humorNew = Math.min(100, humorNew + 5);
        if (this._keywords.musical.some(w => text.includes(w))) humorNew = Math.min(100, humorNew + 2);

        const changed = (moodNew !== moodOld) || (sarcasmNew !== sarcasmOld) || (humorNew !== state.personality.humor) || (affinityNew !== affinityOld);

        if (changed) {
            state.setPersonality({ mood: moodNew, sarcasm: sarcasmNew, humor: humorNew, affinity: affinityNew });
            const p = state.personality;
            // Persists updated personality data to local IndexedDB/SQL storage
            try {
                DB.savePersonalityState('global', { mood: p.mood, sarcasm: p.sarcasm, humor: p.humor, affinity: p.affinity });
            } catch (e) {
                console.warn('Failed to persist personality state', e);
            }
        }
    },

    determineEmotion(responseText, context = {}) {
        const signals = this._collectEmotionSignals(responseText, context.userText || '');
        const p = state.personality;

        if (!signals.response) return '';

        // Heavy topics should never receive playful or celebratory stickers
        if (signals.heavy) {
            if (signals.grief) return p.mood < 35 ? 'cry' : 'sad';
            if (signals.apology || signals.request) return 'please';
            if (p.mood < 30) return 'sad';
            return 'thinking';
        }

        if (signals.sleep) return 'sleep';

        if (signals.technical) {
            if (p.mood >= 80 && !signals.isLongForm) return 'cool';
            return 'geek';
        }

        if (signals.apology) return p.mood < 45 ? 'please' : 'sad';
        if (signals.request) return 'please';
        if (signals.affection && p.mood >= 30) return 'love';

        if (signals.musical && p.mood >= 50) return 'rock';

        if (signals.humor) {
            if (p.mood >= 70 && p.humor >= 60) return 'crazy';
            if (p.mood >= 45) return 'happy';
            return 'oh';
        }

        if (signals.anger && p.mood < 25) return 'angry';
        if (signals.cool && p.mood >= 80) return 'cool';

        if (signals.surprise && p.mood >= 55) {
            return p.mood >= 75 ? 'wow' : 'happy';
        }

        if (signals.positive) {
            if (p.mood >= 75) return 'happy';
            if (p.mood >= 55 && !signals.isLongForm) return 'normal';
            return '';
        }

        if (signals.sarcasm && p.sarcasm >= 55 && p.mood >= 35 && !signals.isLongForm) {
            return 'oh';
        }

        if (signals.thinking) return 'thinking';

        // Neutral long answers are better without stickers than with random reactions
        if (signals.isLongForm) {
            if (p.mood < 30) return 'sad';
            return '';
        }

        if (p.mood < 20) return 'sad';
        if (p.mood > 75 && signals.response.length < 120) return 'normal';
        if (signals.response.length < 90 && p.mood >= 40) return 'normal';

        return '';
    },

    getPersonalityPrompt() {
        const p = state.personality;

        // Translates numeric limits into a readable sentiment profile
        let moodDesc = 'Normal';
        if (p.mood > 90) moodDesc = 'Elated, very enthusiastic';
        else if (p.mood > 70) moodDesc = 'Happy, cheerful';
        else if (p.mood < 20) moodDesc = 'Angry, resentful';
        else if (p.mood < 40) moodDesc = 'Sad, low energy';

        let toneDesc = 'Helpful';
        if (p.sarcasm > 60) toneDesc = 'Sarcastic, witty';

        // Converts metric logic into absolute flags optimized for LLM comprehension
        const allowSarcasm = (p.sarcasm > 30) && (p.mood > 30);
        const useEmoji = p.mood >= 60;
        const verbosity = p.mood < 30 ? 'brief' : (p.mood > 75 ? 'detailed' : 'normal');

        // Assembles the structured system payload
        const flags = `FLAGS: ALLOW_SARCASM=${allowSarcasm}; USE_EMOJI=${useEmoji}; VERBOSITY=${verbosity}; MOOD=${p.mood}; SARCASM=${p.sarcasm}; AVOID_PLAYFUL_ON_HEAVY_TOPICS=true`;
        const human = `Current State: Mood ${p.mood}/100 (${moodDesc}); Sarcasm ${p.sarcasm}/100 (${toneDesc}).`;
        const guidance = 'Tone Guidance: - If mood is low be concise and neutral. - If sarcasm is high, you may use mild ironic humor. - If mood is high, be warm and friendly, but only on light topics. - When discussing war, death, illness, violence, disasters, loss, or grief, stay respectful and restrained. Never use celebratory emojis, jokes, or playful approval on heavy topics. - Use emojis only if USE_EMOJI is true and the context is genuinely appropriate.';

        return `${flags}\n${human}\n${guidance}`;
    }
};
