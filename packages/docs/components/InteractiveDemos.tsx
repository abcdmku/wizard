import React, { useState, useEffect, useRef } from 'react';

// Enhanced Playground with syntax highlighting
export function CodePlayground({ 
  code, 
  title = "Playground",
  height = 400
}: {
  code: string;
  title?: string;
  height?: number;
}) {
  const [currentCode, setCurrentCode] = useState(code);
  const [output, setOutput] = useState<string>('');
  const [isDark, setIsDark] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
    return () => observer.disconnect();
  }, []);

  const runCode = () => {
    try {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => {
        logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
      };
      
      const func = new Function(currentCode);
      const result = func();
      
      console.log = originalLog;
      
      if (logs.length > 0) {
        setOutput(logs.join('\n'));
      } else if (result !== undefined) {
        setOutput(JSON.stringify(result, null, 2));
      } else {
        setOutput('Code executed successfully');
      }
    } catch (error: any) {
      setOutput(`Error: ${error.message}`);
    }
  };

  return (
    <div style={{
      margin: '2rem 0',
      borderRadius: '12px',
      border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        backgroundColor: isDark ? '#1a1a1a' : '#f9fafb',
        borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
      }}>
        <span style={{
          fontSize: '14px',
          fontWeight: 600,
          color: isDark ? '#e5e7eb' : '#111827',
        }}>
          {title}
        </span>
        <button
          onClick={runCode}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 500,
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            backgroundColor: '#3b82f6',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Run
        </button>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: output ? '1fr 1fr' : '1fr',
        height: `${height}px`,
      }}>
        <div style={{
          position: 'relative',
          backgroundColor: isDark ? '#0b0b0b' : '#f6f8fa',
        }}>
          <textarea
            ref={textareaRef}
            value={currentCode}
            onChange={(e) => setCurrentCode(e.target.value)}
            spellCheck={false}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              padding: '16px',
              backgroundColor: 'transparent',
              color: isDark ? '#d4d4d4' : '#24292e',
              border: 'none',
              outline: 'none',
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              fontSize: '13px',
              lineHeight: '1.6',
              resize: 'none',
              overflow: 'auto',
            }}
          />
        </div>
        {output && (
          <div style={{
            padding: '16px',
            backgroundColor: isDark ? '#111827' : '#f6f8fa',
            borderLeft: `1px solid ${isDark ? '#374151' : '#e1e4e8'}`,
            overflow: 'auto',
            position: 'relative',
          }}>
            <div style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#9ca3af',
              marginBottom: '12px',
            }}>
              Output:
            </div>
            <pre style={{
              margin: 0,
              color: isDark ? '#10b981' : '#0969da',
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              fontSize: '13px',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {output}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// Dynamic Step Branching Demo
export function StepBranchingDemo({ variant = 'full' }: { variant?: string }) {
  const [currentStep, setCurrentStep] = useState('userType');
  const [userType, setUserType] = useState<'individual' | 'business' | null>(null);
  const [stepData, setStepData] = useState<Record<string, any>>({});
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });
    return () => observer.disconnect();
  }, []);

  const getStepFlow = () => {
    if (!userType) return ['userType'];
    if (userType === 'individual') return ['userType', 'individual', 'payment'];
    return ['userType', 'business', 'taxInfo', 'payment'];
  };

  const stepFlow = getStepFlow();
  const currentIndex = stepFlow.indexOf(currentStep);

  const steps = {
    userType: { label: 'User Type', description: 'Choose account type' },
    individual: { label: 'Individual Info', description: 'Personal details' },
    business: { label: 'Business Info', description: 'Company registration' },
    taxInfo: { label: 'Tax Information', description: 'Tax ID required' },
    payment: { label: 'Payment', description: 'Payment method' }
  };

  const selectUserType = (type: 'individual' | 'business') => {
    setUserType(type);
    setCurrentStep(type);
    setStepData({ ...stepData, userType: type });
  };

  const goToStep = (step: string) => {
    // Save current step data before moving
    if (currentStep !== step) {
      setStepData({ ...stepData, [currentStep]: { completed: true } });
    }
    setCurrentStep(step);
  };

  const goBack = () => {
    if (currentIndex > 0) {
      goToStep(stepFlow[currentIndex - 1]);
    }
  };

  const goNext = () => {
    if (currentIndex < stepFlow.length - 1) {
      goToStep(stepFlow[currentIndex + 1]);
    }
  };

  const reset = () => {
    setCurrentStep('userType');
    setUserType(null);
    setStepData({});
  };

  return (
    <div style={{
      padding: '20px',
      borderRadius: '8px',
      border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
      backgroundColor: isDark ? 'rgba(17, 24, 39, 0.5)' : '#f9fafb',
    }}>
      {/* User Type Selection at Top */}
      <div style={{
        marginBottom: '20px',
        padding: '12px',
        backgroundColor: isDark ? 'rgba(31, 41, 55, 0.5)' : '#ffffff',
        borderRadius: '6px',
        border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: isDark ? '#e5e7eb' : '#111827' }}>
          Account Type:
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => selectUserType('individual')}
            style={{
              flex: 1,
              padding: '8px',
              borderRadius: '4px',
              fontSize: '12px',
              border: userType === 'individual' ? '2px solid #3b82f6' : `1px solid ${isDark ? '#4b5563' : '#e5e7eb'}`,
              backgroundColor: userType === 'individual' ? (isDark ? '#1e3a8a' : '#dbeafe') : (isDark ? '#1f2937' : '#ffffff'),
              color: userType === 'individual' ? '#3b82f6' : (isDark ? '#9ca3af' : '#6b7280'),
              cursor: 'pointer',
              fontWeight: userType === 'individual' ? 600 : 400,
            }}
          >
            👤 Individual
          </button>
          <button
            onClick={() => selectUserType('business')}
            style={{
              flex: 1,
              padding: '8px',
              borderRadius: '4px',
              fontSize: '12px',
              border: userType === 'business' ? '2px solid #3b82f6' : `1px solid ${isDark ? '#4b5563' : '#e5e7eb'}`,
              backgroundColor: userType === 'business' ? (isDark ? '#1e3a8a' : '#dbeafe') : (isDark ? '#1f2937' : '#ffffff'),
              color: userType === 'business' ? '#3b82f6' : (isDark ? '#9ca3af' : '#6b7280'),
              cursor: 'pointer',
              fontWeight: userType === 'business' ? 600 : 400,
            }}
          >
            🏢 Business
          </button>
        </div>
      </div>

      {/* Step Flow Visualization */}
      {userType && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {stepFlow.map((step, index) => (
              <React.Fragment key={step}>
                <div
                  onClick={() => index <= currentIndex && goToStep(step)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '16px',
                    fontSize: '11px',
                    fontWeight: currentStep === step ? 600 : 400,
                    backgroundColor: currentStep === step
                      ? '#3b82f6'
                      : stepData[step]?.completed || index < currentIndex
                        ? (isDark ? '#065f46' : '#10b981')
                        : (isDark ? '#1f2937' : '#f3f4f6'),
                    color: currentStep === step || stepData[step]?.completed || index < currentIndex
                      ? '#ffffff'
                      : (isDark ? '#9ca3af' : '#6b7280'),
                    cursor: index <= currentIndex ? 'pointer' : 'default',
                    transition: 'all 0.2s',
                  }}
                >
                  {steps[step as keyof typeof steps].label}
                </div>
                {index < stepFlow.length - 1 && (
                  <div style={{
                    width: '20px',
                    height: '2px',
                    backgroundColor: stepData[stepFlow[index + 1]]?.completed || currentIndex > index
                      ? '#3b82f6'
                      : (isDark ? '#374151' : '#e5e7eb'),
                  }} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Current Step Content */}
      <div style={{ marginBottom: '20px' }}>

        {!userType ? (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: isDark ? '#9ca3af' : '#6b7280',
            fontSize: '13px',
          }}>
            Please select an account type above to begin
          </div>
        ) : (
          <div style={{
            padding: '16px',
            backgroundColor: isDark ? 'rgba(31, 41, 55, 0.3)' : '#ffffff',
            borderRadius: '6px',
            border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
          }}>
            <h3 style={{
              margin: '0 0 8px 0',
              fontSize: '16px',
              fontWeight: 600,
              color: isDark ? '#e5e7eb' : '#111827'
            }}>
              {steps[currentStep as keyof typeof steps].label}
            </h3>
            <p style={{
              margin: '0 0 16px 0',
              fontSize: '13px',
              color: isDark ? '#9ca3af' : '#6b7280'
            }}>
              {steps[currentStep as keyof typeof steps].description}
            </p>

            {currentStep === 'userType' && (
              <div style={{ fontSize: '13px', color: isDark ? '#9ca3af' : '#6b7280' }}>
                You selected: <strong>{userType}</strong> account
              </div>
            )}

            {currentStep === 'individual' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <input
                  type="text"
                  placeholder="Full Name"
                  style={{
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
                    backgroundColor: isDark ? '#1f2937' : '#ffffff',
                    color: isDark ? '#e5e7eb' : '#111827',
                    fontSize: '13px',
                  }}
                  onChange={(e) => setStepData({ ...stepData, name: e.target.value })}
                />
                <input
                  type="email"
                  placeholder="Email Address"
                  style={{
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
                    backgroundColor: isDark ? '#1f2937' : '#ffffff',
                    color: isDark ? '#e5e7eb' : '#111827',
                    fontSize: '13px',
                  }}
                  onChange={(e) => setStepData({ ...stepData, email: e.target.value })}
                />
              </div>
            )}

            {currentStep === 'business' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <input
                  type="text"
                  placeholder="Company Name"
                  style={{
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
                    backgroundColor: isDark ? '#1f2937' : '#ffffff',
                    color: isDark ? '#e5e7eb' : '#111827',
                    fontSize: '13px',
                  }}
                  onChange={(e) => setStepData({ ...stepData, company: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Registration Number"
                  style={{
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
                    backgroundColor: isDark ? '#1f2937' : '#ffffff',
                    color: isDark ? '#e5e7eb' : '#111827',
                    fontSize: '13px',
                  }}
                  onChange={(e) => setStepData({ ...stepData, regNumber: e.target.value })}
                />
              </div>
            )}

            {currentStep === 'taxInfo' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <input
                  type="text"
                  placeholder="Tax ID Number"
                  style={{
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
                    backgroundColor: isDark ? '#1f2937' : '#ffffff',
                    color: isDark ? '#e5e7eb' : '#111827',
                    fontSize: '13px',
                    width: '100%',
                  }}
                  onChange={(e) => setStepData({ ...stepData, taxId: e.target.value })}
                />
                <select
                  style={{
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
                    backgroundColor: isDark ? '#1f2937' : '#ffffff',
                    color: isDark ? '#e5e7eb' : '#111827',
                    fontSize: '13px',
                  }}
                  onChange={(e) => setStepData({ ...stepData, taxType: e.target.value })}
                >
                  <option value="">Select tax type</option>
                  <option value="corporation">Corporation</option>
                  <option value="llc">LLC</option>
                  <option value="partnership">Partnership</option>
                </select>
              </div>
            )}

            {currentStep === 'payment' && (
              <div>
                <p style={{
                  fontSize: '13px',
                  color: isDark ? '#9ca3af' : '#6b7280',
                  marginBottom: '12px'
                }}>
                  Complete payment setup for your {userType} account
                </p>
                {Object.keys(stepData).length > 0 && (
                  <div style={{
                    backgroundColor: isDark ? '#1f2937' : '#f9fafb',
                    padding: '12px',
                    borderRadius: '4px',
                    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                  }}>
                    <pre style={{
                      fontSize: '11px',
                      color: isDark ? '#d1d5db' : '#4b5563',
                      margin: 0,
                      fontFamily: 'monospace',
                    }}>
                      {JSON.stringify(stepData, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Navigation Controls */}
      {userType && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <button
            onClick={reset}
            style={{
              padding: '8px 12px',
              fontSize: '12px',
              borderRadius: '4px',
              border: `1px solid ${isDark ? '#4b5563' : '#e5e7eb'}`,
              backgroundColor: 'transparent',
              color: isDark ? '#ef4444' : '#dc2626',
              cursor: 'pointer',
            }}
          >
            ↺ Start Over
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={goBack}
              disabled={currentIndex === 0}
              style={{
                padding: '8px 16px',
                fontSize: '12px',
                borderRadius: '4px',
                border: `1px solid ${isDark ? '#4b5563' : '#e5e7eb'}`,
                backgroundColor: isDark ? '#1f2937' : '#ffffff',
                color: currentIndex === 0
                  ? (isDark ? '#4b5563' : '#d1d5db')
                  : (isDark ? '#e5e7eb' : '#374151'),
                cursor: currentIndex === 0 ? 'not-allowed' : 'pointer',
                opacity: currentIndex === 0 ? 0.5 : 1,
              }}
            >
              ← Previous
            </button>

            <button
              onClick={goNext}
              disabled={currentIndex === stepFlow.length - 1}
              style={{
                padding: '8px 16px',
                fontSize: '12px',
                borderRadius: '4px',
                backgroundColor: currentIndex === stepFlow.length - 1 ? '#10b981' : '#3b82f6',
                color: '#ffffff',
                border: 'none',
                cursor: currentIndex === stepFlow.length - 1 ? 'not-allowed' : 'pointer',
                opacity: currentIndex === stepFlow.length - 1 ? 0.7 : 1,
              }}
            >
              {currentIndex === stepFlow.length - 1 ? '✓ Complete' : 'Continue →'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Auto-save Demo
export function AutoSaveDemo() {
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [state, setState] = useState({ step: 'user', data: {} });
  const [savedState, setSavedState] = useState<any>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (autoSaveEnabled) {
      const timer = setTimeout(() => {
        setSavedState(state);
        setLastSaved(new Date());
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [state, autoSaveEnabled]);

  return (
    <div style={{
      padding: '16px',
      borderRadius: '8px',
      border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
      backgroundColor: isDark ? 'rgba(17, 24, 39, 0.5)' : '#f9fafb',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: isDark ? '#e5e7eb' : '#111827' }}>
          Auto-save Status
        </div>
        <button
          onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 500,
            backgroundColor: autoSaveEnabled ? '#10b981' : (isDark ? '#374151' : '#e5e7eb'),
            color: autoSaveEnabled ? '#ffffff' : (isDark ? '#e5e7eb' : '#374151'),
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {autoSaveEnabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: autoSaveEnabled ? '#10b981' : '#6b7280',
          animation: autoSaveEnabled ? 'pulse 2s infinite' : 'none',
        }}></span>
        <span style={{ fontSize: '12px', color: isDark ? '#9ca3af' : '#6b7280' }}>
          {autoSaveEnabled ? 'Auto-saving enabled' : 'Auto-save disabled'}
        </span>
      </div>
      
      {lastSaved && (
        <div style={{ fontSize: '11px', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '12px' }}>
          Last saved: {lastSaved.toLocaleTimeString()}
        </div>
      )}
      
      <div style={{ marginTop: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '8px', color: isDark ? '#e5e7eb' : '#374151' }}>
          Edit State:
        </div>
        <input
          type="text"
          placeholder="Current step"
          value={state.step}
          onChange={(e) => setState({ ...state, step: e.target.value })}
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: '4px',
            border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
            backgroundColor: isDark ? '#1f2937' : '#ffffff',
            color: isDark ? '#e5e7eb' : '#111827',
            fontSize: '12px',
          }}
        />
      </div>
      
      {savedState && (
        <div style={{ marginTop: '12px', padding: '8px', backgroundColor: isDark ? '#1f2937' : '#ffffff', borderRadius: '4px' }}>
          <div style={{ fontSize: '11px', fontWeight: 500, marginBottom: '4px', color: isDark ? '#9ca3af' : '#6b7280' }}>
            Saved State:
          </div>
          <pre style={{ fontSize: '11px', margin: 0, color: isDark ? '#e5e7eb' : '#374151' }}>
            {JSON.stringify(savedState, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// Progress Tracking Demo
export function ProgressTrackingDemo() {
  const steps = ['User Info', 'Address', 'Payment', 'Review', 'Complete'];
  const [currentStepIndex, setCurrentStepIndex] = useState(2);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
    return () => observer.disconnect();
  }, []);

  const progress = (currentStepIndex / (steps.length - 1)) * 100;

  return (
    <div style={{
      padding: '16px',
      borderRadius: '8px',
      border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
      backgroundColor: isDark ? 'rgba(17, 24, 39, 0.5)' : '#f9fafb',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '12px' }}>
        <span>Step {currentStepIndex + 1} of {steps.length}</span>
        <span>{Math.round(progress)}% Complete (Step {currentStepIndex}/{steps.length - 1})</span>
      </div>
      
      <div style={{ width: '100%', height: '8px', backgroundColor: isDark ? '#374151' : '#e5e7eb', borderRadius: '4px', overflow: 'hidden', marginBottom: '16px' }}>
        <div style={{
          width: `${progress}%`,
          height: '100%',
          backgroundColor: '#3b82f6',
          transition: 'width 0.3s ease',
        }}></div>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        {steps.map((step, i) => (
          <div
            key={step}
            onClick={() => setCurrentStepIndex(i)}
            style={{
              fontSize: '10px',
              color: i <= currentStepIndex ? '#3b82f6' : (isDark ? '#6b7280' : '#9ca3af'),
              fontWeight: i === currentStepIndex ? 600 : 400,
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              backgroundColor: i === currentStepIndex ? (isDark ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.05)') : 'transparent',
            }}
          >
            {step}
          </div>
        ))}
      </div>
      
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => setCurrentStepIndex(Math.max(0, currentStepIndex - 1))}
          disabled={currentStepIndex === 0}
          style={{
            flex: 1,
            padding: '6px 12px',
            fontSize: '12px',
            borderRadius: '4px',
            border: `1px solid ${isDark ? '#4b5563' : '#e5e7eb'}`,
            backgroundColor: isDark ? '#1f2937' : '#ffffff',
            color: isDark ? '#9ca3af' : '#6b7280',
            cursor: currentStepIndex === 0 ? 'not-allowed' : 'pointer',
            opacity: currentStepIndex === 0 ? 0.5 : 1,
          }}
        >
          Previous
        </button>
        <button
          onClick={() => setCurrentStepIndex(Math.min(steps.length - 1, currentStepIndex + 1))}
          disabled={currentStepIndex === steps.length - 1}
          style={{
            flex: 1,
            padding: '6px 12px',
            fontSize: '12px',
            borderRadius: '4px',
            backgroundColor: currentStepIndex === steps.length - 1 ? '#10b981' : '#3b82f6',
            color: '#ffffff',
            border: 'none',
            cursor: currentStepIndex === steps.length - 1 ? 'not-allowed' : 'pointer',
            opacity: currentStepIndex === steps.length - 1 ? 0.7 : 1,
          }}
        >
          {currentStepIndex === steps.length - 1 ? 'Completed' : 'Next'}
        </button>
      </div>
    </div>
  );
}

// Async Data Loading Demo
export function AsyncLoadingDemo() {
  const [loading, setLoading] = useState(false);
  const [loadTime, setLoadTime] = useState(3);
  const [currentStep, setCurrentStep] = useState('shipping');
  const [data, setData] = useState<any>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
    return () => observer.disconnect();
  }, []);

  const startLoading = () => {
    setLoading(true);
    setData(null);
    
    setTimeout(() => {
      setData({
        options: ['Standard Shipping - $5', 'Express Shipping - $15', 'Overnight - $30']
      });
      setCurrentStep('payment');
      setLoading(false);
    }, loadTime * 1000);
  };

  return (
    <div style={{
      padding: '16px',
      borderRadius: '8px',
      border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
      backgroundColor: isDark ? 'rgba(17, 24, 39, 0.5)' : '#f9fafb',
    }}>
      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '12px', color: isDark ? '#9ca3af' : '#6b7280', display: 'block', marginBottom: '4px' }}>
          Load time (seconds):
        </label>
        <input
          type="number"
          min="1"
          max="10"
          value={loadTime}
          onChange={(e) => setLoadTime(Number(e.target.value))}
          style={{
            padding: '4px 8px',
            borderRadius: '4px',
            border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
            backgroundColor: isDark ? '#1f2937' : '#ffffff',
            color: isDark ? '#e5e7eb' : '#111827',
            fontSize: '12px',
            width: '80px',
          }}
        />
      </div>
      
      <div style={{ fontSize: '12px', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '12px' }}>
        Current Step: <strong>{currentStep}</strong>
      </div>
      
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <div style={{
            width: '16px',
            height: '16px',
            border: `2px solid ${isDark ? '#4b5563' : '#e5e7eb'}`,
            borderTop: '2px solid #3b82f6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }}></div>
          <span style={{ fontSize: '13px', color: isDark ? '#9ca3af' : '#6b7280' }}>
            Loading shipping options...
          </span>
        </div>
      ) : data ? (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '8px', color: isDark ? '#e5e7eb' : '#374151' }}>
            Shipping Options Loaded:
          </div>
          {data.options.map((option: string, i: number) => (
            <div key={i} style={{ fontSize: '11px', padding: '4px 8px', color: isDark ? '#9ca3af' : '#6b7280' }}>
              • {option}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: '12px', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '16px' }}>
          Click "Load Data" to fetch shipping options
        </div>
      )}
      
      <button
        onClick={startLoading}
        disabled={loading}
        style={{
          padding: '8px 16px',
          fontSize: '12px',
          borderRadius: '6px',
          backgroundColor: loading ? (isDark ? '#374151' : '#e5e7eb') : '#3b82f6',
          color: loading ? (isDark ? '#9ca3af' : '#6b7280') : '#ffffff',
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Loading...' : 'Load Data & Continue'}
      </button>
    </div>
  );
}

// Router Demo
export function RouterDemo() {
  const [currentUrl, setCurrentUrl] = useState('/wizard/user');
  const [history, setHistory] = useState(['/wizard/user']);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
    return () => observer.disconnect();
  }, []);

  const routes = [
    '/wizard/user',
    '/wizard/address',
    '/wizard/payment',
    '/wizard/review',
    '/wizard/complete'
  ];

  const navigate = (url: string) => {
    setCurrentUrl(url);
    setHistory([...history, url]);
  };

  const goBack = () => {
    if (history.length > 1) {
      const newHistory = [...history];
      newHistory.pop();
      setCurrentUrl(newHistory[newHistory.length - 1]);
      setHistory(newHistory);
    }
  };

  return (
    <div style={{
      padding: '16px',
      borderRadius: '8px',
      border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
      backgroundColor: isDark ? 'rgba(17, 24, 39, 0.5)' : '#f9fafb',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px',
        backgroundColor: isDark ? '#1f2937' : '#ffffff',
        borderRadius: '6px',
        marginBottom: '16px',
      }}>
        <button
          onClick={goBack}
          disabled={history.length <= 1}
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            borderRadius: '4px',
            border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
            backgroundColor: isDark ? '#374151' : '#f3f4f6',
            color: isDark ? '#9ca3af' : '#6b7280',
            cursor: history.length <= 1 ? 'not-allowed' : 'pointer',
            opacity: history.length <= 1 ? 0.5 : 1,
          }}
        >
          ← Back
        </button>
        <div style={{
          flex: 1,
          padding: '4px 8px',
          fontSize: '12px',
          fontFamily: 'monospace',
          color: isDark ? '#e5e7eb' : '#374151',
          backgroundColor: isDark ? '#111827' : '#f9fafb',
          borderRadius: '4px',
        }}>
          {currentUrl}
        </div>
      </div>
      
      <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '8px', color: isDark ? '#e5e7eb' : '#374151' }}>
        Navigate to:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {routes.map((route) => (
          <button
            key={route}
            onClick={() => navigate(route)}
            style={{
              padding: '6px 10px',
              fontSize: '11px',
              textAlign: 'left',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: currentUrl === route 
                ? '#3b82f6' 
                : (isDark ? '#1f2937' : '#ffffff'),
              color: currentUrl === route 
                ? '#ffffff' 
                : (isDark ? '#9ca3af' : '#6b7280'),
              cursor: 'pointer',
            }}
          >
            {route}
          </button>
        ))}
      </div>
      
      <div style={{ marginTop: '16px', fontSize: '11px', color: isDark ? '#9ca3af' : '#6b7280' }}>
        History: {history.length} pages visited
      </div>
    </div>
  );
}

// Step Timeout Demo
export function StepTimeoutDemo() {
  const [duration, setDuration] = useState(30); // Default 30 seconds
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [isRunning, setIsRunning] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isRunning && timeRemaining > 0) {
      intervalRef.current = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            setIsRunning(false);
            alert('Session timeout!');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, timeRemaining]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const reset = () => {
    setTimeRemaining(duration);
    setIsRunning(false);
  };

  const updateDuration = (seconds: number) => {
    setDuration(seconds);
    setTimeRemaining(seconds);
    setIsRunning(false);
  };

  return (
    <div style={{
      padding: '16px',
      borderRadius: '8px',
      border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
      backgroundColor: isDark ? 'rgba(17, 24, 39, 0.5)' : '#f9fafb',
    }}>
      {/* Duration Selector */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '8px' }}>
          Select timeout duration:
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {[5, 10, 15, 20, 25].map((seconds) => (
            <button
              key={seconds}
              onClick={() => updateDuration(seconds)}
              style={{
                flex: 1,
                padding: '6px',
                fontSize: '11px',
                borderRadius: '4px',
                border: duration === seconds ? '2px solid #3b82f6' : `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
                backgroundColor: duration === seconds 
                  ? (isDark ? '#1e3a8a' : '#dbeafe') 
                  : (isDark ? '#1f2937' : '#ffffff'),
                color: duration === seconds 
                  ? '#3b82f6' 
                  : (isDark ? '#9ca3af' : '#6b7280'),
                cursor: 'pointer',
                fontWeight: duration === seconds ? 600 : 400,
              }}
            >
              {seconds}s
            </button>
          ))}
        </div>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: isDark ? '#9ca3af' : '#6b7280' }}>Time remaining:</span>
          <span style={{
            fontSize: '16px',
            fontWeight: 600,
            color: timeRemaining <= duration * 0.2 ? '#ef4444' : timeRemaining <= duration * 0.4 ? '#f59e0b' : '#10b981',
          }}>
            {formatTime(timeRemaining)}
          </span>
        </div>
        <div style={{ fontSize: '11px', color: isDark ? '#9ca3af' : '#6b7280' }}>
          Payment step timeout
        </div>
      </div>
      
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => setIsRunning(!isRunning)}
          style={{
            flex: 1,
            padding: '6px 12px',
            fontSize: '12px',
            borderRadius: '4px',
            backgroundColor: isRunning ? '#ef4444' : '#3b82f6',
            color: '#ffffff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {isRunning ? 'Pause' : 'Start'}
        </button>
        <button
          onClick={reset}
          style={{
            flex: 1,
            padding: '6px 12px',
            fontSize: '12px',
            borderRadius: '4px',
            border: `1px solid ${isDark ? '#4b5563' : '#e5e7eb'}`,
            backgroundColor: isDark ? '#1f2937' : '#ffffff',
            color: isDark ? '#9ca3af' : '#6b7280',
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
      </div>
      
      {timeRemaining <= duration * 0.2 && timeRemaining > 0 && (
        <div style={{
          marginTop: '12px',
          padding: '8px',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#ef4444',
        }}>
          ⚠️ Less than {Math.ceil(duration * 0.2)} seconds remaining!
        </div>
      )}
    </div>
  );
}

// Analytics Demo
export function AnalyticsDemo() {
  const [events, setEvents] = useState<Array<{ time: string; event: string; data: any }>>([]);
  const [currentStep, setCurrentStep] = useState('user');
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
    return () => observer.disconnect();
  }, []);

  const trackEvent = (event: string, data: any) => {
    const newEvent = {
      time: new Date().toLocaleTimeString(),
      event,
      data
    };
    setEvents((prev) => [...prev, newEvent].slice(-5)); // Keep last 5 events
  };

  const steps = ['user', 'address', 'payment', 'complete'];

  return (
    <div style={{
      padding: '16px',
      borderRadius: '8px',
      border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
      backgroundColor: isDark ? 'rgba(17, 24, 39, 0.5)' : '#f9fafb',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '12px', color: isDark ? '#e5e7eb' : '#374151' }}>
            Trigger Events:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <select
              value={currentStep}
              onChange={(e) => {
                const oldStep = currentStep;
                const newStep = e.target.value;
                setCurrentStep(newStep);
                trackEvent('wizard_step_viewed', { step: newStep, from: oldStep });
              }}
              style={{
                padding: '6px',
                fontSize: '11px',
                borderRadius: '4px',
                border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
                backgroundColor: isDark ? '#1f2937' : '#ffffff',
                color: isDark ? '#e5e7eb' : '#111827',
              }}
            >
              {steps.map((step) => (
                <option key={step} value={step}>{step}</option>
              ))}
            </select>
            
            <button
              onClick={() => trackEvent('wizard_validation_error', { 
                step: currentStep, 
                error: 'Required field missing' 
              })}
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                borderRadius: '4px',
                backgroundColor: '#ef4444',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Trigger Error
            </button>
            
            <button
              onClick={() => trackEvent('wizard_completed', { 
                steps: ['user', 'address', 'payment'] 
              })}
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                borderRadius: '4px',
                backgroundColor: '#10b981',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Complete Wizard
            </button>
          </div>
        </div>
        
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '12px', color: isDark ? '#e5e7eb' : '#374151' }}>
            Event Console:
          </div>
          <div style={{
            height: '150px',
            overflowY: 'auto',
            padding: '8px',
            backgroundColor: isDark ? '#111827' : '#f6f8fa',
            borderRadius: '4px',
            fontSize: '10px',
            fontFamily: 'monospace',
          }}>
            {events.length === 0 ? (
              <div style={{ color: isDark ? '#6b7280' : '#57606a' }}>No events yet...</div>
            ) : (
              events.map((event, i) => (
                <div key={i} style={{ marginBottom: '8px', color: isDark ? '#10b981' : '#0969da' }}>
                  <div style={{ color: isDark ? '#6b7280' : '#57606a' }}>[{event.time}]</div>
                  <div>{event.event}</div>
                  <div style={{ color: isDark ? '#60a5fa' : '#0969da', marginLeft: '8px' }}>
                    {JSON.stringify(event.data)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

<style jsx>{`
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
`}</style>