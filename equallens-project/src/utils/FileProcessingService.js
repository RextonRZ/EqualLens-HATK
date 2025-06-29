class FileProcessingService {
    constructor() {
        this.cache = new Map();
        this.sessions = new Map();
        this.maxCacheSize = 100;
        this.ttlMs = 30 * 60 * 1000; // 30 minutes
    }

    /**
     * Generate a client-side file hash
     */
    async generateFileHash(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            return `${hashHex.substring(0, 16)}-${file.name}-${file.size}`;
        } catch (error) {
            console.error('Error generating file hash:', error);
            // Fallback to simple hash
            return `${file.name}-${file.size}-${file.lastModified}`;
        }
    }

    /**
     * Check if a file has been processed before
     */
    isFileProcessed(fileHash) {
        const cached = this.cache.get(fileHash);
        if (!cached) return false;

        // Check if cache entry is still valid
        const now = Date.now();
        if (now - cached.timestamp > this.ttlMs) {
            this.cache.delete(fileHash);
            return false;
        }

        return true;
    }

    /**
     * Cache file processing result
     */
    cacheFileResult(fileHash, result) {
        // Enforce cache size limit
        if (this.cache.size >= this.maxCacheSize) {
            // Remove oldest entry
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        this.cache.set(fileHash, {
            ...result,
            timestamp: Date.now()
        });
    }

    /**
     * Get cached file result
     */
    getCachedResult(fileHash) {
        const cached = this.cache.get(fileHash);
        if (!cached) return null;

        // Check if cache entry is still valid
        const now = Date.now();
        if (now - cached.timestamp > this.ttlMs) {
            this.cache.delete(fileHash);
            return null;
        }

        return cached;
    }

    /**
     * Create a new processing session
     */
    createSession(sessionId) {
        this.sessions.set(sessionId, {
            files: new Map(),
            createdAt: Date.now()
        });
        return sessionId;
    }

    /**
     * Add file to session
     */
    addToSession(sessionId, fileHash, fileData) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.files.set(fileHash, fileData);
        }
    }

    /**
     * Get session files
     */
    getSessionFiles(sessionId) {
        const session = this.sessions.get(sessionId);
        return session ? Array.from(session.files.values()) : [];
    }

    /**
     * Clear session
     */
    clearSession(sessionId) {
        this.sessions.delete(sessionId);
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            cacheSize: this.cache.size,
            activeSessions: this.sessions.size,
            maxCacheSize: this.maxCacheSize,
            ttlMinutes: this.ttlMs / (60 * 1000)
        };
    }

    /**
     * Clear all cache
     */
    clearCache() {
        this.cache.clear();
        this.sessions.clear();
    }

    /**
     * Clean up expired entries
     */
    cleanup() {
        const now = Date.now();

        // Clean up expired cache entries
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.ttlMs) {
                this.cache.delete(key);
            }
        }

        // Clean up old sessions (older than 1 hour)
        const sessionTtl = 60 * 60 * 1000; // 1 hour
        for (const [sessionId, session] of this.sessions.entries()) {
            if (now - session.createdAt > sessionTtl) {
                this.sessions.delete(sessionId);
            }
        }
    }
}

// Create singleton instance
const fileProcessingService = new FileProcessingService();

// Set up periodic cleanup
setInterval(() => {
    fileProcessingService.cleanup();
}, 5 * 60 * 1000); // Clean up every 5 minutes

export default fileProcessingService;