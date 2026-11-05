"""Run with backend/.venv/Scripts/python.exe -m unittest discover -s backend -p test_sentence_boundary.py."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

from sentence_boundary import word_boundaries


class SentenceBoundaryTests(unittest.TestCase):
    def test_abbreviations_do_not_create_fragments(self):
        cases = [
            ("The U.S. Army is here. We should leave.", [5, 8]),
            ("We met at Acme Inc. Then we left.", [5, 8]),
            ("Bring fruit, e.g. Apples and pears.", [6]),
            ("My name is Jonas E. Smith. Please turn to p. 55.", [6, 11]),
            ("Dr. Watson noted that pi is 3.14. It is well known.", [7, 11]),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                self.assertEqual(word_boundaries(text.split()), expected)

    def test_repeated_sentences_keep_distinct_positions(self):
        self.assertEqual(word_boundaries(["Yes.", "No.", "Yes."]), [1, 2, 3])

    def test_offsets_support_non_bmp_unicode_and_atomic_words(self):
        self.assertEqual(word_boundaries(["\U0001f600", "Hello.", "Next."]), [2, 3])
        self.assertEqual(word_boundaries(["Hello. Next."]), [1])

    def test_punctuation_missing_text_is_retained(self):
        self.assertEqual(word_boundaries("a sentence without an ending".split()), [5])
        self.assertEqual(word_boundaries([]), [])

    def test_input_contract(self):
        for invalid in [None, {"words": []}, [1], [{"text": "Hello."}]]:
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    word_boundaries(invalid)

    def test_cli_uses_the_same_word_boundaries(self):
        script = Path(__file__).with_name("sentence_boundary.py")
        result = subprocess.run(
            [sys.executable, "-B", str(script)],
            input=json.dumps(["Yes.", "No.", "Yes."]), capture_output=True,
            encoding="utf-8", env={**os.environ, "PYTHONUTF8": "1"}, check=True,
        )
        self.assertEqual(json.loads(result.stdout), [1, 2, 3])

    def test_missing_dependency_is_an_error_not_a_regex_fallback(self):
        script = Path(__file__).with_name("sentence_boundary.py")
        result = subprocess.run(
            [sys.executable, "-S", "-B", str(script)], input='["Hello."]',
            capture_output=True, encoding="utf-8", env={**os.environ, "PYTHONUTF8": "1"},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("pySBD", result.stderr)


if __name__ == "__main__":
    unittest.main()
