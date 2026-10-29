import { describe, expect, test } from 'vitest'
import { InvalidLabelError, type Pricing, priceOf, solve } from '../src/index.js'

const YEAR = 31536000n

/** Mainnet `StandardRentPriceOracle` and USDC ratio, read at block 26298205. */
const mainnet: Pricing = {
  oracle: '0x76F29609A363a8A1a2a6abe2e859C0F8916Af469',
  token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  baseRates: [0n, 0n, 20294267n, 5073567n, 253679n],
  discountPoints: [
    { duration: 2n * YEAR, numer: 87500000000000000000000000000000000000n },
    { duration: 3n * YEAR, numer: 68750000000000000000000000000000000000n },
    { duration: 6n * YEAR, numer: 56250000000000000000000000000000000000n },
  ],
  discountDenominator: 10n ** 38n,
  tokenRatio: { numer: 1n, denom: 1000000n },
}

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s
  }
}
const randBig = (next: () => number, max: bigint) =>
  ((BigInt(next()) << 32n) | BigInt(next())) % (max + 1n)

describe('solve against mainnet pricing', () => {
  test('six years for a 5+ character name lands just above $27', () => {
    const sixYears = priceOf(mainnet, { label: 'nicks', duration: 6n * YEAR })
    expect(sixYears).toBeGreaterThan(27_000000n)
    expect(sixYears).toBeLessThanOrEqual(27_010000n)

    const at = solve(mainnet, { label: 'nicks', budget: 27_010000n })
    expect(at.duration).toBeGreaterThanOrEqual(6n * YEAR)
    expect(at.tier?.discountBps).toBe(4375)
    expect(at.nextTier).toBeNull()
  })

  test('one unit below a threshold misses the tier', () => {
    const sixYears = priceOf(mainnet, { label: 'nicks', duration: 6n * YEAR })
    const below = solve(mainnet, { label: 'nicks', budget: sixYears - 1n })
    expect(below.duration).toBeLessThan(6n * YEAR)
    expect(below.tier?.discountBps).toBe(3125)
  })

  test('the price is not monotonic, and solve takes the longer cheaper term', () => {
    const fiveYears = priceOf(mainnet, { label: 'nicks', duration: 5n * YEAR })
    const sixYears = priceOf(mainnet, { label: 'nicks', duration: 6n * YEAR })
    expect(sixYears).toBeLessThan(fiveYears)
    expect(solve(mainnet, { label: 'nicks', budget: fiveYears }).duration).toBeGreaterThan(6n * YEAR)
  })

  test('$8 is just short of a year at full price', () => {
    const r = solve(mainnet, { label: 'nicks', budget: 8_000000n })
    expect(r.duration).toBeLessThan(YEAR)
    expect(r.duration).toBeGreaterThan(YEAR - 86400n)
    expect(r.tier).toBeNull()
    expect(r.nextTier?.discountBps).toBe(1250)
  })

  test('reports the next tier and what reaching it buys', () => {
    const r = solve(mainnet, { label: 'nicks', budget: 25_000000n })
    expect(r.tier?.discountBps).toBe(3125)
    const next = r.nextTier!
    expect(next.duration).toBe(6n * YEAR)
    expect(next.amount).toBe(priceOf(mainnet, { label: 'nicks', duration: 6n * YEAR }))
    expect(next.extraAmount).toBe(next.amount - 25_000000n)
    expect(next.extraDuration).toBe(solve(mainnet, { label: 'nicks', budget: next.amount }).duration - r.duration)
  })

  test('a zero budget buys nothing', () => {
    expect(solve(mainnet, { label: 'nicks', budget: 0n })).toMatchObject({ duration: 0n, amount: 0n })
  })

  test('rejects a negative budget', () => {
    expect(() => solve(mainnet, { label: 'nicks', budget: -1n })).toThrow(RangeError)
  })

  test('fuzz: buys exactly up to the budget and not one second more', () => {
    const next = rng(1)
    for (let i = 0; i < 3000; i++) {
      const label = ['abc', 'abcd', 'abcde', 'a-much-longer-label'][next() % 4]!
      const budget = randBig(next, 100_000_000000n)
      const r = solve(mainnet, { label, budget })
      expect(r.amount).toBe(priceOf(mainnet, { label, duration: r.duration }))
      expect(r.amount).toBeLessThanOrEqual(budget)
      expect(priceOf(mainnet, { label, duration: r.duration + 1n })).toBeGreaterThan(budget)
    }
  })
})

describe('solve is optimal, by brute force over a small oracle', () => {
  /* Small numbers so every duration can be tried. Ratio 3/7 exercises rounding. */
  const small: Pricing = {
    ...mainnet,
    baseRates: [0n, 0n, 7n, 3n, 2n],
    discountPoints: [
      { duration: 10n, numer: 80n },
      { duration: 20n, numer: 60n },
      { duration: 40n, numer: 45n },
    ],
    discountDenominator: 100n,
    tokenRatio: { numer: 3n, denom: 7n },
  }

  test.each(['abc', 'abcd', 'abcde'])('%s', (label) => {
    const prices = Array.from({ length: 2000 }, (_, d) => priceOf(small, { label, duration: BigInt(d) }))
    for (let budget = 0n; budget <= 300n; budget++) {
      let best = 0n
      prices.forEach((p, d) => {
        if (p <= budget) best = BigInt(d)
      })
      expect(solve(small, { label, budget }).duration, `budget ${budget}`).toBe(best)
    }
  })

  test('works with no discount points and a zero denominator', () => {
    const flat: Pricing = { ...small, discountPoints: [], discountDenominator: 0n }
    const r = solve(flat, { label: 'abcde', budget: 100n })
    expect(r.tier).toBeNull()
    expect(r.nextTier).toBeNull()
    expect(priceOf(flat, { label: 'abcde', duration: r.duration })).toBeLessThanOrEqual(100n)
    expect(priceOf(flat, { label: 'abcde', duration: r.duration + 1n })).toBeGreaterThan(100n)
  })

  test('fuzz: holds across token ratios', () => {
    const next = rng(7)
    for (let i = 0; i < 2000; i++) {
      const numer = BigInt((next() % 1000) + 1)
      const denom = BigInt((next() % 1000) + 1)
      const p: Pricing = { ...mainnet, tokenRatio: { numer, denom } }
      const budget = randBig(next, 10n ** 12n)
      const r = solve(p, { label: 'abcde', budget })
      expect(r.amount).toBeLessThanOrEqual(budget)
      expect(priceOf(p, { label: 'abcde', duration: r.duration + 1n })).toBeGreaterThan(budget)
    }
  })
})

describe('labels are priced exactly as given', () => {
  const rateOf = (label: string) => priceOf(mainnet, { label, duration: YEAR })

  test('counts code points, not UTF-16 units', () => {
    expect(rateOf('😀😀😀')).toBe(rateOf('abc'))
  })

  test('does not normalize: a variation selector is a code point', () => {
    expect(rateOf('❤️❤️❤️')).toBe(rateOf('abcdef'))
    expect(rateOf('❤❤❤')).toBe(rateOf('abc'))
  })

  test('rejects lengths ENS does not sell', () => {
    expect(() => rateOf('ab')).toThrow(InvalidLabelError)
    expect(() => rateOf('㍿')).toThrow(InvalidLabelError)
  })

  test('enforces the 1–255 byte bounds', () => {
    expect(() => rateOf('')).toThrow(InvalidLabelError)
    expect(() => rateOf('a'.repeat(256))).toThrow(InvalidLabelError)
    expect(rateOf('a'.repeat(255))).toBe(rateOf('abcde'))
  })
})
