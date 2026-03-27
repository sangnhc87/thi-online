// Simple sound effects using Web Audio API (no files needed)
let audioCtx = null;

function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

function playTone(freq, duration = 0.15, type = 'sine', volume = 0.3) {
    try {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
    } catch (e) { /* silent fail on browsers blocking audio */ }
}

export function playCorrect() {
    playTone(523, 0.1, 'sine', 0.25);
    setTimeout(() => playTone(659, 0.1, 'sine', 0.25), 80);
    setTimeout(() => playTone(784, 0.15, 'sine', 0.3), 160);
}

export function playWrong() {
    playTone(200, 0.2, 'square', 0.15);
    setTimeout(() => playTone(180, 0.25, 'square', 0.12), 150);
}

export function playCombo(streak) {
    const base = 440 + (streak * 40);
    playTone(base, 0.08, 'sine', 0.2);
    setTimeout(() => playTone(base * 1.25, 0.08, 'sine', 0.2), 60);
    setTimeout(() => playTone(base * 1.5, 0.12, 'sine', 0.25), 120);
    setTimeout(() => playTone(base * 2, 0.2, 'sine', 0.3), 180);
}

export function playTick() {
    playTone(800, 0.05, 'sine', 0.1);
}

export function playAlarm() {
    playTone(440, 0.15, 'square', 0.2);
    setTimeout(() => playTone(440, 0.15, 'square', 0.2), 300);
    setTimeout(() => playTone(440, 0.15, 'square', 0.2), 600);
}

export function playVictory() {
    const notes = [523, 587, 659, 698, 784, 880, 988, 1047];
    notes.forEach((freq, i) => {
        setTimeout(() => playTone(freq, 0.12, 'sine', 0.2), i * 80);
    });
}

export function playPerfect() {
    playVictory();
    setTimeout(() => {
        playTone(1047, 0.3, 'sine', 0.35);
        playTone(1319, 0.3, 'sine', 0.3);
        playTone(1568, 0.4, 'sine', 0.35);
    }, 700);
}

export function playCountdown() {
    playTone(440, 0.1, 'sine', 0.15);
}

export function playStart() {
    playTone(523, 0.1, 'sine', 0.2);
    setTimeout(() => playTone(659, 0.1, 'sine', 0.2), 100);
    setTimeout(() => playTone(784, 0.2, 'sine', 0.3), 200);
}
