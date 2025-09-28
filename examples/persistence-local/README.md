# Persistence Local - Wizard Example

This example demonstrates local storage persistence with auto-save functionality in a multi-step resume builder wizard.

## What This Example Demonstrates

- **Auto-Save**: Changes are automatically saved to localStorage with debouncing
- **Session Recovery**: Automatically restores progress from previous sessions
- **Backup/Restore**: Manual backup and restore functionality
- **Export Data**: Export completed resume as JSON
- **Visual Indicators**: Shows save status and last save time
- **Debounced Saving**: Prevents excessive writes to localStorage

## Structure

```
src/
├── App.tsx                    # Main app (10 lines)
├── wizard/
│   ├── config.ts              # Wizard with persistence hooks
│   └── types.ts               # TypeScript types for resume data
├── utils/
│   └── persistence.ts         # LocalStorage adapter with debouncing
├── components/
│   ├── steps/
│   │   ├── PersonalInfo.tsx   # Personal information form
│   │   ├── WorkExperience.tsx # Work history with highlights
│   │   ├── Education.tsx      # Education background
│   │   ├── Skills.tsx         # Technical and soft skills
│   │   ├── Projects.tsx       # Portfolio projects
│   │   ├── Summary.tsx        # Professional summary
│   │   └── Preview.tsx        # Preview and export
│   ├── ui/
│   │   ├── AutoSaveIndicator.tsx # Save status display
│   │   └── StepProgress.tsx      # Visual progress tracker
│   └── WizardContainer.tsx    # Main wizard UI wrapper
```

## Key Features

### LocalStorage Adapter

The persistence adapter provides:

- **Debounced Saving**: Waits 1 second after changes before saving
- **Versioning**: Tracks save versions
- **Backup/Restore**: Create and restore from backups
- **Error Handling**: Gracefully handles storage errors

```typescript
const adapter = new LocalStorageAdapter(1000); // 1s debounce
await adapter.save(data);      // Auto-debounced
await adapter.load();          // Load from storage
await adapter.backup();        // Create backup
await adapter.restore();       // Restore from backup
```

### Auto-Save Integration

The wizard configuration includes:

```typescript
onInit: async (ctx) => {
  const savedData = await storageAdapter.load();
  if (savedData) {
    return { ...ctx, resumeData: savedData, recoveredFromStorage: true };
  }
  return ctx;
},

onTransition: async (ctx) => {
  if (ctx.autoSaveEnabled && ctx.isDirty) {
    await storageAdapter.save(ctx.resumeData);
    return { ...ctx, isDirty: false, lastAutoSave: new Date() };
  }
  return ctx;
}
```

### Visual Feedback

The AutoSaveIndicator shows:

- Current save status (saved/unsaved)
- Last save timestamp
- Recovery notification
- Real-time status updates

## Running the Example

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

## Usage Flow

1. **Start Building**: Enter personal information
2. **Auto-Save**: Changes are saved automatically as you progress
3. **Add Data**: Complete work experience, education, skills, and projects
4. **Session Recovery**: Close and reopen - data is restored
5. **Preview**: Review your complete resume
6. **Export**: Download as JSON or create backups

## Persistence Features

### Auto-Save Behavior

- Triggers on step transitions
- 1-second debounce to batch changes
- Visual indicator shows save status
- Handles errors gracefully

### Data Recovery

- Automatically loads on app start
- Shows recovery notification
- Preserves all form data
- Maintains step progress

### Backup System

- Manual backup creation
- One-click restore
- Separate storage keys
- Confirmation dialogs

## Technologies Used

- React 18
- TypeScript
- @wizard/core & @wizard/react
- LocalStorage API
- Tailwind CSS
- Vite

## Code Organization

### Persistence Layer (`utils/persistence.ts`)
- `PersistenceAdapter` interface for extensibility
- `LocalStorageAdapter` implementation
- Debouncing logic
- Version tracking

### Wizard Configuration (`wizard/config.ts`)
- `onInit` hook for loading saved data
- `onTransition` hook for auto-save
- Context management for save state

### Step Components
- Each step updates wizard context
- Sets `isDirty` flag on changes
- Validates before proceeding

### UI Components
- `AutoSaveIndicator`: Real-time save status
- `StepProgress`: Visual progress tracking
- Save/load animations

## Files Overview

- **App.tsx**: Minimal wrapper with wizard provider (10 lines)
- **utils/persistence.ts**: Complete localStorage implementation with debouncing
- **wizard/config.ts**: Wizard setup with persistence hooks
- **components/steps/**: 7 step components for resume building
- **components/ui/**: Reusable UI components for feedback