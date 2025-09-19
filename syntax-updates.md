  when defining createWizard we shouldnt pass these values:
  
  isOptional: true,
  isRequired: false,
  isStepComplete: false,
  prerequisites: [],
  weights: {},

  those are step attributes not wizard. instead add these to the step object:

  required: false,
  complete: false,
  prerequisites: [],
  weight: 1,

  update core wizard, make sure react wizard is updated and the docs are updated.