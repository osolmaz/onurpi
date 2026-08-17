#!/usr/bin/env python3
"""Sort OpenClaw Onur inventory tables and refresh GitHub activity counts."""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_PATH = Path("OPENCLAW_ONUR_INVENTORY.md")
DEFAULT_REPO = "openclaw/openclaw"
COMMENT_WEIGHT = 4
REVIEW_COMMENT_WEIGHT = 4
REVIEW_BODY_WEIGHT = 5
REACTION_WEIGHT = 1
REPEAT_COMMENT_WEIGHT = 1
DEFAULT_IGNORED_ACCOUNTS = frozenset({"osolmaz", "dutifulbob"})
NEW_OPEN_THREADS_TITLE = "NEW OPEN THREADS"
FEATURED_ROW_LIMIT = 50
NEW_OPEN_THREADS_LIMIT = FEATURED_ROW_LIMIT
OPEN_THREADS_TITLE = "OPEN THREADS"
OPEN_ISSUES_TITLE = "OPEN ISSUES"
OPEN_PRS_TITLE = "OPEN PRS"
CLOSED_TITLE = "RECENTLY CLOSED OR REMOVED FROM OPEN INVENTORY"
OPEN_SECTION_TITLES = {OPEN_THREADS_TITLE, OPEN_ISSUES_TITLE, OPEN_PRS_TITLE}
ISSUE_EMOJI = "📝"
OLD_ISSUE_EMOJI = "\U0001F41B"
PR_EMOJI = "🔀"
THREAD_EMOJI_GAP = "&nbsp;"
THREAD_EMOJI_GAP_RE = r"(?:\s|&nbsp;|&#160;|&#xA0;|\u00a0)+"
THREAD_EMOJI_RE_SOURCE = rf"(?:{ISSUE_EMOJI}|{OLD_ISSUE_EMOJI}|{PR_EMOJI})"

THREAD_ROW_RE = re.compile(
    rf"^\| (?:(?:{THREAD_EMOJI_RE_SOURCE}){THREAD_EMOJI_GAP_RE})?\[#(?P<number>\d+)\]\((?P<url>[^)]+)\)",
)
SECTION_RE = re.compile(
    rf"^## (?P<title>{OPEN_THREADS_TITLE}|{OPEN_ISSUES_TITLE}|{OPEN_PRS_TITLE}|{CLOSED_TITLE})(?: \((?P<count>\d+)\))?$",
)
GENERATED_SECTION_RE = re.compile(
    rf"^## (?P<title>{NEW_OPEN_THREADS_TITLE})(?: \((?P<count>\d+)\))?$",
)
THREAD_URL_RE = re.compile(
    r"https://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/(?:issues|pull)/(?P<number>\d+)",
)
THREAD_EMOJI_RE = re.compile(rf"^{THREAD_EMOJI_RE_SOURCE}{THREAD_EMOJI_GAP_RE}")


@dataclass(frozen=True)
class ThreadRef:
    owner: str
    repo: str
    number: int
    kind: str

    @property
    def full_repo(self) -> str:
        return f"{self.owner}/{self.repo}"


@dataclass(frozen=True)
class ThreadMetadata:
    creator: str = ""
    created_at: str = ""


@dataclass
class Activity:
    issue_comment_score: int = 0
    issue_body_reactions: int = 0
    issue_comment_reactions: int = 0
    pr_review_comment_score: int = 0
    pr_review_comment_reactions: int = 0
    pr_review_body_score: int = 0

    @property
    def reactions(self) -> int:
        return (
            self.issue_body_reactions
            + self.issue_comment_reactions
            + self.pr_review_comment_reactions
        )

    @property
    def score(self) -> int:
        return (
            self.issue_comment_score
            + self.issue_body_reactions * REACTION_WEIGHT
            + self.issue_comment_reactions * REACTION_WEIGHT
            + self.pr_review_comment_score
            + self.pr_review_comment_reactions * REACTION_WEIGHT
            + self.pr_review_body_score
        )

    def format_cell(self) -> str:
        return str(self.score)


class GithubActivityClient:
    def __init__(
        self,
        *,
        exclude_spam: bool = True,
        ignored_accounts: set[str] | None = None,
    ) -> None:
        self.exclude_spam = exclude_spam
        self.ignored_accounts = normalize_accounts(ignored_accounts or set())
        self.cache: dict[ThreadRef, Activity] = {}

    def activity_for(self, thread: ThreadRef) -> Activity:
        if thread not in self.cache:
            self.cache[thread] = self._fetch_activity(thread)
        return self.cache[thread]

    def _fetch_activity(self, thread: ThreadRef) -> Activity:
        issue_comments = self._issue_comments(thread)
        issue_body_reactions = self._reactions(
            f"repos/{thread.full_repo}/issues/{thread.number}/reactions?per_page=100",
        )
        issue_comment_reactions = sum(
            self._reactions(
                f"repos/{thread.full_repo}/issues/comments/{comment['id']}/reactions?per_page=100",
            )
            for comment in issue_comments
        )

        activity = Activity(
            issue_comment_score=comment_score(issue_comments, COMMENT_WEIGHT),
            issue_body_reactions=issue_body_reactions,
            issue_comment_reactions=issue_comment_reactions,
        )
        if thread.kind == "pr":
            review_comments = self._pr_review_comments(thread)
            reviews = self._pr_reviews(thread)
            activity.pr_review_comment_score = comment_score(
                review_comments,
                REVIEW_COMMENT_WEIGHT,
            )
            activity.pr_review_comment_reactions = sum(
                self._reactions(
                    f"repos/{thread.full_repo}/pulls/comments/{comment['id']}/reactions?per_page=100",
                )
                for comment in review_comments
            )
            activity.pr_review_body_score = comment_score(reviews, REVIEW_BODY_WEIGHT)
        return activity

    def _issue_comments(self, thread: ThreadRef) -> list[dict[str, Any]]:
        comments = self._gh_json(
            "api",
            f"repos/{thread.full_repo}/issues/{thread.number}/comments?per_page=100",
            "--paginate",
            "--slurp",
        )
        comments = flatten_pages(comments)
        minimized = self._minimized_comment_ids(thread)
        kept = []
        for comment in comments:
            user = comment.get("user") or {}
            if self._is_ignored_actor(user):
                continue
            if self.exclude_spam and comment.get("id") in minimized:
                continue
            kept.append(comment)
        return kept

    def _reactions(self, endpoint: str) -> int:
        reactions = self._gh_json("api", endpoint, "--paginate", "--slurp")
        count = 0
        for reaction in flatten_pages(reactions):
            user = reaction.get("user") or {}
            if not self._is_ignored_actor(user):
                count += 1
        return count

    def _pr_review_comments(self, thread: ThreadRef) -> list[dict[str, Any]]:
        comments = self._gh_json(
            "api",
            f"repos/{thread.full_repo}/pulls/{thread.number}/comments?per_page=100",
            "--paginate",
            "--slurp",
        )
        kept = []
        for comment in flatten_pages(comments):
            user = comment.get("user") or {}
            if not self._is_ignored_actor(user):
                kept.append(comment)
        return kept

    def _pr_reviews(self, thread: ThreadRef) -> list[dict[str, Any]]:
        reviews = self._gh_json(
            "api",
            f"repos/{thread.full_repo}/pulls/{thread.number}/reviews?per_page=100",
            "--paginate",
            "--slurp",
        )
        kept = []
        for review in flatten_pages(reviews):
            user = review.get("user") or {}
            body = (review.get("body") or "").strip()
            if body and not self._is_ignored_actor(user):
                kept.append(review)
        return kept

    def _minimized_comment_ids(self, thread: ThreadRef) -> set[int]:
        if not self.exclude_spam:
            return set()

        node = "pullRequest" if thread.kind == "pr" else "issue"
        query = f"""
        query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {{
          repository(owner: $owner, name: $repo) {{
            {node}(number: $number) {{
              comments(first: 100, after: $cursor) {{
                pageInfo {{ hasNextPage endCursor }}
                nodes {{ databaseId isMinimized minimizedReason }}
              }}
            }}
          }}
        }}
        """
        variables: dict[str, Any] = {
            "owner": thread.owner,
            "repo": thread.repo,
            "number": thread.number,
            "cursor": None,
        }
        ids: set[int] = set()
        while True:
            result = self._gh_json(
                "api",
                "graphql",
                "-f",
                f"query={query}",
                "-F",
                f"owner={variables['owner']}",
                "-F",
                f"repo={variables['repo']}",
                "-F",
                f"number={variables['number']}",
                "-F",
                f"cursor={variables['cursor']}" if variables["cursor"] else "cursor=",
            )
            comments = (
                result.get("data", {})
                .get("repository", {})
                .get(node, {})
                .get("comments", {})
            )
            for comment in comments.get("nodes") or []:
                if (
                    comment.get("isMinimized")
                    and comment.get("minimizedReason") == "SPAM"
                    and comment.get("databaseId") is not None
                ):
                    ids.add(int(comment["databaseId"]))
            page_info = comments.get("pageInfo") or {}
            if not page_info.get("hasNextPage"):
                return ids
            variables["cursor"] = page_info.get("endCursor")

    def _gh_json(self, *args: str) -> Any:
        command = ["gh", *args]
        try:
            proc = subprocess.run(
                command,
                check=True,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except FileNotFoundError as exc:
            raise RuntimeError("gh is not installed or not on PATH") from exc
        except subprocess.CalledProcessError as exc:
            detail = exc.stderr.strip() or exc.stdout.strip() or str(exc)
            raise RuntimeError(f"{' '.join(command)} failed: {detail}") from exc
        if not proc.stdout.strip():
            return []
        return json.loads(proc.stdout)

    def _is_ignored_actor(self, user: dict[str, Any]) -> bool:
        return is_ignored_actor(
            user.get("login"),
            user.get("type"),
            self.ignored_accounts,
        )


def flatten_pages(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    if value and all(isinstance(item, list) for item in value):
        flattened: list[dict[str, Any]] = []
        for page in value:
            flattened.extend(item for item in page if isinstance(item, dict))
        return flattened
    return [item for item in value if isinstance(item, dict)]


def normalize_accounts(accounts: set[str]) -> set[str]:
    return {account.lower() for account in accounts if account}


def is_ignored_actor(
    login: str | None,
    user_type: str | None,
    ignored_accounts: set[str],
) -> bool:
    normalized_login = login.lower() if login else ""
    return (
        user_type == "Bot"
        or bool(login and login.endswith("[bot]"))
        or normalized_login in ignored_accounts
    )


def comment_score(items: list[dict[str, Any]], first_weight: int) -> int:
    counts: Counter[str] = Counter()
    for item in items:
        user = item.get("user") or {}
        login = user.get("login")
        if login:
            counts[login.lower()] += 1
    return sum(
        first_weight + max(0, count - 1) * REPEAT_COMMENT_WEIGHT
        for count in counts.values()
    )


def thread_number(row: str) -> int:
    match = THREAD_ROW_RE.match(row)
    if not match:
        raise ValueError(f"not a thread table row: {row}")
    return int(match.group("number"))


def activity_score(row: str, activity_index: int | None) -> int:
    if activity_index is None:
        return 0
    cells = split_row(row)
    if activity_index >= len(cells):
        return 0
    value = cells[activity_index].strip()
    match = re.search(r"-?\d+", value)
    return int(match.group(0)) if match else 0


def thread_ref_from_row(row: str, section_title: str, default_repo: str) -> ThreadRef | None:
    match = THREAD_ROW_RE.match(row)
    if not match:
        return None
    url_match = THREAD_URL_RE.search(match.group("url"))
    if url_match:
        return ThreadRef(
            owner=url_match.group("owner"),
            repo=url_match.group("repo"),
            number=int(url_match.group("number")),
            kind="pr" if "/pull/" in match.group("url") else "issue",
        )
    owner, repo = default_repo.split("/", maxsplit=1)
    return ThreadRef(
        owner=owner,
        repo=repo,
        number=int(match.group("number")),
        kind="pr"
        if section_title == OPEN_PRS_TITLE or row.startswith(f"| {PR_EMOJI}")
        else "issue",
    )


def next_section_index(lines: list[str], start: int) -> int:
    for index in range(start + 1, len(lines)):
        if lines[index].startswith("## "):
            return index
    return len(lines)


def split_row(row: str) -> list[str]:
    stripped = row.strip()
    if not (stripped.startswith("|") and stripped.endswith("|")):
        raise ValueError(f"not a markdown table row: {row}")
    return [cell.strip() for cell in stripped.strip("|").split("|")]


def join_row(cells: list[str]) -> str:
    return "| " + " | ".join(cells) + " |"


def thread_emoji(kind: str) -> str:
    return PR_EMOJI if kind == "pr" else ISSUE_EMOJI


def format_thread_cell(cell: str, kind: str) -> str:
    return f"{thread_emoji(kind)}{THREAD_EMOJI_GAP}{THREAD_EMOJI_RE.sub('', cell).strip()}"


def normalize_creator_handle(value: str) -> str:
    login = value.strip().removeprefix("@").strip()
    return f"@{login}" if login else ""


def default_gitcrawl_db_path() -> Path | None:
    env_path = os.environ.get("OPENCLAW_ONUR_INVENTORY_GITCRAWL_DB") or os.environ.get(
        "GITCRAWL_DB",
    )
    if env_path:
        return Path(env_path)

    for candidate in (
        Path("/gitcrawl/gitcrawl.db"),
        Path(".inventory-job-state/gitcrawl/gitcrawl.db"),
    ):
        if candidate.exists():
            return candidate
    return None


def load_thread_metadata(
    gitcrawl_db: Path | None,
    *,
    warnings: list[str],
) -> dict[ThreadRef, ThreadMetadata]:
    db_path = gitcrawl_db or default_gitcrawl_db_path()
    if db_path is None:
        return {}
    if not db_path.exists():
        warnings.append(f"metadata lookup skipped; Gitcrawl DB not found: {db_path}")
        return {}

    metadata_by_thread: dict[ThreadRef, ThreadMetadata] = {}
    try:
        connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            rows = connection.execute(
                """
                select r.full_name, t.kind, t.number, t.author_login, t.created_at_gh
                from threads t
                join repositories r on r.id = t.repo_id
                """,
            )
            for full_name, kind, number, author_login, created_at in rows:
                if not isinstance(full_name, str) or "/" not in full_name:
                    continue
                owner, repo = full_name.split("/", maxsplit=1)
                thread_kind = "pr" if kind == "pull_request" else "issue"
                creator = normalize_creator_handle(str(author_login))
                metadata_by_thread[
                    ThreadRef(
                        owner=owner,
                        repo=repo,
                        number=int(number),
                        kind=thread_kind,
                    )
                ] = ThreadMetadata(
                    creator=creator,
                    created_at=str(created_at or ""),
                )
        finally:
            connection.close()
    except sqlite3.Error as exc:
        warnings.append(f"metadata lookup skipped; Gitcrawl DB read failed: {exc}")

    return metadata_by_thread


def normalize_open_rows(
    lines: list[str],
    start: int,
    end: int,
    *,
    section_title: str,
    default_repo: str,
    metadata_by_thread: dict[ThreadRef, ThreadMetadata],
) -> list[tuple[str, ThreadRef]]:
    for index in range(start + 1, end):
        if not lines[index].startswith("| "):
            continue
        header = split_row(lines[index])
        if not header or header[0] not in {"Issue", "PR", "Thread"}:
            continue

        old_indexes = {name: pos for pos, name in enumerate(header)}
        rows: list[tuple[str, ThreadRef]] = []

        for row_index in range(index + 2, end):
            if not THREAD_ROW_RE.match(lines[row_index]):
                continue
            thread = thread_ref_from_row(lines[row_index], section_title, default_repo)
            if thread is None:
                continue
            cells = split_row(lines[row_index])

            def cell(name: str) -> str:
                old_index = old_indexes.get(name)
                if old_index is None or old_index >= len(cells):
                    return ""
                return cells[old_index]

            title = cell("Title")
            assignee = cell("Assignee")
            if assignee:
                title = f"{title}<br>Assignee: {assignee}" if title else f"Assignee: {assignee}"
            creator = normalize_creator_handle(cell("Creator")) or metadata_by_thread.get(
                thread,
                ThreadMetadata(),
            ).creator

            rows.append((
                join_row([
                    format_thread_cell(cells[0], thread.kind),
                    cell("Activity"),
                    cell("Area"),
                    creator,
                    title,
                ]),
                thread,
            ))

        return rows
    return []


def set_activity_cell(row: str, activity_index: int, value: str) -> str:
    cells = split_row(row)
    while len(cells) <= activity_index:
        cells.append("")
    cells[activity_index] = value
    return join_row(cells)


def sort_section_rows(
    lines: list[str],
    start: int,
    end: int,
    *,
    section_title: str,
    activity_index: int | None,
    activity_client: GithubActivityClient | None,
    default_repo: str,
    warnings: list[str],
) -> int:
    row_indexes = [
        index
        for index in range(start, end)
        if THREAD_ROW_RE.match(lines[index])
    ]
    if not row_indexes:
        return 0

    if activity_client is not None and activity_index is not None:
        for index in row_indexes:
            thread = thread_ref_from_row(lines[index], section_title, default_repo)
            if thread is None:
                continue
            try:
                activity = activity_client.activity_for(thread)
            except RuntimeError as exc:
                warnings.append(f"activity skipped for #{thread.number}: {exc}")
                continue
            lines[index] = set_activity_cell(
                lines[index],
                activity_index,
                activity.format_cell(),
            )

    rows = [lines[index] for index in row_indexes]
    if section_title in OPEN_SECTION_TITLES:
        sorted_rows = sorted(
            rows,
            key=lambda row: (activity_score(row, activity_index), thread_number(row)),
            reverse=True,
        )
    else:
        sorted_rows = sorted(rows, key=thread_number, reverse=True)
    for index, row in zip(row_indexes, sorted_rows, strict=True):
        lines[index] = row
    return len(sorted_rows)


def replace_count_line(lines: list[str], prefix: str, count: int) -> None:
    for index, line in enumerate(lines):
        if line.startswith(prefix):
            lines[index] = f"{prefix}{count}."
            return


def replace_open_count_line(lines: list[str], *, total: int, issue_count: int, pr_count: int) -> None:
    new_line = f"- Kept open threads: {total} ({issue_count} issues, {pr_count} PRs)."
    found = False
    filtered: list[str] = []
    for line in lines:
        if line.startswith("- Kept open threads: "):
            if not found:
                filtered.append(new_line)
                found = True
            continue
        if line.startswith("- Kept open issues: ") or line.startswith("- Kept open PRs: "):
            continue
        filtered.append(line)

    if not found:
        insert_at = next(
            (
                index
                for index, line in enumerate(filtered)
                if line.startswith("- Kept closed/removed")
            ),
            len(filtered),
        )
        filtered.insert(insert_at, new_line)

    lines[:] = filtered


def created_date_for_thread(
    thread: ThreadRef,
    metadata_by_thread: dict[ThreadRef, ThreadMetadata],
) -> str:
    created_at = metadata_by_thread.get(thread, ThreadMetadata()).created_at
    return created_at[:10] if created_at else ""


def insert_created_cell(row: str, created: str) -> str:
    cells = split_row(row)
    if len(cells) < 2:
        return row
    return join_row([cells[0], created, *cells[1:]])


def render_new_open_threads_section(
    rows: list[tuple[str, ThreadRef]],
    *,
    metadata_by_thread: dict[ThreadRef, ThreadMetadata],
    limit: int = NEW_OPEN_THREADS_LIMIT,
) -> list[str]:
    newest_rows = sorted(
        rows,
        key=lambda item: (
            metadata_by_thread.get(item[1], ThreadMetadata()).created_at,
            item[1].number,
        ),
        reverse=True,
    )[:limit]
    rendered_rows = [
        insert_created_cell(row, created_date_for_thread(thread, metadata_by_thread))
        for row, thread in newest_rows
    ]
    return [
        f"## {NEW_OPEN_THREADS_TITLE} ({len(rendered_rows)})",
        "",
        "| Thread | Created | Activity | Area | Creator | Title |",
        "| --- | --- | --- | --- | --- | --- |",
        *rendered_rows,
        "",
    ]


def render_open_threads_section(rows: list[str]) -> list[str]:
    visible_rows = rows[:FEATURED_ROW_LIMIT]
    overflow_rows = rows[FEATURED_ROW_LIMIT:]
    section = [
        f"## {OPEN_THREADS_TITLE} ({len(rows)})",
        "",
        "| Thread | Activity | Area | Creator | Title |",
        "| --- | --- | --- | --- | --- |",
        *visible_rows,
        "",
    ]
    if overflow_rows:
        section.extend(
            [
                "<details>",
                f"<summary>Remaining {len(overflow_rows)} open threads, sorted by activity</summary>",
                "",
                "| Thread | Activity | Area | Creator | Title |",
                "| --- | --- | --- | --- | --- |",
                *overflow_rows,
                "",
                "</details>",
                "",
            ],
        )
    return section


def remove_generated_sections(lines: list[str]) -> None:
    index = 0
    while index < len(lines):
        if GENERATED_SECTION_RE.match(lines[index]):
            end = next_section_index(lines, index)
            del lines[index:end]
            while index < len(lines) and lines[index] == "":
                del lines[index]
            continue
        index += 1


def refresh_open_activity(
    rows: list[tuple[str, ThreadRef]],
    *,
    activity_client: GithubActivityClient | None,
    warnings: list[str],
) -> list[tuple[str, ThreadRef]]:
    if activity_client is None:
        return rows
    refreshed: list[tuple[str, ThreadRef]] = []
    for row, thread in rows:
        try:
            activity = activity_client.activity_for(thread)
        except RuntimeError as exc:
            warnings.append(f"activity skipped for #{thread.number}: {exc}")
            refreshed.append((row, thread))
            continue
        refreshed.append((set_activity_cell(row, 1, activity.format_cell()), thread))
    return refreshed


def sort_document(
    path: Path,
    *,
    update_activity: bool = True,
    default_repo: str = DEFAULT_REPO,
    exclude_spam: bool = True,
    ignored_accounts: set[str] | None = None,
    gitcrawl_db: Path | None = None,
) -> tuple[int, int, int, bool, list[str]]:
    original = path.read_text()
    lines = original.splitlines()
    issue_count = 0
    pr_count = 0
    closed_count = 0
    warnings: list[str] = []

    activity_client = None
    if update_activity:
        activity_client = GithubActivityClient(
            exclude_spam=exclude_spam,
            ignored_accounts=ignored_accounts,
        )
    metadata_by_thread = load_thread_metadata(gitcrawl_db, warnings=warnings)
    remove_generated_sections(lines)

    open_sections: list[tuple[int, int, str]] = []
    for index, line in enumerate(lines):
        match = SECTION_RE.match(line)
        if not match:
            continue
        end = next_section_index(lines, index)
        title = match.group("title")
        if title in OPEN_SECTION_TITLES:
            open_sections.append((index, end, title))

    if open_sections:
        open_rows: list[tuple[str, ThreadRef]] = []
        for start, end, title in open_sections:
            open_rows.extend(
                normalize_open_rows(
                    lines,
                    start,
                    end,
                    section_title=title,
                    default_repo=default_repo,
                    metadata_by_thread=metadata_by_thread,
                ),
            )
        open_rows = refresh_open_activity(
            open_rows,
            activity_client=activity_client,
            warnings=warnings,
        )
        open_rows = sorted(
            open_rows,
            key=lambda item: (activity_score(item[0], 1), thread_number(item[0])),
            reverse=True,
        )
        issue_count = sum(1 for _, thread in open_rows if thread.kind == "issue")
        pr_count = sum(1 for _, thread in open_rows if thread.kind == "pr")

        first_start = open_sections[0][0]
        last_end = open_sections[-1][1]
        lines[first_start:last_end] = [
            *render_new_open_threads_section(
                open_rows,
                metadata_by_thread=metadata_by_thread,
            ),
            *render_open_threads_section([row for row, _ in open_rows]),
        ]

    for index, line in enumerate(lines):
        match = SECTION_RE.match(line)
        if not match:
            continue

        end = next_section_index(lines, index)
        title = match.group("title")
        if title != CLOSED_TITLE:
            continue
        activity_index = None

        count = sort_section_rows(
            lines,
            index,
            end,
            section_title=title,
            activity_index=activity_index,
            activity_client=None,
            default_repo=default_repo,
            warnings=warnings,
        )

        closed_count = count

    replace_open_count_line(lines, total=issue_count + pr_count, issue_count=issue_count, pr_count=pr_count)

    updated = "\n".join(lines) + "\n"
    changed = updated != original
    if changed:
        path.write_text(updated)

    return issue_count, pr_count, closed_count, changed, warnings


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sort OpenClaw Onur inventory tables by activity score and refresh activity counts.",
    )
    parser.add_argument(
        "path",
        nargs="?",
        default=DEFAULT_PATH,
        type=Path,
        help="Markdown file to sort.",
    )
    parser.add_argument(
        "--no-activity",
        action="store_true",
        help="Only sort/count rows; do not fetch GitHub activity scores.",
    )
    parser.add_argument(
        "--include-minimized-spam",
        action="store_true",
        help="Include comments minimized by GitHub as spam in activity counts.",
    )
    parser.add_argument(
        "--repo",
        default=DEFAULT_REPO,
        help="Default owner/repo for rows without a GitHub URL.",
    )
    parser.add_argument(
        "--gitcrawl-db",
        type=Path,
        help=(
            "Gitcrawl SQLite DB used to fill Creator cells. Defaults to "
            "OPENCLAW_ONUR_INVENTORY_GITCRAWL_DB, GITCRAWL_DB, /gitcrawl/gitcrawl.db, "
            "or .inventory-job-state/gitcrawl/gitcrawl.db when present."
        ),
    )
    parser.add_argument(
        "--ignored-account",
        action="append",
        default=[],
        help=(
            "GitHub login to exclude from activity counts. Can be repeated. "
            "Defaults also exclude osolmaz and dutifulbob."
        ),
    )
    parser.add_argument(
        "--no-default-ignored-accounts",
        action="store_true",
        help="Do not exclude the default osolmaz and dutifulbob accounts.",
    )
    args = parser.parse_args()

    env_skip_activity = os.environ.get("OPENCLAW_ONUR_INVENTORY_SKIP_ACTIVITY") == "1"
    env_ignored = {
        account.strip()
        for account in os.environ.get("OPENCLAW_ONUR_INVENTORY_IGNORED_ACCOUNTS", "").split(",")
        if account.strip()
    }
    ignored_accounts = set(args.ignored_account) | env_ignored
    if not args.no_default_ignored_accounts:
        ignored_accounts |= set(DEFAULT_IGNORED_ACCOUNTS)
    issue_count, pr_count, closed_count, changed, warnings = sort_document(
        args.path,
        update_activity=not args.no_activity and not env_skip_activity,
        default_repo=args.repo,
        exclude_spam=not args.include_minimized_spam,
        ignored_accounts=ignored_accounts,
        gitcrawl_db=args.gitcrawl_db,
    )
    status = "updated" if changed else "already sorted"
    print(
        f"{status}: open_threads={issue_count + pr_count} issues={issue_count} prs={pr_count} closed={closed_count}",
    )
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)


if __name__ == "__main__":
    main()
