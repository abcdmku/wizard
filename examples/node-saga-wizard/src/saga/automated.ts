import { orderWizard } from "../wizard/orderWizard";

export async function runAutomatedSaga() {
  console.log("\n=== Automated Order Saga ===\n");

  try {
    // Show initial state using helpers
    console.log("Available steps:", orderWizard.helpers.availableSteps());
    console.log("Step count:", orderWizard.helpers.stepCount());

    // Initialize
    await orderWizard.next({
      data: {
        orderId: "ORD-" + Date.now(),
        customerId: "CUST-123",
        totalAmount: 99.99,
      },
    });

    // Reserve inventory
    await orderWizard.next({
      data: {
        items: [
          { sku: "WIDGET-001", quantity: 2 },
          { sku: "GADGET-002", quantity: 1 },
        ],
      },
    });

    // Process payment
    await orderWizard.next({
      data: {
        paymentMethod: "card",
        confirmed: true,
      },
    });

    // Send notification
    await orderWizard.next({
      data: {
        email: "customer@example.com",
      },
    });

    // Complete
    await orderWizard.next({
      data: {
        confirmed: true,
      },
    });

    console.log("\n=== Saga Complete ===\n");

    // Show final progress
    const progress = orderWizard.helpers.progress();
    const completedSteps = orderWizard.helpers.completedSteps();
    console.log(`Final progress: ${progress.label} (${progress.percent}%)`);
    console.log("Completed steps:", completedSteps);
  } catch (error) {
    console.error("\n❌ Saga failed:", error);

    // Use helpers to show state
    const current = orderWizard.getCurrent();
    const completedSteps = orderWizard.helpers.completedSteps();
    const remainingSteps = orderWizard.helpers.remainingSteps();
    const context = current.context as any;

    console.log("Completed steps:", completedSteps);
    console.log("Remaining steps:", remainingSteps);

    // In a real saga, we might implement compensations here
    if (context.inventoryReserved && !context.paymentId) {
      console.log("  → Rolling back inventory reservation...");
    }
  }
}