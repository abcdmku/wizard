import * as React from 'react';
import { WizardDagViewer } from '@wizard/dag-react';
import '@wizard/dag-react/styles.css';
// Import step definitions from examples for adapters
import { steps as basicSteps } from '../../basic-form-wizard/src/wizard/steps';
import { steps as branchingSteps } from '../../advanced-branching/src/wizard/config';
// For the router example, avoid importing its components to keep demo isolated.
// Provide a minimal representative shape for the DAG.
const routerSteps: Record<string, any> = {
  account: { next: ['shipping'], meta: { label: 'Account' } },
  shipping: { next: ['payment'], meta: { label: 'Shipping' } },
  payment: { next: ['review'], meta: { label: 'Payment' } },
  review: { next: [], meta: { label: 'Review' } },
};

export function App() {
  const [theme, setTheme] = React.useState<'light'|'dark'|'system'>('system');
  const [active, setActive] = React.useState<string | undefined>(undefined);
  const [dataset, setDataset] = React.useState<'basic'|'branching'|'router'>('basic');

  const steps = React.useMemo(() => {
    if (dataset === 'basic') return basicSteps as Record<string, any>;
    if (dataset === 'branching') return branchingSteps as Record<string, any>;
    return routerSteps as Record<string, any>;
  }, [dataset]);

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100%', background: 'var(--wiz-bg)', color: 'var(--wiz-text)' }}>
      <div style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontWeight: 700 }}>Wizard DAG Visualizer</span>
        <select value={dataset} onChange={(e) => setDataset(e.target.value as any)} className="wiz-btn">
          <option value="basic">Basic Form</option>
          <option value="branching">Advanced Branching</option>
          <option value="router">React Router</option>
        </select>
        <span style={{ marginLeft: 'auto' }}>
          <select value={theme} onChange={(e) => setTheme(e.target.value as any)} className="wiz-btn">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </span>
      </div>
      <div style={{ height: '100%', width: '100%' }}>
        <WizardDagViewer
          steps={steps}
          probes={dataset === 'branching' ? [
            { context: { role: 'admin' }, dataByStep: { roleSelection: { role: 'admin' } } },
            { context: { role: 'manager' }, dataByStep: { roleSelection: { role: 'manager' } } },
            { context: { role: 'user' }, dataByStep: { roleSelection: { role: 'user' } } },
          ] : undefined}
          theme={theme}
          activeNodeId={active}
          onNodeSelect={setActive}
        />
      </div>
    </div>
  );
}
