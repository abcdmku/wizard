import { useNavigate } from '@tanstack/react-router'

import type { ApplicationView, CommandResponse, IntakeViewStepId } from '../../../shared'
import {
  currentApplicantStep,
  goCommand,
  inputCommand,
  navigationCommand,
} from '../domain/application'
import type { ApplicantStep } from '../domain/steps'
import { useApplication, useApplicationCommand, useApplicationEvents } from './use-intake-api'

export function useApplicationFlow(applicationId: string) {
  const navigate = useNavigate()
  const applicationQuery = useApplication(applicationId)
  const command = useApplicationCommand(applicationId)
  const stream = useApplicationEvents(applicationId)

  function navigateTo(step: ApplicantStep, replace = false) {
    return navigate({
      to: '/apply/$applicationId/$step',
      params: { applicationId, step },
      replace,
    })
  }

  async function responseApplication(response: CommandResponse): Promise<ApplicationView> {
    if (response.application) return response.application
    const refreshed = await applicationQuery.refetch()
    if (refreshed.data) return refreshed.data
    throw new Error('The application changed, but the latest view was not returned.')
  }

  async function follow(response: CommandResponse): Promise<ApplicationView> {
    const application = await responseApplication(response)
    await navigateTo(currentApplicantStep(application))
    return application
  }

  async function saveAndContinue(
    step: IntakeViewStepId,
    values: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const application = applicationQuery.data
    if (!application) throw new Error('The application is not loaded.')
    const saved = await command.mutateAsync(inputCommand(application, step, values))
    const savedApplication = await responseApplication(saved)
    await follow(await command.mutateAsync(navigationCommand(savedApplication, 'next')))
  }

  async function goBack(): Promise<void> {
    const application = applicationQuery.data
    if (!application) return
    if (application.workflow.current === 'consent') {
      await navigate({ to: '/' })
      return
    }
    await follow(await command.mutateAsync(navigationCommand(application, 'back')))
  }

  async function edit(step: IntakeViewStepId): Promise<void> {
    const application = applicationQuery.data
    if (!application) return
    await follow(await command.mutateAsync(goCommand(application, step)))
  }

  return {
    applicationQuery,
    command,
    edit,
    goBack,
    navigateTo,
    saveAndContinue,
    stream,
  }
}
