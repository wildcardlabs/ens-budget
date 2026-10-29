/**
 * ABI fragments, inlined so the package carries only what it calls.
 *
 * `ETHRegistrar` (v2 names) and `ETHRenewerV1` (unmigrated v1 names) both
 * implement `IETHRenewer`, so one fragment drives either.
 */

export const renewerAbi = [
  {
    type: 'function',
    name: 'renew',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'rd',
        type: 'tuple',
        components: [
          { name: 'label', type: 'string' },
          { name: 'duration', type: 'uint64' },
          { name: 'referrer', type: 'bytes32' },
        ],
      },
      { name: 'paymentToken', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isRenewable',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getRenewPrice',
    stateMutability: 'view',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'duration', type: 'uint64' },
      { name: 'paymentToken', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'rentPriceOracle',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'MIN_RENEW_DURATION',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
  },
] as const

export const oracleAbi = [
  {
    type: 'function',
    name: 'DISCOUNT_DENOMINATOR',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint128' }],
  },
  {
    type: 'function',
    name: 'getBaseRates',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'getDiscountPoints',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'duration', type: 'uint64' },
          { name: 'numer', type: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getPaymentTokenRatio',
    stateMutability: 'view',
    inputs: [{ name: 'paymentToken', type: 'address' }],
    outputs: [
      { name: 'numer', type: 'uint128' },
      { name: 'denom', type: 'uint128' },
    ],
  },
] as const

export const erc20Abi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const
