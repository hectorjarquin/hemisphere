const DIM = 256;

function murmurHash3(key, seed = 0) {
  let h1 = seed >>> 0;
  const remainder = key.length & 3;
  const bytes = key.length - remainder;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  for (let i = 0; i < bytes; i += 4) {
    let k1 = (key.charCodeAt(i) & 0xff)
      | ((key.charCodeAt(i + 1) & 0xff) << 8)
      | ((key.charCodeAt(i + 2) & 0xff) << 16)
      | ((key.charCodeAt(i + 3) & 0xff) << 24);

    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = Math.imul(h1, 5) + 0xe6546b64;
  }

  if (remainder > 0) {
    let k1 = 0;
    for (let j = remainder - 1; j >= 0; j--) {
      k1 = (k1 << 8) | (key.charCodeAt(bytes + j) & 0xff);
    }
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);
    h1 ^= k1;
  }

  h1 ^= key.length;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

function hashVector(str) {
  const hash = murmurHash3(str);
  const idx = hash % DIM;
  const sign = (hash & 1) ? 1 : -1;
  return { idx, sign };
}

export function createEmbedding(text) {
  const vector = new Float32Array(DIM);

  const tokens = text.toLowerCase().split(/[^\w']+/).filter(t => t.length > 0);

  for (const token of tokens) {
    const { idx, sign } = hashVector(token);
    vector[idx] += sign;
  }

  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = tokens[i] + '\x00' + tokens[i + 1];
    const { idx, sign } = hashVector(bigram);
    vector[idx] += sign;
  }

  let sumSq = 0;
  for (let i = 0; i < DIM; i++) {
    sumSq += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) {
      vector[i] /= norm;
    }
  }

  return vector;
}
