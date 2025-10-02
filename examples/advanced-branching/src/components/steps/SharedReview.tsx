import { useState } from "react";
import { useBranchingWizard, useSharedReviewStep } from "../../wizard/config";
import type { SharedReviewData } from "../../wizard/types";

export function SharedReview() {
  const { back, setStepData, context } = useBranchingWizard();
  const reviewStep = useSharedReviewStep();
  const existingData = reviewStep.data;
  
  const [data, setData] = useState<SharedReviewData>(
    existingData || {
      feedback: "",
      rating: 5,
      subscribe: false,
    }
  );
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    try {
      // Validate before submitting
      if (!data.feedback || data.feedback.length < 10) {
        throw new Error("Please provide at least 10 characters of feedback");
      }
      if (data.rating < 1 || data.rating > 10) {
        throw new Error("Rating must be between 1 and 10");
      }
      
      setStepData("sharedReview", data);
      setSubmitted(true);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    }
  };

  const updateField = (field: keyof SharedReviewData, value: string | number | boolean) => {
    setData(prev => ({ ...prev, [field]: value }));
    setError("");
  };

  const getRoleSummary = () => {
    const summaries = [];
    
    if (context.completedSteps.includes("userProfile")) {
      summaries.push("User Profile completed");
    }
    if (context.completedSteps.includes("adminPanel")) {
      summaries.push("Admin Settings configured");
    }
    if (context.completedSteps.includes("managerDashboard")) {
      summaries.push("Manager Dashboard configured");
    }
    
    return summaries;
  };

  if (submitted) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-green-600 dark:text-green-400 mb-2">Wizard Complete!</h2>
          <p className="text-gray-600 dark:text-gray-300">Thank you for exploring the branching wizard</p>
        </div>

        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-3 transition-colors duration-200">
          <h3 className="font-semibold dark:text-gray-100">Journey Summary</h3>
          <div className="text-sm space-y-1 dark:text-gray-300">
            <p>Role: <span className="font-medium capitalize">{context.role}</span></p>
            <p>Steps Completed: {context.completedSteps.length}</p>
            <p>Rating: {data.rating}/10</p>
            {data.subscribe && <p className="text-green-600 dark:text-green-400">✓ Subscribed to updates</p>}
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg transition-colors duration-200">
          <h4 className="font-medium mb-2 dark:text-gray-100">Your Feedback:</h4>
          <p className="text-sm italic dark:text-gray-300">"{data.feedback}"</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 dark:text-gray-100">Review & Feedback</h2>
        <p className="text-gray-600 dark:text-gray-300">Complete your journey with feedback</p>
      </div>

      <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg transition-colors duration-200">
        <h3 className="font-semibold mb-2 dark:text-gray-100">Your Path Through the Wizard</h3>
        <ul className="text-sm space-y-1 dark:text-gray-300">
          {getRoleSummary().map((summary, index) => (
            <li key={index} className="flex items-center">
              <span className="text-green-500 dark:text-green-400 mr-2">✓</span>
              {summary}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1 dark:text-gray-100">Your Feedback</label>
        <textarea
          value={data.feedback}
          onChange={(e) => updateField("feedback", e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-400 transition-colors duration-200"
          rows={4}
          placeholder="Share your experience with the branching wizard..."
        />
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Minimum 10 characters ({data.feedback.length}/10)
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1 dark:text-gray-100">Rating (1-10)</label>
        <input
          type="range"
          min="1"
          max="10"
          value={data.rating}
          onChange={(e) => updateField("rating", parseInt(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
          <span>Poor</span>
          <span className="font-bold text-lg">{data.rating}</span>
          <span>Excellent</span>
        </div>
      </div>

      <label className="flex items-center">
        <input
          type="checkbox"
          checked={data.subscribe}
          onChange={(e) => updateField("subscribe", e.target.checked)}
          className="h-4 w-4 text-blue-600 mr-2"
        />
        <span className="text-sm dark:text-gray-300">Subscribe to updates about wizard improvements</span>
      </label>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-600 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300 rounded-md text-sm">
          {error}
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
          onClick={handleSubmit}
          className="flex-1 py-2 px-4 bg-green-600 text-white font-medium rounded-md hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800 transition-colors duration-200"
        >
          Complete Wizard
        </button>
      </div>
    </div>
  );
}