"""Emit the three downstream representations of CanonicalProduct +
CanonicalArticle for review.

Outputs three sections to stdout:

  1. SQL DDL preview — column-by-column CREATE TABLE statements
     derived from the Pydantic fields. Compare against the existing
     `products` / `roaster_articles` tables in `database.py`.
  2. Haiku tool_schema JSON — what an Anthropic tool_use input_schema
     would look like, derived from `model_json_schema()`. Compare
     against the existing `_EXTRACT_TOOL` (Scraper/enrich.py) and
     `_ARTICLE_TOOL` (services/article_enricher.py).
  3. TypeScript interface stubs — what the frontend `Product` /
     `Article` interfaces would look like. Compare against
     `crema-app/src/resources/types.ts`.

Run from the api root:
    python scripts/generate_canonical_schemas.py

Nothing is written to disk — this is a preview generator. The actual
SQL migration, live Haiku schema, and TS types live in their canonical
files; this script tells you when they've drifted from the model.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

# Make the api module importable when invoked from any cwd.
_THIS = Path(__file__).resolve()
sys.path.insert(0, str(_THIS.parent.parent))

from services.canonical_entity import (  # noqa: E402
    CanonicalArticle,
    CanonicalProduct,
    EntityKind,
    model_for_kind,
    tool_schema_for_kind,
)


_PY_TO_SQL = {
    "string": "TEXT",
    "integer": "INTEGER",
    "number": "REAL",
    "boolean": "INTEGER",
    "array": "TEXT",
    "object": "TEXT",
}


def _sql_type_for(schema: dict[str, Any]) -> str:
    """Map a JSON Schema property to a SQLite column type."""
    if "$ref" in schema:
        return "TEXT"
    if "enum" in schema:
        return "TEXT"
    if "anyOf" in schema:
        for s in schema["anyOf"]:
            if s.get("type") != "null":
                return _sql_type_for(s)
        return "TEXT"
    js_type = schema.get("type", "string")
    if isinstance(js_type, list):
        for t in js_type:
            if t != "null":
                return _PY_TO_SQL.get(t, "TEXT")
        return "TEXT"
    return _PY_TO_SQL.get(js_type, "TEXT")


def _is_nullable(schema: dict[str, Any]) -> bool:
    if "anyOf" in schema:
        return any(s.get("type") == "null" for s in schema["anyOf"])
    js_type = schema.get("type")
    if isinstance(js_type, list):
        return "null" in js_type
    return False


def _emit_sql_ddl(kind: EntityKind, table_name: str) -> str:
    model = model_for_kind(kind)
    schema = model.model_json_schema()
    props: dict[str, dict] = schema["properties"]
    required: set[str] = set(schema.get("required", []))

    lines = [f"-- Derived from CanonicalProduct/CanonicalArticle ({kind})",
             f"CREATE TABLE IF NOT EXISTS {table_name} ("]
    lines.append("    id INTEGER PRIMARY KEY AUTOINCREMENT,")
    col_lines = []
    for name, prop in props.items():
        sql_type = _sql_type_for(prop)
        nullable = _is_nullable(prop) or name not in required
        default = ""
        if not nullable:
            if sql_type == "INTEGER" and prop.get("default") is False:
                default = " DEFAULT 0"
            elif sql_type == "INTEGER" and prop.get("default") is True:
                default = " DEFAULT 1"
            elif "default" in prop and isinstance(prop["default"], (int, float, str)):
                default = f" DEFAULT {prop['default']!r}"
            col_lines.append(f"    {name} {sql_type} NOT NULL{default}")
        else:
            col_lines.append(f"    {name} {sql_type}")
    lines.append(",\n".join(col_lines))
    lines.append(");")
    return "\n".join(lines)


def _ts_type_for(schema: dict[str, Any]) -> str:
    if "enum" in schema:
        return " | ".join(json.dumps(v) for v in schema["enum"])
    if "anyOf" in schema:
        parts = []
        for s in schema["anyOf"]:
            if s.get("type") == "null":
                parts.append("null")
            else:
                parts.append(_ts_type_for(s))
        return " | ".join(parts)
    js_type = schema.get("type", "string")
    if isinstance(js_type, list):
        parts = []
        for t in js_type:
            if t == "null":
                parts.append("null")
            else:
                parts.append(_PY_TO_TS.get(t, "unknown"))
        return " | ".join(parts)
    if js_type == "array":
        item = schema.get("items", {})
        return f"{_ts_type_for(item)}[]"
    if js_type == "object":
        return "Record<string, unknown>"
    return _PY_TO_TS.get(js_type, "unknown")


_PY_TO_TS = {
    "string": "string",
    "integer": "number",
    "number": "number",
    "boolean": "boolean",
}


def _emit_ts_interface(kind: EntityKind, name: str) -> str:
    model = model_for_kind(kind)
    schema = model.model_json_schema()
    defs = schema.get("$defs", {})
    props: dict[str, dict] = schema["properties"]
    required: set[str] = set(schema.get("required", []))

    lines = [f"// Derived from {model.__name__} ({kind})", f"export interface {name} {{"]
    for fname, prop in props.items():
        if "$ref" in prop:
            ref = prop["$ref"].split("/")[-1]
            ts = ref
        elif "anyOf" in prop and any("$ref" in s for s in prop["anyOf"]):
            parts = []
            for s in prop["anyOf"]:
                if "$ref" in s:
                    parts.append(s["$ref"].split("/")[-1])
                elif s.get("type") == "null":
                    parts.append("null")
                else:
                    parts.append(_ts_type_for(s))
            ts = " | ".join(parts)
        else:
            ts = _ts_type_for(prop)
        optional = "?" if (fname not in required or _is_nullable(prop)) else ""
        lines.append(f"  {fname}{optional}: {ts};")
    lines.append("}")

    for def_name, def_schema in defs.items():
        if def_schema.get("type") != "object":
            continue
        lines.append("")
        lines.append(f"export interface {def_name} {{")
        d_props = def_schema.get("properties", {})
        d_required: set[str] = set(def_schema.get("required", []))
        for fname, prop in d_props.items():
            ts = _ts_type_for(prop)
            optional = "?" if (fname not in d_required or _is_nullable(prop)) else ""
            lines.append(f"  {fname}{optional}: {ts};")
        lines.append("}")
    return "\n".join(lines)


def main() -> int:
    print("=" * 78)
    print("  SQL DDL preview")
    print("=" * 78)
    print()
    print(_emit_sql_ddl("product", "v2_products"))
    print()
    print(_emit_sql_ddl("article", "v2_articles"))
    print()

    print("=" * 78)
    print("  Haiku tool_schema (Product)")
    print("=" * 78)
    print()
    print(json.dumps(tool_schema_for_kind("product"), indent=2))
    print()

    print("=" * 78)
    print("  Haiku tool_schema (Article)")
    print("=" * 78)
    print()
    print(json.dumps(tool_schema_for_kind("article"), indent=2))
    print()

    print("=" * 78)
    print("  TypeScript interfaces")
    print("=" * 78)
    print()
    print(_emit_ts_interface("product", "CanonicalProduct"))
    print()
    print(_emit_ts_interface("article", "CanonicalArticle"))
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
