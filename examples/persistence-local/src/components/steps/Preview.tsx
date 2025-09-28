import { useWizardActions, useWizardSharedContext } from '@wizard/react';
import type { WizardContext } from '../../wizard/types';
import { storageAdapter } from '../../utils/persistence';

export function Preview() {
  const { back, reset } = useWizardActions();
  const context = useWizardSharedContext() as WizardContext;
  const { resumeData } = context;

  const handleExport = () => {
    const dataStr = JSON.stringify(resumeData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportName = `resume_${new Date().toISOString().split('T')[0]}.json`;
    
    const link = document.createElement('a');
    link.setAttribute('href', dataUri);
    link.setAttribute('download', exportName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClear = async () => {
    if (confirm('This will clear all data and start over. Are you sure?')) {
      await storageAdapter.clear();
      reset();
    }
  };

  const handleBackup = async () => {
    await storageAdapter.backup();
    alert('Backup created successfully!');
  };

  const handleRestore = async () => {
    const restored = await storageAdapter.restore();
    if (restored) {
      alert('Data restored from backup. Please refresh to see changes.');
    } else {
      alert('No backup found.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-green-50 p-4 rounded-lg">
        <h3 className="font-semibold text-green-800 mb-2">Resume Complete!</h3>
        <p className="text-sm text-green-700">
          Your resume has been auto-saved. You can export it or continue editing.
        </p>
        {context.lastAutoSave && (
          <p className="text-xs text-green-600 mt-1">
            Last saved: {context.lastAutoSave.toLocaleTimeString()}
          </p>
        )}
      </div>

      <div className="border rounded-lg p-4 bg-gray-50">
        <h3 className="font-bold text-lg mb-4">Resume Preview</h3>
        
        {/* Personal Info */}
        {resumeData.personalInfo && (
          <div className="mb-4">
            <h4 className="font-semibold text-2xl">
              {resumeData.personalInfo.firstName} {resumeData.personalInfo.lastName}
            </h4>
            <div className="text-sm text-gray-600">
              {resumeData.personalInfo.email} • {resumeData.personalInfo.phone}
              {resumeData.personalInfo.location && ` • ${resumeData.personalInfo.location}`}
            </div>
          </div>
        )}

        {/* Summary */}
        {resumeData.summary && (
          <div className="mb-4">
            <h4 className="font-semibold border-b mb-2">Professional Summary</h4>
            <p className="text-sm">{resumeData.summary}</p>
          </div>
        )}

        {/* Work Experience */}
        {resumeData.workExperience && resumeData.workExperience.length > 0 && (
          <div className="mb-4">
            <h4 className="font-semibold border-b mb-2">Work Experience</h4>
            {resumeData.workExperience.map(exp => (
              <div key={exp.id} className="mb-3">
                <div className="font-medium">{exp.title} - {exp.company}</div>
                <div className="text-sm text-gray-600">
                  {exp.startDate} - {exp.current ? 'Present' : exp.endDate}
                </div>
                <p className="text-sm mt-1">{exp.description}</p>
              </div>
            ))}
          </div>
        )}

        {/* Education */}
        {resumeData.education && resumeData.education.length > 0 && (
          <div className="mb-4">
            <h4 className="font-semibold border-b mb-2">Education</h4>
            {resumeData.education.map(edu => (
              <div key={edu.id} className="mb-2">
                <div className="font-medium">{edu.degree}</div>
                <div className="text-sm text-gray-600">
                  {edu.institution} • {edu.graduationDate}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Skills */}
        {resumeData.skills && resumeData.skills.length > 0 && (
          <div className="mb-4">
            <h4 className="font-semibold border-b mb-2">Skills</h4>
            <div className="flex flex-wrap gap-2">
              {resumeData.skills.map(skill => (
                <span key={skill.id} className="bg-gray-200 px-2 py-1 rounded text-sm">
                  {skill.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={handleExport}
          className="bg-green-600 text-white py-2 rounded hover:bg-green-700"
        >
          Export as JSON
        </button>
        <button
          onClick={handleBackup}
          className="bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
        >
          Create Backup
        </button>
        <button
          onClick={handleRestore}
          className="bg-yellow-600 text-white py-2 rounded hover:bg-yellow-700"
        >
          Restore Backup
        </button>
        <button
          onClick={handleClear}
          className="bg-red-600 text-white py-2 rounded hover:bg-red-700"
        >
          Clear & Start Over
        </button>
      </div>

      <button
        onClick={() => back()}
        className="w-full bg-gray-200 py-2 rounded hover:bg-gray-300"
      >
        Back to Edit
      </button>
    </div>
  );
}