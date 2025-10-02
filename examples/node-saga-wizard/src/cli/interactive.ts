import readlineSync from "readline-sync";
import chalk from "chalk";
import { orderWizard } from "../wizard/orderWizard";
import type { ChargeData } from "../wizard/types";
import {
  showTitle,
  showBanner,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  showStep,
  showProgress,
  showSummary,
  showDivider,
  createSpinner,
} from "./display";

export async function runInteractiveCLI() {
  // Check if we have a TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    showError("Interactive mode requires a TTY (interactive terminal)");
    showInfo("Please run this command in a real terminal, not with piped input");
    showInfo("Or use automated mode: pnpm start auto");
    process.exit(1);
  }

  // Clear screen for clean start
  console.clear();

  showTitle("Order Wizard");
  showBanner("Interactive Order Processing", { color: "magenta" });

  try {
    const stepCount = orderWizard.helpers.stepCount();

    // Step 1: Initialize order
    showStep(1, "Initialize Order");

    const orderId = readlineSync.question(
      chalk.cyan("Order ID: "),
      { defaultInput: `ORD-${Date.now()}` }
    );

    const customerId = readlineSync.question(
      chalk.cyan("Customer ID: "),
      { defaultInput: "CUST-123" }
    );

    const totalAmountStr = readlineSync.question(
      chalk.cyan("Total Amount ($): "),
      { defaultInput: "99.99" }
    );
    const totalAmount = parseFloat(totalAmountStr);

    const spinner = createSpinner("Processing order initialization...");
    await orderWizard.next({
      data: { orderId, customerId, totalAmount: totalAmount || 0 },
    });
    spinner.succeed("Order initialized!");
    showProgress(1, stepCount, "Wizard Progress");

    // Step 2: Reserve inventory
    showStep(2, "Reserve Inventory");

    const itemCountStr = readlineSync.question(
      chalk.cyan("Number of items: "),
      { defaultInput: "2" }
    );
    const itemCount = parseInt(itemCountStr);

    const items = [];
    for (let i = 0; i < itemCount; i++) {
      const sku = readlineSync.question(
        chalk.cyan(`  Item ${i + 1} SKU: `),
        { defaultInput: `ITEM-${String(i + 1).padStart(3, "0")}` }
      );

      const quantityStr = readlineSync.question(
        chalk.cyan(`  Item ${i + 1} Quantity: `),
        { defaultInput: "1" }
      );

      items.push({ sku, quantity: parseInt(quantityStr) });
    }

    const spinner2 = createSpinner("Reserving inventory...");
    await orderWizard.next({
      data: { items },
    });
    spinner2.succeed("Inventory reserved!");
    showProgress(2, stepCount, "Wizard Progress");

    // Step 3: Process payment
    showStep(3, "Process Payment");

    const paymentMethodIndex = readlineSync.keyInSelect(
      ["Credit Card", "PayPal"],
      "Payment method:",
      { cancel: false }
    );
    const paymentMethod: ChargeData["paymentMethod"] =
      paymentMethodIndex === 0 ? "card" : "paypal";

    const paymentConfirm = readlineSync.keyInYNStrict(
      chalk.cyan("Confirm payment?")
    );

    if (paymentConfirm) {
      const spinner3 = createSpinner("Processing payment...");
      await orderWizard.next({
        data: {
          paymentMethod,
          confirmed: paymentConfirm,
        },
      });
      const context = orderWizard.getContext();
      spinner3.succeed(`Payment processed: ${context.paymentId}`);
      showProgress(3, stepCount, "Wizard Progress");
    } else {
      showError("Payment cancelled");
      return;
    }

    // Step 4: Send notification
    showStep(4, "Send Notification");

    const email = readlineSync.questionEMail(
      chalk.cyan("Customer email: "),
      { defaultInput: "customer@example.com" }
    );

    const spinner4 = createSpinner("Sending notification...");
    await orderWizard.next({
      data: { email },
    });
    spinner4.succeed(`Notification sent to ${email}`);
    showProgress(4, stepCount, "Wizard Progress");

    // Step 5: Complete order
    showStep(5, "Complete Order");

    const finalConfirm = readlineSync.keyInYNStrict(
      chalk.cyan("Complete order?")
    );

    if (finalConfirm) {
      const spinner5 = createSpinner("Finalizing order...");
      await orderWizard.next({
        data: { confirmed: finalConfirm },
      });
      spinner5.succeed("Order completed!");
      showProgress(5, stepCount, "Wizard Progress");

      showDivider();
      showSuccess("🎉 Wizard completed successfully!");

      // Show final summary
      const finalContext = orderWizard.getContext();
      showSummary({
        "Order ID": finalContext.orderId,
        "Customer ID": finalContext.customerId,
        "Payment ID": finalContext.paymentId,
        "Total Amount": `$${finalContext.totalAmount}`,
        "Email": email,
        "Status": "Completed",
      });
    } else {
      showError("Order completion cancelled");
    }
  } catch (error) {
    showError(`Wizard failed: ${error instanceof Error ? error.message : String(error)}`);

    // Show helpful information
    const progress = orderWizard.helpers.progress();
    showDivider();
    showError(`Failed at: ${progress.label} (${progress.percent}% complete)`);
  }
}