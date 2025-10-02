import { useAccountStep } from '../wizard';

export function AccountStep() {
  const { data, error, next, updateData } = useAccountStep();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await next();
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Account Information</h2>

      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor="email" style={{ display: 'block', marginBottom: '0.5rem' }}>
          Email Address
        </label>
        <input
          id="email"
          type="email"
          value={data?.email || ''}
          onChange={(e) => updateData({ email: e.target.value })}
          placeholder="your@email.com"
          style={{
            width: '100%',
            padding: '0.5rem',
            fontSize: '1rem',
            border: '1px solid #ccc',
            borderRadius: '4px',
          }}
        />
        {error != null ? (
          <div style={{ color: 'red', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            {String(error)}
          </div>
        ) : null}
      </div>

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
        Continue to Shipping
      </button>
    </form>
  );
}
