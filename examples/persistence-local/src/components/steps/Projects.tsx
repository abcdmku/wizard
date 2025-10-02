import { useState, useEffect } from 'react';
import { useProjectsStep, useResumeWizard } from '../../wizard/config';
import type { Project, WizardContext } from '../../wizard/types';

export function Projects() {
  const step = useProjectsStep();
  const { updateContext, context } = useResumeWizard();
  const { next, back } = step;

  const [projects, setProjects] = useState<Project[]>(
    context.resumeData.projects || []
  );

  const [currentProject, setCurrentProject] = useState<Partial<Project>>({
    name: '',
    description: '',
    technologies: [],
    url: '',
    github: '',
    highlights: [],
  });

  const [techInput, setTechInput] = useState('');

  // Auto-save projects whenever they change
  useEffect(() => {
    updateContext((ctx: WizardContext) => {
      ctx.resumeData = {
        ...ctx.resumeData,
        projects,
      };
      ctx.isDirty = true;
    });
  }, [projects, updateContext]);

  const addTechnology = () => {
    if (techInput.trim()) {
      setCurrentProject(prev => ({
        ...prev,
        technologies: [...(prev.technologies || []), techInput.trim()],
      }));
      setTechInput('');
    }
  };

  const removeTechnology = (index: number) => {
    setCurrentProject(prev => ({
      ...prev,
      technologies: prev.technologies?.filter((_, i) => i !== index) || [],
    }));
  };

  const addProject = () => {
    if (currentProject.name && currentProject.description) {
      const newProject: Project = {
        id: Date.now().toString(),
        name: currentProject.name!,
        description: currentProject.description!,
        technologies: currentProject.technologies || [],
        url: currentProject.url,
        github: currentProject.github,
        highlights: currentProject.highlights || [],
      };
      
      setProjects([...projects, newProject]);
      setCurrentProject({
        name: '',
        description: '',
        technologies: [],
        url: '',
        github: '',
        highlights: [],
      });
    }
  };

  const removeProject = (id: string) => {
    setProjects(projects.filter(p => p.id !== id));
  };

  const handleSubmit = () => {
    // Data is already saved via useEffect, just navigate
    next();
  };

  return (
    <div className="space-y-6">
      <div className="border rounded-lg p-4 space-y-4">
        <h3 className="font-semibold">Add Project</h3>
        
        <input
          type="text"
          placeholder="Project Name *"
          value={currentProject.name || ''}
          onChange={e => setCurrentProject({ ...currentProject, name: e.target.value })}
          className="w-full p-2 border rounded"
        />
        
        <textarea
          placeholder="Project Description *"
          value={currentProject.description || ''}
          onChange={e => setCurrentProject({ ...currentProject, description: e.target.value })}
          className="w-full p-2 border rounded h-20"
        />

        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Add technology"
              value={techInput}
              onChange={e => setTechInput(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addTechnology())}
              className="flex-1 p-2 border rounded"
            />
            <button
              type="button"
              onClick={addTechnology}
              className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
            >
              Add
            </button>
          </div>
          
          <div className="flex flex-wrap gap-2">
            {currentProject.technologies?.map((tech, i) => (
              <span key={i} className="bg-blue-100 px-2 py-1 rounded text-sm">
                {tech}
                <button
                  onClick={() => removeTechnology(i)}
                  className="ml-2 text-red-500"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        <input
          type="url"
          placeholder="Project URL (optional)"
          value={currentProject.url || ''}
          onChange={e => setCurrentProject({ ...currentProject, url: e.target.value })}
          className="w-full p-2 border rounded"
        />

        <input
          type="url"
          placeholder="GitHub URL (optional)"
          value={currentProject.github || ''}
          onChange={e => setCurrentProject({ ...currentProject, github: e.target.value })}
          className="w-full p-2 border rounded"
        />

        <button
          type="button"
          onClick={addProject}
          disabled={!currentProject.name || !currentProject.description}
          className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:bg-gray-400"
        >
          Add Project
        </button>
      </div>

      {projects.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">Your Projects</h3>
          {projects.map(project => (
            <div key={project.id} className="border rounded p-3">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="font-medium">{project.name}</div>
                  <div className="text-sm text-gray-600">{project.description}</div>
                  <div className="flex gap-2 mt-1">
                    {project.technologies.map((tech, i) => (
                      <span key={i} className="text-xs bg-gray-100 px-2 py-1 rounded">
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => removeProject(project.id)}
                  className="text-red-500 hover:text-red-700 ml-2"
                >
                  Remove
                </button>
              </div>
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
          Continue to Summary
        </button>
      </div>
    </div>
  );
}