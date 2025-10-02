export interface WizardRouterConfig {
  /**
   * Enable true history mode where navigation state persists across back/forward
   * When true, browser back/forward buttons work as prev/next within the wizard
   * When false, data may be lost when navigating back
   */
  historyMode: boolean;
}

export const defaultWizardConfig: WizardRouterConfig = {
  historyMode: true,
};
