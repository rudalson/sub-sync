use crate::{
    backend::{self, Backend, ChildRegistration, Shared},
    files,
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::VecDeque,
    fs::{self, File},
    io::{self, BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Arc,
    thread,
};

#[derive(Clone, Debug, Serialize)]
pub struct ImportProgress {
    pub label: String,
    pub progress: Option<f64>,
}

pub fn validate_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    let url = tauri::Url::parse(value).map_err(|_| "올바른 영상 URL을 입력해 주세요.")?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || value.chars().any(char::is_whitespace)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("http:// 또는 https://로 시작하는 영상 URL을 입력해 주세요.".into());
    }
    Ok(url.into())
}

fn configure(command: &mut Command, state: &Backend, url: &str, target: &Path) {
    command
        .args([
            "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--playlist-items", "1",
            "--no-overwrites", "--windows-filenames", "--trim-filenames", "180",
            "--no-colors", "--newline", "--quiet", "--progress", "--progress-delta", "0.2",
            "--socket-timeout", "20", "--retries", "3", "--fragment-retries", "3",
            "--no-simulate", "--js-runtimes", "node", "--format", "bv*+ba/b",
            "--format-sort", "vcodec:h264,acodec:aac", "--merge-output-format", "mp4/mkv",
            "--break-match-filters", "!is_live",
            "--output", "%(title).140s [%(id)s].%(ext)s",
            "--progress-template",
            r#"download:sub-sync:{"type":"progress","downloaded":%(progress.downloaded_bytes)j,"total":%(progress.total_bytes,progress.total_bytes_estimate)j,"status":%(progress.status)j}"#,
            "--progress-template", r#"postprocess:sub-sync:{"type":"processing"}"#,
            "--print", r#"after_move:sub-sync:{"type":"done","path":%(filepath)j,"id":%(id)j}"#,
            // Separate from "done", so a field yt-dlp cannot fill never costs the downloaded path.
            "--print", r#"after_move:sub-sync-info:%(.{title,channel,description,tags,chapters})j"#,
        ])
        .arg("--paths")
        .arg(format!("home:{}", target.display()));
    let ffmpeg = state.tool("ffmpeg");
    if ffmpeg.is_file() {
        command.arg("--ffmpeg-location").arg(ffmpeg);
    }
    command
        .arg("--")
        .arg(url)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
}

fn spawn(state: &Backend, url: &str, target: &Path) -> Result<Child, String> {
    let bundled = state.resource_dir.join("tools").join(if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    });
    let executable = std::env::var_os("SUB_SYNC_YT_DLP")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            if bundled.is_file() {
                bundled
            } else {
                "yt-dlp".into()
            }
        });
    let mut command = backend::command(executable);
    configure(&mut command, state, url, target);
    match command.spawn() {
        Ok(child) => Ok(child),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut command = backend::command(backend::python(state)?);
            command.args(["-m", "yt_dlp"]);
            configure(&mut command, state, url, target);
            command
                .spawn()
                .map_err(|e| format!("영상 다운로드 도구를 실행할 수 없습니다: {e}"))
        }
        Err(error) => Err(format!("영상 다운로드 도구를 실행할 수 없습니다: {error}")),
    }
}

#[derive(Default)]
struct Output {
    path: Option<PathBuf>,
    video_id: Option<String>,
    /// Title, channel, description, tags and chapters: hints for the English clean-up agent.
    info: Option<Value>,
    errors: VecDeque<String>,
}
impl Output {
    fn line(&mut self, line: &str, progress: &impl Fn(ImportProgress)) {
        if let Some(info) = line.strip_prefix("sub-sync-info:") {
            if let Some(info) = serde_json::from_str::<Value>(info)
                .ok()
                .filter(Value::is_object)
            {
                self.info = Some(info);
            }
        } else if let Some(event) = line
            .strip_prefix("sub-sync:")
            .and_then(|text| serde_json::from_str::<Value>(text).ok())
        {
            match event["type"].as_str() {
                Some("done") => {
                    self.path = event["path"].as_str().map(PathBuf::from);
                    self.video_id = event["id"].as_str().map(str::to_owned);
                }
                Some("progress" | "processing") => {
                    let processing = event["type"] == "processing" || event["status"] == "finished";
                    let fraction = event["downloaded"]
                        .as_f64()
                        .zip(event["total"].as_f64())
                        .filter(|(_, total)| *total > 0.0)
                        .map(|(downloaded, total)| (downloaded / total).clamp(0.0, 1.0));
                    progress(ImportProgress {
                        label: if processing {
                            "영상 파일 준비 중"
                        } else {
                            "영상 다운로드 중"
                        }
                        .into(),
                        progress: if processing { None } else { fraction },
                    });
                }
                _ => {}
            }
        } else if !line.trim().is_empty() {
            self.errors.push_back(line.chars().take(1000).collect());
            if self.errors.len() > 8 {
                self.errors.pop_front();
            }
        }
    }
}
fn read_output(input: impl Read, progress: impl Fn(ImportProgress)) -> Output {
    let mut output = Output::default();
    for line in BufReader::new(input).lines().map_while(Result::ok) {
        output.line(&line, &progress);
    }
    output
}

fn same_contents(source: &Path, target: &Path) -> io::Result<bool> {
    let target_info = fs::symlink_metadata(target)?;
    if !target_info.is_file() || fs::metadata(source)?.len() != target_info.len() {
        return Ok(false);
    }
    let mut source = BufReader::with_capacity(64 * 1024, File::open(source)?);
    let mut target = BufReader::with_capacity(64 * 1024, File::open(target)?);
    loop {
        let a = source.fill_buf()?;
        let b = target.fill_buf()?;
        if a.is_empty() || b.is_empty() {
            return Ok(a.is_empty() && b.is_empty());
        }
        let count = a.len().min(b.len());
        if a[..count] != b[..count] {
            return Ok(false);
        }
        source.consume(count);
        target.consume(count);
    }
}

/// `<video stem>.info.json` beside the video, as yt-dlp names its own info files.
pub(crate) fn info_path(video: &Path) -> PathBuf {
    let mut name = video.file_stem().unwrap_or_default().to_os_string();
    name.push(".info.json");
    video.with_file_name(name)
}

/// Remove only the ID appended by our download template; brackets in the actual title survive.
pub(crate) fn finalize_filename(path: &Path, video_id: Option<&str>) -> io::Result<PathBuf> {
    let title = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .and_then(|stem| video_id.and_then(|id| stem.strip_suffix(&format!(" [{id}]"))))
        .filter(|title| !title.is_empty());
    let (Some(title), Some(extension)) = (title, path.extension()) else {
        return Ok(path.to_path_buf());
    };
    for number in 1u64.. {
        let mut name = std::ffi::OsString::from(if number == 1 {
            title.to_owned()
        } else {
            format!("{title} ({number})")
        });
        name.push(".");
        name.push(extension);
        let target = path.with_file_name(name);
        match files::rename_no_replace(path, &target) {
            Ok(()) => return Ok(target),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists || target.exists() => {
                // Reimporting the same bytes reuses the completed file without rewriting it.
                if same_contents(path, &target)? {
                    fs::remove_file(path)?;
                    return Ok(target);
                }
            }
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::other(
        "사용 가능한 영상 파일명을 찾을 수 없습니다.",
    ))
}

pub fn import_video(
    state: Shared,
    url: &str,
    target: &Path,
    progress: impl Fn(ImportProgress) + Send + Sync + 'static,
) -> Result<String, String> {
    let url = validate_url(url)?;
    let target = target
        .canonicalize()
        .map_err(|_| "저장 폴더를 찾을 수 없습니다. 폴더를 다시 선택해 주세요.")?;
    if !target.is_dir() {
        return Err("영상을 저장할 폴더를 선택해 주세요.".into());
    }
    let (id, cancel) = backend::begin(&state.download)?;
    progress(ImportProgress {
        label: "영상 URL 확인 중".into(),
        progress: None,
    });
    let result = (|| {
        let mut child = spawn(&state, &url, &target)?;
        let _registration = ChildRegistration::new(&state, child.id());
        let tree = match ProcessTree::attach(&child) {
            Ok(tree) => tree,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let progress = Arc::new(progress);
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let updates = progress.clone();
        let output = thread::spawn(move || read_output(stdout, |event| updates(event)));
        let errors = thread::spawn(move || read_output(stderr, |event| progress(event)));
        let status = backend::wait(&mut child, &cancel, &state.shutdown);
        // Closing the job kills remaining FFmpeg/JS children before joining their output pipes.
        drop(tree);
        let output = output
            .join()
            .map_err(|_| "다운로드 결과를 읽을 수 없습니다.")?;
        let errors = errors
            .join()
            .map_err(|_| "다운로드 오류를 읽을 수 없습니다.")?;
        if !status?.success() {
            let detail = errors
                .errors
                .into_iter()
                .chain(output.errors)
                .collect::<Vec<_>>()
                .join("\n");
            return Err(if detail.contains("No module named yt_dlp") {
                "다운로드 도구가 없습니다. npm run setup:backend로 설치해 주세요.".into()
            } else if detail.is_empty() {
                "영상을 다운로드할 수 없습니다. URL을 확인해 주세요.".into()
            } else {
                format!("영상을 다운로드할 수 없습니다:\n{detail}")
            });
        }
        let video_id = output.video_id.or(errors.video_id);
        let path = output
            .path
            .or(errors.path)
            .ok_or("다운로드된 영상이 없습니다. 영상 URL을 확인해 주세요.")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if path.parent() != Some(target.as_path()) || !path.is_file() {
            return Err("다운로드된 영상의 저장 위치가 올바르지 않습니다.".into());
        }
        let path = finalize_filename(&path, video_id.as_deref())
            .map_err(|error| format!("다운로드한 영상의 파일명을 정리할 수 없습니다: {error}"))?;
        if let Some(info) = output.info.or(errors.info) {
            // Only a hint for later; a video without it still opens and transcribes.
            let _ = fs::write(info_path(&path), info.to_string());
        }
        state.allow(&path)?;
        Ok(path.to_string_lossy().into_owned())
    })();
    backend::finish(&state.download, id);
    result
}

#[cfg(windows)]
struct ProcessTree(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl ProcessTree {
    fn attach(child: &Child) -> Result<Self, String> {
        use std::{mem::size_of, os::windows::io::AsRawHandle, ptr};
        use windows_sys::Win32::System::JobObjects::*;
        // The uniquely owned job closes on every return path, including app shutdown.
        unsafe {
            let job = Self(CreateJobObjectW(ptr::null(), ptr::null()));
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if job.0.is_null()
                || SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    ptr::from_ref(&limits).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                ) == 0
                || AssignProcessToJobObject(job.0, child.as_raw_handle()) == 0
            {
                return Err(format!(
                    "다운로드 작업을 준비할 수 없습니다: {}",
                    std::io::Error::last_os_error()
                ));
            }
            Ok(job)
        }
    }
}
#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.0);
            }
        }
    }
}
#[cfg(not(windows))]
struct ProcessTree;
#[cfg(not(windows))]
impl ProcessTree {
    fn attach(_child: &Child) -> Result<Self, String> {
        Ok(Self)
    }
}
#[cfg(not(windows))]
impl Drop for ProcessTree {
    fn drop(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn cancelling_a_download_stops_its_child_processes() {
        use std::sync::atomic::AtomicBool;
        use windows_sys::Win32::{
            Foundation::{CloseHandle, WAIT_OBJECT_0},
            System::Threading::{OpenProcess, WaitForSingleObject},
        };
        let mut child = backend::command("python").args(["-c", "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); print(p.pid, flush=True); time.sleep(60)"])
            .stdout(Stdio::piped()).spawn().unwrap();
        let tree = ProcessTree::attach(&child).unwrap();
        let mut pid = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut pid)
            .unwrap();
        // SYNCHRONIZE grants only permission to wait for this test's own child process.
        let handle = unsafe { OpenProcess(0x00100000, 0, pid.trim().parse().unwrap()) };
        assert!(!handle.is_null());
        assert!(
            backend::wait(&mut child, &AtomicBool::new(true), &AtomicBool::new(false)).is_err()
        );
        drop(tree);
        assert_eq!(unsafe { WaitForSingleObject(handle, 5000) }, WAIT_OBJECT_0);
        unsafe {
            CloseHandle(handle);
        }
    }

    #[test]
    fn progress_accepts_missing_totals_and_paths_with_unicode() {
        let mut output = Output::default();
        let events = std::sync::Mutex::new(Vec::new());
        let emit = |event| events.lock().unwrap().push(event);
        output.line(
            r#"sub-sync:{"type":"progress","downloaded":50,"total":100}"#,
            &emit,
        );
        output.line(
            r#"sub-sync:{"type":"progress","downloaded":50,"total":"NA"}"#,
            &emit,
        );
        output.line(r#"sub-sync:{"type":"processing"}"#, &emit);
        output.line(
            r#"sub-sync:{"type":"done","path":"C:\\영상\\제목 [id].mp4"}"#,
            &emit,
        );
        assert_eq!(events.lock().unwrap()[0].progress, Some(0.5));
        assert_eq!(events.lock().unwrap()[1].progress, None);
        assert_eq!(events.lock().unwrap()[2].label, "영상 파일 준비 중");
        assert_eq!(output.path, Some(PathBuf::from("C:\\영상\\제목 [id].mp4")));
    }

    #[test]
    fn video_info_is_kept_apart_from_the_download_result() {
        let mut output = Output::default();
        let emit = |_| {};
        output.line(
            r#"sub-sync-info:{"title":"Pi Agent","chapters":[{"title":"Setup","start_time":0}]}"#,
            &emit,
        );
        output.line("sub-sync-info:NA", &emit);
        assert_eq!(output.info.as_ref().unwrap()["title"], "Pi Agent");
        assert!(output.errors.is_empty() && output.path.is_none());
        assert_eq!(
            info_path(Path::new(r"C:\영상\Pi Agent (2).mp4")),
            PathBuf::from(r"C:\영상\Pi Agent (2).info.json")
        );
    }
}
