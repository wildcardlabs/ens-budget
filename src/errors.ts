import type { Address } from 'viem'

export class EnsBudgetError extends Error {
  override name = 'EnsBudgetError'
}

/** Empty, over 255 bytes, or a length ENS doesn't sell (e.g. 1–2 characters). */
export class InvalidLabelError extends EnsBudgetError {
  override name = 'InvalidLabelError'
  constructor(
    readonly label: string,
    reason: string,
  ) {
    super(`Invalid label "${label}": ${reason}.`)
  }
}

/** Neither renewer will renew the label right now (unregistered, or past grace). */
export class NotRenewableError extends EnsBudgetError {
  override name = 'NotRenewableError'
  constructor(readonly label: string) {
    super(`"${label}.eth" is not renewable by either ENS renewer.`)
  }
}

/** The rent price oracle has no exchange rate for this token. */
export class UnsupportedTokenError extends EnsBudgetError {
  override name = 'UnsupportedTokenError'
  constructor(readonly token: Address) {
    super(`ENS does not accept ${token} as payment.`)
  }
}

/** No built-in renewer addresses for this chain; pass `renewers`. */
export class UnsupportedChainError extends EnsBudgetError {
  override name = 'UnsupportedChainError'
  constructor(readonly chainId: number | undefined) {
    super(
      `No ENS renewer addresses for chain ${chainId ?? '(none)'}. Pass \`renewers\` explicitly.`,
    )
  }
}

/** The budget buys less than the renewer's minimum duration. */
export class BudgetTooLowError extends EnsBudgetError {
  override name = 'BudgetTooLowError'
  constructor(
    readonly budget: bigint,
    readonly duration: bigint,
    readonly minDuration: bigint,
  ) {
    super(
      `A budget of ${budget} buys ${duration}s, below the ${minDuration}s minimum renewal.`,
    )
  }
}

/** The local solve disagrees with ENS's own `getRenewPrice`. Should never happen. */
export class QuoteMismatchError extends EnsBudgetError {
  override name = 'QuoteMismatchError'
  constructor(
    readonly expected: bigint,
    readonly actual: bigint,
  ) {
    super(
      `Solved renewal costs ${expected} locally but ENS quotes ${actual}. Refusing to renew.`,
    )
  }
}
