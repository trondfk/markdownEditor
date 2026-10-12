# Release v1.0.9: Line numbers only in code view

## Bug fixes

- Removed the line-number column and its extra side space from the visual editor and the preview pane in Code + Preview.
- Actual Markdown source line numbers, including blank lines, remain available in Code view and the code pane of Code + Preview.
- The line-number setting now applies only to code panes. Existing saved preferences are retained.

## Limitations

- The visual editor renders Markdown structure rather than every physical blank line. Real visual edits may still normalize Markdown formatting; this limitation is unchanged.
