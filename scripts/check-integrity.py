#!/usr/bin/env python3
"""
File integrity checker — run immediately after any Edit tool call.

Usage:
  python3 scripts/check-integrity.py                  # check all tracked source files
  python3 scripts/check-integrity.py path/to/file.ts  # check specific file(s)

Root cause this guards against:
  The Edit tool writes to Windows NTFS (C:\\Users\\...). The Linux sandbox reads
  those files via a mount bridge. Large writes are silently truncated on the
  mount side at an arbitrary byte boundary. The Read tool reads from Windows and
  shows correct content, masking the corruption until a bash/tsc command runs.

Safe write pattern (bypasses truncation):
  python3 -c "open('path','wb').write(content)"  # always lands correctly
"""

import os
import sys
import json

MOUNT = "/sessions/loving-cool-gates/mnt/Demaze AI Outbound Intelligence Platform/demaze-platform"

# Files to always check
TRACKED = [
    "lib/pipeline/evidence-extractor.ts",
    "app/api/admin/test-analysis/route.ts",
    "benchmarks/benchmark-runner.ts",
    "benchmarks/benchmark-types.ts",
    "tsconfig.json",
    "package.json",
]

# Valid last-line tokens per extension
VALID_ENDINGS = {
    ".ts":   {b"}", b"})", b"})"},
    ".tsx":  {b"}", b"})", b"})"},
    ".json": {b"}", b"}}", b"]"},
    ".js":   {b"}", b"})", b"})"},
}

def check_file(rel_path: str) -> tuple[bool, str]:
    path = os.path.join(MOUNT, rel_path) if not os.path.isabs(rel_path) else rel_path
    if not os.path.exists(path):
        return False, f"FILE NOT FOUND: {path}"

    with open(path, "rb") as f:
        raw = f.read()

    if len(raw) == 0:
        return False, "EMPTY FILE"

    ext = os.path.splitext(path)[1].lower()
    last_line = raw.rstrip(b"\n\r ").split(b"\n")[-1].strip()

    # JSON: try parsing
    if ext == ".json":
        try:
            json.loads(raw.decode("utf-8"))
            return True, f"OK  ({len(raw):,} bytes)"
        except json.JSONDecodeError as e:
            return False, f"INVALID JSON: {e} — last_line={repr(last_line[:60])}"

    # TypeScript/JS: check last token
    valid = VALID_ENDINGS.get(ext, set())
    if valid and last_line not in valid:
        return False, f"TRUNCATED — last_line={repr(last_line[:80])} ({len(raw):,} bytes)"

    return True, f"OK  ({len(raw):,} bytes)"


def main():
    targets = sys.argv[1:] if len(sys.argv) > 1 else TRACKED

    any_fail = False
    for rel in targets:
        ok, msg = check_file(rel)
        status = "✓" if ok else "✗"
        label = rel if not os.path.isabs(rel) else os.path.relpath(rel, MOUNT)
        print(f"  {status}  {label:<55} {msg}")
        if not ok:
            any_fail = True

    if any_fail:
        print("\n  ✗ INTEGRITY FAILURE — repair with Python before proceeding")
        sys.exit(1)
    else:
        print("\n  ✓ All files intact")
        sys.exit(0)


if __name__ == "__main__":
    main()
