import { useState, useEffect } from "react";
import { useSendReminderStep, useBranchingWizard } from "../../wizard/config";

export function SendReminder() {
  const step = useSendReminderStep();
  const { goTo } = useBranchingWizard();
  const { data, error, updateData } = step;

  const [scheduleType, setScheduleType] = useState<'now' | 'later' | 'custom'>(data?.scheduleType || 'later');
  const [customDate, setCustomDate] = useState(data?.customDate || '');
  const [message, setMessage] = useState(data?.message || '');
  const [isSent, setIsSent] = useState(false);

  // Get tomorrow's date for default "later" option
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  useEffect(() => {
    updateData({
      scheduleType,
      customDate: scheduleType === 'custom' ? customDate : undefined,
      message,
    });
  }, [scheduleType, customDate, message]);

  // Auto-redirect after showing "Sent" confirmation
  useEffect(() => {
    if (isSent) {
      const timer = setTimeout(() => {
        goTo('managerDashboard');
      }, 2000); // 2 seconds

      return () => clearTimeout(timer);
    }
  }, [isSent, goTo]);

  const handleSend = () => {
    // Show confirmation, then auto-redirect
    setIsSent(true);
  };

  const getScheduledDate = () => {
    if (scheduleType === 'now') return 'immediately';
    if (scheduleType === 'later') return tomorrowStr;
    return customDate;
  };

  // Show "Sent" confirmation screen
  if (isSent) {
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
          <h2 className="text-2xl font-bold mb-2 dark:text-gray-100">Reminder Scheduled!</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            Your reminder has been scheduled for <strong>{data?.userName}</strong>
          </p>
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4 max-w-md mx-auto">
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              <strong className="dark:text-gray-300">Scheduled:</strong> {getScheduledDate()}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              <strong className="dark:text-gray-300">Message:</strong> {message}
            </div>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-6">
            Returning to dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 dark:text-gray-100">Send Reminder</h2>
        <p className="text-gray-600 dark:text-gray-300">
          Schedule a reminder for {data?.userName}
        </p>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
        <div className="font-semibold dark:text-gray-100">Team Member</div>
        <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{data?.userName}</div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-3 dark:text-gray-100">When to send reminder?</label>
          <div className="space-y-2">
            <label className={`flex items-center p-3 rounded border-2 cursor-pointer transition-all ${
              scheduleType === 'now'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-600'
                : 'border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700'
            }`}>
              <input
                type="radio"
                name="schedule"
                value="now"
                checked={scheduleType === 'now'}
                onChange={() => setScheduleType('now')}
                className="h-4 w-4 text-blue-600 mr-3"
              />
              <div>
                <div className="font-medium dark:text-gray-100">Send Now</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Reminder will be sent immediately</div>
              </div>
            </label>

            <label className={`flex items-center p-3 rounded border-2 cursor-pointer transition-all ${
              scheduleType === 'later'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-600'
                : 'border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700'
            }`}>
              <input
                type="radio"
                name="schedule"
                value="later"
                checked={scheduleType === 'later'}
                onChange={() => setScheduleType('later')}
                className="h-4 w-4 text-blue-600 mr-3"
              />
              <div>
                <div className="font-medium dark:text-gray-100">Send Tomorrow</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Scheduled for {tomorrowStr}</div>
              </div>
            </label>

            <label className={`flex items-center p-3 rounded border-2 cursor-pointer transition-all ${
              scheduleType === 'custom'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-600'
                : 'border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700'
            }`}>
              <input
                type="radio"
                name="schedule"
                value="custom"
                checked={scheduleType === 'custom'}
                onChange={() => setScheduleType('custom')}
                className="h-4 w-4 text-blue-600 mr-3"
              />
              <div className="flex-1">
                <div className="font-medium dark:text-gray-100">Custom Date</div>
                {scheduleType === 'custom' && (
                  <input
                    type="date"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
                  />
                )}
              </div>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-100">Reminder Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Enter a message to remind the team member..."
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
          />
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {message.length}/5 characters minimum
          </div>
        </div>
      </div>

      {error != null && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-600 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300 rounded-md text-sm">
          {String(error)}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => goTo('managerDashboard')}
          className="flex-1 py-2 px-4 bg-gray-200 text-gray-800 font-medium rounded-md hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 transition-colors duration-200"
        >
          Cancel
        </button>
        <button
          onClick={handleSend}
          disabled={message.length < 5 || (scheduleType === 'custom' && !customDate)}
          className="flex-1 py-2 px-4 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Schedule Reminder
        </button>
      </div>
    </div>
  );
}
