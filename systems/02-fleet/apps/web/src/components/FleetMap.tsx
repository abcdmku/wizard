import { titleCase } from '../lib/dispatch'
import type { Vehicle } from '../model'
import { Icon } from './Icon'

interface FleetMapProps {
  vehicles: ReadonlyArray<Vehicle>
  selectedDeliveryId: string | undefined
  onSelectDelivery: (deliveryId: string) => void
}

export function FleetMap({ vehicles, selectedDeliveryId, onSelectDelivery }: FleetMapProps) {
  return (
    <section className="panel map-panel" aria-labelledby="map-title">
      <div className="panel-heading map-heading">
        <div>
          <p className="eyebrow">Live positions</p>
          <h2 id="map-title">Metro fleet</h2>
        </div>
        <div className="map-legend">
          <span>
            <i className="legend-dot moving" />
            Moving
          </span>
          <span>
            <i className="legend-dot delayed" />
            Delayed
          </span>
          <span>
            <i className="legend-dot offline" />
            Offline
          </span>
        </div>
      </div>
      <div className="fleet-map">
        <svg className="road-layer" viewBox="0 0 1000 620" aria-hidden="true">
          <defs>
            <pattern id="minor-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="1000" height="620" fill="url(#minor-grid)" />
          <g className="roads minor-roads">
            <path d="M-20 90 1020 280M80-10l250 650M690-10 470 640M0 510l1010-85" />
          </g>
          <g className="roads major-roads">
            <path d="M-40 390C170 305 270 160 480 195s255 185 570 30" />
            <path d="M170-30c20 160 125 255 300 300s240 150 225 390" />
          </g>
          <g className="route-trace">
            <path d="M65 445c150-62 265-222 420-210s265 145 420 55" />
          </g>
          <g className="map-blocks">
            <rect x="90" y="100" width="105" height="70" rx="5" />
            <rect x="760" y="420" width="140" height="92" rx="5" />
            <rect x="555" y="78" width="95" height="55" rx="5" />
            <rect x="255" y="455" width="110" height="80" rx="5" />
          </g>
          <g className="map-labels">
            <text x="103" y="128">
              NORTH DEPOT
            </text>
            <text x="780" y="452">
              AIR CARGO
            </text>
            <text x="572" y="109">
              MEDICAL
            </text>
            <text x="275" y="488">
              WEST HUB
            </text>
          </g>
        </svg>
        {vehicles.map((vehicle) => {
          const active = vehicle.activeDeliveryId
          const selected = active === selectedDeliveryId
          return (
            <button
              aria-label={`${vehicle.label}, ${vehicle.driverName}, ${titleCase(vehicle.status)}`}
              aria-pressed={selected}
              className={`vehicle-marker status-${vehicle.status}${selected ? ' selected' : ''}`}
              disabled={!active}
              key={vehicle.id}
              onClick={() => {
                if (active) onSelectDelivery(active)
              }}
              style={{ left: `${vehicle.position.x}%`, top: `${vehicle.position.y}%` }}
              type="button"
            >
              <span className="vehicle-icon">
                <span style={{ transform: `rotate(${vehicle.position.heading}deg)` }}>
                  <Icon name="truck" />
                </span>
              </span>
              <span className="vehicle-label">
                <strong>{vehicle.label}</strong>
                <small>{vehicle.driverName}</small>
              </span>
            </button>
          )
        })}
        <div className="map-scale" aria-hidden="true">
          <span />2 km
        </div>
      </div>
    </section>
  )
}
