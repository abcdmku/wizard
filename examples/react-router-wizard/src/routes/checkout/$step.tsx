import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router';
import { createWizardRoute } from '@wizard/react';
import { checkoutWizard } from '../../wizard';

export const Route = createFileRoute('/checkout/$step')({
  ...createWizardRoute({
    wizard: checkoutWizard,
    useNavigate: useNavigate as any,
    useParams: useParams as any,
    basePath: '/checkout',
    stepParam: 'step',
  }),
});
