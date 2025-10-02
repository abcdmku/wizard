import { useMemo } from "react";
import { useBranchingWizard } from "../wizard/config";
import { getAvailableStepsForRole } from "../wizard/navigation";

export function useRoleBasedSteps() {
  const { context } = useBranchingWizard();
  
  const roleSteps = useMemo(() => {
    return getAvailableStepsForRole(context.role);
  }, [context.role]);
  
  const completionPercentage = useMemo(() => {
    if (!context.role || roleSteps.length === 0) return 0;
    
    const completedInPath = context.completedSteps.filter(
      step => roleSteps.includes(step)
    );
    
    return Math.round((completedInPath.length / roleSteps.length) * 100);
  }, [context.completedSteps, context.role, roleSteps]);
  
  const nextAvailableStep = useMemo(() => {
    for (const step of roleSteps) {
      if (!context.completedSteps.includes(step)) {
        return step;
      }
    }
    return null;
  }, [roleSteps, context.completedSteps]);
  
  return {
    roleSteps,
    completionPercentage,
    nextAvailableStep,
    totalSteps: roleSteps.length,
    completedCount: context.completedSteps.length,
  };
}