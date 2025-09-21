import { useState } from 'react';
import { createWizard, defineSteps } from '@wizard/core';
import { WizardProvider, useWizardActions, useWizardStep, useCurrentStepData, useWizardState } from '@wizard/react';

// Step data validation schemas (Zod-like validation)
const validateAccount = ({ data }: { data: unknown }) => {
  const account = data as any;
  if (!account?.email || !account.email.includes('@')) {
    throw new Error('Please enter a valid email');
  }
  if (!account?.password || account.password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  if (account.password !== account.confirmPassword) {
    throw new Error('Passwords do not match');
  }
};

const validatePersonal = ({ data }: { data: unknown }) => {
  const personal = data as any;
  if (!personal?.firstName || !personal?.lastName) {
    throw new Error('Please enter your full name');
  }
  if (!personal?.dateOfBirth) {
    throw new Error('Please enter your date of birth');
  }
};

const validateAddress = ({ data }: { data: unknown }) => {
  const address = data as any;
  if (!address?.street || !address?.city || !address?.state || !address?.zipCode || !address?.country) {
    throw new Error('Please fill in all address fields');
  }
};

// Define steps with inference-first pattern
const steps = defineSteps({
  account: {
    validate: validateAccount,
    data: { email: '', password: '', confirmPassword: '' },
    next: ['personal'],
    meta: { label: 'Account', iconKey: 'user' },
  },
  personal: {
    validate: validatePersonal,
    data: { firstName: '', lastName: '', dateOfBirth: '' },
    next: ['address'],
    meta: { label: 'Personal', iconKey: 'person' },
  },
  address: {
    validate: validateAddress,
    data: { street: '', city: '', state: '', zipCode: '', country: '' },
    next: [],
    meta: { label: 'Address', iconKey: 'location' },
  },
});

// Create wizard with inference
const wizard = createWizard({
  context: { totalSteps: 3, completedSteps: [] as string[] },
  steps,
});

// Step Components
function AccountStep() {
  const currentData = useCurrentStepData() as { email: string; password: string; confirmPassword: string } | undefined;
  const { next, setStepData } = useWizardActions();

  const [data, setData] = useState(() =>
    currentData || { email: '', password: '', confirmPassword: '' }
  );
  const [error, setError] = useState<string>('');

  const handleNext = async () => {
    try {
      setStepData('account', data);
      await next();
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Create Account</h2>

      <div>
        <label className="block text-sm font-medium mb-2">Email</label>
        <input
          type="email"
          value={data.email}
          onChange={(e) => setData({ ...data, email: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Password</label>
        <input
          type="password"
          value={data.password}
          onChange={(e) => setData({ ...data, password: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Min 8 characters"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Confirm Password</label>
        <input
          type="password"
          value={data.confirmPassword}
          onChange={(e) => setData({ ...data, confirmPassword: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Re-enter password"
        />
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleNext}
        className="w-full py-2 px-4 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Next
      </button>
    </div>
  );
}

function PersonalStep() {
  const currentData = useCurrentStepData() as { firstName: string; lastName: string; dateOfBirth: string } | undefined;
  const { next, back, setStepData } = useWizardActions();

  const [data, setData] = useState(() =>
    currentData || { firstName: '', lastName: '', dateOfBirth: '' }
  );
  const [error, setError] = useState<string>('');

  const handleNext = async () => {
    try {
      setStepData('personal', data);
      await next();
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Personal Information</h2>

      <div>
        <label className="block text-sm font-medium mb-2">First Name</label>
        <input
          type="text"
          value={data.firstName}
          onChange={(e) => setData({ ...data, firstName: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="John"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Last Name</label>
        <input
          type="text"
          value={data.lastName}
          onChange={(e) => setData({ ...data, lastName: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Doe"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Date of Birth</label>
        <input
          type="date"
          value={data.dateOfBirth}
          onChange={(e) => setData({ ...data, dateOfBirth: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={back}
          className="flex-1 py-2 px-4 bg-gray-200 text-gray-800 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
        >
          Previous
        </button>
        <button
          onClick={handleNext}
          className="flex-1 py-2 px-4 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function AddressStep() {
  const currentData = useCurrentStepData() as { street: string; city: string; state: string; zipCode: string; country: string } | undefined;
  const { back, setStepData } = useWizardActions();
  const wizardState = useWizardState();

  const [data, setData] = useState(() =>
    currentData || { street: '', city: '', state: '', zipCode: '', country: '' }
  );
  const [error, setError] = useState<string>('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    try {
      setStepData('address', data);
      setSubmitted(true);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    }
  };

  if (submitted) {
    const accountData = wizardState.data.account as { email: string; password: string; confirmPassword: string } | undefined;
    const personalData = wizardState.data.personal as { firstName: string; lastName: string; dateOfBirth: string } | undefined;

    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-green-600">Registration Complete!</h2>
        <p className="text-gray-600">Thank you for registering. Here's a summary of your information:</p>

        <div className="bg-gray-50 p-4 rounded-md space-y-2">
          <h3 className="font-semibold">Account</h3>
          <p className="text-sm">Email: {accountData?.email}</p>
        </div>

        <div className="bg-gray-50 p-4 rounded-md space-y-2">
          <h3 className="font-semibold">Personal</h3>
          <p className="text-sm">Name: {personalData?.firstName} {personalData?.lastName}</p>
          <p className="text-sm">Date of Birth: {personalData?.dateOfBirth}</p>
        </div>

        <div className="bg-gray-50 p-4 rounded-md space-y-2">
          <h3 className="font-semibold">Address</h3>
          <p className="text-sm">{data.street}</p>
          <p className="text-sm">{data.city}, {data.state} {data.zipCode}</p>
          <p className="text-sm">{data.country}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Address Information</h2>

      <div>
        <label className="block text-sm font-medium mb-2">Street Address</label>
        <input
          type="text"
          value={data.street}
          onChange={(e) => setData({ ...data, street: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="123 Main St"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-2">City</label>
          <input
            type="text"
            value={data.city}
            onChange={(e) => setData({ ...data, city: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="New York"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">State</label>
          <input
            type="text"
            value={data.state}
            onChange={(e) => setData({ ...data, state: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="NY"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-2">ZIP Code</label>
          <input
            type="text"
            value={data.zipCode}
            onChange={(e) => setData({ ...data, zipCode: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="10001"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Country</label>
          <input
            type="text"
            value={data.country}
            onChange={(e) => setData({ ...data, country: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="USA"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={back}
          className="flex-1 py-2 px-4 bg-gray-200 text-gray-800 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
        >
          Previous
        </button>
        <button
          onClick={handleSubmit}
          className="flex-1 py-2 px-4 bg-green-600 text-white font-medium rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

// Step Indicator Component
function StepIndicator() {
  const currentStep = useWizardStep();

  const steps = ['account', 'personal', 'address'];
  const stepLabels = ['Account', 'Personal', 'Address'];

  return (
    <div className="flex justify-between">
      {steps.map((step, index) => (
        <div key={step} className="flex items-center">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              currentStep === step
                ? 'bg-blue-600 text-white'
                : steps.indexOf(currentStep) > index
                ? 'bg-green-600 text-white'
                : 'bg-gray-200 text-gray-600'
            }`}
          >
            {steps.indexOf(currentStep) > index ? '✓' : index + 1}
          </div>
          <span className="ml-2 text-sm font-medium text-gray-600">
            {stepLabels[index]}
          </span>
          {index < steps.length - 1 && (
            <div
              className={`w-16 h-0.5 ml-2 ${
                steps.indexOf(currentStep) > index ? 'bg-green-600' : 'bg-gray-200'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// Dynamic step component renderer
function CurrentStepComponent() {
  const currentStep = useWizardStep();

  switch (currentStep) {
    case 'account':
      return <AccountStep />;
    case 'personal':
      return <PersonalStep />;
    case 'address':
      return <AddressStep />;
    default:
      return null;
  }
}

// Main App Component
function App() {
  return (
    <WizardProvider wizard={wizard}>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-lg shadow-md p-6">
          <StepIndicator />
          <div className="mt-6">
            <CurrentStepComponent />
          </div>
        </div>
      </div>
    </WizardProvider>
  );
}

export default App;