import {
  type Account,
  type Address,
  type Chain,
  type Client,
  encodeFunctionData,
  type Hash,
  type Hex,
  type Transport,
  zeroHash,
} from 'viem'
import { readContract, sendTransaction, waitForTransactionReceipt } from 'viem/actions'
import { getAction } from 'viem/utils'
import { erc20Abi, renewerAbi } from './abi.js'
import { type Quote, type QuoteRenewalParameters, quoteRenewal } from './read.js'

/** A plain call, ready for `sendTransaction`, `sendCalls` (EIP-5792) or a relayer. */
export type Call = { to: Address; data: Hex }

/**
 * Calls that carry out `quote`: an `approve` for exactly `quote.amount` when
 * the current allowance is lower, then `renew`.
 *
 * Approving the quoted amount rather than the budget means a price change
 * between quote and send makes the renewal fail instead of spending more.
 */
export async function prepareRenewal(
  client: Client<Transport, Chain | undefined>,
  quote: Quote,
  { account, referrer = zeroHash }: { account: Address; referrer?: Hex },
): Promise<Call[]> {
  const allowance = await getAction(client, readContract, 'readContract')({
    address: quote.token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account, quote.renewer],
  })

  const calls: Call[] = []
  if (allowance < quote.amount) {
    calls.push({
      to: quote.token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [quote.renewer, quote.amount] }),
    })
  }
  calls.push({
    to: quote.renewer,
    data: encodeFunctionData({
      abi: renewerAbi,
      functionName: 'renew',
      args: [{ label: quote.label, duration: quote.duration, referrer }, quote.token],
    }),
  })
  return calls
}

/**
 * Quote, approve if needed, and renew, spending at most `budget`.
 * Waits for the approval to confirm before sending the renewal.
 */
export async function renewWithBudget(
  client: Client<Transport, Chain | undefined, Account>,
  { referrer, ...params }: QuoteRenewalParameters & { referrer?: Hex },
): Promise<{ hash: Hash; quote: Quote }> {
  const quote = await quoteRenewal(client, params)
  const calls = await prepareRenewal(client, quote, { account: client.account.address, referrer })

  const send = getAction(client, sendTransaction, 'sendTransaction')
  const wait = getAction(client, waitForTransactionReceipt, 'waitForTransactionReceipt')

  let hash: Hash = zeroHash
  for (const call of calls) {
    hash = await send({ ...call, account: client.account, chain: client.chain })
    const receipt = await wait({ hash })
    if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted.`)
  }
  return { hash, quote }
}
