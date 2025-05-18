import logging
from datetime import datetime
from typing import Dict, Any, Optional
from core.firebase import firebase_client
from models.interview_question import InterviewQuestionSet

logger = logging.getLogger(__name__)

class InterviewQuestionSetService:
    """Service for managing InterviewQuestionSet in Firestore."""

    @staticmethod
    def create_question_set(data: InterviewQuestionSet) -> Optional[str]:
        """Create a new InterviewQuestionSet document."""
        try:
            question_set_id = firebase_client.generate_counter_id("qset")
            data_dict = data.dict()
            data_dict["questionSetId"] = question_set_id
            data_dict["createdAt"] = datetime.now().isoformat()

            # Generate sectionId and questionId for each section and question
            for section in data_dict["sections"]:
                section["sectionId"] = section.get("sectionId") or firebase_client.generate_counter_id("sect")
                for question in section["questions"]:
                    question["questionId"] = question.get("questionId") or firebase_client.generate_counter_id("ques")
                    # Save original text for custom questions
                    if not question.get("isAIGenerated"):
                        question["originalText"] = ""

            # Log the full data being saved
            logger.info(f"Saving InterviewQuestionSet with data: {data_dict}")

            # Ensure applicationId is included in the data
            if "applicationId" not in data_dict or not data_dict["applicationId"]:
                logger.error("Missing applicationId in InterviewQuestionSet data")
                return None

            success = firebase_client.create_document("InterviewQuestionSet", question_set_id, data_dict)
            if not success:
                logger.error(f"Failed to create InterviewQuestionSet with ID {question_set_id}")
                return None

            return question_set_id
        except Exception as e:
            logger.error(f"Error creating InterviewQuestionSet: {e}")
            return None

    @staticmethod
    def get_question_set(application_id: str) -> Optional[InterviewQuestionSet]:
        """Fetch an InterviewQuestionSet document by applicationId."""
        try:
            # Log the applicationId being queried
            logger.info(f"Querying InterviewQuestionSet with applicationId: {application_id}")

            # First try to query by applicationId
            results = firebase_client.get_collection("InterviewQuestionSet", [("applicationId", "==", application_id)])
            
            if results:
                # Process the document to handle AI question flags properly
                doc = results[0]
                
                # Ensure createdAt exists (required by the model)
                if "createdAt" not in doc or not doc["createdAt"]:
                    doc["createdAt"] = datetime.now().isoformat()
                    logger.warning(f"Added missing createdAt for InterviewQuestionSet with applicationId {application_id}")

                # Process AI generated questions to maintain isAIModified flags
                if "sections" in doc:
                    for section in doc["sections"]:
                        if "questions" in section:
                            for question in section["questions"]:
                                if question.get("isAIGenerated"):
                                    # Ensure isAIModified persists if it was marked as true
                                    if question.get("isAIModified") == True:
                                        question["isAIModified"] = True

                logger.info(f"Found InterviewQuestionSet for applicationId {application_id}")
                try:
                    return InterviewQuestionSet(**doc)
                except Exception as validation_err:
                    logger.error(f"Validation error for InterviewQuestionSet: {validation_err}")
                    # Fix common issues and retry
                    try:
                        # Make sure all required fields are present in sections and questions
                        if "sections" in doc:
                            for section in doc["sections"]:
                                if "randomSettings" not in section:
                                    section["randomSettings"] = {"enabled": False, "count": 0}
                                if "questions" in section:
                                    for question in section["questions"]:
                                        if "isCompulsory" not in question:
                                            question["isCompulsory"] = True
                        return InterviewQuestionSet(**doc)
                    except Exception as e:
                        logger.error(f"Failed to fix validation errors: {e}")
                        return None
            
            # If not found, try querying by candidateId as fallback
            # This is needed because some records might use candidateId field instead of applicationId
            results = firebase_client.get_collection("InterviewQuestionSet", [("candidateId", "==", application_id)])
            if results:
                # Apply the same validation fixes to candidateId results
                doc = results[0]
                if "createdAt" not in doc or not doc["createdAt"]:
                    doc["createdAt"] = datetime.now().isoformat()
                
                logger.info(f"Found InterviewQuestionSet using candidateId {application_id}")
                try:
                    return InterviewQuestionSet(**doc)
                except Exception as validation_err:
                    logger.error(f"Validation error for InterviewQuestionSet using candidateId: {validation_err}")
                    # Apply the same fixes as above
                    try:
                        if "sections" in doc:
                            for section in doc["sections"]:
                                if "randomSettings" not in section:
                                    section["randomSettings"] = {"enabled": False, "count": 0}
                                if "questions" in section:
                                    for question in section["questions"]:
                                        if "isCompulsory" not in question:
                                            question["isCompulsory"] = True
                        return InterviewQuestionSet(**doc)
                    except Exception as e:
                        logger.error(f"Failed to fix validation errors: {e}")
                        return None
            
            logger.warning(f"No InterviewQuestionSet found for applicationId or candidateId {application_id}")
            return None
        except Exception as e:
            logger.error(f"Error fetching InterviewQuestionSet for applicationId {application_id}: {e}")
            return None

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
    def save_question_set(data: Dict[str, Any]) -> Optional[str]:
        """Save or update an InterviewQuestionSet document."""
        try:
            # Check if a question set already exists for the given applicationId
            question_set_id = data.get("questionSetId")
            candidate_id = data.get("candidateId")
            
            # Look up the correct applicationId from applications collection
            if candidate_id and candidate_id != "all":
                correct_application_id = InterviewQuestionSetService.get_correct_application_id(candidate_id)
                if correct_application_id:
                    # Use the correct applicationId from the applications collection
                    data["applicationId"] = correct_application_id
                    application_id = correct_application_id
                    logger.info(f"Set correct applicationId: {correct_application_id} for candidateId: {candidate_id}")
                else:
                    # If we can't find a correct applicationId, log a warning but continue
                    # This allows for the "Apply to All" case or new candidates
                    logger.warning(f"Could not find applicationId for candidateId: {candidate_id}, using candidateId as fallback")
                    application_id = candidate_id
                    data["applicationId"] = candidate_id
            else:
                application_id = data.get("applicationId")
            
            # Check if a question set already exists for the given applicationId
            question_set_id = data.get("questionSetId")
            application_id = data.get("applicationId")
            candidate_id = data.get("candidateId")
            
            if not question_set_id:
                # If no questionSetId is provided, check for an existing set
                existing_question_set = InterviewQuestionSetService.get_question_set(application_id)
                if existing_question_set:
                    question_set_id = existing_question_set.questionSetId
                    data["questionSetId"] = question_set_id
                    data["updatedAt"] = datetime.now().isoformat()  # Add an updated timestamp
                    logger.info(f"Updating existing question set with ID: {question_set_id}")
                else:
                    # Create a new questionSetId if no existing set is found
                    question_set_id = firebase_client.generate_counter_id("qset")
                    data["questionSetId"] = question_set_id
                    data["createdAt"] = datetime.now().isoformat()
                    logger.info(f"Creating new question set with generated ID: {question_set_id}")

            # Ensure both applicationId and candidateId are set correctly to make queries consistent
            # This is crucial to make sure we can find the document later by either field
            if application_id and not data.get("candidateId"):
                # Look up the candidateId in Applications collection
                applications = firebase_client.get_collection("Applications", [("applicationId", "==", application_id)])
                if applications and len(applications) > 0:
                    data["candidateId"] = applications[0].get("candidateId")
                    logger.info(f"Found candidateId {data['candidateId']} for applicationId {application_id}")
                else:
                    logger.warning(f"No candidateId found for applicationId {application_id} in Applications collection")
                    return None
    
            elif candidate_id and not data.get("applicationId"):
                # Look up the applicationId in Applications collection
                applications = firebase_client.get_collection("Applications", [("candidateId", "==", candidate_id)])
                if applications and len(applications) > 0:
                    data["applicationId"] = applications[0].get("applicationId")
                    logger.info(f"Found applicationId {data['applicationId']} for candidateId {candidate_id}")
                else:
                    logger.warning(f"No applicationId found for candidateId {candidate_id} in Applications collection")
                    return None

            # Ensure AI modification status is properly preserved
            if "sections" in data:
                for section in data["sections"]:
                    if "questions" in section:
                        for question in section["questions"]:
                            # Handle AI-generated questions specially
                            if question.get("isAIGenerated") == True:
                                # Always preserve the original AI-generated text for comparison
                                # Make sure we always have an originalText for AI-generated questions
                                if not question.get("originalText"):
                                    logger.warning(f"AI-generated question missing originalText, using current text")
                                    question["originalText"] = question.get("text", "")
                                
                                # Determine if the AI question has been modified by comparing with original
                                text_modified = question.get("text") != question.get("originalText")
                                time_modified = question.get("timeLimit") != question.get("originalTimeLimit", question.get("timeLimit"))
                                compulsory_modified = question.get("isCompulsory") != question.get("originalCompulsory", question.get("isCompulsory"))
                                
                                # Only mark as modified if any of the properties are different from original AI values
                                question["isAIModified"] = text_modified or time_modified or compulsory_modified
                                logger.info(f"AI question modified status: {question['isAIModified']}")
                            else:
                                # For regular questions, after saving, they are no longer considered "modified"
                                # because the current state becomes the new baseline
                                question["isAIModified"] = False
                                
                                # Update originalText to current text for non-AI questions
                                question["originalText"] = question.get("text", "")
                                
                                # Update other original values as well
                                question["originalTimeLimit"] = question.get("timeLimit")
                                question["originalCompulsory"] = question.get("isCompulsory", True)

            # Generate sectionId and questionId for each section and question
            for section in data["sections"]:
                section["sectionId"] = section.get("sectionId") or firebase_client.generate_counter_id("sect")
                for question in section["questions"]:
                    question["questionId"] = question.get("questionId") or firebase_client.generate_counter_id("ques")
                    
                    # Ensure all questions have originalText
                    if "originalText" not in question:
                        if question.get("isAIGenerated"):
                            # For AI questions, we want to keep the original AI text
                            question["originalText"] = question.get("text", "")
                        else:
                            # For custom questions, set originalText to current text
                            question["originalText"] = question.get("text", "")

            # Track AI generation used
            if "aiGenerationUsed" in data:
                aiGenerationUsed = data.get("aiGenerationUsed", False)
            elif existing_question_set and hasattr(existing_question_set, "aiGenerationUsed"):
                aiGenerationUsed = existing_question_set.aiGenerationUsed
            else:
                aiGenerationUsed = False
            
            # Set aiGenerationUsed in the data
            data["aiGenerationUsed"] = aiGenerationUsed

            # Handle AI generation usage tracking
            # If aiGenerationUsed is provided in the data, use that value
            # Otherwise, preserve the existing value if there is one
            if "aiGenerationUsed" in data:
                # Explicitly cast to bool to ensure proper storage
                data["aiGenerationUsed"] = bool(data.get("aiGenerationUsed", False))
            elif existing_question_set and hasattr(existing_question_set, "aiGenerationUsed"):
                # Keep the existing value if it was already set
                data["aiGenerationUsed"] = bool(existing_question_set.aiGenerationUsed)
            else:
                # Default to False if not specified
                data["aiGenerationUsed"] = False
            
            logger.info(f"AI generation used flag set to: {data['aiGenerationUsed']}")

            # Log the full data being saved
            logger.info(f"Saving InterviewQuestionSet with applicationId: {application_id}, candidateId: {candidate_id}")

            # Always use create_document which will overwrite if it already exists
            success = firebase_client.create_document("InterviewQuestionSet", question_set_id, data)
            
            if not success:
                logger.error(f"Failed to save InterviewQuestionSet with ID {question_set_id}")
                return None

            logger.info(f"Successfully saved question set with ID: {question_set_id}")
            return question_set_id
        except Exception as e:
            logger.error(f"Error saving InterviewQuestionSet: {str(e)}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return None

    @staticmethod
    def apply_to_all_candidates(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Apply a question set to all candidates of a job."""
        try:
            # Extract needed data
            job_id = data.get("jobId")
            question_set = data.get("questionSet")
            candidates = data.get("candidates", [])
            overwrite_existing = data.get("overwriteExisting", False) 
            force_overwrite = data.get("forceOverwrite", False)  # New flag to force overwrite even for AI-generated content
            
            if not job_id or not question_set or not candidates:
                logger.error("Missing required data for apply-to-all")
                return None
                
            logger.info(f"Applying questions to {len(candidates)} candidates for job {job_id}")
            logger.info(f"Overwrite existing: {overwrite_existing}, Force overwrite: {force_overwrite}")
            
            results = {
                "successful": [],
                "failed": [],
                "skipped": []
            }
            
            # Track candidates whose questions were successfully saved
            saved_candidates = []
            
            # Process each candidate
            for candidate in candidates:
                candidate_id = candidate.get("candidateId")
                if not candidate_id:
                    continue
                    
                try:
                    # Clone the question set for this candidate
                    candidate_payload = {
                        "applicationId": candidate_id,
                        "candidateId": candidate_id,
                        "sections": question_set["sections"],
                        "jobId": job_id
                    }
                    
                    # Check if this candidate already has a question set
                    existing_set = InterviewQuestionSetService.get_question_set(candidate_id)
                    
                    # Check if we should skip this candidate
                    should_skip = False
                    
                    if existing_set:
                        # If overwrite is not allowed, skip
                        if not overwrite_existing:
                            logger.info(f"Skipping candidate {candidate_id} - existing question set found and overwrite disabled")
                            results["skipped"].append(candidate_id)
                            should_skip = True
                        # If AI has been used but force overwrite is not enabled, skip
                        elif hasattr(existing_set, "aiGenerationUsed") and existing_set.aiGenerationUsed and not force_overwrite:
                            logger.info(f"Skipping candidate {candidate_id} - has AI-generated content and force overwrite disabled")
                            results["skipped"].append(candidate_id)
                            should_skip = True
                    
                    if should_skip:
                        continue
                    
                    # If overwrite is allowed, use the existing ID
                    if existing_set:
                        candidate_payload["questionSetId"] = existing_set.questionSetId
                        logger.info(f"Overwriting existing question set for candidate {candidate_id}")
                        
                        # If this is replacing AI-generated content, make sure to remove or reset the AI flag
                        if hasattr(existing_set, "aiGenerationUsed") and existing_set.aiGenerationUsed:
                            if force_overwrite:
                                # If force overwrite, we'll keep the aiGenerationUsed flag but overwrite the content
                                candidate_payload["aiGenerationUsed"] = True
                                logger.info(f"Preserving AI generation flag for candidate {candidate_id} while overwriting content")
                            else:
                                # This shouldn't happen due to earlier check, but just in case
                                logger.warning(f"Attempting to overwrite AI content for {candidate_id} without force flag")
                    
                    # Save the question set for this candidate
                    question_set_id = InterviewQuestionSetService.save_question_set(candidate_payload)
                    
                    if question_set_id:
                        results["successful"].append({
                            "candidateId": candidate_id,
                            "questionSetId": question_set_id
                        })
                        # Add to the list of candidates that need actual questions
                        saved_candidates.append(candidate_id)
                    else:
                        results["failed"].append(candidate_id)
                        
                except Exception as e:
                    logger.error(f"Error applying questions to candidate {candidate_id}: {e}")
                    results["failed"].append(candidate_id)
            
            # Generate actual questions for all successfully saved candidates
            logger.info(f"Generating actual questions for {len(saved_candidates)} candidates")
            for candidate_id in saved_candidates:
                try:
                    # Get the saved question set
                    question_set = InterviewQuestionSetService.get_question_set(candidate_id)
                    if question_set:
                        # Generate actual questions
                        from services.iv_ques_finalized_service import InterviewQuestionActualService
                        actual_questions = InterviewQuestionActualService.generate_actual_questions(question_set)
                        if not actual_questions:
                            logger.warning(f"Failed to generate actual questions for candidate {candidate_id}")
                    else:
                        logger.warning(f"Could not find question set for candidate {candidate_id} to generate actual questions")
                except Exception as e:
                    logger.error(f"Error generating actual questions for candidate {candidate_id}: {e}")
                    # Don't modify the results - we still saved the question set successfully
            
            return results
            
        except Exception as e:
            logger.error(f"Error in apply_to_all_candidates: {str(e)}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return None

    @staticmethod
    def delete_question_set(application_id: str) -> bool:
        """Delete an InterviewQuestionSet document by applicationId."""
        try:
            # First try to find the document by applicationId
            results = firebase_client.get_collection("InterviewQuestionSet", [("applicationId", "==", application_id)])
            
            if results:
                # Get the question set ID and delete the document
                question_set_id = results[0].get("questionSetId")
                
                if question_set_id:
                    success = firebase_client.delete_document("InterviewQuestionSet", question_set_id)
                    logger.info(f"Deleted InterviewQuestionSet with ID: {question_set_id} for applicationId: {application_id}")
                    return success
                else:
                    logger.warning(f"Found document for applicationId {application_id} but no questionSetId")
                    return False
            
            # If not found by applicationId, try by candidateId
            results = firebase_client.get_collection("InterviewQuestionSet", [("candidateId", "==", application_id)])
            
            if results:
                # Get the question set ID and delete the document
                question_set_id = results[0].get("questionSetId")
                
                if question_set_id:
                    success = firebase_client.delete_document("InterviewQuestionSet", question_set_id)
                    logger.info(f"Deleted InterviewQuestionSet with ID: {question_set_id} for candidateId: {application_id}")
                    return success
                else:
                    logger.warning(f"Found document for candidateId {application_id} but no questionSetId")
                    return False
            
            logger.warning(f"No InterviewQuestionSet found for applicationId or candidateId {application_id}")
            return False
        except Exception as e:
            logger.error(f"Error deleting InterviewQuestionSet for applicationId {application_id}: {e}")
            return False
