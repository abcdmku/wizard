import { createFileRoute } from '@tanstack/react-router';
import { ShippingStep } from '../../components/ShippingStep';

export const Route = createFileRoute('/checkout/shipping')({
  component: ShippingStep,
});
