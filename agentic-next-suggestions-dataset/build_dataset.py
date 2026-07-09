#!/usr/bin/env python3
"""Build a local next-user-message dataset from agent trace JSONL files."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
HOME = Path.home()
DEFAULT_OUT = ROOT / "dataset.jsonl"
DEFAULT_MANIFEST = ROOT / "manifest.json"
MAX_CONTEXT_MESSAGES = 8
MAX_CONTEXT_CHARS = 20_000


@dataclass(frozen=True)
class Source:
    family: str
    fmt: str
    root: Path
    label: str


SOURCES = [
    Source("spanner", "pi", HOME / ".spanner" / "pi-sessions", "spanner pi-sessions"),
    Source("spanner", "pi", HOME / ".makerspace" / "pi-sessions", "legacy makerspace pi-sessions"),
    Source("pi", "pi", HOME / ".pi" / "agent" / "sessions", "pi cli sessions"),
    Source("claude_code", "claude", HOME / ".claude" / "projects", "claude code projects"),
    Source("codex", "codex", HOME / ".codex" / "sessions", "codex sessions"),
    Source("codex", "codex", HOME / ".codex" / "archived_sessions", "codex archived sessions"),
]

SYNTHETIC_BLOCK_RE = re.compile(
    r"<(?P<tag>system-reminder|environment_context|project_context)>.*?</(?P=tag)>",
    re.DOTALL | re.IGNORECASE,
)


class Stats:
    def __init__(self) -> None:
        self.by_source: dict[str, Counter[str]] = defaultdict(Counter)
        self.skipped = Counter()
        self.roots: list[dict[str, Any]] = []

    def inc(self, source: str, key: str, amount: int = 1) -> None:
        self.by_source[source][key] += amount


def stable_hash(value: str, n: int = 16) -> str:
    return hashlib.sha256(value.encode("utf-8", "replace")).hexdigest()[:n]


def display_path(path: Path) -> str:
    try:
        rel = path.resolve().relative_to(HOME)
        return "~/" + rel.as_posix()
    except ValueError:
        try:
            return path.resolve().relative_to(Path.cwd()).as_posix()
        except ValueError:
            return str(path)


def read_jsonl(path: Path, stats: Stats, source_key: str):
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line_no, line in enumerate(fh, 1):
                if not line.strip():
                    continue
                try:
                    yield line_no, json.loads(line)
                except json.JSONDecodeError:
                    stats.inc(source_key, "bad_json_lines")
    except OSError:
        stats.inc(source_key, "unreadable_files")


def clean_text(text: str, role: str) -> str:
    text = SYNTHETIC_BLOCK_RE.sub("", text).replace("\r\n", "\n").strip()
    normalized = " ".join(text.split())
    if role == "user" and text.startswith("# AGENTS.md instructions") and "<INSTRUCTIONS>" in text:
        return ""
    if role == "user" and normalized.startswith("Warning: apply_patch was requested via exec_command"):
        return ""
    if role == "user" and normalized.startswith("[Request interrupted by user"):
        return ""
    if role == "user" and normalized.startswith("<turn_aborted>"):
        return ""
    if role == "user" and text.startswith("<") and text.endswith(">") and "\n" not in text:
        return ""
    return text


def content_text(content: Any, kinds: set[str] | None = None) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, str):
            parts.append(item)
            continue
        if not isinstance(item, dict):
            continue
        kind = item.get("type")
        if kinds is not None and kind not in kinds:
            continue
        if isinstance(item.get("text"), str):
            parts.append(item["text"])
    return "\n\n".join(p for p in parts if p).strip()


def pi_message(obj: dict[str, Any]) -> tuple[str, str, str] | None:
    if obj.get("type") != "message" or not isinstance(obj.get("message"), dict):
        return None
    msg = obj["message"]
    role = msg.get("role")
    if role == "user":
        text = content_text(msg.get("content"), {"text"})
    elif role == "assistant":
        text = content_text(msg.get("content"), {"text"})
    else:
        return None
    text = clean_text(text, role)
    if not text:
        return None
    return role, text, str(obj.get("timestamp") or "")


def claude_message(obj: dict[str, Any]) -> tuple[str, str, str] | None:
    role = obj.get("type")
    if role not in {"user", "assistant"} or not isinstance(obj.get("message"), dict):
        return None
    msg = obj["message"]
    if msg.get("role") != role:
        return None
    text = content_text(msg.get("content"), {"text"}) if isinstance(msg.get("content"), list) else content_text(msg.get("content"))
    text = clean_text(text, role)
    if not text:
        return None
    return role, text, str(obj.get("timestamp") or "")


def codex_message(obj: dict[str, Any]) -> tuple[str, str, str] | None:
    if obj.get("type") != "response_item" or not isinstance(obj.get("payload"), dict):
        return None
    payload = obj["payload"]
    role = payload.get("role")
    if role == "user":
        text = content_text(payload.get("content"), {"input_text"})
    elif role == "assistant":
        text = content_text(payload.get("content"), {"output_text"})
    else:
        return None
    text = clean_text(text, role)
    if not text:
        return None
    return role, text, str(obj.get("timestamp") or "")


PARSERS = {"pi": pi_message, "claude": claude_message, "codex": codex_message}


def discover_files(source: Source, stats: Stats) -> list[Path]:
    exists = source.root.exists()
    stats.roots.append({"source": source.family, "label": source.label, "path": display_path(source.root), "exists": exists})
    if not exists:
        stats.skipped["missing_roots"] += 1
        return []
    files = sorted(source.root.rglob("*.jsonl"))
    if source.fmt == "claude":
        kept = []
        for path in files:
            if "subagents" in path.parts or path.name == "journal.jsonl":
                stats.inc(source.family, "skipped_subagent_files")
                continue
            kept.append(path)
        files = kept
    stats.inc(source.family, "files_discovered", len(files))
    return files


def codex_state_paths(stats: Stats) -> list[Path]:
    db = HOME / ".codex" / "sqlite" / "state_5.sqlite"
    if not db.exists():
        return []
    paths: list[Path] = []
    try:
        with sqlite3.connect(db) as con:
            for (rollout_path,) in con.execute("select rollout_path from threads where rollout_path like '%.jsonl'"):
                path = Path(rollout_path).expanduser()
                if path.exists():
                    paths.append(path)
                else:
                    stats.inc("codex", "missing_state_rollout_paths")
    except sqlite3.Error:
        stats.inc("codex", "state_db_errors")
    return paths


def parse_file(source: Source, path: Path, stats: Stats) -> dict[str, Any]:
    parser = PARSERS[source.fmt]
    meta: dict[str, Any] = {"session_id": "", "cwd": "", "created_at": ""}
    messages: list[dict[str, Any]] = []
    for line_no, obj in read_jsonl(path, stats, source.family):
        if obj.get("type") in {"session", "session_meta"}:
            payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else obj
            meta["session_id"] = str(payload.get("id") or meta["session_id"] or "")
            meta["cwd"] = str(payload.get("cwd") or meta["cwd"] or "")
            meta["created_at"] = str(payload.get("timestamp") or obj.get("timestamp") or meta["created_at"] or "")
        parsed = parser(obj)
        if not parsed:
            continue
        role, text, timestamp = parsed
        messages.append({"role": role, "text": text, "timestamp": timestamp, "line": line_no})
    stats.inc(source.family, "files_parsed")
    stats.inc(source.family, "visible_messages", len(messages))
    stats.inc(source.family, "user_messages", sum(1 for m in messages if m["role"] == "user"))
    return {"meta": meta, "messages": messages}


def trim_context(messages: list[dict[str, Any]]) -> tuple[list[dict[str, str]], bool, int, bool]:
    omitted = max(0, len(messages) - MAX_CONTEXT_MESSAGES)
    if omitted:
        messages = [messages[0], *messages[-(MAX_CONTEXT_MESSAGES - 1):]]
    out = [{"role": m["role"], "text": m["text"]} for m in messages]
    total = sum(len(m["text"]) for m in out)
    char_trimmed = total > MAX_CONTEXT_CHARS
    if not char_trimmed:
        return out, bool(omitted), omitted, False
    over = total - MAX_CONTEXT_CHARS
    for msg in out:
        if over <= 0:
            break
        if msg["role"] != "assistant" or len(msg["text"]) <= 1000:
            continue
        cut = min(over, len(msg["text"]) - 1000)
        msg["text"] = "[...trimmed...]\n" + msg["text"][cut:]
        over -= cut
    return out, True, omitted, True


def build_examples(source: Source, path: Path, parsed: dict[str, Any], seen_examples: set[str], stats: Stats) -> list[dict[str, Any]]:
    messages = parsed["messages"]
    user_positions = [i for i, msg in enumerate(messages) if msg["role"] == "user"]
    if len(user_positions) < 2:
        stats.inc(source.family, "conversations_without_pairs")
        return []
    meta = parsed["meta"]
    raw_conversation_id = meta.get("session_id") or path.stem
    conversation_hash = stable_hash(f"{source.family}\0{raw_conversation_id}\0{display_path(path)}")
    examples = []
    for turn_index, pos in enumerate(user_positions[:-1]):
        next_pos = user_positions[turn_index + 1]
        current = messages[pos]
        target = messages[next_pos]
        context, truncated, omitted_context_messages, context_char_trimmed = trim_context(messages[pos:next_pos])
        dedupe_key = stable_hash(json.dumps([source.family, current["text"], context, target["text"]], ensure_ascii=False), 32)
        if dedupe_key in seen_examples:
            stats.inc(source.family, "duplicate_examples")
            continue
        seen_examples.add(dedupe_key)
        examples.append({
            "id": "ex_" + dedupe_key[:20],
            "source": source.family,
            "source_label": source.label,
            "source_file": display_path(path),
            "conversation_id": conversation_hash,
            "raw_conversation_id": raw_conversation_id,
            "cwd": display_path(Path(meta["cwd"])) if meta.get("cwd") else "",
            "turn_index": turn_index,
            "current_user_message": current["text"],
            "context_messages": context,
            "next_user_message": target["text"],
            "current_timestamp": current.get("timestamp", ""),
            "next_timestamp": target.get("timestamp", ""),
            "context_truncated": truncated,
            "omitted_context_messages": omitted_context_messages,
            "context_char_trimmed": context_char_trimmed,
        })
    stats.inc(source.family, "examples", len(examples))
    return examples


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    args = ap.parse_args()

    stats = Stats()
    source_files: list[tuple[Source, Path]] = []
    for source in SOURCES:
        source_files.extend((source, path) for path in discover_files(source, stats))
    codex_extra = set(codex_state_paths(stats)) - {p for _, p in source_files}
    source_files.extend((Source("codex", "codex", path.parent, "codex state rollout"), path) for path in sorted(codex_extra))

    seen_conversations: set[tuple[str, str]] = set()
    seen_examples: set[str] = set()
    examples: list[dict[str, Any]] = []
    for source, path in source_files:
        parsed = parse_file(source, path, stats)
        session_id = parsed["meta"].get("session_id") or ""
        if session_id:
            conv_key = (source.family, session_id)
            if conv_key in seen_conversations:
                stats.inc(source.family, "duplicate_conversations")
                continue
            seen_conversations.add(conv_key)
        batch = build_examples(source, path, parsed, seen_examples, stats)
        examples.extend(batch)

    examples.sort(key=lambda e: (e.get("next_timestamp") or "", e["source"], e["id"]))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as fh:
        for ex in examples:
            fh.write(json.dumps(ex, ensure_ascii=False, separators=(",", ":")) + "\n")

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset_path": display_path(args.out),
        "schema": {
            "input": "context_messages plus current_user_message",
            "target": "next_user_message",
            "note": "Generated files contain private local conversation text.",
        },
        "totals": {
            "examples": len(examples),
            "files_considered": len(source_files),
            "sources": sorted({s.family for s, _ in source_files}),
            "context_truncated_examples": sum(1 for ex in examples if ex["context_truncated"]),
        },
        "source_roots": stats.roots,
        "by_source": {source: dict(counter) for source, counter in sorted(stats.by_source.items())},
        "skipped": dict(stats.skipped),
    }
    with args.manifest.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(json.dumps(manifest["totals"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
