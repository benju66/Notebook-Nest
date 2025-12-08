# NotebookLM Pro Tree

A Chrome extension that adds folder organization to Google's NotebookLM. Stop scrolling through endless flat lists — organize your sources and studio notes into a clean, nested tree structure.

## Features

- **Folder Organization** — Create nested folders for both Sources and Studio Notes
- **Deep Content Search** — Search not just titles, but the actual content of your notes
- **Pinning** — Pin frequently-used items to the top for quick access
- **Color Coding** — Assign colors to folders for visual organization
- **Drag Ordering** — Reorder folders with up/down controls
- **Export/Import** — Backup and restore your folder structure (great for sharing setups)
- **Toggle UI Elements** — Hide/show the generators panel and web research section to reduce clutter
- **Remote Config** — Selector updates pushed automatically when NotebookLM changes their UI
- **Expand/Collapse All** — Quickly expand or collapse all folders with one click

> **Note:** Each notebook has its own independent folder structure. Folders you create in one notebook won't appear in others. Use Export/Import to copy folder structures between notebooks.

## Installation

### Option 1: Load Unpacked (Developer Mode)

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the folder containing these extension files
6. Navigate to [NotebookLM](https://notebooklm.google.com) and start organizing!

## Usage

Once installed, you'll see new controls appear in NotebookLM:

- **Create Folder** — Click the folder+ icon to create a new folder
- **Move Items** — Hover over any source or note and click the folder icon to move it
- **Pin Items** — Click the pin icon to keep items at the top
- **Search** — Use the search bar (Studio panel) to find notes by title or content
- **Export** — Click the download arrow to backup your folder structure as JSON
- **Import** — Click the upload arrow to restore folders (choose to merge or replace)
- **Color/Rename/Delete** — Hover over folder headers to access these options

## Screenshots

**Sources Panel**

Add fodlers, expand/collapse all folders, download/uplaod file strucutre, show/hide web research section, clear fodler tree

<img width="252" height="170" alt="image" src="https://github.com/user-attachments/assets/d3b36a39-abf6-4b6c-a81d-2688fbca07e4" />

Move a folder up/down, change folder color, add subfolder, edit folder name, delete folder.

<img width="432" height="129" alt="image" src="https://github.com/user-attachments/assets/b6c79d4b-90f3-42b2-a3ff-d267413aca4f" />

Change item location, eject from folder, Pin to top

<img width="438" height="130" alt="image" src="https://github.com/user-attachments/assets/5d18b90c-1a71-4846-a035-a2a629baa72f" />

**Studio Panel**

Search titles and content of notes

<img width="471" height="121" alt="image" src="https://github.com/user-attachments/assets/26ca3554-402c-4b2b-9635-0fda91cd5a22" />

Add new fodler, expand/collapse fodlers, download/upload fodler strucutre, toggle generation buttons, restart folders

<img width="466" height="115" alt="image" src="https://github.com/user-attachments/assets/de54379b-1ac1-4d73-8d31-62034d6be58a" />


## Privacy

This extension:
- Stores all data locally in your browser
- Does not collect or transmit personal information
- Only fetches a public configuration file for UI selectors

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for details.

## Known Limitations

- Each notebook has independent folders (use Export/Import to share structures)
- Search index builds as you view notes — unviewed notes won't appear in deep search
- Chrome may show a developer mode warning for unpacked extensions
- Underling content in a note is not persistent, I think this is a Google issue.

## Contributing

Found a bug or have a feature request? Open an issue or submit a PR.

@ccgee for a light theme contrast bug.

## Author

**Benju66**

## License

MIT License — feel free to modify and share.

---


*Built because NotebookLM needed folders. You're welcome.*
