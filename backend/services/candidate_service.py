# In: candidate_service.py

import logging
import uuid
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timezone
import asyncio

from core.firebase import firebase_client
from services.document_service import DocumentService
from services.raw_text_extractor import RawTextExtractor
from services.resume_authenticity_service import ResumeAuthenticityService
from services.cross_referencing_service import CrossReferencingService
from services.scoring_aggregation_service import ScoringAggregationService
from services.gemini_service import GeminiService
from services.external_ai_detection_service import external_ai_service
from services.ai_detection_service import AIDetectionService, FINAL_AUTH_FLAG_THRESHOLD, SPAM_FLAG_THRESHOLD

from models.candidate import CandidateCreate, CandidateResponse, CandidateUpdate
from models.authenticity_analysis import AuthenticityAnalysisResult
from models.cross_referencing import CrossReferencingResult, URLValidationDetail, EntityVerificationDetail

from core.text_similarity import TextSimilarityProcessor, serialize_firebase_data
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
        # ... (This function is correct, no changes needed here)
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
                field_diffs = extract_list_differences(new_value, existing_list)
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
        # ... (This function is correct, no changes needed here)
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

            valid_identifier_fields = [field for field, value in new_candidate_identifiers.items() if value]
            valid_content_fields = [field for field, value in new_candidate_content_values.items() if value]
            highest_confidence_score = 0.0
            best_match_candidate = None
            final_duplicate_type = None
            final_resume_changes = None
            final_match_percentage = 0.0
            db = firestore.Client()

            for candidate in job_candidates:
                try:
                    existing_candidate_data = candidate.get('extractedText')
                    if not existing_candidate_data:
                        continue

                    identifier_similarities = {}
                    for field in identifier_fields:
                        new_val = new_candidate_identifiers.get(field, "")
                        existing_val = existing_candidate_data.get(field, "").lower()
                        if new_val and existing_val:
                            similarity = TextSimilarityProcessor.compute_tfidf_similarity(new_val, existing_val)
                            identifier_similarities[field] = similarity
                        else:
                            identifier_similarities[field] = 0.0

                    valid_identifier_scores = [identifier_similarities[field] for field in valid_identifier_fields if
                                               field in identifier_similarities]
                    avg_identifier_similarity = sum(valid_identifier_scores) / len(
                        valid_identifier_scores) if valid_identifier_scores else 0.0

                    content_similarities = {}
                    for field in content_fields:
                        new_val = new_candidate_content_values.get(field, "")
                        existing_val = existing_candidate_data.get(field, "")
                        if new_val and existing_val:
                            similarity = GeminiService.compute_similarity(new_val, existing_val)
                            content_similarities[field] = similarity
                        else:
                            content_similarities[field] = 0.0

                    valid_content_scores = [content_similarities[field] for field in valid_content_fields if
                                            field in content_similarities]
                    avg_content_similarity = sum(valid_content_scores) / len(
                        valid_content_scores) if valid_content_scores else 0.0

                    all_similarities = list(identifier_similarities.values()) + list(content_similarities.values())
                    non_zero_similarities = [score for score in all_similarities if score > 0]
                    match_percentage = (sum(non_zero_similarities) / len(
                        non_zero_similarities) * 100) if non_zero_similarities else 0.0

                    current_type = None
                    current_confidence = 0.0
                    current_resume_changes = None
                    has_copied_field = False
                    highest_field_similarity = 0.0
                    for field, similarity in content_similarities.items():
                        if similarity > CandidateService.FIELD_SIMILARITY_COPIED_THRESHOLD and similarity > highest_field_similarity:
                            has_copied_field = True
                            highest_field_similarity = similarity

                    if match_percentage >= 99.5:
                        current_type = "EXACT_DUPLICATE"
                        current_confidence = 1.0
                    elif avg_identifier_similarity >= CandidateService.IDENTIFIER_SIMILARITY_HIGH_THRESHOLD:
                        if avg_content_similarity >= CandidateService.CONTENT_SIMILARITY_EXACT_THRESHOLD:
                            current_type = "EXACT_DUPLICATE"
                            current_confidence = (avg_identifier_similarity + avg_content_similarity) / 2
                        else:  # Handles MODIFIED_RESUME for high identifier similarity
                            current_type = "MODIFIED_RESUME"
                            current_confidence = avg_content_similarity
                            current_resume_changes = CandidateService.detect_resume_changes(
                                new_candidate_content_values,
                                {k: existing_candidate_data.get(k, "") for k in content_fields})
                            change_analysis = GeminiService.analyze_resume_changes(current_resume_changes)
                            current_resume_changes["detailed_changes"] = change_analysis["detailed_changes"]
                            current_resume_changes["overall_assessment"] = change_analysis["overall_assessment"]
                    elif (avg_content_similarity >= CandidateService.CONTENT_SIMILARITY_COPIED_THRESHOLD or (
                            has_copied_field and avg_content_similarity > 0.4)):
                        current_type = "COPIED_RESUME"
                        current_confidence = max(avg_content_similarity, highest_field_similarity)
                    elif avg_identifier_similarity >= CandidateService.IDENTIFIER_SIMILARITY_MEDIUM_THRESHOLD and avg_content_similarity >= CandidateService.CONTENT_SIMILARITY_MODIFIED_THRESHOLD:
                        current_type = "MODIFIED_RESUME"
                        current_confidence = (avg_identifier_similarity * 0.4) + (avg_content_similarity * 0.6)
                        current_resume_changes = CandidateService.detect_resume_changes(new_candidate_content_values, {
                            k: existing_candidate_data.get(k, "") for k in content_fields})
                        change_analysis = GeminiService.analyze_resume_changes(current_resume_changes)
                        current_resume_changes["detailed_changes"] = change_analysis["detailed_changes"]
                        current_resume_changes["overall_assessment"] = change_analysis["overall_assessment"]

                    if current_type and current_confidence > highest_confidence_score:
                        highest_confidence_score = current_confidence
                        best_match_candidate = candidate
                        final_duplicate_type = current_type
                        final_resume_changes = current_resume_changes
                        final_match_percentage = match_percentage

                    if current_type:
                        temp_data = {"job_id": job_id, "candidate_id": candidate.get("candidateId"),
                                     "match_percentage": round(match_percentage, 2), "duplicate_type": current_type,
                                     "confidence": round(current_confidence, 2),
                                     "timestamp": datetime.now().isoformat()}
                        db.collection("temp_match_data").document(candidate.get("candidateId")).set(temp_data)
                except Exception as e:
                    logger.error(f"Error comparing candidate: {e}")
                    continue

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
        # ... (This function is correct, no changes needed here)
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

    def __init__(self, gemini_service_instance: Optional[GeminiService] = None):
        self.gemini_service = gemini_service_instance if gemini_service_instance else GeminiService()
        self.raw_text_extractor = RawTextExtractor()
        self.resume_authenticity_service = ResumeAuthenticityService(self.gemini_service)
        self.cross_referencing_service = CrossReferencingService(self.gemini_service)
        self.scoring_aggregation_service = ScoringAggregationService(self.gemini_service)
        self.document_service = DocumentService()
        self.external_ai_service = external_ai_service

    async def _run_full_analysis_pipeline(
            self,
            candidate_id_for_logging: str,
            file_content_bytes: bytes,
            file_name: str,
            content_type: str,
    ) -> Tuple[Dict[str, Any], AuthenticityAnalysisResult, CrossReferencingResult, Optional[Dict[str, Any]]]:
        # ... (This function is correct, no changes needed here)
        logger.info(f"[{candidate_id_for_logging}] Starting full analysis pipeline for {file_name}")

        raw_text_extraction_error_msg: Optional[str] = None
        extracted_urls_from_file: List[str] = []

        try:
            extracted_urls_from_file = self.raw_text_extractor.extract_all_urls(file_content_bytes, file_name)
        except Exception as e_raw_extract:
            raw_text_extraction_error_msg = f"Raw text/URL extraction failed: {str(e_raw_extract)}"
            logger.error(f"[{candidate_id_for_logging}] {raw_text_extraction_error_msg}", exc_info=True)

        loop = asyncio.get_running_loop()
        doc_ai_processing_awaitable = loop.run_in_executor(
            None, self.document_service.process_document, file_content_bytes, content_type, file_name
        )

        document_ai_results: Dict[str, Any]
        full_text_from_doc_ai: Optional[str] = None

        try:
            doc_ai_results_raw = await doc_ai_processing_awaitable
            if not doc_ai_results_raw or not isinstance(doc_ai_results_raw, dict) or doc_ai_results_raw.get("error"):
                err_msg = doc_ai_results_raw.get("error", "Unknown DocumentAI error") if isinstance(doc_ai_results_raw,
                                                                                                    dict) else "DocumentAI processing failed"
                raise Exception(err_msg)

            document_ai_results = doc_ai_results_raw
            full_text_from_doc_ai = document_ai_results.get("full_text", "")
            doc_ai_entities = document_ai_results.get("entities", {})
            candidate_name_from_doc_ai = doc_ai_entities.get("applicant_name")
            work_experience_text = doc_ai_entities.get("work_experience_paragraph")
            education_text = doc_ai_entities.get("education_paragraph")
            projects_text_from_doc_ai = doc_ai_entities.get("projects_paragraph")

        except Exception as e:
            logger.error(f"[{candidate_id_for_logging}] Critical error during DocumentAI task for {file_name}: {e}",
                         exc_info=True)
            document_ai_results = {"error": f"DocumentAI task exception: {str(e)}", "entities": {}, "full_text": ""}
            auth_error = AuthenticityAnalysisResult(content_module_error_message=f"DocumentAI task exception: {str(e)}")
            cross_ref_error = CrossReferencingResult(
                cross_ref_module_error_message=f"DocumentAI task exception: {str(e)}")
            return document_ai_results, auth_error, cross_ref_error, {"error": "DocAI task exception",
                                                                      "predicted_class_label": "Error",
                                                                      "confidence_scores": {}}

        external_ai_detection_result_data = await self.external_ai_service.predict_resume_source(
            resume_text=full_text_from_doc_ai, resume_id=candidate_id_for_logging
        ) if full_text_from_doc_ai else {"error": "No text for AI detection.", "predicted_class_label": "Unknown",
                                         "confidence_scores": {}}

        authenticity_analysis_task = self.resume_authenticity_service.analyze_resume_content(doc_ai_entities,
                                                                                             candidate_name_from_doc_ai)
        cross_referencing_task = self.cross_referencing_service.run_all_checks(
            urls=extracted_urls_from_file,
            candidate_name_on_resume=candidate_name_from_doc_ai,
            work_experience_paragraph=work_experience_text,
            education_paragraph=education_text,
            resume_projects_paragraph=projects_text_from_doc_ai
        )

        gathered_task_results = await asyncio.gather(authenticity_analysis_task, cross_referencing_task,
                                                     return_exceptions=True)

        authenticity_analysis_result = gathered_task_results[0] if isinstance(gathered_task_results[0],
                                                                              AuthenticityAnalysisResult) else AuthenticityAnalysisResult(
            content_module_error_message=str(gathered_task_results[0]))
        cross_referencing_analysis_result = gathered_task_results[1] if isinstance(gathered_task_results[1],
                                                                                   CrossReferencingResult) else CrossReferencingResult(
            cross_ref_module_error_message=str(gathered_task_results[1]))

        if raw_text_extraction_error_msg:
            cross_referencing_analysis_result.cross_ref_module_error_message = (
                                                                                           cross_referencing_analysis_result.cross_ref_module_error_message or "") + f" | Raw URL Note: {raw_text_extraction_error_msg}"

        return document_ai_results, authenticity_analysis_result, cross_referencing_analysis_result, external_ai_detection_result_data

    @staticmethod
    def create_candidate_from_data(
            job_id: str,
            file_content: bytes,
            file_name: str,
            content_type: str,
            extracted_data_from_doc_ai: Dict[str, Any],
            authenticity_analysis_result: Optional[Dict[str, Any]],
            cross_referencing_result: Optional[Dict[str, Any]],
            final_assessment_data: Dict[str, Any],
            external_ai_detection_data: Optional[Dict[str, Any]],
            user_time_zone: str,
            candidate_id_override: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Creates a candidate document in Firestore from pre-processed and pre-serialized data.
        This function is synchronous and designed to be run in a separate thread.
        """
        try:
            if candidate_id_override:
                candidate_id = candidate_id_override
                logger.info(
                    f"[create_candidate_from_data] Using provided candidate ID: {candidate_id} for file {file_name}")
            else:
                candidate_id = firebase_client.generate_counter_id("cand")
                logger.warning(
                    f"[create_candidate_from_data] No override ID provided, generating new ID: {candidate_id}")

            file_uuid_for_storage = str(uuid.uuid4())
            storage_file_name = f"{file_uuid_for_storage}_{file_name}"
            storage_path = f"resumes/{job_id}/{candidate_id}/{storage_file_name}"

            resume_url = firebase_client.upload_file(file_content, storage_path, content_type)
            if not resume_url:
                raise Exception(f"Failed to upload resume to Firebase Storage for candidate {candidate_id}")

            logger.info(f"File {file_name} uploaded successfully to {resume_url} for candidate {candidate_id}")

            entities_to_store = extracted_data_from_doc_ai.get("entities", {})
            full_text_to_store = extracted_data_from_doc_ai.get("full_text", "")

            from pytz import timezone as pytz_timezone, UnknownTimeZoneError
            try:
                tz = pytz_timezone(user_time_zone if user_time_zone else "UTC")
            except UnknownTimeZoneError:
                tz = timezone.utc
            current_time_iso = datetime.now(tz).isoformat()

            candidate_doc = {
                "candidateId": candidate_id,
                "jobId": job_id,
                "originalFileName": file_name,
                "resumeUrl": resume_url,
                "storagePath": storage_path,
                "uploadedAt": current_time_iso,
                "status": "new",
                'rank_score': None,
                'reasoning': None,
                'detailed_profile': None,
                "authenticityAnalysis": authenticity_analysis_result,
                "crossReferencingAnalysis": cross_referencing_result,
                "finalAssessmentData": final_assessment_data,
                "externalAIDetectionData": external_ai_detection_data,
                "userTimeZone": user_time_zone,
                'extractedText': entities_to_store,
                'fullTextFromDocAI': full_text_to_store
            }

            success = firebase_client.create_document('candidates', candidate_id, candidate_doc)

            if not success:
                raise Exception(f"firebase_client.create_document returned False for candidate {candidate_id}")

            logger.info(f"Successfully created candidate document for {candidate_id}")
            return_data = candidate_doc.copy()
            return_data["extractedDataFromDocAI"] = extracted_data_from_doc_ai
            return return_data

        except Exception as e:
            logger.error(f"Error in create_candidate_from_data for {file_name}: {e}", exc_info=True)
            return {"error": str(e), "fileName": file_name}

    async def create_candidate_orchestrator(
            self,
            job_id: str,
            file_content_bytes: bytes,
            file_name: str,
            content_type: str,
            override_duplicates: bool = False,
            user_time_zone: Optional[str] = "UTC",
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
            return {"error": document_ai_results.get("error", "Document processing failed"), "fileName": file_name}

        final_assessment_data = await self.scoring_aggregation_service.calculate_final_assessment(
            authenticity_analysis, cross_referencing_analysis
        )

        if authenticity_analysis:
            authenticity_analysis.final_overall_authenticity_score = final_assessment_data.get(
                "final_overall_authenticity_score")
            authenticity_analysis.final_spam_likelihood_score = final_assessment_data.get("final_spam_likelihood_score")
            authenticity_analysis.final_xai_summary = final_assessment_data.get("final_xai_summary")

        document_ai_results["is_irrelevant"] = False
        document_ai_results["gemini_irrelevant"] = None

        try:
            from services.job_service import JobService
            job_details = JobService.get_job(job_id)
            if document_ai_results.get("full_text") and job_details and job_details.get('jobDescription'):
                relevant_info = await self.gemini_service.analyze_job_relevance(
                    candidate_profile=document_ai_results.get('entities', {}),
                    job_description=job_details.get('jobDescription')
                )
                if relevant_info and relevant_info.get("relevance_label") == "Irrelevant":
                    document_ai_results["is_irrelevant"] = True
                    document_ai_results["gemini_irrelevant"] = {
                        "reason": relevant_info.get("irrelevant_reason", "No specific reason provided."),
                        "relevance_score": relevant_info.get("overall_relevance_score")
                    }
        except Exception as e_irr:
            logger.error(f"Exception while irrelevance-checking {file_name}: {e_irr}", exc_info=True)

        if not override_duplicates:
            duplicate_check_result = self.check_duplicate_candidate(job_id, document_ai_results)
            if duplicate_check_result.get("is_duplicate"):
                duplicate_check_result["new_file_analysis"] = {
                    "authenticityAnalysis": authenticity_analysis.model_dump(exclude_none=True),
                    "crossReferencingAnalysis": cross_referencing_analysis.model_dump(exclude_none=True),
                    "externalAIDetectionResult": external_ai_detection_data,
                    "final_assessment_data": final_assessment_data,
                    "docAIResults": document_ai_results
                }
                return {"is_duplicate": True, "duplicate_info": duplicate_check_result, "fileName": file_name}

        overall_auth_score = final_assessment_data.get("final_overall_authenticity_score", 0.5)
        spam_score = final_assessment_data.get("final_spam_likelihood_score", 0.5)
        is_externally_flagged_ai = external_ai_detection_data.get(
            "predicted_class_label") == "AI-generated" if external_ai_detection_data else False
        is_problematic_internally = (overall_auth_score < FINAL_AUTH_FLAG_THRESHOLD) or (
                    spam_score > SPAM_FLAG_THRESHOLD)

        if (is_externally_flagged_ai and not force_problematic_upload) or (
                document_ai_results["is_irrelevant"] and not force_irrelevant_upload):
            return {
                "is_problematic_pending_confirmation": True,
                "fileName": file_name,
                "aiFiles": [{"filename": file_name, "is_ai_generated": True,
                             "confidence": external_ai_detection_data.get("confidence_scores", {}).get("ai_generated",
                                                                                                       0),
                             "details": {}}] if is_externally_flagged_ai or is_problematic_internally else [],
                "irrelevantFiles": [
                    {"filename": file_name, "gemini_irrelevant": document_ai_results.get("gemini_irrelevant"),
                     "is_irrelevant": True}] if document_ai_results["is_irrelevant"] else [],
                "analysis_data": {
                    "document_ai_results": document_ai_results,
                    "authenticity_analysis_result": authenticity_analysis.model_dump(exclude_none=True),
                    "cross_referencing_result": cross_referencing_analysis.model_dump(exclude_none=True),
                    "external_ai_detection_data": external_ai_detection_data,
                    "final_assessment_data": final_assessment_data,
                }
            }

        candidate_creation_result = self.create_candidate_from_data(
            job_id=job_id,
            file_content=file_content_bytes,
            file_name=file_name,
            content_type=content_type,
            extracted_data_from_doc_ai=document_ai_results,
            authenticity_analysis_result=authenticity_analysis.model_dump(exclude_none=True),
            cross_referencing_result=cross_referencing_analysis.model_dump(exclude_none=True),
            final_assessment_data=final_assessment_data,
            external_ai_detection_data=external_ai_detection_data,
            user_time_zone=user_time_zone
        )

        if not candidate_creation_result or "error" in candidate_creation_result:
            return candidate_creation_result

        actual_candidate_id = candidate_creation_result.get("candidateId")
        if actual_candidate_id:
            # --- DEFINITIVE FIX IS HERE ---
            # Call the correct, existing method and pass the required arguments
            asyncio.create_task(
                self.generate_and_save_profile(
                    candidate_info=candidate_creation_result,
                    gemini_srv=self.gemini_service
                )
            )
            # --- END OF FIX ---

        return candidate_creation_result

    @staticmethod
    async def generate_and_save_profile(candidate_info: Dict[str, Any], gemini_srv: GeminiService) -> bool:
        candidate_id = candidate_info.get('candidateId')
        if not candidate_id:
            logger.warning("Missing candidateId for profile generation.")
            return False

        entities_for_profile_gen: Optional[Dict[str, Any]] = candidate_info.get("extractedText")
        if not entities_for_profile_gen:
            extracted_data_from_doc_ai = candidate_info.get("extractedDataFromDocAI", {})
            if isinstance(extracted_data_from_doc_ai, dict):
                entities_for_profile_gen = extracted_data_from_doc_ai.get("entities")
            else:
                logger.error(
                    f"generate_and_save_profile: extractedDataFromDocAI for candidate {candidate_id} is not a dictionary.")
                return False

        if not entities_for_profile_gen or not isinstance(entities_for_profile_gen, dict):
            logger.warning(f"No valid 'entities' dictionary found for candidate {candidate_id} to generate profile.")
            return False

        applicant_data_for_gemini = {"candidateId": candidate_id, "extractedText": entities_for_profile_gen}
        try:
            detailed_profile = await gemini_srv.generate_candidate_profile(applicant_data_for_gemini)
            if not detailed_profile or not isinstance(detailed_profile, dict) or "summary" not in detailed_profile:
                logger.warning(f"Failed to generate valid detailed profile for {candidate_id}.")
                return False

            profile_update_model = CandidateUpdate(detailed_profile=detailed_profile)
            success = CandidateService.update_candidate(candidate_id, profile_update_model)

            if success:
                logger.info(f"Successfully generated and saved detailed profile for candidate {candidate_id}")
                return True
            else:
                logger.warning(f"Failed to save detailed profile for candidate {candidate_id}")
                return False
        except Exception as e:
            logger.error(f"Error in generate_and_save_profile for candidate {candidate_id}: {e}", exc_info=True)
            return False

    @staticmethod
    def get_candidate(candidate_id: str) -> Optional[Dict[str, Any]]:
        try:
            return firebase_client.get_document('candidates', candidate_id)
        except Exception as e:
            logger.error(f"Error getting candidate {candidate_id}: {e}")
            return None

    @staticmethod
    def update_candidate_status(candidate_id: str, status: str) -> bool:
        try:
            return firebase_client.update_document('candidates', candidate_id, {'status': status})
        except Exception as e:
            logger.error(f"Error updating candidate {candidate_id} status: {e}")
            return False

    @staticmethod
    def update_candidate(candidate_id: str, candidate_data: CandidateUpdate) -> bool:
        try:
            update_data = {}
            for field, value in candidate_data.model_dump(exclude_unset=True, exclude_none=True).items():
                if isinstance(value, (AuthenticityAnalysisResult, CrossReferencingResult)):
                    update_data[field] = value.model_dump(exclude_none=True)
                elif value is not None:
                    update_data[field] = value

            if not update_data:
                logger.warning(f"[{candidate_id}] No fields to update for candidate.")
                return True

            success = firebase_client.update_document('candidates', candidate_id, update_data)
            return success
        except Exception as e:
            logger.error(f"Error updating candidate {candidate_id}: {e}")
            return False

    @staticmethod
    def process_applications(job_id: str, candidates_info: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
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
        try:
            overwrite_target = firebase_client.get_document("overwrite_targets", job_id)
            if overwrite_target and isinstance(overwrite_target, dict):
                return overwrite_target.get("candidate_id")
            return None
        except Exception as e:
            logger.error(f"Error retrieving overwrite target for job {job_id}: {e}", exc_info=True)
            return None