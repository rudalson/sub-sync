mod backend;
mod commands;
mod files;
mod project;
mod stream;
#[cfg(test)]
mod tests;

use std::sync::Arc;
use tauri::Manager;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state =
                backend::Backend::new(app.path().app_data_dir()?, app.path().resource_dir()?)
                    .map_err(std::io::Error::other)?;
            app.manage(Arc::new(state));
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("media", |context, request, responder| {
            let state = context
                .app_handle()
                .state::<backend::Shared>()
                .inner()
                .clone();
            tauri::async_runtime::spawn_blocking(move || {
                let token = request.uri().path().trim_start_matches('/');
                let path = state.streams.read().unwrap().get(token).cloned();
                let response = path
                    .and_then(|path| stream::serve(&path, &request).ok())
                    .unwrap_or_else(|| {
                        tauri::http::Response::builder()
                            .status(404)
                            .body(Vec::new())
                            .unwrap()
                    });
                responder.respond(response);
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_media,
            commands::open_media,
            commands::load_peaks,
            commands::pick_srt,
            commands::save_srt,
            commands::pick_export_path,
            commands::confirm,
            commands::load_project,
            commands::pick_project,
            commands::save_project,
            commands::autosave_project,
            commands::load_settings,
            commands::save_settings,
            commands::start_stt,
            commands::cancel_stt,
            commands::start_export,
            commands::cancel_export,
            commands::close_window
        ])
        .build(tauri::generate_context!())
        .expect("Sub Sync 실행 실패");
    app.run(|app, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            app.state::<backend::Shared>().cancel_jobs();
        }
    });
}
