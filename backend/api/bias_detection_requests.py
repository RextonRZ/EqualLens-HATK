from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any
import logging
from services.gemini_service import GeminiService
from services.bias_detection_request_service import BiasDetectionRequestService
from models.bias_detection_request import BiasDetectionResponse, BiasDetectionRequest

router = APIRouter()
logger = logging.getLogger(__name__)

def get_bias_detection_service():
    try:
        # The service will initialize its own Gemini client
        return BiasDetectionRequestService()
    except Exception as e:
        logger.error(f"Failed to initialize BiasDetectionRequestService: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to initialize bias detection service")

@router.post("/analyze", response_model=BiasDetectionResponse)
async def analyze_job_posting_bias(
    request: BiasDetectionRequest,
    bias_detection_service: BiasDetectionRequestService = Depends(get_bias_detection_service)
):
    """
    Analyze a job posting for potential biases in language, requirements, or expectations.
    """
    try:
        analysis = await bias_detection_service.analyze_job_posting(request)
        return analysis
    except ValueError as ve:
        logger.error(f"Validation error in bias analysis: {str(ve)}")
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in bias detection endpoint: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error analyzing job posting: {str(e)}")