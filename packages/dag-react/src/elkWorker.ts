/* eslint-disable no-restricted-globals */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { WizardGraph } from '@wizard/dag-core';

const elk = new ELK();

export type ElkWorkerRequest = { graph: WizardGraph };
export type ElkWorkerResponse = {
  width: number;
  height: number;
  nodes: { id: string; x: number; y: number; width?: number; height?: number }[];
  edges: { id: string; points?: { x: number; y: number }[] }[];
};

// @ts-ignore
self.onmessage = async (evt: MessageEvent<ElkWorkerRequest>) => {
  const { graph } = evt.data;

  const elkGraph: any = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': 40,
      'elk.spacing.nodeNode': 24,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layers.nodes.fromScratch': true,
    },
    children: graph.nodes.map((n) => ({ id: n.id, width: 220, height: 72 })),
    edges: graph.edges
      .filter((e) => e.kind !== 'prerequisite')
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  try {
    const res: any = await elk.layout(elkGraph);
    const nodes = res.children?.map((c: any) => ({ id: c.id, x: c.x, y: c.y, width: c.width, height: c.height })) ?? [];
    const edges = (res.edges ?? []).map((e: any) => ({ id: e.id, points: e.sections?.[0]?.bendPoints ?? e.sections?.[0]?.startPoint ? [e.sections[0].startPoint, ...(e.sections?.[0]?.bendPoints ?? []), e.sections[0].endPoint] : undefined }));
    const payload: ElkWorkerResponse = { width: res.width ?? 0, height: res.height ?? 0, nodes, edges };
    // @ts-ignore
    self.postMessage(payload);
  } catch (err) {
    // @ts-ignore
    self.postMessage({ width: 0, height: 0, nodes: [], edges: [] } satisfies ElkWorkerResponse);
  }
};

