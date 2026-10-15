import * as React from 'react'
import { cn } from '@/lib/utils'
import { FieldContext } from './field-context'

/** See field-context.ts for how Label, Input and SelectTrigger pick up the ids. */
interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  error?: string
}

export function Field({ error, className, children, ...props }: FieldProps) {
  const id = React.useId()
  const value = React.useMemo(
    () => ({ id: `${id}-control`, errorId: `${id}-error`, invalid: Boolean(error) }),
    [id, error],
  )
  return (
    <FieldContext.Provider value={value}>
      <div className={cn('space-y-1.5', className)} {...props}>
        {children}
        {error && (
          <p id={value.errorId} className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  )
}
