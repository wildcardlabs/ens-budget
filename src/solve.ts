import { type Address, maxUint64 } from 'viem'
import { InvalidLabelError } from './errors.js'

/** Everything needed to price a renewal, as read from ENS's rent price oracle. */
export type Pricing = {
  oracle: Address
  token: Address
  /** Per-second rates in standard units; index `i` prices labels of `i + 1` code points. */
  baseRates: readonly bigint[]
  /** Ascending by duration, descending by numerator (enforced by the oracle's constructor). */
  discountPoints: readonly { duration: bigint; numer: bigint }[]
  /** `0` when the oracle has no discount points. */
  discountDenominator: bigint
  /** Standard units → token units: `ceil(value * numer / denom)`. */
  tokenRatio: { numer: bigint; denom: bigint }
}

export type Tier = {
  /** Minimum renewal duration, in seconds, at which this discount applies. */
  duration: bigint
  /** Discount in basis points, e.g. `4375` for 43.75% off. */
  discountBps: number
}

export type NextTier = Tier & {
  /** Exact cost of renewing for `duration`, in token units. */
  amount: bigint
  /** How much more than the budget `amount` is. */
  extraAmount: bigint
  /** How much longer the renewal gets if the budget is raised to `amount`. */
  extraDuration: bigint
}

export type Solution = {
  /** Longest renewal the budget buys, in seconds. `0n` if it buys nothing. */
  duration: bigint
  /** Exact cost of `duration`, in token units. Always `<= budget`. */
  amount: bigint
  /** Discount tier `duration` lands in, or `null` at full price. */
  tier: Tier | null
  /** The next better tier, if any. */
  nextTier: NextTier | null
}

const encoder = /* @__PURE__ */ new TextEncoder()

/**
 * Per-second base rate for a label, mirroring `getBasePrice`: byte length must
 * be 1–255, the length is counted in code points the way `StringUtils.strlen`
 * walks UTF-8, and lengths past the table use its last entry.
 *
 * The label is used exactly as given. It is not normalized.
 */
function rateFor(pricing: Pricing, label: string): bigint {
  const bytes = encoder.encode(label)
  if (bytes.length === 0) throw new InvalidLabelError(label, 'empty')
  if (bytes.length > 255) throw new InvalidLabelError(label, 'longer than 255 bytes')

  let length = 0
  for (const b of bytes) if ((b & 0xc0) !== 0x80) length++

  const rates = pricing.baseRates
  const rate = rates[Math.min(length, rates.length) - 1] ?? 0n
  if (rate === 0n) throw new InvalidLabelError(label, `ENS does not sell ${length}-character names`)
  return rate
}

/** `applyDiscount`: the last point whose duration is reached wins. */
function discount(pricing: Pricing, value: bigint, duration: bigint): bigint {
  let numer = 0n
  for (const p of pricing.discountPoints) {
    if (duration < p.duration) break
    numer = p.numer
  }
  return numer === 0n ? value : (value * numer) / pricing.discountDenominator
}

/** `_toAmount`: standard units → token units, rounding up. */
function toAmount(pricing: Pricing, value: bigint): bigint {
  const { numer, denom } = pricing.tokenRatio
  return numer === denom ? value : (value * numer + denom - 1n) / denom
}

function bps(pricing: Pricing, numer: bigint): number {
  const d = pricing.discountDenominator
  return Number(((d - numer) * 10000n) / d)
}

/**
 * Exact renewal price, in token units, that ENS's oracle charges for `label`
 * and `duration`. Matches `getRenewPrice` to the unit.
 */
export function priceOf(pricing: Pricing, { label, duration }: { label: string; duration: bigint }): bigint {
  const rate = rateFor(pricing, label)
  return toAmount(pricing, discount(pricing, rate * duration, duration))
}

/**
 * Longest duration `budget` buys, and the index of the discount point it lands
 * in (`-1` for full price).
 *
 * Price is not monotonic in duration: a discount applies to the whole term, so
 * crossing a threshold can make a longer renewal cheaper. Tiers are therefore
 * tried best first, and the first affordable one is necessarily optimal: the
 * oracle requires durations to rise as numerators fall.
 */
function maxDuration(pricing: Pricing, rate: bigint, budget: bigint): { duration: bigint; index: number } {
  const { numer: tn, denom: td } = pricing.tokenRatio
  /* `ceil(v * tn / td) <= budget` exactly when `v <= floor(budget * td / tn)`. */
  const standard = (budget * td) / tn
  const d = pricing.discountDenominator
  const points = pricing.discountPoints

  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!
    if (budget >= toAmount(pricing, (rate * p.duration * p.numer) / d)) {
      /* Largest s with floor(rate * s * numer / d) <= standard. */
      return { duration: ((standard + 1n) * d - 1n) / (rate * p.numer), index: i }
    }
  }
  return { duration: standard / rate, index: -1 }
}

/**
 * Longest renewal `budget` buys for `label`, without any RPC calls.
 *
 * `budget` is in token units (USDC: 6 decimals, so `25_000000n` is $25).
 * The label is used exactly as given; normalize user input first unless you
 * mean to renew a non-normalized label.
 */
export function solve(pricing: Pricing, { label, budget }: { label: string; budget: bigint }): Solution {
  if (budget < 0n) throw new RangeError('Budget must not be negative.')
  const rate = rateFor(pricing, label)

  const { duration, index } = maxDuration(pricing, rate, budget)
  if (duration > maxUint64) throw new RangeError('Budget buys more than a uint64 duration.')

  const amount = duration === 0n ? 0n : priceOf(pricing, { label, duration })
  const current = index >= 0 ? pricing.discountPoints[index]! : null
  const next = pricing.discountPoints[index + 1]

  let nextTier: NextTier | null = null
  if (next) {
    const nextAmount = priceOf(pricing, { label, duration: next.duration })
    nextTier = {
      duration: next.duration,
      discountBps: bps(pricing, next.numer),
      amount: nextAmount,
      extraAmount: nextAmount - budget,
      extraDuration: maxDuration(pricing, rate, nextAmount).duration - duration,
    }
  }

  return {
    duration,
    amount,
    tier: current ? { duration: current.duration, discountBps: bps(pricing, current.numer) } : null,
    nextTier,
  }
}
