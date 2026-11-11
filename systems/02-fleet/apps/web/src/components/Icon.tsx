import type { SVGProps } from 'react'

export type IconName =
  | 'alert'
  | 'arrow'
  | 'box'
  | 'check'
  | 'clock'
  | 'close'
  | 'logout'
  | 'route'
  | 'snow'
  | 'truck'
  | 'wifi'

const paths: Record<IconName, string> = {
  alert:
    'M12 9v4m0 4h.01M10.3 3.6 2.5 17.1A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.9L13.7 3.6a2 2 0 0 0-3.4 0Z',
  arrow: 'm9 18 6-6-6-6',
  box: 'm21 8-9 5-9-5m18 0-9-5-9 5m18 0v8l-9 5-9-5V8m9 5v9',
  check: 'm5 12 4 4L19 6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14v5l3 2',
  close: 'm6 6 12 12M18 6 6 18',
  logout: 'M10 17l5-5-5-5m5 5H3m12-9h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4',
  route:
    'M5 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm14 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5 6v3a3 3 0 0 0 3 3h8a3 3 0 0 1 3 3v3',
  snow: 'M12 2v20M4.2 6.5l15.6 11M4.2 17.5l15.6-11M8 4l4 3 4-3M8 20l4-3 4 3M3.8 10 8 12l-4.2 2M20.2 10 16 12l4.2 2',
  truck:
    'M3 6h11v11H3V6Zm11 4h4l3 3v4h-7v-7ZM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  wifi: 'M5 12.6a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M2 9a14 14 0 0 1 20 0',
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
}

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  )
}
