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
    // Show initial state
    const stepCount = orderWizard.helpers.stepCount();
    showInfo(`Total steps in workflow: ${stepCount}`);
    showDivider();

    // Step 1: Initialize
    let spinner = createSpinner("Initializing order...");
    const orderId = "ORD-" + Date.now();

    await orderWizard.next({
      data: {
        orderId,
        customerId: "CUST-123",
        totalAmount: 99.99,
      },
    });
    spinner.succeed(`Order initialized: ${orderId}`);
    showProgress(1, stepCount, "Workflow Progress");

    // Step 2: Reserve inventory
    spinner = createSpinner("Reserving inventory...");
    await orderWizard.next({
      data: {
        items: [
          { sku: "WIDGET-001", quantity: 2 },
          { sku: "GADGET-002", quantity: 1 },
        ],
      },
    });
    spinner.succeed("Inventory reserved successfully");
    showProgress(2, stepCount, "Workflow Progress");

    // Step 3: Process payment
    spinner = createSpinner("Processing payment...");
    await orderWizard.next({
      data: {
        paymentMethod: "card" as const,
        confirmed: true,
      },
    });
    const context = orderWizard.getContext();
    spinner.succeed(`Payment processed: ${context.paymentId}`);
    showProgress(3, stepCount, "Workflow Progress");

    // Step 4: Send notification
    spinner = createSpinner("Sending order confirmation...");
    await orderWizard.next({
      data: {
        email: "customer@example.com",
      },
    });
    spinner.succeed("Notification sent to customer");
    showProgress(4, stepCount, "Workflow Progress");

    // Step 5: Complete
    spinner = createSpinner("Finalizing order...");
    await orderWizard.next({
      data: {
        confirmed: true,
      },
    });
    spinner.succeed("Order completed successfully!");
    showProgress(5, stepCount, "Workflow Progress");

    showDivider();
    showSuccess("🎉 Saga completed successfully!");

    // Show final summary
    const finalContext = orderWizard.getContext();
    showSummary({
      "Order ID": finalContext.orderId,
      "Customer ID": finalContext.customerId,
      "Payment ID": finalContext.paymentId,
      "Total Amount": `$${finalContext.totalAmount}`,
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