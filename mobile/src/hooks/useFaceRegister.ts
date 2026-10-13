import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { faceApi } from '../api/face.api';
import { FaceRegisterResponse, FaceVerifyResponse } from '../types/face';

export function useFaceStatus(userId: number | undefined) {
  return useQuery({
    queryKey: ['face', 'status', userId],
    queryFn: () => faceApi.getStatus(userId!),
    enabled: userId != null,
    staleTime: 60 * 1000,
  });
}

export function useFaceRegister() {
  const queryClient = useQueryClient();
  return useMutation<FaceRegisterResponse, Error, { userId: number; imageUri: string }>({
    mutationFn: ({ userId, imageUri }) => faceApi.register(userId, imageUri),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['face', 'status'] });
    },
  });
}

export function useFaceVerify() {
  return useMutation<FaceVerifyResponse, Error, { userId: number; imageUri: string }>({
    mutationFn: ({ userId, imageUri }) => faceApi.verify(userId, imageUri),
  });
}
