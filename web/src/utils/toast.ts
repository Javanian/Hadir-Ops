import { toast } from 'sonner'
import { t } from '@/i18n'

export function showSuccess(msg: string, title = t('toast.success')) {
  toast.success(title, { description: msg })
}

export function showError(msg: string, title = t('toast.somethingWentWrong')) {
  toast.error(title, { description: msg })
}

export function showInfo(msg: string, title = 'Info') {
  toast.info(title, { description: msg })
}
