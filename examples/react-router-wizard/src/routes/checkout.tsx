import { createFileRoute, Outlet } from '@tanstack/react-router';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { StepIndicator } from '../components/StepIndicator';

export const Route = createFileRoute('/checkout')({
  component: CheckoutLayout,
});

function CheckoutLayout() {

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4 transition-colors duration-200">
      {/* Theme toggle positioned at top-right of screen */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-xl p-8 transition-colors duration-200">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-8 text-center">
          Checkout Wizard
        </h1>

        <StepIndicator />

        <div className="mt-8">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
