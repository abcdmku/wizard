import type { ResumeData } from '../wizard/types';

const STORAGE_KEY = 'wizard_resume_draft';
const BACKUP_KEY = 'wizard_resume_backup';
const VERSION_KEY = 'wizard_resume_version';

export interface PersistenceAdapter {
  save: (data: Partial<ResumeData>) => Promise<void>;
  load: () => Promise<Partial<ResumeData> | null>;
  clear: () => Promise<void>;
  backup: () => Promise<void>;
  restore: () => Promise<Partial<ResumeData> | null>;
}

export class LocalStorageAdapter implements PersistenceAdapter {
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(debounceMs = 1000) {
    this.debounceMs = debounceMs;
  }

  async save(data: Partial<ResumeData>): Promise<void> {
    return new Promise((resolve) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        try {
          const savedData = {
            ...data,
            lastSaved: new Date(),
            version: this.getVersion() + 1,
          };
          
          localStorage.setItem(STORAGE_KEY, JSON.stringify(savedData));
          this.incrementVersion();
          
          console.log('Auto-saved at:', new Date().toLocaleTimeString());
          resolve();
        } catch (error) {
          console.error('Failed to save to localStorage:', error);
          resolve();
        }
      }, this.debounceMs);
    });
  }

  async load(): Promise<Partial<ResumeData> | null> {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;

      const data = JSON.parse(stored);
      
      // Convert date strings back to Date objects
      if (data.lastSaved) {
        data.lastSaved = new Date(data.lastSaved);
      }
      
      return data;
    } catch (error) {
      console.error('Failed to load from localStorage:', error);
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      // Create backup before clearing
      await this.backup();
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(VERSION_KEY);
      console.log('Storage cleared');
    } catch (error) {
      console.error('Failed to clear localStorage:', error);
    }
  }

  async backup(): Promise<void> {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) {
        localStorage.setItem(BACKUP_KEY, current);
        console.log('Backup created');
      }
    } catch (error) {
      console.error('Failed to create backup:', error);
    }
  }

  async restore(): Promise<Partial<ResumeData> | null> {
    try {
      const backup = localStorage.getItem(BACKUP_KEY);
      if (!backup) return null;

      const data = JSON.parse(backup);
      
      // Restore to main storage
      localStorage.setItem(STORAGE_KEY, backup);
      
      // Convert date strings back to Date objects
      if (data.lastSaved) {
        data.lastSaved = new Date(data.lastSaved);
      }
      
      console.log('Restored from backup');
      return data;
    } catch (error) {
      console.error('Failed to restore from backup:', error);
      return null;
    }
  }

  private getVersion(): number {
    try {
      const version = localStorage.getItem(VERSION_KEY);
      return version ? parseInt(version, 10) : 0;
    } catch {
      return 0;
    }
  }

  private incrementVersion(): void {
    try {
      const newVersion = this.getVersion() + 1;
      localStorage.setItem(VERSION_KEY, newVersion.toString());
    } catch (error) {
      console.error('Failed to update version:', error);
    }
  }
}

// Singleton instance
export const storageAdapter = new LocalStorageAdapter(1000);