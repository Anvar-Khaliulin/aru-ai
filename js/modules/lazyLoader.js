/*
---ARU-LAB.SPACE---ALMATY---2026---
On-demand script loader for heavy optional libraries (PDF, DOCX, XLSX, PDF export, WebRTC/QR).
Deduplicates concurrent loads and clears failed entries so offline retries succeed later.
---chat.aru-lab.space---PWA---
*/

const pending = new Map();

const PDF_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const TRANSFER_LIB_MAP = {
    peerjs: {
        src: 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js',
        isReady: () => typeof window.Peer !== 'undefined'
    },
    qrcode: {
        src: 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
        isReady: () => typeof window.QRCode !== 'undefined'
    },
    jsqr: {
        src: 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
        isReady: () => typeof window.jsQR !== 'undefined'
    }
};

export function loadScriptOnce(src, isReady) {
    if (typeof isReady === 'function' && isReady()) {
        return Promise.resolve();
    }
    if (pending.has(src)) {
        return pending.get(src);
    }

    let settledFailed = false;
    const promise = new Promise((resolve, reject) => {
        if (typeof document === 'undefined') {
            settledFailed = true;
            reject(new Error(`Cannot load script without document: ${src}`));
            return;
        }
        const parent = document.head || document.documentElement;
        if (!parent) {
            settledFailed = true;
            reject(new Error(`Document container unavailable for script: ${src}`));
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
            if (typeof isReady === 'function' && !isReady()) {
                settledFailed = true;
                pending.delete(src);
                script.remove();
                reject(new Error(`Script loaded without expected global: ${src}`));
                return;
            }
            resolve();
        };
        script.onerror = () => {
            settledFailed = true;
            pending.delete(src);
            script.remove();
            reject(new Error(`Failed to load script: ${src}`));
        };
        parent.appendChild(script);
    });

    if (!settledFailed) {
        pending.set(src, promise);
    }
    return promise;
}

export async function loadPdfJs() {
    await loadScriptOnce(
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
        () => typeof window.pdfjsLib !== 'undefined'
    );
    if (window.pdfjsLib?.GlobalWorkerOptions) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    }
    return window.pdfjsLib;
}

export async function loadMammoth() {
    await loadScriptOnce(
        'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
        () => typeof window.mammoth !== 'undefined'
    );
    return window.mammoth;
}

export async function loadXlsx() {
    await loadScriptOnce(
        'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js',
        () => typeof window.XLSX !== 'undefined'
    );
    return window.XLSX;
}

export async function loadHtml2Pdf() {
    await loadScriptOnce(
        'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
        () => typeof window.html2pdf !== 'undefined'
    );
    return window.html2pdf;
}

export function loadTransferLibs(which = ['peerjs', 'qrcode', 'jsqr']) {
    const requested = Array.isArray(which) ? which : ['peerjs', 'qrcode', 'jsqr'];
    return Promise.all(
        requested.map((key) => {
            const entry = TRANSFER_LIB_MAP[key];
            if (!entry) return Promise.resolve();
            return loadScriptOnce(entry.src, entry.isReady);
        })
    );
}
