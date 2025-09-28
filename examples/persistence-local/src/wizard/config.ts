import { defineSteps, step, createWizard } from './factory';
import { storageAdapter } from '../utils/persistence';

const steps = defineSteps({
  personal: step({
    data: {},
    next: ['experience'],
    meta: { label: 'Personal Information', icon: '👤' },
  }),
  experience: step({
    data: {},
    next: ['education'],
    meta: { label: 'Work Experience', icon: '💼' },
  }),
  education: step({
    data: {},
    next: ['skills'],
    meta: { label: 'Education', icon: '🎓' },
  }),
  skills: step({
    data: {},
    next: ['projects'],
    meta: { label: 'Skills', icon: '⚡' },
  }),
  projects: step({
    data: {},
    next: ['summary'],
    meta: { label: 'Projects', icon: '🚀' },
  }),
  summary: step({
    data: {},
    next: ['preview'],
    meta: { label: 'Professional Summary', icon: '📝' },
  }),
  preview: step({
    data: {},
    next: [],
    meta: { label: 'Preview & Export', icon: '👁️' },
  }),
});

export const resumeWizard = createWizard(steps, {
  id: 'resume-builder',
  initial: 'personal',
  
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
});