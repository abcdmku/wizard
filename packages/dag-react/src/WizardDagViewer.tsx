import * as React from 'react';
import ReactFlow, { Background, Controls, MiniMap, useEdgesState, useNodesState, Panel, Edge, Node } from 'reactflow';
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
  const [hoveredNodeId, setHoveredNodeId] = React.useState<string | null>(null);
  const isDraggingRef = React.useRef(false);
  const graph = React.useMemo(
    () => inputGraph ?? (steps ? stepsToGraph(steps, { probes }) : { nodes: [], edges: [] }),
    [inputGraph, steps, probes]
  );

  React.useEffect(() => {
    let cancelled = false;
    const elk = new ELK();

    async function layout() {
      setLoading(true);

      // Build adjacency list for BFS
      const adjacency = new Map<string, string[]>();
      // Exclude prerequisite and any-transition edges from layout calculation
      const transitionEdges = graph.edges.filter(e => e.kind !== 'prerequisite' && e.kind !== 'any-transition');

      for (const node of graph.nodes) {
        adjacency.set(node.id, []);
      }

      for (const edge of transitionEdges) {
        adjacency.get(edge.source)?.push(edge.target);
      }

      // Detect entry points: nodes with no incoming edges
      const incomingEdges = new Set<string>();
      for (const edge of transitionEdges) {
        incomingEdges.add(edge.target);
      }
      const entryPoints = graph.nodes.filter(n => !incomingEdges.has(n.id));

      // Calculate minimum distance from any entry point using BFS
      const distances = new Map<string, number>();
      const queue: Array<{node: string, dist: number}> = [];

      for (const entry of entryPoints) {
        queue.push({ node: entry.id, dist: 0 });
        distances.set(entry.id, 0);
      }

      while (queue.length > 0) {
        const { node, dist } = queue.shift()!;
        const currentDist = distances.get(node) ?? Infinity;

        if (dist > currentDist) continue;

        for (const neighbor of adjacency.get(node) ?? []) {
          const newDist = dist + 1;
          const neighborDist = distances.get(neighbor) ?? Infinity;

          if (newDist < neighborDist) {
            distances.set(neighbor, newDist);
            queue.push({ node: neighbor, dist: newDist });
          }
        }
      }

      // Detect back edges (edges that go from higher distance to lower/equal distance)
      const backEdges = new Set<string>();
      for (const edge of transitionEdges) {
        const sourceDist = distances.get(edge.source) ?? Infinity;
        const targetDist = distances.get(edge.target) ?? Infinity;

        if (sourceDist >= targetDist) {
          backEdges.add(edge.id);
        }
      }

      // Detect isolated nodes (nodes with no edges)
      const connectedNodes = new Set<string>();
      for (const edge of transitionEdges) {
        connectedNodes.add(edge.source);
        connectedNodes.add(edge.target);
      }
      const isolatedNodes = graph.nodes.filter(n => !connectedNodes.has(n.id));

      const elkGraph: any = {
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.layered.spacing.nodeNodeBetweenLayers': 150,
          'elk.spacing.nodeNode': 80,
          'elk.spacing.edgeNode': 60,
          'elk.spacing.edgeEdge': 30,
          'elk.edgeRouting': 'SPLINES',
          'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
          'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
          'elk.portConstraints': 'FIXED_SIDE', // Prefer standard sides (E/W for horizontal flow)
          'elk.port.borderOffset': 0, // Center ports on sides
        },
        children: graph.nodes.map((n) => {
          return {
            id: n.id,
            width: 200,
            height: 68,
            layoutOptions: {
              'elk.portConstraints': 'FIXED_SIDE',
            },
          };
        }),
        // Exclude back edges from layout to break cycles
        edges: transitionEdges
          .filter((e) => !backEdges.has(e.id))
          .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      };

      let result: any;
      try {
        result = await elk.layout(elkGraph);
      } catch {
        result = { children: [], edges: [], width: 0, height: 0 };
      }

      if (cancelled) return;

      // Calculate position for isolated nodes (place them in a column to the right)
      const maxX = result.children?.reduce((max: number, child: any) => Math.max(max, child.x + 200), 0) ?? 0;
      const isolatedYStart = 100;
      const isolatedYSpacing = 100;

      const rfNodes: Node[] = graph.nodes.map((n) => {
        const pos = result.children?.find((p: any) => p.id === n.id);
        const isIsolated = isolatedNodes.some(iso => iso.id === n.id);

        let position;
        if (pos) {
          // Node was positioned by ELK
          position = { x: pos.x, y: pos.y };
        } else if (isIsolated) {
          // Isolated node - position it to the right in a column
          const isolatedIndex = isolatedNodes.findIndex(iso => iso.id === n.id);
          position = {
            x: maxX + 250,
            y: isolatedYStart + (isolatedIndex * isolatedYSpacing)
          };
        } else {
          // Fallback
          position = { x: 0, y: 0 };
        }

        return {
          id: n.id,
          type: 'step',
          position,
          data: { label: n.label ?? n.id, info: (n.meta as any)?.info },
          draggable: true,
          selectable: true,
          // Remove fixed positions to allow edges from all sides
          className: clsx('wiz-node'),
        } as Node;
      });

      // Calculate optimal edge positions based on node positions
      const rfEdges: Edge[] = graph.edges.map((e) => {
        const sourceNode = rfNodes.find(n => n.id === e.source);
        const targetNode = rfNodes.find(n => n.id === e.target);

        let sourcePosition: 'left' | 'right' | 'top' | 'bottom' = 'right';
        let targetPosition: 'left' | 'right' | 'top' | 'bottom' = 'left';

        if (sourceNode && targetNode) {
          const dx = targetNode.position.x - sourceNode.position.x;
          const dy = targetNode.position.y - sourceNode.position.y;

          // If edge goes backwards (target is to the left), use vertical routing
          if (dx < -50) {
            // Target is to the left of source, use same-side vertical handles
            // Prefer bottom first, then top based on which is closer
            if (dy > 20) {
              // Target is below source (higher y value) - use bottom to bottom
              sourcePosition = 'bottom';
              targetPosition = 'bottom';
            } else if (dy < -20) {
              // Target is above source (lower y value) - use top to top
              sourcePosition = 'top';
              targetPosition = 'top';
            } else {
              // About same height - prefer bottom to bottom
              sourcePosition = 'bottom';
              targetPosition = 'bottom';
            }
          } else {
            // Normal forward flow or vertical, use horizontal routing
            const absX = Math.abs(dx);
            const absY = Math.abs(dy);

            // Prefer horizontal unless heavily vertical
            if (absY > absX * 1.5) {
              // Heavily vertical - use top/bottom
              sourcePosition = dy >= 0 ? 'bottom' : 'top';
              targetPosition = dy >= 0 ? 'top' : 'bottom';
            } else {
              // Horizontal or diagonal - use left/right
              sourcePosition = 'right';
              targetPosition = 'left';
            }
          }
        }

        // Determine edge style based on kind
        let edgeStyle: any;
        let edgeClass = '';

        if (e.kind === 'prerequisite') {
          edgeStyle = { stroke: 'var(--wiz-warn)', strokeDasharray: '6 4', opacity: 1, strokeWidth: 2 };
        } else if (e.kind === 'any-transition') {
          edgeStyle = { stroke: 'var(--wiz-warn)', strokeWidth: 1.5, opacity: 0.15 };
          edgeClass = 'wiz-any-edge';
        } else {
          edgeStyle = { stroke: 'var(--wiz-edge)', strokeWidth: 2 };
        }

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: sourcePosition.charAt(0),
          targetHandle: targetPosition.charAt(0),
          type: 'wiz',
          animated: false,
          label: e.label,
          data: { kind: e.kind, sourceId: e.source },
          style: edgeStyle,
          className: edgeClass,
          labelStyle: { fill: 'var(--wiz-subtle)', fontWeight: 500 },
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 6,
          labelBgStyle: { fill: 'var(--wiz-surface)', stroke: 'var(--wiz-border)' },
        } as Edge;
      });

      setNodes(rfNodes);
      setEdges(rfEdges);
      setLoading(false);
    }

    layout();
    return () => { cancelled = true; };
  }, [graph]);

  React.useEffect(() => {
    const highlightedNodeId = activeNodeId || hoveredNodeId;

    // Update node className for highlighting
    setNodes((nds) => nds.map((n) => ({
      ...n,
      className: clsx('wiz-node', n.id === highlightedNodeId && 'highlighted')
    })));

    // Update edge className for any-edges highlighting
    setEdges((eds) => {
      return eds.map((e) => {
        // Check if this is an any-transition edge
        if ((e.data as any)?.kind === 'any-transition') {
          const isHighlighted = highlightedNodeId && (e.data as any)?.sourceId === highlightedNodeId;
          return {
            ...e,
            className: isHighlighted ? 'wiz-any-edge highlighted' : 'wiz-any-edge'
          };
        }
        return e;
      });
    });
  }, [activeNodeId, hoveredNodeId, setNodes, setEdges]);

  const onNodeClick = React.useCallback((_: any, node: Node) => {
    // Prevent click during drag
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }
    onNodeSelect?.(node?.id ?? null);
    const info = (node?.data as any)?.info ?? null;
    setSelectedInfo(info);
  }, [onNodeSelect]);

  const onNodeDragStart = React.useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const onNodeDragStop = React.useCallback(() => {
    // Keep dragging flag true until after click event
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 50);
  }, []);

  const onNodeMouseEnter = React.useCallback((_: any, node: Node) => {
    if (!isDraggingRef.current) {
      setHoveredNodeId(node.id);
    }
  }, []);

  const onNodeMouseLeave = React.useCallback(() => {
    setHoveredNodeId(null);
  }, []);

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
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
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

