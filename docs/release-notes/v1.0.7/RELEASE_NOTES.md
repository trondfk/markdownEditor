# Release v1.0.7: Safer document saving

## Bug fixes

- Save As refuses a destination already open in another document, including another tab, pane or window. Normal Save As and saving new or empty documents remain available.
- Edits made during a save remain protected. Older save completions cannot replace a newer saved baseline or incorrectly clear unsaved changes.
- Overlapping saves to the same destination run in order. Atomic writes use unique temporary files, verify the written content and preserve existing content when a write fails.
- Closing a tab saves the intended document and refuses to save when its editor content is unavailable.
- Opening an already open file activates its existing tab or window. Reload restores saved documents without creating a second editable copy.
- Programmatic editor loads and external file updates keep unedited documents clean.
