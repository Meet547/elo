// Felt — sound.ts : synthesised table foley, no assets.
//
// One design language: every event is a short physical gesture — a knock, a
// flick, clay on clay — built from filtered noise + a pitched body, mixed
// through a gentle master bus. The three betting verbs each get their own
// "thock": a damped low-mid knock with a fast transient, the sound of a
// knuckle, a mucked card and a pressed stack landing on a padded rail.
// Quiet by design. Respects the mute toggle.

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
  if (m && ctx && bus) {
    // a hard mute must not leave a tail ringing
    bus.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
  } else if (!m && ctx && bus) {
    bus.gain.setTargetAtTime(0.9, ctx.currentTime, 0.05);
  }
}

/**
 * Browsers start an AudioContext suspended until a real gesture. Calling this
 * from the first pointer/key event primes the graph so the opening deal has
 * its foley instead of being swallowed by the autoplay policy.
 */
export function primeAudio() {
  const a = ac();
  if (!a || !bus) return;
  // a zero-length buffer through the bus is enough to wake the hardware
  const src = a.createBufferSource();
  src.buffer = a.createBuffer(1, 1, a.sampleRate);
  src.connect(bus);
  src.start(0);
}

function ac(): AudioContext | null {
  if (muted) return null;
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
      return null;
    }
    // master bus: tame peaks, keep it close and dry
    bus = ctx.createGain();
    bus.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    bus.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ------------------------------------------------------------- primitives ---

/** Filtered noise burst — the atom every texture is built from. */
function burst(
  t0: number,
  dur: number,
  freq: number,
  gain: number,
  opts: { type?: BiquadFilterType; q?: number; sweepTo?: number; pan?: number; attack?: number } = {},
) {
  const a = ac();
  if (!a || !bus) return;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = opts.type ?? "bandpass";
  filter.frequency.setValueAtTime(freq, t0);
  if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.sweepTo), t0 + dur);
  filter.Q.value = opts.q ?? 1.1;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + (opts.attack ?? 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const p = a.createStereoPanner();
  p.pan.value = opts.pan ?? 0;
  src.connect(filter).connect(g).connect(p).connect(bus);
  src.start(t0);
}

/** A pitched body with a fast pitch drop — drums, knocks, wood, clay. */
function body(
  t0: number,
  freq: number,
  dur: number,
  gain: number,
  opts: { type?: OscillatorType; drop?: number; pan?: number; attack?: number } = {},
) {
  const a = ac();
  if (!a || !bus) return;
  const osc = a.createOscillator();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.drop) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.drop), t0 + dur * 0.6);
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + (opts.attack ?? 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const p = a.createStereoPanner();
  p.pan.value = opts.pan ?? 0;
  osc.connect(g).connect(p).connect(bus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/**
 * THOCK — the house voice. Three layers, in order:
 *   1. a bright contact tick (the edge of the thing touching down)
 *   2. a damped case resonance around 420–620 Hz (the padded rail)
 *   3. a low fundamental that drops a fifth in 70 ms (the mass behind it)
 * Every betting verb is a variation on it, so the whole table knocks in the
 * same key: check ~168 Hz, fold ~144 Hz, raise ~118 Hz with the stack on top.
 */
function thock(
  t0: number,
  opts: {
    freq?: number;
    gain?: number;
    pan?: number;
    /** resonance centre of the rail / card / stack */
    caseFreq?: number;
    /** length of the low body */
    dur?: number;
    /** how much top-end contact tick */
    tick?: number;
  } = {},
) {
  const freq = opts.freq ?? 168;
  const gain = opts.gain ?? 0.085;
  const pan = opts.pan ?? 0;
  const dur = opts.dur ?? 0.085;
  const tick = opts.tick ?? 1;

  // 1. contact — a 6 ms edge
  burst(t0, 0.012, rnd(2900, 3600), 0.32 * gain * tick, { q: 2.4, pan: pan * 0.6, attack: 0.0015 });
  // 2. case — narrow band, very short, this is what makes it read as "thock"
  burst(t0 + 0.001, 0.055, opts.caseFreq ?? rnd(430, 610), 0.5 * gain, {
    q: 5.5,
    pan,
    attack: 0.002,
  });
  // 3. mass — two detuned bodies, the second an octave up and quieter
  body(t0, freq, dur, gain, { drop: 0.62, pan, attack: 0.002 });
  body(t0 + 0.0015, freq * 1.94, dur * 0.62, gain * 0.38, {
    type: "triangle",
    drop: 0.78,
    pan: pan + 0.02,
    attack: 0.002,
  });
  // 4. settle — a tiny felt scuff as it comes to rest
  burst(t0 + 0.035, 0.03, 1200, 0.14 * gain, { type: "lowpass", q: 0.8, pan });
}

// --------------------------------------------------------------- events -----

/** Card sliding off the deck — a papery flick. */
export function playDeal() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  burst(t + 0.005, 0.05, rnd(2400, 3100), 0.05, { q: 0.9, sweepTo: 1400, pan: rnd(-0.2, 0.2) });
  burst(t + 0.028, 0.035, rnd(3600, 4200), 0.028, { q: 1.4 });
}

/**
 * ONE card flicked to one seat — the deal becomes a stereo sweep of papery
 * flicks travelling round the table, left seats left, right seats right.
 */
export function playCardFlick(pan = 0, gain = 1) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const p = Math.max(-0.8, Math.min(0.8, pan));
  burst(t + 0.004, 0.045, rnd(2300, 3000), 0.045 * gain, { q: 0.9, sweepTo: 1500, pan: p });
  burst(t + 0.024, 0.028, rnd(3400, 4100), 0.024 * gain, { q: 1.5, pan: p });
}

/** A community card turning over — snap of the face, soft landing. */
export function playFlip() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  burst(t, 0.05, rnd(1800, 2300), 0.05, { q: 0.8, sweepTo: 3600 });
  burst(t + 0.055, 0.03, rnd(900, 1150), 0.045, { type: "lowpass", q: 0.7 });
  body(t + 0.058, 190, 0.05, 0.03, { drop: 0.65 });
}

/** A riffle shuffle: split, accelerating cascade, square up, table tap. */
export function playShuffle() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  // halving the deck
  burst(t + 0.02, 0.07, 2000, 0.038, { q: 0.8, sweepTo: 1200 });
  burst(t + 0.1, 0.055, 2500, 0.032, { q: 0.9, sweepTo: 1600 });
  // the riffle — flicks accelerate then land
  for (let i = 0; i < 11; i++) {
    const p = i / 11;
    burst(t + 0.26 + p * p * 0.46, 0.028, rnd(2500, 3700) - i * 55, 0.03 + (1 - p) * 0.012, {
      q: 1.6,
      pan: (i % 2 === 0 ? -1 : 1) * (0.12 + p * 0.2),
    });
  }
  // squaring up: two soft pack taps with a little body under them
  burst(t + 0.84, 0.05, 1300, 0.05, { type: "lowpass", q: 0.7 });
  thock(t + 0.85, { freq: 122, gain: 0.05, caseFreq: 340, dur: 0.09, tick: 0.5 });
  burst(t + 0.93, 0.04, 900, 0.05, { type: "lowpass", q: 0.7 });
  thock(t + 0.94, { freq: 108, gain: 0.045, caseFreq: 300, dur: 0.1, tick: 0.35 });
}

/** ONE clay chip landing — bright click, hollow body, tiny rattle. */
export function playChip() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const pan = rnd(-0.25, 0.25);
  // attack click (the rims touching)
  burst(t, 0.018, rnd(3300, 3900), 0.055, { q: 2, pan });
  // the clay body — short hollow tok with a mold resonance
  body(t + 0.002, rnd(880, 1050), 0.045, 0.05, { type: "triangle", drop: 0.72, pan });
  body(t + 0.002, rnd(420, 520), 0.06, 0.03, { drop: 0.8, pan });
  burst(t + 0.004, 0.04, rnd(1450, 1750), 0.02, { q: 7, pan, attack: 0.002 });
  // micro rattle as the chip settles
  burst(t + rnd(0.02, 0.03), 0.014, rnd(2800, 3400), 0.02, { q: 2.2, pan });
}

/** A bet: n chips hitting the felt / the stack — a cascading rattle. */
export function playChipCascade(n = 3) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const count = Math.max(2, Math.min(6, n));
  for (let i = 0; i < count; i++) {
    const dt = i === 0 ? 0 : 0.022 + i * rnd(0.02, 0.045);
    const decay = 1 - i / (count + 1);
    const pan = rnd(-0.3, 0.3);
    burst(t + dt, 0.016, rnd(3100, 3900), 0.05 * decay + 0.012, { q: 2, pan });
    body(t + dt + 0.002, rnd(820, 1080), 0.042, 0.045 * decay + 0.008, { type: "triangle", drop: 0.72, pan });
  }
}

/** Chips dragged across the felt — the pot is collected. */
export function playSweep() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  burst(t, 0.16, 1100, 0.03, { q: 0.6, sweepTo: 2400, pan: -0.15 });
  for (let i = 0; i < 4; i++) {
    const dt = 0.03 + i * 0.05 + rnd(0, 0.012);
    const pan = -0.2 + i * 0.12;
    burst(t + dt, 0.015, rnd(3000, 3600), 0.032, { q: 2, pan });
    body(t + dt + 0.002, rnd(800, 1000), 0.04, 0.026, { type: "triangle", drop: 0.75, pan });
  }
}

/**
 * CHECK — two knuckle knocks on the padded rail, 86 ms apart. The first is
 * crisper, the second lands a touch lower and softer, the way a real double
 * tap does. This is the reference thock the other verbs are tuned around.
 */
export function playCheck() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  thock(t, { freq: 172, gain: 0.1, caseFreq: 585, dur: 0.08, pan: -0.07, tick: 1 });
  thock(t + 0.086, { freq: 156, gain: 0.085, caseFreq: 505, dur: 0.1, pan: 0.08, tick: 0.72 });
  // rail resonance between the knocks — a whisper of the case
  burst(t + 0.045, 0.05, 320, 0.012, { type: "lowpass", q: 1.2, pan: 0 });
}

/**
 * FOLD — the hand is pushed face-down across the felt and released: a short
 * paper slide that dies into the muck, then one soft, dead thock.
 */
export function playFold() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const pan = rnd(0.14, 0.34);
  // the push: paper over felt, fading as the cards slow down
  burst(t + 0.012, 0.15, 1750, 0.04, { q: 0.55, sweepTo: 460, pan });
  burst(t + 0.09, 0.06, 2200, 0.022, { q: 1.1, sweepTo: 900, pan: pan + 0.04 });
  // the muck: dead, damped, no ring
  thock(t + 0.135, { freq: 141, gain: 0.075, caseFreq: 372, dur: 0.07, pan, tick: 0.5 });
  body(t + 0.145, 92, 0.1, 0.028, { drop: 0.7, pan });
}

/**
 * RAISE — the stack is counted, pressed, and set down in front of you: four
 * clay chips shuffled into a column, then a deep thock as the stack lands.
 * The bigger the raise, the longer the cascade and the heavier the landing.
 */
export function playRaise(strength = 0.5) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const heft = Math.max(0, Math.min(1, strength));
  const chips = 2 + Math.round(heft * 3);
  const pan = rnd(-0.16, 0.16);

  // 1. the count — chips tapped against each other, quick and even
  for (let i = 0; i < chips; i++) {
    const dt = i * (0.028 + rnd(0, 0.012));
    burst(t + dt, 0.014, rnd(3100, 3800), 0.042, { q: 2.2, pan, attack: 0.0015 });
    body(t + dt + 0.001, rnd(900, 1040), 0.036, 0.034, { type: "triangle", drop: 0.74, pan });
    burst(t + dt + 0.003, 0.03, rnd(1500, 1700), 0.016, { q: 7, pan, attack: 0.002 });
  }

  // 2. the press — a low, short thump as the hand settles the stack
  const land = t + chips * 0.033 + 0.035;
  body(land - 0.012, 150, 0.05, 0.03, { drop: 0.9, pan });
  // 3. the set-down — the deepest thock on the table, weighted by the raise
  thock(land, {
    freq: 112 - heft * 10,
    gain: 0.085 + heft * 0.035,
    caseFreq: 392,
    dur: 0.11,
    pan,
    tick: 1,
  });
  body(land + 0.004, 76, 0.16, 0.03 + heft * 0.02, { drop: 0.82, pan });
  // 4. the felt absorbing it — a soft tail
  burst(land + 0.02, 0.09, 640, 0.014, { type: "lowpass", q: 0.9, pan });
}

/** Buttons and confirmations — a firm tactile tap. */
export function playTap() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  thock(t, { freq: 196, gain: 0.07, caseFreq: 720, dur: 0.055, tick: 1.2 });
}

/** Shot clock running out — quiet ticks, only under five seconds. */
export function playTick(urgent = false) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  body(t, urgent ? 1150 : 950, 0.03, urgent ? 0.032 : 0.02, { type: "square", drop: 0.9 });
  if (urgent) burst(t, 0.01, 2400, 0.02, { q: 2 });
}

/** It's your decision — a soft, low cue, more breath than melody. */
export function playYourTurn() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  body(t, 392, 0.12, 0.028, { type: "sine" });
  body(t + 0.09, 523.25, 0.16, 0.024, { type: "sine" });
  thock(t + 0.005, { freq: 148, gain: 0.035, caseFreq: 460, dur: 0.07, tick: 0.4 });
}

/** Settlement stamp — the thud of the grade landing. */
export function playStamp() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  burst(t, 0.06, 640, 0.08, { type: "lowpass", q: 0.7 });
  body(t + 0.005, 120, 0.13, 0.06, { drop: 0.55 });
  burst(t + 0.01, 0.03, 1800, 0.02, { q: 1.2 });
}

/** You took the pot — a pile of chips pushed across the felt to you. */
export function playWin() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  // the push: a sliding haul
  burst(t + 0.02, 0.2, 1000, 0.026, { q: 0.6, sweepTo: 2600, pan: 0.1 });
  // chips arriving in a loose stack
  const landings = [0.1, 0.17, 0.23, 0.31, 0.42, 0.56];
  landings.forEach((dt, i) => {
    const decay = 1 - i / (landings.length + 2);
    const pan = -0.15 + i * 0.06;
    burst(t + dt, 0.016, rnd(3100, 3800), 0.05 * decay + 0.01, { q: 2, pan });
    body(t + dt + 0.002, rnd(840, 1060), 0.045, 0.045 * decay + 0.008, { type: "triangle", drop: 0.72, pan });
  });
  // the stack settles on the rail, then one warm note under it — barely there
  thock(t + 0.62, { freq: 128, gain: 0.05, caseFreq: 420, dur: 0.1, pan: 0.12, tick: 0.6 });
  body(t + 0.16, 261.63, 0.3, 0.016, { type: "sine" });
}
