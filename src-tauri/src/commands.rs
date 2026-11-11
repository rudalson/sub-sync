use crate::{
    backend::{self, Shared},
    files,
    project::{self, MediaInfo, ProjectFile, SavedProject, Settings, SttOptions},
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

async fn worker<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| e.to_string())?
}
fn pick(
    window: &WebviewWindow,
    title: &str,
    name: &str,
    extensions: &[&str],
    initial: Option<&Path>,
) -> Result<Option<PathBuf>, String> {
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(window)
        .set_title(title)
        .add_filter(name, extensions);
    if let Some(path) = initial {
        if let Some(parent) = path.parent() {
            dialog = dialog.set_directory(parent);
        }
    }
    dialog
        .blocking_pick_file()
        .map(|path| path.into_path().map_err(|e| e.to_string()))
        .transpose()
}
fn save(
    window: &WebviewWindow,
    default: &str,
    name: &str,
    extensions: &[&str],
) -> Result<Option<PathBuf>, String> {
    let path = Path::new(default);
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(window)
        .add_filter(name, extensions);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            dialog = dialog.set_directory(parent);
        }
    }
    if let Some(name) = path.file_name() {
        dialog = dialog.set_file_name(name.to_string_lossy());
    }
    dialog
        .blocking_save_file()
        .map(|path| path.into_path().map_err(|e| e.to_string()))
        .transpose()
}
const VIDEO: &[&str] = &[
    "mp4", "mkv", "mov", "webm", "avi", "m4v", "wmv", "ts", "flv",
];
#[tauri::command]
pub async fn pick_media(
    window: WebviewWindow,
    state: State<'_, Shared>,
) -> Result<Option<String>, String> {
    let state = state.inner().clone();
    worker(move || {
        let path = pick(&window, "영상 열기", "영상", VIDEO, None)?;
        if let Some(path) = &path {
            state.allow(path)?;
        }
        Ok(path.map(|p| p.to_string_lossy().into_owned()))
    })
    .await
}
#[tauri::command]
pub async fn open_media(
    path: String,
    app: AppHandle,
    state: State<'_, Shared>,
) -> Result<MediaInfo, String> {
    let state = state.inner().clone();
    worker(move || {
        state.require_media(Path::new(&path))?;
        backend::open_media(&state, Some(&app), Path::new(&path))
    })
    .await
}
#[tauri::command]
pub async fn load_peaks(
    path: String,
    state: State<'_, Shared>,
) -> Result<tauri::ipc::Response, String> {
    let state = state.inner().clone();
    Ok(tauri::ipc::Response::new(
        worker(move || backend::load_peaks(&state, Path::new(&path))).await?,
    ))
}
#[derive(Serialize)]
pub struct SrtFile {
    path: String,
    content: String,
}
#[tauri::command]
pub async fn pick_srt(window: WebviewWindow) -> Result<Option<SrtFile>, String> {
    worker(move || {
        let Some(path) = pick(&window, "SRT 불러오기", "SRT 자막", &["srt"], None)? else {
            return Ok(None);
        };
        Ok(Some(SrtFile {
            content: files::decode_subtitle(&fs::read(&path).map_err(|e| e.to_string())?)?,
            path: path.to_string_lossy().into_owned(),
        }))
    })
    .await
}
#[tauri::command]
pub async fn save_srt(
    window: WebviewWindow,
    content: String,
    path: Option<String>,
    default_path: String,
) -> Result<Option<String>, String> {
    worker(move || {
        let target = if let Some(path) = path {
            Some(PathBuf::from(path))
        } else {
            save(&window, &default_path, "SRT 자막", &["srt"])?
        };
        if let Some(path) = &target {
            files::atomic_write(path, content.as_bytes())?;
        }
        Ok(target.map(|p| p.to_string_lossy().into_owned()))
    })
    .await
}
#[tauri::command]
pub async fn pick_export_path(
    window: WebviewWindow,
    default_path: String,
) -> Result<Option<String>, String> {
    worker(move || {
        Ok(save(&window, &default_path, "MP4 영상", &["mp4"])?
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
}
#[tauri::command]
pub async fn confirm(
    window: WebviewWindow,
    message: String,
    detail: Option<String>,
) -> Result<bool, String> {
    worker(move || {
        Ok(window
            .dialog()
            .message(if let Some(detail) = detail {
                format!("{message}\n\n{detail}")
            } else {
                message
            })
            .title("Sub Sync")
            .parent(&window)
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "계속".into(),
                "취소".into(),
            ))
            .blocking_show())
    })
    .await
}
#[tauri::command]
pub async fn load_project(
    media_path: String,
    state: State<'_, Shared>,
) -> Result<Option<SavedProject>, String> {
    let state = state.inner().clone();
    worker(move || {
        state.require_media(Path::new(&media_path))?;
        let _lock = state.writes.lock().unwrap();
        let path = project::autosave_path(&media_path);
        if !path.exists() {
            return Ok(None);
        }
        let project = project::read(&path)?;
        if project.size() != fs::metadata(media_path).map_err(|e| e.to_string())?.len() {
            return Err("자동 저장된 프로젝트와 영상 크기가 다릅니다.".into());
        }
        Ok(Some(project))
    })
    .await
}
#[derive(Serialize)]
pub struct OpenedProject {
    path: String,
    project: SavedProject,
    media: MediaInfo,
}
#[tauri::command]
pub async fn pick_project(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Shared>,
) -> Result<Option<OpenedProject>, String> {
    let state = state.inner().clone();
    worker(move || {
        let Some(path) = pick(
            &window,
            "프로젝트 열기",
            "Sub Sync 프로젝트",
            &[project::EXTENSION],
            None,
        )?
        else {
            return Ok(None);
        };
        if !project::is_project_path(&path) {
            return Err("Sub Sync 프로젝트(.subsync) 파일만 열 수 있습니다.".into());
        }
        let project = {
            let _lock = state.writes.lock().unwrap();
            project::read(&path)?
        };
        let media_path = if let Some(path) = project::find_media(&path, &project) {
            path
        } else {
            let Some(path) = pick(
                &window,
                "원본 영상을 찾을 수 없습니다. 영상을 다시 연결해 주세요.",
                "영상",
                VIDEO,
                project.original_path().map(Path::new),
            )?
            else {
                return Ok(None);
            };
            path
        };
        if fs::metadata(&media_path).map_err(|e| e.to_string())?.len() != project.size() {
            return Err(
                "저장된 프로젝트와 영상 크기가 다릅니다. 원본 영상을 선택해 주세요.".into(),
            );
        }
        let media = backend::open_media(&state, Some(&app), &media_path)?;
        project.validate_media(&media)?;
        Ok(Some(OpenedProject {
            path: path.to_string_lossy().into_owned(),
            project,
            media,
        }))
    })
    .await
}
#[tauri::command]
pub async fn save_project(
    window: WebviewWindow,
    project: ProjectFile,
    path: Option<String>,
    default_path: String,
    state: State<'_, Shared>,
) -> Result<Option<String>, String> {
    let state = state.inner().clone();
    worker(move || {
        project.validate()?;
        let target = if let Some(path) = path {
            Some(PathBuf::from(path))
        } else {
            save(
                &window,
                &default_path,
                "Sub Sync 프로젝트",
                &[project::EXTENSION],
            )?
        }
        .map(project::with_extension);
        if let Some(path) = &target {
            let _lock = state.writes.lock().unwrap();
            project::write(path, &project)?;
        }
        Ok(target.map(|p| p.to_string_lossy().into_owned()))
    })
    .await
}
#[tauri::command]
pub async fn autosave_project(
    media_path: String,
    project: ProjectFile,
    state: State<'_, Shared>,
) -> Result<(), String> {
    let state = state.inner().clone();
    worker(move || {
        state.require_media(Path::new(&media_path))?;
        if Path::new(&project.media.path) != Path::new(&media_path) {
            return Err("자동 저장 대상 영상이 다릅니다.".into());
        }
        let _lock = state.writes.lock().unwrap();
        project::write(&project::autosave_path(&media_path), &project)
    })
    .await
}
#[tauri::command]
pub async fn load_settings(
    app: AppHandle,
    state: State<'_, Shared>,
) -> Result<serde_json::Value, String> {
    let current = state.data_dir.join("settings.json");
    let legacy = app
        .path()
        .config_dir()
        .map_err(|e| e.to_string())?
        .join("sub-sync/settings.json");
    worker(move || {
        let path = if current.exists() { current } else { legacy };
        if !path.exists() {
            return Ok(serde_json::json!({}));
        }
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    })
    .await
}
#[tauri::command]
pub async fn save_settings(settings: Settings, state: State<'_, Shared>) -> Result<(), String> {
    let state = state.inner().clone();
    worker(move || {
        settings.validate()?;
        let _lock = state.writes.lock().unwrap();
        files::atomic_write(
            &state.data_dir.join("settings.json"),
            &serde_json::to_vec(&settings).map_err(|e| e.to_string())?,
        )
    })
    .await
}
#[tauri::command]
pub async fn start_stt(
    app: AppHandle,
    state: State<'_, Shared>,
    media_path: String,
    options: SttOptions,
    hotwords: String,
) -> Result<(), String> {
    let state = state.inner().clone();
    worker(move || backend::start_stt(state, app, media_path, options, hotwords)).await
}
#[tauri::command]
pub fn cancel_stt(state: State<'_, Shared>) {
    backend::cancel(&state.stt);
}
#[tauri::command]
pub async fn sentence_boundaries(
    words: Vec<String>,
    state: State<'_, Shared>,
) -> Result<Vec<usize>, String> {
    let state = state.inner().clone();
    worker(move || backend::sentence_boundaries(&state, words)).await
}
#[tauri::command]
pub async fn list_fonts(state: State<'_, Shared>) -> Result<Vec<crate::fonts::FontFamily>, String> {
    let state = state.inner().clone();
    worker(move || Ok(state.fonts().families.clone())).await
}
#[tauri::command]
pub async fn start_export(
    app: AppHandle,
    state: State<'_, Shared>,
    request: backend::ExportRequest,
) -> Result<(), String> {
    let state = state.inner().clone();
    worker(move || backend::export_video(state, Some(app), request)).await
}
#[tauri::command]
pub fn cancel_export(state: State<'_, Shared>) {
    backend::cancel(&state.export);
}
#[tauri::command]
pub fn close_window(window: WebviewWindow, state: State<'_, Shared>) -> Result<(), String> {
    state.cancel_jobs();
    window.destroy().map_err(|e| e.to_string())
}
