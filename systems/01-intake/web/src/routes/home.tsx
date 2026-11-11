import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { seedDemo } from '../api/intake-client'
import { errorMessage } from '../app/errors'
import { Alert, Button, Card, InputField, SectionHeader } from '../components'
import { useCreateApplication } from '../hooks/use-intake-api'

export function HomePage() {
  const navigate = useNavigate()
  const [applicantName, setApplicantName] = useState('Maya Chen')
  const create = useCreateApplication()
  const seed = useMutation({ mutationFn: () => seedDemo() })

  function startApplication() {
    create.mutate(
      { applicantName },
      {
        onSuccess: (application) => {
          void navigate({
            to: '/apply/$applicationId/$step',
            params: { applicationId: application.id, step: 'consent' },
          })
        },
      },
    )
  }

  function openReviewerDemo() {
    seed.mutate(undefined, {
      onSuccess: () => {
        void navigate({ to: '/reviewer' })
      },
    })
  }

  return (
    <div className="portal-page">
      <SectionHeader
        as="h1"
        eyebrow="Local program demo"
        title="Small-business recovery grant"
        description="Apply for funding or review a seeded queue. The local API adds demo access automatically, so there is no sign-in screen."
      />
      <Alert tone="info" title="Demo account hints">
        <p>
          Applicant: <code>intake-applicant-demo</code>. Reviewer: <code>intake-reviewer-demo</code>
          . Tenant: <code>demo-grants</code>.
        </p>
      </Alert>
      <div className="page-grid">
        <Card tone="accent">
          <SectionHeader
            title="Start as an applicant"
            description="Use the seeded name or enter another demo applicant. Your work is saved after every step."
          />
          <InputField
            label="Applicant name"
            required
            autoComplete="name"
            value={applicantName}
            onChange={(event) => setApplicantName(event.target.value)}
          />
          {create.error ? (
            <Alert tone="danger" title="We couldn't start the application">
              {errorMessage(create.error)}
            </Alert>
          ) : null}
          <div className="action-bar">
            <Button
              loading={create.isPending}
              loadingLabel="Starting application..."
              onClick={startApplication}
              disabled={applicantName.trim().length < 2}
            >
              Start application
            </Button>
          </div>
        </Card>
        <Card>
          <SectionHeader
            title="Open the reviewer queue"
            description="Seed a manual-review application, then inspect projected applicant data and record a decision."
          />
          <dl className="definition-list definition-list--1">
            <div className="definition-list__item">
              <dt>Demo role</dt>
              <dd>Grant reviewer</dd>
            </div>
            <div className="definition-list__item">
              <dt>Queue</dt>
              <dd>One seeded application waiting for a reviewer decision</dd>
            </div>
          </dl>
          {seed.error ? (
            <Alert tone="danger" title="We couldn't seed the review queue">
              {errorMessage(seed.error)}
            </Alert>
          ) : null}
          <div className="action-bar">
            <Button
              variant="secondary"
              loading={seed.isPending}
              loadingLabel="Seeding queue..."
              onClick={openReviewerDemo}
            >
              Seed and open reviewer demo
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
