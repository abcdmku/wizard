import * as React from 'react';
import ReactFlow, { Background, Controls, MiniMap, useEdgesState, useNodesState, Panel, Edge, Node, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import type { WizardGraph } from '@wizard/dag-core';
import clsx from 'clsx';
import ELK from 'elkjs/lib/elk.bundled.js';
import { StepNode } from './StepNode';
import { StepInspector } from './StepInspector';
import { stepsToGraph } from '@wizard/dag-core';
import { WizEdge } from './WizEdge';

type Props = {
  graph?: WizardGraph;
  steps?: Record<string, any>;
  probes?: Array<{ context?: any; dataByStep?: Record<string, any> }>;
  theme?: 'light' | 'dark' | 'system';
  activeNodeId?: string;
  onNodeSelect?: (id: string | null) => void;
  className?: string;
};

export function WizardDagViewer({ graph: inputGraph, steps, probes, theme = 'system', activeNodeId, onNodeSelect, className }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = React.useState(true);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [selectedInfo, setSelectedInfo] = React.useState<any | null>(null);
  const graph = React.useMemo(
    () => inputGraph ?? (steps ? stepsToGraph(steps, { probes }) : { nodes: [], edges: [] }),
    [inputGraph, steps, probes]
  );

  React.useEffect(() => {
    let cancelled = false;
    const elk = new ELK();

    async function layout() {
      setLoading(true);
      const elkGraph: any = {
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.layered.spacing.nodeNodeBetweenLayers': 150, // Increased for curved edges
          'elk.spacing.nodeNode': 80,  // More vertical space between nodes in same layer
          'elk.spacing.edgeNode': 60,  // More space between edges and nodes
          'elk.spacing.edgeEdge': 30,  // More space between edges
          'elk.edgeRouting': 'SPLINES', // Use splines instead of orthogonal for better curve handling
          'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX', // Better positioning for complex graphs
        },
        children: graph.nodes.map((n) => ({ id: n.id, width: 200, height: 68 })),
        edges: graph.edges
          .filter((e) => e.kind !== 'prerequisite')
          .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      };

      let result: any;
      try {
        result = await elk.layout(elkGraph);
      } catch {
        result = { children: [], edges: [], width: 0, height: 0 };
      }

      if (cancelled) return;

      const rfNodes: Node[] = graph.nodes.map((n) => {
        const pos = result.children?.find((p: any) => p.id === n.id);
        return {
          id: n.id,
          type: 'step',
          position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
          data: { label: n.label ?? n.id, info: (n.meta as any)?.info },
          draggable: false,
          selectable: true,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          className: clsx('wiz-node'),
        } as Node;
      });

      const rfEdges: Edge[] = graph.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'wiz',
          animated: false,
          label: e.label,
          data: { kind: e.kind },
          style: e.kind === 'prerequisite'
            ? { stroke: 'var(--wiz-warn)', strokeDasharray: '6 4', opacity: 1, strokeWidth: 2.5 }
            : { stroke: 'var(--wiz-edge)', strokeWidth: 3 },
          labelStyle: { fill: 'var(--wiz-subtle)', fontWeight: 500 },
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 6,
          labelBgStyle: { fill: 'var(--wiz-surface)', stroke: 'var(--wiz-border)' },
        } as Edge));

      setNodes(rfNodes);
      setEdges(rfEdges);
      setLoading(false);
    }

    layout();
    return () => { cancelled = true; };
  }, [graph]);

  React.useEffect(() => {
    if (!activeNodeId) return;
    setNodes((nds) => nds.map((n) => ({ ...n, style: n.id === activeNodeId ? { outline: '2px solid var(--wiz-accent)' } : undefined })));
  }, [activeNodeId, setNodes]);

  const onNodeClick = React.useCallback((_: any, node: Node) => {
    onNodeSelect?.(node?.id ?? null);
    const info = (node?.data as any)?.info ?? null;
    setSelectedInfo(info);
  }, [onNodeSelect]);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const nodeTypes = React.useMemo(() => ({ step: StepNode }), []);
  const edgeTypes = React.useMemo(() => ({ wiz: WizEdge }), []);

  return (
    <div ref={rootRef} data-theme={theme === 'system' ? undefined : theme} className={clsx('wiz-shell', className)} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        fitView
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        className="wiz-flow"
      >
        <Background color="var(--wiz-border)" gap={24} />
        <MiniMap className="wiz-minimap" pannable zoomable nodeColor={() => 'var(--wiz-accent)'} />
        <Controls />
        <Panel position="top-left">
          <div className="wiz-toolbar">
            <span className="wiz-title">Wizard DAG</span>
            {loading && <span className="wiz-badge">layout…</span>}
          </div>
        </Panel>
      </ReactFlow>
      <StepInspector info={selectedInfo} onClose={() => setSelectedInfo(null)} />
    </div>
  );
}

