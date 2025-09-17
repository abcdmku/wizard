// Shared types for all recipe examples

export interface WizardState {
  currentStep: string;
  stepData: Record<string, any>;
  context: Record<string, any>;
  history: string[];
}

export interface StepConfig {
  label: string;
  description?: string;
  validate?: (data: any) => string | null;
  onEnter?: () => Promise<void>;
  onExit?: () => void;
}

export interface RecipeVariant {
  minimal: React.ComponentType;
  full: React.ComponentType;
  [key: string]: React.ComponentType;
}

export interface RecipeMetadata {
  title: string;
  description: string;
  tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}