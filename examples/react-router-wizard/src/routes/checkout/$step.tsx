import { createFileRoute } from '@tanstack/react-router';
import { createWizardRouteComponent } from '@wizard/react';
import { checkoutWizard } from '../../wizard';

export const Route = createFileRoute('/checkout/$step')({
  component: createWizardRouteComponent({
    wizard: checkoutWizard,
    basePath: '/checkout',
    stepParam: 'step',
  }),
});
