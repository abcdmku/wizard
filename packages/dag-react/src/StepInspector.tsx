import * as React from 'react';
import type { WizardGraph } from '@wizard/dag-core';

type Props = {
  info: { info: any; nodeId: string; graph: WizardGraph } | null;
  onClose?: () => void;
};

export function StepInspector({ info: data, onClose }: Props) {
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

  // Collect all badges for the combined section
  const badges = [];
  if (isEntryPoint) badges.push({ key: 'entry', label: 'Entry Point', className: 'green', clickable: false });
  if (isHub) badges.push({ key: 'hub', label: 'Hub Node', className: 'golden', clickable: false });
  if (info.required !== false) badges.push({ key: 'required', label: 'Required', className: '', clickable: false });
  if (info.hidden) badges.push({ key: 'hidden', label: 'Hidden', className: 'muted', clickable: false });
  if (info.component) badges.push({ key: 'component', label: 'Has Component', className: '', clickable: false });
  if (info.has?.validate) badges.push({ key: 'validate', label: 'Validate', className: 'green', clickable: true, code: info.validate });
  if (info.has?.canEnter) badges.push({ key: 'canEnter', label: 'Entry Guard', className: 'blue', clickable: true, code: info.canEnter });
  if (info.has?.canExit) badges.push({ key: 'canExit', label: 'Exit Guard', className: 'blue', clickable: true, code: info.canExit });
  if (info.has?.beforeEnter) badges.push({ key: 'beforeEnter', label: 'Before Enter', className: 'purple', clickable: true, code: info.beforeEnter });
  if (info.has?.beforeExit) badges.push({ key: 'beforeExit', label: 'Before Exit', className: 'purple', clickable: true, code: info.beforeExit });
  if (info.has?.dynamicNext) badges.push({ key: 'dynamicNext', label: 'Dynamic Next', className: 'gold', clickable: true, code: info.next });
  if (Array.isArray(info.tags)) {
    info.tags.forEach((tag: string) => badges.push({ key: `tag-${tag}`, label: tag, className: 'tag', clickable: false }));
  }

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

      {/* Combined Badges Section */}
      {badges.length > 0 && (
        <div className="wiz-inspector-section">
          <div className="wiz-section-title">🏷️ Attributes</div>
          <div className="wiz-badges">
            {badges.map((badge) => (
              <React.Fragment key={badge.key}>
                <span
                  className={`wiz-badge ${badge.className} ${badge.clickable ? 'clickable' : ''}`}
                  onClick={badge.clickable ? () => toggleCode(badge.key) : undefined}
                  style={badge.clickable ? { cursor: 'pointer' } : undefined}
                >
                  {badge.label}
                  {badge.clickable && <span style={{ marginLeft: '4px' }}>{expandedCode.has(badge.key) ? '▼' : '▶'}</span>}
                </span>
                {badge.clickable && expandedCode.has(badge.key) && badge.code && (
                  <div className="wiz-code-block">
                    <pre><code>{typeof badge.code === 'function' ? badge.code.toString() : String(badge.code)}</code></pre>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

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

