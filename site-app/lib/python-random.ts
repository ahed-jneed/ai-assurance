// Python's random.Random(seed) for an integer seed, and its randrange(n), so
// that the hosted runner draws the same cluster-bootstrap replicates as the
// engine (docs/design/audit-statistics.md section 5.11: one
// random.Random(seed) stream, rng.randrange(C) per draw).
//
// CPython seeds an integer through MT19937's init_by_array over the 32-bit
// words of |seed| (least significant first), and randrange(n) draws
// getrandbits(k) with k = n.bit_length() until the value is below n.
const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER = 0x80000000;
const LOWER = 0x7fffffff;

export class PythonRandom {
  private readonly mt = new Uint32Array(N);
  private index = N;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed))
      throw new RangeError("the seed must be a safe integer");
    let rest = Math.abs(seed);
    const key: number[] = [];
    do {
      key.push(rest % 0x100000000);
      rest = Math.floor(rest / 0x100000000);
    } while (rest > 0);
    this.initByArray(key);
  }

  private initGenrand(s: number) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.index = N;
  }

  private initByArray(key: number[]) {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1,
      j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  private twist() {
    const mt = this.mt;
    for (let kk = 0; kk < N; kk++) {
      const y = (mt[kk] & UPPER) | (mt[(kk + 1) % N] & LOWER);
      mt[kk] = mt[(kk + M) % N] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
    }
    this.index = 0;
  }

  /** genrand_uint32: the next tempered 32-bit output. */
  uint32() {
    if (this.index >= N) this.twist();
    let y = this.mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** getrandbits(k) for 1 <= k <= 32. */
  getrandbits(k: number) {
    return this.uint32() >>> (32 - k);
  }

  /** randrange(n) for 1 <= n < 2^31: Python's _randbelow_with_getrandbits. */
  randrange(n: number) {
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }
}
