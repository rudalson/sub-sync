use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};
use tauri::http::{Request, Response};

pub const MAX_CHUNK: u64 = 2 * 1024 * 1024;
pub fn byte_range(header: Option<&str>, size: u64) -> Result<(u64, u64), String> {
    if size == 0 {
        return Err("empty file".into());
    }
    let (start, end) = if let Some(header) = header {
        let range = header.strip_prefix("bytes=").ok_or("invalid range")?;
        if range.contains(',') {
            return Err("multiple ranges unsupported".into());
        }
        let (first, last) = range.split_once('-').ok_or("invalid range")?;
        if first.is_empty() {
            let suffix = last.parse::<u64>().map_err(|_| "invalid suffix")?;
            if suffix == 0 {
                return Err("invalid suffix".into());
            }
            (size.saturating_sub(suffix), size - 1)
        } else {
            let start = first.parse::<u64>().map_err(|_| "invalid start")?;
            let end = if last.is_empty() {
                size - 1
            } else {
                last.parse::<u64>()
                    .map_err(|_| "invalid end")?
                    .min(size - 1)
            };
            (start, end)
        }
    } else {
        (0, size - 1)
    };
    if start >= size || end < start {
        return Err("unsatisfiable range".into());
    }
    Ok((start, end.min(start.saturating_add(MAX_CHUNK - 1))))
}
pub fn serve(path: &Path, request: &Request<Vec<u8>>) -> Result<Response<Vec<u8>>, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let mime = if path.extension().is_some_and(|e| e == "webm") {
        "video/webm"
    } else {
        "video/mp4"
    };
    let response = Response::builder()
        .header("Content-Type", mime)
        .header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*");
    if request.method() == "HEAD" {
        return response
            .status(200)
            .header("Content-Length", size)
            .body(Vec::new())
            .map_err(|e| e.to_string());
    }
    if request.method() != "GET" {
        return response
            .status(405)
            .body(Vec::new())
            .map_err(|e| e.to_string());
    }
    let range = request.headers().get("Range").and_then(|h| h.to_str().ok());
    let (start, end) = match byte_range(range, size) {
        Ok(range) => range,
        Err(_) => {
            return response
                .status(416)
                .header("Content-Range", format!("bytes */{size}"))
                .body(Vec::new())
                .map_err(|e| e.to_string())
        }
    };
    // Even a request without Range is bounded; multi-hour videos never become a single huge IPC response.
    let partial = range.is_some() || size > MAX_CHUNK;
    let mut response = response
        .status(if partial { 206 } else { 200 })
        .header("Content-Length", end - start + 1);
    if partial {
        response = response.header("Content-Range", format!("bytes {start}-{end}/{size}"));
    }
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut body = Vec::with_capacity((end - start + 1) as usize);
    file.take(end - start + 1)
        .read_to_end(&mut body)
        .map_err(|e| e.to_string())?;
    response.body(body).map_err(|e| e.to_string())
}
