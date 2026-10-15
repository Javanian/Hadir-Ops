import type { UserInfo } from '../types/auth';

/** Indonesian label for a role, shared by every screen that shows one. */
export function roleLabel(role: UserInfo['role'] | string | undefined | null): string {
  switch (role) {
    case 'ADMIN': return 'Admin';
    case 'SUPERVISOR': return 'Supervisor';
    case 'EMPLOYEE': return 'Karyawan';
    case 'SALES': return 'Sales';
    default: return role ?? '-';
  }
}
