import { useShippingStep, useCheckoutWizard } from '../wizard';

export function ShippingStep() {
  const { data, error, next, back, updateData } = useShippingStep();
  const { context } = useCheckoutWizard();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await next();
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Shipping Information</h2>
      <p style={{ color: '#666', marginBottom: '1rem' }}>
        Shipping for: {context.userId}
      </p>

      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor="address" style={{ display: 'block', marginBottom: '0.5rem' }}>
          Street Address
        </label>
        <input
          id="address"
          type="text"
          value={data?.address || ''}
          onChange={(e) => updateData({ address: e.target.value })}
          placeholder="123 Main St"
          style={{
            width: '100%',
            padding: '0.5rem',
            fontSize: '1rem',
            border: '1px solid #ccc',
            borderRadius: '4px',
          }}
        />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor="city" style={{ display: 'block', marginBottom: '0.5rem' }}>
          City
        </label>
        <input
          id="city"
          type="text"
          value={data?.city || ''}
          onChange={(e) => updateData({ city: e.target.value })}
          placeholder="New York"
          style={{
            width: '100%',
            padding: '0.5rem',
            fontSize: '1rem',
            border: '1px solid #ccc',
            borderRadius: '4px',
          }}
        />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor="zipCode" style={{ display: 'block', marginBottom: '0.5rem' }}>
          ZIP Code
        </label>
        <input
          id="zipCode"
          type="text"
          value={data?.zipCode || ''}
          onChange={(e) => updateData({ zipCode: e.target.value })}
          placeholder="10001"
          style={{
            width: '100%',
            padding: '0.5rem',
            fontSize: '1rem',
            border: '1px solid #ccc',
            borderRadius: '4px',
          }}
        />
      </div>

      {error != null ? (
        <div style={{ color: 'red', marginBottom: '1rem', fontSize: '0.9rem' }}>
          {String(error)}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: '1rem' }}>
        <button
          type="button"
          onClick={() => back()}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '1rem',
            background: '#666',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Back
        </button>
        <button
          type="submit"
          style={{
            padding: '0.5rem 1rem',
            fontSize: '1rem',
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Continue to Payment
        </button>
      </div>
    </form>
  );
}
