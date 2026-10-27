import { CLOUD_CONFIG } from './config.js';
import { isCloudConfigured } from './cloud-sync.js';

export async function createAccountClient() {
  if (!isCloudConfigured(CLOUD_CONFIG)) return null;
  if (!globalThis.supabase?.createClient) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
      script.crossOrigin = 'anonymous';
      script.onload = resolve;
      script.onerror = () => reject(new Error('登入服務載入失敗，請檢查網路後重新整理。'));
      document.head.append(script);
    });
  }
  if (!globalThis.supabase?.createClient) throw new Error('登入服務無法啟動，請稍後重試。');
  return globalThis.supabase.createClient(CLOUD_CONFIG.supabaseUrl, CLOUD_CONFIG.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
}

export function friendlyAuthError(error) {
  const code = error?.code || '';
  const message = String(error?.message || '');
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return 'Email 或密碼不正確。';
  if (code === 'email_not_confirmed') return '請先點選驗證信中的連結，再登入。';
  if (/rate|too many|over_email_send_rate_limit/i.test(code + message)) return '操作太頻繁，請稍後再試。';
  if (/fetch|network/i.test(message)) return '目前無法連線。請檢查網路後再試。';
  if (/password/i.test(code + message)) return '密碼不符合要求，請使用至少 8 個字元，並依服務提示增加強度。';
  if (/email_address_not_authorized|email.*not.*allowed/i.test(code + message)) return '目前尚未開放寄信至此 Email，請聯繫網站管理者。';
  if (/user_already_exists/i.test(code)) return '此 Email 可能已註冊，請嘗試登入或重設密碼。';
  return '操作未完成，請稍後重試；如持續發生，請聯繫網站管理者。';
}
