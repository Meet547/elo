// ---------------------------------------------------------------------------
// Felt — rng.ts : a cryptographic shuffle source, built to be audited.
//
// Two primitives, both self-contained and dependency-free:
//
//   • ChaCha20 (RFC 8439) as the keystream. We take 32 bytes from the
//     platform CSPRNG as a seed, and expand them into an effectively
//     unbounded stream of 32-bit words. The stream is deterministic from the
//     seed, so a published seed reproduces the exact same deck.
//
//   • SHA-256 for the commitment. Before the first card is dealt, the deck
//     order is hashed together with its seed. The hash goes in the log; the
//     seed is revealed when the hand is over. Re-running the shuffle with the
//     revealed seed must reproduce the commit — that is the whole proof, and
//     it is checkable by anyone with this file and the seed.
//
// Shuffle creation fails closed if the platform CSPRNG is unavailable.
// ---------------------------------------------------------------------------

// --------------------------------------------------------------- ChaCha20 ---

const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);

const rotl = (v: number, c: number) => ((v << c) | (v >>> (32 - c))) >>> 0;

function quarter(s: Uint32Array, a: number, b: number, c: number, d: number) {
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl(s[b] ^ s[c], 7);
}

/** One 64-byte block: 20 rounds over a 4×4 word state, added back to input. */
function chachaBlock(key: Uint32Array, counter: number, nonce: Uint32Array, out: Uint32Array) {
  const st = new Uint32Array(16);
  st[0] = SIGMA[0];
  st[1] = SIGMA[1];
  st[2] = SIGMA[2];
  st[3] = SIGMA[3];
  for (let i = 0; i < 8; i++) st[4 + i] = key[i] >>> 0;
  st[12] = counter >>> 0;
  st[13] = nonce[0] >>> 0;
  st[14] = nonce[1] >>> 0;
  st[15] = nonce[2] >>> 0;

  const w = st.slice();
  for (let i = 0; i < 10; i++) {
    quarter(w, 0, 4, 8, 12);
    quarter(w, 1, 5, 9, 13);
    quarter(w, 2, 6, 10, 14);
    quarter(w, 3, 7, 11, 15);
    quarter(w, 0, 5, 10, 15);
    quarter(w, 1, 6, 11, 12);
    quarter(w, 2, 7, 8, 13);
    quarter(w, 3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i++) out[i] = (w[i] + st[i]) >>> 0;
}

/**
 * A deterministic 32-bit stream keyed by 32 seed bytes. Every deck in the
 * room is generated from one of these; publish the seed and the deck can be
 * reproduced bit for bit.
 */
export class ChaChaStream {
  private key = new Uint32Array(8);
  private nonce = new Uint32Array([0x46656c74, 0x2121, 0x1]); // "Felt" domain tag
  private counter = 0;
  private block = new Uint32Array(16);
  private at = 16;

  constructor(seed: Uint8Array) {
    if (seed.length !== 32) throw new Error("seed must be 32 bytes");
    for (let i = 0; i < 8; i++) {
      this.key[i] =
        (seed[i * 4] | (seed[i * 4 + 1] << 8) | (seed[i * 4 + 2] << 16) | (seed[i * 4 + 3] << 24)) >>> 0;
    }
  }

  nextU32(): number {
    if (this.at >= 16) {
      chachaBlock(this.key, this.counter++, this.nonce, this.block);
      this.at = 0;
    }
    return this.block[this.at++];
  }
}

/**
 * Uniform integer in [0, bound) by rejection sampling: values in the biased
 * tail are thrown away rather than folded, so no remainder is favoured. This
 * is the difference between a shuffle that looks random and one that is.
 */
export function uniformBelow(next: () => number, bound: number): number {
  if (bound <= 0) return 0;
  if (bound === 1) return 0;
  const limit = 0x100000000 - (0x100000000 % bound);
  // P(reject) < 1/2 per draw in the worst case for our bounds, so this exits
  // in one or two passes with overwhelming probability.
  for (let guard = 0; guard < 256; guard++) {
    const v = next();
    if (v < limit) return v % bound;
  }
  return next() % bound;
}

// ----------------------------------------------------------------- SHA-256 ---

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (v: number, c: number) => ((v >>> c) | (v << (32 - c))) >>> 0;

/** SHA-256 over arbitrary bytes. Used only for the deck commitment. */
export function sha256(bytes: Uint8Array): Uint8Array {
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // length as a 64-bit big-endian value (we will never exceed 2^32 bytes)
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) throw new Error("bad hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function sha256Hex(text: string): string {
  return toHex(sha256(utf8(text)));
}

// ------------------------------------------------------------------ seeds ---

/** 32 fresh bytes from the platform CSPRNG, as 64 hex characters. */
export function randomSeedHex(): string {
  const bytes = new Uint8Array(32);
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    throw new Error("Secure randomness is required to shuffle cards.");
  }
  return toHex(bytes);
}

export function streamFromSeedHex(seedHex: string): ChaChaStream {
  return new ChaChaStream(fromHex(seedHex));
}
