import * as React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow';

export function WizEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    label,
    data,
  } = props;

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.25,
  });

  const stroke = (style as any)?.stroke ?? (data?.kind === 'prerequisite' ? 'var(--wiz-warn)' : 'var(--wiz-edge)');
  const strokeWidth = (style as any)?.strokeWidth ?? (data?.kind === 'prerequisite' ? 1 : 1.5);
  const dash = data?.kind === 'prerequisite' ? '6 4' : undefined;

  // Create unique marker ID for this edge's arrow
  const markerId = `arrow-${id}`;

  return (
    <>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M 0 2 L 10 5 L 0 8 z" fill={stroke} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke, strokeWidth, strokeDasharray: dash }}
        markerEnd={`url(#${markerId})`}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 1,
            }}
            className="wiz-edge-label"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
