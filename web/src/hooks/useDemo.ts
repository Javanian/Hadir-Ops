import { useMutation, useQuery } from '@tanstack/react-query'
import { demoApi, type DemoRole } from '@/api/demo.api'
import { useCompleteLogin } from '@/hooks/useAuth'

/** Demo status; on a normal server this is `{ enabled: false }` and nothing shows. */
export function useDemoInfo() {
  return useQuery({
    queryKey: ['demo'],
    queryFn: demoApi.info,
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
}

export function useDemoLogin() {
  const completeLogin = useCompleteLogin()
  return useMutation({
    mutationFn: (role: DemoRole) => demoApi.login(role),
    onSuccess: completeLogin,
  })
}
