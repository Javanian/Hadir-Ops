import * as React from 'react'
import { cn } from '@/lib/utils'
import { useFieldControl } from './field-context'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      {...useFieldControl()}
      className={cn(
        'flex h-10 w-full rounded-md border border-divider bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-brand aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
Input.displayName = 'Input'

export { Input }
