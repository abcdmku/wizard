# /refactor Command

Refactor TypeScript files following **best practices** and the `refactor.md` guide.  
This includes **analyzing, restructuring, extracting, validating, and cleaning up** code while preserving functionality and improving maintainability.

---

## Usage

```
/refactor <filename>
```

### Examples
```
/refactor src/components/UserProfile.tsx
/refactor src/utils/api.ts
```

---

## What it Does

This command will:

1. **Analyze the file** – Understand its purpose, scope, and dependencies.  
2. **Identify issues** – Detect code smells, type safety issues, and optimization opportunities.  
3. **Create a refactoring plan** – Generate a structured todo list of changes.  
4. **Execute refactoring** – Incrementally apply best practices and improvements.  
5. **Reorganize codebase** –  
   - Split large files into smaller modules  
   - Move extracted code out of the original file  
   - Remove duplicate/obsolete code from the original file  
   - Ensure imports are updated across the repo  
   - Create/update **barrel exports (`index.ts`)** where helpful  
6. **Validate changes** – Compile, lint, run tests, and check for unused imports.  
7. **Post-refactor cleanup** – Remove dead code, ensure consistent style, update docs/comments.  
8. **Report results** – Summarize changes, improvements, and remaining follow-up items.  

---

## Refactoring Process

### Phase 1: Analysis
- Read and understand the entire file  
- Check for existing tests  
- Analyze imports, exports, and dependencies  
- Identify related files in the same directory/module  
- Note existing conventions and code style  

### Phase 2: Issue Detection

- **Critical Issues**
  - Any use of `any` type  
  - Suppressed errors (`@ts-ignore`)  
  - Empty catch blocks  
  - Hardcoded secrets/credentials  

- **Code Smells**
  - Functions > 20 lines  
  - Files > 200 lines  
  - Deep nesting (>3 levels)  
  - Duplicate logic  
  - Mixed abstraction levels  
  - Long parameter lists (>3)  
  - Multiple unrelated functions in one file  

- **Performance Issues**
  - Missing memoization (React)  
  - Inefficient loops  
  - Unnecessary re-renders  
  - Heavy computations on render  

### Phase 3: Refactoring Actions

- **Code Extraction**
  - Split large files into smaller modules  
  - Extract functions, hooks, and utilities into separate files  
  - Remove original code after extraction (no duplication)  
  - Create/maintain barrel exports (`index.ts`) for clean imports  

- **Type Safety**
  - Remove `any` types  
  - Add proper type annotations  
  - Introduce type aliases/interfaces  
  - Use discriminated unions when appropriate  

- **Code Organization**
  - Apply single responsibility principle  
  - Group related functionality  
  - Keep files <200 lines when possible  
  - Maintain logical module boundaries  

- **Modern Patterns**
  - Convert callbacks to async/await  
  - Use optional chaining/nullish coalescing  
  - Prefer immutability and functional style where appropriate  
  - Use const assertions for literal values  

- **React Specific**
  - Extract custom hooks  
  - Add memoization (`React.memo`, `useMemo`, `useCallback`)  
  - Optimize rendering logic  
  - Split large components into smaller subcomponents  

- **Performance**
  - Optimize loops and computations  
  - Apply lazy loading when beneficial  
  - Minimize unnecessary dependencies  

- **Readability**
  - Simplify complex conditionals  
  - Replace magic numbers/strings with constants  
  - Add JSDoc-style comments for exported functions/classes  

### Phase 4: Validation

- Run **TypeScript compiler** (`npx tsc --noEmit`)  
- Run **linter** (`npm run lint`)  
- Run **tests** if available (`npm test`)  
- Remove unused imports and variables  
- Ensure no stray `console.log` statements remain  
- Validate that barrel exports resolve correctly  
- Ensure imports are consistent (absolute vs relative paths)  

### Phase 5: Post-Refactor Cleanup

- Remove dead/unused code and files  
- Ensure consistent file/folder naming conventions  
- Update inline comments and docstrings  
- Add/update README or module-level documentation if needed  
- Verify dependency injection patterns (if used)  
- Ensure public API surface is intentional (avoid leaking internals)  
- Double-check cross-module imports after reorganizing  

---

## Options

You can specify focus areas:

```
/refactor src/api.ts types        # Focus on type safety
/refactor src/Component.tsx perf  # Focus on performance
/refactor src/service.ts clean    # Focus on code organization
```

---

## Safety Features

- Creates a **todo list** for complex refactors  
- Makes incremental, reversible changes  
- Preserves existing functionality  
- Follows existing conventions  
- Validates after each major change  
- Can rollback if validation fails  

---

## Output

After refactoring, you’ll receive:  
- Summary of changes made  
- List of improvements applied  
- Any remaining issues that need manual review  
- Validation results (TS, lint, tests)  
- Performance impact (if measurable)  
- Suggested follow-up tasks (e.g. adding missing tests)  

---

## Notes

- Requires the file to exist  
- Best with `.ts` and `.tsx` files  
- Won’t introduce new dependencies without asking  
- Preserves existing functionality  
- Creates **clean, readable, maintainable code**  
