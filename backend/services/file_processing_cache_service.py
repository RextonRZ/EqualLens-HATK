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


@dataclass
class RelevanceAnalysisResult:
    """Container for job-specific relevance analysis results."""
    job_id: str
    file_hash: str
    file_name: str
    processed_at: float
    is_irrelevant: bool
    irrelevance_payload: Optional[Dict[str, Any]] = None
    relevance_data: Optional[Dict[str, Any]] = None  # Store full relevance analysis result


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
        self._cache: Dict[str, ProcessedFileResult] = {}  # Global file cache (AI detection, doc processing)
        self._relevance_cache: Dict[str, RelevanceAnalysisResult] = {}  # Job-specific relevance cache
        self._file_sessions: Dict[str, Dict[str, ProcessedFileResult]] = {}
        self._cache_hits = 0
        self._cache_misses = 0
        self._relevance_cache_hits = 0
        self._relevance_cache_misses = 0
        self._max_cache_size = 1000  # Maximum number of cached results
        self._max_relevance_cache_size = 2000  # Larger since we store per job-file combo
        self._ttl_seconds = 3600  # 1 hour TTL
        self._relevance_ttl_seconds = 7200  # 2 hours TTL for relevance cache
        self._initialized = True
        logger.info("FileProcessingCacheService initialized with relevance caching")

    @staticmethod
    def generate_file_hash(file_content: bytes, file_name: str, file_size: int) -> str:
        """Generate a unique hash for file content and metadata."""
        hasher = hashlib.sha256()
        hasher.update(file_content)
        hasher.update(file_name.encode('utf-8'))
        hasher.update(str(file_size).encode('utf-8'))
        return hasher.hexdigest()

    @staticmethod
    def generate_relevance_cache_key(job_id: str, file_hash: str) -> str:
        """Generate a unique cache key for job-specific relevance analysis."""
        return f"{job_id}:{file_hash}"

    def _cleanup_expired_entries(self):
        """Remove expired cache entries."""
        current_time = time.time()
        expired_keys = []

        # Cleanup global file cache
        for key, result in self._cache.items():
            if current_time - result.processed_at > self._ttl_seconds:
                expired_keys.append(key)

        for key in expired_keys:
            del self._cache[key]
            logger.debug(f"Removed expired cache entry: {key}")

        # Cleanup relevance cache
        expired_relevance_keys = []
        for key, result in self._relevance_cache.items():
            if current_time - result.processed_at > self._relevance_ttl_seconds:
                expired_relevance_keys.append(key)

        for key in expired_relevance_keys:
            del self._relevance_cache[key]
            logger.debug(f"Removed expired relevance cache entry: {key}")

    def _enforce_cache_size_limit(self):
        """Remove oldest entries if cache exceeds maximum size."""
        # Enforce global cache size limit
        if len(self._cache) > self._max_cache_size:
            sorted_items = sorted(self._cache.items(), key=lambda x: x[1].processed_at)
            entries_to_remove = len(self._cache) - self._max_cache_size

            for i in range(entries_to_remove):
                key = sorted_items[i][0]
                del self._cache[key]
                logger.debug(f"Removed old cache entry due to size limit: {key}")

        # Enforce relevance cache size limit
        if len(self._relevance_cache) > self._max_relevance_cache_size:
            sorted_items = sorted(self._relevance_cache.items(), key=lambda x: x[1].processed_at)
            entries_to_remove = len(self._relevance_cache) - self._max_relevance_cache_size

            for i in range(entries_to_remove):
                key = sorted_items[i][0]
                del self._relevance_cache[key]
                logger.debug(f"Removed old relevance cache entry due to size limit: {key}")

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

    def get_cached_relevance_result(self, job_id: str, file_hash: str) -> Optional[RelevanceAnalysisResult]:
        """Retrieve cached relevance analysis result for a job-file combination."""
        with self._lock:
            self._cleanup_expired_entries()
            
            cache_key = self.generate_relevance_cache_key(job_id, file_hash)
            
            if cache_key in self._relevance_cache:
                self._relevance_cache_hits += 1
                result = self._relevance_cache[cache_key]
                logger.info(f"Relevance cache HIT for job {job_id}, file: {result.file_name}")
                return result
            else:
                self._relevance_cache_misses += 1
                logger.info(f"Relevance cache MISS for job {job_id}, file hash: {file_hash[:16]}...")
                return None

    def cache_result(self, file_hash: str, result: ProcessedFileResult):
        """Store analysis result in cache."""
        with self._lock:
            self._cleanup_expired_entries()
            self._enforce_cache_size_limit()

            result.processed_at = time.time()
            self._cache[file_hash] = result
            logger.info(f"Cached result for file: {result.file_name} (hash: {file_hash[:16]}...)")

    def cache_relevance_result(self, job_id: str, file_hash: str, file_name: str, 
                             is_irrelevant: bool, irrelevance_payload: Optional[Dict[str, Any]] = None,
                             relevance_data: Optional[Dict[str, Any]] = None):
        """Store job-specific relevance analysis result in cache."""
        with self._lock:
            self._cleanup_expired_entries()
            self._enforce_cache_size_limit()

            cache_key = self.generate_relevance_cache_key(job_id, file_hash)
            
            relevance_result = RelevanceAnalysisResult(
                job_id=job_id,
                file_hash=file_hash,
                file_name=file_name,
                processed_at=time.time(),
                is_irrelevant=is_irrelevant,
                irrelevance_payload=irrelevance_payload,
                relevance_data=relevance_data
            )
            
            self._relevance_cache[cache_key] = relevance_result
            logger.info(f"Cached relevance result for job {job_id}, file: {file_name} (irrelevant: {is_irrelevant})")

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

    def clear_relevance_cache_for_job(self, job_id: str):
        """Clear all relevance cache entries for a specific job."""
        with self._lock:
            keys_to_remove = [key for key in self._relevance_cache.keys() if key.startswith(f"{job_id}:")]
            
            for key in keys_to_remove:
                del self._relevance_cache[key]
                
            logger.info(f"Cleared {len(keys_to_remove)} relevance cache entries for job {job_id}")

    def clear_all_relevance_cache(self):
        """Clear all relevance cache entries."""
        with self._lock:
            count = len(self._relevance_cache)
            self._relevance_cache.clear()
            logger.info(f"Cleared all {count} relevance cache entries")

    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache performance statistics."""
        total_requests = self._cache_hits + self._cache_misses
        hit_rate = (self._cache_hits / total_requests * 100) if total_requests > 0 else 0
        
        total_relevance_requests = self._relevance_cache_hits + self._relevance_cache_misses
        relevance_hit_rate = (self._relevance_cache_hits / total_relevance_requests * 100) if total_relevance_requests > 0 else 0

        return {
            "cache_size": len(self._cache),
            "cache_hits": self._cache_hits,
            "cache_misses": self._cache_misses,
            "hit_rate_percentage": round(hit_rate, 2),
            "relevance_cache_size": len(self._relevance_cache),
            "relevance_cache_hits": self._relevance_cache_hits,
            "relevance_cache_misses": self._relevance_cache_misses,
            "relevance_hit_rate_percentage": round(relevance_hit_rate, 2),
            "active_sessions": len(self._file_sessions)
        }

    def clear_all_cache(self):
        """Clear all cached data."""
        with self._lock:
            self._cache.clear()
            self._relevance_cache.clear()
            self._file_sessions.clear()
            self._cache_hits = 0
            self._cache_misses = 0
            self._relevance_cache_hits = 0
            self._relevance_cache_misses = 0
            logger.info("Cleared all file processing cache and relevance cache")


# Global instance
file_cache_service = FileProcessingCacheService()