import Toast from 'react-native-toast-message';

export function showSuccess(msg: string, title = 'Berhasil') {
  Toast.show({ type: 'success', text1: title, text2: msg, position: 'bottom', visibilityTime: 3000 });
}

export function showError(msg: string, title = 'Terjadi Kesalahan') {
  Toast.show({ type: 'error', text1: title, text2: msg, position: 'bottom', visibilityTime: 4000 });
}

export function showInfo(msg: string, title = 'Info') {
  Toast.show({ type: 'info', text1: title, text2: msg, position: 'bottom', visibilityTime: 3000 });
}
