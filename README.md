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

// Approve (if needed) and renew, spending at most $25.
const wallet = createWalletClient({ account, chain: mainnet, transport: custom(window.ethereum) })
const { hash } = await renewWithBudget(wallet, { label: 'namepass', budget: 25_000000n, token: usdc })
```

### Batching, smart accounts and relayers

`prepareRenewal` returns plain `{ to, data }` calls instead of sending them:

```ts
const calls = await prepareRenewal(client, quote, { account: '0x…' })
// [approve?, renew]: send with sendCalls (EIP-5792), wagmi, or your relayer
```

The approval is for exactly `quote.amount`, not the budget, and is skipped when the existing allowance already covers it. If the price changes between quote and send, the renewal fails rather than spending more than was shown. This is the same exact-amount approval ensjs documents for `renewName`, which leaves sending it to the caller.

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
