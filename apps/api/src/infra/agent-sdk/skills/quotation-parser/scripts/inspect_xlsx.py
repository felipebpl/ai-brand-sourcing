"""
Initial inspection of a supplier quotation XLSX.

Usage:
    python3 scripts/inspect.py <path/to/file.xlsx>

Dumps a structural map of the workbook to stdout, designed so the parser
agent can read it in one turn and form a hypothesis about layout:

- Sheet names with dimensions and merged-cell counts
- First 25 rows of each sheet (formulas + computed values)
- Detected number formats and styles on a sample of cells
- Counts of empty rows/columns (decorative whitespace detection)

The output is intentionally verbose but bounded — under ~2k tokens for
typical quotation files.
"""
from __future__ import annotations

import sys
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter


MAX_PREVIEW_ROWS = 25
MAX_TAIL_ROWS = 10
MAX_COL_WIDTH = 30


def truncate(value: object, width: int = MAX_COL_WIDTH) -> str:
    s = "" if value is None else str(value)
    return s if len(s) <= width else s[: width - 1] + "…"


def inspect_workbook(path: Path) -> None:
    print(f"== File ===========================================")
    print(f"path: {path}")
    print(f"size: {path.stat().st_size} bytes")

    # Load twice: once with formulas visible, once with values resolved.
    # That way the agent sees both `=PRODUCT(F17,G17)` and 3960 side by side.
    wb_formulas = openpyxl.load_workbook(path, data_only=False)
    wb_values = openpyxl.load_workbook(path, data_only=True)

    print(f"sheets: {wb_formulas.sheetnames}")
    print()

    for sheet_name in wb_formulas.sheetnames:
        ws_f = wb_formulas[sheet_name]
        ws_v = wb_values[sheet_name]
        merges = ws_f.merged_cells.ranges
        print(f"== Sheet: {sheet_name!r}")
        print(f"   dims: {ws_f.dimensions}   max_row={ws_f.max_row}   max_col={ws_f.max_column}")
        print(f"   merged ranges: {len(merges)}")
        if len(merges) > 0:
            preview = ", ".join(str(m) for m in list(merges)[:5])
            tail = "..." if len(merges) > 5 else ""
            print(f"     first few: {preview}{tail}")

        # Column-level dtype profile: helps spot the data table boundary
        col_profile = []
        max_col = min(ws_v.max_column, 12)
        max_row = min(ws_v.max_row, 50)
        for c in range(1, max_col + 1):
            kinds = {"int": 0, "float": 0, "str": 0, "none": 0}
            for r in range(1, max_row + 1):
                v = ws_v.cell(row=r, column=c).value
                if v is None:
                    kinds["none"] += 1
                elif isinstance(v, bool):
                    kinds["str"] += 1
                elif isinstance(v, int):
                    kinds["int"] += 1
                elif isinstance(v, float):
                    kinds["float"] += 1
                else:
                    kinds["str"] += 1
            col_profile.append((get_column_letter(c), kinds))
        print("   col dtype profile (top 50 rows):")
        for letter, kinds in col_profile:
            total = sum(kinds.values()) or 1
            summary = " ".join(
                f"{k}={v}" for k, v in kinds.items() if v > 0
            )
            print(f"     {letter}: {summary}  ({total} cells)")

        # Number format hints — currency clues
        formats_seen: dict[str, int] = {}
        for r in range(1, max_row + 1):
            for c in range(1, max_col + 1):
                fmt = ws_v.cell(row=r, column=c).number_format
                if fmt and fmt != "General":
                    formats_seen[fmt] = formats_seen.get(fmt, 0) + 1
        if formats_seen:
            print("   number formats seen (currency / date hints):")
            for fmt, count in sorted(
                formats_seen.items(), key=lambda kv: -kv[1]
            )[:6]:
                print(f"     {count:>3}×  {fmt!r}")

        # Row preview — both formulas and computed values.
        # Head + tail so footer metadata (Payment Terms, Lead Time)
        # that sits past the head window is not blind-spotted.
        def render_row(r: int) -> None:
            cells = []
            for c in range(1, min(ws_f.max_column, 9) + 1):
                cf = ws_f.cell(row=r, column=c).value
                cv = ws_v.cell(row=r, column=c).value
                if cf == cv or cf is None or not (isinstance(cf, str) and cf.startswith("=")):
                    cells.append(truncate(cv))
                else:
                    cells.append(f"{truncate(cf)} → {truncate(cv)}")
            line = " | ".join(cells)
            if any(c for c in cells if c):
                print(f"     r{r:>2}: {line}")

        head_end = min(ws_f.max_row, MAX_PREVIEW_ROWS)
        print(f"   first {MAX_PREVIEW_ROWS} rows (formula | value):")
        for r in range(1, head_end + 1):
            render_row(r)

        if ws_f.max_row > MAX_PREVIEW_ROWS:
            tail_start = max(MAX_PREVIEW_ROWS + 1, ws_f.max_row - MAX_TAIL_ROWS + 1)
            if tail_start > MAX_PREVIEW_ROWS + 1:
                print(f"     ... rows {MAX_PREVIEW_ROWS + 1} to {tail_start - 1} elided ...")
            print(f"   last rows {tail_start}..{ws_f.max_row}:")
            for r in range(tail_start, ws_f.max_row + 1):
                render_row(r)
        print()


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: python3 scripts/inspect.py <path/to/file.xlsx>", file=sys.stderr)
        return 2
    path = Path(argv[1]).resolve()
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        return 1
    try:
        inspect_workbook(path)
    except Exception as e:  # broad on purpose — we want a clear error line, not a stack
        print(f"!! inspection failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
