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
    <img src="https://img.shields.io/badge/Release-v0.9.7-green.svg?style=flat-square" alt="Version">
  </a>
  <!-- Stack -->
  <img src="https://img.shields.io/badge/Built_With-Vanilla_JS-yellow.svg?style=flat-square&logo=javascript" alt="Vanilla JS">
  <!-- Storage -->
  <img src="https://img.shields.io/badge/Storage-SQLite-003B57.svg?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite">
</p>

> **Aru** (from Kazakh — *beauty*) is a cute fox mascot and an autonomous chatbot operating entirely on the user's local device.
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
- **Pure JavaScript**: Built with vanilla JS without heavy frameworks. Total application size is just 20–32 MB.
- **Run Anywhere**: Runs smoothly on any device — from high-end PCs to decade-old smartphones or tablets. Also available as an offline-capable **PWA**.
---
## 🧠 AI Engine & Providers

Supports three flexible ways to connect LLMs:
1. **Gemini API**: Fast & simple setup with free tier support.
2. **OpenRouter**: Access to hundreds of models without data training in paid tiers.
3. **Local LLMs (Ollama, LM Studio)**: Complete privacy via local network (LAN + CORS). Zero data leaves your local network.
---
## 💾 Data Storage & Memory

- **SQLite Engine**: All chats, history, settings, facts, and library items are stored in a local SQLite database.
- **Flexible Storage**: Local cache, local `.db` file, **Google Drive API**, or **WebDAV** (Nextcloud, Seafile, etc.) for cross-device synchronization.
- **Semantic Memory Core**: A lightweight local embedding model automatically extracts and saves user facts, injecting only relevant context into prompt windows.
- **Ephemeral Mode**: Zero-trace temporary chats — all data is wiped from RAM immediately upon closing the tab.
---
## 🎭 Heuristic Mood Engine

- Aru features a distinct personality, habits, and dynamic emotional indicators (humor, overall mood, sarcasm, offense).
- Dynamically reacts to user politeness or trolling, featuring interactive stickers that reflect her emotional state (can be toggled off in settings).
---
## 🛡️ 3-Tier Safety & Guardrails

- **Kids Mode**: Strict GUARD filtering, supportive tone, educational guidance without giving out direct homework solutions.
- **Teens Mode**: Moderate filtering, supportive guidance following psychological help protocols, academic topics.
- **Adult Mode**: GUARD disabled (subject only to the connected LLM's own constraints).
- **Biometric Security**: Switching databases or accessing settings is protected by PIN code and **Biometrics** (Touch ID, Face ID, Windows Hello).
---
## 🎨 Artefacts, Canvas & Tools

- **Aru Canvas & Artefacts**:
  - **Aru Apps**: Interactive mini-apps, widgets, trackers, and responsive games (**Aru Game**).
  - **Aru Docs**: Rich text documents & interactive analytical dashboards (**Aru AnDoc**) powered by HTML + Chart.js.
- **Web Search**: Integrated Tavily and private SearXNG web search engines.
- **WebRTC P2P**: Direct peer-to-peer sharing of databases, chats, and artefacts via QR code without intermediary servers.
- **Kanban Plugin**: Built-in task board deeply integrated into Aru's prompts and heuristic engine.
- **Multilingual (i18n)**: Full UI localization in Kazakh, English, and Russian.
---
## 🗂️ Chat Organization & Customization

- **Folders**: Group chats into collapsible folders that always stay on top of the list — rename, reorder, and drag chats in and out.
- **Favorites & Drag-and-Drop Order**: Star chats to pin them above regular ones, then drag to arrange each group exactly how you like.
- **Sections & Chapters**: Split long dialogues into sections and chapters with message anchors — a built-in table of contents for your conversations.
---
## 📄 License

This project is licensed under the **GNU General Public License v3.0 (GPLv3)** — see the [LICENSE](./LICENSE) file for details.
