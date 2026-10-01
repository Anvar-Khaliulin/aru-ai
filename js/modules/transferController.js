/*
---ARU-LAB.SPACE---ALMATY---2026---
Transfer Controller handles WebRTC data exchange between devices.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { DB } from './db.js';
import { UI } from './ui.js';

export const TransferController = {
    peer: null,
    conn: null,
    isSender: false,
    chunks: [],
    receivedSize: 0,
    totalSize: 0,
    dataType: null,
    pendingTypes: [],
    videoStream: null,
    selectedItems: { chats: null, artifacts: null, tasks: null },

    init() {
        console.log("TransferController: Initialized");
    },

    openTransferModal() {
        const t = state.translations || {};
        const modalContainer = document.getElementById('modal-container');

        const html = `
        <div id="modal-transfer-overlay" class="fixed top-[60px] md:top-[72px] inset-x-0 bottom-0 z-[100] flex items-center justify-center p-2 md:p-4 animate-fade-in backdrop-blur-md bg-white/5 dark:bg-black/5">
            <div class="absolute inset-0" onclick="TransferController.closeModal()"></div>
            <div class="bg-white dark:bg-gray-900 w-full max-w-sm rounded-3xl shadow-2xl relative overflow-hidden border border-gray-100 dark:border-gray-800 flex flex-col max-h-full h-[85vh] scale-in">
                
                <!-- Compact Header -->
                <div class="p-4 flex justify-between items-center border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-xl bg-orange-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
                            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                        </div>
                        <h3 class="text-sm font-black text-gray-800 dark:text-gray-100 uppercase tracking-tight">${t.transfer_modal_title || 'Sync Engine'}</h3>
                    </div>
                    <button onclick="TransferController.closeModal()" class="w-8 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition text-gray-400">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>

                <div id="transfer-main-layout" class="flex flex-col overflow-y-auto">
                    <div class="p-5 flex flex-col items-center">
                        
                        <!-- Premium Tab Switcher -->
                        <div class="flex bg-gray-100 dark:bg-gray-950 p-1 rounded-2xl border border-gray-100 dark:border-gray-800 mb-6 w-full max-w-[200px]">
                            <button id="tab-btn-send" onclick="TransferController.switchTab('send')" class="flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all bg-orange-500 text-white shadow-lg shadow-orange-500/20">${t.transfer_tab_send || 'Send'}</button>
                            <button id="tab-btn-receive" onclick="TransferController.switchTab('receive')" class="flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all text-gray-400 font-bold hover:text-gray-600 dark:hover:text-gray-200">${t.transfer_tab_receive || 'Get'}</button>
                        </div>

                        <!-- Send Section -->
                        <div id="transfer-send" class="w-full flex flex-col items-center animate-fade-in">
                            <div class="relative group">
                                <div id="qr-container" class="bg-white p-3 rounded-2xl shadow-xl border border-gray-50 flex items-center justify-center w-[160px] h-[160px] transition-all group-hover:shadow-2xl">
                                    <div class="flex flex-col items-center justify-center w-full h-full text-center text-gray-300 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
                                        <i data-lucide="qr-code" class="w-8 h-8 mx-auto mb-2 opacity-10"></i>
                                        <span>${t.qr_placeholder || 'Ready'}</span>
                                    </div>
                                </div>
                            </div>
                            <div id="peer-id-display" class="mt-4 bg-orange-50 dark:bg-orange-950/20 text-orange-600 dark:text-orange-400 text-[10px] font-black px-4 py-1.5 rounded-full hidden border border-orange-100 dark:border-orange-900/40 font-mono"></div>
                            
                            <!-- Checkboxes Grid -->
                            <div id="db-checkbox-grid" class="w-full mt-6 grid grid-cols-2 gap-2 transition-all">
                                <div class="p-2.5 bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-50 dark:border-gray-800 flex items-center justify-between shadow-sm">
                                    <label class="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" id="chk-chats" name="transfer-data" value="chats" checked class="w-3.5 h-3.5 rounded accent-orange-500" onchange="TransferController.onMainCheckboxChange('chats')">
                                        <span class="text-[10px] font-bold text-gray-600 dark:text-gray-400">${t.data_chats || 'Chats'}</span>
                                    </label>
                                    <button onclick="TransferController.openSubSelection('chats')" class="p-1 text-gray-400 hover:text-orange-500 transition-colors">
                                        <i data-lucide="settings-2" class="w-3.5 h-3.5"></i>
                                    </button>
                                </div>
                                <div class="p-2.5 bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-50 dark:border-gray-800 flex items-center shadow-sm">
                                    <label class="flex items-center gap-2 cursor-pointer w-full">
                                        <input type="checkbox" id="chk-settings" name="transfer-data" value="settings" checked class="w-3.5 h-3.5 rounded accent-orange-500" onchange="TransferController.onMainCheckboxChange('settings')">
                                        <span class="text-[10px] font-bold text-gray-600 dark:text-gray-400">${t.data_settings || 'Config'}</span>
                                    </label>
                                </div>
                                <div class="p-2.5 bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-50 dark:border-gray-800 flex items-center justify-between shadow-sm">
                                    <label class="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" id="chk-artifacts" name="transfer-data" value="artifacts" checked class="w-3.5 h-3.5 rounded accent-orange-500" onchange="TransferController.onMainCheckboxChange('artifacts')">
                                        <span class="text-[10px] font-bold text-gray-600 dark:text-gray-400">${t.data_artifacts || 'Files'}</span>
                                    </label>
                                    <button onclick="TransferController.openSubSelection('artifacts')" class="p-1 text-gray-400 hover:text-orange-500 transition-colors">
                                        <i data-lucide="settings-2" class="w-3.5 h-3.5"></i>
                                    </button>
                                </div>
                                <div class="p-2.5 bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-50 dark:border-gray-800 flex items-center justify-between shadow-sm">
                                    <label class="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" id="chk-tasks" name="transfer-data" value="tasks" checked class="w-3.5 h-3.5 rounded accent-orange-500" onchange="TransferController.onMainCheckboxChange('tasks')">
                                        <span class="text-[10px] font-bold text-gray-600 dark:text-gray-400">${t.data_tasks || 'Tasks'}</span>
                                    </label>
                                    <button onclick="TransferController.openSubSelection('tasks')" class="p-1 text-gray-400 hover:text-orange-500 transition-colors">
                                        <i data-lucide="settings-2" class="w-3.5 h-3.5"></i>
                                    </button>
                                </div>
                            </div>
                            
                            <!-- System Lock Option -->
                            <div class="w-full mt-3">
                                <label class="flex items-center gap-3 p-3 bg-gray-100 dark:bg-gray-900 rounded-2xl cursor-pointer transition-all hover:bg-gray-200 dark:hover:bg-gray-800 border border-transparent dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 group">
                                    <input type="checkbox" id="check-all-db" onchange="TransferController.toggleAllData(this.checked)" class="w-4 h-4 rounded accent-orange-500">
                                    <div class="flex-1">
                                        <div class="text-[11px] font-black text-gray-800 dark:text-gray-100 uppercase tracking-tight">${t.data_all_db || 'Full System Image'}</div>
                                        <div class="text-[8px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">${t.transfer_reliable_sync || 'Reliable sync'}</div>
                                    </div>
                                    <i data-lucide="shield-check" class="w-5 h-5 text-gray-400 group-hover:text-orange-500 transition-colors"></i>
                                </label>
                            </div>

                            <button id="btn-start-send" onclick="TransferController.initSender()" class="mt-6 px-6 py-3 w-full justify-center bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 flex items-center gap-2 text-xs">
                                <i data-lucide="zap" class="w-4 h-4"></i>
                                ${t.btn_start_transfer || 'Start Transfer'}
                            </button>
                        </div>

                        <!-- Receive Section -->
                        <div id="transfer-receive" class="w-full flex flex-col items-center hidden animate-fade-in">
                            <div class="w-full aspect-square bg-black rounded-3xl overflow-hidden shadow-2xl relative border-4 border-white dark:border-gray-800">
                                <video id="qr-video" class="w-full h-full object-cover hidden"></video>
                                <canvas id="qr-canvas" class="hidden"></canvas>
                                <div id="receive-status" class="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gray-900/60 backdrop-blur-sm">
                                     <div class="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center mb-4">
                                        <i data-lucide="scan-face" class="w-6 h-6 text-white text-orange-500"></i>
                                     </div>
                                     <span id="receive-status-label" class="text-[9px] font-black text-white uppercase tracking-widest leading-none">${t.camera_placeholder || 'Allow camera access to scan barcode'}</span>
                                </div>
                                <div id="scan-overlay" class="absolute inset-0 border border-orange-500/30 m-8 rounded-2xl hidden scan-line"></div>
                            </div>
                            
                            <button id="btn-start-receive" onclick="TransferController.initReceiver()" class="mt-6 px-6 py-3 w-full justify-center bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 flex items-center gap-2 text-xs">
                                <i data-lucide="camera" class="w-4 h-4"></i>
                                ${t.btn_start_scan || 'Scan QR'}
                            </button>

                            <div class="mt-6 w-full px-4">
                                <div class="text-center text-[9px] text-gray-400 mb-2 uppercase font-black tracking-widest">${t.label_or_manual || 'Manual ID'}</div>
                                <div class="flex gap-2 p-1.5 bg-gray-50 dark:bg-gray-950 rounded-xl border border-gray-100 dark:border-gray-800">
                                    <input type="text" id="manual-peer-id" placeholder="ID..." class="flex-1 px-3 py-1 bg-transparent text-[10px] font-black outline-none tracking-widest text-center uppercase placeholder:text-gray-300">
                                    <button onclick="TransferController.connectManual()" class="px-4 py-1.5 bg-gray-900 text-white dark:bg-gray-800 rounded-lg font-black text-[9px]">GO</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Progress Box -->
                    <div id="transfer-progress-box" class="p-4 bg-gray-50/50 dark:bg-gray-950/50 border-t border-gray-50 dark:border-gray-800 hidden animate-slide-up">
                        <div class="flex justify-between items-end mb-2">
                            <span id="transfer-status-text" class="text-[9px] font-black text-orange-500 uppercase tracking-widest">${t.transfer_status_waiting || 'Wait...'}</span>
                            <span id="transfer-pct" class="text-xl font-black text-gray-800 dark:text-gray-100 font-mono">0%</span>
                        </div>
                        <div class="w-full bg-gray-100 dark:bg-gray-900 rounded-full h-2 overflow-hidden shadow-inner">
                            <div id="transfer-progress-bar" class="bg-orange-500 h-full w-0 transition-all rounded-full shadow-[0_0_8px_rgba(249,115,22,0.4)]"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <style>
            .scan-line {
                background: rgba(249, 115, 22, 0.55);
                height: 2px;
                position: absolute;
                width: 100%;
                animation: scan 1.5s linear infinite;
                box-shadow: 0 0 5px rgba(249, 115, 22, 0.5);
            }
            @keyframes scan {
                0% { top: 0; }
                100% { top: 100%; }
            }
        </style>
        `;

        modalContainer.innerHTML = html;
        if (window.lucide) lucide.createIcons();
    },

    closeModal() {
        document.getElementById('modal-container').innerHTML = '';
        if (this.conn) {
            this.conn.close();
            this.conn = null;
        }
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => track.stop());
            this.videoStream = null;
        }
        this.selectedItems = { chats: null, artifacts: null, tasks: null };
        this.isSender = false;
    },

    switchTab(tab) {
        document.getElementById('transfer-send').classList.toggle('hidden', tab !== 'send');
        document.getElementById('transfer-receive').classList.toggle('hidden', tab !== 'receive');
        
        const btnSend = document.getElementById('tab-btn-send');
        const btnRecv = document.getElementById('tab-btn-receive');
        
        if (tab === 'send') {
            btnSend.className = 'flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all bg-orange-500 text-white shadow-lg shadow-orange-500/20';
            btnRecv.className = 'flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all text-gray-400 hover:text-gray-600 dark:hover:text-gray-200';
        } else {
            btnRecv.className = 'flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all bg-orange-500 text-white shadow-lg shadow-orange-500/20';
            btnSend.className = 'flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all text-gray-400 hover:text-gray-600 dark:hover:text-gray-200';
        }
    },

    onMainCheckboxChange(type) {
        const chk = document.getElementById(`chk-${type}`);
        if (!chk) return;
        if (chk.checked) {
            if (this.selectedItems[type] !== undefined) this.selectedItems[type] = null; // select all
            chk.indeterminate = false;
        } else {
            if (this.selectedItems[type] !== undefined) this.selectedItems[type] = []; // select none
            chk.indeterminate = false;
        }
        this.updateCheckAllState();
    },

    toggleAllData(checked) {
        const gridBox = document.getElementById('db-checkbox-grid');
        if (gridBox) {
            gridBox.style.pointerEvents = checked ? 'none' : 'auto';
            gridBox.style.opacity = checked ? '0.4' : '1';
        }

        document.querySelectorAll('input[name="transfer-data"]').forEach(chk => {
            chk.checked = checked;
            chk.disabled = checked;
            chk.indeterminate = false;
        });
        if (checked) {
            this.selectedItems = { chats: null, artifacts: null, tasks: null };
            document.querySelectorAll('input[name="transfer-data"]').forEach(chk => {
                const parent = chk.closest('div.flex.items-center.justify-between');
                if (parent) parent.classList.add('opacity-40', 'pointer-events-none');
            });
        } else {
            document.querySelectorAll('input[name="transfer-data"]').forEach(chk => {
                const parent = chk.closest('div.flex.items-center.justify-between');
                if (parent) parent.classList.remove('opacity-40', 'pointer-events-none');
            });
        }
    },

    updateCheckAllState() {
        const allDbChk = document.getElementById('check-all-db');
        if(!allDbChk) return;
        if (allDbChk.checked) {
            allDbChk.checked = false;
            this.toggleAllData(false);
        }
    },

    openSubSelection(type) {
        const t = state.translations || {};
        let items = [];
        let title = '';
        
        if (type === 'chats') {
            title = t.data_chats || 'Chats';
            items = DB.query("SELECT id, title as name FROM chats ORDER BY created_at DESC");
        } else if (type === 'artifacts') {
            title = t.data_artifacts || 'Artifacts';
            items = DB.query("SELECT id, name FROM modules_data WHERE type != 'plugin' ORDER BY created_at DESC");
        } else if (type === 'tasks') {
            title = t.data_tasks || 'Tasks';
            const pluginDataRow = DB.query("SELECT content FROM modules_data WHERE type = 'plugin' AND name = 'task' LIMIT 1");
            if (pluginDataRow && pluginDataRow.length > 0) {
                try {
                    const parsed = JSON.parse(pluginDataRow[0].content);
                    if (parsed && parsed.projects) {
                        items = parsed.projects.map(p => ({
                            id: p.id,
                            name: p.name
                        }));
                    }
                } catch(e) {}
            }
        } else {
            return;
        }

        const currentlySelected = this.selectedItems[type];
        
        const subModalId = 'transfer-sub-modal';
        let existing = document.getElementById(subModalId);
        if (existing) existing.remove();
        
        const html = `
        <div id="${subModalId}" class="absolute inset-0 z-[120] flex items-center justify-center p-4 bg-white/5 dark:bg-black/5 backdrop-blur-md animate-fade-in">
            <div class="bg-white dark:bg-gray-900 w-full max-w-sm rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-800 flex flex-col max-h-full h-[85vh]">
                <!-- Header -->
                <div class="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-900/50">
                    <h4 class="text-xs font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wider">${t.transfer_select_items || 'Select items'}</h4>
                    <span class="text-[10px] text-gray-400 font-mono">${title}</span>
                </div>
                
                <!-- Quick toggles -->
                <div class="flex border-b border-gray-50 dark:border-gray-800 select-none">
                    <button onclick="document.querySelectorAll('.sub-modal-chk').forEach(c => c.checked = true)" class="flex-1 py-2 text-[9px] font-bold text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 active:bg-orange-100 border-r border-gray-50 dark:border-gray-800 transition-colors uppercase tracking-widest">${t.btn_select_all || 'Select all'}</button>
                    <button onclick="document.querySelectorAll('.sub-modal-chk').forEach(c => c.checked = false)" class="flex-1 py-2 text-[9px] font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 transition-colors uppercase tracking-widest">${t.btn_deselect_all || 'Deselect all'}</button>
                </div>

                <!-- List -->
                <div class="flex-1 overflow-y-auto p-2" id="sub-modal-list">
                    ${items.length === 0 ? `<div class="p-6 text-center text-gray-400 text-[10px] font-medium">${t.transfer_no_data || 'No data'}</div>` : ''}
                    ${items.map(item => {
                        const isChecked = currentlySelected === null || currentlySelected.includes(item.id);
                        return `
                        <label class="flex items-center gap-3 p-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg cursor-pointer transition-colors w-full group">
                            <input type="checkbox" value="${item.id}" ${isChecked ? 'checked' : ''} class="sub-modal-chk w-4 h-4 rounded accent-orange-500 cursor-pointer">
                            <span class="text-xs text-gray-700 dark:text-gray-300 truncate w-full group-hover:text-orange-600 transition-colors">${item.name || t.transfer_untitled || 'Untitled'}</span>
                        </label>
                        `;
                    }).join('')}
                </div>

                <!-- Footer -->
                <div class="p-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2 bg-gray-50 dark:bg-gray-900/50">
                    <button onclick="document.getElementById('${subModalId}').remove()" class="px-4 py-2 text-[10px] font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all">${t.btn_cancel || 'Cancel'}</button>
                    <button onclick="TransferController.saveSubSelection('${type}', ${items.length})" class="px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-bold rounded-xl shadow-md transition-all">${t.btn_save_selection || 'Save selection'}</button>
                </div>
            </div>
        </div>
        `;
        
        document.getElementById('modal-transfer-overlay').insertAdjacentHTML('beforeend', html);
        if (window.lucide) lucide.createIcons();
    },

    saveSubSelection(type, totalCount) {
        const checkboxes = Array.from(document.querySelectorAll('.sub-modal-chk'));
        const selected = checkboxes.filter(c => c.checked).map(c => {
            const intVal = parseInt(c.value, 10);
            return String(intVal) === c.value ? intVal : c.value;
        });
        
        const chkParent = document.getElementById(`chk-${type}`);
        if (!chkParent) return;

        if (selected.length === totalCount) {
            this.selectedItems[type] = null; // all
            chkParent.checked = true;
            chkParent.indeterminate = false;
        } else if (selected.length === 0) {
            this.selectedItems[type] = []; // none
            chkParent.checked = false;
            chkParent.indeterminate = false;
        } else {
            this.selectedItems[type] = selected; // some
            chkParent.checked = true; 
            chkParent.indeterminate = true;
        }
        
        document.getElementById('transfer-sub-modal').remove();
        this.updateCheckAllState();
    },

    // --- Sender Logic ---
    initSender() {
        const btn = document.getElementById('btn-start-send');
        if (btn) btn.disabled = true;
        
        this.isSender = true;
        
        const stunServer = state.userSettings.stun_server || 'stun:stun.l.google.com:19302';
        const signaling = state.userSettings.signaling_server || 'peerjs-default';
        
        const config = { config: { 'iceServers': [{ 'urls': stunServer }] } };
        if (signaling !== 'peerjs-default' && signaling.includes(':')) {
            const parts = signaling.split(':');
            config.host = parts[0]; config.port = parseInt(parts[1]);
        }

        this.peer = new Peer(config);

        this.peer.on('open', (id) => {
            this.generateQR(id);
            const idDisp = document.getElementById('peer-id-display');
            if (idDisp) {
                idDisp.innerText = id;
                idDisp.classList.remove('hidden');
            }
        });

        this.peer.on('connection', (conn) => {
            this.conn = conn;
            this.setupConnectionHandlers();
        });

        this.peer.on('error', (err) => {
            console.error('Peer error:', err);
            if (btn) btn.disabled = false;
        });
    },

    generateQR(text) {
        const container = document.getElementById('qr-container');
        if (!container) return;
        container.innerHTML = '';
        new QRCode(container, {
            text: text,
            width: 160,
            height: 160,
            colorDark: "#f97316",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
    },

    // --- Receiver Logic ---
    initReceiver() {
        const t = state.translations || {};
        const video = document.getElementById('qr-video');
        const container = document.getElementById('receive-status');
        const btn = document.getElementById('btn-start-receive');
        const overlay = document.getElementById('scan-overlay');

        if (!video) return;

        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((stream) => {
            this.videoStream = stream;
            video.srcObject = stream;
            video.setAttribute("playsinline", true);
            video.play();
            video.classList.remove('hidden');
            if (container) container.classList.add('hidden');
            if (btn) btn.disabled = true;
            if (overlay) overlay.classList.remove('hidden');
            
            requestAnimationFrame(() => this.scanTick());
        }).catch(err => {
            console.error("Camera access denied:", err);
            alert(t.alert_camera_denied || "Camera access denied.");
        });
    },

    scanTick() {
        const video = document.getElementById('qr-video');
        if (!video || video.paused || video.ended) return;

        const canvas = document.getElementById('qr-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.height = video.videoHeight;
            canvas.width = video.videoWidth;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "dontInvert",
            });

            if (code) {
                const t = state.translations || {};
                this.connectToPeer(code.data);
                if (this.videoStream) {
                    this.videoStream.getTracks().forEach(track => track.stop());
                }
                video.classList.add('hidden');
                document.getElementById('receive-status').innerHTML = `<span class="text-white font-bold opacity-50 text-[10px]">${t.transfer_status_connected || 'Connected'}</span>`;
                document.getElementById('receive-status').classList.remove('hidden');
                document.getElementById('scan-overlay').classList.add('hidden');
                return;
            }
        }
        requestAnimationFrame(() => this.scanTick());
    },

    connectManual() {
        const id = document.getElementById('manual-peer-id').value.trim();
        if (!id) return;
        this.connectToPeer(id);
    },

    connectToPeer(peerId) {
        this.isSender = false;
        const stunServer = state.userSettings.stun_server || 'stun:stun.l.google.com:19302';
        const signaling = state.userSettings.signaling_server || 'peerjs-default';
        const config = { config: { 'iceServers': [{ 'urls': stunServer }] } };
        if (signaling !== 'peerjs-default' && signaling.includes(':')) {
            const parts = signaling.split(':');
            config.host = parts[0]; config.port = parseInt(parts[1]);
        }
        this.peer = new Peer(config);
        this.peer.on('open', () => {
            this.conn = this.peer.connect(peerId);
            this.setupConnectionHandlers();
        });
    },

    setupConnectionHandlers() {
        if (!this.conn) return;
        const t = state.translations || {};
        this.conn.on('open', () => {
            const box = document.getElementById('transfer-progress-box');
            const statusEl = document.getElementById('transfer-status-text');
            if (box) box.classList.remove('hidden');
            if (statusEl) statusEl.innerText = (t.transfer_status_connected || 'Connection established') + "...";
            if (this.isSender) {
                this.sendMetadata();
            }
        });
        this.conn.on('data', (data) => this.handleIncomingData(data));
        this.conn.on('close', () => {
            const statusEl = document.getElementById('transfer-status-text');
            if (statusEl) statusEl.innerText = t.transfer_status_closed || 'Connection closed';
        });
    },

    sendMetadata() {
        if (!this.conn) return;
        const allDb = document.getElementById('check-all-db')?.checked;
        const types = [];
        if (allDb) {
            types.push('full_db');
        } else {
            document.querySelectorAll('input[name="transfer-data"]').forEach(chk => {
                if (chk.checked || chk.indeterminate) types.push(chk.value);
            });
        }

        if (types.length === 0) return;

        this.pendingTypes = types;
        this.conn.send({
            type: 'metadata',
            payload: {
                dataTypes: types,
                device: 'Aru User',
                timestamp: Date.now()
            }
        });
    },

    handleIncomingData(data) {
        if (!data || !data.type) return;
        switch (data.type) {
            case 'metadata':
                if (!this.isSender) {
                    this.handleMetadata(data.payload);
                }
                break;
            case 'ready':
                if (this.isSender) {
                    this.startTransfer(this.pendingTypes); 
                }
                break;
            case 'transfer-start':
                this.totalSize = data.payload.totalSize;
                this.dataType = data.payload.dataType;
                this.chunks = [];
                this.receivedSize = 0;
                document.getElementById('transfer-progress-box').classList.remove('hidden');
                break;
            case 'chunk':
                this.handleChunk(data.payload);
                break;
            case 'transfer-complete':
                this.finalizeTransfer();
                break;
            case 'ack':
                break;
        }
    },

    handleMetadata(payload) {
        const t = state.translations || {};
        this.totalSize = 0;
        this.receivedSize = 0;
        this.chunks = [];
        document.getElementById('transfer-progress-box').classList.remove('hidden');
        document.getElementById('transfer-status-text').innerText = t.transfer_receiving_from ? t.transfer_receiving_from + payload.device : "Receiving Data...";
        this.conn.send({ type: 'ready' });
    },

    async startTransfer(dataTypes) {
        const t = state.translations || {};
        document.getElementById('transfer-status-text').innerText = t.transfer_status_preparing || "Preparing data...";
        
        // Wait a small tick so UI updates before heavy sync DB extraction
        await new Promise(r => setTimeout(r, 50)); 
        
        const rawData = DB.getExportData(dataTypes, this.selectedItems);
        if (!rawData) return;

        let u8Buffer;
        
        document.getElementById('transfer-status-text').innerText = t.transfer_status_serializing || "Serializing...";
        await new Promise(r => setTimeout(r, 50));

        if (rawData.data.full_db) {
            u8Buffer = rawData.data.full_db;
        } else {
            try {
                // Avoid using TextEncoder blindly for large strings, convert JSON str to Blob safely
                const jsonStr = JSON.stringify(rawData);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const arrayBuf = await blob.arrayBuffer();
                u8Buffer = new Uint8Array(arrayBuf);
            } catch (e) {
                console.error("Stringify/Encode failed:", e);
                document.getElementById('transfer-status-text').innerText = t.transfer_status_memory_error || "Memory error!";
                return;
            }
        }

        this.totalSize = u8Buffer.length;
        const CHUNK_SIZE = 64 * 1024;
        const numChunks = Math.ceil(this.totalSize / CHUNK_SIZE);
        
        this.conn.send({
            type: 'transfer-start',
            payload: { totalSize: this.totalSize, numChunks: numChunks, dataType: dataTypes.includes('full_db') ? 'full_db' : 'partial' }
        });

        document.getElementById('transfer-status-text').innerText = t.transfer_status_sending || "Streaming data...";

        for (let i = 0; i < numChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(this.totalSize, start + CHUNK_SIZE);
            this.conn.send({ type: 'chunk', payload: { index: i, data: u8Buffer.slice(start, end) } });
            await this.waitForAck(i);
            this.updateProgress(end);
        }

        this.conn.send({ type: 'transfer-complete' });
        document.getElementById('transfer-status-text').innerText = t.transfer_status_finished || "Transfer complete!";
    },

    waitForAck(index) {
        return new Promise((resolve) => {
            const handler = (data) => {
                if (data.type === 'ack' && data.payload.index === index) {
                    this.conn.off('data', handler);
                    resolve();
                }
            };
            this.conn.on('data', handler);
        });
    },

    handleChunk(payload) {
        this.chunks[payload.index] = payload.data;
        this.receivedSize += payload.data.length;
        this.updateProgress(this.receivedSize);
        this.conn.send({ type: 'ack', payload: { index: payload.index } });
    },

    updateProgress(current) {
        const pct = Math.round((current / this.totalSize) * 100);
        const bar = document.getElementById('transfer-progress-bar');
        const pctText = document.getElementById('transfer-pct');
        const stats = document.getElementById('transfer-stats');
        if (bar) bar.style.width = `${pct}%`;
        if (pctText) pctText.innerText = `${pct}%`;
        if (stats) stats.innerText = `${(current / 1024 / 1024).toFixed(1)} / ${(this.totalSize / 1024 / 1024).toFixed(1)} MB`;
    },

    async finalizeTransfer() {
        const t = state.translations || {};
        try {
            const missingChunks = this.chunks.filter(c => !c).length;
            const totalLen = this.chunks.reduce((acc, c) => acc + (c ? c.length : 0), 0);

            if (totalLen === 0 || missingChunks > 0 || (this.totalSize > 0 && totalLen !== this.totalSize)) {
                throw new Error(`Incomplete transfer: received ${totalLen} of ${this.totalSize} bytes, missing chunks: ${missingChunks}`);
            }

            const finalU8 = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of this.chunks) {
                finalU8.set(chunk, offset);
                offset += chunk.length;
            }
            this.receivedData = finalU8;
            this.showMergeUI();
        } catch (e) {
            console.error("finalizeTransfer failed:", e);
            const statusEl = document.getElementById('transfer-status-text');
            if (statusEl) statusEl.innerText = t.transfer_status_incomplete || "Transfer interrupted";
            alert(t.transfer_error_incomplete || "Transfer incomplete: data was not fully received. Please try again.");
        }
    },

    showMergeUI() {
        const t = state.translations || {};
        const isFullDb = this.dataType === 'full_db';
        const content = document.getElementById('transfer-main-layout');
        if (!content) return;

        content.innerHTML = `
            <div class="p-8 flex flex-col items-center justify-center space-y-6 animate-fade-in bg-white dark:bg-gray-900">
                <div class="bg-orange-50 dark:bg-orange-950/30 p-6 rounded-2xl border border-orange-100 dark:border-orange-800 text-center w-full">
                    <div class="w-12 h-12 bg-orange-500 rounded-xl flex items-center justify-center text-white mx-auto mb-4 shadow-lg shadow-orange-500/20">
                        <i data-lucide="check" class="w-6 h-6"></i>
                    </div>
                    <h4 class="text-sm font-bold text-gray-800 dark:text-gray-100">${t.transfer_merge_title || 'Data received!'}</h4>
                </div>

                <div class="space-y-2 w-full">
                    <button onclick="TransferController.applyMerge('overwrite')" class="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-orange-50 dark:bg-gray-800 border border-transparent hover:border-orange-100 rounded-xl transition-all group">
                        <div class="p-2 bg-orange-500 rounded-lg text-white"><i data-lucide="refresh-cw" class="w-4 h-4"></i></div>
                        <div class="text-left"><div class="font-bold text-gray-800 dark:text-gray-200 text-xs">${t.btn_merge_overwrite || 'Full Overwrite'}</div></div>
                    </button>
                    ${!isFullDb ? `
                    <button onclick="TransferController.applyMerge('merge')" class="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-orange-50 dark:bg-gray-800 border border-transparent hover:border-orange-100 rounded-xl transition-all group">
                        <div class="p-2 bg-orange-500 rounded-lg text-white"><i data-lucide="merge" class="w-4 h-4"></i></div>
                        <div class="text-left"><div class="font-bold text-gray-800 dark:text-gray-200 text-xs">${t.btn_merge_combine || 'Merge Data'}</div></div>
                    </button>` : ''}
                    <button onclick="TransferController.applyMerge('separate')" class="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-orange-50 dark:bg-gray-800 border border-transparent hover:border-orange-100 rounded-xl transition-all group">
                        <div class="p-2 bg-blue-500 rounded-lg text-white"><i data-lucide="database" class="w-4 h-4"></i></div>
                        <div class="text-left"><div class="font-bold text-gray-800 dark:text-gray-200 text-xs">${t.btn_merge_new || 'Save as New DB'}</div></div>
                    </button>
                </div>
                
                <button onclick="TransferController.closeModal()" class="text-gray-400 hover:text-gray-600 text-[10px] uppercase font-bold tracking-widest transition-all">
                    ${t.btn_cancel || 'Cancel'}
                </button>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    async applyMerge(mode) {
        const t = state.translations || {};
        try {
            document.getElementById('transfer-main-layout').innerHTML = `
                <div class="w-full flex flex-col items-center justify-center p-12 gap-4">
                    <div class="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                    <div class="text-[10px] font-bold text-orange-500 uppercase tracking-widest">${t.msg_applying_data || 'Applying...'}</div>
                </div>`;
                
            // small delay to let UI render the spinner
            await new Promise(r => setTimeout(r, 100));
            
            const result = await DB.applyTransferData(this.receivedData, mode, this.dataType === 'full_db');
            if (result === true) {
                window.location.reload();
            } else if (result === 'downloaded') {
                document.getElementById('transfer-main-layout').innerHTML = `
                <div class="w-full flex flex-col items-center justify-center p-12 gap-4 text-center">
                    <div class="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center text-white mx-auto shadow-lg shadow-green-500/20 mb-2">
                        <i data-lucide="check" class="w-6 h-6"></i>
                    </div>
                    <div class="text-xs font-bold text-gray-800 dark:text-gray-100 uppercase tracking-widest">${t.transfer_download_done_title || 'File saved!'}</div>
                    <div class="text-[10px] text-gray-500 mt-2 font-medium">${t.transfer_download_done_desc || 'Database downloaded successfully.<br>You can select it when logging into a profile.'}</div>
                </div>`;
                if (window.lucide) lucide.createIcons();
            } else {
                throw new Error("DB Error");
            }
        } catch (e) {
            console.error(e);
            alert((t.alert_transfer_apply_error || "Error applying data: ") + e.message);
            this.closeModal();
        }
    }
};
