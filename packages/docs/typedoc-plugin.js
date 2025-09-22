/**
 * Custom TypeDoc plugin for Wziard
 * Adds enhanced functionality and custom processing
 */

import { Application, ParameterType, ReflectionKind } from 'typedoc';

/**
 * @param {Application} app
 */
export function load(app) {
  // Add custom tags
  app.options.addDeclaration({
    name: 'wizardExample',
    help: 'Add example usage for wizard functions',
    type: ParameterType.String
  });

  app.options.addDeclaration({
    name: 'wizardCategory',
    help: 'Custom category for wizard-specific grouping',
    type: ParameterType.String
  });

  // Custom converter for better organization
  app.converter.on('resolveBegin', (context) => {
    console.log('Starting TypeDoc generation for Wziard...');

    // Add custom metadata to reflections
    for (const reflection of context.project.getReflectionsByKind(ReflectionKind.All)) {
      if (reflection.comment) {
        // Add custom badges for wizard-specific functionality
        if (reflection.comment.summary?.some(part =>
          part.text?.includes('wizard') ||
          part.text?.includes('step') ||
          part.text?.includes('factory')
        )) {
          if (!reflection.comment.blockTags) {
            reflection.comment.blockTags = [];
          }

          // Add category tags based on content
          if (reflection.name?.includes('wizard') || reflection.name?.includes('Wizard')) {
            reflection.comment.blockTags.push({
              tag: '@category',
              content: [{ kind: 'text', text: 'Core Wizard' }]
            });
          }

          if (reflection.name?.includes('step') || reflection.name?.includes('Step')) {
            reflection.comment.blockTags.push({
              tag: '@category',
              content: [{ kind: 'text', text: 'Step Management' }]
            });
          }

          if (reflection.name?.includes('factory') || reflection.name?.includes('Factory')) {
            reflection.comment.blockTags.push({
              tag: '@category',
              content: [{ kind: 'text', text: 'Factory Pattern' }]
            });
          }

          if (reflection.name?.includes('use') && reflection.name?.includes('Hook')) {
            reflection.comment.blockTags.push({
              tag: '@category',
              content: [{ kind: 'text', text: 'React Hooks' }]
            });
          }
        }
      }
    }
  });

  // Custom theme enhancements
  app.renderer.on('beginRender', (event) => {
    // Add custom navigation links
    const navigation = event.project.navigation;
    if (navigation) {
      // Custom sorting for better organization
      navigation.children?.sort((a, b) => {
        const order = [
          'wizardWithContext',
          'createWizard',
          'defineSteps',
          'step',
          'stepWithValidation',
          'dataStep',
          'transitionStep',
          'conditionalStep'
        ];

        const aIndex = order.indexOf(a.text || '');
        const bIndex = order.indexOf(b.text || '');

        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;

        return (a.text || '').localeCompare(b.text || '');
      });
    }
  });

  // Add custom page content
  app.renderer.on('endPage', (event) => {
    if (event.filename.includes('index.html')) {
      // Add custom welcome content to main page
      const welcomeContent = `
        <div class="tsd-panel tsd-welcome-panel">
          <div class="tsd-panel-group">
            <h2>Welcome to Wziard API Documentation</h2>
            <p>
              This API documentation covers all public interfaces, functions, and types
              available in Wziard. Use the navigation on the left to explore different
              modules and their functionality.
            </p>
            <div class="tsd-quick-links">
              <h3>Quick Start</h3>
              <ul>
                <li><a href="modules/_wizard_core.html#wizardWithContext">wizardWithContext</a> - Factory pattern for type-safe wizards</li>
                <li><a href="modules/_wizard_core.html#step">step</a> - Basic step definition helper</li>
                <li><a href="modules/_wizard_react.html#useWizard">useWizard</a> - React hook for wizard access</li>
                <li><a href="modules/_wizard_react.html#useWizardStep">useWizardStep</a> - Get current step name</li>
              </ul>
            </div>
          </div>
        </div>
      `;

      // Insert after the first tsd-panel
      event.contents = event.contents.replace(
        /<div class="tsd-panel">/,
        welcomeContent + '<div class="tsd-panel">'
      );
    }
  });

  console.log('Wziard TypeDoc plugin loaded successfully');
}