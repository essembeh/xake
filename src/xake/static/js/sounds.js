// Move and game-over sounds synthesized with WebAudio, no audio file (spec 002 §8).
let ctx = null;

function context() {
  ctx ??= new AudioContext();
  return ctx;
}

// Browsers keep the context suspended until a user gesture: resume it on the first one.
export function unlockOnGesture() {
  const unlock = () => context().resume().catch(() => {});
  document.addEventListener("pointerdown", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
}

function tone(t, freq, { gain = 0.3, dur = 0.15, slideTo = null } = {}) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const notes = (t, freqs, step, opts) => freqs.forEach((freq, i) => tone(t + i * step, freq, opts));

const SOUNDS = {
  Move: (t) => tone(t, 520, { dur: 0.07, slideTo: 380 }),
  Capture: (t) => {
    tone(t, 420, { gain: 0.35, dur: 0.08, slideTo: 260 });
    tone(t + 0.06, 300, { gain: 0.25, dur: 0.08, slideTo: 200 });
  },
  Check: (t) => notes(t, [880, 1175], 0.08, { gain: 0.25, dur: 0.16 }),
  Victory: (t) => notes(t, [523, 659, 784, 1047], 0.1, { dur: 0.35 }),
  Defeat: (t) => notes(t, [440, 349, 294], 0.15, { dur: 0.45 }),
  Draw: (t) => notes(t, [587, 587], 0.2, { gain: 0.25, dur: 0.3 }),
};

export async function play(name) {
  const audio = context();
  if (audio.state !== "running") await audio.resume().catch(() => {});
  // Still suspended (no gesture yet, autoplay blocked): a missing sound is harmless.
  if (audio.state === "running") SOUNDS[name](audio.currentTime + 0.02);
}

// over: gameOverInfo() of the position after the move; perspective: my colour, null when playing both sides.
export function soundFor(san, over, perspective) {
  if (over) {
    if (!over.winner) return "Draw";
    if (!perspective) return "Victory";
    return over.winner === perspective ? "Victory" : "Defeat";
  }
  if (/[+#]/.test(san)) return "Check";
  return san.includes("x") ? "Capture" : "Move";
}
