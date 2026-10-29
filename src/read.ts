import { type Address, type Chain, type Client, maxUint64, type Transport } from 'viem'
import { readContract } from 'viem/actions'
import { getAction } from 'viem/utils'
import { oracleAbi, renewerAbi } from './abi.js'
import { type Renewers, renewersFor } from './addresses.js'
import {
  BudgetTooLowError,
  NotRenewableError,
  QuoteMismatchError,
  UnsupportedTokenError,
} from './errors.js'
import { type NextTier, type Pricing, type Tier, solve } from './solve.js'

type AnyClient = Client<Transport, Chain | undefined>

const read = (client: AnyClient) => getAction(client, readContract, 'readContract')

/**
 * Read the rent price oracle a renewer prices with, for one payment token.
 *
 * The oracle address is resolved through the renewer on every call, since a
 * renewer can be pointed at a new oracle.
 */
export async function getPricing(
  client: AnyClient,
  { token, renewer, renewers }: { token: Address; renewer?: Address; renewers?: Renewers },
): Promise<Pricing> {
  const target = renewer ?? renewersFor(client.chain?.id, renewers).ethRegistrar
  const oracle = await read(client)({ address: target, abi: renewerAbi, functionName: 'rentPriceOracle' })

  const [baseRates, discountPoints, discountDenominator, [numer, denom]] = await Promise.all([
    read(client)({ address: oracle, abi: oracleAbi, functionName: 'getBaseRates' }),
    read(client)({ address: oracle, abi: oracleAbi, functionName: 'getDiscountPoints' }),
    read(client)({ address: oracle, abi: oracleAbi, functionName: 'DISCOUNT_DENOMINATOR' }),
    read(client)({ address: oracle, abi: oracleAbi, functionName: 'getPaymentTokenRatio', args: [token] }),
  ])
  if (numer === 0n || denom === 0n) throw new UnsupportedTokenError(token)

  return {
    oracle,
    token,
    baseRates,
    discountPoints: discountPoints.map((p) => ({ duration: p.duration, numer: p.numer })),
    discountDenominator,
    tokenRatio: { numer, denom },
  }
}

/**
 * The renewer that will renew `label` right now, or `null` if neither will.
 * The two renewers' `isRenewable` predicates are disjoint.
 */
export async function getRenewer(
  client: AnyClient,
  { label, renewers }: { label: string; renewers?: Renewers },
): Promise<Address | null> {
  const { ethRegistrar, ethRenewerV1 } = renewersFor(client.chain?.id, renewers)
  const [v2, v1] = await Promise.all(
    [ethRegistrar, ethRenewerV1].map((address) =>
      read(client)({ address, abi: renewerAbi, functionName: 'isRenewable', args: [label] }),
    ),
  )
  return v2 ? ethRegistrar : v1 ? ethRenewerV1 : null
}

export type Quote = {
  /** The label exactly as it will be sent to the renewer. */
  label: string
  /** `ETHRegistrar` or `ETHRenewerV1`, whichever renews this label. */
  renewer: Address
  token: Address
  oracle: Address
  budget: bigint
  /** Renewal length, in seconds. */
  duration: bigint
  /** Exact cost, as confirmed by ENS's `getRenewPrice`. Always `<= budget`. */
  amount: bigint
  tier: Tier | null
  nextTier: NextTier | null
}

export type QuoteRenewalParameters = {
  /** Bare label, e.g. `"nick"` for nick.eth. Used exactly as given, not normalized. */
  label: string
  /** Spending limit in token units, e.g. `25_000000n` for $25 of USDC. */
  budget: bigint
  /** ERC-20 the oracle accepts, e.g. `addresses[1].usdc`. */
  token: Address
  /** Override the built-in renewer addresses (forks, unsupported chains). */
  renewers?: Renewers
}

/**
 * Longest renewal `budget` buys for `label`, confirmed against ENS.
 *
 * Picks the renewer, solves locally, then checks that ENS charges exactly
 * `amount` for `duration` and more than `budget` for one second longer.
 */
export async function quoteRenewal(
  client: AnyClient,
  { label, budget, token, renewers }: QuoteRenewalParameters,
): Promise<Quote> {
  const renewer = await getRenewer(client, { label, renewers })
  if (!renewer) throw new NotRenewableError(label)

  const [pricing, minDuration] = await Promise.all([
    getPricing(client, { token, renewer }),
    read(client)({ address: renewer, abi: renewerAbi, functionName: 'MIN_RENEW_DURATION' }),
  ])

  const { duration, amount, tier, nextTier } = solve(pricing, { label, budget })
  if (duration < minDuration) throw new BudgetTooLowError(budget, duration, minDuration)

  const price = (d: bigint) =>
    read(client)({ address: renewer, abi: renewerAbi, functionName: 'getRenewPrice', args: [label, d, token] })
  /* One second longer must cost more than the budget, unless uint64 has no longer. */
  const [actual, longer] = await Promise.all([
    price(duration),
    duration < maxUint64 ? price(duration + 1n) : budget + 1n,
  ])
  if (actual !== amount) throw new QuoteMismatchError(amount, actual)
  if (longer <= budget) throw new QuoteMismatchError(budget + 1n, longer)

  return { label, renewer, token, oracle: pricing.oracle, budget, duration, amount, tier, nextTier }
}
