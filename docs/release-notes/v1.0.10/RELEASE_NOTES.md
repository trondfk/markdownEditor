# Release v1.0.10: Fix screenshot pasting on Windows

## Bug fixes

- Fixed screenshot pasting from the Windows clipboard when canonical Windows file paths with the `\\?\` prefix were handled incorrectly during image import and display.
- Existing image storage locations, file naming and Markdown references are retained for saved and unsaved documents.

## Verification and limitations

- All 1,554 unit tests and 34 relevant end-to-end tests passed for the fix, including image pasting, Save, Save As and file opening.
- Actual Ctrl+V from the Windows clipboard has not yet been manually verified on Windows. The regression tests use browser paste events and simulated Windows filesystem behavior in the Linux sandbox.
