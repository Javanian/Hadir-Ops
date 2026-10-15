import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/utils'
import { useFieldContext } from './field-context'

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, htmlFor, ...props }, ref) => {
  const field = useFieldContext()
  return (
    <LabelPrimitive.Root
      ref={ref}
      htmlFor={htmlFor ?? field?.id}
      className={cn('text-sm font-medium text-text-primary leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50', className)}
      {...props}
    />
  )
})
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
