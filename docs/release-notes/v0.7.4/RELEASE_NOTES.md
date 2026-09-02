# Release v0.7.4: Text highlighting, Norwegian, and a fix for disappearing text

This is the first release from the independent fork at `trondfk/markdownEditor`. Builds from here check this repository for updates and are signed with its own key. An installation from the upstream project keeps following upstream, so moving to this fork means installing it once by hand.

## Features

- Highlight text in six colours from the toolbar, and clear a highlight again from the same menu. Highlights are stored in the document as inline HTML, so they survive saving, closing and reopening the file
- Norwegian (Bokmål) interface, selectable from settings alongside English
- The AI assistant summarises earlier turns by itself once a conversation grows long, instead of asking you to start over in a new chat. The summary shows up in the chat as a marker you can expand and read
- Drag the edge of the AI panel, the split view and the code-and-preview editor to resize them, and the sizes are remembered the next time you open the app

## Bug fixes

- Fix saved text disappearing. Editing in code view, the split editor or a large file and then letting auto-save run, closing the window, or dragging the tab into another window could write an empty document over your work. Every automatic save now reads from the editor you are actually typing in, and refuses any write that would empty a file that was not empty
- Keep long conversations with local models inside the context window by sizing the replayed history to the model's own context setting rather than a fixed limit

## UI/UX

- The AI panel docks as a real pane beside the document instead of floating above it, so it no longer covers the text while you write
- Highlighted text stays readable in dark mode, where it used to be near-white on a pale background
- Polish and Chinese are no longer offered as interface languages, and the Polish and Chinese text that remained in messages, comments and documentation is now English
