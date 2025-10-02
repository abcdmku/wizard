import { useState, useEffect } from "react";
import { useAdminPanelStep, useBranchingWizard } from "../../wizard/config";

// Mock user data that an admin would see
const mockUserSubmissions = [
  {
    id: 1,
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@example.com",
    department: "Engineering",
    feedback: "Great experience with the platform. Very intuitive and easy to use.",
    rating: 8,
    subscribe: true,
    submittedAt: "2025-09-28",
  },
  {
    id: 2,
    firstName: "Jane",
    lastName: "Smith",
    email: "jane.smith@example.com",
    department: "Marketing",
    feedback: "Love the new features! Would appreciate more customization options.",
    rating: 9,
    subscribe: true,
    submittedAt: "2025-09-27",
  },
  {
    id: 3,
    firstName: "Bob",
    lastName: "Johnson",
    email: "bob.j@example.com",
    department: "Sales",
    feedback: "Good overall, but encountered some bugs in the reporting section.",
    rating: 7,
    subscribe: false,
    submittedAt: "2025-09-26",
  },
];

export function AdminPanel() {
  const step = useAdminPanelStep();
  const { context, goTo } = useBranchingWizard();
  const { error, back } = step;
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [userData, setUserData] = useState(mockUserSubmissions);
  const [isCompleted, setIsCompleted] = useState(false);

  const selectedUserData = selectedUser !== null
    ? userData.find(u => u.id === selectedUser)
    : null;

  const handleSaveEdit = () => {
    setEditMode(false);
    // In a real app, this would save to backend
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
          <h2 className="text-2xl font-bold mb-2 dark:text-gray-100">Admin Review Complete!</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            All user data has been reviewed successfully
          </p>
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4 max-w-md mx-auto">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              <strong className="dark:text-gray-300">Reviewed:</strong> {userData.length} user submissions
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              <strong className="dark:text-gray-300">Average Rating:</strong> {(userData.reduce((acc, u) => acc + u.rating, 0) / userData.length).toFixed(1)}/10
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
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 dark:text-gray-100">Admin Dashboard</h2>
        <p className="text-gray-600 dark:text-gray-300">View and manage all user submissions</p>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
        <div className="font-semibold dark:text-gray-100">Total Submissions: {userData.length}</div>
        <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Average Rating: {(userData.reduce((acc, u) => acc + u.rating, 0) / userData.length).toFixed(1)}/10
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg dark:text-gray-100">User Submissions</h3>

        <div className="space-y-3">
          {userData.map((user) => (
            <div
              key={user.id}
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                selectedUser === user.id
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-600"
                  : "border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-500"
              }`}
              onClick={() => setSelectedUser(selectedUser === user.id ? null : user.id)}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-semibold dark:text-gray-100">
                    {user.firstName} {user.lastName}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">{user.email}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-500 mt-1">
                    {user.department} • {user.submittedAt}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-100 rounded-full text-sm font-medium">
                    {user.rating}/10
                  </span>
                </div>
              </div>

              {selectedUser === user.id && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600 space-y-3">
                  <div>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Feedback</div>
                    {editMode ? (
                      <textarea
                        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-800 dark:text-gray-100"
                        rows={3}
                        value={selectedUserData?.feedback || ""}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          setUserData(prev =>
                            prev.map(u => u.id === user.id ? { ...u, feedback: e.target.value } : u)
                          );
                        }}
                      />
                    ) : (
                      <div className="text-gray-600 dark:text-gray-300 text-sm">{user.feedback}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-600 dark:text-gray-400">
                      Newsletter: {user.subscribe ? "✓ Subscribed" : "✗ Not subscribed"}
                    </span>
                  </div>

                  <div className="flex gap-2 pt-2">
                    {editMode ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSaveEdit();
                          }}
                          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
                        >
                          Save Changes
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditMode(false);
                            setUserData(mockUserSubmissions); // Reset
                          }}
                          className="px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-800 dark:text-gray-100 rounded-md hover:bg-gray-400 dark:hover:bg-gray-500 text-sm"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditMode(true);
                        }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                      >
                        Edit Data
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
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
          onClick={() => setIsCompleted(true)}
          className="flex-1 py-2 px-4 bg-green-600 text-white font-medium rounded-md hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800 transition-colors duration-200"
        >
          Complete Review
        </button>
      </div>
    </div>
  );
}
