/*
---ARU-LAB.SPACE---ALMATY---2026---
Transfer Controller handles WebRTC data exchange between devices.
---chat.aru-lab.space---PWA---
*/
import { aruGlobalState as state } from './aruState.js';
import { DB } from './db.js';
import { UI } from './ui.js';
import { loadTransferLibs } from './lazyLoader.js';

export const TransferController = {
    peer: null,
    conn: null,
    isSender: false,
    chunks: [],
    receivedData: null,
    receivedSize: 0,
    totalSize: 0,
    expectedChunks: 0,
    dataType: null,
    pendingTypes: [],
    videoStream: null,
    transferAccepted: false,
    _modalOpen: false,
    _scanRafId: null,
    _cameraRequestSeq: 0,
    _lastScanAt: 0,
    _receivedChunkSet: null,
    _cancelAck: null,
    _sending: false,
    selectedItems: { chats: null, artifacts: null, tasks: null },

    init() {
        console.log("TransferController: Initialized");
    },

    openTransferModal() {
        this.cleanup();
        this._modalOpen = true;
        loadTransferLibs(['peerjs', 'qrcode', 'jsqr']).catch(() => {});
        const t = state.translations || {};
        const modalContainer = document.getElementById('modal-container');

        const html = `
        <div id="modal-transfer-overlay" class="fixed top-[60px] md:top-[72px] inset-x-0 bottom-0 z-[100] flex items-center justify-center p-2 md:p-4 animate-fade-in backdrop-blur-md bg-white/5 dark:bg-black/5">
            <div class="absolute inset-0" onclick="TransferController.closeModal()"></div>
            <div id="transfer-modal-card" class="bg-white dark:bg-gray-900 w-full max-w-sm rounded-3xl shadow-2xl relative overflow-hidden border border-gray-100 dark:border-gray-800 flex flex-col max-h-[calc(100dvh-76px)] md:max-h-[calc(100dvh-104px)] scale-in">
                
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

                <div id="transfer-main-layout" class="flex flex-col overflow-y-auto min-h-0">
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
                                        <input type="checkbox" id="chk-settings" name="transfer-data" value="settings" class="w-3.5 h-3.5 rounded accent-orange-500" onchange="TransferController.onMainCheckboxChange('settings')">
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
                                <video id="qr-video" muted playsinline class="w-full h-full object-cover hidden"></video>
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

                    <!-- Incoming Transfer Confirmation -->
                    <div id="transfer-confirm-box" class="hidden p-4 border-t border-orange-100 dark:border-orange-900/40 bg-orange-50/70 dark:bg-orange-950/20 animate-slide-up">
                        <div class="text-[9px] font-black text-orange-500 uppercase tracking-widest mb-1">${t.transfer_incoming_title || 'Incoming transfer'}</div>
                        <div id="transfer-confirm-text" class="text-[11px] font-bold text-gray-700 dark:text-gray-200 mb-3 break-words"></div>
                        <div class="flex gap-2">
                            <button onclick="TransferController.acceptIncoming()" class="flex-1 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest transition-all">${t.btn_accept || 'Accept'}</button>
                            <button onclick="TransferController.declineIncoming()" class="flex-1 py-2 bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all">${t.btn_decline || 'Decline'}</button>
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
        `;

        modalContainer.innerHTML = html;
        if (window.lucide) lucide.createIcons();
    },

    stopCamera() {
        this._cameraRequestSeq++;
        if (this._scanRafId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this._scanRafId);
        }
        this._scanRafId = null;
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => {
                try { track.stop(); } catch (_) {}
            });
            this.videoStream = null;
        }
        const video = typeof document !== 'undefined' ? document.getElementById('qr-video') : null;
        if (video) {
            try { video.pause(); } catch (_) {}
            video.srcObject = null;
            video.classList.add('hidden');
        }
        const overlay = typeof document !== 'undefined' ? document.getElementById('scan-overlay') : null;
        if (overlay) overlay.classList.add('hidden');
        const btn = typeof document !== 'undefined' ? document.getElementById('btn-start-receive') : null;
        if (btn) btn.disabled = false;
    },

    destroyPeer() {
        if (this._cancelAck) {
            const cancel = this._cancelAck;
            this._cancelAck = null;
            try { cancel(new Error((state.translations || {}).transfer_status_closed || 'Connection closed')); } catch (_) {}
        }
        this._sending = false;
        if (this.conn) {
            try { this.conn.close(); } catch (_) {}
            this.conn = null;
        }
        if (this.peer) {
            try { this.peer.destroy(); } catch (_) {}
            this.peer = null;
        }
        const sendBtn = typeof document !== 'undefined' ? document.getElementById('btn-start-send') : null;
        if (sendBtn) sendBtn.disabled = false;
    },

    cleanup() {
        this.stopCamera();
        this.destroyPeer();
        this.chunks = [];
        this._receivedChunkSet = new Set();
        this.receivedData = null;
        this.receivedSize = 0;
        this.totalSize = 0;
        this.expectedChunks = 0;
        this.dataType = null;
        this.pendingTypes = [];
        this.transferAccepted = false;
        this.isSender = false;
        this.selectedItems = { chats: null, artifacts: null, tasks: null };
    },

    closeModal() {
        this._modalOpen = false;
        this.cleanup();
        const modalContainer = document.getElementById('modal-container');
        if (modalContainer) modalContainer.innerHTML = '';
    },

    switchTab(tab) {
        this.stopCamera();
        this.destroyPeer();
        this.transferAccepted = false;
        this.pendingTypes = [];
        const confirmBox = document.getElementById('transfer-confirm-box');
        const progressBox = document.getElementById('transfer-progress-box');
        if (confirmBox) confirmBox.classList.add('hidden');
        if (progressBox) progressBox.classList.add('hidden');

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
            <div class="bg-white dark:bg-gray-900 w-full max-w-sm rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-800 flex flex-col max-h-[calc(100dvh-76px)] md:max-h-[calc(100dvh-104px)]">
                <!-- Header -->
                <div class="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-900/50">
                    <h4 class="text-xs font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wider">${t.transfer_select_items || 'Select items'}</h4>
                    <span class="text-[10px] text-gray-400 font-mono">${UI.escapeHTML(title)}</span>
                </div>
                
                <!-- Quick toggles -->
                <div class="flex border-b border-gray-50 dark:border-gray-800 select-none">
                    <button onclick="document.querySelectorAll('.sub-modal-chk').forEach(c => c.checked = true)" class="flex-1 py-2 text-[9px] font-bold text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 active:bg-orange-100 border-r border-gray-50 dark:border-gray-800 transition-colors uppercase tracking-widest">${t.btn_select_all || 'Select all'}</button>
                    <button onclick="document.querySelectorAll('.sub-modal-chk').forEach(c => c.checked = false)" class="flex-1 py-2 text-[9px] font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 transition-colors uppercase tracking-widest">${t.btn_deselect_all || 'Deselect all'}</button>
                </div>

                <!-- List -->
                <div class="flex-1 overflow-y-auto p-2 min-h-0" id="sub-modal-list">
                    ${items.length === 0 ? `<div class="p-6 text-center text-gray-400 text-[10px] font-medium">${t.transfer_no_data || 'No data'}</div>` : ''}
                    ${items.map(item => {
                        const isChecked = currentlySelected === null || currentlySelected.includes(item.id);
                        return `
                        <label class="flex items-center gap-3 p-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg cursor-pointer transition-colors w-full group">
                            <input type="checkbox" value="${UI.escapeHTML(item.id)}" ${isChecked ? 'checked' : ''} class="sub-modal-chk w-4 h-4 rounded accent-orange-500 cursor-pointer">
                            <span class="text-xs text-gray-700 dark:text-gray-300 truncate w-full group-hover:text-orange-600 transition-colors">${UI.escapeHTML(item.name || t.transfer_untitled || 'Untitled')}</span>
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
        
        const host = document.getElementById('transfer-modal-card') || document.getElementById('modal-transfer-overlay');
        if (host) host.insertAdjacentHTML('beforeend', html);
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

        if (totalCount > 0 && selected.length === totalCount) {
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
        
        document.getElementById('transfer-sub-modal')?.remove();
        this.updateCheckAllState();
    },

    _buildPeerConfig() {
        const stunServer = state.userSettings?.stun_server || 'stun:stun.l.google.com:19302';
        const signaling = String(state.userSettings?.signaling_server || 'peerjs-default').trim();
        const config = { config: { iceServers: [{ urls: stunServer }] } };
        if (signaling && signaling !== 'peerjs-default') {
            try {
                const rawUrl = signaling.includes('://') ? signaling : 'https://' + signaling;
                const u = new URL(rawUrl);
                config.host = u.hostname;
                const isHttps = u.protocol === 'https:';
                config.secure = isHttps;
                config.port = u.port ? parseInt(u.port, 10) : (isHttps ? 443 : 80);
                if (u.pathname && u.pathname !== '/') config.path = u.pathname;
            } catch (e) {
                console.warn('TransferController: invalid signaling server URL:', signaling, e);
            }
        }
        return config;
    },

    // --- Sender Logic ---
    async initSender() {
        const t = state.translations || {};
        this.stopCamera();
        this.destroyPeer();
        const btn = document.getElementById('btn-start-send');
        if (btn) btn.disabled = true;

        try {
            await loadTransferLibs(['peerjs', 'qrcode']);
        } catch (loadErr) {
            console.error('Failed to load WebRTC/QR libs:', loadErr);
            if (btn) btn.disabled = false;
            await UI.alert((t.transfer_lib_load_error || 'Failed to load transfer libraries. Check your connection.') + (loadErr?.message ? `\n${loadErr.message}` : ''));
            return;
        }
        if (!this._modalOpen) return;

        this.isSender = true;
        this.transferAccepted = false;

        const peer = new Peer(this._buildPeerConfig());
        this.peer = peer;

        peer.on('open', (id) => {
            if (this.peer !== peer) return;
            this.generateQR(id);
            const idDisp = document.getElementById('peer-id-display');
            if (idDisp) {
                idDisp.innerText = id;
                idDisp.classList.remove('hidden');
            }
        });

        peer.on('connection', (conn) => {
            if (this.peer !== peer) {
                try { conn.close(); } catch (_) {}
                return;
            }
            if (this.conn && this.conn !== conn) {
                try { conn.close(); } catch (_) {}
                return;
            }
            this.conn = conn;
            this.setupConnectionHandlers();
        });

        peer.on('error', (err) => {
            if (this.peer !== peer) return;
            console.error('Peer error:', err);
            if (btn) btn.disabled = false;
            const statusEl = document.getElementById('transfer-status-text');
            if (statusEl) statusEl.innerText = err?.message || (t.transfer_status_error || 'Connection error');
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
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            UI.alert(t.alert_camera_denied || "Camera access denied.");
            return;
        }

        this.stopCamera();
        const reqSeq = ++this._cameraRequestSeq;
        if (btn) btn.disabled = true;

        // Trigger script loads immediately without awaiting before getUserMedia (keeps user activation)
        loadTransferLibs(['jsqr', 'peerjs']).catch(err => {
            console.warn('Lazy transfer lib load error during scan init:', err);
        });

        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((stream) => {
            const curVideo = document.getElementById('qr-video');
            if (!this._modalOpen || reqSeq !== this._cameraRequestSeq || !curVideo) {
                stream.getTracks().forEach(track => {
                    try { track.stop(); } catch (_) {}
                });
                return;
            }
            this.videoStream = stream;
            curVideo.srcObject = stream;
            curVideo.muted = true;
            curVideo.setAttribute("playsinline", "");
            Promise.resolve(curVideo.play()).catch(() => {});
            curVideo.classList.remove('hidden');
            if (container) container.classList.add('hidden');
            if (overlay) overlay.classList.remove('hidden');

            this._lastScanAt = 0;
            this._scanRafId = requestAnimationFrame(() => this.scanTick());
        }).catch(err => {
            if (!this._modalOpen || reqSeq !== this._cameraRequestSeq) return;
            if (btn) btn.disabled = false;
            console.error("Camera access denied:", err);
            UI.alert(t.alert_camera_denied || "Camera access denied.");
        });
    },

    scanTick() {
        this._scanRafId = null;
        if (!this._modalOpen || !this.videoStream) return;
        const video = document.getElementById('qr-video');
        if (!video || video.paused || video.ended) return;

        const now = Date.now();
        if (typeof jsQR === 'function' && now - (this._lastScanAt || 0) >= 150 && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
            this._lastScanAt = now;
            const canvas = document.getElementById('qr-canvas');
            if (canvas) {
                try {
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    if (ctx) {
                        const scale = Math.min(1, 640 / video.videoWidth);
                        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
                        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const code = jsQR(imageData.data, imageData.width, imageData.height, {
                            inversionAttempts: "dontInvert",
                        });

                        if (code && code.data) {
                            const t = state.translations || {};
                            this.stopCamera();
                            const receiveStatus = document.getElementById('receive-status');
                            if (receiveStatus) {
                                receiveStatus.innerHTML = '';
                                const span = document.createElement('span');
                                span.className = 'text-white font-bold opacity-50 text-[10px]';
                                span.textContent = t.transfer_status_connected || 'Connected';
                                receiveStatus.appendChild(span);
                                receiveStatus.classList.remove('hidden');
                            }
                            this.connectToPeer(code.data);
                            return;
                        }
                    }
                } catch (e) {
                    console.warn('QR scan frame error:', e);
                }
            }
        }
        this._scanRafId = requestAnimationFrame(() => this.scanTick());
    },

    connectManual() {
        const input = document.getElementById('manual-peer-id');
        const id = input ? input.value.trim() : '';
        if (!id) return;
        this.stopCamera();
        this.connectToPeer(id);
    },

    async connectToPeer(peerId) {
        const t = state.translations || {};
        this.destroyPeer();
        this.isSender = false;
        this.transferAccepted = false;

        try {
            await loadTransferLibs(['peerjs']);
        } catch (loadErr) {
            console.error('Failed to load PeerJS:', loadErr);
            const box = document.getElementById('transfer-progress-box');
            const statusEl = document.getElementById('transfer-status-text');
            if (box) box.classList.remove('hidden');
            if (statusEl) statusEl.innerText = loadErr?.message || (t.transfer_status_error || 'Connection error');
            await UI.alert((t.transfer_lib_load_error || 'Failed to load transfer library. Check your connection.') + (loadErr?.message ? `\n${loadErr.message}` : ''));
            return;
        }
        if (!this._modalOpen) return;

        const peer = new Peer(this._buildPeerConfig());
        this.peer = peer;

        peer.on('open', () => {
            if (this.peer !== peer) return;
            this.conn = peer.connect(peerId);
            this.setupConnectionHandlers();
        });

        peer.on('error', (err) => {
            if (this.peer !== peer) return;
            console.error('Peer error:', err);
            const box = document.getElementById('transfer-progress-box');
            const statusEl = document.getElementById('transfer-status-text');
            if (box) box.classList.remove('hidden');
            if (statusEl) statusEl.innerText = err?.message || (t.transfer_status_error || 'Connection error');
        });
    },

    setupConnectionHandlers() {
        const conn = this.conn;
        if (!conn) return;
        const t = state.translations || {};
        conn.on('open', () => {
            if (this.conn !== conn) return;
            const box = document.getElementById('transfer-progress-box');
            const statusEl = document.getElementById('transfer-status-text');
            if (box) box.classList.remove('hidden');
            if (statusEl) statusEl.innerText = (t.transfer_status_connected || 'Connection established') + "...";
            if (this.isSender) {
                this.sendMetadata();
            }
        });
        conn.on('data', (data) => {
            if (this.conn !== conn) return;
            this.handleIncomingData(data);
        });
        conn.on('close', () => {
            if (this.conn !== conn) return;
            const statusEl = document.getElementById('transfer-status-text');
            if (statusEl) statusEl.innerText = t.transfer_status_closed || 'Connection closed';
        });
        conn.on('error', (err) => {
            if (this.conn !== conn) return;
            console.error('Peer connection error:', err);
            const statusEl = document.getElementById('transfer-status-text');
            if (statusEl) statusEl.innerText = err?.message || (t.transfer_status_error || 'Connection error');
        });
    },

    sendMetadata() {
        if (!this.conn) return false;
        const t = state.translations || {};
        const allDb = document.getElementById('check-all-db')?.checked;
        const types = [];
        if (allDb) {
            types.push('full_db');
        } else {
            document.querySelectorAll('input[name="transfer-data"]').forEach(chk => {
                if (chk.checked || chk.indeterminate) types.push(chk.value);
            });
        }

        if (types.length === 0) {
            UI?.alert?.(t.alert_no_data_selected || t.transfer_no_data || 'Please select data to transfer.');
            return false;
        }

        this.pendingTypes = types;
        this.conn.send({
            type: 'metadata',
            payload: {
                dataTypes: types,
                device: 'Aru User',
                timestamp: Date.now()
            }
        });
        return true;
    },

    handleIncomingData(data) {
        if (!data || !data.type) return;
        const t = state.translations || {};
        switch (data.type) {
            case 'metadata':
                if (!this.isSender) {
                    this.handleMetadata(data.payload || {});
                }
                break;
            case 'ready':
                if (this.isSender && !this._sending) {
                    this.startTransfer(this.pendingTypes);
                }
                break;
            case 'decline':
                if (this.isSender) {
                    this._sending = false;
                    if (this._cancelAck) {
                        const cancel = this._cancelAck;
                        this._cancelAck = null;
                        cancel(new Error(t.transfer_status_declined || 'Transfer declined'));
                    }
                    const statusEl = document.getElementById('transfer-status-text');
                    if (statusEl) statusEl.innerText = t.transfer_status_declined || 'Transfer declined';
                }
                break;
            case 'transfer-start': {
                if (this.isSender || !this.transferAccepted) return;
                const payload = data.payload || {};
                this.totalSize = Number(payload.totalSize) || 0;
                this.expectedChunks = Number.isInteger(payload.numChunks) ? payload.numChunks : 0;
                this.dataType = payload.dataType || null;
                this.chunks = [];
                this._receivedChunkSet = new Set();
                this.receivedSize = 0;
                const progressBox = document.getElementById('transfer-progress-box');
                if (progressBox) progressBox.classList.remove('hidden');
                this.updateProgress(0);
                break;
            }
            case 'chunk':
                if (this.isSender || !this.transferAccepted) return;
                this.handleChunk(data.payload);
                break;
            case 'transfer-complete':
                if (this.isSender || !this.transferAccepted) return;
                this.finalizeTransfer();
                break;
            case 'ack':
                break;
        }
    },

    handleMetadata(payload) {
        const t = state.translations || {};
        this.transferAccepted = false;
        this.totalSize = 0;
        this.expectedChunks = 0;
        this.receivedSize = 0;
        this.chunks = [];
        this._receivedChunkSet = new Set();

        const typeLabels = {
            full_db: t.data_all_db || 'Full System Image',
            chats: t.data_chats || 'Chats',
            settings: t.data_settings || 'Config',
            artifacts: t.data_artifacts || 'Files',
            tasks: t.data_tasks || 'Tasks'
        };
        const types = Array.isArray(payload.dataTypes) ? payload.dataTypes : [];
        const typeText = types.map(type => typeLabels[type] || type).join(', ') || '—';
        const device = String(payload.device || 'Aru').slice(0, 60);

        const confirmBox = document.getElementById('transfer-confirm-box');
        const confirmText = document.getElementById('transfer-confirm-text');
        const progressBox = document.getElementById('transfer-progress-box');
        if (progressBox) progressBox.classList.add('hidden');

        // Explicit consent: a peer id alone must not be enough to push data.
        if (confirmBox && confirmText) {
            confirmText.textContent = `${device}: ${typeText}`;
            confirmBox.classList.remove('hidden');
        }
    },

    acceptIncoming() {
        const t = state.translations || {};
        this.transferAccepted = true;
        const confirmBox = document.getElementById('transfer-confirm-box');
        const progressBox = document.getElementById('transfer-progress-box');
        const statusEl = document.getElementById('transfer-status-text');
        if (confirmBox) confirmBox.classList.add('hidden');
        if (progressBox) progressBox.classList.remove('hidden');
        if (statusEl) statusEl.innerText = t.transfer_status_connected || 'Connection established';
        if (this.conn) this.conn.send({ type: 'ready' });
    },

    declineIncoming() {
        this.transferAccepted = false;
        try {
            if (this.conn) this.conn.send({ type: 'decline' });
        } catch (_) {}
        this.receivedData = null;
        this.totalSize = 0;
        this.expectedChunks = 0;
        this.chunks = [];
        this._receivedChunkSet = new Set();
        this.closeModal();
    },

    async startTransfer(dataTypes) {
        if (!this.conn || this._sending) return;
        this._sending = true;
        const activeConn = this.conn;
        const t = state.translations || {};
        try {
            const statusEl = document.getElementById('transfer-status-text');
            if (statusEl) statusEl.innerText = t.transfer_status_preparing || "Preparing data...";

            // Wait a small tick so UI updates before heavy sync DB extraction
            await new Promise(r => setTimeout(r, 50));
            if (this.conn !== activeConn) return;

            const rawData = DB.getExportData(dataTypes, this.selectedItems, { stripSecrets: dataTypes.includes('settings') });
            if (!rawData) return;

            let u8Buffer;
            if (statusEl) statusEl.innerText = t.transfer_status_serializing || "Serializing...";
            await new Promise(r => setTimeout(r, 50));
            if (this.conn !== activeConn) return;

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
                    if (statusEl) statusEl.innerText = t.transfer_status_memory_error || "Memory error!";
                    return;
                }
            }

            if (this.conn !== activeConn) return;
            this.totalSize = u8Buffer.byteLength;
            const CHUNK_SIZE = 16 * 1024;
            const numChunks = Math.ceil(this.totalSize / CHUNK_SIZE);

            activeConn.send({
                type: 'transfer-start',
                payload: { totalSize: this.totalSize, numChunks: numChunks, dataType: dataTypes.includes('full_db') ? 'full_db' : 'partial' }
            });

            if (statusEl) statusEl.innerText = t.transfer_status_sending || "Streaming data...";

            try {
                for (let i = 0; i < numChunks; i++) {
                    if (this.conn !== activeConn) throw new Error(t.transfer_status_closed || 'Connection closed');
                    const start = i * CHUNK_SIZE;
                    const end = Math.min(this.totalSize, start + CHUNK_SIZE);
                    activeConn.send({ type: 'chunk', payload: { index: i, data: u8Buffer.slice(start, end) } });
                    await this.waitForAck(i);
                    this.updateProgress(end);
                }
            } catch (e) {
                console.error('Transfer interrupted:', e);
                if (statusEl) statusEl.innerText = e.message || (t.transfer_status_incomplete || 'Transfer interrupted');
                try { activeConn.close(); } catch (_) {}
                return;
            }

            if (this.conn !== activeConn) return;
            activeConn.send({ type: 'transfer-complete' });
            if (statusEl) statusEl.innerText = t.transfer_status_finished || "Transfer complete!";
        } finally {
            this._sending = false;
        }
    },

    waitForAck(index, timeoutMs = 20000) {
        const conn = this.conn;
        if (!conn) {
            const t = state.translations || {};
            return Promise.reject(new Error(t.transfer_status_closed || 'Connection closed'));
        }
        return new Promise((resolve, reject) => {
            const t = state.translations || {};
            let settled = false;
            const off = (ev, fn) => {
                if (conn.off) conn.off(ev, fn);
                else if (conn.removeListener) conn.removeListener(ev, fn);
            };
            const cleanup = () => {
                clearTimeout(timer);
                off('data', onData);
                off('close', onClose);
                off('error', onError);
                if (this._cancelAck === cancel) this._cancelAck = null;
            };
            const finishReject = (err) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(err);
            };
            const cancel = (err) => finishReject(err);
            const onData = (data) => {
                if (settled || !data) return;
                if (data.type === 'decline') {
                    finishReject(new Error(t.transfer_status_declined || 'Transfer declined'));
                    return;
                }
                if (data.type === 'ack' && data.payload && data.payload.index === index) {
                    settled = true;
                    cleanup();
                    resolve();
                }
            };
            const onClose = () => finishReject(new Error(t.transfer_status_closed || 'Connection closed'));
            const onError = (err) => finishReject(err instanceof Error ? err : new Error(err?.message || 'Connection error'));
            const timer = setTimeout(() => finishReject(new Error(t.transfer_error_peer_timeout || 'Peer stopped responding. Transfer cancelled.')), timeoutMs);

            this._cancelAck = cancel;
            conn.on('data', onData);
            conn.on('close', onClose);
            conn.on('error', onError);
        });
    },

    _toUint8Array(raw) {
        if (raw instanceof Uint8Array) return raw;
        if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
        if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
        if (Array.isArray(raw)) return new Uint8Array(raw);
        return null;
    },

    handleChunk(payload) {
        if (!payload) return;
        const idx = payload.index;
        if (!Number.isInteger(idx) || idx < 0) return;
        if (this.expectedChunks > 0 && idx >= this.expectedChunks) return;
        const u8 = this._toUint8Array(payload.data);
        if (!u8) return;

        if (!this._receivedChunkSet) this._receivedChunkSet = new Set();
        if (!this._receivedChunkSet.has(idx)) {
            this.chunks[idx] = u8;
            this._receivedChunkSet.add(idx);
            this.receivedSize += u8.byteLength;
            this.updateProgress(this.receivedSize);
        }
        if (this.conn) this.conn.send({ type: 'ack', payload: { index: idx } });
    },

    updateProgress(current) {
        const pct = this.totalSize > 0 ? Math.min(100, Math.round((current / this.totalSize) * 100)) : 0;
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
            const expected = this.expectedChunks > 0 ? this.expectedChunks : this.chunks.length;
            let missingChunks = 0;
            let totalLen = 0;
            for (let i = 0; i < expected; i++) {
                const c = this.chunks[i];
                if (!(c instanceof Uint8Array)) {
                    missingChunks++;
                } else {
                    totalLen += c.byteLength;
                }
            }

            if (expected === 0 || totalLen === 0 || missingChunks > 0 || (this.totalSize > 0 && totalLen !== this.totalSize)) {
                throw new Error(`Incomplete transfer: received ${totalLen} of ${this.totalSize} bytes, missing chunks: ${missingChunks}`);
            }

            const finalU8 = new Uint8Array(totalLen);
            let offset = 0;
            for (let i = 0; i < expected; i++) {
                const chunk = this.chunks[i];
                finalU8.set(chunk, offset);
                offset += chunk.byteLength;
            }
            this.receivedData = finalU8;
            this.showMergeUI();
        } catch (e) {
            console.error("finalizeTransfer failed:", e);
            const statusEl = document.getElementById('transfer-status-text');
            if (statusEl) statusEl.innerText = t.transfer_status_incomplete || "Transfer interrupted";
            await UI.alert(t.transfer_error_incomplete || "Transfer incomplete: data was not fully received. Please try again.");
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
            await UI.alert((t.alert_transfer_apply_error || "Error applying data: ") + e.message);
            this.closeModal();
        }
    }
};
