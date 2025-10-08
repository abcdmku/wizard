import * as React from 'react';
import type { WizardGraph } from '@wizard/dag-core';
import { CodeViewer } from './CodeViewer';

type Props = {
  info: { info: any; nodeId: string; graph: WizardGraph } | null;
  onClose?: () => void;
  width?: number;
};

export function StepInspector({ info: data, onClose, width = 400 }: Props) {
  const [expandedCode, setExpandedCode] = React.useState<Set<string>>(new Set());

  // Compute outgoing edges
  const outgoingEdges = React.useMemo(() => {
    if (!data) return [];
    return data.graph.edges.filter(e => e.source === data.nodeId);
  }, [data]);

  // Compute incoming edges
  const incomingEdges = React.useMemo(() => {
    if (!data) return [];
    return data.graph.edges.filter(e => e.target === data.nodeId);
  }, [data]);

  if (!data) return null;

  const { info, nodeId, graph } = data;

  // Separate by edge kind
  const nextSteps = outgoingEdges.filter(e => e.kind === 'transition' || e.kind === 'any-transition');
  const incomingSteps = incomingEdges.filter(e => e.kind === 'transition' || e.kind === 'any-transition');
  const prerequisites = incomingEdges.filter(e => e.kind === 'prerequisite');

  // Get unique target IDs for next steps
  const nextStepIds = Array.from(new Set(nextSteps.map(e => e.target)));
  const incomingStepIds = Array.from(new Set(incomingSteps.map(e => e.source)));

  // Check if this is a hub node (any-transition)
  const isHub = nextSteps.some(e => e.kind === 'any-transition');

  // Statistics
  const outDegree = nextStepIds.length;
  const inDegree = incomingStepIds.length;
  const isEntryPoint = inDegree === 0 && prerequisites.length === 0;

  const toggleCode = (key: string) => {
    setExpandedCode(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Define all possible attributes
  const allAttributes = [
    { key: 'entry', label: 'Entry Point', active: isEntryPoint, className: 'green', clickable: false },
    { key: 'hub', label: 'Hub Node', active: isHub, className: 'golden', clickable: false },
    { key: 'required', label: 'Required', active: info.required !== false, className: '', clickable: false },
    { key: 'hidden', label: 'Hidden', active: !!info.hidden, className: 'muted', clickable: false },
    { key: 'component', label: 'Has Component', active: !!info.component, className: '', clickable: false },
    { key: 'validate', label: 'Validate', active: !!info.has?.validate, className: 'green', clickable: true, code: info.validate },
    { key: 'canEnter', label: 'Can Enter Guard', active: !!info.has?.canEnter, className: 'blue', clickable: true, code: info.canEnter },
    { key: 'canExit', label: 'Can Exit Guard', active: !!info.has?.canExit, className: 'blue', clickable: true, code: info.canExit },
    { key: 'beforeEnter', label: 'Before Enter Hook', active: !!info.has?.beforeEnter, className: 'purple', clickable: true, code: info.beforeEnter },
    { key: 'beforeExit', label: 'Before Exit Hook', active: !!info.has?.beforeExit, className: 'purple', clickable: true, code: info.beforeExit },
    { key: 'dynamicNext', label: 'Dynamic Next', active: !!info.has?.dynamicNext, className: 'gold', clickable: true, code: info.next },
  ];

  // Add tags as separate attributes
  const tagAttributes = Array.isArray(info.tags)
    ? info.tags.map((tag: string) => ({ key: `tag-${tag}`, label: `Tag: ${tag}`, active: true, className: 'tag', clickable: false }))
    : [];

  return (
    <div className="wiz-inspector">
      <div className="wiz-inspector-head">
        <div>
          <div className="wiz-inspector-title">{info.label ?? info.id}</div>
          <div className="wiz-inspector-sub">{info.id}</div>
        </div>
        <button className="wiz-btn" onClick={onClose}>Close</button>
      </div>

      {info.description && <p className="wiz-inspector-desc">{info.description}</p>}

      {/* Attributes Section - Vertical List */}
      <div className="wiz-inspector-section">
        <div className="wiz-section-title">🏷️ Attributes</div>
        <div className="wiz-attr-list">
          {[...allAttributes, ...tagAttributes].map((attr) => (
            <React.Fragment key={attr.key}>
              <div
                className={`wiz-attr-item ${attr.active ? 'active' : 'inactive'} ${attr.clickable && attr.active ? 'clickable' : ''}`}
                onClick={attr.clickable && attr.active ? () => toggleCode(attr.key) : undefined}
              >
                <div className="wiz-attr-label">
                  <span className={`wiz-attr-indicator ${attr.active ? attr.className : ''}`}>
                    {attr.active ? '●' : '○'}
                  </span>
                  <span className="wiz-attr-name">{attr.label}</span>
                </div>
                {attr.clickable && attr.active && (
                  <span className="wiz-attr-expand">{expandedCode.has(attr.key) ? '▼' : '▶'}</span>
                )}
              </div>
              {attr.clickable && attr.active && expandedCode.has(attr.key) && attr.code && (
                <CodeViewer code={attr.code} language="typescript" />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Statistics Section */}
      <div className="wiz-inspector-section">
        <div className="wiz-section-title">📊 Statistics</div>
        <div className="wiz-stat-grid">
          <div className="wiz-stat-item">
            <span className="wiz-stat-label">Can navigate to</span>
            <span className="wiz-stat-value">{outDegree} {outDegree === 1 ? 'step' : 'steps'}</span>
          </div>
          <div className="wiz-stat-item">
            <span className="wiz-stat-label">Reachable from</span>
            <span className="wiz-stat-value">{inDegree} {inDegree === 1 ? 'step' : 'steps'}</span>
          </div>
        </div>
      </div>

      {/* Next Steps Section */}
      <div className="wiz-inspector-section">
        <div className="wiz-section-title">➡️ Next Steps {outDegree > 0 && `(${outDegree})`}</div>
        <div className="wiz-badges">
          {nextStepIds.length > 0 ? (
            nextStepIds.map((id) => <span key={id} className="wiz-badge">{id}</span>)
          ) : (
            <span className="wiz-subtle">No outgoing connections</span>
          )}
        </div>
      </div>

      {/* Incoming Steps Section */}
      <div className="wiz-inspector-section">
        <div className="wiz-section-title">⬅️ Reachable From {inDegree > 0 && `(${inDegree})`}</div>
        <div className="wiz-badges">
          {incomingStepIds.length > 0 ? (
            incomingStepIds.map((id) => <span key={id} className="wiz-badge">{id}</span>)
          ) : (
            <span className="wiz-subtle">No incoming connections</span>
          )}
        </div>
      </div>

      {/* Prerequisites Section */}
      {prerequisites.length > 0 && (
        <div className="wiz-inspector-section">
          <div className="wiz-section-title">🔒 Prerequisites ({prerequisites.length})</div>
          <div className="wiz-badges">
            {prerequisites.map((e) => <span key={e.id} className="wiz-badge warn">{e.source}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

