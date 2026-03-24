/**
 * NotebookLM Pro Tree - Note Pop-out Module
 * V17.9 - Pop-out notes into separate windows for reference
 * 
 * This module adds the ability to open notes in a separate browser window
 * for side-by-side reference while working in the main NotebookLM interface.
 * 
 * Features:
 * - Pop-out button on proxy items in Studio panel folders
 * - Formatted read-only view with copy functionality
 * - Dark/light theme support matching NotebookLM
 * - Plain text fallback when full content not available
 */

(function() {
    'use strict';
    
    // Wait for main module to initialize
    const INIT_CHECK_INTERVAL = 100;
    const MAX_INIT_ATTEMPTS = 50;
    let initAttempts = 0;
    
    // Track open pop-out windows
    const openWindows = new Map();
    
    /**
     * Initialize the module once NotebookLMTree namespace is available
     */
    function initModule() {
        if (typeof window.NotebookLMTree === 'undefined') {
            initAttempts++;
            if (initAttempts < MAX_INIT_ATTEMPTS) {
                setTimeout(initModule, INIT_CHECK_INTERVAL);
            } else {
                console.warn('[Note Popout] Main module not found after max attempts');
            }
            return;
        }
        
        // Register the pop-out function on the namespace
        window.NotebookLMTree.openNotePopout = openNotePopout;
        
        console.debug('[Note Popout] Module initialized');
    }
    
    /**
     * Open a note in a pop-out window
     * @param {string} title - Note title
     * @param {HTMLElement} nativeRow - The native DOM row element (optional, for getting formatted content)
     */
    function openNotePopout(title, nativeRow) {
        const api = window.NotebookLMTree;
        
        // Check if window already open for this note
        const existingWin = openWindows.get(title);
        if (existingWin && !existingWin.closed) {
            existingWin.focus();
            return;
        }
        
        // Try to get content from various sources
        let content = '';
        let isFormatted = false;
        let displayTitle = title;
        
        const selectors = api.getSelectors();
        
        // Method 1: Check if THIS note is currently open in the editor
        const activeTitleEl = api.safeQuery(document, selectors.activeNoteTitle);
        const activeTitle = activeTitleEl ? (api.safeGetText(activeTitleEl) || activeTitleEl.value || '') : '';
        
        // Normalize titles for comparison (trim whitespace, compare case-insensitive)
        const normalizedActive = activeTitle.trim().toLowerCase();
        const normalizedRequested = title.trim().toLowerCase();
        
        if (normalizedActive && normalizedRequested && normalizedActive === normalizedRequested) {
            // This note is currently open - get formatted content
            const editor = api.safeQuery(document, selectors.activeNoteBody);
            if (editor && editor.innerHTML && editor.innerHTML.trim().length > 0) {
                content = editor.innerHTML;
                isFormatted = true;
                displayTitle = activeTitle; // Use actual title from editor
            }
        }
        
        // Method 2: If not currently open, click to open first, then grab content
        if (!content && nativeRow) {
            // Click the native row to open the note
            const titleEl = api.safeQuery(nativeRow, selectors.studioTitle);
            if (titleEl) {
                api.safeClick(titleEl);
            } else {
                api.safeClick(nativeRow);
            }
            
            // Wait for note to load, then try again
            api.showToast('Loading note...');
            setTimeout(() => {
                openNotePopoutAfterLoad(title);
            }, 600);
            return;
        }
        
        // Method 3: Fallback to search index (plain text) - only if no nativeRow to click
        if (!content) {
            const searchIndex = api.getSearchIndex();
            const key = api.normalizeKey(title);
            const compressed = searchIndex[key];
            if (compressed) {
                content = api.decompressContent(compressed, key);
                isFormatted = false;
            }
        }
        
        // If still no content, show error
        if (!content) {
            api.showToast('No content available');
            return;
        }
        
        // Open the pop-out window
        openPopoutWindow(displayTitle, content, isFormatted);
    }
    
    /**
     * Attempt to open pop-out after note has been clicked and loaded
     */
    function openNotePopoutAfterLoad(originalTitle) {
        const api = window.NotebookLMTree;
        const selectors = api.getSelectors();
        
        let content = '';
        let isFormatted = false;
        let displayTitle = originalTitle;
        
        // Try to get formatted content from now-active editor
        const editor = api.safeQuery(document, selectors.activeNoteBody);
        if (editor && editor.innerHTML && editor.innerHTML.trim().length > 0) {
            content = editor.innerHTML;
            isFormatted = true;
            
            // Get the actual title from the editor
            const activeTitleEl = api.safeQuery(document, selectors.activeNoteTitle);
            if (activeTitleEl) {
                const actualTitle = api.safeGetText(activeTitleEl) || activeTitleEl.value;
                if (actualTitle) displayTitle = actualTitle;
            }
        }
        
        // Fallback to search index if editor grab failed
        if (!content) {
            const searchIndex = api.getSearchIndex();
            const key = api.normalizeKey(originalTitle);
            const compressed = searchIndex[key];
            if (compressed) {
                content = api.decompressContent(compressed, key);
                isFormatted = false;
            }
        }
        
        if (!content) {
            api.showToast('Could not load note content');
            return;
        }
        
        openPopoutWindow(displayTitle, content, isFormatted);
    }
    
    /**
     * Create and open the pop-out window
     */
    function openPopoutWindow(title, content, isFormatted) {
        const api = window.NotebookLMTree;
        
        // Detect theme
        const isDark = document.body.classList.contains('dark-theme');
        
        // Generate pop-out HTML
        const html = generatePopoutHTML(title, content, isFormatted, isDark);
        
        // Open window
        const width = 600;
        const height = 700;
        const left = window.screenX + window.outerWidth - width - 50;
        const top = window.screenY + 50;
        
        const win = window.open(
            '',
            `notebooklm-popout-${Date.now()}`,
            `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );
        
        if (!win) {
            api.showToast('Pop-up blocked. Please allow pop-ups for this site.');
            return;
        }
        
        win.document.write(html);
        win.document.close();
        
        // Track the window
        openWindows.set(title, win);
        
        // Clean up tracking when window closes
        const checkClosed = setInterval(() => {
            if (win.closed) {
                openWindows.delete(title);
                clearInterval(checkClosed);
            }
        }, 1000);
        
        api.showToast(`Opened "${title.substring(0, 30)}${title.length > 30 ? '...' : ''}" in new window`);
    }
    
    /**
     * Generate the HTML content for the pop-out window
     */
    function generatePopoutHTML(title, content, isFormatted, isDark) {
        const bgColor = isDark ? '#202124' : '#ffffff';
        const textColor = isDark ? '#e8eaed' : '#3c4043';
        const secondaryColor = isDark ? '#9aa0a6' : '#5f6368';
        const borderColor = isDark ? '#3c4043' : '#e8eaed';
        const accentColor = isDark ? '#8ab4f8' : '#1a73e8';
        const headerBg = isDark ? '#28292a' : '#f8f9fa';
        
        // Escape title for use in HTML
        const safeTitle = escapeHtml(title);
        
        // Process content
        let bodyContent;
        if (isFormatted) {
            bodyContent = content;
        } else {
            // Convert plain text to paragraphs
            bodyContent = '<p>' + escapeHtml(content).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
        }
        
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${safeTitle} - NotebookLM</title>
    <style>
        * {
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
            background-color: ${bgColor};
            color: ${textColor};
            margin: 0;
            padding: 0;
            line-height: 1.6;
        }
        
        .popout-header {
            position: sticky;
            top: 0;
            background: ${headerBg};
            border-bottom: 1px solid ${borderColor};
            padding: 12px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            z-index: 100;
        }
        
        .popout-title {
            font-size: 16px;
            font-weight: 500;
            color: ${textColor};
            margin: 0;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .popout-badge {
            font-size: 10px;
            color: ${secondaryColor};
            background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'};
            padding: 2px 8px;
            border-radius: 10px;
            margin-left: 8px;
            flex-shrink: 0;
        }
        
        .popout-content {
            padding: 24px;
            max-width: 800px;
            margin: 0 auto;
            padding-bottom: 60px;
        }
        
        .popout-content p {
            margin: 0 0 16px 0;
        }
        
        .popout-content h1, .popout-content h2, .popout-content h3 {
            color: ${textColor};
            margin: 24px 0 12px 0;
        }
        
        .popout-content h1 { font-size: 24px; }
        .popout-content h2 { font-size: 20px; }
        .popout-content h3 { font-size: 16px; }
        
        .popout-content ul, .popout-content ol {
            margin: 0 0 16px 0;
            padding-left: 24px;
        }
        
        .popout-content li {
            margin-bottom: 8px;
        }
        
        .popout-content a {
            color: ${accentColor};
        }
        
        .popout-content blockquote {
            border-left: 3px solid ${accentColor};
            margin: 16px 0;
            padding: 8px 16px;
            background: ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)'};
        }
        
        .popout-content code {
            background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'};
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Roboto Mono', monospace;
            font-size: 13px;
        }
        
        .popout-content pre {
            background: ${isDark ? '#1a1a1a' : '#f5f5f5'};
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
        }
        
        .popout-content pre code {
            background: none;
            padding: 0;
        }
        
        .popout-content img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
        }
        
        .popout-content table {
            width: 100%;
            border-collapse: collapse;
            margin: 16px 0;
        }
        
        .popout-content th, .popout-content td {
            border: 1px solid ${borderColor};
            padding: 8px 12px;
            text-align: left;
        }
        
        .popout-content th {
            background: ${headerBg};
        }
        
        .read-only-notice {
            font-size: 11px;
            color: ${secondaryColor};
            text-align: center;
            padding: 8px;
            border-top: 1px solid ${borderColor};
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: ${headerBg};
        }
    </style>
</head>
<body>
    <div class="popout-header">
        <h1 class="popout-title">${safeTitle}</h1>
        <span class="popout-badge">${isFormatted ? 'Formatted' : 'Plain text'}</span>
    </div>
    
    <div class="popout-content" id="content">
        ${bodyContent}
    </div>
    
    <div class="read-only-notice">
        📖 Read-only view • Changes made here won't be saved
    </div>
</body>
</html>`;
    }
    
    /**
     * Escape HTML special characters
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Start initialization
    initModule();
    
})();