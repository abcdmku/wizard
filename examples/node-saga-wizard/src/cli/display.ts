import chalk from "chalk";
import boxen from "boxen";
import gradient from "gradient-string";
import figlet from "figlet";
import Table from "cli-table3";
import ora, { type Ora } from "ora";

/**
 * Display utilities for beautiful terminal output
 */

export function showTitle(text: string) {
  const ascii = figlet.textSync(text, {
    font: "ANSI Shadow",
    horizontalLayout: "fitted",
  });
  console.log("\n" + gradient.pastel.multiline(ascii) + "\n");
}

export function showBanner(text: string, options?: { color?: string }) {
  const banner = boxen(text, {
    padding: 1,
    margin: 1,
    borderStyle: "round",
    borderColor: options?.color || "cyan",
    textAlignment: "center",
  });
  console.log(banner);
}

export function showSuccess(message: string) {
  console.log(chalk.green("✔ " + message));
}

export function showError(message: string) {
  console.log(chalk.red("✖ " + message));
}

export function showWarning(message: string) {
  console.log(chalk.yellow("⚠ " + message));
}

export function showInfo(message: string) {
  console.log(chalk.cyan("ℹ " + message));
}

export function showStep(stepNumber: number, label: string) {
  console.log(
    "\n" + chalk.bold.blue(`━━━ Step ${stepNumber}: ${label} ━━━`) + "\n"
  );
}

export function createSpinner(text: string): Ora {
  return ora({
    text,
    spinner: "dots",
    color: "cyan",
  }).start();
}

export function showProgress(current: number, total: number, label?: string) {
  const percentage = Math.round((current / total) * 100);
  const barLength = 30;
  const filled = Math.round((percentage / 100) * barLength);
  const empty = barLength - filled;

  const bar =
    chalk.green("█".repeat(filled)) + chalk.gray("░".repeat(empty));

  const text = label
    ? `${label}: ${percentage}%`
    : `Progress: ${percentage}%`;

  console.log(`\n${bar} ${chalk.bold(text)} (${current}/${total})\n`);
}

export function showTable(
  headers: string[],
  rows: string[][],
  options?: { title?: string }
) {
  const table = new Table({
    head: headers.map((h) => chalk.cyan.bold(h)),
    style: {
      head: [],
      border: ["gray"],
    },
  });

  rows.forEach((row) => table.push(row));

  if (options?.title) {
    console.log("\n" + chalk.bold.underline(options.title));
  }
  console.log(table.toString() + "\n");
}

export function showSummary(data: Record<string, any>) {
  const box = boxen(
    Object.entries(data)
      .map(([key, value]) => {
        const label = chalk.bold(key + ":");
        const val = chalk.white(String(value));
        return `${label} ${val}`;
      })
      .join("\n"),
    {
      padding: 1,
      borderStyle: "round",
      borderColor: "green",
      title: "Summary",
      titleAlignment: "center",
    }
  );
  console.log("\n" + box + "\n");
}

export function clearConsole() {
  console.clear();
}

export function showDivider(char: string = "─", length: number = 50) {
  console.log(chalk.gray(char.repeat(length)));
}

export function showKeyValue(key: string, value: string | number) {
  console.log(chalk.dim(key + ":"), chalk.white(value));
}
