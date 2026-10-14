import { TOKEN_KEYS, persistTokens, getStoredTokens } from '../store/authStore';
import { FaceStatus, FaceRegisterResponse, FaceVerifyResponse } from '../types/face';
import { AttendanceRecord } from '../types/attendance';
import { Platform } from 'react-native';
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
    // Without a timeout a weak signal can leave the request hanging forever.
    xhr.timeout = 20_000;
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
  const { access: token } = await getStoredTokens();

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

/**
 * FormData with the photo. React Native accepts a { uri, name, type } object;
 * a browser needs the actual Blob, which the camera's data/blob URI resolves to.
 */
async function photoForm(imageUri: string): Promise<FormData> {
  const formData = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(imageUri)).blob();
    formData.append('file', blob, 'face.jpg');
  } else {
    formData.append('file', { uri: imageUri, name: 'face.jpg', type: 'image/jpeg' } as unknown as Blob);
  }
  return formData;
}

export const faceApi = {
  getStatus: (userId: number): Promise<FaceStatus> =>
    apiClient.get<FaceStatus>(`/face/status/${userId}`).then((r) => r.data),

  register: async (userId: number, imageUri: string): Promise<FaceRegisterResponse> =>
    faceUpload<FaceRegisterResponse>(`/face/register/${userId}`, await photoForm(imageUri)),

  verify: async (userId: number, imageUri: string): Promise<FaceVerifyResponse> =>
    faceUpload<FaceVerifyResponse>(`/face/verify/${userId}`, await photoForm(imageUri)),

  /** Attach the photo taken with an offline check-in to the synced record. */
  attachToAttendance: async (attendanceId: number, imageUri: string): Promise<AttendanceRecord> =>
    faceUpload<AttendanceRecord>(`/attendance/${attendanceId}/face`, await photoForm(imageUri)),
};
