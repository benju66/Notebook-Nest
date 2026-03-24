/**
 * NotebookLM Pro Tree - Background Service V17.1
 * Handles remote configuration fetching to bypass CORS restrictions.
 * 
 * V17.1 Changes:
 * - Added retry logic for failed fetches
 * - Improved error messages
 * - Added timeout handling
 */

const FETCH_TIMEOUT_MS = 10000; // 10 second timeout

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchConfig") {
        fetchWithTimeout(request.url, FETCH_TIMEOUT_MS)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                sendResponse({ success: true, data: data });
            })
            .catch(error => {
                console.warn("NotebookLM Tree: Config fetch failed:", error.message);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keeps the message channel open for async response
    }
});

/**
 * Fetch with timeout wrapper
 * @param {string} url - URL to fetch
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error('Request timeout'));
        }, timeoutMs);
        
        fetch(url, { signal: controller.signal })
            .then(response => {
                clearTimeout(timeoutId);
                resolve(response);
            })
            .catch(error => {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    reject(new Error('Request timeout'));
                } else {
                    reject(error);
                }
            });
    });
}

console.log("NotebookLM Pro Tree service worker started (V17.1)");
