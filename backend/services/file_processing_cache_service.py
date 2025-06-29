import hashlib
import logging
import time
from typing import Dict, Any, Optional, Tuple
from dataclasses import dataclass
from threading import RLock
import weakref

logger = logging.getLogger(__name__)

@dataclass
class ProcessedFileResult:
    """Container for processed file analysis results."""
    file_hash: str
    file_name: str
    file_size: int
    processed_at: float
    status: str
    ai_detection_payload: Optional[Dict[str, Any]] = None
    irrelevance_payload: Optional[Dict[str, Any]] = None
    duplicate_info_raw: Optional[Dict[str, Any]] = None
    document_ai_results: Optional[Dict[str, Any]] = None
    authenticity_analysis_result: Optional[Dict[str, Any]] = None
    cross_referencing_result: Optional[Dict[str, Any]] = None
    external_ai_detection_data: Optional[Dict[str, Any]] = None
    final_assessment_data: Optional[Dict[str, Any]] = None
    content_type: str = "application/pdf"
    user_time_zone: str = "UTC"


class FileProcessingCacheService:
    """Service for caching file processing results to avoid redundant analysis."""

    _instance = None
    _lock = RLock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if hasattr(self, '_initialized'):
            return
        self._cache: Dict[str, ProcessedFileResult] = {}
        self._file_sessions: Dict[str, Dict[str, ProcessedFileResult]] = {}
        self._cache_hits = 0
        self._cache_misses = 0
        self._max_cache_size = 1000  # Maximum number of cached results
        self._ttl_seconds = 3600  # 1 hour TTL
        self._initialized = True
        logger.info("FileProcessingCacheService initialized")

    @staticmethod
    def generate_file_hash(file_content: bytes, file_name: str, file_size: int) -> str:
        """Generate a unique hash for file content and metadata."""
        hasher = hashlib.sha256()
        hasher.update(file_content)
        hasher.update(file_name.encode('utf-8'))
        hasher.update(str(file_size).encode('utf-8'))
        return hasher.hexdigest()

    def _cleanup_expired_entries(self):
        """Remove expired cache entries."""
        current_time = time.time()
        expired_keys = []

        for key, result in self._cache.items():
            if current_time - result.processed_at > self._ttl_seconds:
                expired_keys.append(key)

        for key in expired_keys:
            del self._cache[key]
            logger.debug(f"Removed expired cache entry: {key}")

    def _enforce_cache_size_limit(self):
        """Remove oldest entries if cache exceeds maximum size."""
        if len(self._cache) <= self._max_cache_size:
            return

        # Sort by processed_at timestamp and remove oldest entries
        sorted_items = sorted(self._cache.items(), key=lambda x: x[1].processed_at)
        entries_to_remove = len(self._cache) - self._max_cache_size

        for i in range(entries_to_remove):
            key = sorted_items[i][0]
            del self._cache[key]
            logger.debug(f"Removed old cache entry due to size limit: {key}")

    def get_cached_result(self, file_hash: str) -> Optional[ProcessedFileResult]:
        """Retrieve cached analysis result for a file."""
        with self._lock:
            self._cleanup_expired_entries()

            if file_hash in self._cache:
                self._cache_hits += 1
                result = self._cache[file_hash]
                logger.info(f"Cache HIT for file hash: {file_hash[:16]}... (file: {result.file_name})")
                return result
            else:
                self._cache_misses += 1
                logger.info(f"Cache MISS for file hash: {file_hash[:16]}...")
                return None

    def cache_result(self, file_hash: str, result: ProcessedFileResult):
        """Store analysis result in cache."""
        with self._lock:
            self._cleanup_expired_entries()
            self._enforce_cache_size_limit()

            result.processed_at = time.time()
            self._cache[file_hash] = result
            logger.info(f"Cached result for file: {result.file_name} (hash: {file_hash[:16]}...)")

    def create_session(self, session_id: str) -> str:
        """Create a new file processing session."""
        with self._lock:
            self._file_sessions[session_id] = {}
            logger.info(f"Created file processing session: {session_id}")
            return session_id

    def add_to_session(self, session_id: str, file_hash: str, result: ProcessedFileResult):
        """Add a processed file result to a session."""
        with self._lock:
            if session_id not in self._file_sessions:
                self._file_sessions[session_id] = {}

            self._file_sessions[session_id][file_hash] = result
            # Also cache globally
            self.cache_result(file_hash, result)

    def get_session_results(self, session_id: str) -> Dict[str, ProcessedFileResult]:
        """Get all results for a session."""
        with self._lock:
            return self._file_sessions.get(session_id, {}).copy()

    def clear_session(self, session_id: str):
        """Clear a file processing session."""
        with self._lock:
            if session_id in self._file_sessions:
                del self._file_sessions[session_id]
                logger.info(f"Cleared file processing session: {session_id}")

    def invalidate_file(self, file_hash: str):
        """Invalidate a specific file's cache entry."""
        with self._lock:
            if file_hash in self._cache:
                del self._cache[file_hash]
                logger.info(f"Invalidated cache for file hash: {file_hash[:16]}...")

    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache performance statistics."""
        total_requests = self._cache_hits + self._cache_misses
        hit_rate = (self._cache_hits / total_requests * 100) if total_requests > 0 else 0

        return {
            "cache_size": len(self._cache),
            "cache_hits": self._cache_hits,
            "cache_misses": self._cache_misses,
            "hit_rate_percentage": round(hit_rate, 2),
            "active_sessions": len(self._file_sessions)
        }

    def clear_all_cache(self):
        """Clear all cached data."""
        with self._lock:
            self._cache.clear()
            self._file_sessions.clear()
            self._cache_hits = 0
            self._cache_misses = 0
            logger.info("Cleared all file processing cache")


# Global instance
file_cache_service = FileProcessingCacheService()