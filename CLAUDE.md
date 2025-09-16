## **TypeScript Monorepo Best Practices — Vite + React + Tailwind + API**

### **1. Overview**

This setup uses a modern TypeScript monorepo structure for building full-stack apps with:

* **Frontend:** Vite + React 19 + TailwindCSS
* **Backend:** h3 or Express for small projects, Nitro for larger projects
* **Shared Utilities:** Types, constants, and helper functions in a common workspace
* **Tooling:** ESLint, Prettier, pnpm workspaces, and automated build/test pipelines

---

### **2. Monorepo Structure**

```
my-app/
│
├── apps/
│   ├── web/               # Vite + React + Tailwind frontend
│   └── api/               # Backend (h3 / Express / Nitro)
│
├── packages/
│   ├── ui/                # Shared UI components (React)
│   ├── utils/             # Shared TypeScript utilities
│   └── config/            # Shared config (eslint, tailwind, tsconfig)
│
├── .gitignore
├── package.json           # Root scripts + workspace config
└── pnpm-workspace.yaml
```

---

### **3. Tooling & Configurations**

#### **Package Manager**

* Use **pnpm** for fast, disk-efficient installs.
* Workspaces make sharing code between frontend/backend trivial.

#### **TypeScript Config**

* Root `tsconfig.json` contains base settings.
* Each app/package extends it:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

#### **Linting & Formatting**

* ESLint + Prettier with a shared config in `packages/config/eslint`.
* Enable `typescript-eslint` for stricter type-aware rules.

---

### **4. Frontend (Vite + React + Tailwind)**

#### Install

```bash
cd apps/web
pnpm create vite@latest . --template react-ts
pnpm install
```

#### Tailwind Setup

```bash
pnpm install tailwindcss postcss autoprefixer
pnpm tailwindcss init -p
```

Add to `tailwind.config.js`:

```js
content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
theme: { extend: {} },
plugins: [],
```

#### Environment Variables

* For **frontend**, use Vite’s native env system:

  * `.env` → available in backend only.
  * `.env.local` / `.env.development` → for local dev.
  * Must prefix public vars with `VITE_` to expose to frontend code.
* You **don’t need `dotenv`** in the frontend — Vite injects automatically.

---

### **5. Backend**

#### **Small Projects**

* **h3**:

  ```bash
  pnpm add h3
  ```

  ```ts
  import { createApp, toNodeListener } from 'h3';
  import { createServer } from 'node:http';

  const app = createApp();

  app.use('/', () => 'Hello world');

  createServer(toNodeListener(app)).listen(3000);
  ```

* **Express**:

  ```bash
  pnpm add express
  ```

  ```ts
  import express from 'express';
  const app = express();
  app.get('/', (_, res) => res.send('Hello World'));
  app.listen(3000);
  ```

#### **Larger Projects**

* **Nitro**:

  ```bash
  pnpm dlx nitro init api
  ```

  * File-based routes under `/routes`.
  * TypeScript + server bundling built-in.
  * Multiple deployment adapters (`node`, `vercel`, `netlify`, `workers`, etc.).

---

### **6. Shared Packages**

* **ui**: React components shared between apps.
* **utils**: Pure TS helpers (date formatting, API clients, validation).
* Use **path aliases** in `tsconfig.json` for clean imports:

```json
"paths": {
  "@utils/*": ["packages/utils/src/*"],
  "@ui/*": ["packages/ui/src/*"]
}
```

---

### **7. Scripts**

Root `package.json`:

```json
{
  "scripts": {
    "dev:web": "pnpm --filter web dev",
    "dev:api": "pnpm --filter api dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "format": "pnpm -r format"
  }
}
```

---

### **8. Deployment**

* **Frontend** → Build with `pnpm build` → Deploy `/dist` to CDN/host.
* **Backend**:

  * h3/Express → Deploy Node server or container.
  * Nitro → Use deployment adapter (`pnpm build && nitro deploy`).

---

### **9. Best Practices**

* Keep backend & frontend **decoupled** — communicate via HTTP/JSON.
* Share **types** between frontend & backend to avoid drift.
* Use `.env` for secrets, but **never** commit it to git.
* Run `pnpm install --frozen-lockfile` in CI to ensure reproducibility.
* Use `tsx` or `vite-node` for faster TS execution in dev.


Got it — I’ll expand this to fully match **best practices for a modern TypeScript monorepo with Vite, React, Tailwind, and backend services**, while also adding sections for **package publishing**, **workspace linking**, and **full-stack workflow**.

I’ll also review every section so it reflects **current 2025 standards** for Vite-based React apps with Tailwind and a backend in the same monorepo.

Here’s the updated **DEV\_GUIDE.md**:

---

# **DEV\_GUIDE.md**

*Comprehensive guide for developing in this TypeScript monorepo.*

---

## 1. Core Development Philosophy

### **KISS (Keep It Simple, Stupid)**

Keep the code simple, readable, and maintainable. Avoid unnecessary abstractions.

### **YAGNI (You Aren’t Gonna Need It)**

Don’t implement features until they are actually needed.

### **Design Principles**

* **Dependency Inversion**: High-level modules depend on interfaces, not concrete classes.
* **Open/Closed Principle**: Extend behavior without modifying existing code unless existing code was poorly designed.
* **Single Responsibility**: One module = one purpose.
* **Fail Fast**: Validate early, throw immediately when assumptions break.

---

### **Vertical Slice Principle**

In both frontend and backend:

* Group files by **feature**, not type.
* Tests live in the same folder as the code they test.

---

## 3. Development Environment

### **Tooling**

* **Package Manager** → `pnpm` (fast + monorepo-friendly)
* **Frontend** → Vite + React 19 + TailwindCSS + (shadcn/ui, radix, ect.)
* **Backend** → Express/Fastify or NestJS
* **Database** → Prisma or Drizzle
* **Linting** → ESLint + Prettier
* **Testing** → Vitest (frontend), Vitest (backend), Playwright (E2E)
* **Type Safety** → TypeScript strict mode, Zod for runtime validation
* **Styling** → Tailwind + CSS Modules where necessary
* **Environment** → dotenv + Zod schema validation

---

## 4. Setup

```bash
# Install all dependencies
pnpm install

# Start frontend in dev mode
pnpm dev:web

# Start backend in dev mode
pnpm dev:api

# Run all tests
pnpm test

# Build all packages
pnpm build

# Lint + format
pnpm lint
pnpm format
```

---

## 5. Code Style & Conventions

### **General**

* Max line length: **100 characters**
* Use **double quotes** `"`
* Trailing commas in multi-line structures
* Always use **explicit types** for public functions

### **Naming**

* Variables/functions: `camelCase`
* Components/types: `PascalCase`
* Constants: `UPPER_SNAKE_CASE`
* Boolean fields: `isSomething`
* Private class members: `#private` or `_prefix`

---

## 6. React + Vite + Tailwind Best Practices

* Use **function components** + hooks (`useState`, `useEffect`, `useQuery`, etc.)
* Keep components **small** (one clear responsibility)
* Group feature logic + components in `/features`
* Use **Tailwind** for styles, avoid inline styles unless dynamic
* Extract reusable UI into `packages/ui`
* Use **shadcn/ui** for consistent styled components
* Avoid prop drilling — use context or hooks
* Preload critical assets via Vite's `import.meta.glob`

---

## 7. Type Safety & Validation

Use **Zod** for validating API inputs, configs, and forms.

```ts
import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
});

export type User = z.infer<typeof UserSchema>;
```

---

## 8. Testing Strategy

### **Frontend**

* **Unit** → Vitest + Testing Library
* **Integration** → Testing Library with mocked APIs
* **E2E** → Playwright

### **Backend**

* **Unit** → Vitest with c
* **Integration** → DB + API together
* **E2E** → Playwright hitting deployed API

---

## 9. Error Handling

```ts
export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}
```

* Throw **custom errors** in services
* Global error handler in backend
* Display friendly messages in frontend

---

## 10. Logging

* **Backend** → Pino for JSON logs
* **Frontend** → Console for dev, Sentry for prod

---

## 11. Configuration

```ts
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const ConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "production", "test"]),
});

export const config = ConfigSchema.parse(process.env);
```

---

## 12. Database Layer

We prefer **Prisma** for most projects.

```ts
import { prisma } from "@repo/db";

export const getUser = (id: string) => prisma.user.findUnique({ where: { id } });
```

---

## 13. API Standards

* REST paths: `/api/v1/resource/{id}`
* Use camelCase for JSON responses
* Use plural nouns for collections
* Always validate request data with Zod

---

## 14. Package Publishing & Internal Linking

### **Internal Packages**

* Defined in `packages/`
* Linked automatically via `pnpm` workspaces
* Import like:

```ts
import { formatDate } from "@repo/utils";
```

### **Publishing**

```bash
pnpm --filter @repo/utils build
pnpm --filter @repo/utils publish --access public
```

---

## 15. Git Workflow

* `main` → production-ready
* `dev` → integration branch
* `feature/*` → new features
* `fix/*` → bug fixes

**Commit Format**

```
feat(auth): add OAuth2 login
```

---

## 16. Security

* Never commit `.env`
* Validate all inputs
* Use HTTPS in production
* Use Helmet middleware for backend

---

## 17. Performance

* **Frontend**: Vite code splitting, lazy imports, memoization
* **Backend**: Cache heavy queries (Redis), use indexes in DB

---

## 18. Useful Commands

```bash
pnpm dev:web        # Frontend dev
pnpm dev:api        # Backend dev
pnpm build          # Build all
pnpm test           # Run tests
pnpm lint           # Lint code
pnpm format         # Format code
```

---

## 19. Resources

* Vite → [https://vitejs.dev](https://vitejs.dev)
* React → [https://react.dev](https://react.dev)
* Tailwind → [https://tailwindcss.com](https://tailwindcss.com)
* shadcn/ui → [https://ui.shadcn.com](https://ui.shadcn.com)
* Prisma → [https://www.prisma.io](https://www.prisma.io)
* Vitest → [https://vitest.dev](https://vitest.dev)
* Playwright → [https://playwright.dev](https://playwright.dev)

---

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.

## **Git Commit Policy**
ALWAYS commit changes after completing each task. Use meaningful commit messages following the format: `type(scope): description`. Examples:
- `feat(ui): add dark mode toggle`
- `fix(api): resolve authentication error`
- `refactor(utils): simplify date formatting`

Keep commit messages minimal and focused. Do not add "Generated with Claude Code" or co-author attribution.

After completing any task that involves file changes, immediately create a git commit with an appropriate message describing what was accomplished.
