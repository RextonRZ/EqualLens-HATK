import re
import logging
from typing import Any  # Add this import
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

logger = logging.getLogger(__name__)

class TextSimilarityProcessor:
    """Utility class for text preprocessing and similarity calculations."""
    
    @staticmethod
    def preprocess_text(text: str) -> str:
        """Preprocess text for TF-IDF vectorization."""
        if not text:
            return ""
        
        # Convert to lowercase
        text = text.lower()
        
        # Remove special characters and digits
        text = re.sub(r'[^\w\s]', ' ', text)
        
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        
        return text

    @staticmethod
    def compute_tfidf_similarity(text1: str, text2: str) -> float:
        """
        Compute the TF-IDF cosine similarity between two pieces of text.

        Args:
            text1 (str): The first text to compare.
            text2 (str): The second text to compare.

        Returns:
            float: A similarity score between 0.0 and 1.0.
        """
        if not text1 or not text2:
            # If either text is empty, return 0 similarity
            return 0.0

        # Create a TF-IDF vectorizer
        vectorizer = TfidfVectorizer()

        # Fit and transform the texts
        tfidf_matrix = vectorizer.fit_transform([text1, text2])

        # Compute cosine similarity
        similarity = cosine_similarity(tfidf_matrix[0:1], tfidf_matrix[1:2])

        # Return the similarity score (a single value)
        return similarity[0][0]


def serialize_firebase_data(data: Any) -> Any:
    """
    Recursively convert Firebase data types to JSON serializable types.
    Handles DatetimeWithNanoseconds by converting to ISO format strings.
    """
    # Handle None type
    if data is None:
        return None
    
    # Handle datetime objects (including Firebase's DatetimeWithNanoseconds)
    if hasattr(data, 'timestamp') and callable(getattr(data, 'timestamp')):
        try:
            # Convert to standard datetime then to ISO format string
            return data.isoformat()
        except Exception as e:
            logger.error(f"Error converting timestamp: {e}")
            # Return string representation as fallback
            return str(data)
    
    # Handle dictionaries
    if isinstance(data, dict):
        return {k: serialize_firebase_data(v) for k, v in data.items()}
    
    # Handle lists
    if isinstance(data, list):
        return [serialize_firebase_data(item) for item in data]
    
    # Handle sets
    if isinstance(data, set):
        return [serialize_firebase_data(item) for item in data]
    
    # Return primitive types as is
    return data
