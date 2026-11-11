import { classNames } from './classNames'

export interface ProgressStep {
  id: string
  label: string
  description?: string
}

export interface ProgressStepperProps {
  steps: readonly ProgressStep[]
  currentStep: number | string
  className?: string
  label?: string
}

export function ProgressStepper({
  steps,
  currentStep,
  className,
  label = 'Application progress',
}: ProgressStepperProps) {
  const requestedIndex =
    typeof currentStep === 'number'
      ? currentStep
      : steps.findIndex((step) => step.id === currentStep)
  const currentIndex = Math.max(0, Math.min(steps.length - 1, requestedIndex))

  if (steps.length === 0) {
    return null
  }

  return (
    <nav className={classNames('stepper', className)} aria-label={label}>
      <ol className="stepper__list">
        {steps.map((step, index) => {
          const state =
            index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming'
          return (
            <li className="stepper__item" data-state={state} key={step.id}>
              <div className="stepper__rail" aria-hidden="true">
                <span className="stepper__marker">
                  {state === 'complete' ? '\u2713' : index + 1}
                </span>
              </div>
              <div
                className="stepper__copy"
                aria-current={state === 'current' ? 'step' : undefined}
              >
                <span className="stepper__label">{step.label}</span>
                {step.description ? (
                  <span className="stepper__description">{step.description}</span>
                ) : null}
                {state === 'complete' ? <span className="sr-only">Complete</span> : null}
              </div>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
