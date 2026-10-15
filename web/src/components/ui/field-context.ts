import * as React from 'react'

/**
 * Connects a label, its control and its error message.
 *
 *   <Field error={errors.name?.message}>
 *     <Label>Nama *</Label>
 *     <Input {...register('name')} />
 *   </Field>
 *
 * Label gets `htmlFor`, the control gets `id`, `aria-invalid` and
 * `aria-describedby` pointing at the error, which Field renders itself.
 * Controls that are not Input / SelectTrigger can call `useFieldControl()`.
 */

interface FieldContextValue {
  id: string
  errorId: string
  invalid: boolean
}

export const FieldContext = React.createContext<FieldContextValue | null>(null)

export function useFieldContext() {
  return React.useContext(FieldContext)
}

/** Props to spread on a custom control inside a Field (explicit props win). */
export function useFieldControl(): {
  id?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
} {
  const ctx = useFieldContext()
  if (!ctx) return {}
  return {
    id: ctx.id,
    'aria-invalid': ctx.invalid || undefined,
    'aria-describedby': ctx.invalid ? ctx.errorId : undefined,
  }
}
