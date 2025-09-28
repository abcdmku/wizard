import readline from "readline/promises";
import { orderWizard } from "../wizard/orderWizard";
import type { ChargeData } from "../wizard/types";

export async function runInteractiveCLI() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n=== Order Processing Wizard ===\n");

  try {
    // Step 1: Initialize order
    console.log("Step 1: Initialize Order");
    const orderId = await rl.question("Order ID: ");
    const customerId = await rl.question("Customer ID: ");
    const totalAmount = parseFloat(await rl.question("Total Amount ($): "));

    await orderWizard.next({
      data: { orderId, customerId, totalAmount },
    });

    // Step 2: Reserve inventory
    console.log("\nStep 2: Reserve Inventory");
    const itemCount = parseInt(await rl.question("Number of items: "));
    const items = [];
    for (let i = 0; i < itemCount; i++) {
      const sku = await rl.question(`  Item ${i + 1} SKU: `);
      const quantity = parseInt(await rl.question(`  Item ${i + 1} Quantity: `));
      items.push({ sku, quantity });
    }

    await orderWizard.next({
      data: { items },
    });

    // Step 3: Process payment
    console.log("\nStep 3: Process Payment");
    const paymentMethod = await rl.question("Payment method (card/paypal): ") as ChargeData["paymentMethod"];
    const paymentConfirm = await rl.question("Confirm payment? (yes/no): ");

    await orderWizard.next({
      data: {
        paymentMethod,
        confirmed: paymentConfirm.toLowerCase() === "yes",
      },
    });

    // Step 4: Send notification
    console.log("\nStep 4: Send Notification");
    const email = await rl.question("Customer email: ");

    await orderWizard.next({
      data: { email },
    });

    // Step 5: Complete order
    console.log("\nStep 5: Complete Order");
    const finalConfirm = await rl.question("Complete order? (yes/no): ");

    await orderWizard.next({
      data: { confirmed: finalConfirm.toLowerCase() === "yes" },
    });

    console.log("\n=== Wizard Complete ===\n");

    // Show progress using helpers
    const progress = orderWizard.helpers.progress();
    console.log(`Progress: ${progress.label} (${progress.percent}%)`);
  } catch (error) {
    console.error("\n❌ Error:", error);
    console.log("\nCurrent state:", orderWizard.getCurrent());

    // Show helpful information using helpers
    const currentStep = orderWizard.getCurrent().step;
    const status = orderWizard.helpers.stepStatus(currentStep);
    const canGoNext = orderWizard.helpers.canGoNext();

    console.log(`Current step status: ${status}`);
    console.log(`Can proceed: ${canGoNext}`);
  } finally {
    rl.close();
  }
}