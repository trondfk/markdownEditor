# Release v1.0.5 - Thinking models and a wider page

Local thinking models keep working instead of looking stuck, and the page has more room around the text in both themes.

## Bug fixes

- Local models that think before they write (Qwen3 and similar) no longer hit the three-minute stall timeout while they are still reasoning. The chat stays alive and shows Thinking
- Code and preview scroll together again in split view
- Line numbers no longer overlap the text
- Send by email in the feedback dialog opens the mail app even when no inbox address is set

## UI/UX

- Click in the left page margin to select a visual line, then drag to extend, like Word
- More space around the text on the page. Side padding defaults to 80 px, and the same inset applies in both the default and the Minimal theme
- Enter sends a chat message. Shift+Enter starts a new line
