"""Local speech-to-text worker for the Tauri app.

Writes one JSON object per line to stdout:
  {"type": "status",   "message": str, "device": str | None}
  {"type": "progress", "seconds": float, "duration": float}
  {"type": "segment",  "words": [{"text", "start", "end", "prob"}]}
  {"type": "reset"}  # GPU failed; discard words received so far
  {"type": "done",     "language": str, "device": str}
  {"type": "error",    "message": str}
"""

import argparse
import json
import os
import site
import sys
from pathlib import Path


def emit(**payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def expose_cuda_dlls():
    """ctranslate2 loads CUDA by bare DLL name, so the pip-installed ones must be on PATH."""
    for root in site.getsitepackages():
        for sub in ("nvidia/cublas/bin", "nvidia/cudnn/bin", "nvidia/cuda_nvrtc/bin"):
            path = Path(root) / sub
            if path.is_dir():
                os.environ["PATH"] = f"{path}{os.pathsep}{os.environ.get('PATH', '')}"
                os.add_dll_directory(str(path))


def run(args, device, compute_type):
    from faster_whisper import WhisperModel

    emit(type="status", message=f"모델 불러오는 중 ({args.model}, {device})", device=device)
    model = WhisperModel(args.model, device=device, compute_type=compute_type)

    emit(type="status", message="음성 인식 중", device=device)
    segments, info = model.transcribe(
        args.input,
        language=None if args.language == "auto" else args.language,
        word_timestamps=True,
        vad_filter=True,
        condition_on_previous_text=False,
        hotwords=args.hotwords or None,
    )

    emit(type="progress", seconds=0, duration=info.duration)
    for segment in segments:
        words = [
            {
                "text": word.word.strip(),
                "start": round(word.start, 3),
                "end": round(word.end, 3),
                "prob": round(word.probability, 3),
            }
            for word in segment.words or []
            if word.word.strip()
        ]
        if words:
            emit(type="segment", words=words)
        emit(type="progress", seconds=segment.end, duration=info.duration)

    emit(type="done", language=info.language, device=device)


def is_gpu_failure(error):
    text = str(error).lower()
    return any(key in text for key in ("cuda", "cublas", "cudnn", "out of memory", "mkl_malloc"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--language", default="en")
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    parser.add_argument("--hotwords", default="")
    args = parser.parse_args()

    expose_cuda_dlls()

    attempts = {
        "auto": [("cuda", "float16"), ("cpu", "int8")],
        "cuda": [("cuda", "float16")],
        "cpu": [("cpu", "int8")],
    }[args.device]

    for index, (device, compute_type) in enumerate(attempts):
        try:
            run(args, device, compute_type)
            return 0
        except Exception as error:  # noqa: BLE001 - reported to the UI as-is
            if index + 1 < len(attempts) and is_gpu_failure(error):
                emit(type="status", message=f"GPU 사용 실패, CPU로 다시 시작합니다: {error}", device="cpu")
                emit(type="reset")
                continue
            emit(type="error", message=str(error))
            return 1
    return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
