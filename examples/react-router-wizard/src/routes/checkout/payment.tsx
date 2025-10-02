import { createFileRoute } from '@tanstack/react-router';
import { PaymentStep } from '../../components/PaymentStep';

export const Route = createFileRoute('/checkout/payment')({
  component: PaymentStep,
});
