import { ExternalLink, Loader2, ShieldCheck, Smartphone, UsersRound } from 'lucide-react'
import type { DemoRole } from '@/api/demo.api'
import { useDemoInfo, useDemoLogin } from '@/hooks/useDemo'
import { t } from '@/i18n'

const ROLES: { role: Exclude<DemoRole, 'EMPLOYEE'>; icon: typeof ShieldCheck; label: () => string; hint: () => string }[] = [
  { role: 'ADMIN', icon: ShieldCheck, label: () => t('demo.roleAdmin'), hint: () => t('demo.roleAdminHint') },
  { role: 'SUPERVISOR', icon: UsersRound, label: () => t('demo.roleSupervisor'), hint: () => t('demo.roleSupervisorHint') },
]

/** One-click sign-in on the public demo. Renders nothing on a normal server. */
export function DemoLoginPanel() {
  const { data } = useDemoInfo()
  const demoLogin = useDemoLogin()
  if (!data?.enabled) return null

  return (
    <section aria-labelledby="demo-title" className="mb-8 rounded-2xl border border-brand/20 bg-brand/5 p-4">
      <h3 id="demo-title" className="text-sm font-semibold text-text-primary">{t('demo.panelTitle')}</h3>
      <p className="mt-1 text-xs leading-5 text-text-secondary">{t('demo.panelHint')}</p>
      <div className="mt-3 grid gap-2">
        {ROLES.map(({ role, icon: Icon, label, hint }) => (
          <button
            key={role}
            type="button"
            disabled={demoLogin.isPending}
            onClick={() => demoLogin.mutate(role)}
            className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-brand focus:outline-hidden focus:ring-4 focus:ring-brand/15 disabled:opacity-60"
          >
            {demoLogin.isPending && demoLogin.variables === role
              ? <Loader2 size={18} className="shrink-0 animate-spin text-brand" aria-hidden="true" />
              : <Icon size={18} className="shrink-0 text-brand" aria-hidden="true" />}
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-text-primary">{label()}</span>
              <span className="block text-xs text-text-secondary">{hint()}</span>
            </span>
          </button>
        ))}
        {data.mobile_app_url && (
          <a
            href={data.mobile_app_url}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm transition hover:border-brand focus:outline-hidden focus:ring-4 focus:ring-brand/15"
          >
            <Smartphone size={18} className="shrink-0 text-brand" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-text-primary">{t('demo.roleEmployee')}</span>
              <span className="block text-xs text-text-secondary">{t('demo.roleEmployeeHint')}</span>
            </span>
            <ExternalLink size={14} className="shrink-0 text-text-disabled" aria-hidden="true" />
          </a>
        )}
      </div>
      {demoLogin.isError && <p role="alert" className="mt-2 text-xs text-red-600">{t('demo.loginFailed')}</p>}
    </section>
  )
}
