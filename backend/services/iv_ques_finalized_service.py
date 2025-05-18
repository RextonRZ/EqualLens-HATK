import logging
import random
from datetime import datetime
from typing import Dict, Any, Optional, List
from core.firebase import firebase_client
from models.interview_question import InterviewQuestionSet, InterviewQuestionActual

logger = logging.getLogger(__name__)

class InterviewQuestionActualService:
    """Service for managing InterviewQuestionActual in Firestore."""

    @staticmethod
    def get_correct_application_id(candidate_id: str) -> Optional[str]:
        """Look up the correct applicationId for a given candidateId from the applications collection."""
        try:
            logger.info(f"Looking up correct applicationId for candidateId: {candidate_id}")
            
            # Query the applications collection to find the application with this candidateId
            results = firebase_client.get_collection("applications", [("candidateId", "==", candidate_id)])
            
            if results and len(results) > 0:
                application_id = results[0].get("applicationId")
                logger.info(f"Found applicationId: {application_id} for candidateId: {candidate_id}")
                return application_id
            
            logger.warning(f"No application found for candidateId: {candidate_id}")
            return None
        except Exception as e:
            logger.error(f"Error looking up applicationId for candidateId {candidate_id}: {e}")
            return None

    @staticmethod
    def create_actual_questions(data: InterviewQuestionActual) -> Optional[str]:
        """Create a new InterviewQuestionActual document."""
        try:
            actual_id = firebase_client.generate_counter_id("actual")
            data_dict = data.dict()
            data_dict["actualId"] = actual_id
            data_dict["createdAt"] = datetime.now().isoformat()

            # Log the data being saved
            logger.info(f"Saving InterviewQuestionActual with data: {data_dict}")

            success = firebase_client.create_document("InterviewQuestionActual", actual_id, data_dict)
            if not success:
                logger.error(f"Failed to create InterviewQuestionActual with ID {actual_id}")
                return None

            return actual_id
        except Exception as e:
            logger.error(f"Error creating InterviewQuestionActual: {e}")
            return None

    @staticmethod
    def get_actual_questions(application_id: str) -> Optional[InterviewQuestionActual]:
        """Fetch an InterviewQuestionActual document by applicationId."""
        try:
            # First try to query by applicationId
            results = firebase_client.get_collection("InterviewQuestionActual", [("applicationId", "==", application_id)])
            
            if results:
                # Ensure createdAt exists
                doc = results[0]
                if "createdAt" not in doc:
                    doc["createdAt"] = datetime.now().isoformat()
                
                return InterviewQuestionActual(**doc)
            
            # If not found, try querying by candidateId
            results = firebase_client.get_collection("InterviewQuestionActual", [("candidateId", "==", application_id)])
            if results:
                doc = results[0]
                if "createdAt" not in doc:
                    doc["createdAt"] = datetime.now().isoformat()
                
                return InterviewQuestionActual(**doc)
            
            return None
        except Exception as e:
            logger.error(f"Error fetching InterviewQuestionActual for applicationId {application_id}: {e}")
            return None

    @staticmethod
    def save_actual_questions(data: Dict[str, Any]) -> Optional[str]:
        """Save an InterviewQuestionActual document."""
        try:
            # Check if actual questions already exist
            actual_id = data.get("actualId")
            candidate_id = data.get("candidateId")
            
            # Look up the correct applicationId using the candidateId
            if candidate_id:
                correct_application_id = InterviewQuestionActualService.get_correct_application_id(candidate_id)
                if correct_application_id:
                    # Use the correct applicationId from the applications collection
                    data["applicationId"] = correct_application_id
                    logger.info(f"Set correct applicationId: {correct_application_id} for candidateId: {candidate_id}")
            
            application_id = data.get("applicationId")
            logger.info(f"Saving actual questions with applicationId: {application_id}, candidateId: {candidate_id}")
            
            if not actual_id:
                # Check for existing record
                existing = InterviewQuestionActualService.get_actual_questions(application_id)
                if existing:
                    actual_id = existing.actualId
                    data["actualId"] = actual_id
                else:
                    # Create a new ID
                    actual_id = firebase_client.generate_counter_id("actual")
                    data["actualId"] = actual_id
                    data["createdAt"] = datetime.now().isoformat()
            
            # Save the document
            success = firebase_client.create_document("InterviewQuestionActual", actual_id, data)
            if not success:
                logger.error(f"Failed to save InterviewQuestionActual with ID {actual_id}")
                return None
            
            return actual_id
        except Exception as e:
            logger.error(f"Error saving InterviewQuestionActual: {e}")
            return None

    @staticmethod
    def generate_actual_questions(question_set: InterviewQuestionSet) -> Optional[InterviewQuestionActual]:
        """Generate actual interview questions based on a question set, applying random selection."""
        try:
            candidate_id = question_set.candidateId
            
            # Look up the correct applicationId for this candidateId
            correct_application_id = InterviewQuestionActualService.get_correct_application_id(candidate_id)
            
            # Use the correct applicationId if found, otherwise fall back to the one in question_set
            application_id = correct_application_id if correct_application_id else question_set.applicationId
            
            logger.info(f"Generating actual questions for applicationId: {application_id}, candidateId: {candidate_id}")
            
            # First, check if there are existing actual questions for this candidate
            existing_actual = InterviewQuestionActualService.get_actual_questions(application_id)
            actual_id = None
            if existing_actual:
                logger.info(f"Found existing actual questions for {application_id}, will update")
                actual_id = existing_actual.actualId
            
            # Prepare structure for actual questions
            questions = []
            total_question_count = 0
            
            # Process each section to select questions
            for section in question_set.sections:
                # First, add all compulsory questions
                compulsory_questions = [q for q in section.questions if q.isCompulsory]
                for question in compulsory_questions:
                    questions.append({
                        "questionId": question.questionId,
                        "text": question.text,
                        "timeLimit": question.timeLimit,
                        "sectionTitle": section.title
                    })
                    total_question_count += 1
                
                # Handle random selection for non-compulsory questions
                if section.randomSettings.enabled:
                    # Get non-compulsory questions
                    non_compulsory_questions = [q for q in section.questions if not q.isCompulsory]
                    
                    # If there are any non-compulsory questions and random count is valid
                    if non_compulsory_questions and section.randomSettings.count > 0:
                        # Ensure we don't select more than available
                        random_count = min(section.randomSettings.count, len(non_compulsory_questions))
                        
                        # Random selection
                        selected_questions = random.sample(non_compulsory_questions, random_count)
                        
                        # Add the selected questions
                        for question in selected_questions:
                            questions.append({
                                "questionId": question.questionId,
                                "text": question.text,
                                "timeLimit": question.timeLimit,
                                "sectionTitle": section.title
                            })
                            total_question_count += 1
                else:
                    # If random selection is not enabled, add all non-compulsory questions
                    non_compulsory_questions = [q for q in section.questions if not q.isCompulsory]
                    for question in non_compulsory_questions:
                        questions.append({
                            "questionId": question.questionId,
                            "text": question.text,
                            "timeLimit": question.timeLimit,
                            "sectionTitle": section.title
                        })
                        total_question_count += 1
            
            # Create the actual questions document with CORRECT applicationId
            actual_questions_data = {
                "applicationId": application_id,  # Use the correct applicationId from applications collection
                "candidateId": candidate_id,      # Keep the original candidateId
                "questions": questions,
                "totalQuestionActual": total_question_count,
                "createdAt": datetime.now().isoformat()
            }
            
            # If we're updating existing actual questions, include the existing ID
            if actual_id:
                actual_questions_data["actualId"] = actual_id
                # Also include an updatedAt field to track when this was changed
                actual_questions_data["updatedAt"] = datetime.now().isoformat()
            
            # Save to database
            actual_id = InterviewQuestionActualService.save_actual_questions(actual_questions_data)
            
            if not actual_id:
                logger.error("Failed to save actual questions to database")
                return None
            
            # Add actualId to the data if not already there
            if "actualId" not in actual_questions_data:
                actual_questions_data["actualId"] = actual_id
            
            # Return as model
            return InterviewQuestionActual(**actual_questions_data)
        
        except Exception as e:
            logger.error(f"Error generating actual questions: {str(e)}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return None

    @staticmethod
    def delete_actual_questions(application_id: str) -> bool:
        """Delete InterviewQuestionActual document by applicationId."""
        try:
            # First try to find the document by applicationId
            results = firebase_client.get_collection("InterviewQuestionActual", [("applicationId", "==", application_id)])
            
            if results:
                # Get the actual ID and delete the document
                actual_id = results[0].get("actualId")
                
                if actual_id:
                    success = firebase_client.delete_document("InterviewQuestionActual", actual_id)
                    logger.info(f"Deleted InterviewQuestionActual with ID: {actual_id} for applicationId: {application_id}")
                    return success
                else:
                    logger.warning(f"Found document for applicationId {application_id} but no actualId")
                    return False
            
            # If not found by applicationId, try by candidateId
            results = firebase_client.get_collection("InterviewQuestionActual", [("candidateId", "==", application_id)])
            
            if results:
                # Get the actual ID and delete the document
                actual_id = results[0].get("actualId")
                
                if actual_id:
                    success = firebase_client.delete_document("InterviewQuestionActual", actual_id)
                    logger.info(f"Deleted InterviewQuestionActual with ID: {actual_id} for candidateId: {application_id}")
                    return success
                else:
                    logger.warning(f"Found document for candidateId {application_id} but no actualId")
                    return False
            
            logger.warning(f"No InterviewQuestionActual found for applicationId or candidateId {application_id}")
            return False
        except Exception as e:
            logger.error(f"Error deleting InterviewQuestionActual for applicationId {application_id}: {e}")
            return False
