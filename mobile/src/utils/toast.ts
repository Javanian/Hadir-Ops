import Toast from 'react-native-toast-message';
import { t } from '../i18n'

export function showSuccess(msg: string, title = t('toast.success')) {
  Toast.show({ type: 'success', text1: title, text2: msg, position: 'bottom', visibilityTime: 3000 });
}

export function showError(msg: string, title = t('toast.somethingWentWrong')) {
  Toast.show({ type: 'error', text1: title, text2: msg, position: 'bottom', visibilityTime: 4000 });
}

export function showInfo(msg: string, title = 'Info') {
  Toast.show({ type: 'info', text1: title, text2: msg, position: 'bottom', visibilityTime: 3000 });
}
