# ens-budget

Budget-first ENS v2 renewals. Say how much you want to spend; get the longest renewal that buys, confirmed against ENS, then renew.

- Built on [viem](https://viem.sh), the only dependency (a peer).
- ~2.8 kB min+gzip.
- Exact: matches ENS's `getRenewPrice` to the unit, including multi-year discounts.

```sh
npm i ens-budget viem
```

## Why budget-first

ENS v2 prices in USD, paid in stablecoins, with multi-year discounts applied to the whole term. That makes price non-monotonic: on mainnet today, 6 years of a 5+ character name ($27.01) costs less than 5 years ($27.51). Dividing a budget by an annual rate gets this wrong. `ens-budget` walks the discount tiers best-first and returns the longest duration whose exact price fits.

## Usage

```ts
import { createPublicClient, createWalletClient, custom, http } from 'viem'
import { mainnet } from 'viem/chains'
import { addresses, quoteRenewal, renewWithBudget } from 'ens-budget'

const client = createPublicClient({ chain: mainnet, transport: http() })
const { usdc } = addresses[1]

// What does $25 buy for namepass.eth?
const quote = await quoteRenewal(client, { label: 'namepass', budget: 25_000000n, token: usdc })
quote.duration   // 143345079n seconds, about 4 years 6½ months
quote.amount     // 25000000n: the exact USDC cost, never more than the budget
quote.tier       // { duration: 94608000n, discountBps: 3125 }: the 3-year rate, 31.25% off
quote.nextTier   // 6 years at 43.75% off for $2.000071 more (extraAmount: 2000071n)

// Renew, spending at most $25.
const wallet = createWalletClient({ account, chain: mainnet, transport: custom(window.ethereum) })
const { hash } = await renewWithBudget(wallet, { label: 'namepass', budget: 25_000000n, token: usdc })
```

### Approval

Renewals are paid in an ERC-20, so the renewer needs a token approval before it can charge you. `renewWithBudget` handles it:

1. It reads your current allowance for the renewer.
2. If that is less than `quote.amount`, it sends `approve(renewer, quote.amount)` and waits for it to confirm. Your wallet prompts twice: approve, then renew.
3. It sends `renew`. If the allowance already covered the price, this is the only prompt.

The approval is for exactly `quote.amount`: never unlimited, and never the whole budget. If the price changes between quote and send, the renewal fails rather than spending more than you were shown. This matches the exact-amount approval ensjs documents for `renewName`; the difference is that ensjs leaves sending it to you.

### Doing it yourself: batching, smart accounts and relayers

To send the approval and renewal yourself, use `prepareRenewal`. It returns plain `{ to, data }` calls, including the approval only when one is needed:

```ts
import { prepareRenewal } from 'ens-budget'

const calls = await prepareRenewal(client, quote, { account: wallet.account.address })
// [approve, renew] or just [renew]

// One prompt in wallets that support EIP-5792 batching:
await wallet.sendCalls({ calls })

// Or one at a time; the approval must confirm before renew:
for (const call of calls) {
  const hash = await wallet.sendTransaction(call)
  await client.waitForTransactionReceipt({ hash })
}
```

### Local math, no RPC

For sliders and other live UIs, read pricing once and solve locally:

```ts
import { getPricing, priceOf, solve } from 'ens-budget'

const pricing = await getPricing(client, { token: usdc })
solve(pricing, { label: 'namepass', budget: 25_000000n })      // { duration, amount, tier, nextTier }
priceOf(pricing, { label: 'namepass', duration: 31536000n })   // exact cost of one year
```

## Labels are not normalized

Like ensjs, `ens-budget` uses the label exactly as given. That keeps non-normalized names, which exist from ENS v1, renewable. For user input, normalize first:

```ts
import { normalize } from 'viem/ens'
const label = normalize('Nick.eth').split('.')[0]
```

The length that sets the price is counted in Unicode code points of the label you pass, as ENS counts it. `❤️❤️❤️` (with variation selectors) is 6 code points; `❤❤❤` is 3.

## Renewers

ENS v2 has two renewers: `ETHRegistrar` for v2 names and `ETHRenewerV1` for unmigrated v1 names. `ens-budget` asks both `isRenewable(label)` and uses whichever says yes, so callers never pick one. Addresses for mainnet and Sepolia are built in (`addresses`); pass `renewers` to override them on forks or other chains. The rent price oracle is always read from the renewer, never hardcoded.

## API

| Export | |
|---|---|
| `quoteRenewal(client, { label, budget, token, renewers? })` | Longest renewal for a budget, confirmed with `getRenewPrice`. |
| `renewWithBudget(walletClient, { label, budget, token, referrer?, renewers? })` | Quote, approve if needed, renew. Returns `{ hash, quote }`. |
| `prepareRenewal(client, quote, { account, referrer? })` | `[approve?, renew]` as plain calls. |
| `getPricing(client, { token, renewer?, renewers? })` | Oracle rates, discounts and token ratio. |
| `getRenewer(client, { label, renewers? })` | The renewer for a label, or `null`. |
| `solve(pricing, { label, budget })` | Pure solver. |
| `priceOf(pricing, { label, duration })` | Pure forward price. |
| `addresses` | Renewers, USDC and DAI per chain ID. |

Errors: `InvalidLabelError`, `NotRenewableError`, `UnsupportedTokenError`, `UnsupportedChainError`, `BudgetTooLowError`, `QuoteMismatchError`, all extending `EnsBudgetError`.

## Development

```sh
npm test            # solver unit tests, including brute-force optimality
npm run test:live   # read-only checks against mainnet
npm run test:fork   # real renewals on an anvil mainnet fork (needs Foundry)
npm run size
```

## License

MIT
