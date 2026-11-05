use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

/// Owns only a uniquely created sibling file. Drop never removes a user-selected file.
pub struct StagedFile {
    pub path: PathBuf,
    persisted: bool,
}
impl StagedFile {
    pub fn new(parent: &Path, suffix: &str) -> Result<Self, String> {
        let path = parent.join(format!(".sub-sync-{}.{suffix}", Uuid::new_v4()));
        OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        Ok(Self {
            path,
            persisted: false,
        })
    }
    pub fn persist(mut self, target: &Path) -> Result<(), String> {
        atomic_replace(&self.path, target)?;
        self.persisted = true;
        Ok(())
    }
}
impl Drop for StagedFile {
    fn drop(&mut self) {
        if !self.persisted {
            let _ = fs::remove_file(&self.path);
        }
    }
}
pub fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let file = StagedFile::new(target.parent().unwrap_or(Path::new(".")), "tmp")?;
    let mut output = OpenOptions::new()
        .write(true)
        .open(&file.path)
        .map_err(|e| e.to_string())?;
    output
        .write_all(bytes)
        .and_then(|_| output.sync_all())
        .map_err(|e| e.to_string())?;
    drop(output);
    file.persist(target)
}
#[cfg(windows)]
fn atomic_replace(source: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let from: Vec<_> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<_> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // Both NUL-terminated buffers outlive the call. Replace only after the complete file has been flushed.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0x1 | 0x8) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}
#[cfg(not(windows))]
fn atomic_replace(source: &Path, target: &Path) -> Result<(), String> {
    fs::rename(source, target).map_err(|e| e.to_string())
}

pub fn ensure_different(source: &Path, target: &Path) -> Result<(), String> {
    let same = match (source.canonicalize(), target.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => source == target,
    };
    if same {
        Err("원본 영상과 같은 경로에 저장할 수 없습니다.".into())
    } else {
        Ok(())
    }
}
pub fn decode_subtitle(bytes: &[u8]) -> Result<String, String> {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little = bytes[0] == 0xff;
        let (pairs, remainder) = bytes[2..].as_chunks::<2>();
        if !remainder.is_empty() {
            return Err("UTF-16 자막 파일이 손상되었습니다.".into());
        }
        let words: Vec<u16> = pairs
            .iter()
            .map(|b| {
                if little {
                    u16::from_le_bytes([b[0], b[1]])
                } else {
                    u16::from_be_bytes([b[0], b[1]])
                }
            })
            .collect();
        return String::from_utf16(&words).map_err(|e| e.to_string());
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok(text.trim_start_matches('\u{feff}').into());
    }
    decode_cp949(bytes)
}
#[cfg(windows)]
fn decode_cp949(bytes: &[u8]) -> Result<String, String> {
    #[link(name = "kernel32")]
    extern "system" {
        fn MultiByteToWideChar(
            page: u32,
            flags: u32,
            input: *const u8,
            count: i32,
            output: *mut u16,
            capacity: i32,
        ) -> i32;
    }
    let count = i32::try_from(bytes.len()).map_err(|_| "자막 파일이 너무 큽니다.")?;
    // Windows supplies the same CP949 decoder used by the original editor; no extra codec runtime is bundled.
    let size =
        unsafe { MultiByteToWideChar(949, 0, bytes.as_ptr(), count, std::ptr::null_mut(), 0) };
    if size == 0 {
        return Err("자막 인코딩을 읽을 수 없습니다.".into());
    }
    let mut output = vec![0u16; size as usize];
    let written =
        unsafe { MultiByteToWideChar(949, 0, bytes.as_ptr(), count, output.as_mut_ptr(), size) };
    if written != size {
        return Err("자막 인코딩을 읽을 수 없습니다.".into());
    }
    String::from_utf16(&output).map_err(|e| e.to_string())
}
#[cfg(not(windows))]
fn decode_cp949(_: &[u8]) -> Result<String, String> {
    Err("이 플랫폼에서는 자막을 UTF-8로 변환해 주세요.".into())
}
