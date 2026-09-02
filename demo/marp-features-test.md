---
marp: true
theme: gaia
paginate: true
backgroundColor: #0d1117
color: #e6edf3
---

<!-- _class: lead -->

# Marp, feature test

A deck for exercising Marp mode in MerMark:
slide boundaries, directives, local and remote backgrounds.

---

# An ordinary slide

- A bullet list
- **Bold**, *italic*, `code`
- Table and code block below

| Feature | Status |
| ------- | ------ |
| Badge   | ✅     |
| Chips   | ✅     |

---

<!-- _class: invert -->

# The "invert" slide

The `_class: invert` directive flips the theme on this slide only.

```ts
export const hello = (n: string) => `Hello, ${n}!`;
```

---

![bg left:45%](assets/fable-lab.png)

# Local background

On the left, a file from disk (`assets/fable-lab.png`),
inlined to a data URI when you hit Present.

---

![bg right:50%](https://placehold.co/1300x1600/11331f/d7ffe9?text=from+the+web)

# Background from the web

On the right, an image from `placehold.co`, fetched over the network in the preview.

---

<!-- _class: lead -->

# End of test

Slides separated, directives shown as chips, a mix of images.
