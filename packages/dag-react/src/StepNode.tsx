import * as React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

export function StepNode({ data, selected }: NodeProps<{ label: string; info?: any }>) {
  const info = data?.info ?? {};
  return (
    <>
      {/* Handles on all 4 sides to allow flexible edge routing */}
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="target" position={Position.Bottom} id="b" />
      <Handle type="target" position={Position.Left} id="l" />
      <Handle type="target" position={Position.Right} id="r" />

      <Handle type="source" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Left} id="l" />
      <Handle type="source" position={Position.Right} id="r" />

      <div className="wiz-node-card" data-selected={selected ? 'true' : 'false'}>
        <div className="wiz-node-head">
          <span className="wiz-node-id">{info.id}</span>
          {info.required === false && <span className="wiz-chip">optional</span>}
          {info.hidden && <span className="wiz-chip muted">hidden</span>}
        </div>
        <div className="wiz-node-title">{data?.label ?? info.label ?? info.id}</div>
        <div className="wiz-node-flags">
          {info.has?.validate && <span className="wiz-flag green">validate</span>}
          {info.has?.canEnter && <span className="wiz-flag blue">guard</span>}
          {info.has?.dynamicNext && <span className="wiz-flag purple">dynamic next</span>}
          {Array.isArray(info?.next) && info.next.length > 0 && (
            <span className="wiz-flag">next: {info.next.length}</span>
          )}
        </div>
      </div>
    </>
  );
}

