import { boundary, defineWizard, type HookArgs, type RunArgs } from '@openwizard/core'
import { type EffectDeps, runEffect } from '@openwizard/effect'
import type { VehicleTelemetry } from '@openwizard/fleet-shared'
import { Clock, Effect, type ManagedRuntime, Schema } from 'effect'
import { DeliveryEffects } from './delivery-effects'
import {
  ActionReceiptSchema,
  type AnomalyResolvedEvent,
  type ApprovalEvent,
  type DeliveryContext,
  DeliveryContextSchema,
  DeliveryWorkflowEvents,
  type InterventionEvent,
  type PickupConfirmedEvent,
} from './delivery-model'
import { mapActionFailure, requireAnomaly, telemetrySeverity } from './delivery-runtime'
import { EscalationScoreSchema } from './score-policy'

type DeliveryDeps = EffectDeps<DeliveryEffects>
type HookBase = HookArgs<DeliveryContext, DeliveryDeps>
type EventHookArgs<P, E extends string> = HookBase & {
  readonly event: E
  readonly payload: P
}
const retryPolicy = {
  retries: 3,
  backoff: 'exponential',
  baseMs: 250,
  factor: 2,
  maxBackoffMs: 2_000,
} as const

const receiptBoundary = Schema.toStandardSchemaV1(ActionReceiptSchema)
const receiptsBoundary = Schema.toStandardSchemaV1(Schema.Array(ActionReceiptSchema))
const scoreBoundary = Schema.toStandardSchemaV1(EscalationScoreSchema)

export function makeDeliveryFlow(runtime: ManagedRuntime.ManagedRuntime<DeliveryEffects, never>) {
  const assignment = runEffect(
    (args: RunArgs<DeliveryContext, DeliveryDeps>) =>
      Effect.gen(function* () {
        const effects = yield* DeliveryEffects
        const receipt = yield* effects.perform({
          tenantId: args.context.tenantId,
          deliveryId: args.context.deliveryId,
          action: 'start_assignment',
          idempotencyKey: args.idempotencyKey,
        })
        args.update({ procedureState: 'assignment' })
        return receipt
      }),
    { mapError: mapActionFailure },
  )
  const scoreInitial = runEffect(
    (args: RunArgs<DeliveryContext, DeliveryDeps>) =>
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis
        const score = yield* requireAnomaly(args.context, nowMs)
        args.update({ procedureState: 'anomaly', score: score.score, band: score.band })
        return score
      }),
    { mapError: mapActionFailure },
  )
  const actInitial = runEffect(
    (args: RunArgs<DeliveryContext, DeliveryDeps>) =>
      Effect.gen(function* () {
        const effects = yield* DeliveryEffects
        const nowMs = yield* Clock.currentTimeMillis
        const score = yield* requireAnomaly(args.context, nowMs)
        if (args.context.lastActionBand === score.band) return []
        const receipts = yield* Effect.forEach(score.actions, (action) =>
          effects.perform({
            tenantId: args.context.tenantId,
            deliveryId: args.context.deliveryId,
            action,
            idempotencyKey: `${args.idempotencyKey}:${action}`,
            score: score.score,
          }),
        )
        args.update({
          lastActionBand: score.band,
          ...(score.band === 'P3' ? { anomalyResolved: true, procedureState: 'transit' } : {}),
        })
        return receipts
      }),
    { mapError: mapActionFailure },
  )
  const initialRoute = ({ context }: HookBase) =>
    context.band === 'P0'
      ? ('operatorApproval' as const)
      : context.band === 'P3'
        ? ('postInterventionTransit' as const)
        : ('dispatcherIntervention' as const)
  const rescore = runEffect(
    (args: RunArgs<DeliveryContext, DeliveryDeps>) =>
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis
        const score = yield* requireAnomaly(args.context, nowMs)
        args.update({ score: score.score, band: score.band })
        return score
      }),
    { mapError: mapActionFailure },
  )
  const reactToEscalation = runEffect(
    (args: RunArgs<DeliveryContext, DeliveryDeps>) =>
      Effect.gen(function* () {
        const effects = yield* DeliveryEffects
        const nowMs = yield* Clock.currentTimeMillis
        const score = yield* requireAnomaly(args.context, nowMs)
        if (args.context.lastActionBand === score.band) return []
        const receipts = yield* Effect.forEach(score.actions, (action) =>
          effects.perform({
            tenantId: args.context.tenantId,
            deliveryId: args.context.deliveryId,
            action,
            idempotencyKey: `${args.idempotencyKey}:${action}`,
            score: score.score,
          }),
        )
        args.update({
          lastActionBand: score.band,
          ...(score.band === 'P3' ? { anomalyResolved: true, procedureState: 'transit' } : {}),
        })
        return receipts
      }),
    { mapError: mapActionFailure },
  )
  const pickup = (args: EventHookArgs<PickupConfirmedEvent, 'pickupConfirmed'>) => {
    args.update({ procedureState: 'transit' })
    if (!args.context.anomalyResolved && args.context.severity !== undefined)
      return { done: 'scoreInitial' } as const
    return { done: 'transit' } as const
  }
  const telemetry = (args: EventHookArgs<VehicleTelemetry, 'telemetry'>) => {
    const severity = telemetrySeverity(args.payload)
    if (severity === undefined) {
      args.update({
        currentTempC: args.payload.tempC,
        lastTelemetryAtMs: args.payload.capturedAt,
      })
      return { keep: true } as const
    }
    const isNew = args.context.anomalyResolved || args.context.severity === undefined
    args.update({
      currentTempC: args.payload.tempC,
      lastTelemetryAtMs: args.payload.capturedAt,
      severity,
      anomalyOpenedAtMs: isNew
        ? args.payload.capturedAt
        : (args.context.anomalyOpenedAtMs ?? args.payload.capturedAt),
      anomalyResolved: false,
      ...(isNew ? { lastActionBand: null } : {}),
    })
    return { done: isNew ? ('scoreInitial' as const) : ('rescore' as const) }
  }
  const intervention = (args: EventHookArgs<InterventionEvent, 'intervention'>) => {
    if (args.payload.action === 'complete') return { done: 'completion' } as const
    if (args.payload.action === 'reroute') {
      args.update({ anomalyResolved: true, procedureState: 'transit', lastActionBand: null })
      return { done: 'postInterventionTransit' } as const
    }
    return { keep: true } as const
  }
  const anomalyResolved = (args: EventHookArgs<AnomalyResolvedEvent, 'anomalyResolved'>) => {
    args.update({ anomalyResolved: true, procedureState: 'transit', lastActionBand: null })
    return { done: 'postInterventionTransit' } as const
  }
  const approval = (args: EventHookArgs<ApprovalEvent, 'approval'>) => {
    if (args.payload.approved) {
      args.update({ procedureState: 'transit', anomalyResolved: true })
      return { done: 'postInterventionTransit' } as const
    }
    args.update({ procedureState: 'cancellation' })
    return { done: 'operatorCancelled' } as const
  }

  return defineWizard(
    {
      name: 'fleet-delivery',
      version: 1,
      context: Schema.toStandardSchemaV1(DeliveryContextSchema),
      deps: boundary.trusted<DeliveryDeps>(),
      output: ({ context }) => ({ state: context.procedureState }),
      events: {
        assigned: Schema.toStandardSchemaV1(DeliveryWorkflowEvents.assigned),
        pickupConfirmed: Schema.toStandardSchemaV1(DeliveryWorkflowEvents.pickupConfirmed),
        telemetry: Schema.toStandardSchemaV1(DeliveryWorkflowEvents.telemetry),
        arrived: Schema.toStandardSchemaV1(DeliveryWorkflowEvents.arrived),
        anomalyResolved: Schema.toStandardSchemaV1(DeliveryWorkflowEvents.anomalyResolved),
        intervention: Schema.toStandardSchemaV1(DeliveryWorkflowEvents.intervention),
        approval: Schema.toStandardSchemaV1(DeliveryWorkflowEvents.approval),
        cancelled: Schema.toStandardSchemaV1(DeliveryWorkflowEvents.cancelled),
      },
      on: {
        cancelled: ({ payload, update }) => {
          update({ procedureState: 'cancellation' })
          return { cancel: payload.reason ?? 'delivery cancelled' }
        },
        intervention: ({ payload, update }) => {
          if (payload.action !== 'cancel') return
          update({ procedureState: 'cancellation' })
          return { cancel: payload.reason ?? 'delivery cancelled by operator' }
        },
      },
      unmatchedEvents: { buffer: true, ttl: '30m' },
    },
    ({ step, steps }) =>
      steps({
        assignment: step({
          run: assignment,
          idempotencyKey: true,
          retry: retryPolicy,
          output: receiptBoundary,
          next: 'pickup',
        }),
        pickup: step({
          enter: ({ update }) => update({ procedureState: 'pickup' }),
          waitFor: {
            pickupConfirmed: pickup,
            intervention,
            assigned: ({ payload, update }) => {
              update({ vehicleId: payload.vehicleId })
              return { keep: true }
            },
          },
          timeout: { after: '30m', next: 'operatorApproval' },
          targets: ['transit', 'scoreInitial', 'completion', 'postInterventionTransit'],
          next: ({ output }) => output,
        }),
        transit: step({
          enter: ({ update }) => update({ procedureState: 'transit' }),
          waitFor: { telemetry, intervention, arrived: () => ({ done: 'completion' as const }) },
          targets: ['scoreInitial', 'rescore', 'completion', 'postInterventionTransit'],
          next: ({ output }) => output,
          timeout: { after: '2h', next: 'operatorApproval' },
        }),
        scoreInitial: step({
          run: scoreInitial,
          idempotencyKey: true,
          output: scoreBoundary,
          next: 'actInitial',
        }),
        actInitial: step({
          run: actInitial,
          idempotencyKey: true,
          retry: retryPolicy,
          output: receiptsBoundary,
          next: 'initialRoute',
        }),
        initialRoute: step({
          next: initialRoute,
          targets: ['operatorApproval', 'postInterventionTransit', 'dispatcherIntervention'],
        }),
        dispatcherIntervention: step({
          enter: ({ update }) => update({ procedureState: 'dispatcher_intervention' }),
          waitFor: { intervention, telemetry, anomalyResolved },
          targets: ['completion', 'postInterventionTransit', 'scoreInitial', 'rescore'],
          next: ({ output }) => output,
          timeout: { after: '5s', next: 'rescore' },
        }),
        rescore: step({
          run: rescore,
          idempotencyKey: true,
          output: scoreBoundary,
          next: 'react',
        }),
        react: step({
          run: reactToEscalation,
          idempotencyKey: true,
          retry: retryPolicy,
          output: receiptsBoundary,
          next: 'escalationRoute',
        }),
        escalationRoute: step({
          next: initialRoute,
          targets: ['operatorApproval', 'postInterventionTransit', 'dispatcherIntervention'],
        }),
        operatorApproval: step({
          enter: ({ update }) => update({ procedureState: 'operator_approval' }),
          waitFor: { approval, intervention, telemetry, anomalyResolved },
          targets: [
            'completion',
            'postInterventionTransit',
            'operatorCancelled',
            'scoreInitial',
            'rescore',
          ],
          next: ({ output }) => output,
          timeout: { after: '15m', next: 'operatorCancelled' },
        }),
        postInterventionTransit: step({
          enter: ({ update }) => update({ procedureState: 'transit' }),
          waitFor: {
            arrived: () => ({ done: 'completion' as const }),
            telemetry,
            intervention,
            anomalyResolved,
          },
          targets: ['completion', 'postInterventionTransit', 'scoreInitial', 'rescore'],
          next: ({ output }) => output,
          timeout: { after: '2h', next: 'operatorCancelled' },
        }),
        completion: step({
          run: runEffect(
            (args: RunArgs<DeliveryContext, DeliveryDeps>) =>
              Effect.gen(function* () {
                const effects = yield* DeliveryEffects
                const receipt = yield* effects.perform({
                  tenantId: args.context.tenantId,
                  deliveryId: args.context.deliveryId,
                  action: 'mark_complete',
                  idempotencyKey: args.idempotencyKey,
                })
                args.update({ procedureState: 'completion', anomalyResolved: true })
                return receipt
              }),
            { mapError: mapActionFailure },
          ),
          idempotencyKey: true,
          retry: retryPolicy,
          output: receiptBoundary,
          next: 'done',
        }),
        operatorCancelled: step({
          run: ({ update }) => {
            update({ procedureState: 'cancellation' })
            return { state: 'cancellation' as const }
          },
        }),
        done: step({ run: ({ context }) => ({ state: context.procedureState }) }),
      }),
  ).provide({ runtime })
}

export type DeliveryFlow = ReturnType<typeof makeDeliveryFlow>
