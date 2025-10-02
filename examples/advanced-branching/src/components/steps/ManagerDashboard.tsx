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
  const { error, back } = step;

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 dark:text-gray-100">Manager Dashboard</h2>
        <p className="text-gray-600 dark:text-gray-300">
          View your team's progress and completion statistics
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-900 dark:text-green-100">{completedCount}</div>
          <div className="text-sm text-green-700 dark:text-green-300">Completed</div>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
          <div className="text-2xl font-bold text-yellow-900 dark:text-yellow-100">{inProgressCount}</div>
          <div className="text-sm text-yellow-700 dark:text-yellow-300">In Progress</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{notStartedCount}</div>
          <div className="text-sm text-gray-700 dark:text-gray-400">Not Started</div>
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="font-semibold dark:text-gray-100">Team Completion Rate</span>
          <span className="text-2xl font-bold text-blue-900 dark:text-blue-100">{completionRate}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
          <div
            className="bg-blue-600 dark:bg-blue-500 h-3 rounded-full transition-all duration-300"
            style={{ width: `${completionRate}%` }}
          />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg dark:text-gray-100">Team Members</h3>

        <div className="space-y-3">
          {mockTeamMembers.map((member) => (
            <div
              key={member.id}
              className="p-4 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-semibold dark:text-gray-100">{member.name}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">{member.department}</div>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    member.status === "Completed"
                      ? "bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-100"
                      : member.status === "In Progress"
                      ? "bg-yellow-100 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-100"
                      : "bg-gray-100 dark:bg-gray-600 text-gray-800 dark:text-gray-100"
                  }`}
                >
                  {member.status}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-300 ${
                      member.progress === 100
                        ? "bg-green-600 dark:bg-green-500"
                        : member.progress > 0
                        ? "bg-yellow-600 dark:bg-yellow-500"
                        : "bg-gray-400 dark:bg-gray-500"
                    }`}
                    style={{ width: `${member.progress}%` }}
                  />
                </div>
                <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[3rem]">
                  {member.progress}%
                </span>
              </div>

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                {member.completedAt ? (
                  <div className="text-xs text-gray-500 dark:text-gray-500">
                    Completed on {member.completedAt}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 dark:text-gray-500">
                    {member.status === "In Progress" ? "Currently working" : "Not started yet"}
                  </div>
                )}
                {member.status !== "Completed" && (
                  <button
                    onClick={() => handleSendReminder(member)}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 transition-colors"
                  >
                    Send Reminder
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          <strong className="dark:text-gray-300">Note:</strong> As a manager, you can see team completion
          statistics but not individual feedback responses to maintain privacy.
        </div>
      </div>

      {error != null && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-600 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300 rounded-md text-sm">
          {String(error)}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={back}
          className="flex-1 py-2 px-4 bg-gray-200 text-gray-800 font-medium rounded-md hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 transition-colors duration-200"
        >
          Back
        </button>
        <button
          onClick={() => {
            alert("Manager review complete! In a real app, this would export the team statistics and complete the workflow.");
          }}
          className="flex-1 py-2 px-4 bg-green-600 text-white font-medium rounded-md hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800 transition-colors duration-200"
        >
          Complete Review
        </button>
      </div>
    </div>
  );
}