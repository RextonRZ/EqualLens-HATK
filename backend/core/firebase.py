import os
import json
import logging
import firebase_admin
from firebase_admin import credentials, firestore, storage
from typing import Dict, Any, Optional, List
import uuid

logger = logging.getLogger(__name__)

class FirebaseClient:
    """Firebase client for interacting with Firestore and Storage."""
    
    def __init__(self):
        self.db = None
        self.bucket = None
        self.initialized = False
        self.init_firebase()
    
    def init_firebase(self):
        """Initialize Firebase app, Firestore client, and Storage bucket."""
        try:
            # Try to use FIREBASE_CONFIG_PATH from environment variable first
            firebase_config_path = os.getenv("FIREBASE_CONFIG_PATH")
            
            # If not set in .env, use the fallback logic
            if not firebase_config_path or not os.path.exists(firebase_config_path):
                # Add the parent directory as a possible location for the config file
                config_paths = [
                    os.path.join(os.path.dirname(os.path.dirname(__file__)), "equallens-project", "firebase_config.json"),
                    os.path.join(os.path.dirname(os.path.dirname(__file__)), "firebase_config.json"),
                    os.path.join(os.getcwd(), "firebase_config.json"),  # Try current working directory
                    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "equallens-project", "firebase_config.json"),  # Look one directory up
                    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "firebase_config.json")  # Look one directory up
                ]
                
                firebase_config_path = None
                for path in config_paths:
                    logger.info(f"Checking for config at: {path}")
                    if os.path.exists(path):
                        firebase_config_path = path
                        logger.info(f"Found Firebase config at: {path}")
                        break
            else:
                logger.info(f"Using Firebase config from environment variable: {firebase_config_path}")
            
            if not firebase_config_path:
                logger.warning("firebase_config.json file not found in any expected locations")
                logger.warning("Operating in limited mode without Firebase functionality")
                return
            
            cred = credentials.Certificate(firebase_config_path)
            
            # Load and parse the config file to get the exact bucket name
            with open(firebase_config_path, 'r') as config_file:
                config_data = json.load(config_file)
                project_id = config_data.get('project_id', 'equallens-ee9db')
            
            logger.info(f"Project ID from config: {project_id}")
            
            # Initialize Firebase app WITHOUT specifying storage bucket first
            if not firebase_admin._apps:
                firebase_admin.initialize_app(cred)
                logger.info("Firebase initialized without storage bucket specification")
            
            # Initialize Firestore client
            self.db = firestore.client()
            logger.info("Firestore client initialized")
            
            # Try to get bucket name from environment variable first
            bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET")
            if bucket_name:
                logger.info(f"Using bucket name from environment variable: {bucket_name}")
                try:
                    self.bucket = storage.bucket(bucket_name)
                    # Test if the bucket is accessible
                    bucket_exists = self.bucket.exists()
                    if not bucket_exists:
                        logger.warning(f"Bucket {bucket_name} from environment variable doesn't exist")
                        self.bucket = None
                    else:
                        logger.info(f"Found accessible bucket from env var: {self.bucket.name}")
                except Exception as e:
                    logger.error(f"Error accessing bucket {bucket_name} from env var: {e}")
                    self.bucket = None
            
            # If not set in .env or not accessible, use the fallback logic
            if not bucket_name or self.bucket is None:
                # Try multiple bucket naming patterns
                bucket = None
                bucket_options = [
                    f"{project_id}.appspot.com",  # Standard pattern
                    project_id,                    # Just project ID
                    f"gs://{project_id}.appspot.com", # Full gs:// URL
                    f"gs://{project_id}"           # Alternate gs:// URL
                ]
                
                for bucket_name in bucket_options:
                    try:
                        logger.info(f"Trying to access bucket with name: {bucket_name}")
                        bucket = storage.bucket(bucket_name)
                        # Test if the bucket is accessible
                        bucket_exists = bucket.exists()
                        if bucket_exists:
                            logger.info(f"Found accessible bucket: {bucket.name}")
                            self.bucket = bucket
                            break
                        else:
                            logger.warning(f"Bucket {bucket_name} doesn't exist")
                    except Exception as e:
                        logger.error(f"Error accessing bucket {bucket_name}: {e}")
            
            if self.bucket is None:
                logger.warning("Could not access any Firebase Storage buckets")
                logger.warning("Will continue without Storage functionality - file uploads will fail")
                logger.warning(f"Please create a bucket for your project at https://console.firebase.google.com/project/{project_id}/storage")
            
            self.initialized = True
            logger.info("Firebase client initialized successfully")
        
        except Exception as e:
            logger.error(f"Error initializing Firebase: {e}")
            logger.exception("Exception details:")
    
    def get_document(self, collection: str, document_id: str) -> Optional[Dict[str, Any]]:
        """Get a document from Firestore."""
        if not self.initialized or not self.db:
            logger.error("Firebase client not initialized")
            return None
        
        try:
            doc_ref = self.db.collection(collection).document(document_id)
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            else:
                logger.info(f"Document {document_id} not found in collection {collection}")
                return None
        except Exception as e:
            logger.error(f"Error getting document: {e}")
            return None
    
    def create_document(self, collection: str, document_id: str, data: Dict[str, Any]) -> bool:
        """Create a new document in Firestore."""
        if not self.initialized or not self.db:
            logger.error("Firebase client not initialized")
            return False
        
        try:
            doc_ref = self.db.collection(collection).document(document_id)
            doc_ref.set(data)
            logger.info(f"Document {document_id} created in collection {collection}")
            return True
        except Exception as e:
            logger.error(f"Error creating document: {e}")
            return False
    
    def update_document(self, collection: str, document_id: str, data: Dict[str, Any]) -> bool:
        """Update an existing document in Firestore."""
        if not self.initialized or not self.db:
            logger.error("Firebase client not initialized")
            return False
        
        try:
            doc_ref = self.db.collection(collection).document(document_id)
            doc_ref.update(data)
            logger.info(f"Document {document_id} updated in collection {collection}")
            return True
        except Exception as e:
            logger.error(f"Error updating document: {e}")
            return False
    
    def delete_document(self, collection: str, document_id: str) -> bool:
        """Delete a document from Firestore."""
        if not self.initialized or not self.db:
            logger.error("Firebase client not initialized")
            return False
        
        try:
            doc_ref = self.db.collection(collection).document(document_id)
            doc_ref.delete()
            logger.info(f"Document {document_id} deleted from collection {collection}")
            return True
        except Exception as e:
            logger.error(f"Error deleting document: {e}")
            return False
    
    def get_collection(self, collection: str, filters: List[tuple] = None) -> List[Dict[str, Any]]:
        """Get documents from a collection with optional filters."""
        if not self.initialized or not self.db:
            logger.error("Firebase client not initialized")
            return []
        
        try:
            query = self.db.collection(collection)
            
            # Apply filters if provided
            if filters:
                for field, op, value in filters:
                    query = query.where(field, op, value)
            
            docs = query.stream()
            results = []
            for doc in docs:
                data = doc.to_dict()
                data["id"] = doc.id  # Include document ID
                results.append(data)
            
            return results
        except Exception as e:
            logger.error(f"Error getting collection: {e}")
            return []
    
    def upload_file(self, file_content: bytes, storage_path: str, content_type: str) -> Optional[str]:
        """Upload a file to Firebase Storage."""
        if not self.initialized or not self.bucket:
            logger.error("Firebase Storage not initialized")
            return None
        
        try:
            blob = self.bucket.blob(storage_path)
            blob.upload_from_string(file_content, content_type=content_type)
            blob.make_public()
            logger.info(f"File uploaded to {storage_path}")
            return blob.public_url
        except Exception as e:
            logger.error(f"Error uploading file: {e}")
            return None
    
    def generate_counter_id(self, prefix: str) -> str:
        """Generate an ID with format {prefix}-{8_digit_number}"""
        if not self.initialized or not self.db:
            # Fallback to random 8-digit number when db isn't available
            import random
            formatted_number = f"{random.randint(1, 99999999):08d}"
            return f"{prefix}-{formatted_number}"
        
        try:
            # Get the counter reference
            counter_ref = self.db.collection('counters').document(f'{prefix}_counter')
            
            # Use atomic increment operation to update the counter
            counter_ref.set(
                {'count': firestore.Increment(1)}, 
                merge=True
            )
            
            # Get the updated count
            counter_doc = counter_ref.get()
            if counter_doc.exists:
                current_count = counter_doc.to_dict().get('count', 1)
            else:
                # This shouldn't happen due to merge=True above, but just in case
                current_count = 1
                
            # Format as 8-digit number
            formatted_number = f"{current_count:08d}"
            return f"{prefix}-{formatted_number}"
            
        except Exception as e:
            logger.error(f"Error generating ID with atomic increment: {e}")
            # Fallback to random ID if atomic increment fails
            import random
            formatted_number = f"{random.randint(1, 99999999):08d}"
            return f"{prefix}-{formatted_number}"


# Create a singleton instance
firebase_client = FirebaseClient()