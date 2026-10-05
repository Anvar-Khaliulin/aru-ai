# Aru AI — Getting Started

This guide describes four ways to use Aru AI:

1. Open the already-hosted PWA.
2. Clone the repository and host your own copy.
3. Run the app locally on your computer.
4. Publish your own installable PWA.

Aru AI is a static web application: there is no build step or application server required. A web server is still needed to serve it; opening `index.html` directly with a `file://` URL will not work reliably because the app uses JavaScript modules and a service worker.

## 1. Use the existing PWA

Open **https://chat.aru-lab.space** in a supported browser. You do not need to clone the repository or set up hosting.

To install it, use your browser's **Install app** or **Add to Home Screen** command. The wording and availability depend on the browser and device. The app shell can be cached for offline opening after it has been loaded, but AI providers, web search, remote storage, and other external services still need a network connection. Some external libraries and the embedding model are also loaded from CDNs.

## 2. Clone the repository and host your own copy

Clone the repository:

```sh
git clone https://github.com/Anvar-Khaliulin/aru-ai.git
cd aru-ai
```

The app is made of static files, so no `npm install`, compilation, or backend service is required. Upload the repository's app files to a static web host, or serve the cloned folder using the local instructions below. Keep the directory structure intact.

For the simplest deployment, serve the app from the **root of its own HTTPS host**, for example `https://ai.example.com/`. HTTPS is required for service workers and is also needed for many browser capabilities. `localhost` is treated as a secure context for local development.

The repository is configured around root hosting: the manifest uses `/` for its start URL and scope, and the service worker recognizes root-level application paths. Hosting under a subdirectory such as `https://example.com/aru/` may require path and scope updates in `manifest.json`, the service-worker registration in `index.html`, and `sw.js`.

## 3. Run the app locally on your computer

Install or use Python 3, then run a static server from the repository root:

```sh
python3 -m http.server 8000
```

On Windows, this may be:

```powershell
py -m http.server 8000
```

Open **http://localhost:8000** in your browser. Keep the terminal and server running while using the app. To use the app from another device on your local network, bind the server to your computer's LAN interface or `0.0.0.0`, then open the computer's LAN address on that device; local-network access and service-worker support can depend on browser security rules.

For private/LAN LLMs, configure the provider in Aru AI's setup or settings and make sure the model server allows browser requests from the app (CORS). A browser may block insecure HTTP requests from an HTTPS-hosted copy; using `localhost` for local development or configuring HTTPS on the host avoids many such mixed-content restrictions.

## 4. Publish your own installable PWA

1. Clone the repository and deploy it to your own HTTPS host. Start by hosting it at the domain root.
2. Update `manifest.json` with your app name, description, icons, and the correct `start_url` and `scope` for your deployment.
3. Update `sw.js` for your copy:
   - Change `APP_VERSION` whenever you publish a new release. It is part of the cache name and lets the worker distinguish the new app shell from the previous one.
   - Review `ASSETS_TO_CACHE` and include every local file needed for the app shell while offline. Remove entries that do not exist in your copy; add any new local assets.
   - Check `APP_PATH_PREFIXES` and `isSameOriginAppRequest()`. They currently recognize root paths such as `/js/` and `/css/`; adapt them if the app is served below a URL subdirectory.
   - Check `getOfflineShell()` and the asset URLs in `precacheAssets()` against your deployment path.
4. Check the service-worker registration in `index.html`. It currently registers `sw.js` relative to the app URL. Make sure this URL and the worker's scope cover the deployed app.
5. Deploy the files, open the HTTPS URL online, and let the service worker install. Check the browser's application/developer tools for registration and cache errors, then reload and test offline access.

The current worker uses a **network-first** strategy for app requests: it prefers a fresh response and falls back to cached files when offline. The pre-cache list is the offline app shell, not a promise that every feature works without internet. External CDNs, cloud LLMs, web search, Google Drive/WebDAV, and other remote services remain network-dependent.

If an update does not appear, reload the page and inspect the service-worker status in browser developer tools. During testing, you can unregister the worker and clear the site's Cache Storage. Do not change `CACHE_PREFIX` unless you intend to use a separate cache namespace for your deployment.

## Data and privacy notes

- Chat requests go to the LLM provider configured by the user. A local model can keep those requests on the user's device or network, subject to the local server configuration.
- Web search and remote storage contact their selected providers.
- The local SQLite database is not encrypted by default. Protect exported database files and backups accordingly.
- Keep API keys and credentials out of the repository and public static files. Enter them in the app's settings instead.

---

# Aru AI — Начало работы

В этой инструкции описаны четыре способа использовать Aru AI:

1. Открыть уже размещённое PWA.
2. Клонировать репозиторий и разместить свою копию.
3. Запустить приложение локально на компьютере.
4. Опубликовать собственное устанавливаемое PWA.

Aru AI — статическое веб-приложение: этап сборки и сервер приложения не нужны. Однако для раздачи файлов нужен веб-сервер. Открывать `index.html` напрямую через адрес `file://` ненадёжно: приложение использует JavaScript-модули и service worker.

## 1. Использовать готовое PWA

Откройте **https://chat.aru-lab.space** в поддерживаемом браузере. Клонировать репозиторий и настраивать хостинг не нужно.

Для установки используйте команду браузера **«Установить приложение»** или **«Добавить на главный экран»**. Название команды и её доступность зависят от браузера и устройства. После загрузки оболочка приложения может кешироваться и открываться офлайн, но AI-провайдеры, веб-поиск, удалённое хранилище и другие внешние сервисы требуют подключения к сети. Некоторые внешние библиотеки и модель embeddings также загружаются с CDN.

## 2. Клонировать репозиторий и разместить свою копию

Клонируйте репозиторий:

```sh
git clone https://github.com/Anvar-Khaliulin/aru-ai.git
cd aru-ai
```

Приложение состоит из статических файлов, поэтому `npm install`, компиляция и backend-сервис не нужны. Загрузите файлы приложения на статический хостинг или раздавайте клонированную папку по локальной инструкции ниже. Сохраните структуру каталогов.

Для самого простого размещения используйте **корень отдельного HTTPS-домена**, например `https://ai.example.com/`. Для service worker требуется HTTPS; `localhost` считается безопасным контекстом при локальной разработке.

Репозиторий настроен на размещение в корне домена: в manifest указаны `/` как начальный URL и область действия, а service worker распознаёт пути приложения от корня. Для размещения в подкаталоге, например `https://example.com/aru/`, может понадобиться скорректировать пути и область действия в `manifest.json`, регистрацию service worker в `index.html` и `sw.js`.

## 3. Запустить приложение локально на компьютере

Установите Python 3 или используйте уже установленный, затем запустите статический сервер из корня репозитория:

```sh
python3 -m http.server 8000
```

В Windows команда может выглядеть так:

```powershell
py -m http.server 8000
```

Откройте в браузере **http://localhost:8000**. Пока вы пользуетесь приложением, не закрывайте терминал и сервер. Чтобы открыть приложение с другого устройства в локальной сети, настройте сервер на прослушивание сетевого интерфейса компьютера или адреса `0.0.0.0`, а затем откройте LAN-адрес компьютера на другом устройстве. Доступ по локальной сети и работа service worker могут зависеть от правил безопасности браузера.

Для подключения локальной или сетевой LLM настройте провайдера при первоначальной настройке Aru AI или в параметрах. Сервер модели должен разрешать браузерные запросы с адреса приложения (CORS). Браузер может блокировать небезопасные HTTP-запросы с копии, открытой по HTTPS; локальная разработка через `localhost` или настройка HTTPS на хостинге помогает избежать многих таких ограничений.

## 4. Опубликовать собственное устанавливаемое PWA

1. Клонируйте репозиторий и разместите его на собственном HTTPS-хостинге. Для начала используйте корень домена.
2. Обновите `manifest.json`: укажите название приложения, описание, иконки, а также правильные `start_url` и `scope` для вашего размещения.
3. Настройте `sw.js` для своей копии:
   - Меняйте `APP_VERSION` при каждой публикации. Версия входит в имя кеша и позволяет service worker отличать новую оболочку приложения от предыдущей.
   - Проверьте `ASSETS_TO_CACHE` и добавьте все локальные файлы, нужные оболочке приложения офлайн. Удалите отсутствующие файлы и добавьте новые локальные ресурсы.
   - Проверьте `APP_PATH_PREFIXES` и `isSameOriginAppRequest()`. Сейчас они распознают пути от корня, например `/js/` и `/css/`; адаптируйте их, если приложение размещено в URL-подкаталоге.
   - Сверьте `getOfflineShell()` и URL ресурсов в `precacheAssets()` с путём размещения приложения.
4. Проверьте регистрацию service worker в `index.html`. Сейчас `sw.js` регистрируется относительно URL приложения. Убедитесь, что этот URL и область действия worker покрывают размещённое приложение.
5. Опубликуйте файлы, откройте HTTPS-адрес с подключением к сети и дождитесь установки service worker. Проверьте регистрацию и ошибки кеширования в инструментах разработчика браузера, затем перезагрузите страницу и проверьте работу офлайн.

Текущий worker использует для запросов приложения стратегию **сначала сеть**: он предпочитает свежий ответ, а при отсутствии сети обращается к кешу. Предварительный кеш — это оболочка приложения, а не гарантия, что все функции доступны офлайн. Внешние CDN, облачные LLM, веб-поиск, Google Drive/WebDAV и другие удалённые сервисы по-прежнему требуют сети.

Если обновление не появилось, перезагрузите страницу и проверьте состояние service worker в инструментах разработчика. Во время тестирования можно отменить регистрацию worker и очистить Cache Storage сайта. Не меняйте `CACHE_PREFIX`, если для своего размещения не нужен отдельный namespace кеша.

## Данные и приватность

- Запросы чата отправляются AI-провайдеру, выбранному пользователем. Локальная модель может оставить эти запросы на устройстве или в сети пользователя — в зависимости от настройки локального сервера.
- Веб-поиск и удалённое хранилище обращаются к выбранным внешним провайдерам.
- Локальная база SQLite по умолчанию не зашифрована. Защищайте экспортированные файлы базы и резервные копии.
- Не добавляйте API-ключи и учётные данные в репозиторий или публичные статические файлы. Вводите их в настройках приложения.

---

# Aru AI — Жұмысты бастау

Бұл нұсқаулықта Aru AI қолданудың төрт жолы берілген:

1. Дайын орналастырылған PWA нұсқасын ашу.
2. Репозиторийді көшіріп, өз нұсқаңызды орналастыру.
3. Қолданбаны өз компьютеріңізде жергілікті іске қосу.
4. Өз орнатылатын PWA нұсқаңызды жариялау.

Aru AI — статикалық веб-қолданба: жинақтау кезеңі де, қолданба сервері де қажет емес. Бірақ файлдарды ұсыну үшін веб-сервер керек. `index.html` файлын `file://` арқылы тікелей ашу сенімді тәсіл емес, себебі қолданба JavaScript модульдері мен service worker пайдаланады.

## 1. Дайын PWA нұсқасын пайдалану

Қолдау көрсетілетін браузерде **https://chat.aru-lab.space** адресін ашыңыз. Репозиторийді көшіру немесе хостингті баптау қажет емес.

Орнату үшін браузердегі **«Қолданбаны орнату»** немесе **«Басты экранға қосу»** пәрменін пайдаланыңыз. Пәрменнің атауы мен қолжетімділігі браузерге және құрылғыға байланысты. Қолданбаның негізгі бөлігі жүктелгеннен кейін кештеліп, офлайн ашылуы мүмкін, бірақ AI провайдерлері, веб-іздеу, қашықтағы сақтау және басқа сыртқы қызметтерге желі қажет. Кейбір сыртқы кітапханалар мен embeddings моделі де CDN-нен жүктеледі.

## 2. Репозиторийді көшіріп, өз нұсқаңызды орналастыру

Репозиторийді көшіріңіз:

```sh
git clone https://github.com/Anvar-Khaliulin/aru-ai.git
cd aru-ai
```

Қолданба статикалық файлдардан тұрады, сондықтан `npm install`, компиляция және backend қызметі қажет емес. Қолданба файлдарын статикалық хостингке жүктеңіз немесе төмендегі жергілікті нұсқаулық бойынша көшірілген буманы сервер арқылы ұсыныңыз. Каталог құрылымын сақтаңыз.

Ең оңай орналастыру жолы — қолданбаны жеке HTTPS хостының **түбірлік адресінде** орналастыру, мысалы, `https://ai.example.com/`. Service worker үшін HTTPS қажет; жергілікті әзірлеуде `localhost` қауіпсіз контекст болып саналады.

Репозиторий доменнің түбірінде жұмыс істеуге бапталған: manifest файлында бастапқы URL мен әрекет ету аймағы `/` деп көрсетілген, ал service worker қолданба жолдарын түбірден іздейді. Қолданбаны `https://example.com/aru/` сияқты ішкі бумада орналастырсаңыз, `manifest.json`, `index.html` ішіндегі service worker тіркеуі және `sw.js` файлдарындағы жолдар мен әрекет ету аймағын өзгерту қажет болуы мүмкін.

## 3. Қолданбаны компьютерде жергілікті іске қосу

Python 3 орнатыңыз немесе бар болса пайдаланыңыз. Репозиторийдің түбірлік бумасынан статикалық серверді іске қосыңыз:

```sh
python3 -m http.server 8000
```

Windows жүйесінде мына пәрменді қолдануға болады:

```powershell
py -m http.server 8000
```

Браузерден **http://localhost:8000** адресін ашыңыз. Қолданбаны пайдаланып жатқанда терминал мен серверді ашық қалдырыңыз. Қолданбаны жергілікті желідегі басқа құрылғыдан ашу үшін серверді компьютердің LAN интерфейсіне немесе `0.0.0.0` адресіне байланыстырып, басқа құрылғыда компьютердің LAN адресін ашыңыз. Жергілікті желі арқылы кіру және service worker жұмысы браузердің қауіпсіздік ережелеріне тәуелді болуы мүмкін.

Жергілікті немесе желілік LLM қосу үшін Aru AI бастапқы баптауында немесе параметрлерінде провайдерді таңдаңыз. Модель сервері қолданбадан келетін браузер сұрауларына рұқсат беруі керек (CORS). HTTPS арқылы ашылған көшірмеден қауіпті HTTP сұраулары браузерде бұғатталуы мүмкін; жергілікті әзірлеуде `localhost` пайдалану немесе хостингте HTTPS баптау осындай мәселелердің алдын алуға көмектеседі.

## 4. Өз орнатылатын PWA нұсқаңызды жариялау

1. Репозиторийді көшіріп, өзіңіздің HTTPS хостингіңізге орналастырыңыз. Алдымен доменнің түбірін пайдаланыңыз.
2. `manifest.json` файлын жаңартыңыз: қолданба атауын, сипаттамасын, белгішелерін және орналастыруыңызға сай `start_url` мен `scope` мәндерін көрсетіңіз.
3. `sw.js` файлын өз нұсқаңызға бейімдеңіз:
   - Әр жарияланымда `APP_VERSION` мәнін өзгертіңіз. Ол кеш атауына кіреді және service worker-ге жаңа қолданба нұсқасын ескісінен ажыратуға мүмкіндік береді.
   - `ASSETS_TO_CACHE` тізімін қарап шығып, офлайн режимде қолданба қабығына қажет барлық жергілікті файлды қосыңыз. Жоқ файлдарды алып тастап, жаңа жергілікті ресурстарды қосыңыз.
   - `APP_PATH_PREFIXES` пен `isSameOriginAppRequest()` функциясын тексеріңіз. Қазір олар `/js/` және `/css/` сияқты түбірден басталатын жолдарды таниды; қолданба URL ішкі бумасында тұрса, осы жолдарды бейімдеңіз.
   - `getOfflineShell()` және `precacheAssets()` ішіндегі ресурс URL-дері орналастыру жолына сай екенін тексеріңіз.
4. `index.html` ішіндегі service worker тіркеуін тексеріңіз. Қазір `sw.js` қолданба URL-іне қатысты тіркеледі. Бұл URL мен worker әрекет ету аймағы орналастырылған қолданбаны қамтитынына көз жеткізіңіз.
5. Файлдарды жариялап, HTTPS адресін желі қосулы кезде ашыңыз да, service worker орнатылғанша күтіңіз. Браузердің әзірлеуші құралдарынан тіркелу мен кеш қателерін тексеріп, бетті қайта жүктеп, офлайн режимін сынаңыз.

Қазіргі worker қолданба сұраулары үшін **алдымен желі** стратегиясын қолданады: жаңартылған жауапты алуға тырысады, ал желі болмаса кештегі файлдарды пайдаланады. Алдын ала кеш — қолданбаның негізгі қабығы ғана, барлық функция офлайн істейтініне кепілдік бермейді. Сыртқы CDN, бұлттық LLM, веб-іздеу, Google Drive/WebDAV және басқа қашықтағы қызметтерге желі қажет.

Жаңарту көрінбесе, бетті қайта жүктеп, браузердің әзірлеуші құралдарынан service worker күйін тексеріңіз. Сынақ кезінде worker тіркеуін алып тастап, сайттың Cache Storage қоймасын тазалауға болады. Өз орналастыруыңызға жеке кеш кеңістігі қажет болмаса, `CACHE_PREFIX` мәнін өзгертпеңіз.

## Деректер және құпиялылық

- Чат сұраулары пайдаланушы таңдаған AI провайдеріне жіберіледі. Жергілікті модель баптауға байланысты сұрауларды пайдаланушының құрылғысында немесе желісінде қалдыруы мүмкін.
- Веб-іздеу мен қашықтағы сақтау таңдалған провайдерлерге қосылады.
- Жергілікті SQLite базасы әдепкіде шифрланбайды. Экспортталған база файлдары мен резервтік көшірмелерді қауіпсіз сақтаңыз.
- API кілттері мен тіркелгі деректерін репозиторийге немесе ашық статикалық файлдарға қоспаңыз. Оларды қолданба параметрлеріне енгізіңіз.
