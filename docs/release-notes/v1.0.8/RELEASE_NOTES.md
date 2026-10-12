# Release v1.0.8: Preserve Markdown source and blank lines

## Bug fixes

- Original Markdown blank lines are preserved when switching views and saving documents without edits.
- Code + Preview uses the document's authoritative Markdown source instead of reconstructing it from rendered HTML.
- Save As preserves unchanged source, including leading and trailing blank lines and original line endings.
- Code view shows actual Markdown source line numbers, including blank lines. Visual gutter labels such as V1 and V2 identify rendered rows rather than source lines.

## Limitations

- Real visual edits still regenerate Markdown and may normalize source formatting. Use Code view to inspect source lines and edit blank lines between paragraphs.
