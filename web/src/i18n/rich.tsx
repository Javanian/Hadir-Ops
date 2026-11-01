import { Fragment, type ReactNode } from 'react'
import { t, type MessageKey } from '.'

/**
 * Like t(), but placeholders can be elements, so a translated sentence keeps
 * its emphasis: tRich('users.deleteConfirm', { name: <strong>{user.name}</strong> }).
 */
export function tRich(key: MessageKey, parts: Record<string, ReactNode>): ReactNode {
  return t(key)
    .split(/\{(\w+)\}/)
    .map((piece, i) => <Fragment key={i}>{i % 2 ? (parts[piece] ?? `{${piece}}`) : piece}</Fragment>)
}
