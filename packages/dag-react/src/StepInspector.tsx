import * as React from 'react';

type Props = {
  info: any | null;
  onClose?: () => void;
};

export function StepInspector({ info, onClose }: Props) {
  if (!info) return null;
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
      <div className="wiz-inspector-grid">
        <div>
          <div className="wiz-inspector-label">Properties</div>
          <div className="wiz-inspector-kv"><span>Required</span><span>{info.required !== false ? 'Yes' : 'No'}</span></div>
          <div className="wiz-inspector-kv"><span>Hidden</span><span>{info.hidden ? 'Yes' : 'No'}</span></div>
          <div className="wiz-inspector-kv"><span>Component</span><span>{info.component ? 'Present' : 'None'}</span></div>
        </div>
        <div>
          <div className="wiz-inspector-label">Callbacks</div>
          <div className="wiz-inspector-kv"><span>validate</span><span>{info.has?.validate ? 'Yes' : 'No'}</span></div>
          <div className="wiz-inspector-kv"><span>canEnter</span><span>{info.has?.canEnter ? 'Yes' : 'No'}</span></div>
          <div className="wiz-inspector-kv"><span>canExit</span><span>{info.has?.canExit ? 'Yes' : 'No'}</span></div>
          <div className="wiz-inspector-kv"><span>beforeEnter</span><span>{info.has?.beforeEnter ? 'Yes' : 'No'}</span></div>
          <div className="wiz-inspector-kv"><span>beforeExit</span><span>{info.has?.beforeExit ? 'Yes' : 'No'}</span></div>
        </div>
      </div>
      <div className="wiz-inspector-section">
        <div className="wiz-inspector-label">Next (static)</div>
        <div className="wiz-badges">
          {Array.isArray(info.next) && info.next.length > 0 ? (
            info.next.map((n: string) => <span key={n} className="wiz-badge">{n}</span>)
          ) : (
            <span className="wiz-subtle">None or dynamic</span>
          )}
        </div>
      </div>
      {Array.isArray(info.prerequisites) && (
        <div className="wiz-inspector-section">
          <div className="wiz-inspector-label">Prerequisites</div>
          <div className="wiz-badges">
            {info.prerequisites.map((p: string) => <span key={p} className="wiz-badge">{p}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

