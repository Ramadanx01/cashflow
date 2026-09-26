/* Optional Google Drive backup; local IndexedDB remains the source of truth. */
const CashflowDriveBackup = (() => {
  const CONFIG = {
    clientId: '',
    apiKey: '',
    appId: ''
  };
  const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
  const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
  const GOOGLE_API_SCRIPT = 'https://apis.google.com/js/api.js';
  let preloadPromise;

  function isConfigured() {
    return Boolean(CONFIG.clientId && CONFIG.apiKey && CONFIG.appId);
  }

  function loadScript(source, isReady) {
    if (isReady()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(script => script.src === source);
      const script = existing || document.createElement('script');
      script.async = true;
      script.onload = () => isReady() ? resolve() : reject(new Error('Google library did not initialize.'));
      script.onerror = () => reject(new Error('Could not load Google Drive tools.'));
      if (!existing) {
        script.src = source;
        document.head.appendChild(script);
      }
    });
  }

  function loadPickerLibrary() {
    return new Promise((resolve, reject) => {
      if (window.google?.picker) return resolve();
      window.gapi.load('picker', {
        callback: resolve,
        onerror: () => reject(new Error('Google Drive file picker could not load.')),
        timeout: 10000,
        ontimeout: () => reject(new Error('Google Drive file picker timed out.'))
      });
    });
  }

  function preload() {
    if (!isConfigured()) return Promise.reject(new Error('Google Drive has not been configured.'));
    if (!preloadPromise) {
      preloadPromise = Promise.all([
        loadScript(GOOGLE_IDENTITY_SCRIPT, () => Boolean(window.google?.accounts?.oauth2)),
        loadScript(GOOGLE_API_SCRIPT, () => Boolean(window.gapi?.load))
      ]).then(loadPickerLibrary).catch(error => {
        preloadPromise = null;
        throw error;
      });
    }
    return preloadPromise;
  }

  function requestAccessToken(email = '', selectAccount = false) {
    if (!isConfigured()) return Promise.reject(new Error('Google Drive has not been configured.'));
    if (!window.google?.accounts?.oauth2) return Promise.reject(new Error('Google Drive tools are still loading.'));

    return new Promise((resolve, reject) => {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.clientId,
        scope: DRIVE_FILE_SCOPE,
        callback: response => {
          if (response.error) reject(new Error(response.error_description || response.error));
          else resolve(response.access_token);
        },
        error_callback: error => reject(new Error(error.message || 'Google sign-in was closed.'))
      });
      tokenClient.requestAccessToken({
        prompt: selectAccount ? 'select_account' : '',
        login_hint: email || undefined
      });
    });
  }

  function getLinkedAccount() {
    return CashflowStorage.get('metadata', 'google-drive-account');
  }

  function getBackupFolder() {
    return CashflowStorage.get('metadata', 'google-drive-folder');
  }

  function linkAccount() {
    const tokenPromise = requestAccessToken('', true);
    return tokenPromise.then(async accessToken => {
      const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const profile = await response.json();
      if (!response.ok || !profile.email) throw new Error(profile.error_description || 'تعذر قراءة حساب Google المختار.');
      const account = { email: profile.email, name: profile.name || '', linkedAt: new Date().toISOString() };
      await CashflowStorage.put('metadata', account, 'google-drive-account');
      await CashflowStorage.remove('metadata', 'google-drive-folder');
      return account;
    });
  }

  async function setBackupFolder(folder) {
    const savedFolder = { id: folder.id, name: folder.name || 'مجلد Drive' };
    await CashflowStorage.put('metadata', savedFolder, 'google-drive-folder');
    return savedFolder;
  }

  async function unlinkAccount() {
    await CashflowStorage.remove('metadata', 'google-drive-account');
    await CashflowStorage.remove('metadata', 'google-drive-folder');
  }

  function showPicker(accessToken, view, title) {
    return new Promise(resolve => {
      const picker = new google.picker.PickerBuilder()
        .setAppId(CONFIG.appId)
        .setDeveloperKey(CONFIG.apiKey)
        .setOAuthToken(accessToken)
        .setOrigin(window.location.protocol + '//' + window.location.host)
        .setTitle(title)
        .setLocale('ar')
        .addView(view)
        .setCallback(data => {
          if (data.action === google.picker.Action.PICKED) resolve(data.docs[0] || null);
          if (data.action === google.picker.Action.CANCEL) resolve(null);
        })
        .build();
      picker.setVisible(true);
    });
  }

  function pickFolder(accessToken) {
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder');
    return showPicker(accessToken, view, 'اختر مجلد حفظ النسخة الاحتياطية');
  }

  function pickBackupFile(accessToken) {
    const view = new google.picker.DocsView()
      .setIncludeFolders(false)
      .setMimeTypes('application/json');
    return showPicker(accessToken, view, 'اختر ملف النسخة الاحتياطية');
  }

  async function uploadBackup(accessToken, folderId, backup) {
    const boundary = `cashflow-${crypto.randomUUID()}`;
    const metadata = {
      name: `cashflow_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      mimeType: 'application/json',
      parents: [folderId]
    };
    const body = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(backup, null, 2)}\r\n`,
      `--${boundary}--`
    ].join('');
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'Google Drive could not save the backup.');
    return result;
  }

  async function downloadBackup(accessToken, fileId) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error?.message || 'Google Drive could not download this backup.');
    }
    return response.json();
  }

  return {
    isConfigured,
    preload,
    requestAccessToken,
    getLinkedAccount,
    getBackupFolder,
    linkAccount,
    setBackupFolder,
    unlinkAccount,
    pickFolder,
    pickBackupFile,
    uploadBackup,
    downloadBackup
  };
})();