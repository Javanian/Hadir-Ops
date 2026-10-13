import { TOKEN_KEYS, persistTokens, getStoredTokens } from '../store/authStore';
import { FaceStatus, FaceRegisterResponse, FaceVerifyResponse } from '../types/face';
import { apiClient, BASE_URL } from './axios';

// Uploads FormData using XMLHttpRequest (same engine Axios uses for all API calls).
//
// Why not native fetch:
//   - Axios's transformRequest serializes RN's FormData polyfill to '{}' → can't use apiClient
//   - Native fetch with a FormData file URI body fails on the very first call on Android
//     (first-call initialization issue in RN's fetch implementation); subsequent calls succeed.
//   - XHR is fully initialized by login time and handles FormData file URIs reliably.
//
// Errors are shaped to match AxiosError so existing modal error handlers work unchanged:
//   isAxiosError(e) → true  (Axios checks `e.isAxiosError === true`, nothing else)
//   e.response.status / e.response.data.detail / e.config.baseURL — all present
type _FakeRes = { status: number; ok: boolean; json: () => Promise<unknown> };

function _xhrPost(url: string, token: string | null, formData: FormData): Promise<_FakeRes> {
  return new Promise<_FakeRes>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'text';
    xhr.onload = () => {
      const text: string = xhr.responseText;
      resolve({
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        json: () => { try { return Promise.resolve(JSON.parse(text)); } catch { return Promise.resolve({}); } },
      });
    };
    xhr.onerror = () => reject(new Error('Network request failed'));
    xhr.ontimeout = () => reject(new Error('Network request failed'));
    xhr.send(formData);
  });
}

async function faceUpload<T>(path: string, formData: FormData): Promise<T> {
  console.log('[faceUpload] BASE_URL:', BASE_URL);
  console.log('[faceUpload] full URL:', `${BASE_URL}${path}`);

  const { access: token } = await getStoredTokens();
  console.log('[faceUpload] token present:', !!token);

  // First-call on Android sometimes fails with a transient network error; retry once.
  let res = await _xhrPost(`${BASE_URL}${path}`, token, formData)
    .catch(() => _xhrPost(`${BASE_URL}${path}`, token, formData))
    .catch((cause: unknown) => {
      const err: any = new Error(cause instanceof Error ? cause.message : 'Network request failed');
      err.isAxiosError = true;
      err.config = { baseURL: BASE_URL };
      throw err;
    });

  if (res.status === 401) {
    // Access token expired — refresh and retry once
    const { refresh: refreshToken } = await getStoredTokens();
    if (!refreshToken) {
      const err: any = new Error('Sesi habis. Silakan login kembali.');
      err.isAxiosError = true;
      throw err;
    }
    const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!refreshRes.ok) {
      const err: any = new Error('Sesi habis. Silakan login kembali.');
      err.isAxiosError = true;
      throw err;
    }
    await persistTokens(await refreshRes.json());
    const { access: newToken } = await getStoredTokens();
    res = await _xhrPost(`${BASE_URL}${path}`, newToken, formData).catch((cause: unknown) => {
      const err: any = new Error(cause instanceof Error ? cause.message : 'Network request failed');
      err.isAxiosError = true;
      err.config = { baseURL: BASE_URL };
      throw err;
    });
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: any = new Error((body as any)?.detail ?? `HTTP ${res.status}`);
    err.isAxiosError = true;
    err.response = { status: res.status, data: body };
    err.config = { baseURL: BASE_URL };
    throw err;
  }

  return res.json() as Promise<T>;
}

export const faceApi = {
  getStatus: (userId: number): Promise<FaceStatus> =>
    apiClient.get<FaceStatus>(`/face/status/${userId}`).then((r) => r.data),

  register: (userId: number, imageUri: string): Promise<FaceRegisterResponse> => {
    const formData = new FormData();
    formData.append('file', { uri: imageUri, name: 'face.jpg', type: 'image/jpeg' } as unknown as Blob);
    return faceUpload<FaceRegisterResponse>(`/face/register/${userId}`, formData);
  },

  verify: (userId: number, imageUri: string): Promise<FaceVerifyResponse> => {
    const formData = new FormData();
    formData.append('file', { uri: imageUri, name: 'face.jpg', type: 'image/jpeg' } as unknown as Blob);
    return faceUpload<FaceVerifyResponse>(`/face/verify/${userId}`, formData);
  },
};
