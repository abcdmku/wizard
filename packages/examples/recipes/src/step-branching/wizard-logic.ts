// Mock wizard logic for examples
export function createWizard(config: any) {
  return {
    goToStep: (step: string) => console.log('Go to step:', step),
    getCurrentStep: () => 'current',
    getNextSteps: () => [],
    hasStep: (step: string) => true,
    subscribe: (callback: (state: any) => void) => {
      // Mock subscription
      return () => {};
    },
    updateStepData: (step: string, data: any) => console.log('Update step data:', step, data),
    reset: () => console.log('Reset wizard'),
    setState: (state: any) => console.log('Set state:', state),
    validateStep: async () => true,
    config: config || {},
  };
}