# 🦊 Aru AI
<p align="center">
  <strong>Personal, local-first AI assistant focused on privacy, user control, and transparency.</strong>
</p>
<p align="center">
  <!-- Launch PWA Button -->
  <a href="https://chat.aru-lab.space">
    <img src="https://img.shields.io/badge/🚀_Launch_App-chat.aru--lab.space-FF6B00?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Launch PWA">
  </a>
  <!-- Official Website -->
  <a href="https://aru-lab.space">
    <img src="https://img.shields.io/badge/🌐_Website-aru--lab.space-0052CC?style=for-the-badge&logo=internetexplorer&logoColor=white" alt="Website">
  </a>
</p>
<p align="center">
  <!-- License -->
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square" alt="License">
  </a>
  <!-- Release -->
  <a href="https://github.com/Anvar-Khaliulin/aru-ai/releases">
    <img src="https://img.shields.io/badge/Release-v1.3.2-green.svg?style=flat-square" alt="Version">
  </a>
  <!-- Stack -->
  <img src="https://img.shields.io/badge/Built_With-Vanilla_JS-yellow.svg?style=flat-square&logo=javascript" alt="Vanilla JS">
  <!-- Storage -->
  <img src="https://img.shields.io/badge/Storage-SQLite-003B57.svg?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite">
</p>

> **Aru** (from Kazakh: *beauty*) is a cute fox mascot and an autonomous chatbot operating directly on the user's local device.
---
## 💖 Support & Donations

Aru AI is **100% free and open-source**. There are no ads, subscriptions, paywalls, or paid features, and there never will be. If you find Aru useful and want to support ongoing development, server costs, and maintenance, you can donate via:

<p align="left">
  <a href="https://ko-fi.com/aru_ai">
    <img src="https://img.shields.io/badge/Ko--fi-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white" alt="Ko-fi">
  </a>
  <a href="https://www.paypal.com/paypalme/sudoibot">
    <img src="https://img.shields.io/badge/PayPal-003087?style=for-the-badge&logo=paypal&logoColor=white" alt="PayPal">
  </a>
</p>

## 🌟 Key Features & Philosophy

- **100% Free & Open Source**: No ads, no subscriptions, no paywalls, and no commercial restrictions (**GNU GPLv3** license).
- **Pure JavaScript**: Built with vanilla JS without heavy frameworks. Total application size is around 20-32 MB.
- **Run Anywhere**: Runs smoothly on any device - from high-end PCs to older smartphones or tablets. Also available as an offline-capable **PWA**.
---
## 📊 Dashboard & Widgets

- **Customizable Home Dashboard**: Toggle individual cards (**Weather** via Open-Meteo, **Calendar** combining task deadlines and planned/done Fit workouts, **Task Focus** with 1-click completion, **Fit & Care** summary, and **RSS News** with category filters).
- **Display Options**: Configure in *Settings -> Dashboard* to show on startup, whenever all chat tabs are closed, via a quick header button, or in Desktop Mode.
- **Responsive Layouts**: Desktop Bento view, mobile segmented view, and a 2-column macOS-style widget rail in Desktop Mode.
---
## 🖥️ Desktop Mode

- Turns the interface into a full desktop workspace: draggable windows, taskbar, macOS-style 2-column Dashboard widget rail (weather & news on the left; calendar, task focus & health on the right) that softly dims behind active windows, and desktop sticky notes.
- Available on desktop and tablet; opens in fullscreen automatically, and the tray button returns to windowed mode.
- Built-in dialogs (confirmations, prompts, unsaved-changes warnings) work inside the app and do not drop fullscreen.
---
## 🧠 AI Engine & Providers

Supports three flexible ways to connect LLMs:
1. **Gemini API**: Fast & simple setup with free tier support.
2. **OpenRouter**: Access to hundreds of models without data training in paid tiers.
3. **Local LLMs (Ollama, LM Studio)**: Complete privacy via local network (LAN + CORS). Zero data leaves your local network.
---
## 💾 Data Storage, Cloud Sync v2 & Memory

- **SQLite Engine**: All chats, history, settings, facts, tasks, health logs, and library items are stored in a local SQLite database. The local `.sqlite` file is unencrypted for speed and portability.
- **Cloud Sync v2**: Optional **Google Drive API** (BYOK, GIS loaded strictly on demand) or **WebDAV** (Nextcloud, ownCloud, Synology) synchronization using client-side **end-to-end AES-GCM** snapshot encryption and **3-way merge** across devices. Local credentials are sealed with your master password (PBKDF2 + AES-GCM).
- **Persistent Artifact Storage**: Scoped storage API inside Canvas (`aruStorage` / `localStorage` bridge) persists interactive game and app state inside SQLite and syncs across devices.
- **Semantic Memory Core**: A lightweight local embedding model (`@xenova/transformers`) extracts and recalls relevant user facts without inflating context windows.
- **Ephemeral Mode**: Private chats live in RAM only and are wiped immediately upon closing the tab.
---
## 🎭 Heuristic Mood Engine

- Aru features a distinct personality, habits, and dynamic emotional indicators (humor, overall mood, sarcasm, affinity).
- Dynamically reacts to user politeness or trolling, featuring interactive stickers that reflect her emotional state (can be toggled off in settings).
---
## 🛡️ 3-Tier Safety & Guardrails

- **Kids Mode**: Local deterministic rule filter (`safety.js`) on both inputs and outputs plus strict system prompts - blocks unsafe topics, refuses direct homework answers, and disables Fit & Care and Aru Skills.
- **Teens Mode**: Moderate filtering, supportive guidance on sensitive topics, and Fit & Care enabled with the intimacy journal disabled and healthy calorie-deficit safeguards.
- **Adult Mode**: Full access including Aru Skills and the private-by-default intimacy journal in Fit & Care (content limits depend only on the connected LLM).
- **UI Access & Biometrics**: Master password stored as a PBKDF2 hash plus optional **WebAuthn biometrics** (Touch ID, Face ID, Windows Hello) for quick UI sign-in on this device.
---
## 🎨 Artefacts, Canvas & Tools

- **Aru Canvas & Artefacts**:
  - **Aru Apps**: Interactive mini-apps, widgets, trackers, and responsive games (**Aru Game**) with persistent local SQLite state.
  - **Aru Docs**: Rich text documents & interactive analytical dashboards (**Aru AnDoc**) powered by HTML + Chart.js.
- **Interactive Chat Cards**: Live **Weather**, **RSS News**, and **Task Board** cards rendered straight inside chat with 1-click task completion and direct board launch.
- **Web Search**: Integrated Tavily and private SearXNG web search engines.
- **WebRTC P2P**: Direct peer-to-peer sharing of databases, chats, artefacts, and tasks via QR code without intermediary servers.
- **Multilingual (i18n)**: Full UI localization in Kazakh, English, and Russian.
---
## 🧩 Plugins

- **Kanban Task Board (v2)**: Trello-style **Board & List** views with project colors, priorities, `#tags`, subtask checklists with progress, 1-click completion, inline quick-add, search & filters, draggable columns, Markdown/JSON export & JSON import, AI subtask breakdown & Smart Plan, full Aru chat commands, Dashboard sync, and 3-way cloud merge.
- **Aru Skills Studio**: Build multi-step AI workflows from your own prompts and per-step provider/model settings (Gemini, OpenRouter, or any local OpenAI-compatible server). Supports sequential **Relay**, parallel **Council** branches, **Critic Auto-Revision Loops**, inline **HITL Checkpoints**, retry from failed stage, URL fetching (private proxies supported), Artifact Vault, and built-in presets. *Adult mode only.*
- **Aru Fit & Care**: Private journal for health, nutrition, training, and wellbeing - evidence-based calorie/macro engine (Mifflin-St Jeor & Katch-McArdle), structured workout analytics (volume, e1RM, MET burn, sRPE/ACWR), pause-safe cycle tracker, weekday medication schedule, embedded chat + multi-chat logging, Calendar, trend dashboards, CSV export, and JSON backup. *Teen (no intimacy journal) and adult modes. Personal self-tracking only - not a medical device, medical advice, or contraception method.*
---
## 🗂️ Chat Organization & Customization

- **Folders**: Group chats into collapsible folders that stay on top of the list - rename, reorder, and drag chats in and out.
- **Favorites & Drag-and-Drop Order**: Star chats to pin them above regular ones, then drag to arrange each group.
- **Sections & Chapters**: Split long dialogues into sections and chapters with message anchors for fast navigation.
---
## 📄 License & Usage Information

The source code of this project is licensed under the **GNU General Public License v3.0 (GPLv3)** - see the [LICENSE](./LICENSE) file for details. Project branding ("Aru AI", "Aru-Lab") and original visual artwork of the "Aru Fox" mascot in `media/` remain copyright of Aru-Lab.

Before using the app or the public PWA (`chat.aru-lab.space`), please review [rules.html](./rules.html) (**Usage Information, Privacy & Safety Notice** - also accessible directly inside the onboarding window).
