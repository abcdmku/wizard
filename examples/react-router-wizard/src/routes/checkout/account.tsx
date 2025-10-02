import { createFileRoute } from '@tanstack/react-router';
import { AccountStep } from '../../components/AccountStep';

export const Route = createFileRoute('/checkout/account')({
  component: AccountStep,
});
