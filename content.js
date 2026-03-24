/**
 * NotebookLM Pro Tree - V17.9 (Note Pop-out)
 * Author: Benju66
 * NOTE: Version is now read from manifest.json only - single source of truth
 * 
 * V17.9 Changes:
 * - Added note pop-out feature to open notes in separate browser windows
 * - Pop-out button appears on hover for folder items and active notes
 * - Read-only view with full formatting preservation (when opened from active note)
 * - Plain text fallback for indexed notes (when opened from folder)
 * - Copy to clipboard functionality in pop-out windows
 * - Dark/light theme support matching NotebookLM
 * - Namespace bridge for modular architecture (window.NotebookLMTree)
 * 
 * V17.8 Changes:
 * - Added graceful degradation system for feature resilience
 * - Features disable individually after repeated failures instead of crashing
 * - Updated remote config URL to use versionless Gist endpoint
 * - Improved error recovery and user feedback
 * 
 * V17.7 Changes:
 * - Added task description field (optional context for tasks)
 * - Description icon in task toolbar (blue when has description)
 * - Hover over description icon shows preview tooltip
 * - Click description icon to view/edit in dedicated modal
 * - Floating "Create Task" button appears when selecting text in notes
 * - Auto-populates task title (truncated), description (full text), and source note
 * - Source note name captured and displayed (read-only reference)
 * - Link icon in task toolbar for tasks created from notes (blue, always visible)
 * - Click link icon to filter Studio panel to show the source note
 * - Edit modal now includes description field
 * - Create modal now includes description field
 * 
 * V17.6 Changes:
 * - Added support for generated items (Slides, Infographics, FAQs, etc.) in Studio panel
 * - Generated items can now be moved to folders like notes
 * - Items still being generated are automatically skipped until complete
 * - Added custom task sections (collapsible groups for organizing tasks)
 * - Task sections support colors, reordering, rename, and delete
 * - Tasks can be moved between sections via move button
 * - Added date picker for task due dates (replaces manual text input)
 * - Added "Today", "Tomorrow", "+1 Week" quick date buttons
 * - Added expandable options panel when creating tasks (date + section)
 * - Added "Sort by Due Date" button in task header
 * - Enhanced task edit modal with date picker and section selector
 * - Updated Zen Mode icon to "Self Improvement" (meditation pose)
 * - Fixed folder checkbox only showing in Source panel (not Studio)
 * 
 * V17.5 Changes:
 * - Switched to local-only storage (unlimitedStorage permission)
 * - Automatic migration from sync storage for existing users
 * - Removed 100KB sync storage limitation
 * - Simplified storage architecture for future features (links/tags)
 * - Cleaner codebase with single storage path
 * 
 * V17.4 Changes:
 * - Version now reads from manifest.json (no more manual sync needed)
 * - Added custom styled confirmation modals (replaces native confirm())
 * - Added search index size limit (2MB) with LRU eviction
 * - Added race condition guard for processItems()
 * - Improved memory management for large notebooks
 * 
 * V17.3 Changes:
 * - Added "Select All/Deselect All" button to source panel
 * - Added checkboxes to individual tree items (synced with native state)
 * - Added bulk-select checkboxes to folders
 * - Fixed native checkbox synchronization
 */

// --- CONFIGURATION ---
const REMOTE_CONFIG_URL = "https://gist.githubusercontent.com/benju66/7635f09ea87f81c890f9b736b22d9ac4/raw/notebooklm-selectors.json";

// --- VERSION HELPER (Single source of truth: manifest.json) ---
function getExtensionVersion() {
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
            return chrome.runtime.getManifest().version;
        }
    } catch (e) { }
    return 'unknown';
} 

// --- NAMED CONSTANTS ---
const DEBOUNCE_ORGANIZER_MS = 250;
const DEBOUNCE_INDEX_MS = 1000;
const DEBOUNCE_SEARCH_MS = 300;
const URL_CHECK_INTERVAL_MS = 1000;
const INIT_DELAY_MS = 500;
const DOM_SETTLE_DELAY_MS = 50;
/** Movement past this (px) turns a native-row pointer gesture into a drag vs a click. */
const NATIVE_POINTER_DRAG_THRESHOLD_PX = 12;
const MAX_INDEX_CONTENT_LENGTH = 20000;
const MAX_INDEX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB limit for search index
const FUZZY_MATCH_THRESHOLD = 0.65;
const FOLDER_NAME_MATCH_THRESHOLD = 0.70;
const TOAST_DISPLAY_MS = 2500;
const TOAST_FADE_MS = 300;
const CONFIG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const HEALTH_CHECK_INTERVAL_MS = 30000; // Check selector health every 30s
const SELECTOR_FAILURE_THRESHOLD = 3; // Warn after this many selector types fail
const MAX_FEATURE_FAILURES = 3; // Disable feature after this many consecutive failures

// --- DEFAULT SELECTORS (Arrays for fallback chain) ---
const DEFAULT_SELECTORS = {
    sourceRow: [
        '.single-source-container',
        '[data-source-id]',
        '.source-item',
        'div[role="listitem"]:has(mat-checkbox)',
        '.source-list-item'
    ],
    studioRow: [
        'artifact-library-note, artifact-library-item',
        'mat-card[class*="artifact"]',
        '.studio-note-item',
        '.artifact-item',
        '[data-note-id]'
    ],
    sourceTitle: [
        '.source-title',
        '[aria-label="Source title"]',
        '.source-name',
        '.title-text'
    ],
    studioTitle: [
        '.artifact-title',
        '.title',
        'h3',
        '.note-title'
    ],
    activeNoteTitle: [
        'input[aria-label="note title editable"]',
        '.note-header__editable-title',
        'textarea[aria-label="Title"]',
        'input[aria-label="Title"]',
        '.title-input',
        '[contenteditable="true"][class*="title"]'
    ],
    activeNoteBody: [
        '.ql-editor',
        '.ProseMirror',
        '[contenteditable="true"]',
        '.note-body',
        'textarea[placeholder*="Write"]',
        '.editor-content'
    ],
    // Additional selectors for landmark detection
    sourcePanel: [
        '.source-panel',
        'section[class*="source"]',
        '[data-panel="source"]'
    ],
    studioPanel: [
        '.studio-panel',
        'section[class*="studio"]',
        '[data-panel="studio"]'
    ],
    chatPanel: [
        '.chat-panel',
        'section[class*="chat"]',
        '[data-panel="chat"]'
    ],
    generatorBox: [
        '.create-artifact-buttons-container',
        'studio-panel .actions-container',
        '.artifact-generators'
    ]
};

let activeSelectors = JSON.parse(JSON.stringify(DEFAULT_SELECTORS));

// --- STATE ---
const DEFAULT_STATE = {
    source: { folders: {}, mappings: {}, pinned: [], tasks: [], taskSections: {} },
    studio: { folders: {}, mappings: {}, pinned: [] },
    settings: {
        showGenerators: true,
        showResearch: true,
        focusMode: false,
        tasksOpen: true,
        completedOpen: false,
        autoCollapseGuide: true
    }
};

let appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
let currentNotebookId = null;
let searchIndex = {};
let searchIndexAccessTimes = {}; // LRU tracking for search index eviction
let urlCheckInterval = null;
let mainObserver = null;
let healthCheckInterval = null;
let lastHealthStatus = null;
let isProcessingItems = false; // Race condition guard for processItems

/** @type {{ type: 'item'|'folder', context: string, id: string } | null} */
let currentDragData = null;
let isDragging = false;
let dragHandleClicked = false;
let globalDragMouseupBound = false;

/** @type {null | { mode: 'pending'|'active', row: Element, text: string, context: string, startX: number, startY: number, pointerId: number, ghost?: HTMLElement, lastX: number, lastY: number }} */
let nativePointerSession = null;
let nativePointerDragSafetyInstalled = false;
let nativePointerHighlightRaf = null;

// --- GRACEFUL DEGRADATION SYSTEM ---
const featureStatus = {
    folderOrganization: { enabled: true, failures: 0, notified: false },
    taskManagement: { enabled: true, failures: 0, notified: false },
    searchIndexing: { enabled: true, failures: 0, notified: false },
    pinning: { enabled: true, failures: 0, notified: false },
    treeRendering: { enabled: true, failures: 0, notified: false }
};

/**
 * Wraps a feature function with graceful degradation.
 * If a feature fails repeatedly, it gets disabled instead of crashing the extension.
 * @param {string} featureName - Key in featureStatus object
 * @param {Function} fn - Function to execute
 * @param {boolean} silent - If true, don't show toast on disable
 * @returns {*} Return value of fn, or undefined if feature is disabled/failed
 */
function runWithGracefulDegradation(featureName, fn, silent = false) {
    const status = featureStatus[featureName];
    if (!status) {
        // Unknown feature, just run it
        try { return fn(); } catch (e) { console.debug('[NotebookLM Tree] Unknown feature error:', e.message); }
        return;
    }
    
    if (!status.enabled) {
        return; // Feature is disabled, skip silently
    }
    
    try {
        const result = fn();
        // Reset failures on success
        if (status.failures > 0) {
            status.failures = 0;
        }
        return result;
    } catch (e) {
        status.failures++;
        console.warn(`[NotebookLM Tree] ${featureName} error (${status.failures}/${MAX_FEATURE_FAILURES}):`, e.message);
        
        if (status.failures >= MAX_FEATURE_FAILURES) {
            status.enabled = false;
            console.error(`[NotebookLM Tree] ${featureName} disabled due to repeated failures`);
            
            if (!silent && !status.notified) {
                status.notified = true;
                setTimeout(() => {
                    showToast(`${formatFeatureName(featureName)} temporarily unavailable`);
                }, 100);
            }
        }
    }
}

/**
 * Formats feature name for user display
 */
function formatFeatureName(featureName) {
    const names = {
        folderOrganization: 'Folder organization',
        taskManagement: 'Task management',
        searchIndexing: 'Search indexing',
        pinning: 'Pinning',
        treeRendering: 'Tree view'
    };
    return names[featureName] || featureName;
}

/**
 * Checks if a feature is currently enabled
 */
function isFeatureEnabled(featureName) {
    const status = featureStatus[featureName];
    return status ? status.enabled : true;
}

/**
 * Manually reset a feature to try again
 */
function resetFeature(featureName) {
    const status = featureStatus[featureName];
    if (status) {
        status.enabled = true;
        status.failures = 0;
        status.notified = false;
    }
}

/**
 * Reset all features
 */
function resetAllFeatures() {
    Object.keys(featureStatus).forEach(resetFeature);
}

// --- UTILITY: DEBOUNCE ---
function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, delay);
    };
}

// Create debounced versions of frequently-called functions
const debouncedRunOrganizer = debounce(() => safeRunOrganizer(), DEBOUNCE_ORGANIZER_MS);
const debouncedIndexNote = debounce(() => safeDetectAndIndexActiveNote(), DEBOUNCE_INDEX_MS);

// --- CUSTOM MODAL SYSTEM ---
function showConfirmModal(message, onConfirm, onCancel) {
    // Remove any existing modal
    const existing = document.getElementById('plugin-confirm-modal');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.id = 'plugin-confirm-modal';
    overlay.className = 'plugin-modal-overlay';
    overlay.innerHTML = `
        <div class="plugin-modal-content">
            <div class="plugin-modal-message">${message}</div>
            <div class="plugin-modal-buttons">
                <button class="plugin-modal-btn cancel">Cancel</button>
                <button class="plugin-modal-btn confirm">Confirm</button>
            </div>
        </div>
    `;
    
    const closeModal = () => overlay.remove();
    
    overlay.querySelector('.plugin-modal-btn.cancel').onclick = () => {
        closeModal();
        if (onCancel) onCancel();
    };
    
    overlay.querySelector('.plugin-modal-btn.confirm').onclick = () => {
        closeModal();
        if (onConfirm) onConfirm();
    };
    
    // Close on overlay click (not content)
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            closeModal();
            if (onCancel) onCancel();
        }
    };
    
    // Close on Escape key
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            if (onCancel) onCancel();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
    
    document.body.appendChild(overlay);
    overlay.querySelector('.plugin-modal-btn.confirm').focus();
}

function showTaskEditModal(task, onSave) {
    const existing = document.getElementById('plugin-confirm-modal');
    if (existing) existing.remove();
    
    const sections = appState.source.taskSections || {};
    const sortedSections = Object.values(sections).sort((a, b) => (a.order || 0) - (b.order || 0));
    let sectionOptionsHtml = '<option value="">No Section</option>';
    sortedSections.forEach(s => {
        const selected = task.sectionId === s.id ? 'selected' : '';
        sectionOptionsHtml += `<option value="${s.id}" ${selected}>${s.name}</option>`;
    });
    
    const sourceHtml = task.sourceNote 
        ? `<div class="plugin-edit-field">
               <label>Source</label>
               <input type="text" class="edit-task-source" value="${task.sourceNote}" readonly />
           </div>`
        : '';
    
    const overlay = document.createElement('div');
    overlay.id = 'plugin-confirm-modal';
    overlay.className = 'plugin-modal-overlay';
    overlay.innerHTML = `
        <div class="plugin-modal-content plugin-edit-modal">
            <div class="plugin-modal-title">Edit Task</div>
            <div class="plugin-edit-field">
                <label>Task</label>
                <input type="text" class="edit-task-text" value="${task.text.replace(/"/g, '&quot;')}" />
            </div>
            <div class="plugin-edit-field">
                <label>Description <span class="optional-label">(optional)</span></label>
                <textarea class="edit-task-description" placeholder="Add details..." rows="3">${task.description || ''}</textarea>
            </div>
            ${sourceHtml}
            <div class="plugin-edit-field">
                <label>Due Date</label>
                <div class="plugin-edit-date-row">
                    <input type="date" class="edit-task-date" value="${task.date || ''}" />
                    <button class="quick-date-btn" data-days="0">Today</button>
                    <button class="quick-date-btn" data-days="1">Tomorrow</button>
                    <button class="quick-date-btn clear-date">Clear</button>
                </div>
            </div>
            <div class="plugin-edit-field">
                <label>Section</label>
                <select class="edit-task-section">${sectionOptionsHtml}</select>
            </div>
            <div class="plugin-modal-buttons">
                <button class="plugin-modal-btn cancel">Cancel</button>
                <button class="plugin-modal-btn confirm">Save</button>
            </div>
        </div>
    `;
    
    const closeModal = () => overlay.remove();
    const textInput = overlay.querySelector('.edit-task-text');
    const descInput = overlay.querySelector('.edit-task-description');
    const dateInput = overlay.querySelector('.edit-task-date');
    const sectionSelect = overlay.querySelector('.edit-task-section');
    
    // Quick date buttons
    overlay.querySelectorAll('.quick-date-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            if (btn.classList.contains('clear-date')) {
                dateInput.value = '';
            } else {
                const days = parseInt(btn.dataset.days, 10);
                const date = new Date();
                date.setDate(date.getDate() + days);
                dateInput.value = date.toISOString().split('T')[0];
            }
        };
    });
    
    overlay.querySelector('.plugin-modal-btn.cancel').onclick = closeModal;
    
    overlay.querySelector('.plugin-modal-btn.confirm').onclick = () => {
        const newText = textInput.value.trim();
        if (newText) {
            onSave({
                text: newText,
                description: descInput.value.trim(),
                date: dateInput.value,
                sectionId: sectionSelect.value || null
            });
        }
        closeModal();
    };
    
    overlay.onclick = (e) => {
        if (e.target === overlay) closeModal();
    };
    
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
    
    document.body.appendChild(overlay);
    textInput.focus();
    textInput.select();
}

function showTaskCreateModal(preSelectedSectionId = null) {
    const existing = document.getElementById('plugin-confirm-modal');
    if (existing) existing.remove();
    
    const sections = appState.source.taskSections || {};
    const sortedSections = Object.values(sections).sort((a, b) => (a.order || 0) - (b.order || 0));
    let sectionOptionsHtml = '<option value="">No Section</option>';
    sortedSections.forEach(s => {
        const selected = preSelectedSectionId === s.id ? 'selected' : '';
        sectionOptionsHtml += `<option value="${s.id}" ${selected}>${s.name}</option>`;
    });
    
    const overlay = document.createElement('div');
    overlay.id = 'plugin-confirm-modal';
    overlay.className = 'plugin-modal-overlay';
    overlay.innerHTML = `
        <div class="plugin-modal-content plugin-edit-modal">
            <div class="plugin-modal-title">New Task</div>
            <div class="plugin-edit-field">
                <label>Task</label>
                <input type="text" class="edit-task-text" placeholder="Enter task..." />
            </div>
            <div class="plugin-edit-field">
                <label>Description <span class="optional-label">(optional)</span></label>
                <textarea class="edit-task-description" placeholder="Add details..." rows="3"></textarea>
            </div>
            <div class="plugin-edit-field plugin-source-field" style="display:none;">
                <label>Source</label>
                <input type="text" class="edit-task-source" readonly />
            </div>
            <div class="plugin-edit-field">
                <label>Due Date</label>
                <div class="plugin-edit-date-row">
                    <input type="date" class="edit-task-date" />
                    <button class="quick-date-btn" data-days="0">Today</button>
                    <button class="quick-date-btn" data-days="1">Tomorrow</button>
                    <button class="quick-date-btn clear-date">Clear</button>
                </div>
            </div>
            <div class="plugin-edit-field">
                <label>Section</label>
                <select class="edit-task-section">${sectionOptionsHtml}</select>
            </div>
            <div class="plugin-modal-buttons">
                <button class="plugin-modal-btn cancel">Cancel</button>
                <button class="plugin-modal-btn confirm">Create</button>
            </div>
        </div>
    `;
    
    const closeModal = () => overlay.remove();
    const textInput = overlay.querySelector('.edit-task-text');
    const descInput = overlay.querySelector('.edit-task-description');
    const sourceInput = overlay.querySelector('.edit-task-source');
    const sourceField = overlay.querySelector('.plugin-source-field');
    const dateInput = overlay.querySelector('.edit-task-date');
    const sectionSelect = overlay.querySelector('.edit-task-section');
    
    // Quick date buttons
    overlay.querySelectorAll('.quick-date-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            if (btn.classList.contains('clear-date')) {
                dateInput.value = '';
            } else {
                const days = parseInt(btn.dataset.days, 10);
                const date = new Date();
                date.setDate(date.getDate() + days);
                dateInput.value = date.toISOString().split('T')[0];
            }
        };
    });
    
    overlay.querySelector('.plugin-modal-btn.cancel').onclick = closeModal;
    
    overlay.querySelector('.plugin-modal-btn.confirm').onclick = () => {
        const newText = textInput.value.trim();
        if (newText) {
            addTask({
                text: newText,
                description: descInput.value.trim() || '',
                sourceNote: sourceInput.value || '',
                done: false,
                prio: 0,
                date: dateInput.value || '',
                sectionId: sectionSelect.value || null
            });
        }
        closeModal();
    };
    
    // Allow Enter key to submit (but not in textarea)
    textInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            overlay.querySelector('.plugin-modal-btn.confirm').click();
        }
    };
    
    overlay.onclick = (e) => {
        if (e.target === overlay) closeModal();
    };
    
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
    
    document.body.appendChild(overlay);
    textInput.focus();
    
    // Return references for external population (used by floating button)
    return { textInput, descInput, sourceInput, sourceField };
}

function showTaskCreateModalWithSelection(selectedText, noteTitle) {
    const refs = showTaskCreateModal();
    if (refs) {
        // Set title to first ~50 chars of selection
        const truncatedTitle = selectedText.length > 50 
            ? selectedText.substring(0, 50).trim() + '...'
            : selectedText;
        refs.textInput.value = truncatedTitle;
        refs.descInput.value = selectedText;
        if (noteTitle) {
            refs.sourceInput.value = noteTitle;
            refs.sourceField.style.display = 'block';
        }
    }
}

function showTaskDescriptionModal(task, taskIndex, allTasks) {
    const existing = document.getElementById('plugin-confirm-modal');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.id = 'plugin-confirm-modal';
    overlay.className = 'plugin-modal-overlay';
    
    const sourceHtml = task.sourceNote 
        ? `<div class="plugin-desc-source"><span class="source-icon">${ICONS.description}</span> ${task.sourceNote}</div>`
        : '';
    
    overlay.innerHTML = `
        <div class="plugin-modal-content plugin-desc-modal">
            <div class="plugin-modal-title">${task.text}</div>
            ${sourceHtml}
            <div class="plugin-edit-field">
                <label>Description</label>
                <textarea class="edit-task-description" placeholder="Add details..." rows="5">${task.description || ''}</textarea>
            </div>
            <div class="plugin-modal-buttons">
                <button class="plugin-modal-btn cancel">Cancel</button>
                <button class="plugin-modal-btn confirm">Save</button>
            </div>
        </div>
    `;
    
    const closeModal = () => overlay.remove();
    const descInput = overlay.querySelector('.edit-task-description');
    
    overlay.querySelector('.plugin-modal-btn.cancel').onclick = closeModal;
    
    overlay.querySelector('.plugin-modal-btn.confirm').onclick = () => {
        allTasks[taskIndex].description = descInput.value.trim();
        saveState();
        renderTasks();
        closeModal();
    };
    
    overlay.onclick = (e) => {
        if (e.target === overlay) closeModal();
    };
    
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
    
    document.body.appendChild(overlay);
    descInput.focus();
}

// --- UTILITY: SAFE QUERY HELPERS ---
function safeQuery(parent, selector) {
    try {
        if (!parent) return null;
        if (Array.isArray(selector)) {
            for (const sel of selector) {
                const el = parent.querySelector(sel);
                if (el) return el;
            }
            return null;
        }
        return parent.querySelector(selector);
    } catch (e) {
        console.debug('[NotebookLM Tree] Query failed:', selector, e.message);
        return null;
    }
}

function safeQueryAll(parent, selector) {
    try {
        if (!parent) return [];
        if (Array.isArray(selector)) {
            for (const sel of selector) {
                const els = parent.querySelectorAll(sel);
                if (els.length > 0) return els;
            }
            return [];
        }
        return parent.querySelectorAll(selector) || [];
    } catch (e) {
        console.debug('[NotebookLM Tree] QueryAll failed:', selector, e.message);
        return [];
    }
}

function safeGetText(element) {
    try {
        if (!element) return '';
        return (element.innerText || element.textContent || element.value || '').trim();
    } catch (e) {
        return '';
    }
}

function safeHasClass(element, className) {
    try {
        return element?.classList?.contains(className) ?? false;
    } catch (e) {
        return false;
    }
}

function safeClick(element) {
    try {
        if (!element) return false;
        element.click();
        return true;
    } catch (e) {
        console.debug('[NotebookLM Tree] Click failed:', e.message);
        return false;
    }
}

// --- ICONS ---
const ICONS = {
    folder: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="#8ab4f8"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Z"/></svg>',
    newFolder: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M560-320h80v-80h80v-80h-80v-80h-80v80h-80v80h80v80ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z"/></svg>',
    restart: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v240H560v-80h135q-31-40-74.5-65T540-730q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>',
    tune: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M440-120v-240h80v80h320v80H520v80h-80Zm-320-80v-80h240v80H120Zm160-200v-80H120v-80h160v-80h80v240h-80Zm160-80v-80h400v80H440Zm160-200v-240h80v80h160v80H680v80h-80Zm-480-80v-80h400v80H120Z"/></svg>',
    search: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/></svg>',
    up: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/></svg>',
    down: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"/></svg>',
    edit: '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 17l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/></svg>',
    add: '<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/></svg>',
    close: '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>',
    move: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Zm440-80v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80Z"/></svg>',
    palette: '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 18-.5 35.5T878-410q-6 83-63.5 146.5T670-200h-30q-17 0-28.5 11.5T600-160v40q0 17-11.5 28.5T560-80h-80Zm-220-400q17 0 28.5-11.5T300-520q0-17-11.5-28.5T260-560q-17 0-28.5 11.5T220-520q0 17 11.5 28.5T260-480Zm120-160q17 0 28.5-11.5T420-680q0-17-11.5-28.5T380-720q-17 0-28.5 11.5T340-680q0 17 11.5 28.5T380-640Zm200 0q17 0 28.5-11.5T620-680q0-17-11.5-28.5T580-720q-17 0-28.5 11.5T540-680q0 17 11.5 28.5T580-640Zm120 160q17 0 28.5-11.5T740-520q0-17-11.5-28.5T700-560q-17 0-28.5 11.5T660-520q0 17 11.5 28.5T700-480Z"/></svg>',
    keep: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Zm-286 80h252l-46-46v-314H400v314l-46 46Zm126 0Z"/></svg>',
    keepFilled: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M640-480 400-720v-200h280v80h-40v280l80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-20l240 240h80Z"/></svg>',
    eject: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h280v80H200Zm440-160-55-58 102-102H360v-80h327L585-622l55-58 200 200-200 200Z"/></svg>',
    export: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>',
    import: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M440-320v-326L336-542l-56-58 200-200 200 200-56 58-104-104v326h-80ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>',
    expandAll: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M480-120 300-300l58-58 122 122 122-122 58 58-180 180ZM358-598l-58-58 180-180 180 180-58 58-122-122-122 122Z"/></svg>',
    collapseAll: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="m356-160-56-56 180-180 180 180-56 56-124-124-124 124Zm124-404L300-744l56-56 124 124 124-124 56 56-180 180Z"/></svg>',
    refresh: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v240H560v-80h135q-31-40-74.5-65T540-730q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>',
    focus: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M272-160q-30 0-51-21t-21-51q0-21 12-39.5t32-26.5l156-62v-90q-54 63-125.5 96.5T120-320v-80q68 0 123.5-28T344-508l54-64q12-14 28-21t34-7h40q18 0 34 7t28 21l54 64q45 52 100.5 80T840-400v80q-83 0-154.5-33.5T560-450v90l156 62q20 8 32 26.5t12 39.5q0 30-21 51t-51 21H400v-20q0-26 17-43t43-17h120q9 0 14.5-5.5T600-260q0-9-5.5-14.5T580-280H460q-42 0-71 29t-29 71v20h-88Zm208-480q-33 0-56.5-23.5T400-720q0-33 23.5-56.5T480-800q33 0 56.5 23.5T560-720q0 33-23.5 56.5T480-640Z"/></svg>',
    check: '<svg xmlns="http://www.w3.org/2000/svg" height="12px" viewBox="0 -960 960 960" width="12px" fill="white"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>',
    sort: '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 0 24 24" width="14px" fill="currentColor"><path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/></svg>',
    trash: '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>',
    smallUp: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>',
    smallDown: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>',
    flag: '<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Zm300-440Zm86 160h134v-240H510l-16-80H280v240h290l16 80Z"/></svg>',
    calendar: '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Zm0 0v-80 80Z"/></svg>',
    chevron: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>',
    warning: '<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="m40-120 440-760 440 760H40Zm138-80h604L480-720 178-200Zm302-40q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm-40-120h80v-200h-80v200Zm40-100Z"/></svg>',
    
    moveItem: '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M806-440H320v-80h486l-62-62 56-58 160 160-160 160-56-58 62-62ZM600-600v-160H200v560h400v-160h80v160q0 33-23.5 56.5T600-120H200q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h400q33 0 56.5 23.5T680-760v160h-80Z"/></svg>',
    moreHoriz: '<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M240-400q-33 0-56.5-23.5T160-480q0-33 23.5-56.5T240-560q33 0 56.5 23.5T320-480q0 33-23.5 56.5T240-400Zm240 0q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm240 0q-33 0-56.5-23.5T640-480q0-33 23.5-56.5T720-560q33 0 56.5 23.5T800-480q0 33-23.5 56.5T720-400Z"/></svg>',
    description: '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"/></svg>',
    addTask: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm-40-360H280v80h160v160h80v-160h160v-80H520v-160h-80v160Z"/></svg>',
    link: '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M440-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h160v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35h160v80ZM320-440v-80h320v80H320Zm200 160v-80h160q50 0 85-35t35-85q0-50-35-85t-85-35H520v-80h160q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H520Z"/></svg>',
    cancel: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="m336-280 144-144 144 144 56-56-144-144 144-144-56-56-144 144-144-144-56 56 144 144-144 144 56 56ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>',
    sortDate: '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Zm0 0v-80 80Zm280 240q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-160 0q-17 0-28.5-11.5T280-440q0-17 11.5-28.5T320-480q17 0 28.5 11.5T360-440q0 17-11.5 28.5T320-400Zm320 0q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-160 0q-17 0-28.5-11.5T280-280q0-17 11.5-28.5T320-320q17 0 28.5 11.5T360-280q0 17-11.5 28.5T320-240Zm320 0q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240Z"/></svg>',
    deleteForever: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM376-280l104-104 104 104 56-56-104-104 104-104-56-56-104 104-104-104-56 56 104 104-104 104 56 56ZM280-720v520-520Z"/></svg>',
    
    // NEW ICONS FOR V17.3
    selectAll: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M260-160q-42 0-71-29t-29-71v-440q0-42 29-71t71-29h440q42 0 71 29t29 71v440q0 42-29 71t-71 29H260Zm0-80h440v-440H260v440Zm178-106 208-208-56-57-152 152-82-82-56 57 138 138ZM260-700v440-440Z"/></svg>',
    checkOn: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#1a73e8"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>',
    checkOff: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#5f6368"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Z"/></svg>',
    checkIndet: '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#5f6368"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm120-240v-80h320v80H320Z"/></svg>',
    
    // V17.9 - Pop-out window
    newWindow: '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h240v80H200v560h560v-240h80v240q0 33-23.5 56.5T760-120H200Zm440-400v-120H520v-80h120v-120h80v120h120v80H720v120h-80Z"/></svg>'
};

// --- NOTEBOOK ID EXTRACTION ---
function getNotebookId() {
    try {
        const match = window.location.pathname.match(/\/notebook\/([^\/\?]+)/);
        return match ? match[1] : null;
    } catch (e) {
        console.debug('[NotebookLM Tree] Failed to get notebook ID:', e.message);
        return null;
    }
}

function getStorageKey(base) {
    const notebookId = getNotebookId();
    if (!notebookId) return null;
    return `${base}_${notebookId}`;
}

// --- CLEANUP FUNCTION ---
function cleanup() {
    try {
        if (mainObserver) {
            mainObserver.disconnect();
            mainObserver = null;
            console.debug('[NotebookLM Tree] Observer disconnected');
        }
        if (healthCheckInterval) {
            clearInterval(healthCheckInterval);
            healthCheckInterval = null;
        }
    } catch (e) {
        console.debug('[NotebookLM Tree] Cleanup error:', e.message);
    }
}

// --- SELECTOR HEALTH MONITORING ---
function checkSelectorHealth() {
    try {
        const health = {};
        const criticalSelectors = ['sourceRow', 'studioRow', 'sourceTitle', 'studioTitle'];
        
        for (const key of criticalSelectors) {
            const selector = activeSelectors[key];
            const found = safeQuery(document, selector);
            health[key] = !!found;
        }
        
        const failures = Object.entries(health).filter(([_, v]) => !v);
        const failureCount = failures.length;
        
        // Only log/warn if status changed
        const statusKey = JSON.stringify(health);
        if (statusKey !== lastHealthStatus) {
            lastHealthStatus = statusKey;
            
            if (failureCount >= SELECTOR_FAILURE_THRESHOLD) {
                console.warn('[NotebookLM Tree] Multiple selectors failing:', failures.map(f => f[0]).join(', '));
            } else if (failureCount > 0) {
                console.debug('[NotebookLM Tree] Some selectors not finding elements:', failures.map(f => f[0]).join(', '));
            }
        }
        
        return health;
    } catch (e) {
        console.debug('[NotebookLM Tree] Health check error:', e.message);
        return {};
    }
}

// --- VERSION CHECK ---
function checkVersionSync() {
    try {
        const version = getExtensionVersion();
        console.debug('[NotebookLM Tree] Running version:', version);
    } catch (e) {
        // Not critical, ignore
    }
}

// --- INIT SEQUENCE ---
function init() {
    try {
        cleanup();
        checkVersionSync();
        resetAllFeatures(); // Reset feature status on init
        
        currentNotebookId = getNotebookId();
        if (!currentNotebookId) {
            startUrlWatcher();
            return;
        }
        
        const stateKey = getStorageKey('notebookTreeState');
        const indexKey = getStorageKey('notebookSearchIndex');
        
        // V17.5: Local-only storage with migration from sync
        // First check if there's legacy data in sync storage to migrate
        chrome.storage.sync.get([stateKey], (syncResult) => {
            const hasSyncData = !chrome.runtime.lastError && syncResult[stateKey] && syncResult[stateKey].source;
            
            chrome.storage.local.get([stateKey, indexKey], (localResult) => {
                // Migration: If sync has data but local doesn't, migrate it
                if (hasSyncData && (!localResult[stateKey] || !localResult[stateKey].source)) {
                    console.debug('[NotebookLM Tree] Migrating data from sync to local storage');
                    appState = syncResult[stateKey];
                    // Clear sync storage after migration
                    chrome.storage.sync.remove(stateKey, () => {
                        if (!chrome.runtime.lastError) {
                            console.debug('[NotebookLM Tree] Sync data cleared after migration');
                        }
                    });
                } else if (localResult[stateKey] && localResult[stateKey].source) {
                    // Use local data (primary path)
                    appState = localResult[stateKey];
                    // Clean up any orphaned sync data
                    if (hasSyncData) {
                        chrome.storage.sync.remove(stateKey);
                    }
                } else {
                    // Fresh install - start with defaults
                    appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
                }
                
                // Ensure all required properties exist
                if (!appState.settings) appState.settings = { showGenerators: true, showResearch: true, focusMode: false, tasksOpen: true, completedOpen: false, autoCollapseGuide: true };
                if (appState.settings.autoCollapseGuide === undefined) appState.settings.autoCollapseGuide = true;
                if (!appState.source) appState.source = { folders: {}, mappings: {}, pinned: [], tasks: [] };
                if (!appState.studio) appState.studio = { folders: {}, mappings: {}, pinned: [] };
                if (!appState.source.pinned) appState.source.pinned = [];
                if (!appState.studio.pinned) appState.studio.pinned = [];
                if (!appState.source.tasks) appState.source.tasks = [];
                if (!appState.source.taskSections) appState.source.taskSections = {};

                // Load search index (always local)
                if (localResult[indexKey]) {
                    searchIndex = localResult[indexKey];
                } else {
                    searchIndex = {};
                }
                
                // Save migrated/initialized state to local
                chrome.storage.local.set({ [stateKey]: appState });

                fetchRemoteConfigWithCache().then(() => {
                    startApp();
                }).catch(() => {
                    startApp();
                });
            });
        });
        startUrlWatcher();
    } catch (e) {
        console.error('[NotebookLM Tree] Init failed:', e);
        startApp();
    }
}

// --- REMOTE CONFIG WITH CACHING ---
async function fetchRemoteConfigWithCache() {
    const CACHE_KEY = 'remoteConfigCache';
    try {
        const cached = await new Promise(resolve => {
            chrome.storage.local.get([CACHE_KEY], result => resolve(result[CACHE_KEY]));
        });
        
        if (cached && cached.data && (Date.now() - cached.timestamp < CONFIG_CACHE_TTL_MS)) {
            activeSelectors = { ...DEFAULT_SELECTORS, ...cached.data };
            console.debug('[NotebookLM Tree] Using cached config');
            return;
        }
        
        if (!REMOTE_CONFIG_URL) return;
        
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { action: "fetchConfig", url: REMOTE_CONFIG_URL },
                (r) => {
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else if (r && r.success && r.data) resolve(r.data);
                    else reject(new Error(r?.error || 'Unknown error'));
                }
            );
        });
        
        activeSelectors = { ...DEFAULT_SELECTORS, ...response };
        chrome.storage.local.set({ [CACHE_KEY]: { data: response, timestamp: Date.now() } });
        console.debug('[NotebookLM Tree] Remote config loaded and cached');
    } catch (e) {
        console.debug('[NotebookLM Tree] Config fetch failed, using defaults:', e.message);
    }
}

function startUrlWatcher() {
    if (urlCheckInterval) return;
    urlCheckInterval = setInterval(() => {
        try {
            const newNotebookId = getNotebookId();
            if (newNotebookId && newNotebookId !== currentNotebookId) {
                cleanup();
                location.reload();
            } else if (newNotebookId && !currentNotebookId) {
                currentNotebookId = newNotebookId;
                init();
            }
        } catch (e) {
            console.debug('[NotebookLM Tree] URL watcher error:', e.message);
        }
    }, URL_CHECK_INTERVAL_MS);
}

function startApp() {
    try {
        if (!globalDragMouseupBound) {
            globalDragMouseupBound = true;
            document.addEventListener('mouseup', () => { dragHandleClicked = false; });
        }
        if (!nativePointerDragSafetyInstalled) {
            nativePointerDragSafetyInstalled = true;
            window.addEventListener('blur', () => endNativePointerDragSession(false));
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') endNativePointerDragSession(false);
            });
        }
        startObserver();
        setTimeout(safeRunOrganizer, INIT_DELAY_MS);
        healthCheckInterval = setInterval(checkSelectorHealth, HEALTH_CHECK_INTERVAL_MS);
        document.addEventListener('click', (e) => {
            try {
                const toggleBtn = e.target.closest('.toggle-studio-panel-button');
                if (toggleBtn && appState.settings.focusMode) {
                    appState.settings.focusMode = false;
                    saveState();
                    applyFocusMode();
                }
            } catch (err) { }
        });
    } catch (e) {
        console.error('[NotebookLM Tree] startApp failed:', e);
    }
}

function saveState() {
    try {
        const stateKey = getStorageKey('notebookTreeState');
        if (!stateKey) return;
        
        // V17.5: Local-only storage (no sync limits to worry about)
        chrome.storage.local.set({ [stateKey]: appState }, () => {
            if (chrome.runtime.lastError) {
                console.error('[NotebookLM Tree] Save failed:', chrome.runtime.lastError.message);
            }
        });
    } catch (e) {
        console.error('[NotebookLM Tree] Save state failed:', e);
    }
}


// --- [NEW] SOURCE TOGGLE FUNCTIONS ---

/**
 * Robustly toggles the global "Select all sources" checkbox.
 */
function toggleAllSources() {
    try {
        // 1. Target the specific "Select all" input defined by NotebookLM
        const selectAllInput = document.querySelector('input[aria-label="Select all sources"]');
        
        if (selectAllInput) {
            // Click the native master toggle
            selectAllInput.click();
            showToast("Toggled all sources");
        } else {
            // Fallback: If master toggle isn't found, try to toggle visible rows manually
            const sourceRowSelector = Array.isArray(activeSelectors.sourceRow) ? activeSelectors.sourceRow.join(',') : activeSelectors.sourceRow;
            const inputs = document.querySelectorAll(`${sourceRowSelector} mat-checkbox input`);
            if (inputs.length === 0) return showToast("No sources found");
            
            // Heuristic: If ANY are unchecked, check all. Else uncheck all.
            const anyUnchecked = Array.from(inputs).some(i => !i.checked && i.getAttribute('aria-checked') !== 'true');
            let count = 0;
            inputs.forEach(input => {
                const isChecked = input.checked || input.getAttribute('aria-checked') === 'true';
                if (anyUnchecked !== isChecked) {
                    input.click();
                    count++;
                }
            });
            showToast(anyUnchecked ? "Selected all visible" : "Deselected all visible");
        }
    } catch (e) {
        console.error('[NotebookLM Tree] Toggle global error:', e);
    }
}

/**
 * Toggles all items contained within a specific folder.
 */
function toggleFolderItems(folderId, context) {
    try {
        const folderContent = document.getElementById(`folder-content-${folderId}`);
        if (!folderContent) return;

        const proxies = folderContent.querySelectorAll('.plugin-proxy-item');
        if (proxies.length === 0) return;

        const targets = [];
        const sourceSelector = Array.isArray(activeSelectors.sourceRow) ? activeSelectors.sourceRow : [activeSelectors.sourceRow];
        const nativeRows = safeQueryAll(document, sourceSelector);

        proxies.forEach(p => {
            const title = p.dataset.ref;
            for (const row of nativeRows) {
                 const titleEl = safeQuery(row, activeSelectors.sourceTitle);
                 if (titleEl && safeGetText(titleEl) === title) {
                     const matCheckbox = row.querySelector('mat-checkbox');
                     const input = row.querySelector('mat-checkbox input');
                     if (matCheckbox && input) {
                         targets.push({ matCheckbox, input });
                     }
                     break;
                 }
            }
        });

        const anyUnchecked = targets.some(t => !t.input.checked && t.input.getAttribute('aria-checked') !== 'true');

        targets.forEach(t => {
            const isChecked = t.input.checked || t.input.getAttribute('aria-checked') === 'true';
            if (isChecked !== anyUnchecked) {
                const clickEvent = new MouseEvent('click', { view: window, bubbles: true, cancelable: true });
                t.matCheckbox.dispatchEvent(clickEvent);
            }
        });

    } catch (e) {
        console.debug('[NotebookLM Tree] Toggle folder error:', e);
    }
}

// --- STANDARD FUNCTIONS (Task, Indexing, etc) ---

function toggleFocusMode() {
    appState.settings.focusMode = !appState.settings.focusMode;
    saveState();
    applyFocusMode();
}

function applyFocusMode() {
    try {
        const isFocus = appState.settings.focusMode;
        const btn = document.querySelector('.plugin-btn.toggle-focus');
        if (isFocus) {
            document.body.classList.add('plugin-focus-mode');
            if (btn) { btn.classList.remove('toggle-off'); btn.title = "Exit Zen Mode"; }
        } else {
            document.body.classList.remove('plugin-focus-mode');
            if (btn) { btn.classList.add('toggle-off'); btn.title = "Enter Zen Mode"; }
            const panels = document.querySelectorAll('.studio-panel, .chat-panel, .source-panel, section');
            panels.forEach(p => {
                if (p && (p.style.width || p.style.flex || p.style.inlineSize)) {
                    p.style.width = '';
                    p.style.flex = '';
                    p.style.minWidth = '';
                    p.style.maxWidth = '';
                    p.style.inlineSize = '';
                }
            });
        }
    } catch (e) {
        console.debug('[NotebookLM Tree] Apply focus mode error:', e.message);
    }
}

function renderTasks() {
    if (!isFeatureEnabled('taskManagement')) return;
    
    runWithGracefulDegradation('taskManagement', () => {
        const mount = document.getElementById('plugin-task-list-mount');
        const headerCount = document.getElementById('plugin-task-count');
        if (!mount) return;
        mount.innerHTML = '';
        const tasks = appState.source.tasks || [];
        const sections = appState.source.taskSections || {};
        if (appState.settings.completedOpen === undefined) appState.settings.completedOpen = false;
        
        // Separate tasks by section and completion status
        const uncategorizedActive = [];
        const uncategorizedDone = [];
        const sectionedTasks = {}; // sectionId -> { active: [], done: [] }
        
        tasks.forEach((task, index) => {
            const item = { ...task, originalIndex: index };
            const sectionId = task.sectionId || null;
            
            if (task.done) {
                uncategorizedDone.push(item); // All completed go to main Completed section
            } else if (sectionId && sections[sectionId]) {
                if (!sectionedTasks[sectionId]) sectionedTasks[sectionId] = [];
                sectionedTasks[sectionId].push(item);
            } else {
                uncategorizedActive.push(item);
            }
        });
        
        const totalActive = tasks.filter(t => !t.done).length;
        if (headerCount) headerCount.innerText = totalActive > 0 ? `(${totalActive})` : '';

        if (tasks.length === 0 && Object.keys(sections).length === 0) {
            mount.innerHTML = '<div style="padding:12px; font-style:italic; color:var(--plugin-text-secondary); font-size:12px; text-align:center;">No tasks...</div>';
            return;
        }
        
        // Render uncategorized active tasks first
        uncategorizedActive.forEach(item => mount.appendChild(createTaskElement(item, item.originalIndex, tasks, false)));
        
        // Render custom sections
        const sortedSections = Object.values(sections).sort((a, b) => (a.order || 0) - (b.order || 0));
        sortedSections.forEach(section => {
            const sectionTasks = sectionedTasks[section.id] || [];
            const sectionEl = createTaskSectionElement(section, sectionTasks, tasks);
            mount.appendChild(sectionEl);
        });
        
        // Render completed section (all done tasks regardless of original section)
        if (uncategorizedDone.length > 0) {
            const completedGroup = document.createElement('div');
            completedGroup.className = 'plugin-completed-group';
            const isOpen = appState.settings.completedOpen;
            const arrowClass = isOpen ? 'arrow open' : 'arrow';
            completedGroup.innerHTML = `
                <div class="plugin-completed-header">
                    <div style="display:flex; align-items:center; gap:4px;"><span class="${arrowClass}">${ICONS.chevron}</span> Completed (${uncategorizedDone.length})</div>
                    <div class="plugin-header-btn clear-done-btn" title="Clear All Completed">${ICONS.deleteForever}</div>
                </div>
                <div class="plugin-completed-body" style="display:${isOpen ? 'block' : 'none'}"></div>
            `;
            const header = completedGroup.querySelector('.plugin-completed-header');
            if (header) {
                header.onclick = (e) => {
                    if (e.target.closest('.clear-done-btn')) return;
                    appState.settings.completedOpen = !appState.settings.completedOpen;
                    saveState();
                    renderTasks();
                };
            }
            const clearBtn = completedGroup.querySelector('.clear-done-btn');
            if (clearBtn) {
                clearBtn.onclick = (e) => {
                    e.stopPropagation();
                    showConfirmModal(`Remove ${uncategorizedDone.length} completed tasks?`, () => {
                        appState.source.tasks = appState.source.tasks.filter(t => !t.done);
                        saveState();
                        renderTasks();
                    });
                };
            }
            const body = completedGroup.querySelector('.plugin-completed-body');
            if (body) {
                uncategorizedDone.forEach(item => body.appendChild(createTaskElement(item, item.originalIndex, tasks, true)));
            }
            mount.appendChild(completedGroup);
        }
    });
}

function createTaskSectionElement(section, sectionTasks, allTasks) {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'plugin-task-section-group';
    sectionEl.dataset.sectionId = section.id;
    
    const isOpen = section.isOpen !== false; // Default to open
    const arrowClass = isOpen ? 'arrow open' : 'arrow';
    const colorStyle = section.color ? `border-left: 3px solid ${section.color};` : '';
    
    sectionEl.innerHTML = `
        <div class="plugin-task-section-header" style="${colorStyle}">
            <div style="display:flex; align-items:center; gap:4px;">
                <span class="${arrowClass}">${ICONS.chevron}</span>
                <span class="section-name">${section.name}</span>
                <span class="section-count">(${sectionTasks.length})</span>
            </div>
            <div class="plugin-section-actions">
                <span class="plugin-section-btn add-task" title="Add Task to Section">${ICONS.add}</span>
                <span class="plugin-section-btn move-up" title="Move Up">${ICONS.smallUp}</span>
                <span class="plugin-section-btn move-down" title="Move Down">${ICONS.smallDown}</span>
                <span class="plugin-section-btn color-pick" title="Color">${ICONS.palette}</span>
                <span class="plugin-section-btn rename" title="Rename">${ICONS.edit}</span>
                <span class="plugin-section-btn delete" title="Delete Section">${ICONS.close}</span>
            </div>
        </div>
        <div class="plugin-task-section-body" style="display:${isOpen ? 'block' : 'none'}"></div>
    `;
    
    const header = sectionEl.querySelector('.plugin-task-section-header');
    if (header) {
        header.onclick = (e) => {
            if (e.target.closest('.plugin-section-actions')) return;
            section.isOpen = !section.isOpen;
            saveState();
            renderTasks();
        };
    }
    
    // Section action handlers
    const addTaskBtn = sectionEl.querySelector('.plugin-section-btn.add-task');
    if (addTaskBtn) {
        addTaskBtn.onclick = (e) => {
            e.stopPropagation();
            showTaskCreateModal(section.id);
        };
    }
    
    const moveUpBtn = sectionEl.querySelector('.plugin-section-btn.move-up');
    if (moveUpBtn) {
        moveUpBtn.onclick = (e) => {
            e.stopPropagation();
            moveTaskSection(section.id, -1);
        };
    }
    
    const moveDownBtn = sectionEl.querySelector('.plugin-section-btn.move-down');
    if (moveDownBtn) {
        moveDownBtn.onclick = (e) => {
            e.stopPropagation();
            moveTaskSection(section.id, 1);
        };
    }
    
    const colorBtn = sectionEl.querySelector('.plugin-section-btn.color-pick');
    if (colorBtn) {
        colorBtn.onclick = (e) => {
            e.stopPropagation();
            const colors = [null, '#e8eaed', '#f28b82', '#fbbc04', '#34a853', '#4285f4', '#d93025'];
            const cur = section.color || null;
            const next = colors[(colors.indexOf(cur) + 1) % colors.length];
            section.color = next;
            saveState();
            renderTasks();
        };
    }
    
    const renameBtn = sectionEl.querySelector('.plugin-section-btn.rename');
    if (renameBtn) {
        renameBtn.onclick = (e) => {
            e.stopPropagation();
            const newName = prompt("Rename section:", section.name);
            if (newName && newName.trim()) {
                section.name = newName.trim();
                saveState();
                renderTasks();
            }
        };
    }
    
    const deleteBtn = sectionEl.querySelector('.plugin-section-btn.delete');
    if (deleteBtn) {
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            showConfirmModal(`Delete section "${section.name}"?<br><br>Tasks will be moved to uncategorized.`, () => {
                // Move tasks back to uncategorized
                appState.source.tasks.forEach(t => {
                    if (t.sectionId === section.id) t.sectionId = null;
                });
                delete appState.source.taskSections[section.id];
                saveState();
                renderTasks();
            });
        };
    }
    
    // Render tasks in this section
    const body = sectionEl.querySelector('.plugin-task-section-body');
    if (body) {
        sectionTasks.forEach(item => body.appendChild(createTaskElement(item, item.originalIndex, allTasks, false)));
    }
    
    return sectionEl;
}

function createTaskSection(name) {
    if (!appState.source.taskSections) appState.source.taskSections = {};
    const id = Math.random().toString(36).substr(2, 9);
    const count = Object.keys(appState.source.taskSections).length;
    appState.source.taskSections[id] = { 
        id, 
        name, 
        isOpen: true, 
        order: count,
        color: null
    };
    saveState();
    renderTasks();
}

function moveTaskSection(sectionId, direction) {
    const sections = Object.values(appState.source.taskSections || {});
    const target = appState.source.taskSections[sectionId];
    if (!target) return;
    
    sections.sort((a, b) => (a.order || 0) - (b.order || 0));
    sections.forEach((s, i) => s.order = i);
    
    const idx = sections.findIndex(s => s.id === sectionId);
    const newIdx = idx + direction;
    
    if (newIdx >= 0 && newIdx < sections.length) {
        const swap = sections[newIdx];
        [target.order, swap.order] = [swap.order, target.order];
        saveState();
        renderTasks();
    }
}

function showTaskMoveMenu(e, taskIndex) {
    try {
        document.querySelectorAll('.plugin-dropdown').forEach(el => el.remove());
        const menu = document.createElement('div');
        menu.className = 'plugin-dropdown';
        
        const task = appState.source.tasks[taskIndex];
        const sections = appState.source.taskSections || {};
        
        // Option to move to uncategorized (if currently in a section)
        if (task.sectionId) {
            const item = document.createElement('div');
            item.className = 'plugin-dropdown-item';
            item.innerHTML = `${ICONS.eject} Uncategorized`;
            item.onclick = (ev) => {
                ev.stopPropagation();
                task.sectionId = null;
                saveState();
                renderTasks();
                menu.remove();
            };
            menu.appendChild(item);
        }
        
        // List all sections
        const sortedSections = Object.values(sections).sort((a, b) => (a.order || 0) - (b.order || 0));
        if (sortedSections.length === 0 && !task.sectionId) {
            const empty = document.createElement('div');
            empty.className = 'plugin-dropdown-item';
            empty.style.fontStyle = 'italic';
            empty.innerText = "No sections created";
            menu.appendChild(empty);
        }
        
        sortedSections.forEach(section => {
            if (section.id === task.sectionId) return; // Skip current section
            const item = document.createElement('div');
            item.className = 'plugin-dropdown-item';
            const colorDot = section.color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${section.color};margin-right:6px;"></span>` : '';
            item.innerHTML = `${colorDot}${section.name}`;
            item.onclick = (ev) => {
                ev.stopPropagation();
                task.sectionId = section.id;
                saveState();
                renderTasks();
                menu.remove();
            };
            menu.appendChild(item);
        });
        
        document.body.appendChild(menu);
        const rect = e.target.getBoundingClientRect();
        menu.style.top = (rect.bottom + window.scrollY) + 'px';
        menu.style.left = rect.left + 'px';
        
        setTimeout(() => {
            const close = () => {
                menu.remove();
                document.removeEventListener('click', close);
            };
            document.addEventListener('click', close);
        }, DOM_SETTLE_DELAY_MS);
    } catch (e) {
        console.debug('[NotebookLM Tree] Show task move menu error:', e.message);
    }
}

function createTaskElement(task, realIndex, allTasks, isCompletedSection) {
    const div = document.createElement('div');
    div.className = `plugin-task-item ${task.done ? 'done' : ''} task-prio-${task.prio || 0}`;
    let dateHtml = '';
    if (task.date) {
        const isPast = new Date(task.date) < new Date().setHours(0, 0, 0, 0);
        const colorStyle = isPast && !task.done ? 'color:#d93025;' : '';
        dateHtml = `<div class="plugin-task-date" style="${colorStyle}">${ICONS.calendar} ${task.date}</div>`;
    }
    const moveActions = isCompletedSection ? '' : `
        <div class="plugin-task-btn move-section" title="Move to Section">${ICONS.moveItem}</div>
        <div class="plugin-task-btn up" title="Move Up">${ICONS.smallUp}</div>
        <div class="plugin-task-btn down" title="Move Down">${ICONS.smallDown}</div>
    `;
    
    // Description button - highlighted blue if has description
    const hasDesc = task.description && task.description.trim().length > 0;
    const descClass = hasDesc ? 'has-desc' : '';
    const descTooltip = hasDesc 
        ? task.description.substring(0, 100).replace(/"/g, '&quot;') + (task.description.length > 100 ? '...' : '')
        : 'Add description';
    
    // Link button - only shown if task has sourceNote
    const hasSource = task.sourceNote && task.sourceNote.trim().length > 0;
    const linkBtn = hasSource 
        ? `<div class="plugin-task-btn link has-link" title="Show in Studio: ${task.sourceNote.replace(/"/g, '&quot;')}">${ICONS.link}</div>`
        : '';
    
    div.innerHTML = `
        <div class="plugin-task-check">${task.done ? ICONS.check : ''}</div>
        <div class="plugin-task-content">
            <div class="plugin-task-text" title="${task.text}">${task.text}</div>
            ${dateHtml}
        </div>
        <div class="plugin-task-actions">
            ${linkBtn}
            <div class="plugin-task-btn desc ${descClass}" title="${descTooltip}">${ICONS.description}</div>
            <div class="plugin-task-btn prio" title="Priority (Red/Yel/Blu)">${ICONS.flag}</div>
            <div class="plugin-task-btn edit" title="Edit">${ICONS.edit}</div>
            ${moveActions}
            <div class="plugin-task-btn del" title="Delete">${ICONS.close}</div>
        </div>
    `;
    
    const checkEl = div.querySelector('.plugin-task-check');
    if (checkEl) {
        checkEl.onclick = (e) => {
            e.stopPropagation();
            allTasks[realIndex].done = !allTasks[realIndex].done;
            saveState();
            renderTasks();
        };
    }
    
    // Link button handler - filter Studio panel to show source note
    const linkBtnEl = div.querySelector('.plugin-task-btn.link');
    if (linkBtnEl && hasSource) {
        linkBtnEl.onclick = (e) => {
            e.stopPropagation();
            filterStudioToNote(task.sourceNote);
        };
    }
    
    const descBtn = div.querySelector('.plugin-task-btn.desc');
    if (descBtn) {
        descBtn.onclick = (e) => {
            e.stopPropagation();
            showTaskDescriptionModal(task, realIndex, allTasks);
        };
    }
    
    const prioBtn = div.querySelector('.plugin-task-btn.prio');
    if (prioBtn) {
        prioBtn.onclick = (e) => {
            e.stopPropagation();
            allTasks[realIndex].prio = ((allTasks[realIndex].prio || 0) + 1) % 4;
            saveState();
            renderTasks();
        };
    }
    
    const editBtn = div.querySelector('.plugin-task-btn.edit');
    if (editBtn) {
        editBtn.onclick = (e) => {
            e.stopPropagation();
            showTaskEditModal(task, (updated) => {
                allTasks[realIndex].text = updated.text;
                allTasks[realIndex].description = updated.description;
                allTasks[realIndex].date = updated.date;
                allTasks[realIndex].sectionId = updated.sectionId;
                saveState();
                renderTasks();
            });
        };
    }
    
    const moveSectionBtn = div.querySelector('.plugin-task-btn.move-section');
    if (moveSectionBtn) {
        moveSectionBtn.onclick = (e) => {
            e.stopPropagation();
            showTaskMoveMenu(e, realIndex);
        };
    }
    
    const delBtn = div.querySelector('.plugin-task-btn.del');
    if (delBtn) {
        delBtn.onclick = (e) => {
            e.stopPropagation();
            showConfirmModal("Delete task?", () => {
                allTasks.splice(realIndex, 1);
                saveState();
                renderTasks();
            });
        };
    }
    
    if (!isCompletedSection) {
        const upBtn = div.querySelector('.plugin-task-btn.up');
        if (upBtn) {
            upBtn.onclick = (e) => {
                e.stopPropagation();
                if (realIndex > 0) {
                    [allTasks[realIndex], allTasks[realIndex - 1]] = [allTasks[realIndex - 1], allTasks[realIndex]];
                    saveState();
                    renderTasks();
                }
            };
        }
        const downBtn = div.querySelector('.plugin-task-btn.down');
        if (downBtn) {
            downBtn.onclick = (e) => {
                e.stopPropagation();
                if (realIndex < allTasks.length - 1) {
                    [allTasks[realIndex], allTasks[realIndex + 1]] = [allTasks[realIndex + 1], allTasks[realIndex]];
                    saveState();
                    renderTasks();
                }
            };
        }
    }
    return div;
}

function addTask(taskObj) {
    if (!isFeatureEnabled('taskManagement')) return;
    
    if (!appState.source.tasks) appState.source.tasks = [];
    if (typeof taskObj === 'string') {
        appState.source.tasks.push({ text: taskObj, done: false, prio: 0, date: "" });
    } else {
        appState.source.tasks.push(taskObj);
    }
    saveState();
    renderTasks();
}

function normalizeKey(str) {
    if (!str) return "";
    return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    let longer = s1;
    let shorter = s2;
    if (s1.length < s2.length) { longer = s2; shorter = s1; }
    let longerLength = longer.length;
    if (longerLength === 0) return 1.0;
    return (longerLength - editDistance(longer, shorter)) / longerLength;
}

function editDistance(s1, s2) {
    s1 = (s1 || '').toLowerCase();
    s2 = (s2 || '').toLowerCase();
    let costs = new Array();
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i == 0) costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) != s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

function saveToIndex(title, content) {
    if (!isFeatureEnabled('searchIndexing')) return;
    
    runWithGracefulDegradation('searchIndexing', () => {
        if (!title || !content || content.length < 5) return;
        const indexKey = getStorageKey('notebookSearchIndex');
        if (!indexKey) return;
        const key = normalizeKey(title);
        let safeContent = content.length > MAX_INDEX_CONTENT_LENGTH ? content.substring(0, MAX_INDEX_CONTENT_LENGTH) : content;
        safeContent = safeContent.toLowerCase();
        if (typeof LZString !== 'undefined') {
            safeContent = LZString.compressToUTF16(safeContent);
        }
        if (searchIndex[key] === safeContent) {
            // Update access time even if content unchanged
            searchIndexAccessTimes[key] = Date.now();
            return;
        }
        
        // Check size and evict if necessary
        const newEntrySize = new Blob([safeContent]).size;
        let currentSize = Object.values(searchIndex).reduce((acc, val) => acc + new Blob([val]).size, 0);
        
        // Evict least recently used entries until we have room
        while (currentSize + newEntrySize > MAX_INDEX_SIZE_BYTES && Object.keys(searchIndex).length > 0) {
            const lruKey = Object.keys(searchIndexAccessTimes).sort((a, b) => 
                (searchIndexAccessTimes[a] || 0) - (searchIndexAccessTimes[b] || 0)
            )[0];
            
            if (lruKey && searchIndex[lruKey]) {
                currentSize -= new Blob([searchIndex[lruKey]]).size;
                delete searchIndex[lruKey];
                delete searchIndexAccessTimes[lruKey];
                console.debug('[NotebookLM Tree] Evicted LRU index entry:', lruKey);
            } else {
                break; // Safety: avoid infinite loop
            }
        }
        
        searchIndex[key] = safeContent;
        searchIndexAccessTimes[key] = Date.now();
        chrome.storage.local.set({ [indexKey]: searchIndex });
        updateSearchStats('studio');
    }, true); // silent = true, don't show toast for indexing failures
}

function decompressContent(compressedContent, key) {
    if (!compressedContent) return "";
    // Update access time for LRU tracking
    if (key) searchIndexAccessTimes[key] = Date.now();
    if (typeof LZString === 'undefined') return compressedContent;
    try {
        const decompressed = LZString.decompressFromUTF16(compressedContent);
        return decompressed || compressedContent;
    } catch (e) {
        console.debug('[NotebookLM Tree] Decompression error:', e.message);
        return compressedContent;
    }
}

function filterProxies(context, query) {
    try {
        const term = (query || '').toLowerCase().trim();
        const container = document.getElementById(`plugin-${context}-root`);
        if (!container) return;
        const getFolderNode = (id) => container.querySelector(`#node-${id}`);
        if (!term) {
            container.querySelectorAll('.plugin-proxy-item').forEach(el => {
                el.style.display = 'flex';
                el.style.opacity = '1';
                el.removeAttribute('data-match-type');
            });
            container.querySelectorAll('.plugin-tree-node').forEach(el => el.style.display = 'block');
            Object.values(appState[context].folders).forEach(f => {
                const node = getFolderNode(f.id);
                if (node) {
                    if (f.isOpen) node.classList.add('open');
                    else node.classList.remove('open');
                }
            });
            return;
        }
        container.querySelectorAll('.plugin-proxy-item').forEach(el => el.style.display = 'none');
        container.querySelectorAll('.plugin-tree-node').forEach(el => el.style.display = 'none');
        const proxies = container.querySelectorAll('.plugin-proxy-item');
        const terms = term.split(' ').filter(t => t);
        proxies.forEach(proxy => {
            const visibleText = proxy.dataset.searchTerm || proxy.innerText.toLowerCase();
            const titleRaw = proxy.dataset.ref || "";
            const titleKey = normalizeKey(titleRaw);
            let deepContent = decompressContent(searchIndex[titleKey] || "", titleKey);
            const isExactMatch = terms.every(t => (visibleText.includes(t) || deepContent.includes(t)));
            const isFuzzyMatch = !isExactMatch && terms.every(t => getSimilarity(visibleText, t) > FUZZY_MATCH_THRESHOLD);
            if (isExactMatch || isFuzzyMatch) {
                proxy.style.display = 'flex';
                if (isFuzzyMatch) {
                    proxy.setAttribute('data-match-type', 'fuzzy');
                } else {
                    proxy.setAttribute('data-match-type', 'exact');
                    proxy.style.opacity = '1';
                }
                let parent = proxy.parentElement;
                while (parent && parent !== container) {
                    if (parent.classList.contains('plugin-node-children')) {
                        const folderNode = parent.parentElement;
                        if (folderNode) {
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
            if (!header) return;
            const folderName = (header.innerText || '').toLowerCase();
            const isFolderMatch = folderName.includes(term) || getSimilarity(folderName, term) > FOLDER_NAME_MATCH_THRESHOLD;
            if (isFolderMatch) {
                node.style.display = 'block';
                let parent = node.parentElement;
                while (parent && parent !== container) {
                    if (parent.classList.contains('plugin-node-children')) {
                        const grandParent = parent.parentElement;
                        if (grandParent) {
                            grandParent.style.display = 'block';
                            grandParent.classList.add('open');
                        }
                    }
                    parent = parent.parentElement;
                }
            }
        });
    } catch (e) {
        console.debug('[NotebookLM Tree] Filter proxies error:', e.message);
    }
}

function filterStudioToNote(noteTitle) {
    try {
        if (!noteTitle) return;
        
        // Find the Studio search input
        const studioRoot = document.getElementById('plugin-studio-root');
        if (!studioRoot) {
            showToast("Studio panel not found");
            return;
        }
        
        const searchInput = studioRoot.querySelector('.plugin-search-area input');
        const clearBtn = studioRoot.querySelector('.plugin-search-area .search-clear-btn');
        if (searchInput) {
            // Set the search input value
            searchInput.value = noteTitle;
            // Trigger the filter
            filterProxies('studio', noteTitle);
            // Show the clear button
            if (clearBtn) clearBtn.classList.add('visible');
            // Focus the input so user can easily clear it
            searchInput.focus();
            searchInput.select();
        } else {
            // If no search input, just filter directly
            filterProxies('studio', noteTitle);
        }
        
        showToast(`Filtered to: ${noteTitle}`);
    } catch (e) {
        console.debug('[NotebookLM Tree] Filter studio to note error:', e.message);
    }
}

function rebuildSearchIndex() {
    showConfirmModal("Rebuild Search Index?<br><br>This will clear your local search cache.", () => {
        searchIndex = {};
        searchIndexAccessTimes = {};
        const indexKey = getStorageKey('notebookSearchIndex');
        if (indexKey) chrome.storage.local.remove(indexKey);
        // Reset search indexing feature if it was disabled
        resetFeature('searchIndexing');
        updateSearchStats('studio');
        showToast("Index cleared. Please click your notes to re-index them.");
    });
}

function expandAllFolders(context) {
    Object.values(appState[context].folders).forEach(f => f.isOpen = true);
    saveState();
    renderTree(context);
    setTimeout(() => safeProcessItems(context), DOM_SETTLE_DELAY_MS);
}

function collapseAllFolders(context) {
    Object.values(appState[context].folders).forEach(f => f.isOpen = false);
    saveState();
    renderTree(context);
}

function exportFolders() {
    try {
        const notebookId = getNotebookId();
        const data = {
            version: getExtensionVersion(),
            exportedAt: new Date().toISOString(),
            description: "NotebookLM Pro Tree backup",
            notebookId: notebookId,
            source: appState.source,
            studio: appState.studio,
            settings: appState.settings
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `notebooklm-pro-${notebookId ? notebookId.substring(0, 8) : 'backup'}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ Config exported");
    } catch (e) {
        console.error('[NotebookLM Tree] Export failed:', e);
        showToast("ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Export failed");
    }
}

function importFolders() {
    try {
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
                    if (!data.source || !data.studio) throw new Error("Invalid backup");
                    showConfirmModal("Replace existing configuration?", () => {
                        appState.source = data.source;
                        appState.studio = data.studio;
                        if (data.settings) appState.settings = data.settings;
                        saveState();
                        location.reload();
                    });
                } catch (err) {
                    console.debug('[NotebookLM Tree] Import error:', err);
                    alert("Import failed: " + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    } catch (e) {
        console.error('[NotebookLM Tree] Import setup failed:', e);
    }
}

function showToast(message) {
    try {
        const existing = document.getElementById('plugin-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'plugin-toast';
        toast.innerText = message;
        toast.style.cssText = `position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background-color: #323232; color: #fff; padding: 10px 24px; border-radius: 4px; font-size: 14px; z-index: 10000; opacity: 0; transition: opacity 0.3s ease-in-out; pointer-events: none;`;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.style.opacity = '1');
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), TOAST_FADE_MS);
        }, TOAST_DISPLAY_MS);
    } catch (e) {
        // Toast is non-critical
    }
}

function updateSearchStats(context) {
    try {
        if (context !== 'studio') return;
        const searchInput = document.querySelector('#plugin-studio-root .plugin-search-area input');
        if (!searchInput) return;
        const studioSelector = Array.isArray(activeSelectors.studioRow) ? activeSelectors.studioRow.join(', ') : activeSelectors.studioRow;
        const totalNotes = document.querySelectorAll(`${studioSelector}.plugin-detected-row, mat-card.plugin-detected-row`).length;
        const indexedCount = Object.keys(searchIndex).length;
        searchInput.placeholder = `Search titles (${indexedCount}/${totalNotes} indexed)...`;
    } catch (e) {
        // Non-critical
    }
}

function autoCollapseSourceGuide() {
    try {
        if (!appState.settings.autoCollapseGuide) return;

        const guideBtn = document.querySelector('button.open-source-guide-button[aria-expanded="true"]');

        if (guideBtn && !guideBtn.classList.contains('plugin-handled-collapse')) {
            guideBtn.classList.add('plugin-handled-collapse');

            const clickEvent = new MouseEvent('click', { view: window, bubbles: true, cancelable: true });
            guideBtn.dispatchEvent(clickEvent);

            console.debug('[NotebookLM Tree] Auto-collapsed Source Guide');
        }
    } catch (e) {
        console.debug('[NotebookLM Tree] Auto-collapse error:', e.message);
    }
}

function startObserver() {
    try {
        const targetContainer = safeQuery(document, [
            '.notebook-container',
            'main[role="main"]',
            '[data-notebook-content]',
            '#app-root',
            'mat-sidenav-content'
        ]) || document.body;
        
        if (!targetContainer) {
            console.warn('[NotebookLM Tree] DOM not ready for observer. Retrying in 1s...');
            setTimeout(startObserver, 1000);
            return;
        }
        
        mainObserver = new MutationObserver((mutations) => {
            if (isDragging) return;
            try {
                autoCollapseSourceGuide();

                const isRelevant = mutations.some(m => {
                    if (!m.target) return false;
                    if (m.target.closest && m.target.closest('.plugin-container')) return false;
                    if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class')) {
                        if (m.attributeName === 'class' && m.target.tagName === 'MAT-CHECKBOX') return true;
                        return false;
                    }
                    return true;
                });
                if (!isRelevant) return;
                
                debouncedRunOrganizer();
                debouncedIndexNote();
            } catch (e) { }
        });
        
        mainObserver.observe(targetContainer, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'] 
        });
        
        console.debug('[NotebookLM Tree] Observer started on:', targetContainer.tagName || 'body');
    } catch (e) {
        console.error('[NotebookLM Tree] Observer setup failed:', e);
    }
}

function safeDetectAndIndexActiveNote() {
    if (!isFeatureEnabled('searchIndexing')) return;
    
    runWithGracefulDegradation('searchIndexing', () => {
        detectAndIndexActiveNote();
    }, true); // silent = true
}

function detectAndIndexActiveNote() {
    const titleEl = safeQuery(document, activeSelectors.activeNoteTitle);
    if (!titleEl) return;
    let title = safeGetText(titleEl) || titleEl.value;
    if (!title) return;
    const bodyEl = safeQuery(document, activeSelectors.activeNoteBody);
    if (bodyEl) {
        const content = safeGetText(bodyEl);
        if (content) saveToIndex(title, content);
    }
}

function safeRunOrganizer() {
    runWithGracefulDegradation('folderOrganization', () => {
        runOrganizer();
    });
}

function safeProcessItems(context) {
    if (!isFeatureEnabled('folderOrganization')) return;
    
    runWithGracefulDegradation('folderOrganization', () => {
        processItems(context);
    });
}

function runOrganizer() {
    if (!getNotebookId()) return;
    applyFocusMode();
    
    const sourceAnchor = findSelectAllRow();
    if (sourceAnchor) {
        injectContainer(sourceAnchor, 'source');
        processItems('source');
    }
    
    const studioAnchor = findStudioAnchor();
    if (studioAnchor) {
        injectContainer(studioAnchor, 'studio');
        processItems('studio');
    }
}

function findSelectAllRow() {
    try {
        const nameMatch = document.querySelector('span[name="allsources"]');
        if (nameMatch) return getRowContainer(nameMatch);
        
        const allSpans = document.querySelectorAll('span, div, label');
        const textMatch = Array.from(allSpans).find(el => 
            el.innerText && el.innerText.trim() === "Select all sources"
        );
        if (textMatch) return getRowContainer(textMatch);
        
        const sourceRowSelector = Array.isArray(activeSelectors.sourceRow) 
            ? activeSelectors.sourceRow[0] 
            : activeSelectors.sourceRow;
        const allChecks = safeQueryAll(document, 'mat-checkbox');
        if (allChecks.length > 0) {
            const firstCheck = allChecks[0];
            if (!firstCheck.closest(sourceRowSelector)) {
                return getRowContainer(firstCheck);
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

function findStudioAnchor() {
    try {
        const genBox = safeQuery(document, activeSelectors.generatorBox);
        if (genBox) return genBox;
        
        const sortBtn = document.querySelector('button[aria-label="Sort"]');
        if (sortBtn) return getRowContainer(sortBtn);
        
        const firstNote = safeQuery(document, activeSelectors.studioRow);
        if (firstNote) return firstNote;
        
        return null;
    } catch (e) {
        return null;
    }
}

function getRowContainer(element) {
    try {
        if (!element) return null;
        let row = element;
        let depth = 0;
        while (row && row.parentElement && depth++ < 20) {
            if (row.classList.contains('row') ||
                row.parentElement.tagName === 'MAT-NAV-LIST' ||
                row.parentElement.classList.contains('panel-content')) {
                return row;
            }
            row = row.parentElement;
        }
        return element;
    } catch (e) {
        return element;
    }
}

function wirePluginEjectStack(stack, context) {
    const bindZone = (zone, mode) => {
        if (!zone) return;
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            zone.classList.add('plugin-drag-over');
        });
        zone.addEventListener('dragleave', (e) => {
            if (e.relatedTarget && zone.contains(e.relatedTarget)) return;
            zone.classList.remove('plugin-drag-over');
        });
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.remove('plugin-drag-over');
            if (!currentDragData || currentDragData.context !== context) return;
            performEjectDrop(context, mode, { type: currentDragData.type, id: currentDragData.id });
        });
    };
    bindZone(stack.querySelector('.plugin-eject-outdent'), 'outdent');
    bindZone(stack.querySelector('.plugin-eject-root'), 'root');
}

function injectContainer(anchorEl, context) {
    try {
        const id = `plugin-${context}-root`;
        if (safeHasClass(anchorEl, 'plugin-ui-injected') || document.getElementById(id)) return;
        let wrapper = anchorEl.parentElement;
        if (!wrapper) return;
        
        const container = document.createElement('div');
        container.id = id;
        container.className = 'plugin-container';
        const controls = document.createElement('div');
        controls.className = 'plugin-controls-area';
        const rebuildBtn = context === 'studio' ? `<button class="plugin-btn secondary rebuild-index" title="Rebuild Index (Local)">${ICONS.refresh}</button>` : '';
        const focusBtn = context === 'studio' ? `<button class="plugin-btn secondary toggle-focus toggle-off" title="Enter Zen Mode">${ICONS.focus}</button>` : '';

        controls.innerHTML = `
            <button class="plugin-btn add-folder" title="Create New Folder">${ICONS.newFolder}</button>
            <button class="plugin-btn secondary expand-all" title="Expand All">${ICONS.expandAll}</button>
            <button class="plugin-btn secondary collapse-all" title="Collapse All">${ICONS.collapseAll}</button>
            <button class="plugin-btn secondary export-btn" title="Export Config">${ICONS.export}</button>
            <button class="plugin-btn secondary import-btn" title="Import Config">${ICONS.import}</button>
            <button class="plugin-btn secondary reset-btn" title="Reset Tree">${ICONS.restart}</button>
            ${rebuildBtn}
            ${focusBtn}
        `;

        if (context === 'source') {
            const toggleResearchBtn = document.createElement('button');
            toggleResearchBtn.className = 'plugin-btn secondary toggle-research';
            toggleResearchBtn.innerHTML = ICONS.search;
            const applyResearchState = () => {
                const isVisible = appState.settings.showResearch;
                const promos = document.querySelectorAll('.source-discovery-promo-container');
                const boxes = document.querySelectorAll('source-discovery-query-box');
                promos.forEach(el => el.style.display = isVisible ? '' : 'none');
                boxes.forEach(el => el.style.display = isVisible ? '' : 'none');
                toggleResearchBtn.classList.toggle('toggle-off', !isVisible);
                toggleResearchBtn.title = isVisible ? "Hide Web Research" : "Show Web Research";
            };
            toggleResearchBtn.onclick = () => {
                appState.settings.showResearch = !appState.settings.showResearch;
                saveState();
                applyResearchState();
            };
            applyResearchState();
            controls.appendChild(toggleResearchBtn);
            
            // --- [NEW] SELECT ALL BUTTON ---
            const selectAllBtn = document.createElement('button');
            selectAllBtn.className = 'plugin-btn secondary select-all-btn';
            selectAllBtn.innerHTML = ICONS.selectAll;
            selectAllBtn.title = "Toggle All Sources";
            selectAllBtn.onclick = () => toggleAllSources();
            controls.appendChild(selectAllBtn);

            const dedupeBtn = document.createElement('button');
            dedupeBtn.className = 'plugin-btn secondary dedupe-btn';
            dedupeBtn.innerHTML = ICONS.deleteForever;
            dedupeBtn.title = "Delete Duplicate Sources";
            dedupeBtn.onclick = () => removeDuplicateSources();
            controls.appendChild(dedupeBtn);

            const toggleGuideBtn = document.createElement('button');
            toggleGuideBtn.className = `plugin-btn secondary ${!appState.settings.autoCollapseGuide ? 'toggle-off' : ''}`;
            toggleGuideBtn.innerHTML = ICONS.warning;
            toggleGuideBtn.title = appState.settings.autoCollapseGuide ? "Auto-Collapse Guide: ON" : "Auto-Collapse Guide: OFF";
            toggleGuideBtn.onclick = () => {
                appState.settings.autoCollapseGuide = !appState.settings.autoCollapseGuide;
                saveState();
                toggleGuideBtn.classList.toggle('toggle-off', !appState.settings.autoCollapseGuide);
                toggleGuideBtn.title = appState.settings.autoCollapseGuide ? "Auto-Collapse Guide: ON" : "Auto-Collapse Guide: OFF";
                showToast(appState.settings.autoCollapseGuide ? "Guide will auto-collapse" : "Guide will stay open");
            };
            controls.appendChild(toggleGuideBtn);
            // -------------------------------
            
            const taskSection = document.createElement('div');
            taskSection.className = 'plugin-task-section';
            const arrowClass = appState.settings.tasksOpen ? 'arrow open' : 'arrow';
            
            // Build section options for dropdown
            const sections = appState.source.taskSections || {};
            const sortedSections = Object.values(sections).sort((a, b) => (a.order || 0) - (b.order || 0));
            let sectionOptionsHtml = '<option value="">No Section</option>';
            sortedSections.forEach(s => {
                sectionOptionsHtml += `<option value="${s.id}">${s.name}</option>`;
            });
            
            taskSection.innerHTML = `
                <div class="plugin-task-header">
                    <div style="display:flex; align-items:center; gap:4px;">
                        <span class="${arrowClass}">${ICONS.chevron}</span> 
                        Tasks <span id="plugin-task-count" style="font-size:11px; opacity:0.7;"></span>
                    </div>
                    <div class="plugin-task-header-actions">
                        <div class="plugin-header-btn add-section" title="Add Section">${ICONS.newFolder}</div>
                        <div class="plugin-header-btn sort-tasks-date" title="Sort by Due Date">${ICONS.sortDate}</div>
                        <div class="plugin-header-btn sort-tasks" title="Sort by Priority">${ICONS.sort}</div>
                    </div>
                </div>
                <div class="plugin-task-body" style="display:${appState.settings.tasksOpen ? 'block' : 'none'}">
                    <div class="plugin-task-input-area">
                        <input type="text" class="task-text-input" placeholder="Add task..." />
                        <button class="plugin-btn secondary expand-options-btn" title="More Options">${ICONS.moreHoriz}</button>
                        <button class="plugin-btn secondary add-task-btn">${ICONS.add}</button>
                    </div>
                    <div class="plugin-task-options" style="display:none;">
                        <div class="plugin-task-options-row">
                            <label>
                                <span class="option-label">${ICONS.calendar} Due</span>
                                <input type="date" class="task-date-input" />
                            </label>
                            <div class="quick-date-btns">
                                <button class="quick-date-btn" data-days="0">Today</button>
                                <button class="quick-date-btn" data-days="1">Tomorrow</button>
                                <button class="quick-date-btn" data-days="7">+1 Week</button>
                            </div>
                        </div>
                        <div class="plugin-task-options-row">
                            <label>
                                <span class="option-label">${ICONS.folder} Section</span>
                                <select class="task-section-select">${sectionOptionsHtml}</select>
                            </label>
                        </div>
                    </div>
                    <div id="plugin-task-list-mount" class="plugin-task-list"></div>
                </div>
            `;
            const taskArrow = taskSection.querySelector('.arrow');
            const taskBody = taskSection.querySelector('.plugin-task-body');
            const taskHeader = taskSection.querySelector('.plugin-task-header');
            if (taskHeader) {
                taskHeader.onclick = (e) => {
                    if (e.target.closest('.plugin-header-btn')) return;
                    appState.settings.tasksOpen = !appState.settings.tasksOpen;
                    saveState();
                    if (taskBody) taskBody.style.display = appState.settings.tasksOpen ? 'block' : 'none';
                    if (taskArrow) {
                        if (appState.settings.tasksOpen) {
                            taskArrow.classList.add('open');
                        } else {
                            taskArrow.classList.remove('open');
                        }
                    }
                };
            }
            const sortTasksBtn = taskSection.querySelector('.sort-tasks');
            if (sortTasksBtn) {
                sortTasksBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (appState.source.tasks && appState.source.tasks.length > 0) {
                        appState.source.tasks.sort((a, b) => {
                            const getVal = (p) => (p && p > 0) ? p : 99;
                            return getVal(a.prio) - getVal(b.prio);
                        });
                        saveState();
                        renderTasks();
                        showToast("Tasks sorted by Priority");
                    }
                };
            }
            const addSectionBtn = taskSection.querySelector('.add-section');
            if (addSectionBtn) {
                addSectionBtn.onclick = (e) => {
                    e.stopPropagation();
                    const name = prompt("Section Name:");
                    if (name && name.trim()) {
                        createTaskSection(name.trim());
                        showToast("Section created");
                        // Refresh the section dropdown
                        const select = taskSection.querySelector('.task-section-select');
                        if (select) {
                            const newOption = document.createElement('option');
                            newOption.value = Object.keys(appState.source.taskSections).pop();
                            newOption.textContent = name.trim();
                            select.appendChild(newOption);
                        }
                    }
                };
            }
            
            // Sort by date handler
            const sortDateBtn = taskSection.querySelector('.sort-tasks-date');
            if (sortDateBtn) {
                sortDateBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (appState.source.tasks && appState.source.tasks.length > 0) {
                        appState.source.tasks.sort((a, b) => {
                            // Tasks with no date go to the end
                            if (!a.date && !b.date) return 0;
                            if (!a.date) return 1;
                            if (!b.date) return -1;
                            return new Date(a.date) - new Date(b.date);
                        });
                        saveState();
                        renderTasks();
                        showToast("Tasks sorted by Due Date");
                    }
                };
            }
            
            const taskInput = taskSection.querySelector('.task-text-input');
            const taskDateInput = taskSection.querySelector('.task-date-input');
            const taskSectionSelect = taskSection.querySelector('.task-section-select');
            const taskOptionsPanel = taskSection.querySelector('.plugin-task-options');
            const expandOptionsBtn = taskSection.querySelector('.expand-options-btn');
            const addTaskBtn = taskSection.querySelector('.add-task-btn');
            
            // Toggle options panel
            if (expandOptionsBtn && taskOptionsPanel) {
                expandOptionsBtn.onclick = (e) => {
                    e.stopPropagation();
                    const isVisible = taskOptionsPanel.style.display !== 'none';
                    taskOptionsPanel.style.display = isVisible ? 'none' : 'block';
                    expandOptionsBtn.classList.toggle('active', !isVisible);
                };
            }
            
            // Quick date buttons
            const quickDateBtns = taskSection.querySelectorAll('.quick-date-btn');
            quickDateBtns.forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const days = parseInt(btn.dataset.days, 10);
                    const date = new Date();
                    date.setDate(date.getDate() + days);
                    const dateStr = date.toISOString().split('T')[0];
                    if (taskDateInput) taskDateInput.value = dateStr;
                };
            });
            
            const addTaskHandler = () => {
                if (taskInput) {
                    const val = taskInput.value.trim();
                    if (val) {
                        // Quick add: use inline options if provided
                        const dateVal = taskDateInput ? taskDateInput.value : '';
                        const sectionVal = taskSectionSelect ? taskSectionSelect.value : '';
                        addTask({ 
                            text: val, 
                            done: false, 
                            prio: 0, 
                            date: dateVal,
                            sectionId: sectionVal || null
                        });
                        taskInput.value = '';
                        if (taskDateInput) taskDateInput.value = '';
                        if (taskSectionSelect) taskSectionSelect.value = '';
                    } else {
                        // No text: open full create modal
                        showTaskCreateModal();
                    }
                }
            };
            if (addTaskBtn) addTaskBtn.onclick = addTaskHandler;
            if (taskInput) taskInput.onkeydown = (e) => { if (e.key === 'Enter') addTaskHandler(); };
            container.appendChild(taskSection);
            setTimeout(renderTasks, DOM_SETTLE_DELAY_MS);
        }
        
        if (context === 'studio') {
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'plugin-btn secondary toggle-gen';
            toggleBtn.innerHTML = ICONS.tune;
            const applyGeneratorsState = () => {
                const isVisible = appState.settings.showGenerators;
                const box = safeQuery(document, activeSelectors.generatorBox);
                if (box) box.style.display = isVisible ? '' : 'none';
                toggleBtn.classList.toggle('toggle-off', !isVisible);
                toggleBtn.title = isVisible ? "Hide Generators" : "Show Generators";
            };
            toggleBtn.onclick = () => {
                appState.settings.showGenerators = !appState.settings.showGenerators;
                saveState();
                applyGeneratorsState();
            };
            applyGeneratorsState();
            controls.appendChild(toggleBtn);
            
            const searchDiv = document.createElement('div');
            searchDiv.className = 'plugin-search-area';
            searchDiv.innerHTML = `
                <input type="text" placeholder="Search titles...">
                <span class="search-clear-btn" title="Clear search">${ICONS.cancel}</span>
            `;
            const debouncedFilter = debounce((value) => filterProxies(context, value), DEBOUNCE_SEARCH_MS);
            const searchInput = searchDiv.querySelector('input');
            const clearBtn = searchDiv.querySelector('.search-clear-btn');
            if (searchInput) {
                searchInput.oninput = (e) => { 
                    debouncedFilter(e.target.value);
                    // Show/hide clear button based on input content
                    if (clearBtn) clearBtn.classList.toggle('visible', e.target.value.length > 0);
                };
            }
            if (clearBtn) {
                clearBtn.onclick = () => {
                    if (searchInput) {
                        searchInput.value = '';
                        filterProxies(context, '');
                        clearBtn.classList.remove('visible');
                        searchInput.focus();
                    }
                };
            }
            container.appendChild(searchDiv);
        }

        const addFolderBtn = controls.querySelector('.add-folder');
        if (addFolderBtn) addFolderBtn.onclick = () => createFolder(context);
        
        const expandAllBtn = controls.querySelector('.expand-all');
        if (expandAllBtn) expandAllBtn.onclick = () => expandAllFolders(context);
        
        const collapseAllBtn = controls.querySelector('.collapse-all');
        if (collapseAllBtn) collapseAllBtn.onclick = () => collapseAllFolders(context);
        
        const exportBtn = controls.querySelector('.export-btn');
        if (exportBtn) exportBtn.onclick = () => exportFolders();
        
        const importBtn = controls.querySelector('.import-btn');
        if (importBtn) importBtn.onclick = () => importFolders();
        
        const resetBtn = controls.querySelector('.reset-btn');
        if (resetBtn) {
            resetBtn.onclick = () => {
                showConfirmModal("Reset all folders?", () => {
                    appState[context] = { folders: {}, mappings: {}, pinned: [], tasks: [] };
                    saveState();
                    location.reload();
                });
            };
        }
        
        if (context === 'studio') {
            const rebuildIndexBtn = controls.querySelector('.rebuild-index');
            if (rebuildIndexBtn) rebuildIndexBtn.onclick = () => rebuildSearchIndex();
            
            const toggleFocusBtn = controls.querySelector('.toggle-focus');
            if (toggleFocusBtn) toggleFocusBtn.onclick = () => toggleFocusMode();
        }
        container.appendChild(controls);

        const pinnedMount = document.createElement('div');
        pinnedMount.id = `pinned-mount-${context}`;
        pinnedMount.className = 'plugin-pinned-section';
        pinnedMount.style.display = 'none';
        container.appendChild(pinnedMount);
        
        const treeMount = document.createElement('div');
        treeMount.id = `tree-mount-${context}`;
        container.appendChild(treeMount);

        const ejectStack = document.createElement('div');
        ejectStack.className = 'plugin-eject-stack';
        ejectStack.innerHTML = `
            <div class="plugin-eject-zone plugin-eject-outdent">${ICONS.smallUp}<span>Up one level (same row as parent folder)</span></div>
            <div class="plugin-eject-zone plugin-eject-root">${ICONS.eject}<span>Top level / not in any folder</span></div>
        `;
        wirePluginEjectStack(ejectStack, context);

        container.appendChild(ejectStack);

        if (context === 'source') {
            wrapper.insertBefore(container, anchorEl);
        } else if (context === 'studio') {
            if (safeHasClass(anchorEl, 'create-artifact-buttons-container') && anchorEl.nextElementSibling) {
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
    } catch (e) {
        console.error('[NotebookLM Tree] Inject container error:', e);
    }
}

/**
 * True if ancestorId is a strict ancestor of descendantFolderId (invalid to drop folder into its own subtree).
 */
function isDescendantFolder(ancestorId, descendantFolderId, context) {
    const folders = appState[context].folders || {};
    let currentId = folders[descendantFolderId]?.parentId || null;
    while (currentId) {
        if (currentId === ancestorId) return true;
        const f = folders[currentId];
        currentId = f && f.parentId ? f.parentId : null;
    }
    return false;
}

function commitItemDropOnFolder(context, title, folderId) {
    const folder = appState[context].folders[folderId];
    if (!folder) return false;
    appState[context].mappings[title] = folderId;
    folder.isOpen = true;
    saveState();
    renderTree(context);
    setTimeout(() => safeProcessItems(context), DOM_SETTLE_DELAY_MS);
    return true;
}

/**
 * @param {'root'|'outdent'} mode — root: uncategorized (items) or top-level folder; outdent: sibling of current parent (folder) or parent folder (item)
 */
function performEjectDrop(context, mode, dragData) {
    const { type, id } = dragData;
    try {
        if (type === 'item') {
            if (mode === 'root') {
                delete appState[context].mappings[id];
            } else {
                const folderId = appState[context].mappings[id];
                if (!folderId) return;
                const f = appState[context].folders[folderId];
                if (!f || !f.parentId) {
                    showToast('Already in a top-level folder. Use the lower zone to leave folders entirely.');
                    return;
                }
                appState[context].mappings[id] = f.parentId;
            }
        } else if (type === 'folder') {
            const f = appState[context].folders[id];
            if (!f) return;
            if (mode === 'root') {
                f.parentId = null;
                const others = Object.values(appState[context].folders).filter(x => !x.parentId && x.id !== f.id);
                const maxOrder = others.length > 0 ? Math.max(...others.map(r => r.order || 0)) : -1;
                f.order = maxOrder + 1;
            } else {
                if (!f.parentId) {
                    showToast('Folder is already at top level');
                    return;
                }
                const parent = appState[context].folders[f.parentId];
                f.parentId = parent ? (parent.parentId || null) : null;
                const np = f.parentId;
                const siblings = Object.values(appState[context].folders).filter(x => (x.parentId || null) === (np || null) && x.id !== f.id);
                f.order = siblings.length > 0 ? Math.max(...siblings.map(s => s.order || 0)) + 1 : 0;
            }
        }
        saveState();
        renderTree(context);
        setTimeout(() => safeProcessItems(context), DOM_SETTLE_DELAY_MS);
    } catch (e) {
        console.debug('[NotebookLM Tree] Eject drop failed:', e);
    }
}

function commitItemEjectMapping(context, title) {
    performEjectDrop(context, 'root', { type: 'item', id: title });
}

function findNativePointerDropTarget(clientX, clientY, context) {
    const treeMount = document.getElementById(`tree-mount-${context}`);
    const pluginRoot = document.getElementById(`plugin-${context}-root`);
    if (!treeMount || !pluginRoot) return null;

    let els;
    try {
        els = document.elementsFromPoint(clientX, clientY);
    } catch (e) {
        return null;
    }
    if (!els || !els.length) return null;

    for (const el of els) {
        if (el.classList && el.classList.contains('plugin-custom-drag-ghost')) continue;

        const outdentHit = el.closest && el.closest('.plugin-eject-outdent');
        if (outdentHit && pluginRoot.contains(outdentHit)) {
            return { kind: 'eject-outdent' };
        }
        const rootHit = el.closest && el.closest('.plugin-eject-root');
        if (rootHit && pluginRoot.contains(rootHit)) {
            return { kind: 'eject-root' };
        }
        if (el.classList && el.classList.contains('plugin-folder-header') && treeMount.contains(el)) {
            const node = el.closest('.plugin-tree-node');
            if (!node || !node.id || !node.id.startsWith('node-')) continue;
            const folderId = node.id.slice('node-'.length);
            if (appState[context].folders[folderId]) return { kind: 'folder', folderId };
        }
    }
    return null;
}

function clearCustomDragHighlights(context) {
    const root = document.getElementById(`plugin-${context}-root`);
    if (!root) return;
    root.querySelectorAll('.plugin-folder-header.plugin-drag-over, .plugin-eject-zone.plugin-drag-over').forEach(el => {
        el.classList.remove('plugin-drag-over');
    });
}

function applyNativePointerDropHighlight(clientX, clientY, context) {
    clearCustomDragHighlights(context);
    const t = findNativePointerDropTarget(clientX, clientY, context);
    if (!t) return;
    if (t.kind === 'eject-outdent') {
        document.querySelector(`#plugin-${context}-root .plugin-eject-outdent`)?.classList.add('plugin-drag-over');
    } else if (t.kind === 'eject-root') {
        document.querySelector(`#plugin-${context}-root .plugin-eject-root`)?.classList.add('plugin-drag-over');
    } else {
        const node = document.getElementById(`node-${t.folderId}`);
        const h = node && node.querySelector(':scope > .plugin-folder-header');
        if (h) h.classList.add('plugin-drag-over');
    }
}

function scheduleNativePointerHighlight(clientX, clientY, context) {
    if (nativePointerHighlightRaf) cancelAnimationFrame(nativePointerHighlightRaf);
    nativePointerHighlightRaf = requestAnimationFrame(() => {
        nativePointerHighlightRaf = null;
        applyNativePointerDropHighlight(clientX, clientY, context);
    });
}

function suppressNativeRowClickAfterDrag(row) {
    const stop = (e) => {
        if (!row.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    };
    window.addEventListener('click', stop, true);
    setTimeout(() => window.removeEventListener('click', stop, true), 400);
}

function shouldIgnoreNativePointerDragStart(target) {
    if (!target || !target.closest) return true;
    if (target.closest('mat-checkbox')) return true;
    if (target.closest('.plugin-move-trigger')) return true;
    if (target.closest('.plugin-item-check')) return true;
    if (target.closest('.plugin-popout-btn')) return true;
    return false;
}

function endNativePointerDragSession(commitDrop) {
    const s = nativePointerSession;
    if (!s) return;

    const wasActive = s.mode === 'active';

    nativePointerSession = null;
    if (nativePointerHighlightRaf) {
        cancelAnimationFrame(nativePointerHighlightRaf);
        nativePointerHighlightRaf = null;
    }

    try {
        s.row.releasePointerCapture(s.pointerId);
    } catch (e) { /* ignore */ }

    if (s.mode === 'pending') {
        return;
    }

    isDragging = false;
    document.body.classList.remove('plugin-drag-active');
    s.row.classList.remove('is-dragging');
    if (s.ghost && s.ghost.parentNode) s.ghost.remove();

    clearCustomDragHighlights(s.context);

    if (commitDrop) {
        const t = findNativePointerDropTarget(s.lastX, s.lastY, s.context);
        if (t?.kind === 'folder') {
            commitItemDropOnFolder(s.context, s.text, t.folderId);
        } else if (t?.kind === 'eject-outdent') {
            performEjectDrop(s.context, 'outdent', { type: 'item', id: s.text });
        } else if (t?.kind === 'eject-root') {
            performEjectDrop(s.context, 'root', { type: 'item', id: s.text });
        }
    }

    if (wasActive) suppressNativeRowClickAfterDrag(s.row);
}

function teardownNativeRowDrag(nativeRow) {
    try {
        if (nativePointerSession && nativePointerSession.row === nativeRow) {
            endNativePointerDragSession(false);
        }
        if (nativeRow._pluginNativeDragAbort) {
            nativeRow._pluginNativeDragAbort.abort();
            nativeRow._pluginNativeDragAbort = null;
        }
        const h = nativeRow.querySelector('.plugin-native-drag-handle');
        if (h) {
            h.removeAttribute('draggable');
            h.remove();
        }
        nativeRow.removeAttribute('draggable');
        delete nativeRow.dataset.pluginNativeDrag;
        delete nativeRow.dataset.pluginNativeDragTitle;
    } catch (e) { /* ignore */ }
}

function setupNativeRowDrag(nativeRow, text, context) {
    teardownNativeRowDrag(nativeRow);

    nativeRow.dataset.pluginNativeDrag = '1';
    nativeRow.dataset.pluginNativeDragTitle = text;

    const dragHint = document.createElement('div');
    dragHint.className = 'plugin-drag-handle plugin-native-drag-handle';
    dragHint.innerHTML = '⋮⋮';
    dragHint.title = 'Drag into folder';

    const moveTr = nativeRow.querySelector('.plugin-move-trigger');
    if (moveTr && moveTr.parentElement) {
        moveTr.parentElement.insertBefore(dragHint, moveTr);
    } else if (context === 'source') {
        const moreBtn = nativeRow.querySelector('button[aria-label="More"]');
        if (moreBtn && moreBtn.parentElement) {
            moreBtn.parentElement.insertBefore(dragHint, moreBtn);
        } else {
            nativeRow.insertBefore(dragHint, nativeRow.firstChild);
        }
    } else {
        const actions = nativeRow.querySelector('.artifact-item-button');
        if (actions) {
            actions.insertBefore(dragHint, actions.firstChild);
        } else {
            nativeRow.insertBefore(dragHint, nativeRow.firstChild);
        }
    }

    const ac = new AbortController();
    nativeRow._pluginNativeDragAbort = ac;
    const sig = ac.signal;

    const onPointerDown = (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (shouldIgnoreNativePointerDragStart(e.target)) return;

        if (nativePointerSession && nativePointerSession.row !== nativeRow) {
            endNativePointerDragSession(false);
        }

        nativePointerSession = {
            mode: 'pending',
            row: nativeRow,
            text,
            context,
            startX: e.clientX,
            startY: e.clientY,
            pointerId: e.pointerId,
            lastX: e.clientX,
            lastY: e.clientY
        };

        try {
            nativeRow.setPointerCapture(e.pointerId);
        } catch (err) { /* ignore */ }
    };

    const onPointerMove = (e) => {
        const s = nativePointerSession;
        if (!s || s.row !== nativeRow) return;

        s.lastX = e.clientX;
        s.lastY = e.clientY;

        if (s.mode === 'pending') {
            const dx = e.clientX - s.startX;
            const dy = e.clientY - s.startY;
            if (dx * dx + dy * dy < NATIVE_POINTER_DRAG_THRESHOLD_PX * NATIVE_POINTER_DRAG_THRESHOLD_PX) return;

            s.mode = 'active';
            isDragging = true;
            document.body.classList.add('plugin-drag-active');
            nativeRow.classList.add('is-dragging');

            const ghost = document.createElement('div');
            ghost.className = 'plugin-custom-drag-ghost';
            ghost.textContent = text.length > 80 ? `${text.slice(0, 77)}…` : text;
            document.body.appendChild(ghost);
            s.ghost = ghost;

            const gx = e.clientX + 12;
            const gy = e.clientY + 12;
            ghost.style.left = `${gx}px`;
            ghost.style.top = `${gy}px`;

            scheduleNativePointerHighlight(e.clientX, e.clientY, context);
            e.preventDefault();
            return;
        }

        if (s.mode === 'active' && s.ghost) {
            s.ghost.style.left = `${e.clientX + 12}px`;
            s.ghost.style.top = `${e.clientY + 12}px`;
            scheduleNativePointerHighlight(e.clientX, e.clientY, context);
            e.preventDefault();
        }
    };

    const onPointerUp = (e) => {
        const s = nativePointerSession;
        if (!s || s.row !== nativeRow || s.pointerId !== e.pointerId) return;

        if (s.mode === 'pending') {
            nativePointerSession = null;
            try {
                nativeRow.releasePointerCapture(e.pointerId);
            } catch (err) { /* ignore */ }
            return;
        }

        s.lastX = e.clientX;
        s.lastY = e.clientY;
        endNativePointerDragSession(true);
        e.preventDefault();
    };

    const onPointerCancel = (e) => {
        const s = nativePointerSession;
        if (!s || s.row !== nativeRow || s.pointerId !== e.pointerId) return;
        endNativePointerDragSession(false);
    };

    dragHint.addEventListener('click', (e) => e.stopPropagation(), { capture: true, signal: sig });

    nativeRow.addEventListener('pointerdown', onPointerDown, { capture: true, signal: sig });
    nativeRow.addEventListener('pointermove', onPointerMove, { signal: sig });
    nativeRow.addEventListener('pointerup', onPointerUp, { signal: sig });
    nativeRow.addEventListener('pointercancel', onPointerCancel, { signal: sig });
}

/** Enable drag-from-default-list into folders; tear down when the row is hidden (in a folder). */
function syncNativeRowDrag(nativeRow, text, context, enabled) {
    if (!enabled) {
        teardownNativeRowDrag(nativeRow);
        return;
    }
    if (nativeRow.dataset.pluginNativeDrag === '1' && nativeRow.dataset.pluginNativeDragTitle === text) {
        return;
    }
    teardownNativeRowDrag(nativeRow);
    setupNativeRowDrag(nativeRow, text, context);
}

function renderTree(context) {
    if (!isFeatureEnabled('treeRendering')) return;
    
    runWithGracefulDegradation('treeRendering', () => {
        const mount = document.getElementById(`tree-mount-${context}`);
        if (!mount) return;
        const fragment = document.createDocumentFragment();
        const folders = Object.values(appState[context].folders || {});
        const roots = folders.filter(f => !f.parentId).sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
        roots.forEach(root => fragment.appendChild(buildFolderNode(root, folders, context)));
        mount.innerHTML = '';
        mount.appendChild(fragment);
    });
}

function buildFolderNode(folder, allFolders, context) {
    const node = document.createElement('div');
    node.className = `plugin-tree-node ${folder.isOpen ? 'open' : ''}`;
    node.id = `node-${folder.id}`;
    const style = folder.color ? `border-left: 4px solid ${folder.color};` : '';

    const header = document.createElement('div');
    header.className = 'plugin-folder-header';
    header.style.cssText = style;

    // Folder-check only for source context (V17.3)
    const folderCheckHtml = context === 'source' 
        ? `<span class="action-icon folder-check" title="Toggle Folder Items">${ICONS.checkOff}</span>`
        : '';
    
    header.innerHTML = `
        <span class="arrow">${ICONS.chevron}</span>
        <span class="folder-icon" style="color:${folder.color || '#8ab4f8'}">${ICONS.folder}</span>
        <span class="folder-name"></span>
        <div class="folder-actions">
             ${folderCheckHtml}
             <span class="action-icon move-up" title="Move Up">${ICONS.up}</span>
             <span class="action-icon move-down" title="Move Down">${ICONS.down}</span>
             <span class="action-icon color-pick" title="Color">${ICONS.palette}</span>
             <span class="action-icon add" title="Add Sub">${ICONS.add}</span>
             <span class="action-icon ren" title="Rename">${ICONS.edit}</span>
             <span class="action-icon del" title="Delete">${ICONS.close}</span>
        </div>
    `;
    
    const folderNameEl = header.querySelector('.folder-name');
    if (folderNameEl) folderNameEl.textContent = folder.name;

    const headerHandle = document.createElement('div');
    headerHandle.className = 'plugin-drag-handle';
    headerHandle.innerHTML = '⋮⋮';
    headerHandle.title = 'Drag to move folder';
    headerHandle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        dragHandleClicked = true;
    });
    headerHandle.addEventListener('click', (e) => e.stopPropagation());
    header.insertBefore(headerHandle, header.firstChild);

    header.draggable = true;

    header.addEventListener('dragstart', (e) => {
        if (e.target.closest('.folder-actions')) {
            e.preventDefault();
            return;
        }
        if (!dragHandleClicked) {
            e.preventDefault();
            return;
        }
        isDragging = true;
        document.body.classList.add('plugin-drag-active');
        currentDragData = { type: 'folder', context, id: folder.id };
        header.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', folder.id);
        e.stopPropagation();
    });

    header.addEventListener('dragend', () => {
        isDragging = false;
        dragHandleClicked = false;
        document.body.classList.remove('plugin-drag-active');
        header.classList.remove('is-dragging');
        document.querySelectorAll('.plugin-drag-over').forEach(el => el.classList.remove('plugin-drag-over'));
    });

    header.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!currentDragData || currentDragData.context !== context) return;
        if (currentDragData.type === 'folder' && currentDragData.id === folder.id) return;

        e.dataTransfer.dropEffect = 'move';
        header.classList.add('plugin-drag-over');
    });

    header.addEventListener('dragleave', (e) => {
        if (e.relatedTarget && header.contains(e.relatedTarget)) return;
        header.classList.remove('plugin-drag-over');
    });

    header.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        header.classList.remove('plugin-drag-over');

        if (!currentDragData || currentDragData.context !== context) return;

        if (currentDragData.type === 'item') {
            commitItemDropOnFolder(context, currentDragData.id, folder.id);
            return;
        } else if (currentDragData.type === 'folder') {
            if (isDescendantFolder(currentDragData.id, folder.id, context)) {
                showToast('Cannot move a folder into its own sub-folder');
                return;
            }
            const fid = currentDragData.id;
            appState[context].folders[fid].parentId = folder.id;
            const siblings = Object.values(appState[context].folders).filter(x => x.parentId === folder.id && x.id !== fid);
            const newOrder = siblings.length > 0 ? Math.max(...siblings.map(s => s.order || 0)) + 1 : 0;
            appState[context].folders[fid].order = newOrder;
            folder.isOpen = true;
        }

        saveState();
        renderTree(context);
        setTimeout(() => safeProcessItems(context), DOM_SETTLE_DELAY_MS);
    });
    
    header.onclick = (e) => {
        if (e.target.closest('.plugin-drag-handle')) return;
        if (e.target.closest('.folder-actions')) return;
        folder.isOpen = !folder.isOpen;
        saveState();
        renderTree(context);
        setTimeout(() => safeProcessItems(context), DOM_SETTLE_DELAY_MS);
    };

    // --- [NEW HANDLER] - Source panel only ---
    if (context === 'source') {
        const checkBtn = header.querySelector('.folder-check');
        if (checkBtn) {
            checkBtn.onclick = (e) => {
                e.stopPropagation();
                toggleFolderItems(folder.id, context);
            };
        }
    }

    const moveUpBtn = header.querySelector('.move-up');
    if (moveUpBtn) moveUpBtn.onclick = (e) => { e.stopPropagation(); moveFolder(context, folder.id, -1); };
    
    const moveDownBtn = header.querySelector('.move-down');
    if (moveDownBtn) moveDownBtn.onclick = (e) => { e.stopPropagation(); moveFolder(context, folder.id, 1); };
    
    const colorPickBtn = header.querySelector('.color-pick');
    if (colorPickBtn) {
        colorPickBtn.onclick = (e) => {
            e.stopPropagation();
            const colors = [null, '#e8eaed', '#f28b82', '#fbbc04', '#34a853', '#4285f4', '#d93025'];
            const cur = folder.color || null;
            const next = colors[(colors.indexOf(cur) + 1) % colors.length];
            folder.color = next;
            saveState();
            renderTree(context);
        };
    }
    
    const addSubBtn = header.querySelector('.add');
    if (addSubBtn) addSubBtn.onclick = () => createFolder(context, folder.id);
    
    const renameBtn = header.querySelector('.ren');
    if (renameBtn) {
        renameBtn.onclick = (e) => {
            e.stopPropagation();
            const n = prompt("Rename:", folder.name);
            if (n) {
                folder.name = n;
                saveState();
                renderTree(context);
            }
        };
    }
    
    const deleteBtn = header.querySelector('.del');
    if (deleteBtn) {
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            showConfirmModal("Delete folder?", () => deleteFolder(context, folder.id));
        };
    }

    node.appendChild(header);
    const content = document.createElement('div');
    content.className = 'plugin-node-children';
    content.id = `folder-content-${folder.id}`;
    const subs = allFolders.filter(f => f.parentId === folder.id).sort((a, b) => (a.order || 0) - (b.order || 0));
    subs.forEach(sub => content.appendChild(buildFolderNode(sub, allFolders, context)));
    node.appendChild(content);
    return node;
}

function moveFolder(context, folderId, direction) {
    try {
        const folders = Object.values(appState[context].folders || {});
        const target = appState[context].folders[folderId];
        if (!target) return;
        const pid = target.parentId || null;
        const sibs = folders.filter(f => (f.parentId || null) === pid).sort((a, b) => (a.order || 0) - (b.order || 0));
        sibs.forEach((f, i) => f.order = i);
        const idx = sibs.findIndex(f => f.id === folderId);
        const newIdx = idx + direction;
        if (newIdx >= 0 && newIdx < sibs.length) {
            const swap = sibs[newIdx];
            [target.order, swap.order] = [swap.order, target.order];
            saveState();
            renderTree(context);
        }
    } catch (e) {
        console.debug('[NotebookLM Tree] Move folder error:', e.message);
    }
}

function processItems(context) {
    // Race condition guard - prevent concurrent processing
    if (isProcessingItems) return;
    isProcessingItems = true;
    
    try {
        let items = [];
    
    if (context === 'source') {
        if (appState.settings.showResearch === false) {
            const promos = document.querySelectorAll('.source-discovery-promo-container');
            const boxes = document.querySelectorAll('source-discovery-query-box');
            promos.forEach(el => el.style.display = 'none');
            boxes.forEach(el => el.style.display = 'none');
        }
        items = safeQueryAll(document, activeSelectors.sourceRow);
        
        if (items.length === 0) {
            const icons = document.querySelectorAll('mat-icon[data-mat-icon-type="font"]');
            const cands = new Set();
            icons.forEach(i => {
                const iconText = safeGetText(i);
                if (['drive_pdf', 'article', 'description', 'insert_drive_file'].includes(iconText)) {
                    const container = i.closest('div[tabindex="0"]');
                    if (container) cands.add(container);
                }
            });
            items = Array.from(cands);
        }
    } else {
        // Studio panel: explicitly get BOTH notes and generated items
        const notes = document.querySelectorAll('artifact-library-note');
        const generatedItems = document.querySelectorAll('artifact-library-item');
        items = [...notes, ...generatedItems];
        
        // Fallback if neither found
        if (items.length === 0) {
            items = safeQueryAll(document, activeSelectors.studioRow);
        }
        if (items.length === 0) {
            items = document.querySelectorAll('mat-card');
        }
    }

    const pinnedMount = document.getElementById(`pinned-mount-${context}`);
    if (pinnedMount) pinnedMount.innerHTML = '';
    let hasPinned = false;
    
    // Track stats for folder checkboxes
    const folderStates = {}; 

    items.forEach(nativeRow => {
        try {
            nativeRow.classList.add('plugin-detected-row');
            
            // Skip items that are still being generated (studio panel only)
            if (context === 'studio') {
                const itemButton = nativeRow.querySelector('.artifact-item-button');
                if (itemButton && itemButton.classList.contains('shimmer-yellow')) return;
                const button = nativeRow.querySelector('button.artifact-button-content');
                if (button && button.disabled) return;
            }
            
            let titleEl = context === 'source' 
                ? safeQuery(nativeRow, activeSelectors.sourceTitle)
                : safeQuery(nativeRow, activeSelectors.studioTitle);
            if (!titleEl) return;
            const text = safeGetText(titleEl);
            if (!text) return;

            // --- [NEW] DETECT CHECK STATE ---
            let isChecked = false;
            if (context === 'source') {
                const nativeBox = nativeRow.querySelector('mat-checkbox');
                isChecked = nativeBox && nativeBox.classList.contains('mat-mdc-checkbox-checked');
            }

            if (!nativeRow.querySelector('.plugin-move-trigger')) {
                injectMoveTrigger(nativeRow, text, context);
            }

            if (isPinned(context, text)) {
                hasPinned = true;
                if (pinnedMount) {
                    pinnedMount.appendChild(createProxyItem(nativeRow, text, context, true));
                }
            }

            const folderId = appState[context].mappings[text];
            if (folderId && appState[context].folders[folderId]) {
                nativeRow.classList.add('plugin-hidden-native');
                const target = document.getElementById(`folder-content-${folderId}`);
                if (target) {
                    const safeText = CSS.escape(text);
                    let proxy = target.querySelector(`.plugin-proxy-item[data-ref="${safeText}"]`);
                    
                    if (!proxy) {
                        proxy = createProxyItem(nativeRow, text, context, false);
                        target.appendChild(proxy);
                    }
                    
                    // --- [NEW] SYNC ITEM CHECKBOX ---
                    if (context === 'source') {
                         const checkBtn = proxy.querySelector('.plugin-item-check');
                         if (checkBtn) {
                             const targetIcon = isChecked ? ICONS.checkOn : ICONS.checkOff;
                             if (checkBtn.innerHTML !== targetIcon) checkBtn.innerHTML = targetIcon;
                         }

                         // Track folder stats
                         if (!folderStates[folderId]) folderStates[folderId] = { total: 0, checked: 0 };
                         folderStates[folderId].total++;
                         if (isChecked) folderStates[folderId].checked++;
                    }
                }
            } else {
                nativeRow.classList.remove('plugin-hidden-native');
            }

            const inDefaultList = !(folderId && appState[context].folders[folderId]);
            syncNativeRowDrag(nativeRow, text, context, inDefaultList);
        } catch (e) {
            console.debug('[NotebookLM Tree] Process item error:', e.message);
        }
    });

    // --- [NEW] UPDATE FOLDER ICONS ---
    if (context === 'source') {
        Object.keys(folderStates).forEach(fid => {
            const node = document.getElementById(`node-${fid}`);
            const checkBtn = node ? node.querySelector('.folder-check') : null;
            if (checkBtn) {
                const s = folderStates[fid];
                if (s.checked === 0) checkBtn.innerHTML = ICONS.checkOff;
                else if (s.checked === s.total) checkBtn.innerHTML = ICONS.checkOn;
                else checkBtn.innerHTML = ICONS.checkIndet;
            }
        });
    }

    if (pinnedMount) pinnedMount.style.display = hasPinned ? 'block' : 'none';
    if (context === 'studio') updateSearchStats('studio');
    } finally {
        isProcessingItems = false;
    }
}

function isPinned(context, title) {
    return appState[context].pinned && appState[context].pinned.includes(title);
}

function togglePin(context, title) {
    if (!isFeatureEnabled('pinning')) return;
    
    runWithGracefulDegradation('pinning', () => {
        if (!appState[context].pinned) appState[context].pinned = [];
        const idx = appState[context].pinned.indexOf(title);
        if (idx > -1) appState[context].pinned.splice(idx, 1);
        else appState[context].pinned.push(title);
        saveState();
        safeProcessItems(context);
    });
}

function createProxyItem(nativeRow, text, context, isPinnedView) {
    const proxy = document.createElement('div');
    proxy.className = 'plugin-proxy-item inside-plugin-folder';
    proxy.dataset.ref = text;
    proxy.dataset.searchTerm = text.toLowerCase();
    if (isPinnedView) proxy.classList.add('is-pinned-proxy');

    // --- [NEW] ITEM CHECKBOX ---
    if (context === 'source' && !isPinnedView) {
        const checkSpan = document.createElement('span');
        checkSpan.className = 'plugin-item-check';
        checkSpan.style.marginRight = '8px';
        checkSpan.style.cursor = 'pointer';
        checkSpan.style.display = 'flex';
        checkSpan.style.alignItems = 'center';
        checkSpan.innerHTML = ICONS.checkOff; 
        
        checkSpan.onclick = (e) => {
            e.stopPropagation();
            const nativeBox = nativeRow.querySelector('mat-checkbox input');
            if (nativeBox) nativeBox.click();
        };
        proxy.appendChild(checkSpan);
    }

    let iconElement;
    if (context === 'source') {
        const allIcons = nativeRow.querySelectorAll('mat-icon');
        let nativeIcon = null;
        const fileTypeIcons = ['drive_pdf', 'article', 'description', 'insert_drive_file', 
                               'link', 'video_library', 'audio_file', 'image', 'folder',
                               'text_snippet', 'code', 'table_chart'];
        
        for (const icon of allIcons) {
            const iconName = (icon.textContent || icon.innerText || '').trim();
            if (iconName === 'more_vert' || iconName === 'more_horiz' || 
                iconName === 'close' || iconName === 'check' || iconName === 'edit') {
                continue;
            }
            if (fileTypeIcons.includes(iconName) || !nativeIcon) {
                nativeIcon = icon;
                if (fileTypeIcons.includes(iconName)) break;
            }
        }
        
        if (nativeIcon) {
            const iconName = (nativeIcon.textContent || nativeIcon.innerText || '').trim();
            if (iconName && iconName !== 'more_vert') {
                let iconColor = 'var(--plugin-icon-color)';
                try {
                    const style = window.getComputedStyle(nativeIcon);
                    if (style.color) iconColor = style.color;
                } catch (e) { }
                
                iconElement = document.createElement('mat-icon');
                iconElement.className = nativeIcon.className;
                iconElement.textContent = iconName;
                iconElement.setAttribute('aria-hidden', 'true');
                iconElement.setAttribute('data-mat-icon-type', 'font');
                iconElement.style.marginRight = '8px';
                iconElement.style.display = 'inline-flex';
                iconElement.style.alignItems = 'center';
                iconElement.style.fontSize = '20px';
                iconElement.style.width = '20px';
                iconElement.style.height = '20px';
                iconElement.style.color = iconColor;
            } else {
                iconElement = nativeIcon.cloneNode(true);
                iconElement.style.marginRight = '8px';
                iconElement.style.display = 'flex';
            }
        } else {
            iconElement = document.createElement('span');
            iconElement.innerText = 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾';
            iconElement.style.marginRight = '8px';
        }
    } else {
        // Studio panel: Find and clone the artifact icon
        const artifactIcon = nativeRow.querySelector('.artifact-icon');
        
        if (artifactIcon) {
            const iconName = (artifactIcon.textContent || artifactIcon.innerText || '').trim();
            if (iconName && iconName !== 'more_vert' && iconName !== 'sync') {
                let iconColor = 'var(--plugin-icon-color)';
                try {
                    const style = window.getComputedStyle(artifactIcon);
                    if (style.color) iconColor = style.color;
                } catch (e) { }
                
                iconElement = document.createElement('mat-icon');
                iconElement.className = artifactIcon.className;
                iconElement.textContent = iconName;
                iconElement.setAttribute('aria-hidden', 'true');
                iconElement.setAttribute('data-mat-icon-type', 'font');
                iconElement.style.marginRight = '8px';
                iconElement.style.display = 'inline-flex';
                iconElement.style.alignItems = 'center';
                iconElement.style.fontSize = '20px';
                iconElement.style.width = '20px';
                iconElement.style.height = '20px';
                iconElement.style.color = iconColor;
            } else {
                iconElement = artifactIcon.cloneNode(true);
                iconElement.style.marginRight = '8px';
                iconElement.style.display = 'flex';
            }
        } else {
            // Fallback to generic document icon
            const span = document.createElement('span');
            span.innerHTML = `<svg style="color:#8ab4f8;" xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"></path></svg>`;
            iconElement = span.firstElementChild;
        }
    }

    const isP = isPinned(context, text);
    const pinIcon = isP ? ICONS.keepFilled : ICONS.keep;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'proxy-content';
    if (!isPinnedView) {
        const dragHandle = document.createElement('div');
        dragHandle.className = 'plugin-drag-handle';
        dragHandle.innerHTML = '⋮⋮';
        dragHandle.title = 'Drag to move';
        dragHandle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            dragHandleClicked = true;
        });
        dragHandle.addEventListener('click', (e) => e.stopPropagation());
        contentDiv.appendChild(dragHandle);
    }
    const iconSpan = document.createElement('span');
    iconSpan.className = 'proxy-icon';
    if (iconElement) iconSpan.appendChild(iconElement);
    contentDiv.appendChild(iconSpan);
    const textSpan = document.createElement('span');
    textSpan.className = 'proxy-text';
    textSpan.textContent = text;
    contentDiv.appendChild(textSpan);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'proxy-actions';

    // Pop-out button (Studio panel only - for notes)
    if (context === 'studio') {
        const popoutBtn = document.createElement('span');
        popoutBtn.className = 'plugin-popout-btn';
        popoutBtn.title = "Open in new window";
        popoutBtn.innerHTML = ICONS.newWindow;
        popoutBtn.onclick = (e) => {
            e.stopPropagation();
            // Call the pop-out handler (registered by note-popout.js)
            if (window.NotebookLMTree && window.NotebookLMTree.openNotePopout) {
                window.NotebookLMTree.openNotePopout(text, nativeRow);
            } else {
                showToast('Pop-out feature initializing...');
            }
        };
        actionsDiv.appendChild(popoutBtn);
    }

    const ejectBtn = document.createElement('span');
    ejectBtn.className = 'pin-btn';
    ejectBtn.title = "Eject";
    ejectBtn.innerHTML = ICONS.eject;
    ejectBtn.onclick = (e) => {
        e.stopPropagation();
        delete appState[context].mappings[text];
        saveState();
        nativeRow.classList.remove('plugin-hidden-native');
        proxy.remove();
    };
    actionsDiv.appendChild(ejectBtn);

    const pinBtn = document.createElement('span');
    pinBtn.className = 'pin-btn';
    pinBtn.title = isP ? "Unpin" : "Pin";
    pinBtn.innerHTML = pinIcon;
    pinBtn.onclick = (e) => {
        e.stopPropagation();
        togglePin(context, text);
    };
    actionsDiv.appendChild(pinBtn);

    proxy.appendChild(contentDiv);
    proxy.appendChild(actionsDiv);
    
    if (!isPinnedView) injectMoveTrigger(proxy, text, context);

    proxy.draggable = !isPinnedView;

    proxy.addEventListener('dragstart', (e) => {
        if (!dragHandleClicked || isPinnedView) {
            e.preventDefault();
            return;
        }
        isDragging = true;
        document.body.classList.add('plugin-drag-active');
        currentDragData = { type: 'item', context, id: text };
        proxy.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', text);
    });

    proxy.addEventListener('dragend', () => {
        isDragging = false;
        dragHandleClicked = false;
        document.body.classList.remove('plugin-drag-active');
        proxy.classList.remove('is-dragging');
        document.querySelectorAll('.plugin-drag-over').forEach(el => el.classList.remove('plugin-drag-over'));
    });
    
    proxy.onclick = (e) => {
        // Ignore clicks on action buttons
        if (e.target.closest('.plugin-drag-handle')) return;
        if (e.target.closest('.plugin-move-trigger') || e.target.closest('.pin-btn') || e.target.closest('.plugin-item-check') || e.target.closest('.plugin-popout-btn')) return;

        // Create a full bubbling MouseEvent
        const clickEvent = new MouseEvent('click', { view: window, bubbles: true, cancelable: true });

        if (context === 'source') {
            const nativeBtn = nativeRow.querySelector('button.source-stretched-button');
            if (nativeBtn) {
                nativeBtn.dispatchEvent(clickEvent);
            } else {
                // Fallback
                nativeRow.dispatchEvent(clickEvent);
            }
        } else {
            const nativeBtn = nativeRow.querySelector('button.artifact-stretched-button, .artifact-button-content button, button.artifact-item-button');

            if (nativeBtn) {
                nativeBtn.dispatchEvent(clickEvent);
            } else {
                // Ultimate fallback
                nativeRow.dispatchEvent(clickEvent);
            }
        }
    };
    
    return proxy;
}

function injectMoveTrigger(row, text, context) {
    try {
        const btn = document.createElement('span');
        btn.className = 'plugin-move-trigger';
        btn.title = "Move to Folder";
        btn.innerHTML = ICONS.move;
        btn.onclick = (e) => {
            e.stopPropagation();
            showMoveMenu(e, text, context);
        };
        if (row.classList.contains('plugin-proxy-item')) {
            const actions = row.querySelector('.proxy-actions');
            if (actions) actions.insertBefore(btn, actions.firstChild);
        } else {
            if (context === 'source') {
                const moreBtn = row.querySelector('button[aria-label="More"]');
                if (moreBtn && moreBtn.parentElement) {
                    moreBtn.parentElement.insertBefore(btn, moreBtn);
                    moreBtn.parentElement.style.display = 'flex';
                } else {
                    row.insertBefore(btn, row.firstChild);
                }
            } else {
                const actions = row.querySelector('.artifact-item-button');
                if (actions) {
                    actions.insertBefore(btn, actions.firstChild);
                    actions.style.display = 'flex';
                } else {
                    row.appendChild(btn);
                }
            }
        }
    } catch (e) {
        console.debug('[NotebookLM Tree] Inject move trigger error:', e.message);
    }
}

function showMoveMenu(e, text, context) {
    try {
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
                const safeText = CSS.escape(text);
                const proxy = document.querySelector(`.plugin-proxy-item[data-ref="${safeText}"]`);
                if (proxy) proxy.remove();
                safeProcessItems(context);
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
            let indent = "";
            for (let i = 0; i < f.level; i++) indent += "\u00A0\u00A0";
            item.innerHTML = `${indent}${ICONS.folder} ${f.name}`;
            item.onclick = (ev) => {
                ev.stopPropagation();
                appState[context].mappings[text] = f.id;
                appState[context].folders[f.id].isOpen = true;
                saveState();
                renderTree(context);
                setTimeout(() => safeProcessItems(context), DOM_SETTLE_DELAY_MS);
                menu.remove();
            };
            menu.appendChild(item);
        });
        
        document.body.appendChild(menu);
        const rect = e.target.getBoundingClientRect();
        menu.style.top = (rect.bottom + window.scrollY) + 'px';
        menu.style.left = rect.left + 'px';
        
        setTimeout(() => {
            const close = () => {
                menu.remove();
                document.removeEventListener('click', close);
            };
            document.addEventListener('click', close);
        }, DOM_SETTLE_DELAY_MS);
    } catch (e) {
        console.debug('[NotebookLM Tree] Show move menu error:', e.message);
    }
}

function createFolder(context, parentId) {
    const name = prompt("Folder Name:");
    if (!name) return;
    const id = Math.random().toString(36).substr(2, 9);
    const count = Object.values(appState[context].folders || {}).filter(f => f.parentId === parentId).length;
    appState[context].folders[id] = { id, name, parentId, isOpen: true, order: count };
    saveState();
    renderTree(context);
}

function deleteFolder(context, id) {
    try {
        delete appState[context].folders[id];
        const maps = appState[context].mappings || {};
        Object.keys(maps).forEach(k => {
            if (maps[k] === id) delete maps[k];
        });
        Object.values(appState[context].folders || {}).forEach(f => {
            if (f.parentId === id) f.parentId = null;
        });
        saveState();
        renderTree(context);
        safeProcessItems(context);
    } catch (e) {
        console.debug('[NotebookLM Tree] Delete folder error:', e.message);
    }
}

function getFlatList(context) {
    const arr = [];
    const folders = appState[context].folders || {};
    function recurse(pid, level) {
        const kids = Object.values(folders).filter(f => (f.parentId || null) === (pid || null)).sort((a, b) => (a.order || 0) - (b.order || 0));
        kids.forEach(k => {
            arr.push({ id: k.id, name: k.name, level });
            recurse(k.id, level + 1);
        });
    }
    recurse(null, 0);
    return arr;
}

// --- FLOATING TASK BUTTON FOR TEXT SELECTION ---
let floatingTaskBtn = null;

function setupFloatingTaskButton() {
    // Remove any existing button
    if (floatingTaskBtn) {
        floatingTaskBtn.remove();
        floatingTaskBtn = null;
    }
    
    document.addEventListener('mouseup', handleTextSelection);
    document.addEventListener('mousedown', hideFloatingButton);
}

function handleTextSelection(e) {
    // Don't show if clicking on our own UI
    if (e.target.closest('.plugin-container') || e.target.closest('.plugin-modal-overlay')) {
        return;
    }
    
    // Small delay to let selection settle
    setTimeout(() => {
        const selection = window.getSelection();
        const selectedText = selection ? selection.toString().trim() : '';
        
        if (selectedText.length < 3) {
            hideFloatingButton();
            return;
        }
        
        // Check if selection is within a note editor
        const anchorNode = selection.anchorNode;
        if (!anchorNode) {
            hideFloatingButton();
            return;
        }
        
        const editorParent = anchorNode.parentElement?.closest('.ql-editor, .ProseMirror, [contenteditable="true"], .note-body');
        if (!editorParent) {
            hideFloatingButton();
            return;
        }
        
        // Get selection position
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        showFloatingButton(rect, selectedText);
    }, 10);
}

function showFloatingButton(rect, selectedText) {
    hideFloatingButton();
    
    floatingTaskBtn = document.createElement('div');
    floatingTaskBtn.className = 'plugin-floating-task-btn';
    floatingTaskBtn.title = 'Create task from selection';
    floatingTaskBtn.innerHTML = ICONS.addTask;
    
    // Position above the selection
    floatingTaskBtn.style.left = `${rect.left + rect.width / 2 - 16 + window.scrollX}px`;
    floatingTaskBtn.style.top = `${rect.top - 40 + window.scrollY}px`;
    
    floatingTaskBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        // Get the note title
        const titleEl = safeQuery(document, activeSelectors.activeNoteTitle);
        const noteTitle = titleEl ? (safeGetText(titleEl) || titleEl.value || '') : '';
        
        // Open modal with selection data
        showTaskCreateModalWithSelection(selectedText, noteTitle);
        
        // Clear selection and hide button
        window.getSelection().removeAllRanges();
        hideFloatingButton();
    };
    
    document.body.appendChild(floatingTaskBtn);
}

function hideFloatingButton(e) {
    // Don't hide if clicking the button itself
    if (e && e.target.closest('.plugin-floating-task-btn')) {
        return;
    }
    
    if (floatingTaskBtn) {
        floatingTaskBtn.remove();
        floatingTaskBtn = null;
    }
}

/**
 * Scans the source list, identifies files with identical names,
 * and programmatically deletes the duplicates.
 */
async function removeDuplicateSources() {
    const rows = document.querySelectorAll('.single-source-container');
    const seenTitles = new Set();
    const duplicates = [];

    rows.forEach(row => {
        const titleEl = row.querySelector('.source-title');
        if (!titleEl) return;

        const title = titleEl.textContent.trim();
        if (seenTitles.has(title)) {
            duplicates.push(row);
        } else {
            seenTitles.add(title);
        }
    });

    if (duplicates.length === 0) {
        showToast("No duplicate sources found.");
        return;
    }

    showConfirmModal(`Found ${duplicates.length} duplicate sources. Delete them?`, async () => {
        showToast(`Deleting ${duplicates.length} duplicates... Please wait.`);

        for (const row of duplicates) {
            try {
                const moreBtn = row.querySelector('button[aria-label="More"]');
                if (!moreBtn) continue;

                const clickEvent = new MouseEvent('click', { view: window, bubbles: true, cancelable: true });
                moreBtn.dispatchEvent(clickEvent);

                await new Promise(resolve => setTimeout(resolve, 250));

                const menuItems = document.querySelectorAll('.mat-mdc-menu-item');
                const deleteBtn = Array.from(menuItems).find(item => item.textContent.toLowerCase().includes('delete'));

                if (deleteBtn) {
                    deleteBtn.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                    await new Promise(resolve => setTimeout(resolve, 600));
                }
            } catch (err) {
                console.warn("[NotebookLM Tree] Failed to delete a duplicate:", err);
            }
        }

        showToast("Duplicate cleanup complete.");
        setTimeout(safeRunOrganizer, 1000);
    });
}

// --- START ---
setupFloatingTaskButton();

// --- NAMESPACE BRIDGE FOR MODULES ---
// Exposes core functionality for use by other extension modules (e.g., note-popout.js)
window.NotebookLMTree = {
    // State accessors
    getState: () => appState,
    getSearchIndex: () => searchIndex,
    getSelectors: () => activeSelectors,
    
    // Utility functions
    safeQuery,
    safeQueryAll,
    safeGetText,
    safeClick,
    showToast,
    showConfirmModal,
    decompressContent,
    normalizeKey,
    
    // Icons
    ICONS,
    
    // Feature check
    isFeatureEnabled,
    
    // Hooks for module registration
    hooks: {
        onProxyCreated: [],      // Called when a proxy item is created
        onTreeRendered: [],      // Called after tree is rendered
        onNoteOpened: []         // Called when a note is opened/indexed
    },
    
    // Hook trigger helper
    triggerHook: (hookName, ...args) => {
        const hooks = window.NotebookLMTree.hooks[hookName];
        if (hooks && Array.isArray(hooks)) {
            hooks.forEach(fn => {
                try { fn(...args); } catch (e) { console.debug('[NotebookLM Tree] Hook error:', e); }
            });
        }
    }
};

init();