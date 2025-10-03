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
    markerEnd,
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
  const strokeWidth = (style as any)?.strokeWidth ?? (data?.kind === 'prerequisite' ? 2.5 : 3);
  const dash = data?.kind === 'prerequisite' ? '6 4' : undefined;

  // Compute arrow position slightly before the target so it's not hidden under the node
  const vx = targetX - sourceX;
  const vy = targetY - sourceY;
  const len = Math.max(1, Math.hypot(vx, vy));
  const ux = vx / len;
  const uy = vy / len;
  const arrowOffset = 18; // px back from node edge
  const arrowX = targetX - ux * arrowOffset;
  const arrowY = targetY - uy * arrowOffset;
  const angle = Math.atan2(vy, vx) * (180 / Math.PI);
  const arrowSize = 12;

  return (
    <g>
      <BaseEdge id={id} path={path} style={{ stroke, strokeWidth, strokeDasharray: dash }} />
      {/* Keep SVG arrow for fallback rendering (under nodes) */}
      <g transform={`translate(${arrowX}, ${arrowY}) rotate(${angle})`} style={{ pointerEvents: 'none' }}>
        <polygon points={`0,-${arrowSize/2} ${arrowSize},0 0,${arrowSize/2}`} fill={stroke} />
      </g>
      {/* Overlay arrow rendered above nodes so it's always visible */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${arrowX}px, ${arrowY}px) rotate(${angle}deg)`,
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <svg width={arrowSize + 2} height={arrowSize + 2} viewBox={`0 0 ${arrowSize + 2} ${arrowSize + 2}`} style={{ display: 'block' }}>
            <polygon
              points={`1,1 ${arrowSize+1},${(arrowSize+2)/2} 1,${arrowSize+1}`}
              fill={stroke}
            />
          </svg>
        </div>
        {label && (
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
        )}
      </EdgeLabelRenderer>
    </g>
  );
}
