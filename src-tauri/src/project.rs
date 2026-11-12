use crate::files::atomic_write;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prob: Option<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Clip {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub words: Vec<Word>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SttOptions {
    pub model: String,
    pub language: String,
    pub device: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentOptions {
    pub max_chars: u32,
    pub max_duration: f64,
    pub split_on_sentence: bool,
    pub max_gap: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStyle {
    pub font: String,
    /// Projects saved before the weight could be chosen drew subtitles bold.
    #[serde(default = "default_weight")]
    pub weight: u16,
    pub size_pct: f64,
    pub margin_pct: f64,
    pub r#box: bool,
}
fn default_weight() -> u16 {
    700
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    pub stt: SttOptions,
    pub segment: SegmentOptions,
    pub style: SubtitleStyle,
    pub dictionary: String,
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if self.stt.model.is_empty()
            || self.stt.language.is_empty()
            || !["auto", "cuda", "cpu"].contains(&self.stt.device.as_str())
            || self.segment.max_chars == 0
            || !positive(self.segment.max_duration)
            || !nonnegative(self.segment.max_gap)
            || !(1..=1000).contains(&self.style.weight)
            || !positive(self.style.size_pct)
            || !nonnegative(self.style.margin_pct)
        {
            return Err("프로젝트의 편집 설정이 손상되었습니다.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMedia {
    pub path: String,
    pub size: u64,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub has_audio: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MediaInfo {
    #[serde(flatten)]
    pub source: ProjectMedia,
    pub url: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Waveform {
    pub samples_per_second: u32,
    pub peaks: Vec<u8>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Playback {
    pub time: f64,
    pub rate: f64,
    pub follow: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub format: String,
    pub version: u32,
    pub media: ProjectMedia,
    pub clips: Vec<Clip>,
    pub waveform: Option<Waveform>,
    pub settings: Settings,
    pub playback: Playback,
    pub srt_path: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyProject {
    pub version: u32,
    pub media_size: u64,
    pub clips: Vec<Clip>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SavedProject {
    Current(Box<ProjectFile>),
    Legacy(LegacyProject),
}

fn nonnegative(value: f64) -> bool {
    value.is_finite() && value >= 0.0
}
fn positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}
fn validate_clips(clips: &[Clip]) -> Result<(), String> {
    let mut ids = HashSet::new();
    let mut previous_start = 0.0;
    for clip in clips {
        if clip.id.is_empty()
            || !ids.insert(&clip.id)
            || !nonnegative(clip.start)
            || !nonnegative(clip.end)
            || clip.end < clip.start
            || clip.start < previous_start
            || clip.words.iter().any(|w| {
                !nonnegative(w.start)
                    || !nonnegative(w.end)
                    || w.end < w.start
                    || w.prob.is_some_and(|p| !nonnegative(p) || p > 1.0)
            })
        {
            return Err("프로젝트의 자막 또는 단어 시간 정보가 손상되었습니다.".into());
        }
        previous_start = clip.start;
    }
    Ok(())
}
impl ProjectFile {
    pub fn validate(&self) -> Result<(), String> {
        if self.format != "sub-sync" || self.version != 2 {
            return Err("지원하지 않는 프로젝트 형식 또는 버전입니다.".into());
        }
        validate_clips(&self.clips)?;
        if self.media.path.is_empty()
            || self.media.size > 9_007_199_254_740_991
            || !nonnegative(self.media.duration)
            || self.media.width == 0
            || self.media.height == 0
        {
            return Err("프로젝트의 영상 정보가 손상되었습니다.".into());
        }
        if self
            .waveform
            .as_ref()
            .is_some_and(|w| w.samples_per_second != 100)
        {
            return Err("지원하지 않는 파형 정보입니다.".into());
        }
        self.settings.validate()?;
        if !nonnegative(self.playback.time)
            || ![0.5, 0.75, 1.0, 1.25, 1.5, 2.0].contains(&self.playback.rate)
        {
            return Err("프로젝트의 재생 정보가 손상되었습니다.".into());
        }
        Ok(())
    }
}
impl SavedProject {
    pub fn size(&self) -> u64 {
        match self {
            Self::Current(p) => p.media.size,
            Self::Legacy(p) => p.media_size,
        }
    }
    pub fn original_path(&self) -> Option<&str> {
        match self {
            Self::Current(p) => Some(&p.media.path),
            _ => None,
        }
    }
    pub fn validate_media(&self, media: &MediaInfo) -> Result<(), String> {
        if self.size() != media.source.size
            || matches!(self, Self::Current(p) if
            (p.media.duration - media.source.duration).abs() > 0.1 || p.media.width != media.source.width || p.media.height != media.source.height)
        {
            return Err(
                "저장된 프로젝트와 다른 영상입니다. 원본 영상을 다시 연결해 주세요.".into(),
            );
        }
        Ok(())
    }
}
pub fn parse(source: &str) -> Result<SavedProject, String> {
    let value: serde_json::Value = serde_json::from_str(source.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("프로젝트 JSON을 읽을 수 없습니다: {e}"))?;
    match value.get("version").and_then(|v| v.as_u64()) {
        Some(2) => {
            let project: ProjectFile = serde_json::from_value(value)
                .map_err(|e| format!("프로젝트 정보가 손상되었습니다: {e}"))?;
            project.validate()?;
            Ok(SavedProject::Current(Box::new(project)))
        }
        Some(1) => {
            let project: LegacyProject =
                serde_json::from_value(value).map_err(|e| e.to_string())?;
            validate_clips(&project.clips)?;
            Ok(SavedProject::Legacy(project))
        }
        _ => Err("지원하지 않는 프로젝트 버전입니다.".into()),
    }
}
pub fn read(path: &Path) -> Result<SavedProject, String> {
    parse(&fs::read_to_string(path).map_err(|e| e.to_string())?)
}
/// The only project file extension. The content is JSON, but `.subsync` is always the last extension.
pub const EXTENSION: &str = "subsync";
pub fn is_project_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case(EXTENSION))
}
/// A name typed in the save dialog without `.subsync` (or as `name.json`) still becomes a project file.
pub fn with_extension(path: PathBuf) -> PathBuf {
    if is_project_path(&path) {
        return path;
    }
    let mut name = path.into_os_string();
    name.push(format!(".{EXTENSION}"));
    PathBuf::from(name)
}
pub fn autosave_path(media: &str) -> PathBuf {
    let path = Path::new(media);
    if let (Some(parent), Some(stem)) = (path.parent(), path.file_stem()) {
        if parent.as_os_str().is_empty() {
            PathBuf::from(format!("{}.{EXTENSION}", stem.to_string_lossy()))
        } else {
            parent.join(format!("{}.{EXTENSION}", stem.to_string_lossy()))
        }
    } else {
        PathBuf::from(format!("{media}.{EXTENSION}"))
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ProjectSubtitle {
    pub path: String,
    pub language: Option<String>,
}

/// Only sibling SRTs named `project.srt` or `project.<language>.srt` belong to this project.
pub fn subtitles(path: &Path) -> Result<Vec<ProjectSubtitle>, String> {
    let Some(stem) = path.file_stem().and_then(|name| name.to_str()) else {
        return Ok(Vec::new());
    };
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut subtitles = Vec::new();
    for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let candidate = entry.path();
        if !entry.file_type().map_err(|e| e.to_string())?.is_file()
            || !candidate
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("srt"))
        {
            continue;
        }
        let Some(name) = candidate.file_stem().and_then(|name| name.to_str()) else {
            continue;
        };
        if !name
            .get(..stem.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(stem))
        {
            continue;
        }
        let suffix = &name[stem.len()..];
        let language = if suffix.is_empty() {
            None
        } else {
            let Some(tag) = suffix.strip_prefix('.') else {
                continue;
            };
            let tag = tag.replace('_', "-").to_ascii_lowercase();
            let mut parts = tag.split('-');
            let language = parts.next().unwrap_or_default();
            if !(2..=3).contains(&language.len())
                || !language.bytes().all(|byte| byte.is_ascii_alphabetic())
                || !parts.all(|part| {
                    (2..=8).contains(&part.len())
                        && part.bytes().all(|byte| byte.is_ascii_alphanumeric())
                })
            {
                continue;
            }
            Some(tag)
        };
        subtitles.push(ProjectSubtitle {
            path: candidate.to_string_lossy().into_owned(),
            language,
        });
    }
    subtitles.sort_by(|a, b| a.language.cmp(&b.language).then(a.path.cmp(&b.path)));
    Ok(subtitles)
}

fn relative_path(target: &Path, base: &Path) -> Option<PathBuf> {
    let target: Vec<_> = target.components().collect();
    let base: Vec<_> = base.components().collect();
    if target.first() != base.first() {
        return None;
    }
    let common = target.iter().zip(&base).take_while(|(a, b)| a == b).count();
    let mut result = PathBuf::new();
    for part in &base[common..] {
        if matches!(part, Component::Normal(_)) {
            result.push("..");
        }
    }
    for part in &target[common..] {
        result.push(part.as_os_str());
    }
    Some(result)
}
pub fn write(path: &Path, project: &ProjectFile) -> Result<(), String> {
    project.validate()?;
    crate::files::ensure_different(Path::new(&project.media.path), path)?;
    let mut saved = project.clone();
    saved.media.relative_path = relative_path(
        Path::new(&project.media.path),
        path.parent().unwrap_or(Path::new(".")),
    )
    .map(|p| p.to_string_lossy().into_owned());
    atomic_write(
        path,
        &serde_json::to_vec(&saved).map_err(|e| e.to_string())?,
    )
}
pub fn find_media(path: &Path, project: &SavedProject) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    match project {
        SavedProject::Current(p) => {
            if let Some(relative) = &p.media.relative_path {
                if !Path::new(relative).is_absolute() {
                    candidates.push(path.parent()?.join(relative));
                }
            }
            let original = PathBuf::from(&p.media.path);
            candidates.push(if original.is_absolute() {
                original
            } else {
                path.parent()?.join(original)
            });
        }
        SavedProject::Legacy(_) => {
            if let Some(original) = path
                .to_string_lossy()
                .strip_suffix(&format!(".{EXTENSION}"))
            {
                let candidate = PathBuf::from(original);
                candidates.push(candidate.clone());
                for ext in ["mp4", "mkv", "webm", "avi", "mov"] {
                    candidates.push(candidate.with_extension(ext));
                }
            }
        }
    }
    candidates
        .into_iter()
        .find(|p| fs::metadata(p).is_ok_and(|m| m.is_file() && m.len() == project.size()))
}
