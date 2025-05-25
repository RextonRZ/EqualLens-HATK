# services/external_ai_detection_service.py
import httpx
import logging
import os
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)
EXTERNAL_AI_DETECTOR_URL = os.getenv("EXTERNAL_AI_DETECTOR_URL")


class ExternalAIDetectionService:
    async def predict_resume_source(self, resume_text: str, resume_id: Optional[str] = None) -> Optional[
        Dict[str, Any]]:
        if not EXTERNAL_AI_DETECTOR_URL:
            logger.warning("EXTERNAL_AI_DETECTOR_URL not configured. Skipping external AI detection.")
            return {"error": "External AI detector not configured.", "predicted_class_label": "Unknown",
                    "confidence_scores": {}}

        if not resume_text or len(resume_text) < 10:
            logger.info(
                f"Resume text for ID '{resume_id}' is too short (length {len(resume_text)}) for external AI detection. Skipping.")
            return {"error": "Text too short for detection.", "predicted_class_label": "Unknown",
                    "confidence_scores": {}}

        payload = {"id": resume_id, "text": resume_text}
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                logger.info(f"Sending request to external AI detector: {EXTERNAL_AI_DETECTOR_URL} for ID '{resume_id}'")
                response = await client.post(EXTERNAL_AI_DETECTOR_URL, json=payload)

            response.raise_for_status()
            result = response.json()
            logger.info(f"External AI detection result for ID '{resume_id}': {result.get('predicted_class_label')}")
            return result
        except httpx.HTTPStatusError as e:
            logger.error(
                f"HTTP error calling external AI detection API for ID '{resume_id}': {e.response.status_code} - {e.response.text[:500]}")
            return {"error": f"API request failed with status {e.response.status_code}",
                    "details": e.response.text[:500], "predicted_class_label": "Error", "confidence_scores": {}}
        except httpx.RequestError as e:
            logger.error(f"Request error calling external AI detection API for ID '{resume_id}': {e}")
            return {"error": f"Request to AI detection service failed: {str(e)}", "predicted_class_label": "Error",
                    "confidence_scores": {}}
        except Exception as e:
            logger.error(f"Unexpected error in external AI detection for ID '{resume_id}': {e}", exc_info=True)
            return {"error": f"Unexpected error: {str(e)}", "predicted_class_label": "Error", "confidence_scores": {}}

    async def predict_batch_resumes(self, resume_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        # The provided predictor_app.py does not have a batch endpoint.
        # Calling predict_resume_source individually.
        results = []
        for item in resume_items:
            result = await self.predict_resume_source(item["text"], item.get("id"))
            results.append(
                result or {"id": item.get("id"), "error": "Skipped or failed", "predicted_class_label": "Error",
                           "confidence_scores": {}})
        return results


external_ai_service = ExternalAIDetectionService()