import { useState, useEffect } from 'react';
import { useSummaryStep, useResumeWizard } from '../../wizard/config';
import type { WizardContext } from '../../wizard/types';

export function Summary() {
  const step = useSummaryStep();
  const { updateContext, context } = useResumeWizard();
  const { next, back } = step;

  const [summary, setSummary] = useState(
    context.resumeData.summary || ''
  );

  // Auto-save summary whenever it changes
  useEffect(() => {
    updateContext((ctx: WizardContext) => {
      ctx.resumeData = {
        ...ctx.resumeData,
        summary,
      };
      ctx.isDirty = true;
    });
  }, [summary, updateContext]);

  const handleSubmit = () => {
    // Data is already saved via useEffect, just navigate
    next();
  };

  const generateSuggestion = () => {
    const { personalInfo, workExperience, skills } = context.resumeData;
    
    if (!personalInfo || !workExperience?.length) {
      return 'Complete previous steps to generate a suggestion.';
    }

    const latestJob = workExperience[0];
    const topSkills = skills?.slice(0, 3).map(s => s.name).join(', ');
    
    return `Experienced ${latestJob.title} with expertise in ${topSkills || 'various technologies'}. ${workExperience.length} years of professional experience in ${latestJob.company} and other leading organizations. Seeking opportunities to leverage technical skills and deliver impactful solutions.`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 p-4 rounded-lg">
        <h3 className="font-semibold mb-2">Professional Summary</h3>
        <p className="text-sm text-gray-600">
          Write a brief 2-3 sentence summary highlighting your experience, skills, and career objectives.
        </p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setSummary(generateSuggestion())}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Generate suggestion based on your data
        </button>
        
        <textarea
          placeholder="Example: Experienced software developer with 5+ years building scalable web applications..."
          value={summary}
          onChange={e => setSummary(e.target.value)}
          className="w-full p-3 border rounded-lg h-32"
        />
        
        <div className="text-sm text-gray-500">
          {summary.length}/500 characters
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="font-semibold mb-2">Data Summary</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>Personal Info: {context.resumeData.personalInfo ? '✓' : '○'}</div>
          <div>Work Experience: {context.resumeData.workExperience?.length || 0} entries</div>
          <div>Education: {context.resumeData.education?.length || 0} entries</div>
          <div>Skills: {context.resumeData.skills?.length || 0} items</div>
          <div>Projects: {context.resumeData.projects?.length || 0} items</div>
          <div>Summary: {summary ? '✓' : '○'}</div>
        </div>
      </div>

      <div className="flex gap-4">
        <button
          onClick={() => back()}
          className="flex-1 bg-gray-200 py-2 rounded hover:bg-gray-300"
        >
          Back
        </button>
        <button
          onClick={handleSubmit}
          className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
        >
          Continue to Preview
        </button>
      </div>
    </div>
  );
}