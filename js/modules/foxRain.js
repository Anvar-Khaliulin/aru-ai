/*
---ARU-LAB.SPACE---ALMATY---2026---
Fox Rain hides a small easter egg: five quick taps on the header fox make emotion stickers fall.
---chat.aru-lab.space---PWA---
*/

const EMOTIONS = [
    'angry', 'cool', 'crazy', 'cry', 'geek', 'happy', 'love', 'normal', 'oh',
    'please', 'rock', 'sad', 'sleep', 'thinking', 'wow'
];

const TAP_WINDOW_MS = 3000;
const TAPS_REQUIRED = 5;

export const FoxRain = {
    _tapTimes: [],
    _overlay: null,

    init() {
        const trigger = document.getElementById('aru-fox-avatar');
        if (!trigger || trigger.dataset.foxRainBound === '1') return;
        trigger.dataset.foxRainBound = '1';

        trigger.addEventListener('pointerdown', (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            const now = Date.now();
            this._tapTimes = this._tapTimes.filter((ts) => now - ts <= TAP_WINDOW_MS);
            this._tapTimes.push(now);
            if (this._tapTimes.length >= TAPS_REQUIRED) {
                this._tapTimes = [];
                this.rain();
            }
        });
    },

    rain() {
        if (!document.body) return;
        const overlay = this._ensureOverlay();
        const total = window.innerWidth < 640 ? 26 : 38;
        overlay._remaining = (overlay._remaining || 0) + total;
        for (let i = 0; i < total; i++) {
            this._spawn(overlay);
        }
    },

    _ensureOverlay() {
        if (this._overlay && this._overlay.isConnected) return this._overlay;
        const overlay = document.createElement('div');
        overlay.id = 'aru-fox-rain';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'overflow:hidden',
            'pointer-events:none',
            'z-index:2147483000'
        ].join(';');
        document.body.appendChild(overlay);
        this._overlay = overlay;
        return overlay;
    },

    _spawn(overlay) {
        const image = new Image();
        image.src = `media/emotions/${EMOTIONS[Math.floor(Math.random() * EMOTIONS.length)]}.png`;
        image.alt = '';
        image.draggable = false;
        image.decoding = 'async';

        const size = 34 + Math.random() * 82;
        image.style.cssText = [
            'position:absolute',
            'top:0',
            'left:0',
            `width:${size.toFixed(0)}px`,
            'height:auto',
            'will-change:transform',
            'user-select:none',
            '-webkit-user-drag:none'
        ].join(';');
        overlay.appendChild(image);

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const startX = Math.random() * viewportWidth - size / 2;
        const drift = Math.random() * 140 - 70;
        const startY = -size - Math.random() * viewportHeight * 0.3;
        const endY = viewportHeight + size + Math.random() * viewportHeight * 0.15;
        const startRotation = Math.random() * 70 - 35;
        const spin = Math.random() * 540 - 270;
        const duration = 2400 + Math.random() * 2200;
        const delay = Math.random() * 700;

        const animation = image.animate([
            {
                transform: `translate3d(${startX}px, ${startY}px, 0) rotate(${startRotation}deg)`,
                opacity: 1
            },
            {
                offset: 0.55,
                transform: `translate3d(${startX + drift}px, ${startY + (endY - startY) * 0.55}px, 0) rotate(${startRotation + spin * 0.6}deg)`,
                opacity: 1
            },
            {
                transform: `translate3d(${startX + drift * 0.4}px, ${endY}px, 0) rotate(${startRotation + spin}deg)`,
                opacity: 1
            }
        ], {
            duration,
            delay,
            easing: 'cubic-bezier(.32,.12,.58,.92)',
            fill: 'both'
        });

        animation.onfinish = () => {
            image.remove();
            overlay._remaining -= 1;
            if (overlay._remaining <= 0) {
                overlay.remove();
                if (this._overlay === overlay) this._overlay = null;
            }
        };
    }
};
