import { useState } from 'react';
import { useExperienceStep } from '../../wizard/config';
import type { WorkExperience as WorkExperienceType } from '../../wizard/types';

export function WorkExperience() {
  const step = useExperienceStep();
  const { next, back, context, wizard } = step;
  
  const [experiences, setExperiences] = useState<WorkExperienceType[]>(
    context.resumeData.workExperience || []
  );
  
  const [currentExp, setCurrentExp] = useState<Partial<WorkExperienceType>>({
    title: '',
    company: '',
    location: '',
    startDate: '',
    current: false,
    description: '',
    highlights: [],
  });

  const [highlightInput, setHighlightInput] = useState('');

  const addHighlight = () => {
    if (highlightInput.trim()) {
      setCurrentExp(prev => ({
        ...prev,
        highlights: [...(prev.highlights || []), highlightInput.trim()],
      }));
      setHighlightInput('');
    }
  };

  const removeHighlight = (index: number) => {
    setCurrentExp(prev => ({
      ...prev,
      highlights: prev.highlights?.filter((_, i) => i !== index) || [],
    }));
  };

  const addExperience = () => {
    if (currentExp.title && currentExp.company) {
      const newExp: WorkExperienceType = {
        id: Date.now().toString(),
        title: currentExp.title!,
        company: currentExp.company!,
        location: currentExp.location || '',
        startDate: currentExp.startDate || '',
        endDate: currentExp.current ? undefined : currentExp.endDate,
        current: currentExp.current || false,
        description: currentExp.description || '',
        highlights: currentExp.highlights || [],
      };
      
      setExperiences([...experiences, newExp]);
      setCurrentExp({
        title: '',
        company: '',
        location: '',
        startDate: '',
        current: false,
        description: '',
        highlights: [],
      });
    }
  };

  const removeExperience = (id: string) => {
    setExperiences(experiences.filter(exp => exp.id !== id));
  };

  const handleSubmit = () => {
    wizard.updateContext((ctx) => {
      ctx.resumeData = {
        ...ctx.resumeData,
        workExperience: experiences,
      };
      ctx.isDirty = true;
    });
    next();
  };

  return (
    <div className="space-y-6">
      <div className="border rounded-lg p-4 space-y-4">
        <h3 className="font-semibold">Add Work Experience</h3>
        
        <div className="grid grid-cols-2 gap-4">
          <input
            type="text"
            placeholder="Job Title *"
            value={currentExp.title || ''}
            onChange={e => setCurrentExp({ ...currentExp, title: e.target.value })}
            className="p-2 border rounded"
          />
          <input
            type="text"
            placeholder="Company *"
            value={currentExp.company || ''}
            onChange={e => setCurrentExp({ ...currentExp, company: e.target.value })}
            className="p-2 border rounded"
          />
        </div>

        <input
          type="text"
          placeholder="Location"
          value={currentExp.location || ''}
          onChange={e => setCurrentExp({ ...currentExp, location: e.target.value })}
          className="w-full p-2 border rounded"
        />

        <div className="grid grid-cols-2 gap-4">
          <input
            type="month"
            placeholder="Start Date"
            value={currentExp.startDate || ''}
            onChange={e => setCurrentExp({ ...currentExp, startDate: e.target.value })}
            className="p-2 border rounded"
          />
          {!currentExp.current && (
            <input
              type="month"
              placeholder="End Date"
              value={currentExp.endDate || ''}
              onChange={e => setCurrentExp({ ...currentExp, endDate: e.target.value })}
              className="p-2 border rounded"
            />
          )}
        </div>

        <label className="flex items-center">
          <input
            type="checkbox"
            checked={currentExp.current || false}
            onChange={e => setCurrentExp({ ...currentExp, current: e.target.checked })}
            className="mr-2"
          />
          Currently working here
        </label>

        <textarea
          placeholder="Job Description"
          value={currentExp.description || ''}
          onChange={e => setCurrentExp({ ...currentExp, description: e.target.value })}
          className="w-full p-2 border rounded h-24"
        />

        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Add a highlight"
              value={highlightInput}
              onChange={e => setHighlightInput(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addHighlight())}
              className="flex-1 p-2 border rounded"
            />
            <button
              type="button"
              onClick={addHighlight}
              className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
            >
              Add
            </button>
          </div>
          
          {currentExp.highlights?.map((highlight, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="flex-1">• {highlight}</span>
              <button
                onClick={() => removeHighlight(i)}
                className="text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addExperience}
          disabled={!currentExp.title || !currentExp.company}
          className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:bg-gray-400"
        >
          Add Experience
        </button>
      </div>

      {experiences.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">Your Experience</h3>
          {experiences.map(exp => (
            <div key={exp.id} className="border rounded p-3 flex justify-between">
              <div>
                <div className="font-medium">{exp.title} at {exp.company}</div>
                <div className="text-sm text-gray-600">
                  {exp.startDate} - {exp.current ? 'Present' : exp.endDate}
                </div>
              </div>
              <button
                onClick={() => removeExperience(exp.id)}
                className="text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

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
          Continue to Education
        </button>
      </div>
    </div>
  );
}