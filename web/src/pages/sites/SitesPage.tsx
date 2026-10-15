import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, RefreshCw, AlertCircle, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { SiteFormModal } from '@/components/sites/SiteFormModal'
import { sitesApi } from '@/api/sites.api'
import { showSuccess, showError } from '@/utils/toast'
import { TIMEZONE_SHORT } from '@/types/sites'
import type { SiteResponse } from '@/types/sites'

export function SitesPage() {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSite, setEditingSite] = useState<SiteResponse | null>(null)
  const [deletingSite, setDeletingSite] = useState<SiteResponse | null>(null)

  const { data: sites = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['sites'],
    queryFn: sitesApi.list,
    staleTime: 60_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => sitesApi.delete(id),
    onSuccess: () => {
      showSuccess('Lokasi berhasil dihapus')
      void qc.invalidateQueries({ queryKey: ['sites'] })
      setDeletingSite(null)
    },
    onError: () => showError('Gagal menghapus lokasi. Pastikan tidak ada data terkait.'),
  })

  const openAdd = () => { setEditingSite(null); setModalOpen(true) }
  const openEdit = (site: SiteResponse) => { setEditingSite(site); setModalOpen(true) }

  const COLUMNS = 5

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Manajemen Lokasi</h1>
          <p className="text-sm text-text-secondary mt-1">
            Kelola lokasi kerja, koordinat GPS, dan radius absensi
          </p>
        </div>
        <Button variant="accent" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          Tambah Lokasi
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-divider overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                  Nama Lokasi
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide hidden md:table-cell">
                  Koordinat
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                  Radius
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                  Zona Waktu
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t border-divider">
                    {Array.from({ length: COLUMNS }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : isError ? (
                <tr>
                  <td colSpan={COLUMNS} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <AlertCircle className="h-8 w-8 text-red-400" />
                      <p className="text-text-secondary text-sm">Gagal memuat data lokasi</p>
                      <Button variant="outline" size="sm" onClick={() => void refetch()}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        Coba Lagi
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : sites.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <MapPin className="h-8 w-8 text-text-secondary" />
                      <p className="text-text-secondary text-sm">
                        Belum ada lokasi. Tambah lokasi untuk memulai.
                      </p>
                      <Button variant="outline" size="sm" onClick={openAdd}>
                        <Plus className="h-3.5 w-3.5" />
                        Tambah Lokasi
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                sites.map((site) => (
                  <tr
                    key={site.id}
                    className="border-t border-divider hover:bg-surface transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-brand flex-shrink-0" />
                        <span className="font-medium text-text-primary">{site.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <a
                        href={`https://maps.google.com/?q=${site.latitude},${site.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand hover:underline font-mono"
                      >
                        {site.latitude.toFixed(5)}, {site.longitude.toFixed(5)}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-text-secondary">{site.radius_meter} m</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="info">
                        {TIMEZONE_SHORT[site.timezone] ?? site.timezone}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(site)}
                          aria-label={`Ubah lokasi ${site.name}`}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setDeletingSite(site)}
                          aria-label={`Hapus lokasi ${site.name}`}
                          title="Hapus"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <SiteFormModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingSite(null) }}
        editingSite={editingSite}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingSite}
        onOpenChange={(open) => !open && setDeletingSite(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Lokasi</AlertDialogTitle>
            <AlertDialogDescription>
              Apakah Anda yakin ingin menghapus lokasi{' '}
              <strong>{deletingSite?.name}</strong>?{' '}
              Semua shift yang terkait dengan lokasi ini juga akan dihapus.
              Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingSite && deleteMutation.mutate(deletingSite.id)}
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
