import type { ComponentPropsWithoutRef } from 'react'
import type { MDXComponents } from 'mdx/types'
import { withBase } from './src/lib/base-path'
import {
  AutoSaveDemo,
  AnalyticsDemo,
  Badge,
  Callout,
  CodeFrom,
  CodePlayground,
  DAGPrerequisitesDemo,
  HelpersShowcaseDemo,
  ProgressTrackingDemo,
  RouterDemo,
  StatusSystemDemo,
  Step,
  Steps,
  StepBranchingDemo,
  StepTimeoutDemo,
  Tab,
  Tabs,
  WeightedProgressDemo,
  AsyncLoadingDemo,
} from './components'

function InlineCode(props: ComponentPropsWithoutRef<'code'>) {
  return <code {...props} />
}

function MdxAnchor(props: ComponentPropsWithoutRef<'a'>) {
  const href = props.href
  if (typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')) {
    return <a {...props} href={withBase(href)} />
  }
  return <a {...props} />
}

export const mdxComponents: MDXComponents = {
  a: MdxAnchor,
  code: InlineCode,
  Badge,
  Callout,
  CodeFrom,
  Steps,
  Step,
  Tabs,
  Tab,
  CodePlayground,
  StepBranchingDemo,
  AutoSaveDemo,
  ProgressTrackingDemo,
  AsyncLoadingDemo,
  RouterDemo,
  StepTimeoutDemo,
  StatusSystemDemo,
  HelpersShowcaseDemo,
  DAGPrerequisitesDemo,
  WeightedProgressDemo,
  AnalyticsDemo,
}
