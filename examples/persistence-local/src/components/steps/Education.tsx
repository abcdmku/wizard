import { useState } from 'react';
import { useEducationStep } from '../../wizard/config';
import type { Education as EducationType } from '../../wizard/types';

export function Education() {
  const { next, back, context, updateContext } = useEducationStep();
  
  const [educations, setEducations] = useState<EducationType[]>(
    context.resumeData.education || []
  );
  
  const [currentEdu, setCurrentEdu] = useState<Partial<EducationType>>({
    degree: '',
    institution: '',
    location: '',
    graduationDate: '',
    gpa: '',
    relevantCourses: [],
  });

  const addEducation = () => {
    if (currentEdu.degree && currentEdu.institution) {
      const newEdu: EducationType = {
        id: Date.now().toString(),
        degree: currentEdu.degree!,
        institution: currentEdu.institution!,
        location: currentEdu.location || '',
        graduationDate: currentEdu.graduationDate || '',
        gpa: currentEdu.gpa,
        relevantCourses: currentEdu.relevantCourses || [],
      };
      
      setEducations([...educations, newEdu]);
      setCurrentEdu({
        degree: '',
        institution: '',
        location: '',
        graduationDate: '',
        gpa: '',
        relevantCourses: [],
      });
    }
  };

  const removeEducation = (id: string) => {
    setEducations(educations.filter(edu => edu.id !== id));
  };

  const handleSubmit = () => {
    updateContext({
      resumeData: {
        ...context.resumeData,
        education: educations,
      },
      isDirty: true,
    });
    next();
  };

  return (
    <div className="space-y-6">
      <div className="border rounded-lg p-4 space-y-4">
        <h3 className="font-semibold">Add Education</h3>
        
        <input
          type="text"
          placeholder="Degree *"
          value={currentEdu.degree || ''}
          onChange={e => setCurrentEdu({ ...currentEdu, degree: e.target.value })}
          className="w-full p-2 border rounded"
        />
        
        <input
          type="text"
          placeholder="Institution *"
          value={currentEdu.institution || ''}
          onChange={e => setCurrentEdu({ ...currentEdu, institution: e.target.value })}
          className="w-full p-2 border rounded"
        />

        <div className="grid grid-cols-2 gap-4">
          <input
            type="text"
            placeholder="Location"
            value={currentEdu.location || ''}
            onChange={e => setCurrentEdu({ ...currentEdu, location: e.target.value })}
            className="p-2 border rounded"
          />
          <input
            type="month"
            placeholder="Graduation Date"
            value={currentEdu.graduationDate || ''}
            onChange={e => setCurrentEdu({ ...currentEdu, graduationDate: e.target.value })}
            className="p-2 border rounded"
          />
        </div>

        <input
          type="text"
          placeholder="GPA (optional)"
          value={currentEdu.gpa || ''}
          onChange={e => setCurrentEdu({ ...currentEdu, gpa: e.target.value })}
          className="w-full p-2 border rounded"
        />

        <button
          type="button"
          onClick={addEducation}
          disabled={!currentEdu.degree || !currentEdu.institution}
          className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:bg-gray-400"
        >
          Add Education
        </button>
      </div>

      {educations.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">Your Education</h3>
          {educations.map(edu => (
            <div key={edu.id} className="border rounded p-3 flex justify-between">
              <div>
                <div className="font-medium">{edu.degree}</div>
                <div className="text-sm text-gray-600">
                  {edu.institution} • {edu.graduationDate}
                </div>
              </div>
              <button
                onClick={() => removeEducation(edu.id)}
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
          Continue to Skills
        </button>
      </div>
    </div>
  );
}