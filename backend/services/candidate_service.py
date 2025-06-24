import logging
import uuid
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
import asyncio  # For concurrent execution

from core.firebase import firebase_client
from services.document_service import DocumentService
from services.raw_text_extractor import RawTextExtractor
from services.resume_authenticity_service import ResumeAuthenticityService
from services.cross_referencing_service import CrossReferencingService
from services.scoring_aggregation_service import ScoringAggregationService
from services.gemini_service import GeminiService
from services.external_ai_detection_service import external_ai_service  # Correctly imported
from services.ai_detection_service import AIDetectionService, FINAL_AUTH_FLAG_THRESHOLD, SPAM_FLAG_THRESHOLD

from models.candidate import CandidateCreate, CandidateResponse, CandidateUpdate
from models.authenticity_analysis import AuthenticityAnalysisResult
from models.cross_referencing import CrossReferencingResult, URLValidationDetail, EntityVerificationDetail

from core.text_similarity import TextSimilarityProcessor, serialize_firebase_data
from pytz import timezone, UnknownTimeZoneError
from google.cloud import firestore
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
        """
        # ... (detect_resume_changes implementation remains the same) ...
        changes = {
            "enriched_fields": [],
            "reduced_fields": [],
            "unchanged_fields": [],
            "field_changes": {}
        }

        def normalize_value(value):
            if value is None:
                return ""
            elif isinstance(value, str):
                return value.strip()
            elif isinstance(value, list):
                return [str(item).strip() for item in value if item]
            else:
                return str(value).strip()

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
                new_len = len(new_value);
                existing_len = len(existing_value)
                if new_value and not existing_value:
                    changes["enriched_fields"].append(field)
                    field_diffs = {"added": [new_value], "removed": []}
                elif not new_value and existing_value:
                    changes["reduced_fields"].append(field)
                    field_diffs = {"added": [], "removed": [existing_value]}
                elif abs(new_len - existing_len) > 20:
                    if new_len > existing_len:
                        changes["enriched_fields"].append(field)
                    else:
                        changes["reduced_fields"].append(field)
                    field_diffs = extract_text_differences(new_value, existing_value)
                elif new_value != existing_value:
                    similarity = TextSimilarityProcessor.compute_tfidf_similarity(new_value, existing_value)
                    if similarity < 0.8:
                        changes["enriched_fields"].append(field)
                        field_diffs = extract_text_differences(new_value, existing_value)
                    else:
                        changes["unchanged_fields"].append(field)
                else:
                    changes["unchanged_fields"].append(field)
                if field_diffs and (field_diffs.get("added") or field_diffs.get("removed")):
                    changes["field_changes"][field] = field_diffs
            elif isinstance(new_value, list) and isinstance(existing_value, list):
                field_diffs = extract_list_differences(new_value, existing_value)
                if field_diffs["added"] or field_diffs["removed"]:
                    changes["field_changes"][field] = field_diffs
                    if field_diffs["added"]: changes["enriched_fields"].append(field)
                    if field_diffs["removed"]: changes["reduced_fields"].append(field)
                else:
                    changes["unchanged_fields"].append(field)
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
                else:
                    changes["unchanged_fields"].append(field)
        changes["enriched_fields"] = list(set(changes["enriched_fields"]))
        changes["reduced_fields"] = list(set(changes["reduced_fields"]))
        changes["unchanged_fields"] = list(set(changes["unchanged_fields"]))
        return changes

    @staticmethod
    def check_duplicate_candidate(job_id: str, extracted_text: Dict[str, Any]) -> Dict[str, Any]:
        # ... (check_duplicate_candidate implementation remains the same) ...
        logger.info(f"--- Starting duplicate check for job_id: {job_id} ---")
        try:
            job_candidates = CandidateService.get_candidates_for_job(job_id)
            if not job_candidates:
                logger.info(f"No existing candidates for job {job_id} to check for duplicates.")
                return {"is_duplicate": False, "duplicate_type": None, "confidence": 0.0, "match_percentage": 0.0,
                        "duplicate_candidate": None, "resume_changes": None}

            identifier_fields = ["applicant_name", "applicant_mail", "applicant_contactNum"]
            content_fields = ["bio", "certifications_paragraph", "education_paragraph", "languages",
                              "projects_paragraph", "technical_skills", "work_experience_paragraph", "awards_paragraph",
                              "co-curricular_activities_paragraph", "soft_skills"]
            new_candidate_entities = extracted_text.get("entities", {})
            if not new_candidate_entities:
                logger.error(
                    "NEW candidate 'entities' field is missing or empty in extracted_text. Cannot perform comparison.")
                return {"is_duplicate": False, "duplicate_type": None, "confidence": 0.0, "match_percentage": 0.0,
                        "duplicate_candidate": None, "resume_changes": None}

            new_candidate_identifiers = {f: new_candidate_entities.get(f, "").lower() for f in identifier_fields}
            new_candidate_content_values = {f: new_candidate_entities.get(f, "") for f in content_fields}
            logger.info(
                f"NEW Candidate - Identifiers prepared for comparison: {json.dumps(new_candidate_identifiers, indent=2, default=str)}")
            logger.info(
                f"NEW Candidate - Content field keys prepared for comparison: {list(new_candidate_content_values.keys())}")

            valid_identifier_fields = [field for field, value in new_candidate_identifiers.items() if value]
            valid_content_fields = [field for field, value in new_candidate_content_values.items() if value]
            highest_confidence_score = 0.0;
            best_match_candidate = None;
            final_duplicate_type = None;
            final_resume_changes = None;
            final_match_percentage = 0.0
            db = firestore.Client()

            for candidate in job_candidates:
                try:
                    if not candidate.get('extractedText'): continue
                    existing_candidate_data = candidate['extractedText']
                    logger.info(f"Comparing with candidate: {candidate.get('candidateId')}")

                    identifier_similarities = {}
                    for field in identifier_fields:
                        new_val = new_candidate_identifiers.get(field, "");
                        existing_val = existing_candidate_data.get(field, "").lower()
                        if new_val and existing_val:
                            similarity = TextSimilarityProcessor.compute_tfidf_similarity(new_val, existing_val)
                            identifier_similarities[field] = similarity
                            logger.info(f"Identifier similarity for {field}: {similarity:.4f}")
                        else:
                            identifier_similarities[field] = 0.0

                    valid_identifier_scores = [identifier_similarities[field] for field in valid_identifier_fields if
                                               field in identifier_similarities]
                    avg_identifier_similarity = sum(valid_identifier_scores) / len(
                        valid_identifier_scores) if valid_identifier_scores else 0.0
                    logger.debug(f"Average identifier similarity: {avg_identifier_similarity}")

                    content_similarities = {}
                    logger.info(f"Content similarity scores for candidate {candidate.get('candidateId')}:")
                    for field in content_fields:
                        new_val = new_candidate_content_values.get(field, "");
                        existing_val = existing_candidate_data.get(field, "")
                        if new_val and existing_val:
                            similarity = GeminiService.compute_similarity(new_val, existing_val)
                            content_similarities[field] = similarity
                            logger.info(f"Content field '{field}': {similarity:.4f}")
                        else:
                            content_similarities[field] = 0.0

                    valid_content_scores = [content_similarities[field] for field in valid_content_fields if
                                            field in content_similarities]
                    avg_content_similarity = sum(valid_content_scores) / len(
                        valid_content_scores) if valid_content_scores else 0.0
                    logger.debug(f"Average content similarity: {avg_content_similarity}")

                    all_similarities = list(identifier_similarities.values()) + list(content_similarities.values())
                    non_zero_similarities = [score for score in all_similarities if score > 0]
                    match_percentage = (sum(non_zero_similarities) / len(
                        non_zero_similarities) * 100) if non_zero_similarities else 0.0
                    logger.info(f"Average identifier similarity: {avg_identifier_similarity:.4f}")
                    logger.info(f"Average content similarity: {avg_content_similarity:.4f}")
                    logger.info(f"Overall match percentage: {match_percentage:.2f}%")

                    current_type = None;
                    current_confidence = 0.0;
                    current_resume_changes = None
                    has_copied_field = False;
                    highest_field_similarity = 0.0;
                    copied_field_name = ""
                    for field, similarity in content_similarities.items():
                        if similarity > CandidateService.FIELD_SIMILARITY_COPIED_THRESHOLD and similarity > highest_field_similarity:
                            has_copied_field = True;
                            highest_field_similarity = similarity;
                            copied_field_name = field

                    if match_percentage >= 99.5:
                        current_type = "EXACT_DUPLICATE";
                        current_confidence = 1.0
                    elif avg_identifier_similarity >= CandidateService.IDENTIFIER_SIMILARITY_HIGH_THRESHOLD:
                        if avg_content_similarity >= CandidateService.CONTENT_SIMILARITY_EXACT_THRESHOLD:
                            current_type = "EXACT_DUPLICATE";
                            current_confidence = (avg_identifier_similarity + avg_content_similarity) / 2
                        elif avg_content_similarity >= CandidateService.CONTENT_SIMILARITY_MODIFIED_THRESHOLD:
                            current_type = "MODIFIED_RESUME";
                            current_confidence = avg_content_similarity
                            current_resume_changes = CandidateService.detect_resume_changes(
                                new_candidate_content_values,
                                {k: existing_candidate_data.get(k, "") for k in content_fields})
                            change_analysis = GeminiService.analyze_resume_changes(current_resume_changes)
                            current_resume_changes["detailed_changes"] = change_analysis["detailed_changes"];
                            current_resume_changes["overall_assessment"] = change_analysis["overall_assessment"]
                        else:
                            current_type = "MODIFIED_RESUME";
                            current_confidence = avg_content_similarity
                            current_resume_changes = CandidateService.detect_resume_changes(
                                new_candidate_content_values,
                                {k: existing_candidate_data.get(k, "") for k in content_fields})
                            change_analysis = GeminiService.analyze_resume_changes(current_resume_changes)
                            current_resume_changes["detailed_changes"] = change_analysis["detailed_changes"];
                            current_resume_changes["overall_assessment"] = change_analysis["overall_assessment"]
                    elif (avg_content_similarity >= CandidateService.CONTENT_SIMILARITY_COPIED_THRESHOLD or (
                            has_copied_field and avg_content_similarity > 0.4)):
                        current_type = "COPIED_RESUME";
                        current_confidence = max(avg_content_similarity, highest_field_similarity)
                    elif avg_identifier_similarity >= CandidateService.IDENTIFIER_SIMILARITY_MEDIUM_THRESHOLD:
                        if avg_content_similarity >= CandidateService.CONTENT_SIMILARITY_MODIFIED_THRESHOLD:
                            current_type = "MODIFIED_RESUME";
                            current_confidence = (avg_identifier_similarity * 0.4) + (avg_content_similarity * 0.6)
                            current_resume_changes = CandidateService.detect_resume_changes(
                                new_candidate_content_values,
                                {k: existing_candidate_data.get(k, "") for k in content_fields})
                            change_analysis = GeminiService.analyze_resume_changes(current_resume_changes)
                            current_resume_changes["detailed_changes"] = change_analysis["detailed_changes"];
                            current_resume_changes["overall_assessment"] = change_analysis["overall_assessment"]

                    if current_type and current_confidence > highest_confidence_score:
                        highest_confidence_score = current_confidence;
                        best_match_candidate = candidate
                        final_duplicate_type = current_type;
                        final_resume_changes = current_resume_changes
                        final_match_percentage = match_percentage

                    if current_type:
                        temp_data = {"job_id": job_id, "candidate_id": candidate.get("candidateId"),
                                     "match_percentage": round(match_percentage, 2), "duplicate_type": current_type,
                                     "confidence": round(current_confidence, 2),
                                     "timestamp": datetime.now().isoformat()}
                        db.collection("temp_match_data").document(candidate.get("candidateId")).set(temp_data)
                except Exception as e:
                    logger.error(f"Error comparing candidate: {e}"); continue

            if final_duplicate_type:
                overwrite_target = {"candidate_id": best_match_candidate.get("candidateId"),
                                    "extracted_data": extracted_text, "job_id": job_id,
                                    "timestamp": datetime.now().isoformat()}
                db.collection("overwrite_targets").document(job_id).set(overwrite_target)
                return {"is_duplicate": True, "duplicate_type": final_duplicate_type,
                        "confidence": round(highest_confidence_score, 2),
                        "match_percentage": round(final_match_percentage, 2),
                        "duplicate_candidate": serialize_firebase_data(best_match_candidate),
                        "resume_changes": final_resume_changes}
            else:
                return {"is_duplicate": False, "duplicate_type": None, "confidence": 0.0, "match_percentage": 0.0,
                        "duplicate_candidate": None, "resume_changes": None}
        except Exception as e:
            logger.error(f"Error checking duplicate candidate: {e}", exc_info=True)
            return {"is_duplicate": False, "duplicate_type": None, "confidence": 0.0, "match_percentage": 0.0,
                    "duplicate_candidate": None, "resume_changes": None}

    @staticmethod
    def get_candidates_for_job(job_id: str) -> List[Dict[str, Any]]:
        # ... (get_candidates_for_job implementation remains the same) ...
        try:
            from services.job_service import JobService
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

    def __init__(self, gemini_service_instance: Optional[GeminiService] = None):  # Renamed for clarity
        self.gemini_service = gemini_service_instance if gemini_service_instance else GeminiService()
        self.raw_text_extractor = RawTextExtractor()
        self.resume_authenticity_service = ResumeAuthenticityService(self.gemini_service)
        self.cross_referencing_service = CrossReferencingService(self.gemini_service)
        self.scoring_aggregation_service = ScoringAggregationService(self.gemini_service)
        self.document_service = DocumentService()
        self.external_ai_service = external_ai_service  # Instance from the import

    async def _run_full_analysis_pipeline(
            self,
            candidate_id_for_logging: str,
            file_content_bytes: bytes,
            file_name: str,
            content_type: str,
    ) -> Tuple[Dict[str, Any], AuthenticityAnalysisResult, CrossReferencingResult, Optional[Dict[str, Any]]]:
        logger.info(f"[{candidate_id_for_logging}] Starting full analysis pipeline for {file_name}")

        raw_text_extraction_error_msg: Optional[str] = None
        extracted_urls_from_file: List[str] = []

        # --- STEP 1: URL Extraction ---
        try:
            # No need to reinstantiate RawTextExtractor if it's stateless or self.raw_text_extractor is fine
            extracted_urls_from_file = self.raw_text_extractor.extract_all_urls(file_content_bytes, file_name)
            logger.info(
                f"[{candidate_id_for_logging}] Extracted {len(extracted_urls_from_file)} total URLs from {file_name}")
        except Exception as e_raw_extract:
            raw_text_extraction_error_msg = f"Raw text/URL extraction failed: {str(e_raw_extract)}"
            logger.error(f"[{candidate_id_for_logging}] {raw_text_extraction_error_msg}", exc_info=True)

        # --- STEP 2: Document AI Processing ---
        loop = asyncio.get_running_loop()
        doc_ai_processing_awaitable = loop.run_in_executor(
            None,
            self.document_service.process_document,
            file_content_bytes,
            content_type,
            file_name
        )

        document_ai_results: Dict[str, Any]
        candidate_name_from_doc_ai: Optional[str] = None
        doc_ai_entities: Dict[str, Any] = {}
        work_experience_text: Optional[str] = None
        education_text: Optional[str] = None
        projects_text_from_doc_ai: Optional[str] = None
        full_text_from_doc_ai: Optional[str] = None  # To store full text

        try:
            doc_ai_results_raw = await doc_ai_processing_awaitable
            if not doc_ai_results_raw or not isinstance(doc_ai_results_raw, dict) or doc_ai_results_raw.get("error"):
                err_msg = doc_ai_results_raw.get("error", "Unknown DocumentAI error") if isinstance(doc_ai_results_raw,
                                                                                                    dict) else "DocumentAI processing failed or returned invalid type"
                logger.error(f"[{candidate_id_for_logging}] DocumentAI processing failed for {file_name}: {err_msg}")
                document_ai_results = {"error": err_msg, "entities": {}, "full_text": ""}
                auth_error = AuthenticityAnalysisResult(
                    content_module_error_message=f"Upstream DocumentAI failure: {err_msg}")
                cross_ref_error = CrossReferencingResult(
                    cross_ref_module_error_message=f"Upstream DocumentAI failure: {err_msg}")
                if raw_text_extraction_error_msg:
                    cross_ref_error.cross_ref_module_error_message += f" | Raw URL Note: {raw_text_extraction_error_msg}"
                cross_ref_error.urls_validated = [
                    URLValidationDetail(url=u, is_live=False, validation_notes="DocAI failed.") for u in
                    extracted_urls_from_file]
                # External AI detection will also fail or be skipped, return None or error placeholder
                return document_ai_results, auth_error, cross_ref_error, {
                    "error": "DocAI failed, cannot perform external AI detection.", "predicted_class_label": "Error",
                    "confidence_scores": {}}

            document_ai_results = doc_ai_results_raw
            full_text_from_doc_ai = document_ai_results.get("full_text", "")  # Get full_text here
            logger.info(
                f"[{candidate_id_for_logging}] DocumentAI processing complete for {file_name}. Full text length: {len(full_text_from_doc_ai or '')}")
            doc_ai_entities = document_ai_results.get("entities", {})
            candidate_name_from_doc_ai = doc_ai_entities.get("applicant_name")
            work_experience_text = doc_ai_entities.get("work_experience_paragraph")
            education_text = doc_ai_entities.get("education_paragraph")
            projects_text_from_doc_ai = doc_ai_entities.get("projects_paragraph")
            if candidate_name_from_doc_ai:
                logger.info(f"[{candidate_id_for_logging}] Candidate name from DocAI: {candidate_name_from_doc_ai}")
            else:
                logger.warning(f"[{candidate_id_for_logging}] Applicant name not found by DocumentAI in entities.")
            if projects_text_from_doc_ai:
                logger.info(
                    f"[{candidate_id_for_logging}] Projects paragraph found by DocumentAI (length: {len(projects_text_from_doc_ai)}).")
            else:
                logger.warning(f"[{candidate_id_for_logging}] Projects paragraph not found by DocumentAI in entities.")

        except Exception as e:
            logger.error(f"[{candidate_id_for_logging}] Critical error during DocumentAI task for {file_name}: {e}",
                         exc_info=True)
            document_ai_results = {"error": f"DocumentAI task exception: {str(e)}", "entities": {}, "full_text": ""}
            auth_error = AuthenticityAnalysisResult(content_module_error_message=f"DocumentAI task exception: {str(e)}")
            cross_ref_error = CrossReferencingResult(
                cross_ref_module_error_message=f"DocumentAI task exception: {str(e)}")
            if raw_text_extraction_error_msg:
                cross_ref_error.cross_ref_module_error_message += f" | Raw URL Note: {raw_text_extraction_error_msg}"
            cross_ref_error.urls_validated = [
                URLValidationDetail(url=u, is_live=False, validation_notes="DocAI task exception.") for u in
                extracted_urls_from_file]
            return document_ai_results, auth_error, cross_ref_error, {
                "error": "DocAI task exception, cannot perform external AI detection.",
                "predicted_class_label": "Error", "confidence_scores": {}}

        # --- STEP 3: External AI Detection ---
        external_ai_detection_result_data: Optional[Dict[str, Any]] = None
        if full_text_from_doc_ai:  # Use the extracted full_text
            logger.info(
                f"[{candidate_id_for_logging}] Attempting external AI detection for {file_name} (text length: {len(full_text_from_doc_ai)}).")
            external_ai_detection_result_data = await self.external_ai_service.predict_resume_source(
                resume_text=full_text_from_doc_ai,
                resume_id=candidate_id_for_logging
            )
            if external_ai_detection_result_data and not external_ai_detection_result_data.get("error"):
                logger.info(
                    f"[{candidate_id_for_logging}] External AI detection completed for {file_name}. Prediction: {external_ai_detection_result_data.get('predicted_class_label')}")
            elif external_ai_detection_result_data and external_ai_detection_result_data.get("error"):
                logger.warning(
                    f"[{candidate_id_for_logging}] External AI detection for {file_name} resulted in error: {external_ai_detection_result_data.get('error')}")
            else:
                logger.warning(f"[{candidate_id_for_logging}] External AI detection returned no data for {file_name}.")
        else:
            logger.warning(
                f"[{candidate_id_for_logging}] No full text from DocumentAI for {file_name}, skipping external AI detection.")
            external_ai_detection_result_data = {"error": "No text extracted from document for AI detection.",
                                                 "predicted_class_label": "Unknown", "confidence_scores": {}}

        # --- STEP 4: Launch Concurrent Deeper Analysis Tasks ---
        authenticity_analysis_task = asyncio.create_task(
            self.resume_authenticity_service.analyze_resume_content(
                extracted_data_from_document_ai=doc_ai_entities,
                candidate_name=candidate_name_from_doc_ai
            )
        )
        cross_referencing_task = asyncio.create_task(
            self.cross_referencing_service.run_all_checks(
                urls=extracted_urls_from_file,
                candidate_name_on_resume=candidate_name_from_doc_ai,
                work_experience_paragraph=work_experience_text,
                education_paragraph=education_text,
                pre_extracted_entities=None,
                resume_projects_paragraph=projects_text_from_doc_ai
            )
        )

        # --- STEP 5: Await and Consolidate Results ---
        # ... (rest of _run_full_analysis_pipeline remains the same for gathering and processing auth/cross-ref results) ...
        gathered_task_results = await asyncio.gather(
            authenticity_analysis_task,
            cross_referencing_task,
            return_exceptions=True
        )

        authenticity_analysis_result = AuthenticityAnalysisResult(
            content_module_error_message="Authenticity analysis did not complete as expected.")
        cross_referencing_analysis_result = CrossReferencingResult(
            cross_ref_module_error_message="Cross-referencing analysis did not complete as expected.")
        cross_referencing_analysis_result.urls_validated = [
            URLValidationDetail(url=u, is_live=False, validation_notes="Cross-ref analysis incomplete.") for u in
            extracted_urls_from_file]

        auth_res_item = gathered_task_results[0]
        if isinstance(auth_res_item, Exception):
            logger.error(
                f"[{candidate_id_for_logging}] Authenticity analysis task resulted in an exception: {auth_res_item}",
                exc_info=auth_res_item)
            authenticity_analysis_result.content_module_error_message = f"Authenticity task error: {str(auth_res_item)}"
        elif isinstance(auth_res_item, AuthenticityAnalysisResult):
            authenticity_analysis_result = auth_res_item
            logger.info(f"[{candidate_id_for_logging}] Authenticity analysis successfully completed for {file_name}")
        else:
            logger.error(
                f"[{candidate_id_for_logging}] Authenticity analysis task returned unexpected type: {type(auth_res_item)}")

        cross_ref_item = gathered_task_results[1]
        if isinstance(cross_ref_item, Exception):
            logger.error(
                f"[{candidate_id_for_logging}] Cross-referencing task resulted in an exception: {cross_ref_item}",
                exc_info=cross_ref_item)
            cross_referencing_analysis_result.cross_ref_module_error_message = f"Cross-referencing task error: {str(cross_ref_item)}"
        elif isinstance(cross_ref_item, CrossReferencingResult):
            cross_referencing_analysis_result = cross_ref_item
            logger.info(
                f"[{candidate_id_for_logging}] Cross-referencing analysis successfully completed for {file_name}")
        else:
            logger.error(
                f"[{candidate_id_for_logging}] Cross-referencing task returned unexpected type: {type(cross_ref_item)}")

        if raw_text_extraction_error_msg:
            if cross_referencing_analysis_result.cross_ref_module_error_message:
                cross_referencing_analysis_result.cross_ref_module_error_message += f" | Raw URL Extraction Note: {raw_text_extraction_error_msg}"
            else:
                cross_referencing_analysis_result.cross_ref_module_error_message = f"Raw URL Extraction Note: {raw_text_extraction_error_msg}"
            logger.warning(
                f"[{candidate_id_for_logging}] Noted raw text extraction error in cross-ref result: {raw_text_extraction_error_msg}")

        return document_ai_results, authenticity_analysis_result, cross_referencing_analysis_result, external_ai_detection_result_data

    # REMOVED the first, simpler create_candidate_from_data method.
    # This is the sole, comprehensive create_candidate_from_data method now.
    @staticmethod
    def create_candidate_from_data(
            job_id: str, file_content: bytes, file_name: str,
            content_type: str,
            extracted_data_from_doc_ai: Dict[str, Any],
            authenticity_analysis_result: Optional[AuthenticityAnalysisResult] = None,
            cross_referencing_result: Optional[CrossReferencingResult] = None,
            final_assessment_data: Optional[Dict[str, Any]] = None,
            external_ai_detection_data: Optional[Dict[str, Any]] = None,  # ADDED this parameter
            override_duplicates: bool = False,
            user_time_zone: Optional[str] = "UTC"
    ) -> Optional[Dict[str, Any]]:
        try:
            candidate_id = firebase_client.generate_counter_id("cand")
            logger.info(
                f"[{candidate_id}] Generating new candidate ID for file {file_name} in create_candidate_from_data (Unified)")

            file_id = str(uuid.uuid4())
            file_extension = file_name.split('.')[-1] if '.' in file_name else 'pdf'
            storage_path = f"resumes/{job_id}/{candidate_id}/{file_id}.{file_extension}"

            download_url = firebase_client.upload_file(file_content, storage_path, content_type)
            if not download_url:
                logger.error(f"[{candidate_id}] Failed to upload resume for candidate")
                return {"error": "File upload to storage failed", "fileName": file_name}

            entities_to_store = {}
            full_text_to_store = ""
            if isinstance(extracted_data_from_doc_ai, dict):
                entities_to_store = extracted_data_from_doc_ai.get("entities", {})
                full_text_to_store = extracted_data_from_doc_ai.get("full_text", "")
                if "error" in extracted_data_from_doc_ai:
                    logger.error(
                        f"[{candidate_id}] Error in provided extracted_data_from_doc_ai for {file_name}: {extracted_data_from_doc_ai['error']}")
                    entities_to_store["document_processing_error"] = extracted_data_from_doc_ai['error']
            else:
                logger.error(
                    f"[{candidate_id}] Provided extracted_data_from_doc_ai for {file_name} is not a dict: {type(extracted_data_from_doc_ai)}. Storing empty entities.")
                entities_to_store["document_processing_error"] = "Malformed DocumentAI data received."

            try:
                tz = timezone(user_time_zone if user_time_zone else "UTC")
            except UnknownTimeZoneError:
                logger.warning(
                    f"[{candidate_id}] Unknown timezone '{user_time_zone}' for {file_name}, defaulting to UTC.")
                tz = timezone("UTC")
            current_time = datetime.now(tz).isoformat()

            candidate_doc = {
                'candidateId': candidate_id,
                'jobId': job_id,
                'originalFileName': file_name,
                'extractedText': entities_to_store,
                'fullTextFromDocAI': full_text_to_store,
                'resumeUrl': download_url,
                'storagePath': storage_path,
                'uploadedAt': current_time,
                'status': 'new',
                'authenticityAnalysis': authenticity_analysis_result.dict(
                    exclude_none=True) if authenticity_analysis_result else None,
                'crossReferencingAnalysis': cross_referencing_result.dict(
                    exclude_none=True) if cross_referencing_result else None,
                'externalAIDetectionResult': external_ai_detection_data,  # ADDED storage of this data
                'overallAuthenticityScore': final_assessment_data.get(
                    "final_overall_authenticity_score") if final_assessment_data else None,
                'spamLikelihoodScore': final_assessment_data.get(
                    "final_spam_likelihood_score") if final_assessment_data else None,
                'finalXAISummary': final_assessment_data.get("final_xai_summary") if final_assessment_data else None,
                'rank_score': None,
                'reasoning': None,
                'detailed_profile': None,
            }

            success = firebase_client.create_document('candidates', candidate_id, candidate_doc)
            if not success:
                logger.error(f"[{candidate_id}] Failed to create candidate document in Firestore")
                return {"error": "Firestore document creation failed", "fileName": file_name}

            logger.info(f"[{candidate_id}] Successfully created candidate from data for file {file_name}")
            return {
                'candidateId': candidate_id,
                'resumeUrl': download_url,
                'extractedDataFromDocAI': extracted_data_from_doc_ai,
                'authenticityAnalysis': candidate_doc['authenticityAnalysis'],
                'crossReferencingAnalysis': candidate_doc['crossReferencingAnalysis'],
                'externalAIDetectionResult': candidate_doc['externalAIDetectionResult'],  # ADDED to return payload
                'overallAuthenticityScore': candidate_doc['overallAuthenticityScore'],
                'spamLikelihoodScore': candidate_doc['spamLikelihoodScore'],
                'finalXAISummary': candidate_doc['finalXAISummary'],
            }
        except Exception as e:
            logger.error(f"Error creating candidate from data (Unified): {e}", exc_info=True)
            return {"error": f"Unexpected error in create_candidate_from_data: {str(e)}", "fileName": file_name}

    async def create_candidate_orchestrator(
            self,
            job_id: str,
            file_content_bytes: bytes,
            file_name: str,
            content_type: str,
            override_duplicates: bool = False,  # This is for duplicate modal
            user_time_zone: Optional[str] = "UTC",
            # New parameter to be passed from jobs.py
            force_problematic_upload: bool = False,
            force_irrelevant_upload: bool = False
    ) -> Optional[Dict[str, Any]]:
        temp_candidate_id_for_logging = f"temp-orch-{uuid.uuid4()}"
        logger.info(
            f"[{temp_candidate_id_for_logging}] Orchestrating candidate process for {file_name}, job {job_id}. Override Duplicates: {override_duplicates}, Force Problematic: {force_problematic_upload}, Irrelevant Upload: {force_irrelevant_upload}")

        document_ai_results, authenticity_analysis, cross_referencing_analysis, external_ai_detection_data = \
            await self._run_full_analysis_pipeline(
                candidate_id_for_logging=temp_candidate_id_for_logging,
                file_content_bytes=file_content_bytes,
                file_name=file_name,
                content_type=content_type
            )

        if not document_ai_results or document_ai_results.get("error"):
            logger.error(
                f"[{temp_candidate_id_for_logging}] DocumentAI processing failed critically for {file_name}. Orchestration cannot continue.")
            return {"error": document_ai_results.get("error",
                                                     "Document processing failed") if document_ai_results else "Document processing failed",
                    "fileName": file_name}

        final_assessment_data = await self.scoring_aggregation_service.calculate_final_assessment(
            authenticity_analysis, cross_referencing_analysis
        )

        # Populate final scores into authenticity_analysis object for consistency if it exists
        if authenticity_analysis:
            authenticity_analysis.final_overall_authenticity_score = final_assessment_data.get(
                "final_overall_authenticity_score")
            authenticity_analysis.final_spam_likelihood_score = final_assessment_data.get("final_spam_likelihood_score")
            authenticity_analysis.final_xai_summary = final_assessment_data.get("final_xai_summary")

        # --- Irrelevance Check before Duplicate ---
        document_ai_results["is_irrelevant"] = False  # Initialize
        document_ai_results["gemini_irrelevant"] = None

        logger.info(
            f"[{temp_candidate_id_for_logging}] After initialization, document_ai_results contains is_irrelevant={document_ai_results.get('is_irrelevant')}, gemini_irrelevant={document_ai_results.get('gemini_irrelevant')}"
        )

        # Determine job relevance before doing anything else
        try:
            from services.job_service import JobService
            job_details = JobService.get_job(job_id)
            logger.info(f"[{temp_candidate_id_for_logging}] job_details for {job_id}: {job_details}")
            logger.info(f"[{temp_candidate_id_for_logging}] document_ai_results full_text: {bool(document_ai_results and document_ai_results.get('full_text'))}")
            if document_ai_results and document_ai_results.get("full_text") and job_details and job_details.get('jobDescription'):
                logger.info(f"[{temp_candidate_id_for_logging}] Calling analyze_job_relevance with candidate_profile keys: {list(document_ai_results.get('entities', {}).keys())} and job_description: {job_details.get('jobDescription', '')}")
                relevant_info = await self.gemini_service.analyze_job_relevance(
                    candidate_profile=document_ai_results.get('entities', {}),
                    job_description=job_details.get('jobDescription')
                )
                logger.info(f"[{temp_candidate_id_for_logging}] analyze_job_relevance returned: {relevant_info}")
                if relevant_info and relevant_info.get("relevance_label") == "Irrelevant":
                    reason = relevant_info.get("irrelevant_reason")
                    if isinstance(reason, list):
                        reason = ", ".join(str(r) for r in reason)
                    relevance_score = relevant_info.get("overall_relevance_score")
                    document_ai_results["is_irrelevant"] = True
                    document_ai_results["gemini_irrelevant"] = {
                        "reason": reason,
                        "relevance_score": relevance_score
                    }
                    logger.info(f"[{temp_candidate_id_for_logging}] Candidate marked as irrelevant: {document_ai_results}")
                else:
                    logger.info(f"Candidate is relevant for job {job_id}")
            else:
                logger.warning(f"Missing data for irrelevance check of {file_name}")
        except Exception as e_irr:
            logger.error(f"Exception while irrelevance-checking {file_name}: {e_irr}", exc_info=True)
            document_ai_results["gemini_irrelevant"] = {"error": f"Irrelevance check error: {e_irr}"}

        # --- Duplicate Check ---
        #This makes irrelevance to not check if Ai-gen so moving before

        if not override_duplicates:  # Only check for duplicates if not explicitly overriding
            duplicate_check_result = self.check_duplicate_candidate(job_id, document_ai_results)
            if duplicate_check_result.get("is_duplicate"):
                logger.info(
                    f"[{temp_candidate_id_for_logging}] Duplicate detected for {file_name}: Type {duplicate_check_result.get('duplicate_type')}.")
                # Add all analysis data for the new file to the duplicate_info payload for the modal
                duplicate_check_result["new_file_analysis"] = {
                    "authenticityAnalysis": authenticity_analysis.model_dump(
                        exclude_none=True) if authenticity_analysis else None,
                    "crossReferencingAnalysis": cross_referencing_analysis.model_dump(
                        exclude_none=True) if cross_referencing_analysis else None,
                    "externalAIDetectionResult": external_ai_detection_data,
                    "overallAuthenticityScore": final_assessment_data.get("final_overall_authenticity_score"),
                    "spamLikelihoodScore": final_assessment_data.get("final_spam_likelihood_score"),
                    "finalXAISummary": final_assessment_data.get("final_xai_summary"),
                    "docAIResults": document_ai_results  # Include DocAI results if needed by frontend/overwrite logic
                }
                return {
                    "is_duplicate": True,
                    "duplicate_info": duplicate_check_result,
                    "fileName": file_name
                }

        # --- Problematic Content Check (AI-generated or internal flags) ---
        # This check happens regardless of duplicate status if not overridden, or if it's a new file.
        overall_auth_score = final_assessment_data.get("final_overall_authenticity_score", 0.5)
        spam_score = final_assessment_data.get("final_spam_likelihood_score", 0.5)

        is_externally_flagged_ai = external_ai_detection_data.get(
            "predicted_class_label") == "AI-generated" if external_ai_detection_data else False
        is_problematic_internally = (overall_auth_score < FINAL_AUTH_FLAG_THRESHOLD) or \
                                    (spam_score > SPAM_FLAG_THRESHOLD)
        is_globally_problematic = is_externally_flagged_ai or is_problematic_internally  # AND change to OR

        # --- FIX: Only return early if not forced. If forced, proceed to candidate creation. ---
        if (is_globally_problematic and not force_problematic_upload) or (document_ai_results["is_irrelevant"] and not force_irrelevant_upload):
            logger.info(
                f"[{temp_candidate_id_for_logging}] File {file_name} is problematic or irrelevant. External AI: {is_externally_flagged_ai}, Internal Problem: {is_problematic_internally}, Gemini Irrelevant: {document_ai_results['is_irrelevant']}")

            # Return all necessary data for the AIConfirmationModal and for later candidate creation if confirmed
            return {
                "is_problematic_pending_confirmation": True,
                "fileName": file_name,
                "aiFiles": [  # List of files flagged by AI
                    {
                        "filename": file_name,
                        "is_ai_generated": is_externally_flagged_ai or is_problematic_internally,
                        "confidence": external_ai_detection_data.get("confidence") if external_ai_detection_data else None,
                        "details": {
                            "authenticity_analysis": authenticity_analysis.model_dump(exclude_none=True) if authenticity_analysis else None,
                            "cross_referencing_analysis": cross_referencing_analysis.model_dump(exclude_none=True) if cross_referencing_analysis else None,
                            "external_ai_prediction": external_ai_detection_data,
                            # more info as needed
                        }
                    }
                ] if is_externally_flagged_ai or is_problematic_internally else [],
                "irrelevantFiles": [  # List of files flagged as irrelevant
                    {
                        "filename": file_name,
                        "gemini_irrelevant": document_ai_results.get("gemini_irrelevant"),
                        "is_irrelevant": document_ai_results["is_irrelevant"],
                        #more info as needed
                    }
                ] if document_ai_results["is_irrelevant"] else [],
                "analysis_data": {  # This data will be used by jobs.py to form ai_detection_payload
                    "document_ai_results": document_ai_results,
                    "authenticity_analysis_result": authenticity_analysis.model_dump(
                        exclude_none=True) if authenticity_analysis else None,
                    "cross_referencing_result": cross_referencing_analysis.model_dump(
                        exclude_none=True) if cross_referencing_analysis else None,
                    "external_ai_detection_data": external_ai_detection_data,
                    "final_assessment_data": final_assessment_data,
                    # Store raw file content and type if needed for re-submission, but it's usually re-uploaded by frontend
                }
            }

        # --- If all checks passed or were overridden/forced, create candidate ---
        logger.info(
            f"[{temp_candidate_id_for_logging}] Proceeding to create candidate entry for {file_name}. Force Problematic: {force_problematic_upload}, Force Irrelevant: {force_irrelevant_upload}, Override Duplicates: {override_duplicates}")
        candidate_creation_result = self.create_candidate_from_data(
            job_id=job_id,
            file_content=file_content_bytes,  # Original file content needed here
            file_name=file_name,
            content_type=content_type,
            extracted_data_from_doc_ai=document_ai_results,
            authenticity_analysis_result=authenticity_analysis,
            cross_referencing_result=cross_referencing_analysis,
            final_assessment_data=final_assessment_data,
            external_ai_detection_data=external_ai_detection_data,
            user_time_zone=user_time_zone
            # override_duplicates is not a param for create_candidate_from_data, it's handled above
        )

        if not candidate_creation_result or "error" in candidate_creation_result:
            logger.error(
                f"[{temp_candidate_id_for_logging}] Failed to create candidate entry for {file_name} after all checks.")
            return candidate_creation_result  # Propagate error

        actual_candidate_id = candidate_creation_result.get("candidateId")
        logger.info(f"[{actual_candidate_id}] Candidate entry created successfully for {file_name} via orchestrator.")

        # Trigger background profile generation
        if actual_candidate_id:
            # Ensure candidate_creation_result has 'extractedDataFromDocAI' for profile gen
            if 'extractedDataFromDocAI' not in candidate_creation_result:
                candidate_creation_result['extractedDataFromDocAI'] = document_ai_results  # Add it if missing
            asyncio.create_task(self._generate_and_save_profile_background(candidate_creation_result))

        return candidate_creation_result

    async def _generate_and_save_profile_background(self, candidate_info_dict: Dict[str, Any]):
        # ... (_generate_and_save_profile_background implementation remains the same) ...
        candidate_id = candidate_info_dict.get('candidateId')
        extracted_data = candidate_info_dict.get('extractedDataFromDocAI', {})
        entities_for_profile = extracted_data.get("entities", {})

        if not candidate_id or not entities_for_profile:
            logger.warning(f"Missing data for background profile generation for {candidate_id}")
            return
        try:
            profile = await self.gemini_service.generate_candidate_profile(
                {"candidateId": candidate_id, "extractedText": entities_for_profile})
            if profile and "summary" in profile:
                update_success = self.update_candidate(candidate_id, CandidateUpdate(detailed_profile=profile))
                if update_success:
                    logger.info(f"[{candidate_id}] Background detailed profile generated and saved.")
                else:
                    logger.warning(f"[{candidate_id}] Failed to save background generated profile.")
            else:
                logger.warning(f"[{candidate_id}] Background profile generation returned invalid data.")
        except Exception as e:
            logger.error(f"[{candidate_id}] Error in background profile generation: {e}", exc_info=True)

    @staticmethod
    def get_candidate(candidate_id: str) -> Optional[Dict[str, Any]]:
        # ... (get_candidate implementation remains the same) ...
        try:     
            candidate = firebase_client.get_document('candidates', candidate_id)
            if candidate and isinstance(candidate, dict):
                return candidate
            else:
                logger.warning(f"Candidate {candidate_id} is not in the expected format or does not exist.")
                return None
        except Exception as e:
            logger.error(f"Error getting candidate {candidate_id}: {e}")
            return None

    @staticmethod
    def update_candidate_status(candidate_id: str, status: str) -> bool:
        # ... (update_candidate_status implementation remains the same) ...
        try:
            return firebase_client.update_document('candidates', candidate_id, {'status': status})
        except Exception as e:
            logger.error(f"Error updating candidate {candidate_id} status: {e}")
            return False

    @staticmethod
    def update_candidate(candidate_id: str, candidate_data: CandidateUpdate) -> bool:
        # ... (update_candidate implementation remains the same) ...
        try:
            update_data = {}
            for field, value in candidate_data.model_dump(exclude_unset=True, exclude_none=True).items():
                if isinstance(value, (AuthenticityAnalysisResult, CrossReferencingResult)):
                    update_data[field] = value.dict(exclude_none=True)
                elif value is not None:
                    update_data[field] = value

            if not update_data:
                logger.warning(f"[{candidate_id}] No fields to update for candidate.")
                return True

            logger.info(
                f"[{candidate_id}] Updating candidate with data: {list(update_data.keys())}")
            success = firebase_client.update_document('candidates', candidate_id, update_data)
            return success
        except Exception as e:
            logger.error(f"Error updating candidate {candidate_id}: {e}")
            return False

    @staticmethod
    def process_applications(job_id: str, candidates_info: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        # ... (process_applications implementation remains the same) ...
        results = []
        from services.job_service import JobService
        for cand_info_item in candidates_info:
            candidate_id = cand_info_item.get('candidateId')
            if not candidate_id:
                logger.warning(f"Missing candidateId in item for job {job_id}, skipping application creation.")
                results.append({'candidateId': None, 'success': False, 'error': 'Missing candidateId in input data'})
                continue

            application_id = JobService.add_application(job_id, candidate_id)
            if application_id:
                results.append({'applicationId': application_id, 'candidateId': candidate_id, 'success': True})
            else:
                results.append({'candidateId': candidate_id, 'success': False,
                                'error': 'Failed to create application in Firestore'})
        return results

    @staticmethod
    def get_overwrite_target(job_id: str) -> Optional[str]:
        # ... (get_overwrite_target implementation remains the same) ...
        try:
            logger.info(f"Fetching overwrite target for job_id: {job_id}")
            overwrite_target = firebase_client.get_document("overwrite_targets", job_id)
            if overwrite_target and isinstance(overwrite_target, dict):
                candidate_id = overwrite_target.get("candidate_id")
                if candidate_id:
                    return candidate_id
                else:
                    logger.warning(f"Candidate ID is missing in overwrite target for job_id: {job_id}")
            else:
                logger.warning(f"No valid document found for job_id: {job_id}")
            return None
        except Exception as e:
            logger.error(f"Error retrieving overwrite target for job {job_id}: {e}", exc_info=True)
            return None