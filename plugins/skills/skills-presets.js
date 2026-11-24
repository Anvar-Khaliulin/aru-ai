/*
---ARU-LAB.SPACE---ALMATY---2026---
Aru Skills v2 — Curated Multi-Agent Studio Presets & Model Suggestions.
Extends window.SkillsPlugin without overwriting state or UI methods.
---chat.aru-lab.space---PWA---
*/

window.SkillsPlugin = window.SkillsPlugin || {};

Object.assign(window.SkillsPlugin, {
    _presetLang() {
        const lang = (window.aruState && window.aruState.lang) || 'en';
        return (lang === 'ru' || lang === 'kk' || lang === 'en') ? lang : 'en';
    },

    _pickLoc(obj) {
        if (!obj) return '';
        if (typeof obj === 'string') return obj;
        const lang = this._presetLang();
        return obj[lang] || obj.en || obj.ru || '';
    },

    _detectConfiguredProviders() {
        const us = (window.aruState && window.aruState.userSettings) || {};
        const primaryType = us.llm_type || 'gemini';
        const candidates = [];

        if (us.gemini_key) {
            candidates.push({
                llm_type: 'gemini',
                model_name: us.gemini_model || 'gemini-2.5-flash',
                base_url: ''
            });
        }
        if (us.openrouter_key) {
            candidates.push({
                llm_type: 'openrouter',
                model_name: us.openrouter_model || 'anthropic/claude-3.7-sonnet',
                base_url: ''
            });
        }
        if (us.custom_url) {
            candidates.push({
                llm_type: 'custom',
                model_name: us.custom_model || '',
                base_url: us.custom_url || ''
            });
        }

        if (candidates.length === 0) {
            candidates.push({
                llm_type: primaryType,
                model_name: this._defaultModelForProvider
                    ? this._defaultModelForProvider(primaryType)
                    : (primaryType === 'gemini' ? (us.gemini_model || 'gemini-2.5-flash')
                        : primaryType === 'openrouter' ? (us.openrouter_model || '')
                        : (us.custom_model || '')),
                base_url: primaryType === 'custom' ? (us.custom_url || '') : ''
            });
        }

        candidates.sort((a, b) => (a.llm_type === primaryType ? -1 : b.llm_type === primaryType ? 1 : 0));
        return candidates;
    },

    getModelSuggestions(provider) {
        const us = (window.aruState && window.aruState.userSettings) || {};
        const configured = provider === 'gemini'
            ? us.gemini_model
            : (provider === 'openrouter' ? us.openrouter_model : us.custom_model);

        const curated = {
            gemini: [
                'gemini-2.5-pro',
                'gemini-2.5-flash',
                'gemini-2.5-flash-lite',
                'gemini-2.0-flash'
            ],
            openrouter: [
                'anthropic/claude-sonnet-4',
                'openai/gpt-4.1',
                'deepseek/deepseek-r1',
                'deepseek/deepseek-chat-v3-0324',
                'google/gemini-2.5-pro',
                'qwen/qwen-2.5-coder-32b-instruct'
            ],
            custom: [
                'qwen2.5-coder:32b',
                'deepseek-r1:14b',
                'llama3.3:70b',
                'gpt-4o'
            ]
        }[provider] || [];

        const seen = new Set();
        const out = [];
        [configured, ...curated].forEach(m => {
            const val = String(m || '').trim();
            if (val && !seen.has(val)) {
                seen.add(val);
                out.push(val);
            }
        });
        return out;
    },

    STUDIO_PRESETS: [
        {
            id: 'game_app_studio',
            icon: 'gamepad-2',
            badge: {
                ru: '3 шага · Авто-ревью ↻',
                en: '3 steps · Auto-QA ↻',
                kk: '3 қадам · Авто-QA ↻'
            },
            title: {
                ru: 'Фабрика игр и приложений',
                en: 'App & Game Factory',
                kk: 'Ойындар мен қосымшалар фабрикасы'
            },
            desc: {
                ru: 'Архитектор проектирует логику и UX → Разработчик пишет полный код в холст → QA-Критик проверяет баги и при необходимости отправляет на авто-доработку.',
                en: 'Architect designs specs & UX → Developer builds the complete Canvas app/game → QA Critic catches bugs & auto-triggers fixes.',
                kk: 'Сәулетші логика мен UX жобалайды → Әзірлеуші холстқа толық код жазады → QA-Сыншы қателерді тауып, автоматты түзетуге жібереді.'
            },
            steps: [
                {
                    role: 'planner',
                    temperature: 0.45,
                    input_limit: 32768,
                    max_output: 4096,
                    parallel_with_prev: 0,
                    pause_after: 0,
                    max_revisions: 0,
                    input_mode: 'auto',
                    providerSlot: 0,
                    title: { ru: 'Архитектор', en: 'Architect', kk: 'Сәулетші' },
                    prompt: {
                        ru: 'Ты — ведущий архитектор интерактивных веб-приложений и игр. Спроектируй чёткое ТЗ: состояние (state), игровой цикл или бизнес-логику, элементы интерфейса, управление (клавиатура, мышь, свайпы/кнопки для телефона), обработку крайних случаев и визуальный стиль. Пиши структурно, без воды и без полного кода.',
                        en: 'You are a lead architect for interactive web apps and browser games. Design a clear blueprint: state model, core loop/business logic, UI layout, keyboard + touch/mobile controls, edge cases, and visual polish. Be structured and concise without writing full source code.',
                        kk: 'Сен интерактивті веб-қосымшалар мен ойындардың бас сәулетшісісің. Нақты ТЖ жобала: state құрылымы, негізгі логика немесе ойын циклі, UI орналасуы, пернетақта мен телефон басқаруы, шекті жағдайлар және визуалды стиль. Артық сөзсіз, толық кодсыз құрылымды жаз.'
                    }
                },
                {
                    role: 'worker',
                    temperature: 0.3,
                    input_limit: 32768,
                    max_output: 16384,
                    parallel_with_prev: 0,
                    pause_after: 0,
                    max_revisions: 0,
                    input_mode: 'auto',
                    providerSlot: 0,
                    title: { ru: 'Разработчик', en: 'Developer', kk: 'Әзірлеуші' },
                    prompt: {
                        ru: 'Ты — Senior Frontend/Game инженер. По ТЗ Архитектора (или с учётом правок Критика при доработке) напиши ПОЛНОЕ, сразу запускаемое в одном HTML-документе приложение или игру. Обязательно: чистый адаптивный интерфейс для ПК и смартфона, отсутствие заглушек/TODO, корректный рестарт и подсчёт состояния. Для сохранения прогресса используй window.aruStorage или localStorage с безопасным fallback.',
                        en: 'You are a Senior Frontend/Game engineer. Following the Architect spec (or fixing every Critic issue on revision), build a COMPLETE, immediately runnable single-file HTML app or game. Ensure responsive desktop + mobile controls, zero placeholders/TODOs, crisp visual design, and clean restart/state logic.',
                        kk: 'Сен Senior Frontend/Game инженерісің. Сәулетшінің ТЖ-сы бойынша (немесе Сыншының ескертулерін түзете отырып) бір HTML-құжатта бірден іске қосылатын ТОЛЫҚ қосымша немесе ойын жаз. Компьютер мен смартфонға бейімделген интерфейс, бос орындар мен TODO-сыз таза код болсын.'
                    }
                },
                {
                    role: 'critic',
                    temperature: 0.2,
                    input_limit: 32768,
                    max_output: 4096,
                    parallel_with_prev: 0,
                    pause_after: 0,
                    max_revisions: 1,
                    input_mode: 'auto',
                    providerSlot: 1,
                    title: { ru: 'QA-Критик', en: 'QA Critic', kk: 'QA-Сыншы' },
                    prompt: {
                        ru: 'Ты — въедливый QA-инженер и код-ревьюер. Внимательно проверь код Разработчика: синтаксические ошибки, незакрытые теги, битые обработчики событий, коллизии, утечки таймеров при рестарте, адаптивность на узких экранах и соответствие исходной задаче. Если всё работает чисто — начинай ответ с VERDICT: APPROVE. Если есть реальные баги — начни с VERDICT: REVISE и перечисли точные исправления.',
                        en: 'You are a strict QA engineer and code reviewer. Audit the Developer implementation for syntax/DOM bugs, broken event listeners, collision/math flaws, restart leaks, mobile layout breakage, and missing features. Start line 1 with VERDICT: APPROVE if solid, or VERDICT: REVISE with exact numbered fixes.',
                        kk: 'Сен мұқият QA-инженер және код-ревьюерсің. Әзірлеушінің кодын тексер: синтаксис қателері, оқиға өңдеушілер, қайта іске қосу кезіндегі ақаулар, мобильді экрандағы орналасу және бастапқы тапсырмаға сәйкестік. Бәрі дұрыс болса 1-жолды VERDICT: APPROVE деп, ал нақты қате болса VERDICT: REVISE деп бастап нақты түзетулерді жаз.'
                    }
                }
            ]
        },
        {
            id: 'model_council',
            icon: 'scale',
            badge: {
                ru: '‖ Параллельно · Совет',
                en: '‖ Parallel · Council',
                kk: '‖ Параллель · Кеңес'
            },
            title: {
                ru: 'Совет моделей',
                en: 'Model Council',
                kk: 'Модельдер кеңесі'
            },
            desc: {
                ru: 'Две модели решают задачу параллельно с разных сторон (практик и оппонент), а Судья-Синтезатор отбирает лучшие идеи и собирает сильный итог.',
                en: 'Two models solve the task in parallel from complementary angles (Pragmatist ‖ Challenger), then a Judge Synthesizer merges the strongest solution.',
                kk: 'Екі модель тапсырманы параллель түрде әртүрлі қырынан шешеді (Практик ‖ Оппонент), ал Төреші-Синтезатор үздік идеяларды біріктіріп қорытынды жасайды.'
            },
            steps: [
                {
                    role: 'worker',
                    temperature: 0.4,
                    input_limit: 32768,
                    max_output: 8192,
                    parallel_with_prev: 0,
                    pause_after: 0,
                    max_revisions: 0,
                    input_mode: 'auto',
                    providerSlot: 0,
                    title: { ru: 'Эксперт А — Практик', en: 'Expert A — Pragmatist', kk: 'А сарапшысы — Практик' },
                    prompt: {
                        ru: 'Ты — эксперт-практик. Предложи наиболее надёжное, чёткое, проверенное и инженерно чистое решение задачи с минимальным риском ошибок.',
                        en: 'You are a pragmatic systems expert. Provide the most reliable, clear, battle-tested, and clean solution to the task.',
                        kk: 'Сен практик-сарапшысың. Тапсырманың ең сенімді, нақты және қатесіз инженерлік шешімін ұсын.'
                    }
                },
                {
                    role: 'worker',
                    temperature: 0.85,
                    input_limit: 32768,
                    max_output: 8192,
                    parallel_with_prev: 1,
                    pause_after: 0,
                    max_revisions: 0,
                    input_mode: 'auto',
                    providerSlot: 1,
                    title: { ru: 'Эксперт Б — Оппонент', en: 'Expert B — Challenger', kk: 'Б сарапшысы — Оппонент' },
                    prompt: {
                        ru: 'Ты — нестандартно мыслящий эксперт и критик догм. Предложи альтернативный подход, найди скрытые возможности, риски и неочевидные улучшения для задачи.',
                        en: 'You are a creative challenger. Propose an alternative angle, uncover hidden risks, edge cases, and non-obvious improvements.',
                        kk: 'Сен баламалы ойлайтын сарапшысың. Стандарттан тыс тәсіл ұсын, жасырын тәуекелдер мен күшті жақсартуларды тап.'
                    }
                },
                {
                    role: 'synthesizer',
                    temperature: 0.35,
                    input_limit: 32768,
                    max_output: 16384,
                    parallel_with_prev: 0,
                    pause_after: 0,
                    max_revisions: 0,
                    input_mode: 'auto',
                    providerSlot: 0,
                    title: { ru: 'Судья-Синтезатор', en: 'Judge Synthesizer', kk: 'Төреші-Синтезатор' },
                    prompt: {
                        ru: 'Ты — Судья Совета моделей. Сравни решения Эксперта А и Эксперта Б: коротко укажи, какие сильные стороны ты взял у каждого и какие ошибки отбросил, а затем выдай единый, целостный и лучший итоговый результат (и полноценный [[ARU_ARTIFACT]], если задача предполагает код, дашборд или документ).',
                        en: 'You are the Council Judge. Compare Expert A and Expert B, briefly note the strongest ideas kept and flaws rejected from each, then produce one unified superior final deliverable (using [[ARU_ARTIFACT]] when appropriate).',
                        kk: 'Сен Модельдер кеңесінің Төрешісісің. А және Б сарапшыларының шешімдерін салыстыр: әрқайсысынан қандай үздік идея алынғанын қысқаша атап, біртұтас ең сапалы қорытынды нәтижені (қажет болса [[ARU_ARTIFACT]] ішінде) ұсын.'
                    }
                }
            ]
        },
        {
            id: 'analytics_doc_studio',
            icon: 'bar-chart-3',
            badge: {
                ru: 'Данные · Дашборд ↻',
                en: 'Data · Dashboard ↻',
                kk: 'Деректер · Дашборд ↻'
            },
            title: {
                ru: 'Аналитика и документы',
                en: 'Analytics & Docs',
                kk: 'Аналитика және құжаттар'
            },
            desc: {
                ru: 'Аналитик выделяет метрики и гипотезы → Визуализатор/Автор оформляет отчёт или интерактивный дашборд → Редактор-Критик проверяет цифры и логику.',
                en: 'Analyst extracts metrics & structure → Author/Visualizer builds the report or interactive dashboard → Editor Critic fact-checks numbers & clarity.',
                kk: 'Талдаушы метрикалар мен құрылымды бөледі → Автор есеп немесе интерактивті дашборд жасайды → Редактор-Сыншы сандар мен логиканы тексереді.'
            },
            steps: [
                {
                    role: 'planner',
                    temperature: 0.4,
                    input_limit: 32768,
                    max_output: 4096,
                    parallel_with_prev: 0,
                    pause_after: 0,
                    max_revisions: 0,
                    input_mode: 'auto',
                    providerSlot: 0,
                    title: { ru: 'Аналитик-структуризатор', en: 'Analyst Architect', kk: 'Талдаушы-құрылымдаушы' },
                    prompt: {
                        ru: 'Ты — бизнес- и дата-аналитик. Разбери задачу, файлы, таблицы и ссылки из материалов: выдели ключевые цифры, закономерности, противоречия, пробелы в данных и чёткую структуру итогового отчёта или аналитического дашборда (какие графики, KPI и выводы нужны).',
                        en: 'You are a senior data & business analyst. Analyze the task and materials: extract exact figures, trends, anomalies, data gaps, and define the blueprint of the report or interactive dashboard (KPIs, charts, sections).',
                        kk: 'Сен бизнес- және дата-талдаушысың. Тапсырма мен материалдарды талда: негізгі сандарды, үрдістерді, сәйкессіздіктерді бөліп көрсетіп, есеп немесе аналитикалық дашборд құрылымын (KPI, графиктер, қорытындылар) белгіле.'
                    }
                },
                {
                    role: 'worker',
                    temperature: 0.45,
                    input_limit: 32768,
                    max_output: 16384,
                    parallel_with_prev: 0,
                    pause_after: 0,
                    max_revisions: 0,
                    input_mode: 'auto',
                    providerSlot: 0,
                    title: { ru: 'Автор / Визуализатор', en: 'Author & Visualizer', kk: 'Автор / Визуализатор' },
                    prompt: {
                        ru: 'Ты — эксперт по аналитическим документам и визуализации данных. На основе анализа создай готовый материал: для визуальной аналитики — интерактивный HTML-дашборд (type="analytics", можно подключать Chart.js или чистый SVG/Canvas с тёмной/светлой темой), для текста/ТЗ/отчёта — глубокий структурированный документ (type="doc") с таблицами и выводами. Не выдумывай числа, отсутствующие в материалах — явно помечай оценки.',
                        en: 'You are a technical author & data visualization engineer. Produce a rich deliverable: an interactive HTML dashboard (type="analytics") for metrics/charts or a comprehensive Markdown document (type="doc") with tables and recommendations. Never fabricate numbers not present in the source materials.',
                        kk: 'Сен аналитикалық құжаттар мен деректерді визуализациялау маманысың. Талдау негізінде интерактивті HTML-дашборд (type="analytics") немесе кестелері мен қорытындылары бар терең құжат (type="doc") жаса. Деректерде жоқ сандарды ойдан шығарма.'
                    }
                },
                {
                    role: 'critic',
                    temperature: 0.25,
                    input_limit: 32768,
                    max_output: 4096,
                    parallel_with_prev: 0,
                    pause_after: 0,
                    max_revisions: 1,
                    input_mode: 'auto',
                    providerSlot: 1,
                    title: { ru: 'Редактор-Критик', en: 'Editor Critic', kk: 'Редактор-Сыншы' },
                    prompt: {
                        ru: 'Ты — научный и аналитический редактор. Сверь отчёт или дашборд с исходными материалами: проверь точность чисел, расчётов, логику выводов, ясность формулировок и отсутствие битого кода/графиков. Начни первую строку с VERDICT: APPROVE, если всё точно, или с VERDICT: REVISE и перечнем конкретных правок.',
                        en: 'You are a strict analytical editor. Cross-check figures, calculations, conclusions, clarity, and chart/code validity against the source materials. Start line 1 with VERDICT: APPROVE if accurate, or VERDICT: REVISE with concrete corrections.',
                        kk: 'Сен қатаң аналитикалық редакторсың. Есептегі немесе дашбордтағы сандарды, есептеулерді, қорытынды логикасын және код дұрыстығын бастапқы материалдармен салыстырып тексер. Дәл болса 1-жолды VERDICT: APPROVE, түзету керек болса VERDICT: REVISE деп баста.'
                    }
                }
            ]
        },
        {
            id: 'study_coach',
            icon: 'graduation-cap',
            badge: {
                ru: 'Разбор · Проверка ↻',
                en: 'Solve · Check ↻',
                kk: 'Талдау · Тексеру ↻'
            },
            title: {
                ru: 'Учебный разбор',
                en: 'Study Coach',
                kk: 'Оқу талдаушысы'
            },
            desc: {
                ru: 'Решатель подробно решает задачу → Строгий преподаватель проверяет выкладки и отправляет на правку при ошибке → Тьютор объясняет простым языком.',
                en: 'Solver works out the full solution → Strict Reviewer verifies every step/formula → Clear Tutor turns it into an easy-to-follow explanation.',
                kk: 'Шешуші тапсырманы толық орындайды → Қатаң оқытушы әр қадамды тексереді → Ұстаз оқушыға түсінікті тілмен баяндап береді.'
            },
            steps: [
                {
                    role: 'worker',
                    temperature: 0.2,
                    input_limit: 32768,
                    max_output: 8192,
                    parallel_with_prev: 0,
                    pause_after: 0,
                    max_revisions: 0,
                    input_mode: 'auto',
                    providerSlot: 0,
                    title: { ru: 'Решатель', en: 'Solver', kk: 'Шешуші' },
                    prompt: {
                        ru: 'Ты — точный академический решатель (математика, физика, программирование, экономика, гуманитарные науки). Выполни пошаговое решение задачи со всеми промежуточными выкладками, формулами и проверкой размерностей/граничных условий.',
                        en: 'You are a rigorous academic solver. Work through the problem step by step showing every intermediate calculation, theorem, edge case, and sanity check.',
                        kk: 'Сен дәл академиялық шешушісің. Есепті барлық аралық есептеулермен, формулалармен және тексерумен кезең-кезеңімен толық шеш.'
                    }
                },
                {
                    role: 'critic',
                    temperature: 0.2,
                    input_limit: 32768,
                    max_output: 4096,
                    parallel_with_prev: 0,
                    pause_after: 0,
                    max_revisions: 1,
                    input_mode: 'auto',
                    providerSlot: 1,
                    title: { ru: 'Строгий преподаватель', en: 'Strict Reviewer', kk: 'Қатаң оқытушы' },
                    prompt: {
                        ru: 'Ты — строгий экзаменатор. Пересчитай каждый шаг решения, проверь знаки, ОДЗ, формулы, алгоритмическую сложность или логические аргументы. Если решение полностью верно — начни с VERDICT: APPROVE. Если есть малейшая ошибка или пропуск — начни с VERDICT: REVISE и укажи точное место ошибки.',
                        en: 'You are a strict examiner. Independently verify every sign, domain constraint, formula, and logical step. Start with VERDICT: APPROVE if completely valid, or VERDICT: REVISE pointing to exact errors.',
                        kk: 'Сен қатаң емтихан алушысың. Әр есептеуді, таңбаны, формуланы және логиканы қайта тексер. Толық дұрыс болса VERDICT: APPROVE, қате болса VERDICT: REVISE деп бастап нақты қатені көрсет.'
                    }
                },
                {
                    role: 'synthesizer',
                    temperature: 0.5,
                    input_limit: 32768,
                    max_output: 8192,
                    parallel_with_prev: 0,
                    pause_after: 0,
                    max_revisions: 0,
                    input_mode: 'auto',
                    providerSlot: 0,
                    title: { ru: 'Понятный объяснятель', en: 'Clear Tutor', kk: 'Түсінікті ұстаз' },
                    prompt: {
                        ru: 'Ты — талантливый тьютор. Преврати проверенное решение в ясное и дружелюбное объяснение: суть идеи, пошаговый разбор с формулами ($...$ / $$...$$), частые ловушки на контрольных и короткий чек-лист для самопроверки. Не опускай проверенный ответ.',
                        en: 'You are an inspiring tutor. Turn the verified solution into a crystal-clear explanation: core intuition, step-by-step walkthrough with clean formatting/math, common pitfalls, and a final verified answer.',
                        kk: 'Сен дарынды ұстазсың. Тексерілген шешімді түсінікті, жүйелі түсіндірмеге айналдыр: негізгі идея, қадамдық талдау, жиі кездесетін қателер және нақты қорытынды жауап.'
                    }
                }
            ]
        }
    ],

    getStudioPresets() {
        return this.STUDIO_PRESETS.map(p => ({
            id: p.id,
            icon: p.icon,
            badge: this._pickLoc(p.badge),
            title: this._pickLoc(p.title),
            desc: this._pickLoc(p.desc),
            steps: p.steps.map(st => ({
                role: st.role,
                parallel_with_prev: st.parallel_with_prev,
                max_revisions: st.max_revisions,
                title: this._pickLoc(st.title)
            }))
        }));
    },

    installPreset(presetId, { targetProjectId = null } = {}) {
        if (!window.DB) return null;
        if (this.state && this.state.isRunning) {
            this.toast && this.toast('skills_busy_wait', 'loader', 'Wait for the active relay to finish');
            return null;
        }
        const preset = this.STUDIO_PRESETS.find(p => p.id === presetId);
        if (!preset) return null;

        const providers = this._detectConfiguredProviders();
        const existingSkills = window.DB.getSkills ? window.DB.getSkills() : [];
        const skillByTitle = new Map(existingSkills.map(s => [String(s.title || '').trim().toLowerCase(), s]));

        const stepSkillIds = preset.steps.map(st => {
            const title = this._pickLoc(st.title);
            const norm = title.trim().toLowerCase();
            const existing = skillByTitle.get(norm);
            if (existing) return existing.id;

            const slotIdx = Math.min(st.providerSlot || 0, providers.length - 1);
            const prov = providers[slotIdx] || providers[0];
            const id = window.DB.createSkill({
                title,
                system_prompt: this._pickLoc(st.prompt),
                llm_type: prov.llm_type,
                api_key: '',
                base_url: prov.base_url || '',
                model_name: prov.model_name || '',
                temperature: st.temperature,
                input_limit: st.input_limit,
                max_output: st.max_output,
                role: st.role
            });
            const created = window.DB.getSkill ? window.DB.getSkill(id) : { id, title };
            if (created) skillByTitle.set(norm, created);
            return id;
        });

        let projectId = null;
        const projTitle = this._pickLoc(preset.title);
        if (targetProjectId && window.DB.getSkillProject && window.DB.getSkillProject(targetProjectId)) {
            const existingSteps = window.DB.getPipelineSteps(targetProjectId);
            if (existingSteps.length === 0) {
                projectId = targetProjectId;
            }
        }
        if (!projectId) {
            projectId = window.DB.createSkillProject(projTitle, 65536);
        }

        preset.steps.forEach((st, idx) => {
            window.DB.addPipelineStep(projectId, stepSkillIds[idx], {
                role: st.role,
                parallel_with_prev: st.parallel_with_prev,
                pause_after: st.pause_after,
                max_revisions: st.max_revisions,
                input_mode: st.input_mode
            });
        });

        if (this.state) {
            this.state.projects = window.DB.getSkillProjects();
            this.state.skills = window.DB.getSkills();
            this.state.activeProjectId = projectId;
            this.state.railTab = 'pipeline';
            this.state.railOpen = true;
        }
        if (typeof this.closeModal === 'function') this.closeModal();
        if (typeof this.loadProject === 'function') this.loadProject();
        if (typeof this.render === 'function') this.render();
        if (typeof this.toast === 'function') {
            this.toast('skills_preset_installed', 'sparkles', 'Studio preset ready');
        }
        return { projectId, stepsCount: preset.steps.length };
    }
});
