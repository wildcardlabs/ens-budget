/**
 * Real renewals on an anvil fork of mainnet. Opt in: `npm run test:fork`.
 * Needs Foundry's `anvil` on PATH. Set `MAINNET_RPC_URL` to use your own node.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import {
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  publicActions,
  toHex,
} from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { addresses, prepareRenewal, quoteRenewal, renewWithBudget } from '../src/index.js'

const fork = process.env.ENS_BUDGET_FORK === '1'
const port = 8545 + Math.floor(Math.random() * 1000)
const rpc = `http://127.0.0.1:${port}`
const { usdc, ethRegistrar, ethRenewerV1 } = addresses[1]

/* Anvil's well-known default account; it only ever exists on the local fork. */
const account = mnemonicToAccount('test test test test test test test test test test test junk')
const wallet = createWalletClient({ account, chain: mainnet, transport: http(rpc) }).extend(publicActions)
const testClient = createTestClient({ mode: 'anvil', chain: mainnet, transport: http(rpc) })

const usdcAbi = parseAbi(['function balanceOf(address) view returns (uint256)'])
const renewedEvent = parseAbi([
  'event NameRenewed(uint256 indexed tokenId, string label, uint64 duration, uint64 newExpiry, address paymentToken, bytes32 indexed referrer, uint256 amount)',
])

let anvil: ChildProcess

async function fundUsdc(amount: bigint) {
  /* FiatToken keeps balances in a mapping at slot 9. */
  const slot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [account.address, 9n]))
  await testClient.setStorageAt({ address: usdc, index: slot, value: toHex(amount, { size: 32 }) })
  await testClient.setBalance({ address: account.address, value: 10n ** 18n })
}

const balance = () => wallet.readContract({ address: usdc, abi: usdcAbi, functionName: 'balanceOf', args: [account.address] })

describe.runIf(fork)('mainnet fork', () => {
  beforeAll(async () => {
    anvil = spawn('anvil', ['--fork-url', process.env.MAINNET_RPC_URL ?? 'https://ethereum-rpc.publicnode.com', '--port', String(port), '--silent'])
    for (let i = 0; i < 100; i++) {
      try {
        await wallet.getBlockNumber()
        return
      } catch {
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    throw new Error('anvil did not start')
  }, 30000)

  afterAll(() => {
    anvil?.kill()
  })

  test('renews a v2 name for the longest term the budget buys', async () => {
    await fundUsdc(1000_000000n)
    const before = await balance()

    const { hash, quote } = await renewWithBudget(wallet, { label: 'nick', budget: 500_000000n, token: usdc })
    expect(quote.renewer).toBe(ethRegistrar)

    const receipt = await wallet.getTransactionReceipt({ hash })
    const [event] = parseEventLogs({ abi: renewedEvent, logs: receipt.logs })
    expect(event?.args.label).toBe('nick')
    expect(event?.args.duration).toBe(quote.duration)
    expect(event?.args.amount).toBe(quote.amount)
    expect(before - (await balance())).toBe(quote.amount)
  }, 60000)

  test('renews an unmigrated v1 name through ETHRenewerV1', async () => {
    await fundUsdc(1000_000000n)
    const { hash, quote } = await renewWithBudget(wallet, { label: 'vitalik', budget: 27_010000n, token: usdc })
    expect(quote.renewer).toBe(ethRenewerV1)
    const receipt = await wallet.getTransactionReceipt({ hash })
    expect(parseEventLogs({ abi: renewedEvent, logs: receipt.logs })[0]?.args.duration).toBe(quote.duration)
  }, 60000)

  test('approves exactly the quoted amount, and skips approval when allowance covers it', async () => {
    await fundUsdc(1000_000000n)
    const quote = await quoteRenewal(wallet, { label: 'nick', budget: 100_000000n, token: usdc })

    const first = await prepareRenewal(wallet, quote, { account: account.address })
    expect(first).toHaveLength(2)
    await wallet.waitForTransactionReceipt({ hash: await wallet.sendTransaction(first[0]!) })

    const second = await prepareRenewal(wallet, quote, { account: account.address })
    expect(second).toHaveLength(1)
    expect(second[0]?.to).toBe(ethRegistrar)
  }, 60000)
})
