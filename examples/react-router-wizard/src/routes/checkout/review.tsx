import { createFileRoute } from '@tanstack/react-router';
import { ReviewStep } from '../../components/ReviewStep';

export const Route = createFileRoute('/checkout/review')({
  component: ReviewStep,
});
