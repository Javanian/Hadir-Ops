import type { UserInfo } from '../types/auth';
import { t } from '../i18n'

/** Indonesian label for a role, shared by every screen that shows one. */
export function roleLabel(role: UserInfo['role'] | string | undefined | null): string {
  switch (role) {
    case 'ADMIN': return 'Admin';
    case 'SUPERVISOR': return 'Supervisor';
    case 'EMPLOYEE': return t('common.employee');
    case 'SALES': return 'Sales';
    default: return role ?? '-';
  }
}
