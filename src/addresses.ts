import type { Address } from 'viem'
import { UnsupportedChainError } from './errors.js'

export type Renewers = {
  /** v2 `ETHRegistrar`: renews names registered on, or migrated to, v2. */
  ethRegistrar: Address
  /** `ETHRenewerV1`: renews unmigrated legacy (v1) names. */
  ethRenewerV1: Address
}

/**
 * Deployed ENS v2 renewers and the stablecoins ENS prices, per chain.
 *
 * Sourced from `@ensdomains/ensjs` and checked on-chain: both renewers expose
 * `renew((string,uint64,bytes32),address)` and neither is an upgradeable
 * proxy. The rent price oracle is *not* listed here; renewers can point at a
 * new one, so it is read from `rentPriceOracle()` every time.
 */
export const addresses = {
  1: {
    ethRegistrar: '0xD6D8369e55c94Ae8AFA714E6cF7AB5bE54D5CC81',
    ethRenewerV1: '0x56c447F308F463A01121C41E72b0E7e7557fCb68',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    dai: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  },
  11155111: {
    ethRegistrar: '0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3',
    ethRenewerV1: '0xf2ece44980778966b8a0FccB3A9E339440f6e045',
    usdc: '0x240b0316Df57887DBBE58b586508b19e633a14aa',
    dai: '0xF6faC8A58a0BE13b9197f27C41B73162Fe32572b',
  },
} as const satisfies Record<number, Renewers & { usdc: Address; dai: Address }>

export function renewersFor(chainId: number | undefined, override?: Renewers): Renewers {
  if (override) return override
  const known = chainId === undefined ? undefined : addresses[chainId as keyof typeof addresses]
  if (!known) throw new UnsupportedChainError(chainId)
  return known
}
