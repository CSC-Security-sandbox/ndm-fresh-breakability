"""Architecture guardrail: lib/ must stay a pure core (SPEC §2 / README layering rule).

lib/ holds algorithms + schemas only — it must not import the outer-world frameworks
(Redis / Temporal / HTTP / auth) or the I/O-bearing sibling layers (io/, workflow/, api/).
Enforcing it here turns the documented invariant into something CI can't silently lose.
"""

from __future__ import annotations

import ast
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parent.parent / "src" / "parquet_service" / "lib"
LIB_PACKAGE = "parquet_service.lib"

# Outer-world packages lib/ must never import.
BANNED_TOP_LEVEL = frozenset(
    {"redis", "temporalio", "fastapi", "uvicorn", "starlette", "prometheus_client", "jwt"}
)
# Sibling layers — anything under these is off-limits to lib/.
BANNED_INTERNAL = frozenset(
    {"parquet_service.io", "parquet_service.workflow", "parquet_service.api"}
)


def _resolve(module: str | None, level: int, package: str) -> str:
    """Resolve an `import from` target to an absolute dotted module path."""
    if level == 0:
        return module or ""
    parts = package.split(".")
    base = ".".join(parts[: len(parts) - (level - 1)])
    return f"{base}.{module}" if module else base


def _imported_targets(source: str) -> set[str]:
    """Every absolute module target referenced by a single lib/ source file."""
    targets: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            targets.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = _resolve(node.module, node.level, LIB_PACKAGE)
            targets.add(base)
            targets.update(f"{base}.{alias.name}" if base else alias.name for alias in node.names)
    return targets


def _is_banned(target: str) -> bool:
    if target.split(".")[0] in BANNED_TOP_LEVEL:
        return True
    return any(target == b or target.startswith(f"{b}.") for b in BANNED_INTERNAL)


def test_lib_layer_is_pure() -> None:
    py_files = sorted(LIB_DIR.glob("*.py"))
    assert py_files, f"no lib/ modules found under {LIB_DIR}"

    violations: dict[str, list[str]] = {}
    for path in py_files:
        bad = sorted(
            t for t in _imported_targets(path.read_text(encoding="utf-8")) if _is_banned(t)
        )
        if bad:
            violations[path.name] = bad

    assert not violations, f"lib/ purity rule violated (SPEC §2): {violations}"
