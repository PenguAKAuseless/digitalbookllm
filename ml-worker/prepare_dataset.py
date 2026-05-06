from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable


def chunk_text(text: str, min_chars: int, max_chars: int) -> Iterable[str]:
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    current: list[str] = []
    current_len = 0

    for paragraph in paragraphs:
        p_len = len(paragraph)
        if current and current_len + p_len > max_chars:
            chunk = "\n\n".join(current).strip()
            if len(chunk) >= min_chars:
                yield chunk
            current = [paragraph]
            current_len = p_len
            continue

        current.append(paragraph)
        current_len += p_len

    tail = "\n\n".join(current).strip()
    if len(tail) >= min_chars:
        yield tail


def to_instruction_example(text_chunk: str) -> dict[str, str]:
    return {
        "prompt": (
            "You are a document tutor. Explain the key ideas from the provided context, "
            "then provide two review questions and one practical takeaway."
            "\n\nContext:\n"
            f"{text_chunk}"
        ),
        "completion": (
            "Key Ideas:\n"
            "- [Fill using the context]\n"
            "- [Identify supporting details]\n"
            "\nReview Questions:\n"
            "1. [Question 1]\n"
            "2. [Question 2]\n"
            "\nPractical Takeaway:\n"
            "- [One actionable takeaway]"
        ),
    }


def build_dataset(source_dir: Path, output_file: Path, min_chars: int, max_chars: int) -> int:
    source_files = sorted(source_dir.glob("*.txt"))
    output_file.parent.mkdir(parents=True, exist_ok=True)

    count = 0
    with output_file.open("w", encoding="utf-8") as out:
        for file_path in source_files:
            text = file_path.read_text(encoding="utf-8", errors="ignore")
            for chunk in chunk_text(text, min_chars=min_chars, max_chars=max_chars):
                record = to_instruction_example(chunk)
                out.write(json.dumps(record, ensure_ascii=True) + "\n")
                count += 1

    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare local fine-tune dataset from text files")
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output-file", required=True, type=Path)
    parser.add_argument("--min-chars", type=int, default=400)
    parser.add_argument("--max-chars", type=int, default=1800)
    args = parser.parse_args()

    total = build_dataset(
        source_dir=args.source_dir,
        output_file=args.output_file,
        min_chars=args.min_chars,
        max_chars=args.max_chars,
    )
    print(f"Created {total} training examples at {args.output_file}")


if __name__ == "__main__":
    main()
