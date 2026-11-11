import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import {
  ApplicationCommandSchema,
  ApplicationViewSchema,
  CommandResponseSchema,
  CreateApplicationRequestSchema,
  DemoActionResponseSchema,
  HealthResponseSchema,
  ReviewerCommandSchema,
  ReviewerQueueSchema,
} from '../../shared/api-contract.js'
import { requireDemoScope } from './auth.js'
import { errorBody, normalizeHttpError, statusForCommand } from './errors.js'
import { IntakeStreamRegistry, openApplicationStream } from './sse.js'
import type { IntakeHttpPluginOptions } from './types.js'
import { ApplicationParamsSchema, parseRequest } from './validation.js'

function sendCommand(reply: FastifyReply, value: unknown): void {
  const response = CommandResponseSchema.parse(value)
  reply.code(statusForCommand(response)).send(response)
}

export const intakeHttpRoutes: FastifyPluginAsync<IntakeHttpPluginOptions> = async (
  app,
  options,
) => {
  const streams = new IntakeStreamRegistry()
  if (
    options.heartbeatMs !== undefined &&
    (!Number.isSafeInteger(options.heartbeatMs) || options.heartbeatMs <= 0)
  ) {
    throw new TypeError('heartbeatMs must be a positive integer')
  }

  app.setErrorHandler((error, _request, reply) => {
    const failure = normalizeHttpError(error)
    if (failure.statusCode === 401) reply.header('WWW-Authenticate', 'Bearer')
    reply.code(failure.statusCode).send(errorBody(failure))
  })
  app.addHook('onClose', async () => streams.closeAll())

  app.get('/health', async () =>
    HealthResponseSchema.parse({ ok: true, service: 'intake-api', database: 'ready' }),
  )

  app.post('/api/applications', async (request, reply) => {
    const scope = requireDemoScope(request.headers, 'applicant')
    const input = parseRequest(CreateApplicationRequestSchema, request.body)
    const application = ApplicationViewSchema.parse(
      await options.service.createApplication(scope, input),
    )
    return reply.code(201).send(application)
  })

  app.get('/api/applications/:id', async (request) => {
    const scope = requireDemoScope(request.headers, 'applicant')
    const { id } = parseRequest(ApplicationParamsSchema, request.params)
    return ApplicationViewSchema.parse(await options.service.getApplication(scope, id))
  })

  app.post('/api/applications/:id/commands', async (request, reply) => {
    const scope = requireDemoScope(request.headers, 'applicant')
    const { id } = parseRequest(ApplicationParamsSchema, request.params)
    const command = parseRequest(ApplicationCommandSchema, request.body)
    sendCommand(reply, await options.service.dispatch(scope, id, command))
  })

  app.get('/api/applications/:id/events', async (request, reply) => {
    const scope = requireDemoScope(request.headers, 'applicant')
    const { id } = parseRequest(ApplicationParamsSchema, request.params)
    await openApplicationStream({
      applicationId: id,
      ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
      registry: streams,
      reply,
      request,
      scope,
      service: options.service,
    })
  })

  app.get('/api/reviewer/applications', async (request) => {
    const scope = requireDemoScope(request.headers, 'reviewer')
    return ReviewerQueueSchema.parse(await options.service.listReviewer(scope))
  })

  app.get('/api/reviewer/applications/:id', async (request) => {
    const scope = requireDemoScope(request.headers, 'reviewer')
    const { id } = parseRequest(ApplicationParamsSchema, request.params)
    return ApplicationViewSchema.parse(await options.service.getApplication(scope, id))
  })

  app.post('/api/reviewer/applications/:id/commands', async (request, reply) => {
    const scope = requireDemoScope(request.headers, 'reviewer')
    const { id } = parseRequest(ApplicationParamsSchema, request.params)
    const command = parseRequest(ReviewerCommandSchema, request.body)
    sendCommand(reply, await options.service.review(scope, id, command))
  })

  app.post('/api/demo/seed', async (request) => {
    const scope = requireDemoScope(request.headers, 'reviewer')
    return DemoActionResponseSchema.parse(await options.service.seed(scope))
  })

  app.post('/api/demo/reset', async (request) => {
    const scope = requireDemoScope(request.headers, 'reviewer')
    return DemoActionResponseSchema.parse(await options.service.reset(scope))
  })
}
