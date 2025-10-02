import inquirer from "inquirer";
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
  showTitle("Order Wizard");
  showBanner("Interactive Order Processing", { color: "magenta" });

  // Check if we have a TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    showError("Interactive mode requires a TTY (interactive terminal)");
    showInfo("Please run this command in a real terminal, not with piped input");
    showInfo("Or use automated mode: pnpm start auto");
    process.exit(1);
  }

  try {
    const stepCount = orderWizard.helpers.stepCount();

    // Step 1: Initialize order
    showStep(1, "Initialize Order");
    const answers1 = await inquirer.prompt([
      {
        type: "input",
        name: "orderId",
        message: "Order ID:",
        default: `ORD-${Date.now()}`,
        validate: (value: string) => value.length > 0 || "Order ID is required",
      },
      {
        type: "input",
        name: "customerId",
        message: "Customer ID:",
        default: "CUST-123",
        validate: (value: string) => value.length > 0 || "Customer ID is required",
      },
      {
        type: "input",
        name: "totalAmount",
        message: "Total Amount ($):",
        default: "99.99",
        validate: (value: string) => {
          const num = parseFloat(value);
          return !isNaN(num) && num > 0 || "Please enter a valid amount greater than 0";
        },
      },
    ]);

    const { orderId, customerId, totalAmount: totalAmountStr } = answers1;
    const totalAmount = parseFloat(totalAmountStr);

    let spinner = createSpinner("Processing order initialization...");
    await orderWizard.next({
      data: { orderId, customerId, totalAmount: totalAmount || 0 },
    });
    spinner.succeed("Order initialized!");
    showProgress(1, stepCount, "Wizard Progress");

    // Step 2: Reserve inventory
    showStep(2, "Reserve Inventory");
    const { itemCount: itemCountStr } = await inquirer.prompt([
      {
        type: "input",
        name: "itemCount",
        message: "Number of items:",
        default: "2",
        validate: (value: string) => {
          const num = parseInt(value);
          return !isNaN(num) && num > 0 || "Please enter a valid number greater than 0";
        },
      },
    ]);

    const itemCount = parseInt(itemCountStr);
    const items = [];
    for (let i = 0; i < itemCount; i++) {
      const itemAnswers = await inquirer.prompt([
        {
          type: "input",
          name: "sku",
          message: `Item ${i + 1} SKU:`,
          default: `ITEM-${String(i + 1).padStart(3, "0")}`,
        },
        {
          type: "input",
          name: "quantity",
          message: `Item ${i + 1} Quantity:`,
          default: "1",
          validate: (value: string) => {
            const num = parseInt(value);
            return !isNaN(num) && num > 0 || "Quantity must be at least 1";
          },
        },
      ]);
      items.push({ sku: itemAnswers.sku, quantity: parseInt(itemAnswers.quantity) });
    }

    spinner = createSpinner("Reserving inventory...");
    await orderWizard.next({
      data: { items },
    });
    spinner.succeed("Inventory reserved!");
    showProgress(2, stepCount, "Wizard Progress");

    // Step 3: Process payment
    showStep(3, "Process Payment");
    const paymentAnswers = await inquirer.prompt([
      {
        type: "list",
        name: "paymentMethod",
        message: "Payment method:",
        choices: [
          { name: "Credit Card", value: "card" },
          { name: "PayPal", value: "paypal" },
        ],
      },
      {
        type: "confirm",
        name: "paymentConfirm",
        message: "Confirm payment?",
        default: true,
      },
    ]);

    const { paymentMethod, paymentConfirm } = paymentAnswers as {
      paymentMethod: ChargeData["paymentMethod"];
      paymentConfirm: boolean;
    };

    if (paymentConfirm) {
      spinner = createSpinner("Processing payment...");
      await orderWizard.next({
        data: {
          paymentMethod,
          confirmed: paymentConfirm,
        },
      });
      const context = orderWizard.getContext();
      spinner.succeed(`Payment processed: ${context.paymentId}`);
      showProgress(3, stepCount, "Wizard Progress");
    } else {
      showError("Payment cancelled");
      return;
    }

    // Step 4: Send notification
    showStep(4, "Send Notification");
    const { email } = await inquirer.prompt([
      {
        type: "input",
        name: "email",
        message: "Customer email:",
        default: "customer@example.com",
        validate: (value: string) => {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          return emailRegex.test(value) || "Please enter a valid email";
        },
      },
    ]);

    spinner = createSpinner("Sending notification...");
    await orderWizard.next({
      data: { email },
    });
    spinner.succeed(`Notification sent to ${email}`);
    showProgress(4, stepCount, "Wizard Progress");

    // Step 5: Complete order
    showStep(5, "Complete Order");
    const { finalConfirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "finalConfirm",
        message: "Complete order?",
        default: true,
      },
    ]);

    if (finalConfirm) {
      spinner = createSpinner("Finalizing order...");
      await orderWizard.next({
        data: { confirmed: finalConfirm },
      });
      spinner.succeed("Order completed!");
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
    // Check if user cancelled (Ctrl+C)
    if (error instanceof Error && error.message.includes("User force closed")) {
      showWarning("\nWizard cancelled by user");
      process.exit(0);
    }

    showError(`Wizard failed: ${error instanceof Error ? error.message : String(error)}`);

    // Show helpful information
    const progress = orderWizard.helpers.progress();
    showDivider();
    showError(`Failed at: ${progress.label} (${progress.percent}% complete)`);
  }
}