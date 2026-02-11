import { createFileRoute } from '@tanstack/react-router';
import { Navigate } from '@tanstack/react-router';
import { useTanStackWizardRouter, useWizardSelector } from '@wizard/react';
import { checkoutWizard } from '../../wizard';
import { AccountStep } from '../../components/AccountStep';
import { ShippingStep } from '../../components/ShippingStep';
import { PaymentStep } from '../../components/PaymentStep';
import { ReviewStep } from '../../components/ReviewStep';

const stepComponents = {
  account: AccountStep,
  shipping: ShippingStep,
  payment: PaymentStep,
  review: ReviewStep,
} as const;

type StepName = keyof typeof stepComponents;

function isStepName(value: string): value is StepName {
  return value in stepComponents;
}

export const Route = createFileRoute('/checkout/$step')({
  component: CheckoutStepRoute,
});

function CheckoutStepRoute() {
  const { step: routeStep } = Route.useParams();
  const currentStep = useWizardSelector(checkoutWizard, (state) => state.step);

  useTanStackWizardRouter(checkoutWizard, {
    basePath: '/checkout',
    toStep: (param) => (isStepName(param) ? param : null),
  });

  if (!isStepName(routeStep)) {
    return <Navigate to="/checkout/$step" params={{ step: currentStep }} replace />;
  }

  const StepComponent = stepComponents[currentStep];
  return <StepComponent />;
}
