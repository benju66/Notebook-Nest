# Privacy Policy for NotebookLM Pro Tree

**Last Updated:** December 2025

## Overview

NotebookLM Pro Tree is a browser extension that adds folder organization and project management tools to Google NotebookLM. This policy explains what data the extension accesses and how it's handled.

## Data Collection

**We do not collect any personal data.**

This extension:
- Does NOT collect personal information
- Does NOT track your browsing activity
- Does NOT transmit your data to any external server
- Does NOT use analytics or telemetry

## Data Storage

The extension uses a **Local-First** architecture to ensure performance and privacy.

### Local-Only Data (`chrome.storage.local`)

**All extension data is stored locally on your specific device.** This includes:
- Your folder structures (names, hierarchy, colors)
- Project Tasks and their completion status
- Mappings of which items are in which folders
- Pinned item preferences
- Search index of note content (compressed using LZ-String)
- Application settings (Zen Mode, toggle states)

**Important:** Because this data is stored locally to allow for unlimited storage capacity, it **does not** automatically sync between computers. If you uninstall the extension or clear your browser's "Site Data," this data will be deleted. We provide an **Export** feature to allow you to create manual backups.

### Cloud-Synced Data (`chrome.storage.sync`)

*As of version 17.5, the extension no longer uses Chrome Sync for storing folder structures or tasks to avoid storage quota limitations.*

## Network Requests

The extension makes **one optional network request**:

- **Remote Configuration Fetch**: On load, the extension fetches a JSON file from a public GitHub Gist (`gist.githubusercontent.com`). This file contains CSS selectors that help the extension locate UI elements in NotebookLM.
    - **Purpose:** To prevent the extension from breaking if Google updates the NotebookLM website code.
    - **Data Sent:** No personal data is sent in this request; it is a standard anonymous GET request for a public file.

If this request fails, the extension continues to work using built-in default selectors.

## Permissions Explained

| Permission | Why It's Needed |
|------------|-----------------|
| `activeTab` | To inject the folder UI into NotebookLM pages. |
| `scripting` | To run the content script that creates the folder interface. |
| `storage` | To save your folder structure, tasks, and search index locally. |
| `host_permissions` for `notebooklm.google.com` | To operate on NotebookLM pages. |
| `host_permissions` for `gist.githubusercontent.com` | To fetch the remote selector configuration. |

## Third-Party Services

- **GitHub Gist**: A public configuration file is fetched from GitHub to ensure reliability. No personal data is sent. See [GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement) for their policies.

This extension does not integrate with any analytics, advertising, or data collection services.

## Data Deletion

Since all data is stored locally on your machine:
- **To Delete Everything:** Simply uninstall the extension or clear your browser's "Local Storage" for the extension.
- **To Reset Data:** Use the "Reset" button within the extension interface to wipe all folders and tasks while keeping the extension installed.

## Changes to This Policy

If this policy changes, the updated version will be posted in the extension's repository with an updated "Last Updated" date.

## Contact

For questions about this privacy policy, contact the author through GitHub: **Benju66**

---

**Summary:** All data (Folders, Tasks, Search Index) lives on your device for maximum speed and privacy. We do not track you. We only fetch a public config file to keep the extension working when NotebookLM updates.