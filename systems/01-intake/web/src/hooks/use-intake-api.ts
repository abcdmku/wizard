import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type {
  ApplicationCommand,
  ApplicationStatus,
  ApplicationView,
  CommandResponse,
  ReviewerCommand,
} from '../../../shared'
import { type EventStreamStatus, subscribeToApplicationEvents } from '../api/events'
import {
  createApplication,
  getApplication,
  getReviewerApplication,
  listReviewerApplications,
  sendApplicationCommand,
  sendReviewerCommand,
} from '../api/intake-client'

export const applicationKeys = {
  all: ['intake', 'applications'] as const,
  detail: (applicationId: string) => ['intake', 'applications', applicationId] as const,
  reviewerAll: ['intake', 'reviewer', 'applications'] as const,
  reviewerDetail: (applicationId: string) =>
    ['intake', 'reviewer', 'applications', applicationId] as const,
}

const REVIEWER_REFRESH_INTERVAL_MS = 500
const terminalReviewerStatuses: ReadonlySet<ApplicationStatus> = new Set([
  'approved',
  'rejected',
  'cancelled',
])

export function reviewerRefreshInterval(status: ApplicationStatus | undefined): number | false {
  if (status === undefined || terminalReviewerStatuses.has(status)) return false
  return REVIEWER_REFRESH_INTERVAL_MS
}

function requireAccepted(response: CommandResponse): CommandResponse {
  if (response.ok) return response
  const issue = response.issues?.map((item) => item.message).join(' ')
  throw new Error(issue ?? `The server did not accept this change (${response.code}).`)
}

export function useCreateApplication() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof createApplication>[0]) => createApplication(input),
    onSuccess: (application) => {
      queryClient.setQueryData(applicationKeys.detail(application.id), application)
    },
  })
}

export function useApplication(applicationId: string) {
  return useQuery({
    queryKey: applicationKeys.detail(applicationId),
    queryFn: () => getApplication(applicationId),
  })
}

export function useApplicationCommand(applicationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (command: ApplicationCommand) =>
      requireAccepted(await sendApplicationCommand(applicationId, command)),
    onSuccess: async (response) => {
      if (response.application) {
        queryClient.setQueryData(applicationKeys.detail(applicationId), response.application)
      }
      await queryClient.invalidateQueries({ queryKey: applicationKeys.detail(applicationId) })
    },
  })
}

export function useApplicationEvents(applicationId: string) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<EventStreamStatus>('connecting')
  const [error, setError] = useState<Error>()

  useEffect(() => {
    const subscription = subscribeToApplicationEvents(applicationId, {
      onError: setError,
      onEvent: ({ data }) => {
        if (data.type === 'heartbeat') return
        queryClient.setQueryData(applicationKeys.detail(applicationId), data.data)
        setError(undefined)
      },
      onStatusChange: setStatus,
    })
    return () => subscription.close()
  }, [applicationId, queryClient])

  return { error, status }
}

export function useReviewerQueue() {
  return useQuery({
    queryKey: applicationKeys.reviewerAll,
    queryFn: () => listReviewerApplications(),
  })
}

export function useReviewerApplication(applicationId: string) {
  return useQuery({
    queryKey: applicationKeys.reviewerDetail(applicationId),
    queryFn: () => getReviewerApplication(applicationId),
    refetchInterval: (query) => reviewerRefreshInterval(query.state.data?.status),
  })
}

export function useReviewerCommand(applicationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (command: ReviewerCommand) =>
      requireAccepted(await sendReviewerCommand(applicationId, command)),
    onSuccess: async (response) => {
      if (response.application) {
        queryClient.setQueryData(
          applicationKeys.reviewerDetail(applicationId),
          response.application,
        )
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: applicationKeys.reviewerAll }),
        queryClient.invalidateQueries({
          queryKey: applicationKeys.reviewerDetail(applicationId),
        }),
      ])
    },
  })
}

export function visibleApplicationName(application: ApplicationView): string {
  return application.workflow.context.legalName ?? application.applicantName
}
