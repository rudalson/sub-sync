use crate::{
    files::StagedFile,
    project::{MediaInfo, ProjectMedia, SttOptions},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, RwLock,
    },
    thread,
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub type Shared = Arc<Backend>;
pub struct Job {
    pub id: Uuid,
    pub cancel: Arc<AtomicBool>,
}
pub struct Backend {
    pub data_dir: PathBuf,
    pub resource_dir: PathBuf,
    pub streams: RwLock<HashMap<String, PathBuf>>,
    allowed: RwLock<HashSet<PathBuf>>,
    pub writes: Mutex<()>,
    pub stt: Mutex<Option<Job>>,
    pub export: Mutex<Option<Job>>,
    pub shutdown: Arc<AtomicBool>,
    children: Mutex<HashSet<u32>>,
    /// Scanned once, on first use: reading every installed font takes a moment.
    pub fonts: std::sync::OnceLock<crate::fonts::FontCatalog>,
}
impl Backend {
    pub fn new(data_dir: PathBuf, resource_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        Ok(Self {
            data_dir,
            resource_dir,
            streams: RwLock::new(HashMap::new()),
            allowed: RwLock::new(HashSet::new()),
            writes: Mutex::new(()),
            stt: Mutex::new(None),
            export: Mutex::new(None),
            shutdown: Arc::new(AtomicBool::new(false)),
            children: Mutex::new(HashSet::new()),
            fonts: std::sync::OnceLock::new(),
        })
    }
    pub fn fonts(&self) -> &crate::fonts::FontCatalog {
        self.fonts.get_or_init(crate::fonts::FontCatalog::load)
    }
    pub fn allow(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        self.allowed.write().unwrap().insert(canonical.clone());
        Ok(canonical)
    }
    pub fn require_media(&self, path: &Path) -> Result<(), String> {
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        if self.allowed.read().unwrap().contains(&canonical) {
            Ok(())
        } else {
            Err("먼저 영상 또는 프로젝트를 열어 주세요.".into())
        }
    }
    pub fn cancel_jobs(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
        cancel(&self.stt);
        cancel(&self.export);
        for &pid in self.children.lock().unwrap().iter() {
            terminate(pid);
        }
    }
    pub fn tool(&self, name: &str) -> PathBuf {
        let variable = format!("SUB_SYNC_{}", name.to_uppercase());
        if let Some(path) = std::env::var_os(variable) {
            return PathBuf::from(path);
        }
        let bundled = self.resource_dir.join("tools").join(if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.into()
        });
        if bundled.is_file() {
            bundled
        } else {
            PathBuf::from(name)
        }
    }
}
struct ChildRegistration<'a> {
    state: &'a Backend,
    pid: u32,
}
impl<'a> ChildRegistration<'a> {
    fn new(state: &'a Backend, pid: u32) -> Self {
        state.children.lock().unwrap().insert(pid);
        Self { state, pid }
    }
}
impl Drop for ChildRegistration<'_> {
    fn drop(&mut self) {
        self.state.children.lock().unwrap().remove(&self.pid);
    }
}
#[cfg(windows)]
fn terminate(pid: u32) {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn TerminateProcess(process: *mut c_void, code: u32) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    // PIDs remain registered only while an owned Child handle is alive, preventing PID reuse.
    unsafe {
        let handle = OpenProcess(1, 0, pid);
        if !handle.is_null() {
            TerminateProcess(handle, 1);
            CloseHandle(handle);
        }
    }
}
#[cfg(not(windows))]
fn terminate(pid: u32) {
    extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    unsafe {
        kill(pid as i32, 15);
    }
}
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}
pub fn cancel(slot: &Mutex<Option<Job>>) {
    if let Some(job) = slot.lock().unwrap().as_ref() {
        job.cancel.store(true, Ordering::Relaxed);
    }
}
pub fn begin(slot: &Mutex<Option<Job>>) -> Result<(Uuid, Arc<AtomicBool>), String> {
    let mut current = slot.lock().unwrap();
    if current.is_some() {
        return Err("기존 작업이 종료될 때까지 기다려 주세요.".into());
    }
    let id = Uuid::new_v4();
    let cancel = Arc::new(AtomicBool::new(false));
    *current = Some(Job {
        id,
        cancel: cancel.clone(),
    });
    Ok((id, cancel))
}
pub fn finish(slot: &Mutex<Option<Job>>, id: Uuid) {
    let mut current = slot.lock().unwrap();
    if current.as_ref().is_some_and(|j| j.id == id) {
        *current = None;
    }
}
fn wait(
    child: &mut Child,
    cancel: &AtomicBool,
    shutdown: &AtomicBool,
) -> Result<std::process::ExitStatus, String> {
    loop {
        if cancel.load(Ordering::Relaxed) || shutdown.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("작업을 취소했습니다.".into());
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Ok(status);
        }
        thread::sleep(Duration::from_millis(40));
    }
}
fn error_tail(mut input: impl Read) -> String {
    let mut buffer = [0; 2048];
    let mut tail = Vec::new();
    while let Ok(count) = input.read(&mut buffer) {
        if count == 0 {
            break;
        }
        tail.extend_from_slice(&buffer[..count]);
        if tail.len() > 8192 {
            tail.drain(..tail.len() - 8192);
        }
    }
    String::from_utf8_lossy(&tail).trim().into()
}
pub fn ffmpeg(
    state: &Backend,
    app: Option<&AppHandle>,
    args: &[String],
    cwd: Option<&Path>,
    duration: f64,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let mut cmd = command(state.tool("ffmpeg"));
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-progress",
        "pipe:1",
        "-nostats",
        "-nostdin",
    ])
    .args(args)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("ffmpeg를 실행할 수 없습니다. 설치 및 PATH를 확인해 주세요: {e}"))?;
    let _registration = ChildRegistration::new(state, child.id());
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let progress_app = app.cloned();
    let progress = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(time) = line
                .strip_prefix("out_time_us=")
                .and_then(|s| s.parse::<f64>().ok())
            {
                if let Some(app) = &progress_app {
                    if duration > 0.0 {
                        let _ = app.emit("progress", (time / 1e6 / duration).clamp(0.0, 1.0));
                    }
                }
            }
        }
    });
    let errors = thread::spawn(move || error_tail(stderr));
    let status = wait(&mut child, cancel, &state.shutdown);
    let _ = progress.join();
    let errors = errors.join().unwrap_or_default();
    if status?.success() {
        Ok(())
    } else {
        Err(if errors.is_empty() {
            "ffmpeg 작업에 실패했습니다.".into()
        } else {
            errors
        })
    }
}
#[derive(Debug)]
struct Probe {
    duration: f64,
    width: u32,
    height: u32,
    video: String,
    audio: Option<String>,
    container: String,
}
fn probe(state: &Backend, path: &Path) -> Result<Probe, String> {
    let result = command(state.tool("ffprobe"))
        .args([
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-print_format",
            "json",
        ])
        .arg(path)
        .output()
        .map_err(|e| {
            format!("ffprobe를 실행할 수 없습니다. ffmpeg 설치 및 PATH를 확인해 주세요: {e}")
        })?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).into_owned());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&result.stdout).map_err(|e| e.to_string())?;
    let streams = value["streams"]
        .as_array()
        .ok_or("영상 스트림 정보가 없습니다.")?;
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video")
        .ok_or("영상 트랙이 없는 파일입니다.")?;
    Ok(Probe {
        duration: value["format"]["duration"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0),
        width: video["width"].as_u64().unwrap_or(1280) as u32,
        height: video["height"].as_u64().unwrap_or(720) as u32,
        video: video["codec_name"].as_str().unwrap_or("").into(),
        audio: streams
            .iter()
            .find(|s| s["codec_type"] == "audio")
            .and_then(|s| s["codec_name"].as_str())
            .map(str::to_owned),
        container: value["format"]["format_name"].as_str().unwrap_or("").into(),
    })
}
fn cache_path(
    state: &Backend,
    folder: &str,
    path: &Path,
    extension: &str,
) -> Result<PathBuf, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let key = format!(
        "{}|{}|{:?}",
        path.display(),
        metadata.len(),
        metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH)
    );
    let digest = format!("{:x}", Sha256::digest(key.as_bytes()));
    let directory = state.data_dir.join(folder);
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory.join(format!("{digest}.{extension}")))
}
pub fn open_media(
    state: &Backend,
    app: Option<&AppHandle>,
    path: &Path,
) -> Result<MediaInfo, String> {
    let info = probe(state, path)?;
    state.allow(path)?;
    let compatible_video = ["h264", "vp8", "vp9", "av1"].contains(&info.video.as_str());
    let playable = if ["mp4", "webm"].iter().any(|c| info.container.contains(c))
        && compatible_video
        && info
            .audio
            .as_ref()
            .is_none_or(|c| ["aac", "mp3", "opus", "vorbis", "flac"].contains(&c.as_str()))
    {
        path.to_path_buf()
    } else {
        let cached = cache_path(state, "proxy", path, "mp4")?;
        if !cached.exists() {
            let stage = StagedFile::new(cached.parent().unwrap(), "mp4")?;
            let mut args = vec!["-i".into(), path.to_string_lossy().into_owned()];
            if compatible_video {
                args.extend(["-c:v", "copy"].map(str::to_owned));
            } else {
                args.extend(
                    [
                        "-c:v",
                        "libx264",
                        "-preset",
                        "veryfast",
                        "-crf",
                        "26",
                        "-vf",
                        "scale=-2:'min(720,ih)'",
                    ]
                    .map(str::to_owned),
                );
            }
            args.extend(
                ["-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"].map(str::to_owned),
            );
            args.push(stage.path.to_string_lossy().into_owned());
            ffmpeg(state, app, &args, None, info.duration, &state.shutdown)?;
            stage.persist(&cached)?;
        }
        cached
    };
    let token = Uuid::new_v4().to_string();
    let mut streams = state.streams.write().unwrap();
    if streams.len() >= 128 {
        streams.clear();
    }
    streams.insert(token.clone(), playable);
    Ok(MediaInfo {
        source: ProjectMedia {
            path: path.to_string_lossy().into_owned(),
            relative_path: None,
            size: fs::metadata(path).map_err(|e| e.to_string())?.len(),
            duration: info.duration,
            width: info.width,
            height: info.height,
            has_audio: info.audio.is_some(),
        },
        url: token,
    })
}

#[derive(Default)]
pub struct PeakAccumulator {
    raw: Vec<u16>,
    count: usize,
    peak: u16,
    loudest: u16,
    carry: Option<u8>,
}
impl PeakAccumulator {
    pub fn push(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            if let Some(low) = self.carry.take() {
                self.peak = self
                    .peak
                    .max(i16::from_le_bytes([low, byte]).unsigned_abs());
                self.count += 1;
                if self.count == 40 {
                    self.raw.push(self.peak);
                    self.loudest = self.loudest.max(self.peak);
                    self.count = 0;
                    self.peak = 0;
                }
            } else {
                self.carry = Some(byte);
            }
        }
    }
    pub fn finish(self) -> Vec<u8> {
        let loudest = self.loudest.max(1) as f64;
        self.raw
            .into_iter()
            .map(|p| ((p as f64 / loudest).sqrt() * 255.0).round() as u8)
            .collect()
    }
}
pub fn load_peaks(state: &Backend, path: &Path) -> Result<Vec<u8>, String> {
    state.require_media(path)?;
    let cached = cache_path(state, "peaks", path, "bin")?;
    if cached.exists() {
        return fs::read(cached).map_err(|e| e.to_string());
    }
    let mut child = command(state.tool("ffmpeg"))
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-i"])
        .arg(path)
        .args(["-vn", "-ac", "1", "-ar", "4000", "-f", "s16le", "pipe:1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let _registration = ChildRegistration::new(state, child.id());
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let reader = thread::spawn(move || {
        let mut peaks = PeakAccumulator::default();
        let mut input = BufReader::new(stdout);
        let mut buffer = [0; 16384];
        loop {
            let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            peaks.push(&buffer[..count]);
        }
        Ok::<_, String>(peaks.finish())
    });
    let errors = thread::spawn(move || error_tail(stderr));
    let status = wait(&mut child, &state.shutdown, &state.shutdown);
    let peaks = reader.join().map_err(|_| "파형 처리에 실패했습니다.")??;
    let _ = errors.join();
    if !status?.success() {
        return Ok(Vec::new());
    } // A video without audio has no waveform.
    crate::files::atomic_write(&cached, &peaks)?;
    Ok(peaks)
}
fn backend_script(state: &Backend) -> PathBuf {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/transcribe.py");
    if dev.exists() {
        dev
    } else {
        state.resource_dir.join("backend/transcribe.py")
    }
}
fn python(state: &Backend) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("SUB_SYNC_PYTHON") {
        return Ok(path.into());
    }
    let suffix = if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    };
    let installed = state.data_dir.join("backend/.venv").join(suffix);
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../backend/.venv")
        .join(suffix);
    [dev, installed].into_iter().find(|p| p.is_file()).ok_or_else(|| "Whisper Python 환경이 없습니다. npm run setup:backend를 실행하거나 SUB_SYNC_PYTHON으로 기존 Python 환경을 지정해 주세요.".into())
}
pub fn sentence_boundaries(state: &Backend, words: Vec<String>) -> Result<Vec<usize>, String> {
    if words.is_empty() {
        return Ok(Vec::new());
    }
    if state.shutdown.load(Ordering::Relaxed) {
        return Err("작업을 취소했습니다.".into());
    }
    let word_count = words.len();
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/sentence_boundary.py");
    let script = if dev.is_file() {
        dev
    } else {
        state.resource_dir.join("backend/sentence_boundary.py")
    };
    let mut child = command(python(state)?)
        .arg("-u")
        .arg(script)
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("문장 분석기를 실행할 수 없습니다: {e}"))?;
    let _registration = ChildRegistration::new(state, child.id());
    let input = child.stdin.take().unwrap();
    let mut output = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let writer =
        thread::spawn(move || serde_json::to_writer(input, &words).map_err(|e| e.to_string()));
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        output
            .read_to_end(&mut bytes)
            .map(|_| bytes)
            .map_err(|e| e.to_string())
    });
    let errors = thread::spawn(move || error_tail(stderr));
    let status = wait(&mut child, &state.shutdown, &state.shutdown);
    let written = writer
        .join()
        .map_err(|_| "문장 분석 입력 전송에 실패했습니다.")?;
    let bytes = reader
        .join()
        .map_err(|_| "문장 분석 결과를 읽지 못했습니다.")??;
    let errors = errors.join().unwrap_or_default();
    if !status?.success() {
        return Err(if errors.is_empty() {
            "문장 분석에 실패했습니다.".into()
        } else {
            errors
        });
    }
    written?;
    let ends: Vec<usize> = serde_json::from_slice(&bytes)
        .map_err(|e| format!("문장 분석 결과 형식이 잘못되었습니다: {e}"))?;
    let mut previous = 0;
    for &end in &ends {
        if end <= previous || end > word_count {
            return Err("문장 분석 결과의 단어 범위가 올바르지 않습니다.".into());
        }
        previous = end;
    }
    if previous != word_count {
        return Err("문장 분석 결과에 원문 단어가 누락되었습니다.".into());
    }
    Ok(ends)
}
pub fn start_stt(
    state: Shared,
    app: AppHandle,
    media: String,
    options: SttOptions,
    hotwords: String,
) -> Result<(), String> {
    state.require_media(Path::new(&media))?;
    if !["auto", "cuda", "cpu"].contains(&options.device.as_str()) {
        return Err("잘못된 STT 장치입니다.".into());
    }
    let python = python(&state)?;
    let (id, cancel_flag) = begin(&state.stt)?;
    let mut cmd = command(python);
    cmd.arg("-u").arg(backend_script(&state)).arg(media).args([
        "--model",
        &options.model,
        "--language",
        &options.language,
        "--device",
        &options.device,
    ]);
    if !hotwords.is_empty() {
        cmd.args(["--hotwords", &hotwords]);
    }
    cmd.env("PYTHONUTF8", "1")
        .env("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            finish(&state.stt, id);
            return Err(e.to_string());
        }
    };
    state.children.lock().unwrap().insert(child.id());
    tauri::async_runtime::spawn_blocking(move || {
        let output = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let terminal = Arc::new(AtomicBool::new(false));
        let reader_terminal = terminal.clone();
        let reader_app = app.clone();
        let reader_cancel = cancel_flag.clone();
        let reader = thread::spawn(move || {
            for line in BufReader::new(output).lines().map_while(Result::ok) {
                if reader_cancel.load(Ordering::Relaxed) {
                    break;
                }
                if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                    if matches!(event["type"].as_str(), Some("done" | "error")) {
                        reader_terminal.store(true, Ordering::Relaxed);
                    }
                    let _ = reader_app.emit("stt-event", event);
                }
            }
        });
        let errors = thread::spawn(move || error_tail(stderr));
        let status = wait(&mut child, &cancel_flag, &state.shutdown);
        let _ = reader.join();
        let errors = errors.join().unwrap_or_default();
        if !terminal.load(Ordering::Relaxed) && !cancel_flag.load(Ordering::Relaxed) {
            let message = if errors.is_empty() {
                format!("음성 인식이 종료됐습니다: {status:?}")
            } else {
                errors
            };
            let _ = app.emit(
                "stt-event",
                serde_json::json!({"type":"error","message":message}),
            );
        }
        finish(&state.stt, id);
        state.children.lock().unwrap().remove(&child.id());
    });
    Ok(())
}
#[derive(Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub media_path: String,
    pub output_path: String,
    pub ass: String,
    pub duration: f64,
    /// The subtitle font family; its files are handed to libass so the export matches the preview.
    #[serde(default)]
    pub font_family: Option<String>,
}
/// A uniquely named sibling folder of font copies, removed when the export ends.
struct StagedFonts(PathBuf);
impl Drop for StagedFonts {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn stage_fonts(
    state: &Backend,
    family: Option<&str>,
    parent: &Path,
) -> Result<Option<StagedFonts>, String> {
    let Some(family) = family.filter(|family| !state.fonts().files(family).is_empty()) else {
        return Ok(None);
    };
    let folder = StagedFonts(parent.join(format!(".sub-sync-fonts-{}", Uuid::new_v4())));
    fs::create_dir(&folder.0).map_err(|e| e.to_string())?;
    crate::fonts::copy_family(state.fonts(), family, &folder.0)?;
    Ok(Some(folder))
}
pub fn export_video(
    state: Shared,
    app: Option<AppHandle>,
    request: ExportRequest,
) -> Result<(), String> {
    state.require_media(Path::new(&request.media_path))?;
    let output = PathBuf::from(&request.output_path);
    crate::files::ensure_different(Path::new(&request.media_path), &output)?;
    let (id, cancel_flag) = begin(&state.export)?;
    let result = (|| {
        let parent = output.parent().ok_or("저장 폴더가 없습니다.")?;
        let ass = StagedFile::new(parent, "ass")?;
        fs::write(&ass.path, &request.ass).map_err(|e| e.to_string())?;
        let fonts = stage_fonts(&state, request.font_family.as_deref(), parent)?;
        // Both names are generated ASCII siblings in the working folder, so the filter needs no escaping.
        let mut subtitles = format!("ass={}", ass.path.file_name().unwrap().to_string_lossy());
        if let Some(fonts) = &fonts {
            subtitles.push_str(&format!(
                ":fontsdir={}",
                fonts.0.file_name().unwrap().to_string_lossy()
            ));
        }
        let stage = StagedFile::new(parent, "mp4")?;
        let encode = |codec: &[&str]| {
            let mut args = vec![
                "-i".into(),
                request.media_path.clone(),
                "-vf".into(),
                subtitles.clone(),
            ];
            args.extend(codec.iter().map(|s| s.to_string()));
            args.extend(
                ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"].map(str::to_owned),
            );
            args.push(stage.path.to_string_lossy().into_owned());
            ffmpeg(
                &state,
                app.as_ref(),
                &args,
                Some(parent),
                request.duration,
                &cancel_flag,
            )
        };
        if let Err(error) = encode(&[
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p5",
            "-cq",
            "21",
            "-pix_fmt",
            "yuv420p",
        ]) {
            if cancel_flag.load(Ordering::Relaxed) || state.shutdown.load(Ordering::Relaxed) {
                return Err(error);
            }
            encode(&[
                "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
            ])?;
        }
        stage.persist(&output)
    })();
    finish(&state.export, id);
    result
}
