# Release v1.0.2: Nothing you wrote gets left behind

An audit of every way the editor writes to disk found three remaining ways text could go missing. None of them was the fault fixed in 1.0.0, and all three are closed here.

## Bug fixes

- Closing the window while a split view was open only asked about unsaved tabs in the half you had focused. Tabs in the other half were discarded without a prompt. The dialog now walks through every unsaved tab in the window and focuses the pane that owns each one so you can see what you are saving
- Saving by hand could, in a narrow case in Code + Preview, write an empty file when the editor could not say which tab the text belonged to. A save that cannot establish what the document contains is now abandoned with a warning instead, and the tab stays marked as unsaved
- Auto-save, save-on-quit and moving a tab to another window wrote straight onto the file, so a crash or a full disk in the middle of a write could leave it half finished. All of them now write to a temporary file that is read back and checked before it replaces the original, which is what saving by hand already did. A failed save leaves the previous version of the file untouched
- Saves that keep some text but drop most of the document are now recorded to `save-audit.jsonl` in the application data folder, along with which kind of save did it. Nothing is blocked, since cutting a large section on purpose is a perfectly normal edit, but if a document ever does lose text there is now a record of it
