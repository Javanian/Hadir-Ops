import { toast } from 'sonner'

export function showSuccess(msg: string, title = 'Berhasil') {
  toast.success(title, { description: msg })
}

export function showError(msg: string, title = 'Terjadi Kesalahan') {
  toast.error(title, { description: msg })
}

export function showInfo(msg: string, title = 'Info') {
  toast.info(title, { description: msg })
}
