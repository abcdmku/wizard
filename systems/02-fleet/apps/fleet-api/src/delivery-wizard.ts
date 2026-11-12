import { boundary, defineWizard, type RunArgs } from '@openwizard/core'
import { runEffect } from '@openwizard/effect'
import type { PriorityBand } from '@openwizard/fleet-shared'
import { Clock, Effect, type ManagedRuntime, Schema } from 'effect'
import { DeliveryEffects } from './delivery-effects'
import {
  ActionReceiptSchema,
  type DeliveryContext,
  DeliveryContextSchema,
  DeliveryWorkflowEvents,
} from './delivery-model'
import { mapActionFailure, requireAnomaly } from './delivery-runtime'
import {
  anomalyResolved,
  approval,
  type DeliveryDeps,
  intervention,
  pickup,
  telemetry,
} from './delivery-waits'
import { type EscalationScore, EscalationScoreSchema } from './score-policy'

type DeliveryRunArgs = RunArgs<DeliveryContext, DeliveryDeps>

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

/** Performs one recorded delivery action and returns its receipt. */
const perform = (args: DeliveryRunArgs, action: 'start_assignment' | 'mark_complete') =>
  Effect.gen(function* () {
    const effects = yield* DeliveryEffects
    return yield* effects.perform({
      tenantId: args.context.tenantId,
      deliveryId: args.context.deliveryId,
      action,
      idempotencyKey: args.idempotencyKey,
    })
  })

/** Scores the open anomaly now and publishes the score for the dispatch view. */
const scoreNow = (args: DeliveryRunArgs, opening: boolean) =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis
    const score = yield* requireAnomaly(args.context, nowMs)
    args.update({
      ...(opening ? { procedureState: 'anomaly' as const } : {}),
      score: score.score,
      band: score.band,
    })
    return score
  })

/** Runs the automated actions of a score, once per priority band. */
const actOn = (args: DeliveryRunArgs, score: EscalationScore) =>
  Effect.gen(function* () {
    const effects = yield* DeliveryEffects
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
  })

const routeByBand = (band: PriorityBand) =>
  band === 'P0'
    ? ('operatorApproval' as const)
    : band === 'P3'
      ? ('postInterventionTransit' as const)
      : ('dispatcherIntervention' as const)
const bandTargets = [
  'operatorApproval',
  'postInterventionTransit',
  'dispatcherIntervention',
] as const

export function makeDeliveryWizard(runtime: ManagedRuntime.ManagedRuntime<DeliveryEffects, never>) {
  return defineWizard(
    {
      name: 'fleet-delivery',
      version: 1,
      description:
        'Tracks one cold-chain delivery from assignment to completion. A telemetry anomaly is ' +
        'scored, acted on and escalated to a dispatcher or a manager until it is resolved.',
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
    ({ step, steps }) => {
      const assignment = step({
        description: 'Records the start of the assignment.',
        run: runEffect(
          (args: DeliveryRunArgs) =>
            Effect.map(perform(args, 'start_assignment'), (receipt) => {
              args.update({ procedureState: 'assignment' })
              return receipt
            }),
          { mapError: mapActionFailure },
        ),
        idempotencyKey: true,
        retry: retryPolicy,
        output: receiptBoundary,
        next: 'pickup',
      })
      const pickupWait = step({
        description: 'Waits for the driver to confirm pickup. A manager decides after 30 minutes.',
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
      })
      const transit = step({
        description: 'Follows the vehicle until it arrives or its telemetry reports an anomaly.',
        enter: ({ update }) => update({ procedureState: 'transit' }),
        waitFor: { telemetry, intervention, arrived: () => ({ done: 'completion' as const }) },
        targets: ['scoreInitial', 'rescore', 'completion', 'postInterventionTransit'],
        next: ({ output }) => output,
        timeout: { after: '2h', next: 'operatorApproval' },
      })
      const scoreInitial = step({
        description: 'Scores a newly opened anomaly.',
        run: runEffect((args: DeliveryRunArgs) => scoreNow(args, true), {
          mapError: mapActionFailure,
        }),
        idempotencyKey: true,
        output: scoreBoundary,
        next: 'actInitial',
      })
      const actInitial = step({
        description: 'Runs the automated actions for the first score of an anomaly.',
        needs: { score: scoreInitial },
        run: (args) =>
          runEffect(() => actOn(args, args.needs.score), { mapError: mapActionFailure }),
        idempotencyKey: true,
        retry: retryPolicy,
        output: receiptsBoundary,
        next: 'initialRoute',
      })
      const initialRoute = step({
        description: 'Sends the anomaly to a manager, a dispatcher or back to transit by band.',
        needs: { score: scoreInitial, receipts: actInitial },
        next: ({ needs }) => routeByBand(needs.score.band),
        targets: bandTargets,
      })
      const dispatcherIntervention = step({
        description: 'Waits for a dispatcher. The anomaly is scored again every five seconds.',
        enter: ({ update }) => update({ procedureState: 'dispatcher_intervention' }),
        waitFor: { intervention, telemetry, anomalyResolved },
        targets: ['completion', 'postInterventionTransit', 'scoreInitial', 'rescore'],
        next: ({ output }) => output,
        timeout: { after: '5s', next: 'rescore' },
      })
      const rescore = step({
        description: 'Scores an anomaly that is still open, so waiting time raises its band.',
        run: runEffect((args: DeliveryRunArgs) => scoreNow(args, false), {
          mapError: mapActionFailure,
        }),
        idempotencyKey: true,
        output: scoreBoundary,
        next: 'react',
      })
      const react = step({
        description: 'Runs the automated actions when the new score reaches another band.',
        needs: { score: rescore },
        run: (args) =>
          runEffect(() => actOn(args, args.needs.score), { mapError: mapActionFailure }),
        idempotencyKey: true,
        retry: retryPolicy,
        output: receiptsBoundary,
        next: 'escalationRoute',
      })
      const escalationRoute = step({
        description: 'Routes the escalated anomaly by its new band.',
        needs: { score: rescore, receipts: react },
        next: ({ needs }) => routeByBand(needs.score.band),
        targets: bandTargets,
      })
      const operatorApproval = step({
        description: 'Waits for a manager to approve or cancel. Cancels after 15 minutes.',
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
      })
      const postInterventionTransit = step({
        description: 'Follows the vehicle after an anomaly was handled.',
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
      })
      const completion = step({
        description: 'Records the completed delivery.',
        run: runEffect(
          (args: DeliveryRunArgs) =>
            Effect.map(perform(args, 'mark_complete'), (receipt) => {
              args.update({ procedureState: 'completion', anomalyResolved: true })
              return receipt
            }),
          { mapError: mapActionFailure },
        ),
        idempotencyKey: true,
        retry: retryPolicy,
        output: receiptBoundary,
        next: 'done',
      })
      const operatorCancelled = step({
        description: 'Ends the delivery as cancelled.',
        run: ({ update }) => {
          update({ procedureState: 'cancellation' })
          return { state: 'cancellation' as const }
        },
      })
      const done = step({
        description: 'Ends the delivery in its final procedure state.',
        run: ({ context }) => ({ state: context.procedureState }),
      })
      return steps({
        assignment,
        pickup: pickupWait,
        transit,
        scoreInitial,
        actInitial,
        initialRoute,
        dispatcherIntervention,
        rescore,
        react,
        escalationRoute,
        operatorApproval,
        postInterventionTransit,
        completion,
        operatorCancelled,
        done,
      })
    },
  ).provide({ runtime })
}

export type DeliveryWizard = ReturnType<typeof makeDeliveryWizard>
