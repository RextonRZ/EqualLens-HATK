from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# For debugging purposes
print("Starting FastAPI application...")
print(f"Current working directory: {os.getcwd()}")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

# Import API routers
from api import interviews, jobs, candidates, interview_questions, bias_detection_requests

# Initialize FastAPI app
app = FastAPI(title="EqualLens API", 
              description="API for EqualLens job and CV management",
              version="1.0.0")

# Configure CORS to allow requests from your React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins temporarily for debugging
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept"],
)

# Include the API routers
app.include_router(interviews.router, prefix="/api/interviews", tags=["interviews"])
app.include_router(jobs.router, prefix="/api/jobs", tags=["jobs"])  # Fixed prefix to match `/api/jobs`
app.include_router(candidates.router, prefix="/api/candidates", tags=["candidates"])
app.include_router(interview_questions.router, prefix="/api/interview-questions", tags=["interview-questions"])
app.include_router(bias_detection_requests.router, prefix="/api/bias-detection", tags=["bias-detection-requests"])

@app.get("/")
async def root():
    return {"message": "EqualLens API is running"}

@app.get("/health")
async def health_check():
    """Health check endpoint to verify API is accessible"""
    from core.firebase import firebase_client
    
    firebase_status = {
        "initialized": firebase_client.initialized,
        "db_available": firebase_client.db is not None,
        "storage_available": firebase_client.bucket is not None
    }
    
    # Get expected config paths for diagnostics
    config_paths = [
        os.path.join(os.path.dirname(__file__), "equallens-project", "firebase_config.json"),
        os.path.join(os.path.dirname(__file__), "firebase_config.json"),
        os.path.join(os.getcwd(), "firebase_config.json"),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "equallens-project", "firebase_config.json"),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "firebase_config.json")
    ]
    
    config_path_exists = {path: os.path.exists(path) for path in config_paths}
    
    return {
        "status": "healthy",
        "firebase": firebase_status,
        "environment": {
            "cwd": os.getcwd(),
            "firebase_config_env": os.getenv("FIREBASE_CONFIG_PATH"),
            "config_paths_checked": config_path_exists
        }
    }

# Start the server
if __name__ == "__main__":
    import uvicorn
    print("Starting uvicorn server on http://localhost:8000")
    print("Access the API documentation at http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)
    print("Server stopped.")