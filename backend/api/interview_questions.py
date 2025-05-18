from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from models.interview_question import InterviewQuestionSet, InterviewQuestionActual
from services.iv_ques_store_service import InterviewQuestionSetService
from services.iv_ques_finalized_service import InterviewQuestionActualService
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/question-set", response_model=str)
async def create_question_set(data: InterviewQuestionSet):
    """Create a new InterviewQuestionSet."""
    question_set_id = InterviewQuestionSetService.create_question_set(data)
    if not question_set_id:
        raise HTTPException(status_code=500, detail="Failed to create InterviewQuestionSet")
    return question_set_id

@router.get("/question-set/{application_id}", response_model=InterviewQuestionSet)
async def get_question_set(application_id: str):
    """Fetch an InterviewQuestionSet by applicationId."""
    try:
        logger.info(f"Fetching InterviewQuestionSet for applicationId: {application_id}")
        question_set = InterviewQuestionSetService.get_question_set(application_id)
        if not question_set:
            logger.warning(f"InterviewQuestionSet not found for applicationId: {application_id}")
            raise HTTPException(status_code=404, detail="InterviewQuestionSet not found")
        
        # Ensure aiGenerationUsed exists in the response - default to False if not set
        if not hasattr(question_set, "aiGenerationUsed"):
            question_set.aiGenerationUsed = False
            logger.info(f"Added missing aiGenerationUsed (False) for {application_id}")
        else:
            logger.info(f"Found aiGenerationUsed: {question_set.aiGenerationUsed} for {application_id}")
            
        logger.info(f"Fetched InterviewQuestionSet successfully for applicationId: {application_id}")
        return question_set
    except HTTPException as he:
        # Re-raise HTTP exceptions to preserve the status code (like 404)
        logger.warning(f"HTTP error for applicationId {application_id}: {he.detail}")
        raise
    except Exception as e:
        logger.error(f"Error fetching InterviewQuestionSet for applicationId {application_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch InterviewQuestionSet: {str(e)}")

@router.delete("/question-set/{application_id}", response_model=Dict[str, Any])
async def delete_question_set(application_id: str):
    """Delete an InterviewQuestionSet by applicationId."""
    try:
        logger.info(f"Deleting InterviewQuestionSet for applicationId: {application_id}")
        
        # First, attempt to delete associated actual questions
        from services.iv_ques_finalized_service import InterviewQuestionActualService
        
        try:
            # Try to delete actual questions first
            actual_deleted = InterviewQuestionActualService.delete_actual_questions(application_id)
            if actual_deleted:
                logger.info(f"Successfully deleted InterviewQuestionActual for applicationId: {application_id}")
            else:
                logger.info(f"No InterviewQuestionActual found for applicationId: {application_id}")
        except Exception as actual_err:
            logger.warning(f"Error when deleting InterviewQuestionActual: {actual_err}")
            # Continue with question set deletion even if actual deletion fails
        
        # Now delete the question set
        result = InterviewQuestionSetService.delete_question_set(application_id)
        if not result:
            logger.warning(f"Failed to delete InterviewQuestionSet for applicationId: {application_id}")
            raise HTTPException(status_code=404, detail="InterviewQuestionSet not found or could not be deleted")
        
        logger.info(f"Successfully deleted InterviewQuestionSet for applicationId: {application_id}")
        return {"success": True, "message": "Question set deleted successfully"}
    except HTTPException as he:
        logger.warning(f"HTTP error when deleting question set for applicationId {application_id}: {he.detail}")
        raise
    except Exception as e:
        logger.error(f"Error deleting InterviewQuestionSet for applicationId {application_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete InterviewQuestionSet: {str(e)}")

@router.post("/actual-questions", response_model=str)
async def create_actual_questions(data: InterviewQuestionActual):
    """Create a new InterviewQuestionActual."""
    actual_id = InterviewQuestionActualService.create_actual_questions(data)
    if not actual_id:
        raise HTTPException(status_code=500, detail="Failed to create InterviewQuestionActual")
    return actual_id

@router.get("/actual-questions/{application_id}", response_model=InterviewQuestionActual)
async def get_actual_questions(application_id: str):
    """Fetch an InterviewQuestionActual by applicationId."""
    actual_questions = InterviewQuestionActualService.get_actual_questions(application_id)
    if not actual_questions:
        raise HTTPException(status_code=404, detail="InterviewQuestionActual not found")
    return actual_questions

@router.post("/save-question-set", response_model=str)
async def save_question_set(data: Dict[str, Any]):
    """Save or update an InterviewQuestionSet."""
    try:
        # Process the incoming data to ensure correct modification flags
        if "sections" in data:
            for section in data["sections"]:
                if "questions" in section:
                    for question in section["questions"]:
                        # For AI-generated questions
                        if question.get("isAIGenerated") == True:
                            # Ensure we have originalText to compare against
                            if not question.get("originalText"):
                                question["originalText"] = question.get("text", "")
                            
                            # Determine if the AI question has been modified
                            text_modified = question.get("text") != question.get("originalText")
                            time_modified = question.get("timeLimit") != question.get("originalTimeLimit", question.get("timeLimit"))
                            compulsory_modified = question.get("isCompulsory") != question.get("originalCompulsory", question.get("isCompulsory"))
                            
                            question["isAIModified"] = text_modified or time_modified or compulsory_modified
                        else:
                            # For regular questions, after saving they should no longer be considered modified
                            # The current state becomes the new baseline
                            question["isAIModified"] = False
                            
                            # Update original values to current values
                            question["originalText"] = question.get("text", "")
                            question["originalTimeLimit"] = question.get("timeLimit")
                            question["originalCompulsory"] = question.get("isCompulsory", True)
        
        # Call the service to save the question set
        question_set_id = InterviewQuestionSetService.save_question_set(data)
        if not question_set_id:
            raise HTTPException(status_code=500, detail="Failed to save InterviewQuestionSet")
        
        # Regenerate actual questions if this is for a specific candidate (not 'apply to all')
        # Only do this if applicationId is present and not 'all'
        application_id = data.get("applicationId")
        if application_id and application_id != "all":
            try:
                # Get the saved question set to ensure we have a complete model
                question_set = InterviewQuestionSetService.get_question_set(application_id)
                if question_set:
                    # Generate actual questions
                    logger.info(f"Regenerating actual questions after saving question set for {application_id}")
                    InterviewQuestionActualService.generate_actual_questions(question_set)
                else:
                    logger.warning(f"Could not regenerate actual questions - question set not found for {application_id}")
            except Exception as e:
                # Log error but don't fail the main operation
                logger.error(f"Error regenerating actual questions after saving: {e}")
        
        return question_set_id
    except Exception as e:
        logger.error(f"Error saving InterviewQuestionSet: {e}")
        raise HTTPException(status_code=500, detail="Failed to save InterviewQuestionSet")

@router.post("/save-actual-questions", response_model=str)
async def save_actual_questions(data: Dict[str, Any]):
    """Save a new InterviewQuestionActual."""
    actual_id = InterviewQuestionActualService.save_actual_questions(data)
    if not actual_id:
        raise HTTPException(status_code=500, detail="Failed to save InterviewQuestionActual")
    return actual_id

@router.post("/apply-to-all", response_model=Dict[str, Any])
async def apply_questions_to_all(data: Dict[str, Any]):
    """Apply interview questions to all candidates of a job."""
    try:
        logger.info(f"Applying questions to all candidates for job: {data.get('jobId')}")
        
        # Log if force overwrite is enabled
        force_overwrite = data.get("forceOverwrite", False)
        if force_overwrite:
            logger.info("Force overwrite mode enabled - will override AI-generated content")
        
        # Call the service method to apply questions to all candidates
        result = InterviewQuestionSetService.apply_to_all_candidates(data)
        
        if not result:
            raise HTTPException(status_code=500, detail="Failed to apply questions to all candidates")
        
        return result
    except Exception as e:
        logger.error(f"Error applying questions to all candidates: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/generate-actual-questions/{application_id}", response_model=InterviewQuestionActual)
async def generate_actual_questions(application_id: str):
    """Generate actual interview questions from the question set for an application."""
    try:
        logger.info(f"Generating actual interview questions for applicationId/candidateId: {application_id}")
        
        # First, get the question set for this application
        question_set = InterviewQuestionSetService.get_question_set(application_id)
        if not question_set:
            logger.warning(f"Question set not found for ID: {application_id}")
            raise HTTPException(status_code=404, detail="Question set not found")
        
        # Look up the correct applicationId if we're using a candidateId
        correct_application_id = InterviewQuestionActualService.get_correct_application_id(application_id)
        if correct_application_id:
            logger.info(f"Using correct applicationId: {correct_application_id} instead of {application_id}")
            question_set.applicationId = correct_application_id
        
        # Generate actual questions based on the question set, handling random selection
        actual_questions = InterviewQuestionActualService.generate_actual_questions(question_set)
        if not actual_questions:
            logger.error(f"Failed to generate actual questions for ID: {application_id}")
            raise HTTPException(status_code=500, detail="Failed to generate actual questions")
        
        logger.info(f"Successfully generated actual questions for ID: {application_id}")
        return actual_questions
    
    except HTTPException as he:
        logger.warning(f"HTTP error for applicationId {application_id}: {he.detail}")
        raise
    except Exception as e:
        logger.error(f"Error generating actual questions for applicationId {application_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate actual questions: {str(e)}")
