#!/usr/bin/env python3
"""Merge pinned BentoML and Modular revisions into one Markdown corpus."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit, urlunsplit


@dataclass(frozen=True)
class SourceSpec:
    key: str
    repository: str
    commit: str
    rendered_root: str

    @property
    def raw_root(self) -> str:
        repository_path = self.repository.removeprefix("https://github.com/")
        return f"https://raw.githubusercontent.com/{repository_path}/{self.commit}"


@dataclass(frozen=True)
class MergePatch:
    path: str
    anchor: str
    placement: str
    retained_file: str
    source_checks: tuple[str, ...]


BENTOML = SourceSpec(
    key="bentoml",
    repository="https://github.com/bentoml/llm-inference-handbook",
    commit="ea07b2ccd9b35db810763fc76980b26be1d2b871",
    rendered_root="https://bentoml.com/llm",
)
MODULAR = SourceSpec(
    key="modular",
    repository="https://github.com/modular/llm-inference-handbook",
    commit="317b9816ec3080031333ed9ee44dfce919763bf7",
    rendered_root="https://handbook.modular.com",
)

MERGE_PATCHES = (
    MergePatch(
        path="getting-started/on-prem-llms.md",
        anchor=(
            "The decision usually depends on compliance requirements, traffic "
            "patterns, and\nhow much operational complexity your team is willing "
            "to manage."
        ),
        placement="after",
        retained_file="hybrid-overflow.md",
        source_checks=(
            "## Overflowing to the cloud: A hybrid approach",
            "GPU procurement cycles are long",
            "traffic can overflow to the cloud",
            "Use cloud GPUs to handle spikes",
            "only pay for overflowed cloud GPUs during peaks",
        ),
    ),
    MergePatch(
        path="inference-optimization/llm-performance-benchmarks.md",
        anchor="### End-to-end benchmarking with MAX",
        placement="before",
        retained_file="llm-optimizer.md",
        source_checks=(
            "### End-to-end benchmarking with llm-optimizer",
            "Run systematic benchmarks across inference frameworks",
            "Apply SLO constraints",
            "Estimate performance theoretically",
            "LLM Performance Explorer",
        ),
    ),
)

WRAPPER_TAGS = {"Features", "LinkList"}
OMITTED_COMPONENTS = {"DocCardList", "Newsletter", "StackQuiz"}
INTERACTIVE_COMPONENTS = {
    "AutoregressiveDecodeStepper": "token-by-token decode visualizer",
    "BatchingSimulator": "batching simulator",
    "ChunkedPrefillVisualizer": "chunked prefill visualizer",
    "ContextWindowSimulator": "context-window simulator",
    "GPUMemoryCalculator": "GPU memory calculator",
    "GPUExecutionVisualizer": "GPU execution visualizer",
    "GPUTable": "GPU comparison table",
    "KVCacheCalculator": "KV-cache calculator",
    "LatencyMetrics": "latency metrics playground",
    "LatencyTimelineVisualizer": "latency timeline visualizer",
    "LLMLifecycleMap": "LLM lifecycle visualizer",
    "ModelExplorer": "model explorer",
    "QuantizationVisualizer": "quantization visualizer",
    "RequestLifecycle": "request lifecycle visualizer",
    "TopPvsTopK": "top-p and top-k visualizer",
}

DIAGRAM_RE = re.compile(r'^<Diagram name="([^"]+)" alt="([^"]+)"\s*/>$')
REQUIRE_IMAGE_RE = re.compile(
    r"^\s*<img src=\{require\('([^']+)'\)\.default\} alt=\"([^\"]+)\"\s*/>\s*$"
)
SELF_CLOSING_COMPONENT_RE = re.compile(r"^<([A-Z][A-Za-z0-9]*)\s*/>$")
ANY_COMPONENT_RE = re.compile(r"</?[A-Z][A-Za-z0-9]*\b")
MARKDOWN_LINK_RE = re.compile(r"(!?\[[^\]]*\])\(([^)]+)\)")
BUTTON_LINK_RE = re.compile(r"^\[<Button>.*</Button>\]\([^)]+\)$")
MARKETING_ANCHOR_RE = re.compile(
    r'^<a\b[^>]*className="btn-[^"]*"[^>]*>.*</a>$'
)


def git_output(checkout: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(checkout), *args], text=True
    ).strip()


def output_path(source_relative: PurePosixPath) -> PurePosixPath:
    if source_relative.suffix == ".mdx":
        return source_relative.with_suffix(".md")
    return source_relative


def route_map(markdown_files: list[Path], docs_root: Path) -> dict[str, PurePosixPath]:
    routes: dict[str, PurePosixPath] = {}
    for source_file in markdown_files:
        relative = PurePosixPath(source_file.relative_to(docs_root).as_posix())
        target = output_path(relative)
        if relative.stem == "index":
            route = "/" + relative.parent.as_posix().strip(".")
        else:
            route = "/" + relative.with_suffix("").as_posix()
        route = route.rstrip("/") or "/"
        routes[route] = target
    return routes


def rendered_page(relative: PurePosixPath, source: SourceSpec) -> str:
    if relative.stem == "index":
        route = relative.parent.as_posix().strip(".")
    else:
        route = relative.with_suffix("").as_posix()
    if not route:
        return f"{source.rendered_root}/"
    return f"{source.rendered_root}/{route}/"


def strip_site_components(
    text: str, relative: PurePosixPath, source: SourceSpec
) -> str:
    output: list[str] = []
    in_fence = False
    skipping_import = False
    skipping_mdx_block = False
    unwrapped_tag: str | None = None
    page_url = rendered_page(relative, source)

    for line in text.splitlines():
        stripped = line.strip()
        if skipping_mdx_block:
            if stripped == "```":
                skipping_mdx_block = False
            continue
        if stripped == "```mdx-code-block" and not in_fence:
            skipping_mdx_block = True
            continue
        if stripped.startswith("```"):
            in_fence = not in_fence
            output.append(line)
            continue

        if not in_fence:
            if skipping_import:
                if stripped.endswith(";"):
                    skipping_import = False
                continue
            if stripped.startswith("import "):
                skipping_import = not stripped.endswith(";")
                continue
            if BUTTON_LINK_RE.fullmatch(stripped):
                continue
            if MARKETING_ANCHOR_RE.fullmatch(stripped):
                continue
            if stripped.startswith("<div ") or stripped == "</div>":
                continue

            opening_tag = next(
                (tag for tag in WRAPPER_TAGS if stripped == f"<{tag}>"), None
            )
            if opening_tag:
                unwrapped_tag = opening_tag
                continue
            if unwrapped_tag and stripped == f"</{unwrapped_tag}>":
                unwrapped_tag = None
                continue
            if unwrapped_tag and line.startswith("  "):
                line = line[2:]
                stripped = line.strip()

            diagram = DIAGRAM_RE.fullmatch(stripped)
            if diagram:
                name, alt = diagram.groups()
                output.append(
                    f"![{alt}]({source.raw_root}/static/img/diagrams/{name}.svg)"
                )
                continue

            required_image = REQUIRE_IMAGE_RE.fullmatch(line)
            if required_image:
                image_path, alt = required_image.groups()
                source_path = (relative.parent / image_path).as_posix()
                output.append(f"![{alt}]({source.raw_root}/docs/{source_path})")
                continue

            component = SELF_CLOSING_COMPONENT_RE.fullmatch(stripped)
            if component:
                name = component.group(1)
                if name in OMITTED_COMPONENTS:
                    continue
                if name in INTERACTIVE_COMPONENTS:
                    label = INTERACTIVE_COMPONENTS[name]
                    output.append(
                        f"> The [{label}]({page_url}) is available on the "
                        "rendered handbook."
                    )
                    continue
                raise ValueError(
                    f"Unhandled MDX component {name} in {source.key}/{relative}"
                )

        output.append(line)

    transformed = "\n".join(line.rstrip() for line in output).rstrip() + "\n"
    return re.sub(r"\n{3,}", "\n\n", transformed)


def split_target(target: str) -> tuple[str, str, str]:
    parsed = urlsplit(target)
    return parsed.path, parsed.query, parsed.fragment


def rebuild_target(path: str, query: str, fragment: str) -> str:
    return urlunsplit(("", "", path, query, fragment))


def rewrite_target(
    target: str,
    current_source: PurePosixPath,
    current_output: PurePosixPath,
    routes: dict[str, PurePosixPath],
    source_files: set[PurePosixPath],
    is_image: bool,
    source: SourceSpec,
) -> str:
    if target.startswith(("http://", "https://", "mailto:", "#")):
        return target

    path, query, fragment = split_target(target)
    if not path:
        return target

    if path.startswith("/"):
        route = path.rstrip("/") or "/"
        destination = routes.get(route)
        if destination is None:
            return target
    else:
        resolved = PurePosixPath(
            os.path.normpath((current_source.parent / path).as_posix())
        )
        if is_image and resolved in source_files:
            raw = f"{source.raw_root}/docs/{resolved.as_posix()}"
            return rebuild_target(raw, query, fragment)

        route = "/" + resolved.as_posix().rstrip("/")
        if resolved.suffix in {".md", ".mdx"}:
            route = "/" + resolved.with_suffix("").as_posix()
        destination = routes.get(route)
        if destination is None:
            return target

    relative_target = os.path.relpath(
        destination.as_posix(), start=current_output.parent.as_posix() or "."
    )
    return rebuild_target(relative_target, query, fragment)


def rewrite_links(
    text: str,
    current_source: PurePosixPath,
    routes: dict[str, PurePosixPath],
    source_files: set[PurePosixPath],
    source: SourceSpec,
) -> str:
    current_output = output_path(current_source)
    output: list[str] = []
    in_fence = False

    for line in text.splitlines():
        if line.strip().startswith("```"):
            in_fence = not in_fence
            output.append(line)
            continue
        if in_fence:
            output.append(line)
            continue

        def replace(match: re.Match[str]) -> str:
            label, target = match.groups()
            rewritten = rewrite_target(
                target,
                current_source,
                current_output,
                routes,
                source_files,
                is_image=label.startswith("!"),
                source=source,
            )
            return f"{label}({rewritten})"

        output.append(MARKDOWN_LINK_RE.sub(replace, line))

    return "\n".join(output).rstrip() + "\n"


def validate_references(root: Path, boundary: Path | None = None) -> None:
    errors: list[str] = []
    markdown_files = sorted(root.rglob("*.md"))
    resolved_boundary = (boundary or root).resolve()

    for markdown_file in markdown_files:
        relative = markdown_file.relative_to(root)
        in_fence = False
        for line_number, line in enumerate(
            markdown_file.read_text(encoding="utf-8").splitlines(), start=1
        ):
            stripped = line.strip()
            if stripped.startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue

            if stripped.startswith("import ") or "require(" in stripped:
                errors.append(f"{relative}:{line_number}: site-only import remains")
            if ANY_COMPONENT_RE.search(stripped):
                errors.append(f"{relative}:{line_number}: MDX component remains")

            for match in MARKDOWN_LINK_RE.finditer(line):
                target = match.group(2)
                if target.startswith(("http://", "https://", "mailto:", "#")):
                    continue
                path, _, _ = split_target(target)
                if not path:
                    continue
                if path.startswith("/"):
                    errors.append(
                        f"{relative}:{line_number}: root-relative link remains: "
                        f"{target}"
                    )
                    continue
                resolved = (markdown_file.parent / path).resolve()
                try:
                    resolved.relative_to(resolved_boundary)
                except ValueError:
                    errors.append(
                        f"{relative}:{line_number}: link escapes references: {target}"
                    )
                    continue
                if not resolved.is_file():
                    errors.append(
                        f"{relative}:{line_number}: missing local target: {target}"
                    )

    if errors:
        details = "\n".join(errors)
        raise ValueError(f"Vendored reference validation failed:\n{details}")


def build_snapshot(source: Path, spec: SourceSpec, staging: Path) -> None:
    source = source.resolve()
    docs_root = source / "docs"
    if not docs_root.is_dir():
        raise ValueError(f"Missing docs directory: {docs_root}")

    actual_commit = git_output(source, "rev-parse", "HEAD")
    if actual_commit != spec.commit:
        raise ValueError(
            f"Expected {spec.key} checkout {spec.commit}, found {actual_commit}. "
            "Update the source specification deliberately before importing a "
            "newer snapshot."
        )
    dirty_docs = git_output(source, "status", "--porcelain", "--", "docs")
    if dirty_docs:
        raise ValueError(f"The {spec.key} docs checkout has local changes")

    markdown_files = sorted(
        path
        for path in docs_root.rglob("*")
        if path.is_file() and path.suffix in {".md", ".mdx"}
    )
    routes = route_map(markdown_files, docs_root)
    source_files = {
        PurePosixPath(path.relative_to(docs_root).as_posix())
        for path in docs_root.rglob("*")
        if path.is_file()
    }

    staging.mkdir()
    shutil.copy2(docs_root / "LICENSE", staging / "LICENSE")
    for source_file in markdown_files:
        relative = PurePosixPath(source_file.relative_to(docs_root).as_posix())
        target = staging / output_path(relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        text = source_file.read_text(encoding="utf-8")
        text = strip_site_components(text, relative, spec)
        text = rewrite_links(text, relative, routes, source_files, spec)
        target.write_text(text, encoding="utf-8")

    validate_references(staging)


def replace_directories(replacements: list[tuple[Path, Path]]) -> None:
    backups: dict[Path, Path] = {}
    installed: list[Path] = []

    try:
        for _, destination in replacements:
            backup = destination.with_name(f".{destination.name}.backup")
            if backup.exists():
                shutil.rmtree(backup)
            if destination.exists():
                destination.rename(backup)
                backups[destination] = backup

        for staging, destination in replacements:
            staging.rename(destination)
            installed.append(destination)
    except Exception:
        for destination in installed:
            shutil.rmtree(destination)
        for destination, backup in backups.items():
            if backup.exists():
                backup.rename(destination)
        raise

    for backup in backups.values():
        shutil.rmtree(backup)


def apply_merge_patches(
    bentoml_snapshot: Path, merged_snapshot: Path, retained_root: Path
) -> None:
    for patch in MERGE_PATCHES:
        source_text = (bentoml_snapshot / patch.path).read_text(encoding="utf-8")
        missing_checks = [
            check for check in patch.source_checks if check not in source_text
        ]
        if missing_checks:
            missing = ", ".join(repr(check) for check in missing_checks)
            raise ValueError(
                f"BentoML source checks failed for {patch.path}: {missing}"
            )

        target = merged_snapshot / patch.path
        target_text = target.read_text(encoding="utf-8")
        if target_text.count(patch.anchor) != 1:
            raise ValueError(
                f"Expected one merge anchor in {patch.path}, found "
                f"{target_text.count(patch.anchor)}"
            )
        retained = (retained_root / patch.retained_file).read_text(
            encoding="utf-8"
        ).strip()
        if patch.placement == "before":
            replacement = f"{retained}\n\n{patch.anchor}"
        elif patch.placement == "after":
            replacement = f"{patch.anchor}\n\n{retained}"
        else:
            raise ValueError(f"Unknown merge placement: {patch.placement}")
        target.write_text(
            target_text.replace(patch.anchor, replacement), encoding="utf-8"
        )


def vendor(
    bentoml_source: Path, modular_source: Path, destination_root: Path
) -> None:
    destination_root.parent.mkdir(parents=True, exist_ok=True)
    script_root = Path(__file__).resolve().parent

    with tempfile.TemporaryDirectory(
        prefix="llm-inference-handbook-", dir=destination_root.parent
    ) as temporary:
        staging_root = Path(temporary)
        bentoml_staging = staging_root / "bentoml"
        modular_staging = staging_root / "modular"
        merged_staging = staging_root / "references"

        build_snapshot(bentoml_source, BENTOML, bentoml_staging)
        build_snapshot(modular_source, MODULAR, modular_staging)
        shutil.copytree(modular_staging, merged_staging)
        apply_merge_patches(
            bentoml_staging, merged_staging, script_root / "retained"
        )
        validate_references(merged_staging)
        shutil.copy2(script_root / "references-readme.md", merged_staging / "README.md")
        replace_directories([(merged_staging, destination_root)])

    print(f"Merged BentoML {BENTOML.commit}")
    print(f"onto Modular {MODULAR.commit}")
    validate_references(destination_root, boundary=destination_root.parent)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Merge pinned BentoML and Modular handbook revisions."
    )
    parser.add_argument(
        "--bentoml-source",
        type=Path,
        required=True,
        help=f"Path to the pinned checkout of {BENTOML.repository}",
    )
    parser.add_argument(
        "--modular-source",
        type=Path,
        required=True,
        help=f"Path to the pinned checkout of {MODULAR.repository}",
    )
    args = parser.parse_args()
    destination = Path(__file__).resolve().parents[1] / "references"
    vendor(args.bentoml_source, args.modular_source, destination)
    print(f"Validated merged corpus under {destination}")


if __name__ == "__main__":
    main()
