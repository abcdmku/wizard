import { useState } from 'react';
import { useSkillsStep, useResumeWizard } from '../../wizard/config';
import type { Skill, WizardContext } from '../../wizard/types';

export function Skills() {
  const step = useSkillsStep();
  const { updateContext, context } = useResumeWizard();
  const { next, back } = step;
  
  const [skills, setSkills] = useState<Skill[]>(
    context.resumeData.skills || []
  );
  
  const [currentSkill, setCurrentSkill] = useState<Partial<Skill>>({
    name: '',
    category: 'technical',
    proficiency: 'intermediate',
  });

  const addSkill = () => {
    if (currentSkill.name) {
      const newSkill: Skill = {
        id: Date.now().toString(),
        name: currentSkill.name!,
        category: currentSkill.category!,
        proficiency: currentSkill.proficiency!,
      };
      
      setSkills([...skills, newSkill]);
      setCurrentSkill({
        name: '',
        category: 'technical',
        proficiency: 'intermediate',
      });
    }
  };

  const removeSkill = (id: string) => {
    setSkills(skills.filter(skill => skill.id !== id));
  };

  const handleSubmit = () => {
    updateContext((ctx: WizardContext) => {
      ctx.resumeData = {
        ...ctx.resumeData,
        skills,
      };
      ctx.isDirty = true;
    });
    next();
  };

  const skillsByCategory = {
    technical: skills.filter(s => s.category === 'technical'),
    soft: skills.filter(s => s.category === 'soft'),
    language: skills.filter(s => s.category === 'language'),
  };

  return (
    <div className="space-y-6">
      <div className="border rounded-lg p-4 space-y-4">
        <h3 className="font-semibold">Add Skill</h3>
        
        <input
          type="text"
          placeholder="Skill Name *"
          value={currentSkill.name || ''}
          onChange={e => setCurrentSkill({ ...currentSkill, name: e.target.value })}
          className="w-full p-2 border rounded"
        />

        <div className="grid grid-cols-2 gap-4">
          <select
            value={currentSkill.category}
            onChange={e => setCurrentSkill({ ...currentSkill, category: e.target.value as any })}
            className="p-2 border rounded"
          >
            <option value="technical">Technical</option>
            <option value="soft">Soft Skill</option>
            <option value="language">Language</option>
          </select>

          <select
            value={currentSkill.proficiency}
            onChange={e => setCurrentSkill({ ...currentSkill, proficiency: e.target.value as any })}
            className="p-2 border rounded"
          >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            <option value="expert">Expert</option>
          </select>
        </div>

        <button
          type="button"
          onClick={addSkill}
          disabled={!currentSkill.name}
          className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:bg-gray-400"
        >
          Add Skill
        </button>
      </div>

      {skills.length > 0 && (
        <div className="space-y-4">
          {Object.entries(skillsByCategory).map(([category, categorySkills]) => (
            categorySkills.length > 0 && (
              <div key={category}>
                <h3 className="font-semibold capitalize mb-2">{category} Skills</h3>
                <div className="flex flex-wrap gap-2">
                  {categorySkills.map(skill => (
                    <div
                      key={skill.id}
                      className="bg-gray-100 px-3 py-1 rounded-full text-sm flex items-center gap-2"
                    >
                      <span>{skill.name}</span>
                      <span className="text-xs text-gray-600">({skill.proficiency})</span>
                      <button
                        onClick={() => removeSkill(skill.id)}
                        className="text-red-500 hover:text-red-700 ml-1"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
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
          Continue to Projects
        </button>
      </div>
    </div>
  );
}