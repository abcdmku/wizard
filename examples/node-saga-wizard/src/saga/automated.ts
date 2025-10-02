import { orderWizard } from "../wizard/orderWizard";
import {
  showTitle,
  showBanner,
  showSuccess,
  showError,
  showInfo,
  showProgress,
  showSummary,
  showDivider,
  createSpinner,
} from "../cli/display";

export async function runAutomatedSaga() {
  showTitle("Order Saga");
  showBanner("Automated Order Processing Workflow", { color: "cyan" });

  try {
    // Reset wizard to start fresh
    orderWizard.reset();

    // Show initial state
    const stepCount = orderWizard.helpers.stepCount();
    const currentStep = orderWizard.getCurrent().step;
    showInfo(`Total steps in workflow: ${stepCount}`);
    showInfo(`Starting at step: ${currentStep}`);
    showDivider();

    const orderId = "ORD-" + Date.now();

    // Step 1: Initialize
    let spinner = createSpinner("Initializing order...");
    orderWizard.setStepData("init", {
      orderId,
      customerId: "CUST-123",
      totalAmount: 99.99,
    });
    await orderWizard.next();
    spinner.succeed(`Order initialized: ${orderId}`);
    showProgress(1, stepCount, "Workflow Progress");

    // Step 2: Reserve inventory
    spinner = createSpinner("Reserving inventory...");
    orderWizard.setStepData("reserve", {
      items: [
        { sku: "WIDGET-001", quantity: 2 },
        { sku: "GADGET-002", quantity: 1 },
      ],
    });
    await orderWizard.next();
    spinner.succeed("Inventory reserved successfully");
    showProgress(2, stepCount, "Workflow Progress");

    // Step 3: Process payment
    spinner = createSpinner("Processing payment...");
    orderWizard.setStepData("charge", {
      paymentMethod: "card" as const,
      confirmed: true,
    });
    await orderWizard.next();
    const context = orderWizard.getContext();
    spinner.succeed(`Payment processed: ${context.paymentId}`);
    showProgress(3, stepCount, "Workflow Progress");

    // Step 4: Send notification
    spinner = createSpinner("Sending order confirmation...");
    orderWizard.setStepData("notify", {
      email: "customer@example.com",
    });
    await orderWizard.next();
    spinner.succeed("Notification sent to customer");
    showProgress(4, stepCount, "Workflow Progress");

    // Step 5: Complete
    spinner = createSpinner("Finalizing order...");
    orderWizard.setStepData("complete", {
      confirmed: true,
    });
    // Complete is the final step, we just need to exit it (no next step)
    const completeStep = orderWizard.getStep("complete");
    if (completeStep?.beforeExit) {
      await completeStep.beforeExit({
        data: { confirmed: true },
        context: orderWizard.getContext(),
        updateContext: orderWizard.updateContext.bind(orderWizard),
      });
    }
    spinner.succeed("Order completed successfully!");
    showProgress(5, stepCount, "Workflow Progress");

    showDivider();
    showSuccess("🎉 Saga completed successfully!");

    // Show final summary - get fresh context after all updates
    const finalContext = orderWizard.getContext();
    showSummary({
      "Order ID": orderId,
      "Customer ID": "CUST-123",
      "Payment ID": finalContext.paymentId || "N/A",
      "Total Amount": "$99.99",
      "Email Sent": finalContext.emailSent ? "Yes" : "No",
    });
  } catch (error) {
    showError(`Saga failed: ${error instanceof Error ? error.message : String(error)}`);

    // Show rollback information
    const context = orderWizard.getContext();
    const progress = orderWizard.helpers.progress();

    showDivider();
    showInfo(`Stopped at: ${progress.label} (${progress.percent}% complete)`);

    // Show what needs to be rolled back
    if (context.inventoryReserved && !context.paymentId) {
      showInfo("→ Rolling back inventory reservation...");
    }
    if (context.paymentId && !context.emailSent) {
      showInfo("→ Refunding payment...");
    }
  }
}