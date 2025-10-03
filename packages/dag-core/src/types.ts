import { z } from 'zod';

export type NodeKind = 'step' | 'start' | 'end' | 'group';
export type EdgeKind = 'transition' | 'prerequisite';

export type WizardNode = {
  id: string;
  label?: string;
  kind?: NodeKind;
  tags?: readonly string[];
  meta?: Record<string, unknown> & {
    info?: StepInfo;
  };
  fileRef?: { path: string; line?: number; column?: number };
};

export type WizardEdge = {
  id: string;
  source: string;
  target: string;
  kind?: EdgeKind;
  label?: string;
  guard?: string;
  meta?: Record<string, unknown>;
};

export type WizardGraph = {
  nodes: WizardNode[];
  edges: WizardEdge[];
  groups?: { id: string; label?: string; nodeIds: string[] }[];
};

export const WizardNodeSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  kind: z.union([z.literal('step'), z.literal('start'), z.literal('end'), z.literal('group')]).optional(),
  tags: z.array(z.string()).optional(),
  meta: z.record(z.unknown()).optional(),
  fileRef: z.object({ path: z.string(), line: z.number().optional(), column: z.number().optional() }).optional(),
});

export const WizardEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  kind: z.union([z.literal('transition'), z.literal('prerequisite')]).optional(),
  label: z.string().optional(),
  guard: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const WizardGraphSchema = z.object({
  nodes: z.array(WizardNodeSchema),
  edges: z.array(WizardEdgeSchema),
  groups: z.array(z.object({ id: z.string(), label: z.string().optional(), nodeIds: z.array(z.string()) })).optional(),
});

export type LayoutResult = {
  width: number;
  height: number;
  nodes: { id: string; x: number; y: number; width?: number; height?: number }[];
  edges: { id: string; points?: { x: number; y: number }[] }[];
};

export type LayoutStrategy = (graph: WizardGraph) => Promise<LayoutResult>;

export type StepInfo = {
  id: string;
  label?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  tags?: string[];
  component?: boolean;
  has: {
    validate: boolean;
    beforeEnter: boolean;
    beforeExit: boolean;
    canEnter: boolean;
    canExit: boolean;
    complete: boolean;
    dynamicNext: boolean;
  };
  next?: string[]; // static nexts if known
  prerequisites?: string[];
};

export type StepsToGraphProbe = {
  context?: any;
  dataByStep?: Record<string, any>;
};
