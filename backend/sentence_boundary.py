"""Return exclusive word indices from real pySBD sentence boundaries.

stdin: a JSON array of original word strings
stdout: a JSON array of increasing exclusive end indices, ending at len(words).
Only boundaries cross the bridge; original text, confidence and timing stay in the editor.
"""
import argparse
import json
import sys


def segmenter(language="en"):
    try:
        import pysbd
    except ImportError as error:
        raise RuntimeError(
            "pySBD가 설치되어 있지 않습니다. npm run setup:backend를 실행해 주세요."
        ) from error
    return pysbd.Segmenter(language=language, clean=False, char_span=True)


def word_boundaries(words, language="en"):
    if not isinstance(words, list) or any(not isinstance(word, str) for word in words):
        raise ValueError("문장 분석 입력은 원문 단어 문자열 목록이어야 합니다.")
    if not words:
        return []

    text = " ".join(words)
    spans = segmenter(language).segment(text)
    starts = []
    offset = 0
    for word in words:
        starts.append(offset)
        offset += len(word) + 1

    ends = []
    index = 0
    # Use positions, not sentence string equality (repeated sentences remain separate).
    # Mapping occurs entirely in Python, so non-BMP characters cannot shift JS UTF-16 offsets.
    for span in spans[:-1]:
        while index < len(words) and starts[index] < span.end:
            index += 1
        if 0 < index < len(words) and (not ends or ends[-1] < index):
            ends.append(index)
    ends.append(len(words))
    return ends


def main():
    parser = argparse.ArgumentParser(description="pySBD sentence boundary worker")
    parser.add_argument("--text")
    parser.add_argument("--language", default="en")
    args = parser.parse_args()
    try:
        if args.text is not None:
            output = [span.sent.strip() for span in segmenter(args.language).segment(args.text)]
        else:
            output = word_boundaries(json.load(sys.stdin), args.language)
        print(json.dumps(output, ensure_ascii=False))
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
