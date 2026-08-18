/**
 * A stand-in for the payment provider's BROWSER SDK (think Stripe.js / Braintree): the card
 * number goes from the form straight to the provider and comes back as an opaque token. The
 * wizard, the server, the snapshots and every Mirror frame only ever see that token — the PAN
 * never crosses the wire door (`setInput`) at all.
 *
 * Client code. In production replace `tokenizeCard` with the real SDK call.
 */

export interface CardToken {
  readonly token: string
  readonly last4: string
}

/** Tokenise a card number: 16 digits + Luhn, else a rejected promise with a user-facing message. */
export async function tokenizeCard(cardNumber: string): Promise<CardToken> {
  const digits = cardNumber.replace(/\D/g, '')
  if (!/^\d{16}$/.test(digits)) throw new Error('Card number must be 16 digits')
  if (!luhn(digits)) throw new Error('Card number fails the Luhn check')
  await new Promise((resolve) => setTimeout(resolve, 150)) // provider round trip
  return { token: `tok_${Math.random().toString(36).slice(2, 10)}`, last4: digits.slice(-4) }
}

function luhn(digits: string): boolean {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i])
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}
