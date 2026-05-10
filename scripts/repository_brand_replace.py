#!/usr/bin/env python3
"""
Replace OpenWork branding text with AiWork in file contents and rename paths.

Content replacement (substring; order matters):
  OPENWORK  -> AIWORK
  OpenWork  -> AiWork
  Openwork  -> AiWork
  openwork  -> aiwork

Renames any file or directory whose name contains one of the above forms,
excluding configured directories (node_modules, .git, ...).

This file is named without the old brand substring so the migration step does
not rename this script to a meaningless name.

Usage:
  python scripts/repository_brand_replace.py [--root DIR] [--dry-run] [--no-rename]

Additional skips:
  python scripts/repository_brand_replace.py --skip-dir vendor --skip-dir dist
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


# Longest / most specific first to avoid partial overlap issues.
TEXT_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("OPENWORK", "AIWORK"),
    ("OpenWork", "AiWork"),
    ("Openwork", "AiWork"),
    ("openwork", "aiwork"),
)

DEFAULT_SKIP_DIR_NAMES = frozenset(
    {
        "node_modules",
        ".git",
        "__pycache__",
        ".pnpm-store",
        ".venv",
        "venv",
        ".tox",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".cargo",
        "target",  # Rust build (often huge)
    }
)


def replace_text(data: str) -> str:
    out = data
    for old, new in TEXT_REPLACEMENTS:
        out = out.replace(old, new)
    return out


def should_skip_dir(name: str, extra_skip: frozenset[str]) -> bool:
    return name in DEFAULT_SKIP_DIR_NAMES or name in extra_skip


def iter_walk_paths(root: Path, extra_skip: frozenset[str]):
    """Yield all files under root, skipping excluded directory subtrees."""
    for dirpath, dirnames, filenames in os.walk(root, topdown=True):
        dirnames[:] = [
            d
            for d in dirnames
            if not should_skip_dir(d, extra_skip)
        ]
        base = Path(dirpath)
        for fn in filenames:
            yield base / fn


def is_probably_binary(path: Path, chunk_size: int = 8192) -> bool:
    try:
        with path.open("rb") as f:
            chunk = f.read(chunk_size)
    except OSError:
        return True
    if not chunk:
        return False
    if b"\x00" in chunk:
        return True
    # Heuristic: high ratio of non-text bytes
    text_bytes = sum(1 for b in chunk if 32 <= b <= 126 or b in (9, 10, 13))
    return text_bytes / len(chunk) < 0.7


def process_file(path: Path, dry_run: bool) -> bool:
    """Return True if file was changed."""
    if is_probably_binary(path):
        return False
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            text = path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError:
            return False
    except OSError:
        return False

    new_text = replace_text(text)
    if new_text == text:
        return False
    if dry_run:
        print(f"[dry-run] would patch: {path}")
        return True
    path.write_text(new_text, encoding="utf-8", newline="")
    print(f"patched: {path}")
    return True


def replace_name_component(name: str) -> str | None:
    """If name contains any openwork variant, return the new name."""
    out = name
    for old, new in TEXT_REPLACEMENTS:
        out = out.replace(old, new)
    return out if out != name else None


def collect_rename_paths(root: Path, extra_skip: frozenset[str]) -> list[Path]:
    """Paths (files or dirs) whose final component contains an openwork variant."""
    need: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root, topdown=True):
        dirnames[:] = [d for d in dirnames if not should_skip_dir(d, extra_skip)]
        base = Path(dirpath)

        for fn in filenames:
            if replace_name_component(fn):
                need.append(base / fn)

        if base != root and replace_name_component(base.name):
            need.append(base)

    return need


def rename_paths(paths: list[Path], dry_run: bool) -> int:
    """Rename paths from deepest to shallowest so parents exist. Returns count."""
    # Sort by path depth descending (deepest first)
    sorted_paths = sorted(paths, key=lambda p: len(p.parts), reverse=True)
    count = 0
    for old_path in sorted_paths:
        new_name = replace_name_component(old_path.name)
        if not new_name:
            continue
        new_path = old_path.with_name(new_name)
        if new_path == old_path:
            continue
        if dry_run:
            print(f"[dry-run] would rename: {old_path} -> {new_path}")
            count += 1
            continue
        try:
            old_path.rename(new_path)
            print(f"renamed: {old_path} -> {new_path}")
            count += 1
        except OSError as e:
            print(f"ERROR renaming {old_path}: {e}", file=sys.stderr)
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description="Replace openwork -> aiwork (case-preserving) in repo.")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="Repository root (default: current directory)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print actions without writing or renaming",
    )
    parser.add_argument(
        "--no-rename",
        action="store_true",
        help="Only patch file contents, do not rename paths",
    )
    parser.add_argument(
        "--skip-dir",
        action="append",
        default=[],
        metavar="NAME",
        help="Additional directory base names to skip (repeatable)",
    )
    args = parser.parse_args()

    root = args.root.resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        return 1

    extra_skip = frozenset(args.skip_dir)

    patched = 0
    for path in iter_walk_paths(root, extra_skip):
        if not path.is_file():
            continue
        if process_file(path, args.dry_run):
            patched += 1

    renamed = 0
    if not args.no_rename:
        to_rename = collect_rename_paths(root, extra_skip)
        renamed = rename_paths(to_rename, args.dry_run)

    mode = "dry-run " if args.dry_run else ""
    print(
        f"\nDone ({mode}root={root}): "
        f"{patched} file(s) patched, {renamed} path(s) renamed."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
