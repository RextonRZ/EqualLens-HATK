import logging
import uuid
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
from core.firebase import firebase_client
from services.document_service import DocumentService
from models.candidate import CandidateCreate, CandidateResponse, CandidateUpdate # Make sure CandidateUpdate is imported if used
from core.text_similarity import TextSimilarityProcessor, serialize_firebase_data
from services.gemini_service import GeminiService
from pytz import timezone, UnknownTimeZoneError
from google.cloud import firestore
from fastapi import UploadFile
from sqlalchemy.orm import Session
import json

logger = logging.getLogger(__name__)

class CandidateService:
    """Service for managing candidates and their resumes."""
    
    IDENTIFIER_SIMILARITY_HIGH_THRESHOLD = 0.90
    IDENTIFIER_SIMILARITY_MEDIUM_THRESHOLD = 0.65
    IDENTIFIER_SIMILARITY_LOW_THRESHOLD = 0.40
    
    CONTENT_SIMILARITY_EXACT_THRESHOLD = 0.92
    CONTENT_SIMILARITY_COPIED_THRESHOLD = 0.80
    CONTENT_SIMILARITY_MODIFIED_THRESHOLD = 0.60
    FIELD_SIMILARITY_COPIED_THRESHOLD = 0.40

    @staticmethod
    def detect_resume_changes(new_resume: Dict[str, Any], existing_resume: Dict[str, Any]) -> Dict[str, Any]:
        """
        Detect whether the new resume has been enriched or reduced in content compared to the existing resume.

        Args:
            new_resume (Dict[str, Any]): Extracted fields from the new resume.
            existing_resume (Dict[str, Any]): Extracted fields from the existing resume.

        Returns:
            Dict[str, Any]: A dictionary indicating whether the resume has been enriched or reduced,
                            and details of the changes.
        """
        changes = {
            "enriched_fields": [],
            "reduced_fields": [],
            "unchanged_fields": [],
            "field_changes": {}  # New field to store specific changes
        }

        def normalize_value(value):
            if value is None: return ""
            elif isinstance(value, str): return value.strip()
            elif isinstance(value, list): return [str(item).strip() for item in value if item]
            else: return str(value).strip()
        def extract_text_differences(new_text: str, existing_text: str) -> Dict[str, List[str]]:
            new_lines = [line.strip() for line in new_text.split('\n') if line.strip()]
            existing_lines = [line.strip() for line in existing_text.split('\n') if line.strip()]
            added = [line for line in new_lines if line not in existing_lines]
            removed = [line for line in existing_lines if line not in new_lines]
            return {"added": added, "removed": removed}
        def extract_list_differences(new_list: List[str], existing_list: List[str]) -> Dict[str, List[str]]:
            added = [item for item in new_list if item not in existing_list]
            removed = [item for item in existing_list if item not in new_list]
            return {"added": added, "removed": removed}
        for field in set(list(new_resume.keys()) + list(existing_resume.keys())):
            new_value = normalize_value(new_resume.get(field, ""))
            existing_value = normalize_value(existing_resume.get(field, ""))
            field_diffs = {}
            if isinstance(new_value, str) and isinstance(existing_value, str):
                new_len = len(new_value); existing_len = len(existing_value)
                if new_value and not existing_value:
                    changes["enriched_fields"].append(field)
                    field_diffs = {"added": [new_value], "removed": []}
                elif not new_value and existing_value:
                    changes["reduced_fields"].append(field)
                    field_diffs = {"added": [], "removed": [existing_value]}
                elif abs(new_len - existing_len) > 20:
                    if new_len > existing_len: changes["enriched_fields"].append(field)
                    else: changes["reduced_fields"].append(field)
                    field_diffs = extract_text_differences(new_value, existing_value)
                elif new_value != existing_value:
                    similarity = TextSimilarityProcessor.compute_tfidf_similarity(new_value, existing_value)
                    if similarity < 0.8:
                        changes["enriched_fields"].append(field)
                        field_diffs = extract_text_differences(new_value, existing_value)
                    else: changes["unchanged_fields"].append(field)
                else: changes["unchanged_fields"].append(field)
                if field_diffs and (field_diffs.get("added") or field_diffs.get("removed")):
                    changes["field_changes"][field] = field_diffs
            elif isinstance(new_value, list) and isinstance(existing_value, list):
                field_diffs = extract_list_differences(new_value, existing_value)
                if field_diffs["added"] or field_diffs["removed"]:
                    changes["field_changes"][field] = field_diffs
                    if field_diffs["added"]: changes["enriched_fields"].append(field)
                    if field_diffs["removed"]: changes["reduced_fields"].append(field)
                else: changes["unchanged_fields"].append(field)
            else:
                if new_value != existing_value:
                    if new_value and not existing_value:
                        changes["enriched_fields"].append(field)
                        changes["field_changes"][field] = {"added": [str(new_value)], "removed": []}
                    elif not new_value and existing_value:
                        changes["reduced_fields"].append(field)
                        changes["field_changes"][field] = {"added": [], "removed": [str(existing_value)]}
                    else:
                        changes["enriched_fields"].append(field)
                        changes["field_changes"][field] = {"added": [str(new_value)], "removed": [str(existing_value)]}
                else: changes["unchanged_fields"].append(field)
        changes["enriched_fields"] = list(set(changes["enriched_fields"]))
        changes["reduced_fields"] = list(set(changes["reduced_fields"]))
        changes["unchanged_fields"] = list(set(changes["unchanged_fields"]))
        return changes

    @staticmethod
    def check_duplicate_candidate(job_id: str, extracted_text: Dict[str, Any]) -> Dict[str, Any]:
        """
        Check if a candidate is a duplicate, modified, or copied resume for a given job.
        Returns a dictionary with duplicate status, type, confidence, and details of the matched candidate.
        """
        logger.info(f"--- Starting duplicate check for job_id: {job_id} ---")
        logger.info(f"Extracted text for NEW candidate being checked: {json.dumps(extracted_text, indent=2, default=str)}")
        try:
            job_candidates = CandidateService.get_candidates_for_job(job_id)
            if not job_candidates:
                logger.info(f"No existing candidates for job {job_id} to check for duplicates.")
                return {"is_duplicate": False, "duplicate_type": None, "confidence": 0.0, "match_percentage": 0.0, "duplicate_candidate": None, "resume_changes": None}

            identifier_fields = ["applicant_name", "applicant_mail", "applicant_contactNum"]
            content_fields = ["bio", "certifications_paragraph", "education_paragraph", "languages", "projects_paragraph", "technical_skills", "work_experience_paragraph", "awards_paragraph", "co-curricular_activities_paragraph", "soft_skills"]
            new_candidate_entities = extracted_text.get("entities", {})
            if not new_candidate_entities:
                logger.error("NEW candidate 'entities' field is missing or empty in extracted_text. Cannot perform comparison.")
                return {"is_duplicate": False, "duplicate_type": None, "confidence": 0.0, "match_percentage": 0.0, "duplicate_candidate": None, "resume_changes": None}

            new_candidate_identifiers = {f: new_candidate_entities.get(f, "").lower() for f in identifier_fields}
            new_candidate_content_values = {f: new_candidate_entities.get(f, "") for f in content_fields}
            logger.info(f"NEW Candidate - Identifiers prepared for comparison: {json.dumps(new_candidate_identifiers, indent=2, default=str)}")
            logger.info(f"NEW Candidate - Content field keys prepared for comparison: {list(new_candidate_content_values.keys())}")

            valid_identifier_fields = [field for field, value in new_candidate_identifiers.items() if value]
            valid_content_fields = [field for field, value in new_candidate_content_values.items() if value]
            highest_confidence_score = 0.0; best_match_candidate = None; final_duplicate_type = None; final_resume_changes = None; final_match_percentage = 0.0
            db = firestore.Client()

            for candidate in job_candidates:
                try:
                    if not candidate.get('extractedText'): continue
                    existing_candidate_data = candidate['extractedText']
                    logger.info(f"Comparing with candidate: {candidate.get('candidateId')}")
                    logger.info(f"Existing candidate - Identifiers: {json.dumps(existing_candidate_data, indent=2, default=str)}")
                    logger.info(f"New candidate - Identifiers: {json.dumps(new_candidate_identifiers, indent=2, default=str)}")
                    
                    identifier_similarities = {}
                    for field in identifier_fields:
                        new_val = new_candidate_identifiers.get(field, ""); existing_val = existing_candidate_data.get(field, "").lower()
                        if new_val and existing_val:
                            similarity = TextSimilarityProcessor.compute_tfidf_similarity(new_val, existing_val)
                            identifier_similarities[field] = similarity
                            logger.info(f"Identifier similarity for {field}: {similarity:.4f}")
                        else: identifier_similarities[field] = 0.0
                    
                    valid_identifier_scores = [identifier_similarities[field] for field in valid_identifier_fields if field in identifier_similarities]
                    avg_identifier_similarity = sum(valid_identifier_scores) / len(valid_identifier_scores) if valid_identifier_scores else 0.0
                    logger.debug(f"Average identifier similarity: {avg_identifier_similarity}")

                    content_similarities = {}
                    logger.info(f"Content similarity scores for candidate {candidate.get('candidateId')}:")
                    for field in content_fields:
                        new_val = new_candidate_content_values.get(field, ""); existing_val = existing_candidate_data.get(field, "")
                        if new_val and existing_val:
                            similarity = GeminiService.compute_similarity(new_val, existing_val)
                            content_similarities[field] = similarity
                            logger.info(f"Content field '{field}': {similarity:.4f}")
                        else: content_similarities[field] = 0.0
                    
                    valid_content_scores = [content_similarities[field] for field in valid_content_fields if field in content_similarities]
                    avg_content_similarity = sum(valid_content_scores) / len(valid_content_scores) if valid_content_scores else 0.0
                    logger.debug(f"Average content similarity: {avg_content_similarity}")

                    all_similarities = list(identifier_similarities.values()) + list(content_similarities.values())
                    non_zero_similarities = [score for score in all_similarities if score > 0]
                    match_percentage = (sum(non_zero_similarities) / len(non_zero_similarities) * 100) if non_zero_similarities else 0.0
                    logger.info(f"Average identifier similarity: {avg_identifier_similarity:.4f}")
                    logger.info(f"Average content similarity: {avg_content_similarity:.4f}")
                    logger.info(f"Overall match percentage: {match_percentage:.2f}%")

                    current_type = None; current_confidence = 0.0; current_resume_changes = None
                    has_copied_field = False; highest_field_similarity = 0.0; copied_field_name = ""
                    for field, similarity in content_similarities.items():
                        if similarity > CandidateService.FIELD_SIMILARITY_COPIED_THRESHOLD and similarity > highest_field_similarity:
                            has_copied_field = True; highest_field_similarity = similarity; copied_field_name = field
                    # if has_copied_field: logger.info(f"Potential copied content detected in field '{copied_field_name}' with similarity {highest_field_similarity:.4f}")
                    
                    if match_percentage >= 99.5:
                        current_type = "EXACT_DUPLICATE"; current_confidence = 1.0
                        # logger.info(f"Forced EXACT_DUPLICATE classification due to perfect match: {match_percentage:.2f}%")
                    elif avg_identifier_similarity >= CandidateService.IDENTIFIER_SIMILARITY_HIGH_THRESHOLD:
                        if avg_content_similarity >= CandidateService.CONTENT_SIMILARITY_EXACT_THRESHOLD:
                            current_type = "EXACT_DUPLICATE"; current_confidence = (avg_identifier_similarity + avg_content_similarity) / 2
                        elif avg_content_similarity >= CandidateService.CONTENT_SIMILARITY_MODIFIED_THRESHOLD:
                            current_type = "MODIFIED_RESUME"; current_confidence = avg_content_similarity
                            current_resume_changes = CandidateService.detect_resume_changes(new_candidate_content_values, {k: existing_candidate_data.get(k, "") for k in content_fields})
                            change_analysis = GeminiService.analyze_resume_changes(current_resume_changes)
                            current_resume_changes["detailed_changes"] = change_analysis["detailed_changes"]; current_resume_changes["overall_assessment"] = change_analysis["overall_assessment"]
                        else:
                            current_type = "MODIFIED_RESUME"; current_confidence = avg_content_similarity
                            current_resume_changes = CandidateService.detect_resume_changes(new_candidate_content_values, {k: existing_candidate_data.get(k, "") for k in content_fields})
                            change_analysis = GeminiService.analyze_resume_changes(current_resume_changes)
                            current_resume_changes["detailed_changes"] = change_analysis["detailed_changes"]; current_resume_changes["overall_assessment"] = change_analysis["overall_assessment"]
                    elif (avg_content_similarity >= CandidateService.CONTENT_SIMILARITY_COPIED_THRESHOLD or (has_copied_field and avg_content_similarity > 0.4)):
                        current_type = "COPIED_RESUME"; current_confidence = max(avg_content_similarity, highest_field_similarity)
                    elif avg_identifier_similarity >= CandidateService.IDENTIFIER_SIMILARITY_MEDIUM_THRESHOLD:
                        if avg_content_similarity >= CandidateService.CONTENT_SIMILARITY_MODIFIED_THRESHOLD:
                            current_type = "MODIFIED_RESUME"; current_confidence = (avg_identifier_similarity * 0.4) + (avg_content_similarity * 0.6)
                            current_resume_changes = CandidateService.detect_resume_changes(new_candidate_content_values, {k: existing_candidate_data.get(k, "") for k in content_fields})
                            change_analysis = GeminiService.analyze_resume_changes(current_resume_changes)
                            current_resume_changes["detailed_changes"] = change_analysis["detailed_changes"]; current_resume_changes["overall_assessment"] = change_analysis["overall_assessment"]
                    
                    if current_type and current_confidence > highest_confidence_score:
                        highest_confidence_score = current_confidence; best_match_candidate = candidate
                        final_duplicate_type = current_type; final_resume_changes = current_resume_changes
                        final_match_percentage = match_percentage

                    if current_type:
                        temp_data = {"job_id": job_id, "candidate_id": candidate.get("candidateId"), "match_percentage": round(match_percentage, 2), "duplicate_type": current_type, "confidence": round(current_confidence, 2), "timestamp": datetime.now().isoformat()}
                        db.collection("temp_match_data").document(candidate.get("candidateId")).set(temp_data)
                except Exception as e: logger.error(f"Error comparing candidate: {e}"); continue
            
            # if final_duplicate_type: logger.info(f"Duplicate detection result: {final_duplicate_type} with confidence {highest_confidence_score:.2f}")
            
            if final_duplicate_type:
                overwrite_target = {"candidate_id": best_match_candidate.get("candidateId"), "extracted_data": extracted_text, "job_id": job_id, "timestamp": datetime.now().isoformat()}
                db.collection("overwrite_targets").document(job_id).set(overwrite_target)
                return {"is_duplicate": True, "duplicate_type": final_duplicate_type, "confidence": round(highest_confidence_score, 2), "match_percentage": round(final_match_percentage, 2), "duplicate_candidate": serialize_firebase_data(best_match_candidate), "resume_changes": final_resume_changes}
            else: return {"is_duplicate": False, "duplicate_type": None, "confidence": 0.0, "match_percentage": 0.0, "duplicate_candidate": None, "resume_changes": None}
        except Exception as e:
            logger.error(f"Error checking duplicate candidate: {e}", exc_info=True)
            return {"is_duplicate": False, "duplicate_type": None, "confidence": 0.0, "match_percentage": 0.0, "duplicate_candidate": None, "resume_changes": None}

    @staticmethod
    def get_candidates_for_job(job_id: str) -> List[Dict[str, Any]]:
        """Get all candidates for a job."""
        try:
            from services.job_service import JobService # Import here to avoid circular dependency issues at module load time
            applications = JobService.get_applications_for_job(job_id)
            if not applications: return []
            candidate_ids = [app.get('candidateId') for app in applications if app.get('candidateId')]
            candidates = []
            for candidate_id in candidate_ids:
                candidate = CandidateService.get_candidate(candidate_id)
                if candidate: candidates.append(candidate)
            return candidates
        except Exception as e:
            logger.error(f"Error getting candidates for job {job_id}: {e}")
            return []
    
    @staticmethod
    def create_candidate_from_data(job_id: str, file_content: bytes, file_name: str, 
                                  content_type: str, extracted_data: Dict[str, Any],
                                  override_duplicates: bool = False, user_time_zone: Optional[str] = "UTC"
                                  ) -> Optional[Dict[str, Any]]:
        try:
            candidate_id = firebase_client.generate_counter_id("cand")
            logger.info(f"Generating new candidate ID: {candidate_id} for file {file_name} in create_candidate_from_data")
            
            file_id = str(uuid.uuid4())
            file_extension = file_name.split('.')[-1] if '.' in file_name else 'pdf'
            storage_path = f"resumes/{job_id}/{candidate_id}/{file_id}.{file_extension}"
            
            download_url = firebase_client.upload_file(file_content, storage_path, content_type)
            if not download_url:
                logger.error(f"Failed to upload resume for candidate {candidate_id}")
                return None
            
            # `extracted_data` is ALREADY PROCESSED and passed in for this method.
            # The original implementation re-processed, which was incorrect for "from_data".
            # DocumentService.process_document(file_content, content_type, file_name) # This was redundant
            
            entities_to_store = {}
            if isinstance(extracted_data, dict):
                entities_to_store = extracted_data.get("entities", {})
                if "error" in extracted_data:
                    logger.error(f"Error in provided extracted_data for {file_name}: {extracted_data['error']}")
            else:
                logger.error(f"Provided extracted_data for {file_name} is not a dict: {type(extracted_data)}. Storing empty entities.")
                
            # Determine the user's timezone
            try:
                tz = timezone(user_time_zone)
            except UnknownTimeZoneError:
                logger.warning(f"Unknown timezone '{user_time_zone}' for {file_name}, defaulting to UTC.")
                tz = timezone("UTC")
            current_time = datetime.now(tz).isoformat()
            
            candidate_doc = {
                'candidateId': candidate_id,
                'extractedText': entities_to_store, 
                'resumeUrl': download_url,
                'storagePath': storage_path,
                'uploadedAt': current_time, 
                'status': 'new' 
            }
            
            success = firebase_client.create_document('candidates', candidate_id, candidate_doc)
            if not success:
                logger.error(f"Failed to create candidate {candidate_id}")
                return None
            
            return {
                'candidateId': candidate_id,
                'resumeUrl': download_url,
                'extractedData': extracted_data # Return the full pre-processed data
            }
        except Exception as e:
            logger.error(f"Error creating candidate from data: {e}", exc_info=True)
            return None

    @staticmethod
    def create_candidate(
        job_id: str, 
        file_content: bytes, 
        file_name: str, 
        content_type: str, 
        override_duplicates: bool = False,
        pre_processed_doc_data: Optional[Dict[str, Any]] = None,
        user_time_zone: Optional[str] = "UTC"
    ) -> Optional[Dict[str, Any]]:
        """Create a new candidate from an uploaded resume, optionally using pre-processed document data."""
        try:
            extracted_data_dict: Optional[Dict[str, Any]] = None

            if pre_processed_doc_data and isinstance(pre_processed_doc_data, dict) and "error" not in pre_processed_doc_data:
                logger.info(f"Using pre-processed document data for candidate {file_name}.")
                extracted_data_dict = pre_processed_doc_data
            else:
                if pre_processed_doc_data and "error" in pre_processed_doc_data :
                    logger.warning(f"Pre-processed data for {file_name} contained an error: {pre_processed_doc_data.get('error')}. Reprocessing.")
                elif pre_processed_doc_data: # It exists but not a valid dict or empty
                     logger.warning(f"Pre-processed data for {file_name} was not in expected dict format or was empty. Reprocessing.")
                else: # Not provided at all
                    logger.info(f"No valid pre-processed data for {file_name}. Processing document.")

                # Call DocumentService.process_document only if pre_processed_doc_data is not valid or not provided
                extracted_data_dict = DocumentService.process_document(
                    file_content, content_type, file_name
                )

            if not extracted_data_dict or (isinstance(extracted_data_dict, dict) and "error" in extracted_data_dict):
                logger.error(f"Failed to process document or document processing resulted in error for {file_name}. Cannot create candidate.")
                # Store the error if present from extracted_data_dict
                error_detail = extracted_data_dict.get("error", "Unknown processing error") if isinstance(extracted_data_dict, dict) else "Unknown processing error"
                return {"error": f"Document processing failed: {error_detail}", "fileName": file_name}


            # Check for duplicates if not overriding (uses extracted_data_dict)
            if not override_duplicates:
                duplicate_check = CandidateService.check_duplicate_candidate(job_id, extracted_data_dict)
                if duplicate_check["is_duplicate"]:
                    logger.info(f"Duplicate detected for {file_name}: {duplicate_check['duplicate_type']} with confidence {duplicate_check['confidence']}")
                    return {
                        "is_duplicate": True,
                        "duplicate_info": duplicate_check,
                        "fileName": file_name
                    }
            
            # --- Actual Candidate Creation Logic ---
            candidate_id = firebase_client.generate_counter_id("cand")
            logger.info(f"Generating new candidate ID: {candidate_id} for file {file_name} in create_candidate")

            file_id_str = str(uuid.uuid4())
            file_extension = file_name.split('.')[-1] if '.' in file_name else 'pdf'
            storage_path = f"resumes/{job_id}/{candidate_id}/{file_id_str}.{file_extension}"
            
            download_url = firebase_client.upload_file(file_content, storage_path, content_type)
            if not download_url:
                logger.error(f"Failed to upload resume for candidate {candidate_id}")
                return None
            
            entities_to_store = {}
            if isinstance(extracted_data_dict, dict): # Should be a dict by now if no error earlier
                entities_to_store = extracted_data_dict.get("entities", {})
            
            # Determine the user's timezone
            try:
                user_tz = timezone(user_time_zone)
            except UnknownTimeZoneError:
                logger.warning(f"Unknown timezone '{user_time_zone}', defaulting to UTC.")
                user_tz = timezone("UTC")

            # Get the current time in the user's timezone
            current_time = datetime.now(user_tz).isoformat()
            
            candidate_doc = {
                'candidateId': candidate_id,
                'extractedText': entities_to_store, # Store only entities in Firestore
                'resumeUrl': download_url,
                'storagePath': storage_path,
                'uploadedAt': current_time,
                'status': 'new' 
            }
            
            success = firebase_client.create_document('candidates', candidate_id, candidate_doc)
            if not success:
                logger.error(f"Failed to create candidate {candidate_id} in Firestore.")
                return None
            
            logger.info(f"Successfully created candidate {candidate_id} for file {file_name}.")
            return {
                'candidateId': candidate_id,
                'resumeUrl': download_url,
                'extractedData': extracted_data_dict # Return the full processed data
            }

        except Exception as e:
            logger.error(f"Error in create_candidate for file {file_name}: {e}", exc_info=True)
            return None
    
    @staticmethod
    def get_candidate(candidate_id: str) -> Optional[Dict[str, Any]]:
        """Get a candidate by ID."""
        try:
            candidate = firebase_client.get_document('candidates', candidate_id)
            if candidate and isinstance(candidate, dict): return candidate
            else:
                logger.warning(f"Candidate {candidate_id} is not in the expected format or does not exist.")
                return None
        except Exception as e:
            logger.error(f"Error getting candidate {candidate_id}: {e}")
            return None
    
    @staticmethod
    def update_candidate_status(candidate_id: str, status: str) -> bool:
        """Update a candidate's status."""
        try:
            return firebase_client.update_document('candidates', candidate_id, {'status': status})
        except Exception as e:
            logger.error(f"Error updating candidate {candidate_id} status: {e}")
            return False
        
    @staticmethod
    def update_candidate(candidate_id: str, candidate_data: CandidateUpdate) -> bool:
        """Update a candidate."""
        try:
            update_data = {}
            for field, value in candidate_data.dict(exclude_unset=True).items():
                if value is not None: update_data[field] = value
            if not update_data:
                logger.warning("No fields to update")
                return False
            logger.info(f"Update data for candidate {candidate_id}: {update_data}")
            success = firebase_client.update_document('candidates', candidate_id, update_data)
            return success
        except Exception as e:
            logger.error(f"Error updating candidate {candidate_id}: {e}")
            return False
    
    @staticmethod
    def process_applications(job_id: str, candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Process a batch of candidates and create applications for them."""
        results = []
        from services.job_service import JobService # Import here
        for candidate_data in candidates:
            candidate_id = candidate_data.get('candidateId')
            if not candidate_id: continue
            application_id = JobService.add_application(job_id, candidate_id)
            if application_id: results.append({'applicationId': application_id, 'candidateId': candidate_id, 'success': True})
            else: results.append({'candidateId': candidate_id, 'success': False, 'error': 'Failed to create application'})
        return results

    @staticmethod
    def get_overwrite_target(job_id: str) -> Optional[str]:
        """Retrieve the candidate_id from the overwrite_targets collection for a specific job."""
        try:
            logger.info(f"Fetching overwrite target for job_id: {job_id}")
            overwrite_target = firebase_client.get_document("overwrite_targets", job_id)
            if overwrite_target and isinstance(overwrite_target, dict):
                candidate_id = overwrite_target.get("candidate_id")
                if candidate_id: return candidate_id
                else: logger.warning(f"Candidate ID is missing in overwrite target for job_id: {job_id}")
            else: logger.warning(f"No valid document found for job_id: {job_id}")
            return None
        except Exception as e:
            logger.error(f"Error retrieving overwrite target for job {job_id}: {e}", exc_info=True)
            return None