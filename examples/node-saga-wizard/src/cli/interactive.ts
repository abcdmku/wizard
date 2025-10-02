import prompts from "prompts";
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
    const answers1 = await prompts([
      {
        type: "text",
        name: "orderId",
        message: "Order ID",
        initial: `ORD-${Date.now()}`,
        validate: (value: string) => value.length > 0 || "Order ID is required",
      },
      {
        type: "text",
        name: "customerId",
        message: "Customer ID",
        initial: "CUST-123",
        validate: (value: string) => value.length > 0 || "Customer ID is required",
      },
      {
        type: "number",
        name: "totalAmount",
        message: "Total Amount ($)",
        initial: 99.99,
        validate: (value: number) => value > 0 || "Amount must be greater than 0",
      },
    ]);

    const { orderId, customerId, totalAmount } = answers1;

    const spinner = createSpinner("Processing order initialization...");
    await orderWizard.next({
      data: { orderId, customerId, totalAmount: totalAmount || 0 },
    });
    spinner.succeed("Order initialized!");
    showProgress(1, stepCount, "Wizard Progress");

    // Step 2: Reserve inventory
    showStep(2, "Reserve Inventory");
    const { itemCount } = await prompts({
      type: "number",
      name: "itemCount",
      message: "Number of items",
      initial: 2,
      validate: (value: number) => value > 0 || "Must be at least 1",
    });

    const items = [];
    for (let i = 0; i < itemCount; i++) {
      const itemAnswers = await prompts([
        {
          type: "text",
          name: "sku",
          message: `Item ${i + 1} SKU`,
          initial: `ITEM-${String(i + 1).padStart(3, "0")}`,
        },
        {
          type: "number",
          name: "quantity",
          message: `Item ${i + 1} Quantity`,
          initial: 1,
          validate: (value: number) => value > 0 || "Quantity must be at least 1",
        },
      ]);
      items.push({ sku: itemAnswers.sku, quantity: itemAnswers.quantity });
    }

    const spinner2 = createSpinner("Reserving inventory...");
    await orderWizard.next({
      data: { items },
    });
    spinner2.succeed("Inventory reserved!");
    showProgress(2, stepCount, "Wizard Progress");

    // Step 3: Process payment
    showStep(3, "Process Payment");
    const paymentAnswers = await prompts([
      {
        type: "select",
        name: "paymentMethod",
        message: "Payment method",
        choices: [
          { title: "Credit Card", value: "card" },
          { title: "PayPal", value: "paypal" },
        ],
        initial: 0,
      },
      {
        type: "confirm",
        name: "paymentConfirm",
        message: "Confirm payment?",
        initial: true,
      },
    ]);

    const { paymentMethod, paymentConfirm } = paymentAnswers as {
      paymentMethod: ChargeData["paymentMethod"];
      paymentConfirm: boolean;
    };

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

    const spinner4 = createSpinner("Sending notification...");
    await orderWizard.next({
      data: { email },
    });
    spinner4.succeed(`Notification sent to ${email}`);
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