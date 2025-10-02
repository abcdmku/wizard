import { useState, useEffect } from "react";
import { useManagerDashboardStep, useBranchingWizard } from "../../wizard/config";

// Mock team member data
const mockTeamMembers = [
  {
    id: 1,
    name: "John Doe",
    department: "Engineering",
    status: "Completed",
    completedAt: "2025-09-28",
    progress: 100,
  },
  {
    id: 2,
    name: "Jane Smith",
    department: "Engineering",
    status: "Completed",
    completedAt: "2025-09-27",
    progress: 100,
  },
  {
    id: 3,
    name: "Bob Johnson",
    department: "Engineering",
    status: "In Progress",
    completedAt: null,
    progress: 67,
  },
  {
    id: 4,
    name: "Alice Williams",
    department: "Engineering",
    status: "Not Started",
    completedAt: null,
    progress: 0,
  },
  {
    id: 5,
    name: "Charlie Brown",
    department: "Engineering",
    status: "Completed",
    completedAt: "2025-09-26",
    progress: 100,
  },
];

export function ManagerDashboard() {
  const step = useManagerDashboardStep();
  const { goTo, setStepData } = useBranchingWizard();
  const { error } = step;
  const [isCompleted, setIsCompleted] = useState(false);

  const completedCount = mockTeamMembers.filter(m => m.status === "Completed").length;
  const inProgressCount = mockTeamMembers.filter(m => m.status === "In Progress").length;
  const notStartedCount = mockTeamMembers.filter(m => m.status === "Not Started").length;
  const completionRate = Math.round((completedCount / mockTeamMembers.length) * 100);

  const handleSendReminder = (member: typeof mockTeamMembers[0]) => {
    setStepData('sendReminder', {
      userId: member.id,
      userName: member.name,
      scheduleType: 'later',
      message: '',
    });
    goTo('sendReminder');
  };

  // Auto-redirect after showing completion
  useEffect(() => {
    if (isCompleted) {
      const timer = setTimeout(() => {
        goTo('roleSelection');
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [isCompleted, goTo]);

  // Show completion screen
  if (isCompleted) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="mb-4">
            <svg
              className="w-20 h-20 mx-auto text-green-600 dark:text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-2 dark:text-gray-100">Manager Review Complete!</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            Team statistics have been reviewed successfully
          </p>
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4 max-w-md mx-auto">
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              <strong className="dark:text-gray-300">Team Completion Rate:</strong> {completionRate}%
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              <strong className="dark:text-gray-300">Team Members:</strong> {completedCount} completed, {inProgressCount} in progress, {notStartedCount} not started
            </div>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-6">
            Returning to role selection...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold mb-1 dark:text-gray-100">Manager Dashboard</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Team completion: {completionRate}% ({completedCount}/{mockTeamMembers.length})
        </p>
      </div>

      <div className="space-y-2">
          {mockTeamMembers.map((member) => (
            <div
              key={member.id}
              className="p-3 bg-white dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium dark:text-gray-100 truncate">{member.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${
                          member.progress === 100
                            ? "bg-green-600 dark:bg-green-500"
                            : member.progress > 0
                            ? "bg-yellow-600 dark:bg-yellow-500"
                            : "bg-gray-400"
                        }`}
                        style={{ width: `${member.progress}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-600 dark:text-gray-400 w-10 text-right">
                      {member.progress}%
                    </span>
                  </div>
                </div>
                {member.status !== "Completed" ? (
                  <button
                    onClick={() => handleSendReminder(member)}
                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 whitespace-nowrap"
                  >
                    Remind
                  </button>
                ) : (
                  <div className="text-xs text-green-600 dark:text-green-400 whitespace-nowrap">✓ Done</div>
                )}
              </div>
            </div>
          ))}
      </div>

      {error != null && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-600 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300 rounded-md text-sm">
          {String(error)}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => goTo('roleSelection')}
          className="flex-1 py-2 px-4 bg-gray-200 text-gray-800 font-medium rounded-md hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 transition-colors duration-200"
        >
          Back
        </button>
        <button
          onClick={() => setIsCompleted(true)}
          className="flex-1 py-2 px-4 bg-green-600 text-white font-medium rounded-md hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800 transition-colors duration-200"
        >
          Complete Review
        </button>
      </div>
    </div>
  );
}