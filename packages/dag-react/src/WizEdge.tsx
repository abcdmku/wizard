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
    source,
    target,
  } = props;

  const stroke = (style as any)?.stroke ?? (data?.kind === 'prerequisite' ? 'var(--wiz-warn)' : 'var(--wiz-edge)');
  const strokeWidth = (style as any)?.strokeWidth ?? (data?.kind === 'prerequisite' ? 1 : 1.5);
  const dash = data?.kind === 'prerequisite' ? '6 4' : undefined;

  // Create unique marker ID for this edge's arrow
  const markerId = `arrow-${id}`;

  // Detect self-loop (source === target)
  const isSelfLoop = source === target;

  let path: string;
  let labelX: number;
  let labelY: number;

  if (isSelfLoop) {
    // Create a loop that goes around the node
    const loopSize = 60; // Size of the loop
    const loopOffset = 30; // Offset from the node center

    // Position loop to the right of the node
    const startX = sourceX + loopOffset;
    const startY = sourceY;

    // Create a circular path using cubic bezier curves
    path = `
      M ${startX},${startY}
      C ${startX + loopSize},${startY - loopSize * 0.5}
        ${startX + loopSize},${startY + loopSize * 0.5}
        ${startX},${startY + loopSize}
      C ${startX - loopSize * 0.3},${startY + loopSize}
        ${startX - loopSize * 0.3},${startY}
        ${startX - 5},${startY}
    `.trim().replace(/\s+/g, ' ');

    // Position label at the top of the loop
    labelX = startX + loopSize / 2;
    labelY = startY - loopSize / 2;
  } else {
    // Detect same-side connections (top-to-top or bottom-to-bottom)
    const isSameSide = sourcePosition === targetPosition;

    if (isSameSide && (sourcePosition === 'top' || sourcePosition === 'bottom')) {
      // Same-side top/bottom connections - create bull nose shaped arc
      const arcDepth = 45; // Shallower arc to stay closer to red line but not too tall
      const isBottom = sourcePosition === 'bottom';
      const midX = (sourceX + targetX) / 2;
      const midY = (sourceY + targetY) / 2;
      const distance = Math.abs(targetX - sourceX);

      // Bull nose shape: smooth radius at corners, flat section in middle
      const cornerRadius = distance * 0.35; // Smooth rounded corners
      const flatOffset = distance * 0.15; // Width of flat section

      // Calculate points for bull nose shape
      const baseY = isBottom ? sourceY : sourceY;
      const arcY = isBottom ? baseY + arcDepth : baseY - arcDepth;

      const startCornerX = sourceX + (targetX > sourceX ? cornerRadius : -cornerRadius);
      const endCornerX = targetX - (targetX > sourceX ? cornerRadius : -cornerRadius);
      const flatStartX = sourceX + (targetX > sourceX ? flatOffset : -flatOffset);
      const flatEndX = targetX - (targetX > sourceX ? flatOffset : -flatOffset);

      // Create bull nose path with all rounded corners
      // Define corner transition points
      const cornerTransition = arcDepth * 0.5; // Smooth transition distance
      const startVerticalY = isBottom ? sourceY + (arcDepth - cornerTransition) : sourceY - (arcDepth - cornerTransition);
      const endVerticalY = isBottom ? targetY + (arcDepth - cornerTransition) : targetY - (arcDepth - cornerTransition);

      path = `M ${sourceX},${sourceY}
              L ${sourceX},${startVerticalY}
              Q ${sourceX},${arcY} ${startCornerX},${arcY}
              Q ${flatStartX},${arcY} ${flatStartX},${arcY}
              L ${flatEndX},${arcY}
              Q ${endCornerX},${arcY} ${targetX},${arcY}
              Q ${targetX},${arcY} ${targetX},${endVerticalY}
              L ${targetX},${targetY}`;

      labelX = midX;
      labelY = isBottom ? midY + arcDepth * 0.75 : midY - arcDepth * 0.75;
    } else {
      // Determine if using vertical connections (top/bottom)
      const isVertical = sourcePosition === 'top' || sourcePosition === 'bottom' ||
                         targetPosition === 'top' || targetPosition === 'bottom';

      // For vertical connections, use higher curvature to create arc
      // For bidirectional edges, use different curvature to separate them
      let curvature: number;
      if (isVertical) {
        // Different-side vertical connections
        curvature = source < target ? 0.6 : 0.8;
      } else {
        // Horizontal connections
        curvature = source < target ? 0.25 : 0.5;
      }

      [path, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        curvature,
      });
    }
  }

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
