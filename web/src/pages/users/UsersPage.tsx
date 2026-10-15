import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import {
  Plus, Search, RefreshCw, ChevronLeft, ChevronRight,
  Eye, Pencil, Trash2, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { UserFormModal } from '@/components/users/UserFormModal'
import { usersApi } from '@/api/users.api'
import { useHasRole } from '@/hooks/useAuth'
import { showSuccess, showError } from '@/utils/toast'
import type { UserListItem } from '@/types/users'
import type { UserRole } from '@/types/auth'

// The action column stays pinned to the right edge while the rest of the
// table scrolls sideways on narrow screens.
const STICKY_ACTIONS_HEAD = 'sticky right-0 bg-slate-800'
const STICKY_ACTIONS_CELL =
  'sticky right-0 bg-white group-hover:bg-surface shadow-[-12px_0_12px_-12px_rgba(15,23,42,0.25)] lg:shadow-none'

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

const PAGE_SIZE = 20
const SCROLL_KEY = 'users-page-scroll'

export function UsersPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isAdmin = useHasRole('ADMIN')

  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('q') ?? ''
  const roleFilter = (searchParams.get('role') ?? '') as UserRole | ''
  const page = parseInt(searchParams.get('page') ?? '1', 10)

  const [modalOpen, setModalOpen] = useState(false)

  // Scroll restoration: read the saved position on mount, then apply it after
  // data has finished loading (requestAnimationFrame alone is too early — the
  // list is still in skeleton state, so the page isn't tall enough yet).
  const scrollTargetRef = useRef<number | null>(null)
  const hasRestoredScroll = useRef(false)

  useEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY)
    if (saved !== null) {
      sessionStorage.removeItem(SCROLL_KEY)
      scrollTargetRef.current = parseInt(saved, 10)
    }
    // Save scroll on unmount (navigating away to detail page)
    return () => {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY))
    }
  }, [])

  function updateSearch(value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set('q', value); else next.delete('q')
      next.delete('page')
      return next
    }, { replace: true })
  }

  function updateRoleFilter(value: UserRole | '') {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set('role', value); else next.delete('role')
      next.delete('page')
      return next
    }, { replace: true })
  }

  function updatePage(updater: number | ((p: number) => number)) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      const curr = parseInt(prev.get('page') ?? '1', 10)
      const newPage = typeof updater === 'function' ? updater(curr) : updater
      if (newPage <= 1) next.delete('page'); else next.set('page', String(newPage))
      return next
    })
  }

  const [editingUser, setEditingUser] = useState<UserListItem | null>(null)
  const [deletingUser, setDeletingUser] = useState<UserListItem | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['users', { search, roleFilter, page }],
    queryFn: () =>
      usersApi.list({
        search: search || undefined,
        role: roleFilter || undefined,
        page,
        page_size: PAGE_SIZE,
      }),
    retry: false,
    staleTime: 60_000,
  })

  // Restore scroll after data finishes loading (works for both cache hits and fresh fetches)
  useEffect(() => {
    if (!isLoading && scrollTargetRef.current !== null && !hasRestoredScroll.current) {
      hasRestoredScroll.current = true
      const target = scrollTargetRef.current
      scrollTargetRef.current = null
      requestAnimationFrame(() => window.scrollTo({ top: target, behavior: 'instant' }))
    }
  }, [isLoading])

  const deleteMutation = useMutation({
    mutationFn: (id: number) => usersApi.delete(id),
    onSuccess: () => {
      showSuccess('Pengguna berhasil dihapus')
      void qc.invalidateQueries({ queryKey: ['users'] })
      setDeletingUser(null)
    },
    onError: () => {
      showError('Gagal menghapus pengguna')
    },
  })

  const columns: ColumnDef<UserListItem>[] = [
    {
      accessorKey: 'employee_id',
      header: 'ID Karyawan',
      cell: ({ row }) => (
        <span className="font-mono text-sm font-medium text-text-primary">
          {row.original.employee_id}
        </span>
      ),
    },
    {
      accessorKey: 'name',
      header: 'Nama',
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-text-primary">{row.original.name}</p>
          <p className="text-xs text-text-secondary">{row.original.email}</p>
        </div>
      ),
    },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => (
        <Badge variant={roleBadgeVariant(row.original.role)}>
          {ROLE_LABEL[row.original.role]}
        </Badge>
      ),
    },
    {
      accessorKey: 'site_name',
      header: 'Lokasi',
      cell: ({ row }) => (
        <span className="text-sm text-text-secondary">
          {row.original.site_name ?? '—'}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        if (row.original.is_locked) {
          return <Badge variant="danger">Terkunci</Badge>
        }
        return row.original.is_active
          ? <Badge variant="success">Aktif</Badge>
          : <Badge variant="outline">Nonaktif</Badge>
      },
    },
    {
      id: 'face',
      header: 'Wajah',
      cell: ({ row }) => (
        row.original.has_face
          ? <Badge variant="success">Terdaftar</Badge>
          : <Badge variant="outline">Belum</Badge>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1 justify-end">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/users/${row.original.id}`)}
            aria-label={`Detail ${row.original.name}`}
            title="Detail"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {isAdmin && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { setEditingUser(row.original); setModalOpen(true) }}
                aria-label={`Ubah ${row.original.name}`}
                title="Edit"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                onClick={() => setDeletingUser(row.original)}
                aria-label={`Hapus ${row.original.name}`}
                title="Hapus"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ]

  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: data ? Math.ceil(data.total / PAGE_SIZE) : -1,
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Manajemen Pengguna</h1>
          <p className="text-sm text-text-secondary mt-1">
            Kelola semua pengguna sistem HadirOps
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="accent"
            onClick={() => { setEditingUser(null); setModalOpen(true) }}
          >
            <Plus className="h-4 w-4" />
            Tambah Pengguna
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary" />
          <Input
            aria-label="Cari pengguna"
            placeholder="Cari nama atau ID karyawan..."
            value={search}
            onChange={(e) => updateSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={roleFilter || '__all__'}
          onValueChange={(v) => updateRoleFilter(v === '__all__' ? '' : v as UserRole)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Semua Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Semua Role</SelectItem>
            <SelectItem value="ADMIN">Admin</SelectItem>
            <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
            <SelectItem value="EMPLOYEE">Karyawan</SelectItem>
            <SelectItem value="SALES">Sales</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => void refetch()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-divider overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-white">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${
                        h.column.id === 'actions' ? STICKY_ACTIONS_HEAD : ''
                      }`}
                    >
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-divider">
                    {columns.map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : isError ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <AlertCircle className="h-8 w-8 text-red-400" />
                      <p className="text-text-secondary text-sm">
                        Gagal memuat data. Endpoint backend belum tersedia.
                      </p>
                      <Button variant="outline" size="sm" onClick={() => void refetch()}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        Coba Lagi
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-text-secondary text-sm">
                    Tidak ada pengguna ditemukan.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="group border-t border-divider hover:bg-surface transition-colors"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={`px-4 py-3 ${cell.column.id === 'actions' ? STICKY_ACTIONS_CELL : ''}`}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-divider bg-surface">
            <p className="text-xs text-text-secondary">
              Menampilkan {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)} dari {data.total} pengguna
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => updatePage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-text-secondary">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => updatePage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <UserFormModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingUser(null) }}
        editingUser={editingUser}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Pengguna</AlertDialogTitle>
            <AlertDialogDescription>
              Apakah Anda yakin ingin menghapus pengguna{' '}
              <strong>{deletingUser?.name}</strong> ({deletingUser?.employee_id})?
              Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingUser && deleteMutation.mutate(deletingUser.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Menghapus...' : 'Hapus'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
