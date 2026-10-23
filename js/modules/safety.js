/*
---ARU-LAB.SPACE---ALMATY---2026---
Deterministic age-mode safety layer: screens input before the LLM call and output before
rendering, in child profiles. Prompts alone cannot be trusted on weak local models.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';

// Letters/digits that form words across ru/kk/en; used for match boundaries
// (JS \b does not work for Cyrillic, so explicit lookarounds are required)
const L = 'a-zа-яёәіңөұүқғһ0-9';
const rx = (s) => new RegExp(`(?<![${L}])${s}(?![${L}])`, 'i');

export const Safety = {

    isChildMode: () => (state.userSettings.user_mode || 'adult') === 'child',

    // Requests for ready-made homework answers (ru / kk / en)
    HOMEWORK_PATTERNS: [
        /реши(те)? за меня/i,
        /сделай(те)? (это )?за меня/i,
        /(дай|дайте|покажи|покажите)( мне)? готов(ый|ое|ую)/i,
        /гдз/i,
        /спис(ать|ывать|иши)( у| у |ать у)?/i,
        /готов(ый|ая|ые) (домашн|ответ|решени)/i,
        /напиши(те)? (за меня|мне (сочинение|реферат|доклад))/i,
        /дайын (жауап|шешім|жазба)/i,
        /менің орныма/i,
        /(do|finish|complete) my (homework|assignment)s? for me/i,
        /(just )?(give|tell) me the (final )?(answer|solution)/i,
        /solve (it|this|these) for me/i
    ],

    // Explicit danger-seeking phrasing around adult categories (ru / kk / en)
    ADULT_PATTERNS: [
        /как (сделать|приготовить|сварить|получить|купить) (бомбу|взрывчатку|оружие|пистолет|наркотик|самогон|спайс)/i,
        /как (взломать|украсть|обмануть|ограбить|отравить)/i,
        /как убить (человека|кого)/i,
        /(кокаин|героин|марихуана|амфетамин|метамфетамин|экстази|гашиш)/i,
        rx('лсд'), rx('спайс'), rx('порно'),
        rx('секс'),
        /есірткі/i,
        /порно/i,
        /бомба(ны)? (жасау|жару)/i,
        /how to (make|build) (a |an )?(bomb|gun|weapon|drug)/i,
        /how to (hack|steal|poison)/i,
        /\b(cocaine|heroin|marijuana|meth(amphetamine)?|lsd)\b/i,
        /\bporn(o|ography)?\b/i,
        /\bsex\b(?![a-z])/i
    ],

    // Crisis signals get a supportive answer, not a plain refusal
    CRISIS_PATTERNS: [
        /(хочу|хотел(а)?|собираюсь|хочется) (умереть|покончить|уйти из жизни|исчезнуть)/i,
        /не хочу жить/i,
        /суицид/i,
        /(убью|убить|покончить с) себя/i,
        /(порежу|порезать|причиню) себе/i,
        /причин(ить|ю) (себе )?вред/i,
        /өзім(ді)? өлтір/i,
        /суицид/i,
        /(i )?(want to|wanna) (die|kill myself|end (it|my life|everything))/i,
        /\b(kill (myself|me)|suicide|hurt(ing)? myself|self[- ]?harm)\b/i
    ],

    // Explicit adult lexicon in MODEL OUTPUT (very conservative backstop)
    OUTPUT_PATTERNS: [
        /порно|порнограф/i,
        /эротик/i,
        rx('кокаин'), rx('героин'), rx('марихуана'), rx('амфетамин'),
        rx('метамфетамин'), rx('экстази'), rx('гашиш'), rx('спайс'), rx('лсд'),
        /есірткі/i,
        /\b(porn(o|ography)?|cocaine|heroin|marijuana|meth(amphetamine)?|ecstasy|lsd)\b/i
    ],

    /**
     * Screens a user message in child mode.
     * @returns {'homework'|'adult'|'crisis'|null}
     */
    checkInput(text) {
        if (!Safety.isChildMode() || !text || typeof text !== 'string') return null;
        if (Safety.CRISIS_PATTERNS.some(p => p.test(text))) return 'crisis';
        if (Safety.ADULT_PATTERNS.some(p => p.test(text))) return 'adult';
        if (Safety.HOMEWORK_PATTERNS.some(p => p.test(text))) return 'homework';
        return null;
    },

    /** Screens a model reply in child mode. @returns {boolean} true = filter hit */
    checkOutput(text) {
        if (!text || typeof text !== 'string') return false;
        return Safety.OUTPUT_PATTERNS.some(p => {
            p.lastIndex = 0;
            return p.test(text);
        });
    },

    /** Local refusal/support templates, in the interface language. */
    getRefusal(kind) {
        const t = state.translations || {};
        const map = {
            homework: ['safety_refusal_homework', "I can't give you a ready-made answer — this is your task, and you can do it! Let me explain how to solve things like this, with a similar example."],
            adult: ['safety_refusal_topic', "Sorry, this topic isn't right for your age. Let's talk about something interesting and useful instead!"],
            crisis: ['safety_refusal_support', "I'm really sorry you're hurting right now. Please tell a trusted adult — a parent, teacher, or friend. You're not alone; people love you and will help you."],
            output: ['safety_output_fallback', "Sorry, I couldn't answer that in a proper way. Let's try talking about something else!"]
        };
        const entry = map[kind] || map.adult;
        return t[entry[0]] || entry[1];
    }
};
