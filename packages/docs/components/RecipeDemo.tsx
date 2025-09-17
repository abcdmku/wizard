import React, { Suspense, lazy } from 'react';

// Lazy load the recipe components from the examples package
const StepBranchingDemo = lazy(() => import('../../examples/recipes/src/recipe-registry').then(m => ({ default: m.StepBranchingDemo })));

interface RecipeDemoProps {
  recipe: string;
  variant?: string;
}

export function RecipeDemo({ recipe, variant = 'full' }: RecipeDemoProps) {
  // For now, just handle StepBranchingDemo
  if (recipe === 'StepBranchingDemo') {
    return (
      <Suspense fallback={<div>Loading demo...</div>}>
        <StepBranchingDemo variant={variant} />
      </Suspense>
    );
  }
  
  return <div>Recipe component not found: {recipe}</div>;
}

// Export specific demo components for backward compatibility
export { StepBranchingDemo };