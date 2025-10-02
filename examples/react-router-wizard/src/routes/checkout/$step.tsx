import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router';
import { createWizardRouteComponent } from '@wizard/react';
import { checkoutWizard } from '../../wizard';

export const Route = createFileRoute('/checkout/$step')({
  component: () => {
    const WizardComponent = createWizardRouteComponent(
      {
        wizard: checkoutWizard,
        basePath: '/checkout',
        stepParam: 'step',
      },
      useNavigate,
      useParams
    );
    return <WizardComponent />;
  },
});
