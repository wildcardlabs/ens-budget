/**
 * Read-only checks against live mainnet. Opt in: `npm run test:live`.
 * Set `MAINNET_RPC_URL` to use your own node.
 */
import { createPublicClient, http, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import {
  addresses,
  getPricing,
  getRenewer,
  InvalidLabelError,
  NotRenewableError,
  priceOf,
  quoteRenewal,
  UnsupportedTokenError,
} from '../src/index.js'

const live = process.env.ENS_BUDGET_LIVE === '1'
const client = createPublicClient({
  chain: mainnet,
  transport: http(process.env.MAINNET_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'),
})
const { usdc, dai, ethRegistrar, ethRenewerV1 } = addresses[1]
const YEAR = 31536000n

describe.runIf(live)('mainnet', () => {
  test('finds the renewer for v2 and unmigrated v1 names', async () => {
    expect(await getRenewer(client, { label: 'nick' })).toBe(ethRegistrar)
    expect(await getRenewer(client, { label: 'vitalik' })).toBe(ethRenewerV1)
    expect(await getRenewer(client, { label: 'this-label-is-not-registered-9f3a1c' })).toBeNull()
  })

  test('priceOf matches getRenewPrice across lengths, durations and tokens', async () => {
    const abi = parseAbi(['function getRenewPrice(string,uint64,address) view returns (uint256)'])
    const durations = [1n, 86399n, YEAR, 2n * YEAR - 1n, 2n * YEAR, 3n * YEAR, 6n * YEAR - 1n, 6n * YEAR, 25n * YEAR + 12345n]
    for (const token of [usdc, dai]) {
      const pricing = await getPricing(client, { token })
      for (const label of ['nick', 'vitalik']) {
        const renewer = label === 'nick' ? ethRegistrar : ethRenewerV1
        const onchain = await Promise.all(
          durations.map((d) =>
            client.readContract({ address: renewer, abi, functionName: 'getRenewPrice', args: [label, d, token] }),
          ),
        )
        expect(durations.map((duration) => priceOf(pricing, { label, duration }))).toEqual(onchain)
      }
    }
  })

  test('quotes a budget and confirms it with ENS', async () => {
    // nick is 4 characters ($160/year): $500 clears the 3-year tier, short of 6 years ($540).
    const q = await quoteRenewal(client, { label: 'nick', budget: 500_000000n, token: usdc })
    expect(q.renewer).toBe(ethRegistrar)
    expect(q.amount).toBeLessThanOrEqual(500_000000n)
    expect(q.tier?.discountBps).toBe(3125)
    expect(q.nextTier?.duration).toBe(6n * YEAR)
  })

  test('quotes an unmigrated v1 name through ETHRenewerV1', async () => {
    const q = await quoteRenewal(client, { label: 'vitalik', budget: 27_010000n, token: usdc })
    expect(q.renewer).toBe(ethRenewerV1)
    expect(q.duration).toBeGreaterThanOrEqual(6n * YEAR)
  })

  test('typed errors', async () => {
    await expect(quoteRenewal(client, { label: 'this-label-is-not-registered-9f3a1c', budget: 1n, token: usdc })).rejects.toThrow(NotRenewableError)
    await expect(quoteRenewal(client, { label: 'nick', budget: 1_000000n, token: ethRegistrar })).rejects.toThrow(UnsupportedTokenError)
    const pricing = await getPricing(client, { token: usdc })
    expect(() => priceOf(pricing, { label: 'ab', duration: YEAR })).toThrow(InvalidLabelError)
  })
})
