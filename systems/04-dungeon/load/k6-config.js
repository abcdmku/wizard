export const profiles = {
  smoke: {
    activeMs: 20_000,
    deadline: '35s',
    driveIntervalMs: 250,
    parties: 1,
    playersPerParty: 4,
  },
  '20x4-smoke': {
    activeMs: 20_000,
    deadline: '35s',
    driveIntervalMs: 250,
    parties: 20,
    playersPerParty: 4,
  },
  '20x4-client-smoke': {
    activeMs: 20_000,
    deadline: '35s',
    driveIntervalMs: 100,
    parties: 20,
    playersPerParty: 4,
  },
  '5m': {
    activeMs: 300_000,
    deadline: '5m15s',
    driveIntervalMs: 100,
    parties: 20,
    playersPerParty: 4,
  },
}
export const profileNames = Object.keys(profiles)

export function playerCountFor(profile) {
  return profile.parties * profile.playersPerParty
}

export function minimumTickAdvances(profile) {
  return Math.ceil((profile.activeMs * 9) / 1_000)
}

export function thresholdsFor(profile) {
  const playerCount = playerCountFor(profile)
  return {
    command_to_frame_ms: ['p(95)<250'],
    full_frame_bytes: ['max<=25000'],
    full_frame_count: ['count>0'],
    authoritative_command_frames: ['count>0'],
    commands_sent: ['count>0'],
    commands_completed: ['count>0'],
    commands_resolved: ['count>0'],
    commands_unresolved: ['count==0'],
    command_resolution_ratio: ['rate==1'],
    authoritative_completion_ratio: ['rate>=0.99'],
    ack_rejections_fatal: ['count==0'],
    protocol_errors: ['count==0'],
    stale_pending_commands: ['count==0'],
    oversized_full_frames: ['count==0'],
    early_connection_closes: ['count==0'],
    connections_opened: [`count==${playerCount}`],
    connections_closed: [`count==${playerCount}`],
    completed_connections: [`count==${playerCount}`],
    sampled_connections: [`count==${playerCount}`],
    late_sample_vus: [`count==${playerCount}`],
    world_tick_advances_per_vu: [`min>=${minimumTickAdvances(profile)}`],
    world_tick_rate_hz: ['min>=9'],
    world_tick_sampled_vus: [`count==${playerCount}`],
    world_tick_interval_samples: ['count>0'],
    health_active_parties_before_seed: ['value==0'],
    health_active_parties_after_seed: [`value==${profile.parties}`],
  }
}
