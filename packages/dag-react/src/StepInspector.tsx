import * as React from 'react';
import type { WizardGraph } from '@wizard/dag-core';

type Props = {
  info: { info: any; nodeId: string; graph: WizardGraph } | null;
  onClose?: () => void;
};

export function StepInspector({ info: data, onClose }: Props) {
  if (!data) return null;

  const { info, nodeId, graph } = data;

  // Compute outgoing edges
  const outgoingEdges = React.useMemo(() => {
    return graph.edges.filter(e => e.source === nodeId);
  }, [graph.edges, nodeId]);

  // Compute incoming edges
  const incomingEdges = React.useMemo(() => {
    return graph.edges.filter(e => e.target === nodeId);
  }, [graph.edges, nodeId]);

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
          {isEntryPoint && (
            <div className="wiz-stat-item full-width">
              <span className="wiz-badge green">Entry Point</span>
            </div>
          )}
          {isHub && (
            <div className="wiz-stat-item full-width">
              <span className="wiz-badge golden">Hub Node</span>
            </div>
          )}
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

      {/* Guards & Validations */}
      <div className="wiz-inspector-section">
        <div className="wiz-section-title">🛡️ Guards & Validations</div>
        <div className="wiz-guard-list">
          {info.has?.validate && <div className="wiz-guard-item"><span className="wiz-guard-icon green">✓</span> Validation function</div>}
          {info.has?.canEnter && <div className="wiz-guard-item"><span className="wiz-guard-icon blue">◆</span> Entry guard</div>}
          {info.has?.canExit && <div className="wiz-guard-item"><span className="wiz-guard-icon blue">◆</span> Exit guard</div>}
          {info.has?.beforeEnter && <div className="wiz-guard-item"><span className="wiz-guard-icon purple">→</span> Before enter hook</div>}
          {info.has?.beforeExit && <div className="wiz-guard-item"><span className="wiz-guard-icon purple">←</span> Before exit hook</div>}
          {info.has?.dynamicNext && <div className="wiz-guard-item"><span className="wiz-guard-icon gold">⚡</span> Dynamic next function</div>}
          {!info.has?.validate && !info.has?.canEnter && !info.has?.canExit && !info.has?.beforeEnter && !info.has?.beforeExit && !info.has?.dynamicNext && (
            <span className="wiz-subtle">No guards or validations</span>
          )}
        </div>
      </div>

      {/* Tags Section */}
      {Array.isArray(info.tags) && info.tags.length > 0 && (
        <div className="wiz-inspector-section">
          <div className="wiz-section-title">🏷️ Tags</div>
          <div className="wiz-badges">
            {info.tags.map((tag: string) => <span key={tag} className="wiz-badge tag">{tag}</span>)}
          </div>
        </div>
      )}

      {/* Properties Section */}
      <div className="wiz-inspector-section">
        <div className="wiz-section-title">⚙️ Properties</div>
        <div className="wiz-inspector-kv"><span>Required</span><span>{info.required !== false ? 'Yes' : 'No'}</span></div>
        <div className="wiz-inspector-kv"><span>Hidden</span><span>{info.hidden ? 'Yes' : 'No'}</span></div>
        <div className="wiz-inspector-kv"><span>Component</span><span>{info.component ? 'Present' : 'None'}</span></div>
      </div>
    </div>
  );
}

