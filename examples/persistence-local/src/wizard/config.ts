import { createWizardFactory } from '@wizard/core';

// Simple form data type
export interface FormData {
  name: string;
  email: string;
  age: string;
  terms: boolean;
}

// Create wizard factory
const { defineSteps, step, createWizard } = createWizardFactory();

// Define wizard steps
const steps = defineSteps({
  name: step({
    data: { name: '', email: '', age: '', terms: false } as FormData,
    next: ['email'],
  }),
  email: step({
    data: { name: '', email: '', age: '', terms: false } as FormData,
    next: ['review'],
  }),
  review: step({
    data: { name: '', email: '', age: '', terms: false } as FormData,
    next: [],
  }),
});

export const simpleWizard = createWizard(steps);

// LocalStorage key
const STORAGE_KEY = 'simple-wizard-data';

// Save to localStorage
export function saveToStorage(data: Partial<FormData>, currentStep: string) {
  const savedData = {
    data,
    currentStep,
    timestamp: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedData));
  console.log('✅ Saved to localStorage:', savedData);
}

// Load from localStorage
export function loadFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      console.log('📦 Loaded from localStorage:', parsed);
      return parsed;
    }
  } catch (error) {
    console.error('Failed to load from localStorage:', error);
  }
  return null;
}

// Clear storage
export function clearStorage() {
  localStorage.removeItem(STORAGE_KEY);
  console.log('🗑️ Cleared localStorage');
}
