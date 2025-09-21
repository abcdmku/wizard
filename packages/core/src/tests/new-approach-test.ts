/**
 * Test completely new approach to callback typing
 */

// Let's try a different approach where we explicitly type the callback parameters
function createTypedStep<Data>(step: {
  data: Data;
  beforeExit?: (args: { data: Data; step: string; ctx: unknown; updateContext: any; setStepData: any; emit: any; to?: string | null }) => void | Promise<void>;
  canExit?: (args: { data: Data; step: string; ctx: unknown; updateContext: any; setStepData: any; emit: any; to?: string | null }) => boolean;
  canEnter?: (args: { data: Data; step: string; ctx: unknown; updateContext: any; setStepData: any; emit: any; from?: string | null }) => boolean;
  complete?: (args: { data: Data; step: string; ctx: unknown; updateContext: any; setStepData: any; emit: any }) => boolean;
  next: readonly string[] | ((args: any) => string | readonly string[]);
}) {
  return step;
}

// Test this approach
const testStep = createTypedStep({
  data: { method: 'card', amount: 100 },
  beforeExit: ({ data }) => {
    // HOVER TEST: data should be properly typed as { method: string; amount: number }
    const method: string = data.method;
    const amount: number = data.amount;
    console.log(`Method: ${method}, Amount: ${amount}`);
  },
  canExit: ({ data }) => {
    // HOVER TEST: data should be properly typed
    const amount: number = data.amount;
    return amount > 0;
  },
  canEnter: ({ data }) => {
    // HOVER TEST: data should be properly typed
    const method: string = data.method;
    return method.length > 0;
  },
  complete: ({ data }) => {
    // HOVER TEST: data should be properly typed
    const method: string = data.method;
    return method === 'card';
  },
  next: ['confirmation']
});

export { testStep };