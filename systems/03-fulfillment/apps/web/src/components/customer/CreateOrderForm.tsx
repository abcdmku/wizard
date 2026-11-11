import { Minus, Plus, ShoppingBag, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { type CreateOrder, CreateOrderSchema } from '../../contracts'
import { catalog } from '../../demo-data'
import { money } from '../../format'

export function CreateOrderForm({
  pending,
  error,
  onSubmit,
  onClose,
}: {
  pending: boolean
  error: string | undefined
  onSubmit: (request: CreateOrder) => Promise<void>
  onClose: () => void
}) {
  const [recipient, setRecipient] = useState('Alice Adams')
  const [line1, setLine1] = useState('212 W Lake Street')
  const [city, setCity] = useState('Chicago')
  const [region, setRegion] = useState('IL')
  const [postalCode, setPostalCode] = useState('60606')
  const [sku, setSku] = useState(catalog[0]?.sku ?? '')
  const [quantity, setQuantity] = useState(1)
  const [validation, setValidation] = useState<string | null>(null)
  const product = useMemo(() => catalog.find((entry) => entry.sku === sku), [sku])

  const submit = async () => {
    if (product === undefined) {
      setValidation('Choose a product.')
      return
    }
    const parsed = CreateOrderSchema.safeParse({
      currency: 'USD',
      lines: [{ ...product, quantity }],
      shippingAddress: { recipient, line1, city, region, postalCode, country: 'US' },
    })
    if (!parsed.success) {
      setValidation(parsed.error.issues[0]?.message ?? 'Check the order details.')
      return
    }
    setValidation(null)
    await onSubmit(parsed.data)
  }

  return (
    <section className="create-panel" aria-labelledby="create-order-title">
      <div className="create-panel-header">
        <div>
          <p className="eyebrow">New fulfillment</p>
          <h2 id="create-order-title">Create an order</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close new order form"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="form-section">
          <span className="form-section-number">01</span>
          <div>
            <h3>Choose a product</h3>
            <div className="product-picker">
              <select
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                aria-label="Product"
              >
                {catalog.map((entry) => (
                  <option key={entry.sku} value={entry.sku}>
                    {entry.name}
                  </option>
                ))}
              </select>
              <fieldset className="quantity-control">
                <legend className="sr-only">Quantity</legend>
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                >
                  <Minus size={14} />
                </button>
                <span>{quantity}</span>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => setQuantity((value) => Math.min(8, value + 1))}
                >
                  <Plus size={14} />
                </button>
              </fieldset>
              <strong>{money((product?.unitPriceMinor ?? 0) * quantity, 'USD')}</strong>
            </div>
          </div>
        </div>
        <div className="form-section">
          <span className="form-section-number">02</span>
          <div>
            <h3>Shipping details</h3>
            <div className="field-grid">
              <label className="field field-wide">
                <span>Recipient</span>
                <input
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  autoComplete="name"
                />
              </label>
              <label className="field field-wide">
                <span>Street address</span>
                <input
                  value={line1}
                  onChange={(event) => setLine1(event.target.value)}
                  autoComplete="street-address"
                />
              </label>
              <label className="field">
                <span>City</span>
                <input
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  autoComplete="address-level2"
                />
              </label>
              <label className="field">
                <span>State</span>
                <input
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  autoComplete="address-level1"
                />
              </label>
              <label className="field">
                <span>ZIP code</span>
                <input
                  value={postalCode}
                  onChange={(event) => setPostalCode(event.target.value)}
                  autoComplete="postal-code"
                />
              </label>
            </div>
          </div>
        </div>
        {(validation || error) && (
          <p className="inline-error form-error" role="alert">
            {validation ?? error}
          </p>
        )}
        <div className="form-actions">
          <button className="button button-quiet" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" type="submit" disabled={pending}>
            <ShoppingBag size={16} aria-hidden="true" />{' '}
            {pending ? 'Creating order…' : 'Create order'}
          </button>
        </div>
      </form>
    </section>
  )
}
