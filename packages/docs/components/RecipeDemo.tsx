import React, { Suspense, lazy } from 'react';

// Import the full component directly for StepBranchingDemo
import { StepBranchingFull } from '../../examples/recipes/src/step-branching/StepBranchingFull';

interface RecipeDemoProps {
  recipe: string;
  variant?: string;
}

export function RecipeDemo({ recipe, variant = 'full' }: RecipeDemoProps) {
  // For now, just handle StepBranchingDemo
  if (recipe === 'StepBranchingDemo') {
    return <StepBranchingFull />;
  }
  
  return <div>Recipe component not found: {recipe}</div>;
}

// Export StepBranchingDemo as the full component
export function StepBranchingDemo({ variant }: { variant?: string }) {
  return <StepBranchingFull />;
}