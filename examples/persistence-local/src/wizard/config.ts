import { defineSteps, step, createWizard } from './factory';
import { useWizard, useWizardStep } from "@wizard/react";

const steps = defineSteps({
  personal: step({
    data: {},
    next: ['experience'],
    meta: { label: 'Personal Information' },
  }),
  experience: step({
    data: {},
    next: ['education'],
    meta: { label: 'Work Experience' },
  }),
  education: step({
    data: {},
    next: ['skills'],
    meta: { label: 'Education' },
  }),
  skills: step({
    data: {},
    next: ['projects'],
    meta: { label: 'Skills' },
  }),
  projects: step({
    data: {},
    next: ['summary'],
    meta: { label: 'Projects' },
  }),
  summary: step({
    data: {},
    next: ['preview'],
    meta: { label: 'Professional Summary' },
  }),
  preview: step({
    data: {},
    next: [],
    meta: { label: 'Preview & Export' },
  }),
});

export const resumeWizard = createWizard(steps) as ReturnType<typeof createWizard<typeof steps>>;

/**
 * Typed convenience hook for using resumeWizard.
 */
export const useResumeWizard = () => useWizard(resumeWizard);

/**
 * Step-specific typed convenience hooks.
 */
export const usePersonalStep = () => useWizardStep(resumeWizard, "personal");
export const useExperienceStep = () => useWizardStep(resumeWizard, "experience");
export const useEducationStep = () => useWizardStep(resumeWizard, "education");
export const useSkillsStep = () => useWizardStep(resumeWizard, "skills");
export const useProjectsStep = () => useWizardStep(resumeWizard, "projects");
export const useSummaryStep = () => useWizardStep(resumeWizard, "summary");
export const usePreviewStep = () => useWizardStep(resumeWizard, "preview");