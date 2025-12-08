/**
 * NotebookLM Pro Tree - V14.2 (Expand/Collapse All)
 * Author: Benju66
 * 
 * Features:
 * 1. Normalized Keys & Robust Selectors
 * 2. Polling Indexer
 * 3. Remote Configuration
 * 4. Storage Safety Limits (Truncation)
 * 5. Smart Toast (Silent when typing, Visible when viewing)
 * 6. Export/Import Folder Structures
 * 7. Per-Notebook Folder Storage (each notebook has its own folders)
 * 8. Anti-flicker CSS (smooth loading)
 * 9. Consistent toggle button icons
 * 10. Expand/Collapse All Folders
 */

// --- CONFIGURATION ---
const REMOTE_CONFIG_URL = "https://gist.githubusercontent.com/benju66/7635f09ea87f81c890f9b736b22d9ac4/raw/09232a0ceb72a14b456bcd239b4e35b7f19c033f/notebooklm-selectors.json"; 

const DEFAULT_SELECTORS = {
    sourceRow: '.single-source-container',
    studioRow: 'artifact-library-note',
    sourceTitle: '.source-title, [aria-label="Source title"]',
    studioTitle: '.artifact-title, .title, h3',
    activeNoteTitle: [
        'input[aria-label="note title editable"]', 
        '.note-header__editable-title',
        'textarea[aria-label="Title"]', 
        'input[aria-label="Title"]', 
        '.title-input'
    ],
    activeNoteBody: ['.ql-editor', '.ProseMirror', '[contenteditable="true"]', '.note-body', 'textarea[placeholder*="Write"]']
};

let activeSelectors = { ...DEFAULT_SELECTORS };

// --- STATE ---
const DEFAULT_STATE = {
    source: { folders: {}, mappings: {}, pinned: [] }, 
    studio: { folders: {}, mappings: {}, pinned: [] },
    settings: { showGenerators: true, showResearch: true }
};

let appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
let currentNotebookId = null;
let debounceTimer = null;
let indexDebounce = null;
let searchIndex = {}; 
let urlCheckInterval = null;

// --- ICONS ---
const ICONS = {
    folder: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="#8ab4f8"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Z"/></svg>',
    newFolder: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M560-320h80v-80h80v-80h-80v-80h-80v80h-80v80h80v80ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z"/></svg>',
    restart: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v240H560v-80h135q-31-40-74.5-65T540-730q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>',
    tune: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M440-120v-240h80v80h320v80H520v80h-80Zm-320-80v-80h240v80H120Zm160-200v-80H120v-80h160v-80h80v240h-80Zm160-80v-80h400v80H440Zm160-200v-240h80v80h160v80H680v80h-80Zm-480-80v-80h400v80H120Z"/></svg>',
    tuneOff: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M792-56 676-172H520v-80h160v-23l-80-80v-45h80v80h56l-63-63-56 56v-250h-80v80H280v-80h-80v240h80v-80h23l-80-80H120v-80h160v-80h11l-63-63L342-792l618 618-56 56ZM537-440H120v-80h317l100 80ZM280-120v-240h80v63l-80-80v257h-80Zm463-563L597-829l56-56 227 227-56 56-81-81Zm-216 63L243-904l56-56 314 314-86 86Z"/></svg>',
    search: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/></svg>',
    searchOff: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400ZM56 56 314-202q-10-18-18-37.5T282-280q-92-1-157-65.5T60-502q1-20 4.5-39.5T74-580l-18-18 56-56L792-74l-56 56L532-222l-68-68q23-28 39.5-60.5T520-420l-60-60q-13 14-27 26.5T402-430l-72-72q38-23 80.5-30.5T498-540l-80-80h-38q-109 0-184.5 75.5T120-580q0 109 75.5 184.5T380-320q17 0 32.5-1.5T444-326L384-386l-14 6q-16 6-32.5 9t-33.5 3q-59 0-100.5-41.5T162-510q0-17 3-33.5t9-32.5l-62-62q-15 28-23.5 58t-8.5 60q0 92 65.5 157T380-200q30 0 58-7t54-21l-58-58-378-378Z"/></svg>',
    up: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/></svg>',
    down: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"/></svg>',
    edit: '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 17l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/></svg>',
    add: '<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/></svg>',
    close: '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>',
    move: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Zm440-80v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80Z"/></svg>',
    palette: '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 18-.5 35.5T878-410q-6 83-63.5 146.5T670-200h-30q-17 0-28.5 11.5T600-160v40q0 17-11.5 28.5T560-80h-80Zm-220-400q17 0 28.5-11.5T300-520q0-17-11.5-28.5T260-560q-17 0-28.5 11.5T220-520q0 17 11.5 28.5T260-480Zm120-160q17 0 28.5-11.5T420-680q0-17-11.5-28.5T380-720q-17 0-28.5 11.5T340-680q0 17 11.5 28.5T380-640Zm200 0q17 0 28.5-11.5T620-680q0-17-11.5-28.5T580-720q-17 0-28.5 11.5T540-680q0 17 11.5 28.5T580-640Zm120 160q17 0 28.5-11.5T740-520q0-17-11.5-28.5T700-560q-17 0-28.5 11.5T660-520q0 17 11.5 28.5T700-480Z"/></svg>',
    keep: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Zm-286 80h252l-46-46v-314H400v314l-46 46Zm126 0Z"/></svg>',
    keepFilled: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M640-480 400-720v-200h280v80h-40v280l80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-20l240 240h80Z"/></svg>',
    eject: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-72q-45 0-76.5-31.5T372-500q0-45 31.5-76.5T480-608q45 0 76.5 31.5T588-500q0 45-31.5 76.5T480-392Zm0 192q-146 0-266-81.5T40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200Z"/></svg>',
    export: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>',
    import: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M440-320v-326L336-542l-56-58 200-200 200 200-56 58-104-104v326h-80ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>',
    expandAll: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M480-120 300-300l58-58 122 122 122-122 58 58-180 180ZM358-598l-58-58 180-180 180 180-58 58-122-122-122 122Z"/></svg>',
    collapseAll: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="m356-160-56-56 180-180 180 180-56 56-124-124-124 124Zm124-404L300-744l56-56 124 124 124-124 56 56-180 180Z"/></svg>'
};

// --- NOTEBOOK ID EXTRACTION ---
function getNotebookId() {
    // URL format: https://notebooklm.google.com/notebook/NOTEBOOK_ID
    const match = window.location.pathname.match(/\/notebook\/([^\/\?]+)/);
    return match ? match[1] : null;
}

function getStorageKey(base) {
    const notebookId = getNotebookId();
    if (!notebookId) return null;
    return `${base}_${notebookId}`;
}

// --- INIT SEQUENCE ---
function init() {
    currentNotebookId = getNotebookId();
    
    if (!currentNotebookId) {
        console.log("[NotebookLM Tree] Not in a notebook, waiting...");
        // Check periodically for notebook navigation
        startUrlWatcher();
        return;
    }
    
    const stateKey = getStorageKey('notebookTreeState');
    const indexKey = getStorageKey('notebookSearchIndex');
    
    console.log(`[NotebookLM Tree] Loading data for notebook: ${currentNotebookId}`);
    
    chrome.storage.local.get([stateKey, indexKey], (result) => {
        if (result[stateKey] && result[stateKey].source) {
            appState = result[stateKey];
            if (!appState.settings) appState.settings = { showGenerators: true, showResearch: true };
            if (!appState.source.pinned) appState.source.pinned = [];
            if (!appState.studio.pinned) appState.studio.pinned = [];
        } else {
            // Fresh state for this notebook
            appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
        }
        
        if (result[indexKey]) {
            searchIndex = result[indexKey];
            console.log(`[NotebookLM Tree] Loaded index with ${Object.keys(searchIndex).length} entries.`);
        } else {
            searchIndex = {};
        }

        if (REMOTE_CONFIG_URL) {
            chrome.runtime.sendMessage(
                { action: "fetchConfig", url: REMOTE_CONFIG_URL },
                (response) => {
                    if (response && response.success && response.data) {
                        activeSelectors = { ...DEFAULT_SELECTORS, ...response.data };
                        console.log("NotebookLM Tree: Updated selectors from remote config.");
                    } else {
                        console.log("NotebookLM Tree: Using default selectors.");
                    }
                    startApp(); 
                }
            );
        } else {
            startApp();
        }
    });
    
    // Watch for URL changes (user navigates to different notebook)
    startUrlWatcher();
}

function startUrlWatcher() {
    if (urlCheckInterval) return; // Already watching
    
    urlCheckInterval = setInterval(() => {
        const newNotebookId = getNotebookId();
        
        if (newNotebookId && newNotebookId !== currentNotebookId) {
            console.log(`[NotebookLM Tree] Notebook changed: ${currentNotebookId} -> ${newNotebookId}`);
            
            // Clean up existing UI
            const existingSource = document.getElementById('plugin-source-root');
            const existingStudio = document.getElementById('plugin-studio-root');
            if (existingSource) existingSource.remove();
            if (existingStudio) existingStudio.remove();
            
            // Remove injection markers
            document.querySelectorAll('.plugin-ui-injected').forEach(el => {
                el.classList.remove('plugin-ui-injected');
            });
            
            // Reset state and reinitialize
            currentNotebookId = newNotebookId;
            appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
            searchIndex = {};
            
            // Reload data for new notebook
            const stateKey = getStorageKey('notebookTreeState');
            const indexKey = getStorageKey('notebookSearchIndex');
            
            chrome.storage.local.get([stateKey, indexKey], (result) => {
                if (result[stateKey] && result[stateKey].source) {
                    appState = result[stateKey];
                    if (!appState.settings) appState.settings = { showGenerators: true, showResearch: true };
                    if (!appState.source.pinned) appState.source.pinned = [];
                    if (!appState.studio.pinned) appState.studio.pinned = [];
                }
                
                if (result[indexKey]) {
                    searchIndex = result[indexKey];
                }
                
                // Re-run organizer for new notebook
                setTimeout(runOrganizer, 500);
            });
        } else if (newNotebookId && !currentNotebookId) {
            // User just navigated into a notebook
            currentNotebookId = newNotebookId;
            init();
        }
    }, 1000);
}

function startApp() {
    startObserver();
    setTimeout(runOrganizer, 500);
}

function saveState() {
    const stateKey = getStorageKey('notebookTreeState');
    if (!stateKey) return;
    
    chrome.storage.local.set({ [stateKey]: appState });
}

// --- HELPER: KEY NORMALIZER ---
function normalizeKey(str) {
    if (!str) return "";
    return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

// --- EXPAND/COLLAPSE ALL FOLDERS ---
function expandAllFolders(context) {
    Object.values(appState[context].folders).forEach(f => f.isOpen = true);
    saveState();
    renderTree(context);
    setTimeout(() => processItems(context), 50);
}

function collapseAllFolders(context) {
    Object.values(appState[context].folders).forEach(f => f.isOpen = false);
    saveState();
    renderTree(context);
}

// --- EXPORT/IMPORT FUNCTIONS ---
function exportFolders() {
    const notebookId = getNotebookId();
    const data = {
        version: "14.2",
        exportedAt: new Date().toISOString(),
        description: "NotebookLM Pro Tree folder backup",
        notebookId: notebookId,
        source: appState.source,
        studio: appState.studio,
        settings: appState.settings
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `notebooklm-folders-${notebookId ? notebookId.substring(0, 8) : 'backup'}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
    showToast("✓ Folders exported");
}

function importFolders() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                
                // Basic validation
                if (!data.source || !data.studio) {
                    throw new Error("Invalid backup file - missing source or studio data");
                }
                
                // Validate folder structure
                if (typeof data.source.folders !== 'object' || typeof data.studio.folders !== 'object') {
                    throw new Error("Invalid backup file - malformed folder structure");
                }
                
                // Warn if importing from different notebook
                const currentId = getNotebookId();
                if (data.notebookId && data.notebookId !== currentId) {
                    const proceed = confirm(
                        "This backup is from a different notebook.\n\n" +
                        "The folder structure will be imported, but item mappings may not work " +
                        "(since source/note names are likely different).\n\n" +
                        "Continue anyway?"
                    );
                    if (!proceed) return;
                }
                
                // Ask user: Replace or Merge?
                const choice = confirm(
                    "Replace all existing folders?\n\n" +
                    "OK = Yes, replace everything\n" +
                    "Cancel = No, merge instead (keeps existing folders)"
                );
                
                if (choice) {
                    // Replace mode
                    appState.source = data.source;
                    appState.studio = data.studio;
                    if (data.settings) appState.settings = { ...appState.settings, ...data.settings };
                } else {
                    // Merge mode - add new folders, keep existing
                    Object.keys(data.source.folders).forEach(id => {
                        if (!appState.source.folders[id]) {
                            appState.source.folders[id] = data.source.folders[id];
                        }
                    });
                    Object.keys(data.studio.folders).forEach(id => {
                        if (!appState.studio.folders[id]) {
                            appState.studio.folders[id] = data.studio.folders[id];
                        }
                    });
                    
                    Object.keys(data.source.mappings).forEach(key => {
                        if (!appState.source.mappings[key]) {
                            appState.source.mappings[key] = data.source.mappings[key];
                        }
                    });
                    Object.keys(data.studio.mappings).forEach(key => {
                        if (!appState.studio.mappings[key]) {
                            appState.studio.mappings[key] = data.studio.mappings[key];
                        }
                    });
                    
                    if (data.source.pinned) {
                        appState.source.pinned = [...new Set([...appState.source.pinned, ...data.source.pinned])];
                    }
                    if (data.studio.pinned) {
                        appState.studio.pinned = [...new Set([...appState.studio.pinned, ...data.studio.pinned])];
                    }
                }
                
                if (!appState.source.pinned) appState.source.pinned = [];
                if (!appState.studio.pinned) appState.studio.pinned = [];
                
                saveState();
                showToast("✓ Folders imported - reloading...");
                
                setTimeout(() => {
                    location.reload();
                }, 1000);
                
            } catch (err) {
                console.error("[NotebookLM Tree] Import error:", err);
                alert("Import failed: " + err.message);
            }
        };
        reader.readAsText(file);
    };
    
    input.click();
}

// --- ROBUST INDEXER: SAVE CONTENT ---
function saveToIndex(title, content) {
    if (!title || !content || content.length < 5) return;
    
    const indexKey = getStorageKey('notebookSearchIndex');
    if (!indexKey) return;
    
    const key = normalizeKey(title);
    const safeContent = content.length > 20000 ? content.substring(0, 20000) : content;
    const lowerContent = safeContent.toLowerCase();

    if (searchIndex[key] === lowerContent) return;

    searchIndex[key] = lowerContent;
    
    chrome.storage.local.set({ [indexKey]: searchIndex }, () => {
        if (chrome.runtime.lastError) {
            console.warn("[NotebookLM Tree] Storage error:", chrome.runtime.lastError);
        }
    });
    console.log(`[NotebookLM Tree] Indexed: "${key}"`);
    
    updateSearchStats('studio');

    const activeEl = document.activeElement;
    const isTyping = activeEl && (
        activeEl.classList.contains('ql-editor') || 
        activeEl.getAttribute('contenteditable') === 'true' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.tagName === 'INPUT'
    );

    if (!isTyping) {
        showToast("✓ Note Indexed");
    }

    const searchInput = document.querySelector('#plugin-studio-root .plugin-search-area input');
    if (searchInput) {
        searchInput.style.transition = 'border-color 0.3s';
        searchInput.style.borderColor = '#8ab4f8'; 
        setTimeout(() => { 
            searchInput.style.borderColor = ''; 
        }, 2000); 
    }
}

// --- UX HELPER: TOAST NOTIFICATION ---
function showToast(message) {
    const existing = document.getElementById('plugin-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'plugin-toast';
    toast.innerText = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        background-color: #323232;
        color: #fff;
        padding: 10px 24px;
        border-radius: 4px;
        font-size: 14px;
        font-family: 'Google Sans', Roboto, sans-serif;
        z-index: 10000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        opacity: 0;
        transition: opacity 0.3s ease-in-out;
        pointer-events: none;
    `;

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// --- DYNAMIC SEARCH STATS ---
function updateSearchStats(context) {
    if (context !== 'studio') return;
    const searchInput = document.querySelector('#plugin-studio-root .plugin-search-area input');
    if (!searchInput) return;

    const totalNotes = document.querySelectorAll('#plugin-studio-root .plugin-detected-row').length;
    const indexedCount = Object.keys(searchIndex).length;
    const displayCount = Math.min(indexedCount, totalNotes);

    if (totalNotes > 0) {
        searchInput.placeholder = `Search titles (${displayCount}/${totalNotes} indexed)...`;
    } else {
        searchInput.placeholder = "Search titles...";
    }
}

// --- OBSERVER ---
function startObserver() {
    const observer = new MutationObserver((mutations) => {
        const isInternal = mutations.some(m => m.target && m.target.closest && m.target.closest('.plugin-container'));
        if (isInternal) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            runOrganizer();
        }, 250);

        if (indexDebounce) clearTimeout(indexDebounce);
        indexDebounce = setTimeout(() => {
            detectAndIndexActiveNote();
            setTimeout(detectAndIndexActiveNote, 500);
            setTimeout(detectAndIndexActiveNote, 1500);
        }, 500); 
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// --- ROBUST SELECTOR HELPER ---
function detectAndIndexActiveNote() {
    try {
        const titleEl = getElementByRobustSelector('activeNoteTitle');
        if (!titleEl) return;
        
        let title = titleEl.value || titleEl.innerText;
        if (!title) return;
        
        const bodyEl = getElementByRobustSelector('activeNoteBody');
        if (bodyEl) {
            const content = bodyEl.innerText;
            if (content) {
                saveToIndex(title, content);
            }
        }
    } catch (e) {
        // Fail silently
    }
}

function getElementByRobustSelector(key, parent = document) {
    const selectorOrList = activeSelectors[key];
    if (Array.isArray(selectorOrList)) {
        for (const selector of selectorOrList) {
            if (selector.includes(',')) {
                 const el = parent.querySelector(selector);
                 if (el) return el;
            } else {
                 const el = parent.querySelector(selector);
                 if (el) return el;
            }
        }
        return null;
    } else {
        return parent.querySelector(selectorOrList);
    }
}

function runOrganizer() {
    // Don't run if not in a notebook
    if (!getNotebookId()) return;
    
    const sourceAnchor = findSelectAllRow();
    if (sourceAnchor) {
        injectContainer(sourceAnchor, 'source');
        processItems('source');
    }

    const studioAnchor = findStudioAnchor();
    const studioContainer = document.getElementById('plugin-studio-root');
    
    if (studioAnchor) {
        injectContainer(studioAnchor, 'studio');
        if (studioContainer) studioContainer.style.display = 'block';
        processItems('studio');
    } else {
        if (studioContainer) studioContainer.style.display = 'none';
    }
}

// --- ANCHOR FINDING ---
function findSelectAllRow() {
    const nameMatch = document.querySelector('span[name="allsources"]');
    if (nameMatch) return getRowContainer(nameMatch);
    const allSpans = document.querySelectorAll('span, div, label');
    const textMatch = Array.from(allSpans).find(el => el.innerText && el.innerText.trim() === "Select all sources");
    if (textMatch) return getRowContainer(textMatch);
    const allChecks = document.querySelectorAll('mat-checkbox');
    if (allChecks.length > 0) {
        const firstCheck = allChecks[0];
        if (!firstCheck.closest(activeSelectors.sourceRow)) return getRowContainer(firstCheck);
    }
    return null;
}

function findStudioAnchor() {
    const genBox = document.querySelector('.create-artifact-buttons-container') || 
                   document.querySelector('studio-panel .actions-container');
    if (genBox) return genBox;
    const sortBtn = document.querySelector('button[aria-label="Sort"]');
    if (sortBtn) return getRowContainer(sortBtn);
    const firstNote = document.querySelector(activeSelectors.studioRow);
    if (firstNote) return firstNote;
    return null;
}

function getRowContainer(element) {
    let row = element;
    while (row && row.parentElement) {
        if (row.classList.contains('row') || 
            row.parentElement.tagName === 'MAT-NAV-LIST' ||
            row.parentElement.classList.contains('panel-content')) {
            return row;
        }
        row = row.parentElement;
    }
    return element;
}

// --- UI INJECTION ---
function injectContainer(anchorEl, context) {
    const id = `plugin-${context}-root`;
    if (anchorEl.classList.contains('plugin-ui-injected') || document.getElementById(id)) return;

    let wrapper = anchorEl.parentElement;
    if (!wrapper) return;

    const container = document.createElement('div');
    container.id = id;
    container.className = 'plugin-container';

    const controls = document.createElement('div');
    controls.className = 'plugin-controls-area';
    
    controls.innerHTML = `
        <button class="plugin-btn add-folder" title="Create New Folder">${ICONS.newFolder}</button>
        <button class="plugin-btn secondary expand-all" title="Expand All Folders">${ICONS.expandAll}</button>
        <button class="plugin-btn secondary collapse-all" title="Collapse All Folders">${ICONS.collapseAll}</button>
        <button class="plugin-btn secondary export-btn" title="Export Folders">${ICONS.export}</button>
        <button class="plugin-btn secondary import-btn" title="Import Folders">${ICONS.import}</button>
        <button class="plugin-btn secondary reset-btn" title="Reset Tree (Restart)">${ICONS.restart}</button>
    `;

    if (context === 'source') {
        const toggleResearchBtn = document.createElement('button');
        toggleResearchBtn.className = 'plugin-btn secondary toggle-research';
        toggleResearchBtn.innerHTML = ICONS.search;
        
        const updateResearchVisuals = () => {
            const isVisible = appState.settings.showResearch;
            toggleResearchBtn.title = isVisible ? "Hide Web Research (visible)" : "Show Web Research (hidden)";
            toggleResearchBtn.classList.toggle('toggle-off', !isVisible);
            
            const promos = document.querySelectorAll('.source-discovery-promo-container');
            const boxes = document.querySelectorAll('source-discovery-query-box');
            promos.forEach(el => el.style.display = isVisible ? '' : 'none');
            boxes.forEach(el => el.style.display = isVisible ? '' : 'none');
        };

        toggleResearchBtn.onclick = () => {
            appState.settings.showResearch = !appState.settings.showResearch;
            saveState();
            updateResearchVisuals();
        };

        updateResearchVisuals();
        controls.insertBefore(toggleResearchBtn, controls.lastElementChild);
    }
    
    if (context === 'studio') {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'plugin-btn secondary toggle-gen';
        toggleBtn.innerHTML = ICONS.tune;
        
        const updateToggleVisuals = () => {
            const isVisible = appState.settings.showGenerators;
            toggleBtn.title = isVisible ? "Hide Generators (visible)" : "Show Generators (hidden)";
            toggleBtn.classList.toggle('toggle-off', !isVisible);
            const box = document.querySelector('.create-artifact-buttons-container');
            if (box) box.style.display = isVisible ? '' : 'none';
        };

        toggleBtn.onclick = () => {
            appState.settings.showGenerators = !appState.settings.showGenerators;
            saveState();
            updateToggleVisuals();
        };

        updateToggleVisuals();
        controls.insertBefore(toggleBtn, controls.lastElementChild);
        
        const searchDiv = document.createElement('div');
        searchDiv.className = 'plugin-search-area';
        searchDiv.innerHTML = `<input type="text" placeholder="Search titles...">`;
        
        let searchDebounce;
        searchDiv.querySelector('input').oninput = (e) => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                filterProxies(context, e.target.value);
            }, 150);
        };
        container.appendChild(searchDiv);
    }

    controls.querySelector('.add-folder').onclick = () => createFolder(context);
    controls.querySelector('.expand-all').onclick = () => expandAllFolders(context);
    controls.querySelector('.collapse-all').onclick = () => collapseAllFolders(context);
    controls.querySelector('.export-btn').onclick = () => exportFolders();
    controls.querySelector('.import-btn').onclick = () => importFolders();
    controls.querySelector('.reset-btn').onclick = () => {
        if(confirm("Reset all folders for this notebook? This cannot be undone.\n\nTip: Export your folders first if you want a backup.")) {
            appState[context] = { folders: {}, mappings: {}, pinned: [] };
            saveState();
            location.reload();
        }
    };

    container.appendChild(controls);
    const pinnedMount = document.createElement('div');
    pinnedMount.id = `pinned-mount-${context}`;
    pinnedMount.className = 'plugin-pinned-section';
    pinnedMount.style.display = 'none'; 
    container.appendChild(pinnedMount);
    const treeMount = document.createElement('div');
    treeMount.id = `tree-mount-${context}`;
    container.appendChild(treeMount);

    if (context === 'source') {
        wrapper.insertBefore(container, anchorEl);
    } else if (context === 'studio') {
        if (anchorEl.classList.contains('create-artifact-buttons-container') && anchorEl.nextElementSibling) {
            wrapper.insertBefore(container, anchorEl.nextElementSibling);
        } else if (anchorEl.tagName === 'ARTIFACT-LIBRARY-NOTE' || anchorEl.tagName === 'MAT-CARD') {
            wrapper.insertBefore(container, anchorEl);
        } else {
            wrapper.appendChild(container);
        }
    } else {
        wrapper.appendChild(container);
    }

    anchorEl.classList.add('plugin-ui-injected');
    renderTree(context);
}

// --- TREE RENDERING ---
function renderTree(context) {
    const mount = document.getElementById(`tree-mount-${context}`);
    if (!mount) return;
    const fragment = document.createDocumentFragment();
    const folders = Object.values(appState[context].folders);
    const roots = folders.filter(f => !f.parentId).sort((a,b) => {
        const orderA = a.order !== undefined ? a.order : 0;
        const orderB = b.order !== undefined ? b.order : 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
    });
    roots.forEach(root => fragment.appendChild(buildFolderNode(root, folders, context)));
    mount.innerHTML = '';
    mount.appendChild(fragment);
}

function buildFolderNode(folder, allFolders, context) {
    const node = document.createElement('div');
    node.className = `plugin-tree-node ${folder.isOpen ? 'open' : ''}`;
    node.id = `node-${folder.id}`;
    const style = folder.color ? `border-left: 4px solid ${folder.color};` : '';

    const header = document.createElement('div');
    header.className = 'plugin-folder-header';
    header.style.cssText = style;
    header.innerHTML = `
        <span class="arrow">▶</span>
        <span class="folder-icon" style="color:${folder.color || '#8ab4f8'}">${ICONS.folder}</span>
        <span class="folder-name"></span>
        <div class="folder-actions">
             <span class="action-icon move-up" title="Move Up">${ICONS.up}</span>
             <span class="action-icon move-down" title="Move Down">${ICONS.down}</span>
             <span class="action-icon color-pick" title="Color">${ICONS.palette}</span>
             <span class="action-icon add" title="Add Sub">${ICONS.add}</span>
             <span class="action-icon ren" title="Rename">${ICONS.edit}</span>
             <span class="action-icon del" title="Delete">${ICONS.close}</span>
        </div>
    `;
    header.querySelector('.folder-name').textContent = folder.name;

    header.onclick = (e) => {
        if (e.target.closest('.folder-actions')) return;
        folder.isOpen = !folder.isOpen;
        saveState();
        renderTree(context);
        setTimeout(() => processItems(context), 50); 
    };
    header.querySelector('.move-up').onclick = (e) => { e.stopPropagation(); moveFolder(context, folder.id, -1); };
    header.querySelector('.move-down').onclick = (e) => { e.stopPropagation(); moveFolder(context, folder.id, 1); };
    header.querySelector('.color-pick').onclick = (e) => {
        e.stopPropagation();
        const colors = [null, '#e8eaed', '#f28b82', '#fbbc04', '#34a853', '#4285f4', '#d93025'];
        const cur = folder.color || null;
        const next = colors[(colors.indexOf(cur) + 1) % colors.length];
        folder.color = next;
        saveState();
        renderTree(context);
    };
    header.querySelector('.add').onclick = () => createFolder(context, folder.id);
    header.querySelector('.ren').onclick = (e) => { e.stopPropagation(); const n = prompt("Rename:", folder.name); if(n) { folder.name = n; saveState(); renderTree(context); }};
    header.querySelector('.del').onclick = (e) => { e.stopPropagation(); if(confirm("Delete folder?")) deleteFolder(context, folder.id); };

    node.appendChild(header);
    const content = document.createElement('div');
    content.className = 'plugin-node-children';
    content.id = `folder-content-${folder.id}`;
    const subs = allFolders.filter(f => f.parentId === folder.id).sort((a,b) => (a.order||0) - (b.order||0));
    subs.forEach(sub => content.appendChild(buildFolderNode(sub, allFolders, context)));
    node.appendChild(content);
    return node;
}

function moveFolder(context, folderId, direction) {
    const folders = Object.values(appState[context].folders);
    const target = appState[context].folders[folderId];
    if (!target) return;
    const pid = target.parentId || null;
    const sibs = folders.filter(f => (f.parentId || null) === pid).sort((a,b) => {
        const oa = a.order !== undefined ? a.order : 0;
        const ob = b.order !== undefined ? b.order : 0;
        return oa !== ob ? oa - ob : a.name.localeCompare(b.name);
    });
    sibs.forEach((f, i) => f.order = i);
    const idx = sibs.findIndex(f => f.id === folderId);
    const newIdx = idx + direction;
    if (newIdx >= 0 && newIdx < sibs.length) {
        const swap = sibs[newIdx];
        [target.order, swap.order] = [swap.order, target.order];
        saveState();
        renderTree(context);
    }
}

// --- ITEM PROCESSING ---
function processItems(context) {
    let items = [];
    if (context === 'source') {
        if (appState.settings.showResearch === false) {
             const promos = document.querySelectorAll('.source-discovery-promo-container');
             const boxes = document.querySelectorAll('source-discovery-query-box');
             promos.forEach(el => el.style.display = 'none');
             boxes.forEach(el => el.style.display = 'none');
        }

        items = document.querySelectorAll(activeSelectors.sourceRow);
        if (items.length === 0) {
            const icons = document.querySelectorAll('mat-icon[data-mat-icon-type="font"]');
            const cands = new Set();
            icons.forEach(i => { if(['drive_pdf','article'].includes(i.innerText.trim())) cands.add(i.closest('div[tabindex="0"]')); });
            items = Array.from(cands);
        }
    } else {
        items = document.querySelectorAll(activeSelectors.studioRow + ', mat-card');
    }

    const pinnedMount = document.getElementById(`pinned-mount-${context}`);
    if (pinnedMount) pinnedMount.innerHTML = '';
    let hasPinned = false;

    items.forEach(nativeRow => {
        nativeRow.classList.add('plugin-detected-row');
        let titleEl = context === 'source' ? nativeRow.querySelector(activeSelectors.sourceTitle) : nativeRow.querySelector(activeSelectors.studioTitle);
        if (!titleEl) return;
        const text = titleEl.innerText.trim();
        if (!text) return;

        if (!nativeRow.querySelector('.plugin-move-trigger')) injectMoveTrigger(nativeRow, text, context);

        if (isPinned(context, text)) {
            hasPinned = true;
            pinnedMount.appendChild(createProxyItem(nativeRow, text, context, true));
        }

        const folderId = appState[context].mappings[text];
        if (folderId && appState[context].folders[folderId]) {
            nativeRow.classList.add('plugin-hidden-native');
            const target = document.getElementById(`folder-content-${folderId}`);
            if (target && !target.querySelector(`.plugin-proxy-item[data-ref="${text}"]`)) {
                target.appendChild(createProxyItem(nativeRow, text, context, false));
            }
        } else {
            nativeRow.classList.remove('plugin-hidden-native');
        }
    });

    if (pinnedMount) pinnedMount.style.display = hasPinned ? 'block' : 'none';
    
    if(context === 'studio') updateSearchStats('studio');
}

function isPinned(context, title) { return appState[context].pinned && appState[context].pinned.includes(title); }
function togglePin(context, title) {
    if (!appState[context].pinned) appState[context].pinned = [];
    const idx = appState[context].pinned.indexOf(title);
    if (idx > -1) appState[context].pinned.splice(idx, 1); else appState[context].pinned.push(title);
    saveState();
    processItems(context);
}

function createProxyItem(nativeRow, text, context, isPinnedView) {
    const proxy = document.createElement('div');
    proxy.className = 'plugin-proxy-item inside-plugin-folder';
    proxy.dataset.ref = text;
    proxy.dataset.searchTerm = text.toLowerCase(); 

    if(isPinnedView) proxy.classList.add('is-pinned-proxy');

    let iconElement = null;
    if (context === 'source') {
        const nativeIcon = nativeRow.querySelector('.source-item-source-icon') || nativeRow.querySelector('mat-icon[data-mat-icon-type="font"]');
        if (nativeIcon) {
            iconElement = nativeIcon.cloneNode(true);
            const style = window.getComputedStyle(nativeIcon);
            iconElement.style.color = style.color;
            iconElement.style.fontFamily = style.fontFamily; 
            iconElement.style.marginRight = '8px';
            iconElement.style.display = 'flex';
        } else {
            iconElement = document.createElement('span');
            iconElement.innerText = '📄';
        }
    } else {
        const span = document.createElement('span');
        span.innerHTML = `<svg style="color:#8ab4f8;" xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"/></svg>`;
        iconElement = span.firstElementChild;
    }

    const isP = isPinned(context, text);
    const pinIcon = isP ? ICONS.keepFilled : ICONS.keep;
    const pinTitle = isP ? "Unpin (Keep Off)" : "Pin (Keep)";

    const contentDiv = document.createElement('div');
    contentDiv.className = 'proxy-content';
    
    const iconSpan = document.createElement('span');
    iconSpan.className = 'proxy-icon';
    iconSpan.appendChild(iconElement);
    contentDiv.appendChild(iconSpan);

    const textSpan = document.createElement('span');
    textSpan.className = 'proxy-text';
    textSpan.textContent = text;
    contentDiv.appendChild(textSpan);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'proxy-actions';

    const ejectBtn = document.createElement('span');
    ejectBtn.className = 'pin-btn';
    ejectBtn.title = "Eject from Folder";
    ejectBtn.innerHTML = ICONS.eject; 
    ejectBtn.onclick = (e) => {
        e.stopPropagation();
        delete appState[context].mappings[text];
        saveState();
        nativeRow.classList.remove('plugin-hidden-native');
        nativeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        nativeRow.style.transition = 'background 0.5s';
        nativeRow.style.backgroundColor = '#424242';
        setTimeout(() => { nativeRow.style.backgroundColor = ''; }, 1000);
        proxy.remove();
    };
    actionsDiv.appendChild(ejectBtn);

    const pinBtn = document.createElement('span');
    pinBtn.className = 'pin-btn';
    pinBtn.title = pinTitle;
    pinBtn.innerHTML = pinIcon;
    pinBtn.onclick = (e) => { e.stopPropagation(); togglePin(context, text); };
    actionsDiv.appendChild(pinBtn);

    proxy.appendChild(contentDiv);
    proxy.appendChild(actionsDiv);

    if (!isPinnedView) injectMoveTrigger(proxy, text, context);

    proxy.onclick = (e) => {
        if (e.target.closest('.plugin-move-trigger') || e.target.closest('.pin-btn')) return;
        if (context === 'source') {
            const titleEl = nativeRow.querySelector(activeSelectors.sourceTitle);
            if(titleEl) {
                const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
                titleEl.dispatchEvent(new MouseEvent('mousedown', opts));
                titleEl.dispatchEvent(new MouseEvent('mouseup', opts));
                titleEl.click();
            } else nativeRow.click();
        } else {
            const titleEl = nativeRow.querySelector(activeSelectors.studioTitle);
            if(titleEl) titleEl.click(); else nativeRow.click();
        }
    };

    return proxy;
}

function injectMoveTrigger(row, text, context) {
    if (row.querySelector('.plugin-move-trigger[title="Move to Folder"]')) return;
    const btn = document.createElement('div');
    btn.className = 'plugin-move-trigger';
    btn.innerHTML = ICONS.move;
    btn.title = "Move to Folder";
    btn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); showMoveMenu(e, text, context); };
    
    if (row.classList.contains('plugin-proxy-item')) {
        const actions = row.querySelector('.proxy-actions');
        if (actions) actions.insertBefore(btn, actions.firstChild);
    } else {
        if (context === 'source') {
            const moreBtn = row.querySelector('button[aria-label="More"]');
            if (moreBtn && moreBtn.parentElement) {
                moreBtn.parentElement.insertBefore(btn, moreBtn);
                moreBtn.parentElement.style.display = 'flex';
            } else row.insertBefore(btn, row.firstChild);
        } else {
            const actions = row.querySelector('.artifact-item-button');
            if (actions) {
                actions.insertBefore(btn, actions.firstChild);
                actions.style.display = 'flex';
            } else row.appendChild(btn);
        }
    }
}

function showMoveMenu(e, text, context) {
    document.querySelectorAll('.plugin-dropdown').forEach(el => el.remove());
    const menu = document.createElement('div');
    menu.className = 'plugin-dropdown';
    if (appState[context].mappings[text]) {
        const item = document.createElement('div');
        item.className = 'plugin-dropdown-item';
        item.style.color = '#f28b82';
        item.innerText = "Remove from Folder";
        item.onclick = (ev) => {
            ev.stopPropagation();
            delete appState[context].mappings[text];
            saveState();
            const proxy = document.querySelector(`.plugin-proxy-item[data-ref="${text}"]`);
            if(proxy) proxy.remove();
            processItems(context);
            menu.remove();
        };
        menu.appendChild(item);
    }
    const list = getFlatList(context);
    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'plugin-dropdown-item';
        empty.style.fontStyle = 'italic';
        empty.innerText = "No folders created";
        menu.appendChild(empty);
    }
    list.forEach(f => {
        const item = document.createElement('div');
        item.className = 'plugin-dropdown-item';
        let indent = ""; for(let i=0; i<f.level; i++) indent += "&nbsp;&nbsp;";
        item.innerHTML = `${indent}${ICONS.folder} ${f.name}`;
        item.onclick = (ev) => {
            ev.stopPropagation();
            appState[context].mappings[text] = f.id;
            appState[context].folders[f.id].isOpen = true;
            saveState();
            renderTree(context);
            setTimeout(() => processItems(context), 50);
            menu.remove();
        };
        menu.appendChild(item);
    });
    document.body.appendChild(menu);
    const rect = e.target.getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY) + 'px';
    menu.style.left = rect.left + 'px';
    setTimeout(() => {
        const close = () => { menu.remove(); document.removeEventListener('click', close); };
        document.addEventListener('click', close);
    }, 100);
}

function createFolder(context, parentId) {
    const name = prompt("Folder Name:");
    if(!name) return;
    const id = Math.random().toString(36).substr(2,9);
    const count = Object.values(appState[context].folders).filter(f => f.parentId === parentId).length;
    appState[context].folders[id] = { id, name, parentId, isOpen: true, order: count };
    saveState();
    renderTree(context);
}

function deleteFolder(context, id) {
    delete appState[context].folders[id];
    const maps = appState[context].mappings;
    Object.keys(maps).forEach(k => { if(maps[k]===id) delete maps[k]; });
    Object.values(appState[context].folders).forEach(f => { if(f.parentId===id) f.parentId=null; });
    saveState();
    renderTree(context);
    processItems(context); 
}

function getFlatList(context) {
    const arr = [];
    const folders = appState[context].folders;
    function recurse(pid, level) {
        const kids = Object.values(folders).filter(f => {
            const parent = f.parentId || null;
            const target = pid || null;
            return parent === target;
        }).sort((a,b)=> {
             const orderA = a.order !== undefined ? a.order : 0;
             const orderB = b.order !== undefined ? b.order : 0;
             if (orderA !== orderB) return orderA - orderB;
             return a.name.localeCompare(b.name);
        });
        kids.forEach(k => {
            arr.push({ id: k.id, name: k.name, level });
            recurse(k.id, level+1);
        });
    }
    recurse(null, 0);
    return arr;
}

// --- ADVANCED SEARCH (FUZZY + DEEP INDEX) ---
function filterProxies(context, query) {
    const term = query.toLowerCase().trim();
    const container = document.getElementById(`plugin-${context}-root`);
    if (!container) return;

    const getFolderNode = (id) => container.querySelector(`#node-${id}`);
    
    if (!term) {
        container.querySelectorAll('.plugin-proxy-item').forEach(el => el.style.display = 'flex');
        container.querySelectorAll('.plugin-tree-node').forEach(el => el.style.display = 'block');
        Object.values(appState[context].folders).forEach(f => {
            const node = getFolderNode(f.id);
            if(node) {
                if (f.isOpen) node.classList.add('open');
                else node.classList.remove('open');
            }
        });
        return;
    }

    container.querySelectorAll('.plugin-proxy-item').forEach(el => el.style.display = 'none');
    container.querySelectorAll('.plugin-tree-node').forEach(el => el.style.display = 'none');

    const proxies = container.querySelectorAll('.plugin-proxy-item');
    proxies.forEach(proxy => {
        const visibleText = proxy.dataset.searchTerm || proxy.innerText.toLowerCase();
        const titleRaw = proxy.dataset.ref || "";
        const titleKey = normalizeKey(titleRaw);
        const deepContent = searchIndex[titleKey] || "";

        const combinedText = visibleText + " " + deepContent;

        const terms = term.split(' ').filter(t => t);
        const isMatch = terms.every(t => combinedText.includes(t));

        if (isMatch) {
            proxy.style.display = 'flex';
            
            let parent = proxy.parentElement;
            while(parent && parent !== container) {
                if(parent.classList.contains('plugin-node-children')) {
                    const folderNode = parent.parentElement;
                    if(folderNode) {
                        folderNode.style.display = 'block';
                        folderNode.classList.add('open');
                    }
                }
                parent = parent.parentElement;
            }
        }
    });

    const folderNodes = container.querySelectorAll('.plugin-tree-node');
    folderNodes.forEach(node => {
        const header = node.querySelector('.plugin-folder-header .folder-name');
        if(!header) return;
        
        const folderName = header.innerText.toLowerCase();
        if (folderName.includes(term)) {
            node.style.display = 'block';
            let parent = node.parentElement;
            while(parent && parent !== container) {
                if (parent.classList.contains('plugin-node-children')) {
                    const grandParent = parent.parentElement;
                    if(grandParent) {
                        grandParent.style.display = 'block';
                        grandParent.classList.add('open');
                    }
                }
                parent = parent.parentElement;
            }
        }
    });
}

init();