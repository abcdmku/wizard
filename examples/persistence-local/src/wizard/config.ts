import { defineSteps, step, createWizard } from './factory';

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

export const resumeWizard = createWizard(steps);