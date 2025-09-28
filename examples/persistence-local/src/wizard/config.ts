import { createWizard } from '@wizard/core';
import type { WizardContext } from './types';
import { storageAdapter } from '../utils/persistence';

export const resumeWizard = createWizard<WizardContext>({
  id: 'resume-builder',
  initial: 'personal',
  context: {
    resumeData: {},
    isDirty: false,
    autoSaveEnabled: true,
    recoveredFromStorage: false,
  },
  
  // Load saved data on initialization
  onInit: async (ctx) => {
    const savedData = await storageAdapter.load();
    if (savedData) {
      return {
        ...ctx,
        resumeData: savedData,
        recoveredFromStorage: true,
      };
    }
    return ctx;
  },
  
  // Auto-save on each step transition
  onTransition: async (ctx) => {
    if (ctx.autoSaveEnabled && ctx.isDirty) {
      await storageAdapter.save(ctx.resumeData);
      return {
        ...ctx,
        isDirty: false,
        lastAutoSave: new Date(),
      };
    }
    return ctx;
  },
  
  nodes: {
    personal: {
      meta: { label: 'Personal Information', icon: '👤' },
      next: 'experience',
    },
    experience: {
      meta: { label: 'Work Experience', icon: '💼' },
      next: 'education',
      prev: 'personal',
    },
    education: {
      meta: { label: 'Education', icon: '🎓' },
      next: 'skills',
      prev: 'experience',
    },
    skills: {
      meta: { label: 'Skills', icon: '⚡' },
      next: 'projects',
      prev: 'education',
    },
    projects: {
      meta: { label: 'Projects', icon: '🚀' },
      next: 'summary',
      prev: 'skills',
    },
    summary: {
      meta: { label: 'Professional Summary', icon: '📝' },
      next: 'preview',
      prev: 'projects',
    },
    preview: {
      meta: { label: 'Preview & Export', icon: '👁️' },
      prev: 'summary',
    },
  },
});