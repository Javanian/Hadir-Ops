import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, User, Mail, MapPin, Shield, CheckCircle, XCircle,
  Trash2, AlertCircle, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { usersApi } from '@/api/users.api'
import { useHasRole } from '@/hooks/useAuth'
import { showSuccess, showError } from '@/utils/toast'
import type { UserRole } from '@/types/auth'

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: 'Admin',
  SUPERVISOR: 'Supervisor',
  EMPLOYEE: 'Karyawan',
  SALES: 'Sales',
}

const roleBadgeVariant = (role: UserRole) => {
  if (role === 'ADMIN') return 'admin' as const
  if (role === 'SUPERVISOR') return 'supervisor' as const
  if (role === 'SALES') return 'sales' as const
  return 'employee' as const
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-divider last:border-0">
      <div className="text-text-secondary mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-secondary">{label}</p>
        <div className="text-sm font-medium text-text-primary mt-0.5">{value}</div>
      </div>
    </div>
  )
}

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const userId = parseInt(id ?? '0')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isAdmin = useHasRole('ADMIN')

  const { data: user, isLoading, isError, refetch } = useQuery({
    queryKey: ['users', userId],
    queryFn: () => usersApi.getById(userId),
    enabled: userId > 0,
    retry: false,
  })

  const { data: faceStatus } = useQuery({
    queryKey: ['face-status', userId],
    queryFn: () => usersApi.getFaceStatus(userId),
    enabled: userId > 0,
    retry: false,
  })

  const deleteFaceMutation = useMutation({
    mutationFn: () => usersApi.deleteFace(userId),
    onSuccess: () => {
      showSuccess('Wajah berhasil dihapus')
      void qc.invalidateQueries({ queryKey: ['face-status', userId] })
    },
    onError: () => {
      showError('Gagal menghapus data wajah')
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="rounded-lg border border-divider p-6 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !user) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Kembali
        </Button>
        <div className="flex flex-col items-center gap-4 py-16">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <p className="text-text-secondary">Gagal memuat detail pengguna. Endpoint backend belum tersedia.</p>
          <Button variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Coba Lagi
          </Button>
        </div>
      </div>
    )
  }

  const hasFace = faceStatus?.has_face ?? false

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Back button */}
      <Button variant="ghost" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Kembali ke Daftar Pengguna
      </Button>

      {/* User info card */}
      <div className="rounded-lg border border-divider bg-white overflow-hidden">
        {/* Card header */}
        <div className="bg-slate-900 px-6 py-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center">
            <User className="h-7 w-7 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">{user.name}</h2>
            <p className="text-brand-light text-sm">{user.employee_id}</p>
          </div>
          <div className="ml-auto">
            <Badge variant={roleBadgeVariant(user.role)} className="bg-white/20 text-white border-0">
              {ROLE_LABEL[user.role]}
            </Badge>
          </div>
        </div>

        {/* Card body */}
        <div className="px-6 py-4">
          <InfoRow
            icon={<Mail className="h-4 w-4" />}
            label="Email"
            value={user.email}
          />
          <InfoRow
            icon={<Shield className="h-4 w-4" />}
            label="Role"
            value={<Badge variant={roleBadgeVariant(user.role)}>{ROLE_LABEL[user.role]}</Badge>}
          />
          <InfoRow
            icon={<MapPin className="h-4 w-4" />}
            label="Lokasi Kerja"
            value={user.site_name ?? <span className="text-text-secondary italic">Tidak ada lokasi</span>}
          />
          <InfoRow
            icon={<CheckCircle className="h-4 w-4" />}
            label="Status Akun"
            value={
              user.is_locked
                ? <Badge variant="danger">Terkunci</Badge>
                : user.is_active
                  ? <Badge variant="success">Aktif</Badge>
                  : <Badge variant="outline">Nonaktif</Badge>
            }
          />
        </div>
      </div>

      {/* Face embedding card */}
      <div className="rounded-lg border border-divider bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-text-primary">Data Wajah</h3>
          {hasFace
            ? <Badge variant="success">Terdaftar</Badge>
            : <Badge variant="outline">Belum Terdaftar</Badge>
          }
        </div>

        {hasFace ? (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
            <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-700">
              Data wajah pengguna ini sudah terdaftar dan dapat digunakan untuk absensi.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-surface border border-divider">
            <XCircle className="h-5 w-5 text-text-secondary flex-shrink-0" />
            <p className="text-sm text-text-secondary">
              Pengguna belum mendaftarkan wajah. Mereka perlu mendaftar wajah melalui aplikasi mobile.
            </p>
          </div>
        )}

        {isAdmin && hasFace && (
          <div className="mt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Hapus Data Wajah
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Hapus Data Wajah</AlertDialogTitle>
                  <AlertDialogDescription>
                    Apakah Anda yakin ingin menghapus data wajah milik{' '}
                    <strong>{user.name}</strong>? Pengguna tidak akan bisa absen
                    sampai mendaftarkan wajah kembali melalui aplikasi mobile.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteFaceMutation.mutate()}
                    disabled={deleteFaceMutation.isPending}
                  >
                    {deleteFaceMutation.isPending ? 'Menghapus...' : 'Hapus Data Wajah'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </div>
  )
}
