//! Desktop completion alerts: Windows native toast notification (click-to-focus)
//! and taskbar attention flash when the editor is in the background.

use std::path::Path;
use tauri::{AppHandle, Manager, UserAttentionType};

#[cfg(windows)]
const AUMID: &str = "dev.subsync.editor";
#[cfg(windows)]
const APP_NAME: &str = "Sub Sync";
#[cfg(windows)]
const APP_ICON: &[u8] = include_bytes!("../icons/icon.png");

/// Escape XML special characters and strip control characters invalid in XML 1.0.
fn escape_xml(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c if c.is_control() && c != '\t' && c != '\n' && c != '\r' => {}
            c => out.push(c),
        }
    }
    out
}

/// Build the Windows `ToastGeneric` payload. Newlines in `body` become separate text lines.
pub fn build_toast_xml(title: &str, body: &str) -> String {
    let mut xml = String::from(r#"<toast><visual><binding template="ToastGeneric"><text>"#);
    xml.push_str(&escape_xml(title.trim()));
    xml.push_str("</text>");
    for line in body
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(3)
    {
        xml.push_str("<text>");
        xml.push_str(&escape_xml(line));
        xml.push_str("</text>");
    }
    xml.push_str("</binding></visual></toast>");
    xml
}

/// Flash the taskbar icon when the editor is unfocused and show an OS desktop notification.
pub fn send(app: &AppHandle, data_dir: &Path, title: &str, body: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if !window.is_focused().unwrap_or(false) {
            let _ = window.request_user_attention(Some(UserAttentionType::Informational));
        }
    }
    #[cfg(windows)]
    {
        windows_toast::show(app, data_dir, title, body)?;
    }
    #[cfg(not(windows))]
    {
        let _ = (data_dir, title, body);
    }
    Ok(())
}

/// Release any retained native notification handle before process exit.
pub fn clear() {
    #[cfg(windows)]
    windows_toast::clear();
}

#[cfg(all(test, windows))]
pub(crate) fn show_test_toast(data_dir: &Path, title: &str, body: &str) -> Result<(), String> {
    windows_toast::show_with_handler::<fn()>(data_dir, title, body, None)
}

#[cfg(windows)]
mod windows_toast {
    use super::{build_toast_xml, APP_ICON, APP_NAME, AUMID};
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::Mutex,
    };
    use tauri::{AppHandle, Manager};
    use windows::{
        core::{HSTRING, IInspectable, PCWSTR},
        Data::Xml::Dom::XmlDocument,
        Foundation::TypedEventHandler,
        UI::Notifications::{ToastNotification, ToastNotificationManager},
        Win32::System::{
            Com::{CoInitializeEx, COINIT_MULTITHREADED},
            Registry::{
                RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE,
                REG_OPTION_NON_VOLATILE, REG_SZ,
            },
        },
    };

    /// Keep the latest toast alive so its `Activated` click handler stays registered.
    static ACTIVE_TOAST: Mutex<Option<ToastNotification>> = Mutex::new(None);

    pub fn clear() {
        if let Ok(mut slot) = ACTIVE_TOAST.lock() {
            *slot = None;
        }
    }

    fn ensure_icon(data_dir: &Path) -> Option<PathBuf> {
        let path = data_dir.join("app-icon.png");
        let up_to_date = fs::metadata(&path)
            .map(|meta| meta.len() == APP_ICON.len() as u64)
            .unwrap_or(false);
        if !up_to_date {
            let _ = fs::create_dir_all(data_dir);
            fs::write(&path, APP_ICON).ok()?;
        }
        Some(path)
    }

    fn wide_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn set_reg_sz(key: HKEY, name: &str, value: &str) {
        let name_w = wide_null(name);
        let value_w = wide_null(value);
        let bytes = unsafe {
            std::slice::from_raw_parts(value_w.as_ptr().cast::<u8>(), value_w.len() * 2)
        };
        unsafe {
            let _ = RegSetValueExW(
                key,
                PCWSTR(name_w.as_ptr()),
                Some(0),
                REG_SZ,
                Some(bytes),
            );
        }
    }

    /// Register `HKCU\Software\Classes\AppUserModelId\<AUMID>` so unpackaged / portable `.exe`
    /// builds can show Windows 10/11 toast notifications with the Sub Sync name and icon.
    fn register_aumid(icon: Option<&Path>) {
        let subkey = wide_null(&format!(r"Software\Classes\AppUserModelId\{AUMID}"));
        let mut key = HKEY::default();
        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(subkey.as_ptr()),
                Some(0),
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                None,
                &mut key,
                None,
            )
        };
        if status.is_err() {
            return;
        }
        set_reg_sz(key, "DisplayName", APP_NAME);
        if let Some(path) = icon.and_then(|p| p.to_str()) {
            set_reg_sz(key, "IconUri", path);
        }
        unsafe {
            let _ = RegCloseKey(key);
        }
    }

    pub fn show(app: &AppHandle, data_dir: &Path, title: &str, body: &str) -> Result<(), String> {
        let handle = app.clone();
        show_with_handler(data_dir, title, body, Some(move || {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
    }

    pub fn show_with_handler<F>(
        data_dir: &Path,
        title: &str,
        body: &str,
        on_activate: Option<F>,
    ) -> Result<(), String>
    where
        F: Fn() + Send + Sync + 'static,
    {
        // Ensure COM is initialized on this worker thread (RPC_E_CHANGED_MODE is fine if already STA).
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }

        let icon = ensure_icon(data_dir);
        register_aumid(icon.as_deref());

        let xml = build_toast_xml(title, body);
        let doc = XmlDocument::new().map_err(|e| format!("알림 XML 생성 실패: {e}"))?;
        doc.LoadXml(&HSTRING::from(xml))
            .map_err(|e| format!("알림 XML 로드 실패: {e}"))?;

        let toast = ToastNotification::CreateToastNotification(&doc)
            .map_err(|e| format!("알림 생성 실패: {e}"))?;

        if let Some(callback) = on_activate {
            let activated =
                TypedEventHandler::<ToastNotification, IInspectable>::new(move |_, _| {
                    callback();
                    Ok(())
                });
            let _ = toast.Activated(&activated);
        }

        let notifier =
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(AUMID))
                .map_err(|e| format!("알림 전송기 생성 실패: {e}"))?;
        notifier
            .Show(&toast)
            .map_err(|e| format!("Windows 알림 표시 실패: {e}"))?;

        if let Ok(mut slot) = ACTIVE_TOAST.lock() {
            *slot = Some(toast);
        }
        Ok(())
    }
}
