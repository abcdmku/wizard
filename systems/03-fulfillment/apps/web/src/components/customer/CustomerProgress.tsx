import { GitFork, PackageCheck, ShieldCheck } from 'lucide-react'
import type { BranchView, CustomerOrder } from '../../contracts'
import {
  customerParallelBranches,
  customerReviewBranch,
  customerShippingBranch,
} from '../../contracts'
import { StatusBadge } from '../shared/StatusBadge'

export function CustomerProgress({ order }: { order: CustomerOrder }) {
  const parallel = customerParallelBranches(order)
  const review = customerReviewBranch(order)
  const shipping = customerShippingBranch(order)
  return (
    <section className="workflow-section" aria-labelledby="order-route-title">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Live workflow</p>
          <h3 id="order-route-title">Order route</h3>
        </div>
        <span className="live-chip">
          <span aria-hidden="true" /> Live
        </span>
      </div>
      <ol className="customer-workflow">
        <li className="workflow-stage parallel-stage">
          <span className="stage-marker">
            <GitFork size={16} aria-hidden="true" />
          </span>
          <div className="stage-content">
            <div className="stage-title-row">
              <strong>Payment and inventory</strong>
              <span className="parallel-chip">Run in parallel</span>
            </div>
            <div className="parallel-branches">
              {parallel.map((branch) => (
                <BranchCard key={branch.label} branch={branch} />
              ))}
            </div>
          </div>
        </li>
        <SimpleStage icon={<ShieldCheck size={16} />} branch={review} />
        <SimpleStage icon={<PackageCheck size={16} />} branch={shipping} />
      </ol>
    </section>
  )
}

function BranchCard({ branch }: { branch: BranchView }) {
  return (
    <div className={`branch-card branch-${branch.status}`}>
      <div className="branch-card-top">
        <strong>{branch.label}</strong>
        <StatusBadge status={branch.status} />
      </div>
      <span>{branch.message}</span>
    </div>
  )
}

function SimpleStage({ icon, branch }: { icon: React.ReactNode; branch: BranchView }) {
  return (
    <li className="workflow-stage">
      <span className="stage-marker" aria-hidden="true">
        {icon}
      </span>
      <div className="stage-content stage-title-row">
        <span>
          <strong>{branch.label}</strong>
          <small>{branch.message}</small>
        </span>
        <StatusBadge status={branch.status} />
      </div>
    </li>
  )
}
