import React from 'react';

// Define types locally to avoid circular dependencies
export interface RecipeMetadata {
  title: string;
  description: string;
  tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

// Import all recipes
import { StepBranchingMinimal, StepBranchingFull, StepBranchingWithValidation } from './step-branching';

// Recipe registry with all variants
export const recipes = {
  'step-branching': {
    metadata: {
      title: 'Dynamic Step Branching',
      description: 'Create wizards with conditional paths based on user input',
      tags: ['conditional', 'dynamic', 'branching'],
      difficulty: 'intermediate',
    } as RecipeMetadata,
    variants: {
      minimal: StepBranchingMinimal,
      full: StepBranchingFull,
      validation: StepBranchingWithValidation,
    },
    code: {
      minimal: `
// Minimal branching logic
function getStepFlow(userType: string | null): string[] {
  if (!userType) return ['userType'];
  return userType === 'individual' 
    ? ['userType', 'individual', 'payment']
    : ['userType', 'business', 'taxInfo', 'payment'];
}`,
      full: `
// Full implementation with wizard
const wizard = createWizard({
  initialStep: 'userType',
  steps: {
    userType: {
      next: ['individual', 'business'],
      onExit: (context, data) => ({
        ...context,
        userType: data.type
      })
    },
    individual: {
      next: ['payment'],
      prev: ['userType'],
      canEnter: (context) => context.userType === 'individual'
    },
    business: {
      next: ['taxInfo', 'payment'],
      prev: ['userType'],
      canEnter: (context) => context.userType === 'business'
    },
    taxInfo: {
      next: ['payment'],
      prev: ['business']
    },
    payment: {
      next: [],
      prev: ['individual', 'business', 'taxInfo']
    }
  }
});`,
    },
  },
  
  // Add other recipes here as they're migrated
  'form-validation': {
    metadata: {
      title: 'Form Validation with Zod',
      description: 'Integrate schema validation for robust form handling',
      tags: ['validation', 'forms', 'zod'],
      difficulty: 'beginner',
    } as RecipeMetadata,
    variants: {
      // Will be added
    },
    code: {},
  },
  
  'auto-save': {
    metadata: {
      title: 'Auto-save & Recovery',
      description: 'Automatically save and restore wizard state',
      tags: ['persistence', 'localStorage', 'recovery'],
      difficulty: 'intermediate',
    } as RecipeMetadata,
    variants: {
      // Will be added
    },
    code: {},
  },
  
  'progress-tracking': {
    metadata: {
      title: 'Progress Tracking',
      description: 'Visual progress indicators for multi-step forms',
      tags: ['progress', 'ui', 'visualization'],
      difficulty: 'beginner',
    } as RecipeMetadata,
    variants: {
      // Will be added
    },
    code: {},
  },
  
  'async-loading': {
    metadata: {
      title: 'Async Data Loading',
      description: 'Load data asynchronously between steps',
      tags: ['async', 'loading', 'api'],
      difficulty: 'intermediate',
    } as RecipeMetadata,
    variants: {
      // Will be added
    },
    code: {},
  },
  
  'router-sync': {
    metadata: {
      title: 'Router Synchronization',
      description: 'Sync wizard state with URL routing',
      tags: ['routing', 'navigation', 'url'],
      difficulty: 'advanced',
    } as RecipeMetadata,
    variants: {
      // Will be added
    },
    code: {},
  },
  
  'conditional-validation': {
    metadata: {
      title: 'Conditional Validation',
      description: 'Context-aware validation rules',
      tags: ['validation', 'conditional', 'dynamic'],
      difficulty: 'intermediate',
    } as RecipeMetadata,
    variants: {
      // Will be added
    },
    code: {},
  },
  
  'step-timeouts': {
    metadata: {
      title: 'Step Timeouts',
      description: 'Add time limits to wizard steps',
      tags: ['timeout', 'timer', 'session'],
      difficulty: 'intermediate',
    } as RecipeMetadata,
    variants: {
      // Will be added
    },
    code: {},
  },
  
  'analytics': {
    metadata: {
      title: 'Analytics Integration',
      description: 'Track wizard interactions and completions',
      tags: ['analytics', 'tracking', 'events'],
      difficulty: 'advanced',
    } as RecipeMetadata,
    variants: {
      // Will be added
    },
    code: {},
  },
};

// Helper component to render any recipe variant
export function RecipeDemo({ 
  recipe, 
  variant = 'full' 
}: { 
  recipe: keyof typeof recipes; 
  variant?: string;
}) {
  const recipeData = recipes[recipe];
  if (!recipeData) {
    return <div>Recipe not found: {recipe}</div>;
  }
  
  const Component = recipeData.variants[variant as keyof typeof recipeData.variants] as React.ComponentType | undefined;
  if (!Component) {
    return <div>Variant not found: {variant}</div>;
  }
  
  return <Component />;
}

// Export individual recipe components for direct use
export function StepBranchingDemo({ variant = 'full' }: { variant?: string }) {
  return <RecipeDemo recipe="step-branching" variant={variant} />;
}