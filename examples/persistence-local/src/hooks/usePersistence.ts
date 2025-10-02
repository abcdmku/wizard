import { useEffect, useRef } from 'react';
import { storageAdapter } from '../utils/persistence';
import type { ResumeData } from '../wizard/types';

export function usePersistence(
  context: any,
  updateContext: (updater: (ctx: any) => void) => void
) {
  const isInitialized = useRef(false);
  const isSaving = useRef(false);

  // Load saved data on mount
  useEffect(() => {
    if (isInitialized.current) return;
    isInitialized.current = true;

    const loadSavedData = async () => {
      const saved = await storageAdapter.load();
      if (saved) {
        updateContext((ctx) => {
          ctx.resumeData = saved;
          ctx.recoveredFromStorage = true;
          ctx.lastAutoSave = saved.lastSaved;
          ctx.isDirty = false;
        });
      }
    };

    loadSavedData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save when context changes
  useEffect(() => {
    if (!isInitialized.current || isSaving.current) return;
    if (!context.isDirty || !context.autoSaveEnabled) return;

    const saveData = async () => {
      isSaving.current = true;
      await storageAdapter.save(context.resumeData as Partial<ResumeData>);

      updateContext((ctx) => {
        ctx.isDirty = false;
        ctx.lastAutoSave = new Date();
      });

      isSaving.current = false;
    };

    saveData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.isDirty, context.resumeData]);
}
