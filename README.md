<div align="center">

# ens-budget

**Renew ENS names by budget.**

Give it a label and a stablecoin amount. It returns the longest renewal that amount buys under ENS v2 pricing, checked against ENS's own quote, and can send the renewal for you.

[![npm](https://img.shields.io/npm/v/ens-budget?style=flat-square&color=0080BC)](https://www.npmjs.com/package/ens-budget)
[![CI](https://img.shields.io/github/actions/workflow/status/wildcardlabs/ens-budget/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/wildcardlabs/ens-budget/actions/workflows/ci.yml)
[![size](https://deno.bundlejs.com/badge?q=ens-budget&config=%7B%22esbuild%22%3A%7B%22external%22%3A%5B%22viem%22%5D%7D%7D&badge-style=flat-square)](https://bundlejs.com/?q=ens-budget&config=%7B%22esbuild%22%3A%7B%22external%22%3A%5B%22viem%22%5D%7D%7D)
[![types](https://img.shields.io/npm/types/ens-budget?style=flat-square)](https://www.npmjs.com/package/ens-budget)
[![viem](https://img.shields.io/npm/dependency-version/ens-budget/peer/viem?style=flat-square)](https://viem.sh)
[![license](https://img.shields.io/github/license/wildcardlabs/ens-budget?style=flat-square)](./LICENSE)

[Install](#install) · [Quick start](#quick-start) · [How it works](#how-it-works) · [Recipes](#recipes) · [API](#api) · [Networks](#networks)

</div>

---

## Features

- **Exact.** Prices match ENS's `getRenewPrice` to the smallest token unit, including multi-year discounts.
- **Optimal.** Returns the longest affordable term even where a longer term is cheaper.
- **Complete.** Picks the right renewer, handles the token approval, and sends the renewal.
- **Composable.** Returns plain calls for EIP-5792 batching, smart accounts and relayers.
- **Small.** About 3 kB min+gzip. viem is the only dependency, as a peer.

## Install

```sh
npm install ens-budget viem
```

## Quick start

```ts
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { addresses, quoteRenewal } from 'ens-budget'

const client = createPublicClient({ chain: mainnet, transport: http() })

const quote = await quoteRenewal(client, {
  label: 'namepass',            // namepass.eth
  budget: 25_000000n,           // $25 in USDC (6 decimals)
  token: addresses[1].usdc,
})

quote.duration  // 143345079n seconds, about 4 years 6 months
quote.amount    // 25000000n, the exact cost
quote.tier      // { duration: 94608000n, discountBps: 3125 }      3-year rate, 31.25% off
quote.nextTier  // { duration: 189216000n, extraAmount: 2000071n, … }  6 years for $2.00 more
```

To renew, pass a wallet client:

```ts
import { renewWithBudget } from 'ens-budget'

const { hash, quote } = await renewWithBudget(walletClient, {
  label: 'namepass',
  budget: 25_000000n,
  token: addresses[1].usdc,
})
```

## How it works

ENS v2 prices renewals in USD per second, by label length, and discounts the whole term once it passes 2, 3 or 6 years. Because the discount applies to every second of the term, price is not monotonic in duration:

| `namepass.eth` | Price |
| --- | --- |
| 1 year | $8.00 |
| 5 years | $27.50 |
| 6 years | **$27.00** |

Dividing a budget by an annual rate gets this wrong. `quoteRenewal` instead:

1. Asks both ENS renewers `isRenewable(label)` and uses the one that says yes.
2. Reads the live rates, discount tiers and token exchange rate from the renewer's price oracle.
3. Solves for the longest duration whose exact price fits the budget, trying discount tiers from best to worst.
4. Confirms with `getRenewPrice` that ENS charges exactly the solved amount, and more than the budget for one second longer.

### Approvals

Renewals are paid in an ERC-20 token, so the renewer needs an allowance. `renewWithBudget` checks the current allowance and, only if it is short, approves **exactly** `quote.amount` and waits for confirmation before renewing. It never approves an unlimited amount or the full budget, so a price change between quote and send makes the renewal revert instead of overspending.

## Recipes

<details>
<summary><b>Batch approve and renew into one prompt (EIP-5792)</b></summary>

```ts
import { prepareRenewal, quoteRenewal } from 'ens-budget'

const quote = await quoteRenewal(client, { label, budget, token })
const calls = await prepareRenewal(client, quote, { account: wallet.account.address })
// [approve, renew], or [renew] when the allowance already covers it

await wallet.sendCalls({ calls })
```

The same `{ to, data }` calls work with Safe transactions, bundlers and relayers.

</details>

<details>
<summary><b>Run on a server</b></summary>

```ts
import { createWalletClient, http, nonceManager, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const account = privateKeyToAccount(process.env.PRIVATE_KEY, { nonceManager })
const wallet = createWalletClient({ account, chain: mainnet, transport: http(RPC_URL) }).extend(publicActions)

await renewWithBudget(wallet, { label, budget, token })
```

Exact approvals mean one `approve` transaction per renewal. For frequent renewals, set a standing allowance on the renewer yourself; `prepareRenewal` skips the approval whenever the allowance covers the price.

</details>

<details>
<summary><b>Price locally for live UIs</b></summary>

Read pricing once, then solve without network calls, for example on every slider move:

```ts
import { getPricing, priceOf, solve } from 'ens-budget'

const pricing = await getPricing(client, { token })

solve(pricing, { label: 'namepass', budget: 25_000000n })   // { duration, amount, tier, nextTier }
priceOf(pricing, { label: 'namepass', duration: 31536000n }) // 8000021n
```

</details>

<details>
<summary><b>Normalize user input</b></summary>

Labels are used exactly as given, as in ensjs, so non-normalized legacy names stay renewable. Normalize anything a user types:

```ts
import { normalize } from 'viem/ens'

const label = normalize(input).replace(/\.eth$/, '')
```

Length is counted in Unicode code points of the label you pass, as ENS counts it. `❤️❤️❤️` with variation selectors is 6 code points and priced as a 5+ character name; `❤❤❤` is 3.

</details>

## API

### Network

| Function | Returns |
| --- | --- |
| `quoteRenewal(client, { label, budget, token, renewers? })` | `Quote`: the longest renewal for the budget, confirmed with ENS. |
| `renewWithBudget(walletClient, { label, budget, token, referrer?, renewers? })` | `{ hash, quote }` after approving if needed and renewing. |
| `prepareRenewal(client, quote, { account, referrer? })` | `Call[]`: `[approve?, renew]` as `{ to, data }`. |
| `getPricing(client, { token, renewer?, renewers? })` | `Pricing`: oracle rates, discount tiers and token ratio. |
| `getRenewer(client, { label, renewers? })` | The renewer address for a label, or `null`. |

### Pure

| Function | Returns |
| --- | --- |
| `solve(pricing, { label, budget })` | `{ duration, amount, tier, nextTier }` |
| `priceOf(pricing, { label, duration })` | Exact cost in token units. |

All amounts are `bigint` in the token's smallest unit. All durations are `bigint` seconds.

<details>
<summary><b>Types</b></summary>

```ts
type Quote = {
  label: string
  renewer: Address        // ETHRegistrar or ETHRenewerV1
  token: Address
  oracle: Address
  budget: bigint
  duration: bigint
  amount: bigint          // <= budget
  tier: Tier | null       // null at full price
  nextTier: NextTier | null
}

type Tier = { duration: bigint; discountBps: number }

type NextTier = Tier & {
  amount: bigint          // cost of nextTier.duration
  extraAmount: bigint     // amount - budget
  extraDuration: bigint   // extra time gained by paying amount
}
```

</details>

### Errors

All errors extend `EnsBudgetError`.

| Error | Thrown when |
| --- | --- |
| `InvalidLabelError` | The label is empty, over 255 bytes, or a length ENS does not sell. |
| `NotRenewableError` | Neither renewer will renew the label (unregistered or past grace). |
| `UnsupportedTokenError` | The price oracle does not accept the token. |
| `UnsupportedChainError` | No built-in addresses for the chain and no `renewers` given. |
| `BudgetTooLowError` | The budget buys less than the minimum renewal. |
| `QuoteMismatchError` | The local price disagrees with ENS's quote. The renewal is not sent. |

## Networks

| Network | ETHRegistrar (v2 names) | ETHRenewerV1 (unmigrated v1 names) | Tokens |
| --- | --- | --- | --- |
| Mainnet | `0xD6D8369e55c94Ae8AFA714E6cF7AB5bE54D5CC81` | `0x56c447F308F463A01121C41E72b0E7e7557fCb68` | USDC, DAI |
| Sepolia | `0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3` | `0xf2ece44980778966b8a0FccB3A9E339440f6e045` | USDC, DAI |

Token addresses are exported as `addresses[chainId].usdc` and `.dai`. For forks or other deployments, pass `renewers: { ethRegistrar, ethRenewerV1 }`. The price oracle is always read from the renewer, never hardcoded.

## Development

```sh
npm test            # unit tests, including a brute-force optimality check
npm run test:live   # read-only checks against mainnet (MAINNET_RPC_URL optional)
npm run test:fork   # real renewals on an anvil mainnet fork; requires Foundry
```

## License

[MIT](./LICENSE) © Namepass LLC
