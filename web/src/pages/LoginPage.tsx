import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, ArrowRight, CalendarClock, Eye, EyeOff, Loader2, Lock, MapPinned, Timer, UserRound } from 'lucide-react'
import { useLogin, getLoginErrorMessage } from '@/hooks/useAuth'

const HIGHLIGHTS = [
  { icon: MapPinned, label: 'Presensi berbasis lokasi' },
  { icon: CalendarClock, label: 'Jadwal shift per site' },
  { icon: Timer, label: 'Pengajuan lembur' },
]

// ─── Zod schema ────────────────────────────────────────────────────────────────
const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Email atau ID karyawan wajib diisi'),
  password: z.string().min(1, 'Kata sandi wajib diisi'),
})

type LoginFormData = z.infer<typeof loginSchema>

// ─── Component ─────────────────────────────────────────────────────────────────
export function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  const loginMutation = useLogin()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = (data: LoginFormData) => {
    setLoginError(null)
    loginMutation.mutate(data, {
      onError: (error) => {
        setLoginError(getLoginErrorMessage(error))
      },
    })
  }

  const isPending = loginMutation.isPending

  const inputClass = `w-full h-12 rounded-xl border border-slate-200 bg-white text-sm font-medium text-text-primary shadow-sm
                      placeholder:text-text-disabled hover:border-slate-300
                      focus:outline-none focus:ring-4 focus:ring-brand/15 focus:border-brand
                      disabled:bg-surface disabled:text-text-disabled disabled:cursor-not-allowed
                      transition`

  return (
    <div className="min-h-screen grid bg-surface lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Brand panel, desktop only */}
      <section className="relative hidden overflow-hidden bg-chrome text-white lg:flex lg:flex-col">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(rgb(255_255_255/0.06)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.06)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_at_70%_30%,black,transparent_75%)]"
        />
        <div
          aria-hidden="true"
          className="absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand/30 blur-3xl"
        />
        <div className="relative flex items-center gap-3 px-12 pt-10">
          <img src="/hadirops-logo.svg" alt="" className="h-10 w-10 rounded-xl shadow-glow" />
          <div className="leading-tight">
            <p className="text-base font-bold tracking-tight">HadirOps</p>
            <p className="text-xs text-slate-400">Manajemen presensi</p>
          </div>
        </div>

        <div className="relative mt-auto px-12 pb-12">
          <h1 className="max-w-lg text-4xl font-bold leading-[1.1] tracking-tight xl:text-5xl">
            Kelola kehadiran.
            <br />
            Atur operasional.
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-slate-400">
            Pantau presensi, susun jadwal shift, dan tinjau pengajuan lembur dari satu ruang kerja.
          </p>
          <ul className="mt-8 grid max-w-xl grid-cols-3 gap-3">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <li key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
                <Icon className="h-5 w-5 text-brand-light" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium leading-snug text-slate-200">{label}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Form panel */}
      <div className="flex min-h-screen flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center gap-3 lg:hidden">
          <img src="/hadirops-logo.svg" alt="" className="h-9 w-9 rounded-xl" />
          <p className="text-base font-bold tracking-tight text-text-primary">HadirOps</p>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10 animate-rise">
          <p className="text-sm font-semibold text-brand">Portal admin dan supervisor</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-text-primary">Masuk ke ruang kerja</h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            Gunakan akun karyawan yang terdaftar untuk mengakses HadirOps.
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-5">
            {/* Identifier field */}
            <div>
              <label htmlFor="identifier" className="block text-sm font-medium text-text-primary mb-1.5">
                Email atau ID karyawan
              </label>
              <div className="relative">
                <UserRound
                  size={18}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-disabled"
                />
                <input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  placeholder="nama@example.com"
                  aria-invalid={Boolean(errors.identifier)}
                  aria-describedby={errors.identifier ? 'identifier-error' : undefined}
                  disabled={isPending}
                  {...register('identifier')}
                  className={`${inputClass} pl-11 pr-3`}
                />
              </div>
              {errors.identifier && (
                <p id="identifier-error" role="alert" className="mt-1.5 text-xs text-red-600">
                  {errors.identifier.message}
                </p>
              )}
            </div>

            {/* Password field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text-primary mb-1.5">
                Kata sandi
              </label>
              <div className="relative">
                <Lock
                  size={18}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-disabled"
                />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Masukkan kata sandi"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  disabled={isPending}
                  {...register('password')}
                  className={`${inputClass} pl-11 pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={isPending}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 flex items-center justify-center rounded-lg text-text-secondary hover:bg-surface hover:text-text-primary disabled:pointer-events-none transition-colors"
                  aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" role="alert" className="mt-1.5 text-xs text-red-600">
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* Inline error message from API */}
            {loginError && (
              <div role="alert" className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 border border-red-200">
                <AlertCircle size={16} aria-hidden="true" className="mt-0.5 flex-shrink-0 text-red-600" />
                <p className="text-sm text-red-700">{loginError}</p>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={isPending}
              className="w-full h-12 flex items-center justify-center gap-2 rounded-xl
                         bg-brand text-white font-semibold text-sm shadow-glow
                         hover:bg-brand-dark active:scale-[0.99]
                         disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none
                         transition"
            >
              {isPending ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} aria-hidden="true" />}
              {isPending ? 'Memproses...' : 'Masuk ke HadirOps'}
            </button>
          </form>

          <p className="mt-6 text-xs text-text-secondary leading-5">
            Belum memiliki akses? Hubungi administrator perusahaan.
          </p>
        </div>

        <p className="text-center text-xs text-text-secondary lg:text-left">HadirOps · Presensi dan operasional karyawan</p>
      </div>
    </div>
  )
}
