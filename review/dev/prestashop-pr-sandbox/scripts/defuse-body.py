#!/usr/bin/env python3
"""Rewrites a PR body so the copy neither notifies people nor cross-references upstream.

Usage: defuse-body.py <upstream O/R> < body > body
GitHub adds a backlink on an issue or PR whenever another repository mentions it,
and pings every @user: the copy must stay invisible from upstream.
"""
import re
import sys

WJ = "⁠"  # invisible word joiner: keeps the text readable, breaks the autolink
upstream = sys.argv[1]
body = sys.stdin.read()

# Full links to issues/PRs: redirect.github.com is how Dependabot links without backlinks.
body = re.sub(r"https?://(?:www\.)?github\.com/([\w.-]+/[\w.-]+/(?:issues|pull|discussions)/\d+)",
              r"https://redirect.github.com/\1", body)
# owner/repo#123
body = re.sub(r"\b([\w.-]+/[\w.-]+)#(\d+)\b", lambda m: f"https://redirect.github.com/{m[1]}/issues/{m[2]}", body)
# bare #123 means an upstream issue, not one of the fork
body = re.sub(r"(?<![\w&/#])#(\d+)\b", lambda m: f"https://redirect.github.com/{upstream}/issues/{m[1]}", body)
# @mentions (but not e-mail addresses)
body = re.sub(r"(?<![\w`])@([A-Za-z0-9][\w-]*)", "@" + WJ + r"\1", body)

sys.stdout.write(body)
