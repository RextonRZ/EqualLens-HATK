from fastapi import APIRouter, HTTPException, Form, File, UploadFile, Body, status, Request
from fastapi.responses import JSONResponse
from typing import List, Optional, Dict, Any, Tuple
import json
import logging
import asyncio
from fastapi.encoders import jsonable_encoder
import uuid
from datetime import datetime, timezone # Ensure timezone is imported from datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from core.firebase import firebase_client

from models.job import JobCreate, JobResponse, JobUpdate, JobSuggestionContext, JobSuggestionResponse
from models.candidate import CandidateUpdate
from models.ai_detection import \
    AIDetectionResult  # For type hinting if needed, though not directly returned as Pydantic model by these endpoints
from models.authenticity_analysis import AuthenticityAnalysisResult
from models.cross_referencing import CrossReferencingResult

from services.job_service import JobService
from services.candidate_service import CandidateService
from services.gemini_service import GeminiService
from services.ai_detection_service import AIDetectionService
from services.ai_detection_service import FINAL_AUTH_FLAG_THRESHOLD, SPAM_FLAG_THRESHOLD  # For logic within this file

router = APIRouter()
logger = logging.getLogger(__name__)

# Instantiate services
gemini_service_global_instance = GeminiService()
candidate_service_instance = CandidateService(gemini_service_instance=gemini_service_global_instance)
ai_detection_formatter_instance = AIDetectionService()


@router.get("/", response_model=List[JobResponse])
async def get_jobs_list():  # Renamed to avoid conflict with get_job
    """Get all jobs."""
    try:
        jobs = JobService.get_jobs()
        return jobs
    except Exception as e:
        logger.error(f"Error getting jobs: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get jobs: {str(e)}")


@router.get("/{job_id}", response_model=JobResponse)
async def get_job_by_id(job_id: str):  # Renamed to avoid conflict
    """Get a job by ID."""
    job = JobService.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return JobResponse(**job)  # Ensure it's cast to JobResponse


@router.put("/{job_id}", response_model=JobResponse)
async def update_job_details(job_id: str, job_update_data: JobUpdate):  # Renamed parameters for clarity
    """Update a job."""
    existing_job = JobService.get_job(job_id)
    if not existing_job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    # Prepare update_data, handling minimumCGPA explicitly
    update_data_dict = job_update_data.model_dump(exclude_unset=True)
    if "minimumCGPA" in update_data_dict:
        if update_data_dict["minimumCGPA"] is None or update_data_dict["minimumCGPA"] == -1:
            update_data_dict["minimumCGPA"] = 0.0  # Store 0.0 for N/A
        else:
            try:
                update_data_dict["minimumCGPA"] = float(update_data_dict["minimumCGPA"])
            except (ValueError, TypeError):
                logger.warning(
                    f"Invalid minimumCGPA '{update_data_dict['minimumCGPA']}' during update, setting to 0.0.")
                update_data_dict["minimumCGPA"] = 0.0

    final_job_update_model = JobUpdate(**update_data_dict)

    logger.info(f"Updating job {job_id} with data: {final_job_update_model.model_dump(exclude_none=True)}")
    success = JobService.update_job(job_id, final_job_update_model)

    if not success:
        raise HTTPException(status_code=500, detail="Failed to update job")

    updated_job_data = JobService.get_job(job_id)
    if not updated_job_data:
        raise HTTPException(status_code=500, detail="Failed to retrieve updated job after update.")

    return JobResponse(**updated_job_data)

# This is the existing helper function from your provided code, used by /upload-job
async def _process_single_file_for_candidate_creation(
        job_id_for_analysis: str, # Conceptual ID during analysis phase for /upload-job
        job_description_text_for_relevance: str, # <<< ADD THIS PARAMETER
        file_obj: UploadFile,
        user_time_zone: str,
        override_duplicates_from_form: bool,
        force_upload_problematic_from_form: bool,
        force_upload_irrelevant_from_form: bool
) -> Dict[str, Any]:
    file_content_bytes = await file_obj.read()
    file_name_val = file_obj.filename
    content_type_val = file_obj.content_type or "application/pdf"

    temp_candidate_service = CandidateService(gemini_service_instance=gemini_service_global_instance)

    document_ai_results, authenticity_analysis, cross_referencing_analysis, external_ai_detection_data = \
        await temp_candidate_service._run_full_analysis_pipeline(
            candidate_id_for_logging=f"temp-uploadjob-analyze-{uuid.uuid4()}",
            file_content_bytes=file_content_bytes,
            file_name=file_name_val,
            content_type=content_type_val
        )

    if not document_ai_results or document_ai_results.get("error"):
        logger.error(f"Critical DocumentAI processing failed for {file_name_val} during /upload-job analysis.")
        # Return more info for potential candidate creation later if forced
        return {
            "fileName": file_name_val, "status": "error_analysis", 
            "message": "DocAI processing failed",
            "file_content_bytes": file_content_bytes, "content_type": content_type_val, # Keep raw data
            "document_ai_results": document_ai_results # Keep partial results if any
        }


    final_assessment_data = await temp_candidate_service.scoring_aggregation_service.calculate_final_assessment(
        authenticity_analysis, cross_referencing_analysis
    )
    if authenticity_analysis:
        authenticity_analysis.final_overall_authenticity_score = final_assessment_data.get("final_overall_authenticity_score")
        authenticity_analysis.final_spam_likelihood_score = final_assessment_data.get("final_spam_likelihood_score")
        authenticity_analysis.final_xai_summary = final_assessment_data.get("final_xai_summary")

    # --- Duplicate Check ---
    if not override_duplicates_from_form:
        # job_id_for_analysis is conceptual here for /upload-job before job exists
        duplicate_check_result = CandidateService.check_duplicate_candidate(job_id_for_analysis, document_ai_results)
        if duplicate_check_result.get("is_duplicate"):
            logger.info(f"File {file_name_val} is a duplicate (pre-job-creation check for /upload-job).")
            return {
                "fileName": file_name_val, "status": "duplicate_detected_error",
                "message": f"Duplicate of existing candidate: {duplicate_check_result.get('duplicate_candidate', {}).get('candidateId', 'Unknown')}",
                "duplicate_info_raw": duplicate_check_result,
                "file_content_bytes": file_content_bytes, "content_type": content_type_val, # Return all data
"authenticity_analysis_result": authenticity_analysis.model_dump(exclude_none=True) if authenticity_analysis else None,
        "cross_referencing_result": cross_referencing_analysis.model_dump(exclude_none=True) if cross_referencing_analysis else None,
                "external_ai_detection_data": external_ai_detection_data, "final_assessment_data": final_assessment_data
            }

    # --- Irrelevance Check ---
    is_irrelevant_flag = False
    irrelevance_payload_for_modal = None
    try:
        candidate_profile_for_relevance = document_ai_results.get('entities', {})
        if candidate_profile_for_relevance and job_description_text_for_relevance: # Use passed JD
            relevant_info = await temp_candidate_service.gemini_service.analyze_job_relevance(
                candidate_profile=candidate_profile_for_relevance,
                job_description=job_description_text_for_relevance
            )
            if relevant_info and relevant_info.get("relevance_label") == "Irrelevant":
                is_irrelevant_flag = True
                reason = relevant_info.get("irrelevant_reason")
                if isinstance(reason, list): reason = ", ".join(str(r) for r in reason)
                relevance_score_val = relevant_info.get("overall_relevance_score")
                calculated_irrelevance_score = None
                if relevance_score_val is not None:
                    try: calculated_irrelevance_score = 100.0 - float(relevance_score_val)
                    except (ValueError, TypeError): logger.warning(f"Could not calc irrelevance_score from {relevance_score_val}")
                irrelevance_payload_for_modal = {
                    "filename": file_name_val, "is_irrelevant": True, "irrelevant_reason": reason,
                    "irrelevance_score": calculated_irrelevance_score, "job_type": relevant_info.get("job_type", "")
                }
        else: logger.warning(f"Missing candidate profile or job desc for irrelevance check of {file_name_val} in /upload-job helper.")
    except Exception as e_irr: logger.error(f"Exception during irrelevance check for {file_name_val} (/upload-job helper): {e_irr}", exc_info=True)

    # --- AI/Problematic Flags ---
    overall_auth_score = final_assessment_data.get("final_overall_authenticity_score", 0.5)
    spam_score = final_assessment_data.get("final_spam_likelihood_score", 0.5)
    is_externally_flagged_ai = external_ai_detection_data.get("predicted_class_label") == "AI-generated" if external_ai_detection_data else False
    is_problematic_internally = (overall_auth_score < FINAL_AUTH_FLAG_THRESHOLD) or (spam_score > SPAM_FLAG_THRESHOLD)
    is_globally_problematic_ai_wise = is_externally_flagged_ai or is_problematic_internally
    ai_detection_payload_for_modal = None
    if is_globally_problematic_ai_wise:
        payload_is_ai_generated_for_modal = is_externally_flagged_ai
        payload_confidence_for_modal = 0.0
        if is_externally_flagged_ai:
            payload_confidence_for_modal = external_ai_detection_data.get("confidence_scores", {}).get("ai_generated", 0.0)
        elif is_problematic_internally:
            payload_is_ai_generated_for_modal = True
            payload_confidence_for_modal = max(1.0 - overall_auth_score, spam_score)
        formatted_reason_html_res = ai_detection_formatter_instance.format_analysis_for_frontend(
            filename=file_name_val, auth_results=authenticity_analysis,
            cross_ref_results=cross_referencing_analysis, external_ai_pred_data=external_ai_detection_data)
        formatted_reason_html = formatted_reason_html_res.reason if formatted_reason_html_res else "Detailed analysis available."
        ai_detection_payload_for_modal = {
            "filename": file_name_val, "is_ai_generated": payload_is_ai_generated_for_modal,
            "confidence": payload_confidence_for_modal, "reason": formatted_reason_html,
            "details": {
                "external_ai_prediction": external_ai_detection_data,
                "authenticity_analysis": authenticity_analysis.model_dump(exclude_none=True) if authenticity_analysis else None,
                "cross_referencing_analysis": cross_referencing_analysis.model_dump(exclude_none=True) if cross_referencing_analysis else None,
                "final_overall_authenticity_score": overall_auth_score,
                "final_spam_likelihood_score": spam_score,
                "final_xai_summary": final_assessment_data.get("final_xai_summary")
            }
        }
    
    current_status = "success_analysis" # Default if no unforced flags
    if is_globally_problematic_ai_wise and is_irrelevant_flag and not force_upload_problematic_from_form and not force_upload_irrelevant_from_form:
        current_status = "ai_and_irrelevant_content"
    elif is_globally_problematic_ai_wise and not force_upload_problematic_from_form:
        current_status = "ai_content_detected"
    elif is_irrelevant_flag and not force_upload_irrelevant_from_form:
        current_status = "irrelevant_content"

    # This function NO LONGER creates candidates. It returns analysis data.
    return {
        "fileName": file_name_val,
        "status": current_status,
        "ai_detection_payload": ai_detection_payload_for_modal,
        "irrelevance_payload": irrelevance_payload_for_modal,
        # Raw data needed for actual candidate creation later:
        "file_content_bytes": file_content_bytes,
        "content_type": content_type_val,
        "document_ai_results": document_ai_results,
        "authenticity_analysis_result_obj": authenticity_analysis, # Pass the Pydantic model object
        "cross_referencing_result_obj": cross_referencing_analysis, # Pass the Pydantic model object
        "external_ai_detection_data": external_ai_detection_data,
        "final_assessment_data": final_assessment_data,
        # Store force flags to respect them if job proceeds after modal
        "force_upload_problematic_from_form": force_upload_problematic_from_form,
        "force_upload_irrelevant_from_form": force_upload_irrelevant_from_form,
        "user_time_zone": user_time_zone
    }

# This helper function from your old code is not used by the new /upload-more-cv logic.
# It's commented out to avoid confusion. If another part of your system uses it, it can be reinstated.
# async def _analyze_file_without_creating_candidate(
# job_id_for_creation: str,
# file_obj: UploadFile,
# user_time_zone: str,
# override_duplicates_from_form: bool,
# force_upload_problematic_from_form: bool,
# force_upload_irrelevant_from_form: bool
# ) -> Dict[str, Any]:
# """Analyze file for duplicates/issues WITHOUT creating any candidate records"""
# # ... (your existing implementation of this function) ...
#     logger.warning("_analyze_file_without_creating_candidate is deprecated and should be replaced by newer pipeline logic if used.")
# return {"fileName": file_obj.filename, "status": "error", "message": "_analyze_file_without_creating_candidate called unexpectedly."}


# NEW HELPER FUNCTION: _analyze_single_file_for_upload_pipeline
# This function performs analysis without creating a candidate and returns rich data for modals.
async def _analyze_single_file_for_upload_pipeline(
        job_id_for_analysis: str,
        file_obj: UploadFile,
) -> Dict[str, Any]:
    file_content_bytes = await file_obj.read()
    file_name_val = file_obj.filename
    content_type_val = file_obj.content_type or "application/pdf"

    temp_candidate_service = CandidateService(gemini_service_instance=gemini_service_global_instance)

    document_ai_results, authenticity_analysis, cross_referencing_analysis, external_ai_detection_data = \
        await temp_candidate_service._run_full_analysis_pipeline(
            candidate_id_for_logging=f"temp-analyze-{uuid.uuid4()}",
            file_content_bytes=file_content_bytes,
            file_name=file_name_val,
            content_type=content_type_val
        )

    if not document_ai_results or document_ai_results.get("error"):
        logger.error(f"Critical DocumentAI processing failed for {file_name_val} during analysis stage.")
        return {
            "fileName": file_name_val, "status": "error",
            "message": document_ai_results.get("error", "DocAI processing failed") if document_ai_results else "DocAI processing failed",
            "file_content_bytes": file_content_bytes # Keep for potential retry or manual inspection if needed
        }

    final_assessment_data = await temp_candidate_service.scoring_aggregation_service.calculate_final_assessment(
        authenticity_analysis, cross_referencing_analysis
    )
    if authenticity_analysis: # Ensure authenticity_analysis object exists before assigning
        authenticity_analysis.final_overall_authenticity_score = final_assessment_data.get("final_overall_authenticity_score")
        authenticity_analysis.final_spam_likelihood_score = final_assessment_data.get("final_spam_likelihood_score")
        authenticity_analysis.final_xai_summary = final_assessment_data.get("final_xai_summary")

    is_irrelevant_flag = False
    relevance_analysis_payload_for_modal = None
    try:
        job_details = JobService.get_job(job_id_for_analysis)
        candidate_profile_for_relevance = document_ai_results.get('entities', {})
        if candidate_profile_for_relevance and job_details and job_details.get('jobDescription'):
            relevant_info = await temp_candidate_service.gemini_service.analyze_job_relevance(
                candidate_profile=candidate_profile_for_relevance, # Pass entities for relevance
                job_description=job_details.get('jobDescription')
            )
            if relevant_info and relevant_info.get("relevance_label") == "Irrelevant":
                is_irrelevant_flag = True
                reason = relevant_info.get("irrelevant_reason")
                if isinstance(reason, list): reason = ", ".join(str(r) for r in reason)
                relevance_score = relevant_info.get("overall_relevance_score")
                calculated_irrelevance_score = None
                if relevance_score is not None:
                    try: calculated_irrelevance_score = 100.0 - float(relevance_score)
                    except (ValueError, TypeError): logger.warning(f"Could not calc irrelevance_score from {relevance_score}")
                relevance_analysis_payload_for_modal = {
                    "filename": file_name_val, "is_irrelevant": True, "irrelevant_reason": reason,
                    "irrelevance_score": calculated_irrelevance_score, "job_type": relevant_info.get("job_type", "")
                }
        else: logger.warning(f"Missing data for irrelevance check of {file_name_val} during analysis stage.")
    except Exception as e_irr: logger.error(f"Exception during irrelevance check for {file_name_val}: {e_irr}", exc_info=True)

    overall_auth_score = final_assessment_data.get("final_overall_authenticity_score", 0.5)
    spam_score = final_assessment_data.get("final_spam_likelihood_score", 0.5)
    is_externally_flagged_ai = external_ai_detection_data.get("predicted_class_label") == "AI-generated" if external_ai_detection_data else False
    is_problematic_internally = (overall_auth_score < FINAL_AUTH_FLAG_THRESHOLD) or (spam_score > SPAM_FLAG_THRESHOLD)
    is_globally_problematic_ai_wise = is_externally_flagged_ai or is_problematic_internally

    ai_detection_payload_for_modal = None
    if is_globally_problematic_ai_wise:
        payload_is_ai_generated_for_modal = is_externally_flagged_ai
        payload_confidence_for_modal = 0.0
        if is_externally_flagged_ai:
            payload_confidence_for_modal = external_ai_detection_data.get("confidence_scores", {}).get("ai_generated", 0.0)
        elif is_problematic_internally:
            payload_is_ai_generated_for_modal = True
            payload_confidence_for_modal = max(1.0 - overall_auth_score, spam_score)
        
        formatted_reason_html_res = ai_detection_formatter_instance.format_analysis_for_frontend(
            filename=file_name_val, auth_results=authenticity_analysis,
            cross_ref_results=cross_referencing_analysis, external_ai_pred_data=external_ai_detection_data)
        formatted_reason_html = formatted_reason_html_res.reason if formatted_reason_html_res else "Detailed analysis available."


        ai_detection_payload_for_modal = {
            "filename": file_name_val, "is_ai_generated": payload_is_ai_generated_for_modal,
            "confidence": payload_confidence_for_modal, "reason": formatted_reason_html,
            "details": {
                "external_ai_prediction": external_ai_detection_data,
                "authenticity_analysis": authenticity_analysis.model_dump(exclude_none=True) if authenticity_analysis else None,
                "cross_referencing_analysis": cross_referencing_analysis.model_dump(exclude_none=True) if cross_referencing_analysis else None,
                "final_overall_authenticity_score": overall_auth_score,
                "final_spam_likelihood_score": spam_score,
                "final_xai_summary": final_assessment_data.get("final_xai_summary")
            }
        }
    
    return {
        "fileName": file_name_val, "status": "analyzed",
        "file_content_bytes": file_content_bytes, "content_type": content_type_val,
        "document_ai_results": document_ai_results,
        "authenticity_analysis_result": authenticity_analysis.model_dump(exclude_none=True) if authenticity_analysis else None,
        "cross_referencing_result": cross_referencing_analysis.model_dump(exclude_none=True) if cross_referencing_analysis else None,
        "external_ai_detection_data": external_ai_detection_data,
        "final_assessment_data": final_assessment_data,
        "is_ai_problematic": is_globally_problematic_ai_wise,
        "ai_detection_payload_for_modal": ai_detection_payload_for_modal,
        "is_irrelevant": is_irrelevant_flag,
        "irrelevance_payload_for_modal": relevance_analysis_payload_for_modal,
    }

async def generate_and_save_profile(candidate_info: Dict[str, Any], gemini_srv: GeminiService) -> bool:
    candidate_id = candidate_info.get('candidateId')
    extracted_data_from_doc_ai = candidate_info.get("extractedDataFromDocAI", {}) # Newer structure uses this key
    if not extracted_data_from_doc_ai and 'candidate_data' in candidate_info: # Fallback for older structure
        extracted_data_from_doc_ai = candidate_info['candidate_data'].get("extractedDataFromDocAI", {})
    
    entities_for_profile_gen: Optional[Dict[str, Any]] = None

    if isinstance(extracted_data_from_doc_ai, dict):
        entities_for_profile_gen = extracted_data_from_doc_ai.get("entities")
    else:
        logger.error(f"generate_and_save_profile: extractedDataFromDocAI for candidate {candidate_id} is not a dictionary.")
        return False

    if not candidate_id:
        logger.warning("Missing candidateId in candidate_info for profile generation.")
        return False
    if not entities_for_profile_gen or not isinstance(entities_for_profile_gen, dict):
        logger.warning(f"No 'entities' dictionary for candidate {candidate_id}. ExtractedData: {extracted_data_from_doc_ai}")
        return False

    applicant_data_for_gemini = {"candidateId": candidate_id, "extractedText": entities_for_profile_gen}
    try:
        logger.info(f"Generating detailed profile for candidate {candidate_id} via jobs.py helper")
        detailed_profile = await gemini_srv.generate_candidate_profile(applicant_data_for_gemini)

        if not detailed_profile or not isinstance(detailed_profile, dict) or "summary" not in detailed_profile:
            logger.warning(f"Failed to generate valid detailed profile for {candidate_id}. Profile: {detailed_profile}")
            return False

        update_payload = {"detailed_profile": detailed_profile}
        profile_update_model = CandidateUpdate(**update_payload)
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
    
async def _generate_and_save_profile(candidate_id: str, 
    extracted_data_from_doc_ai: Dict[str, Any], 
    gemini_srv: GeminiService
) -> bool:
    # No longer need to extract from a large dict
    entities_for_profile_gen = extracted_data_from_doc_ai.get("entities")
    
    if not candidate_id: # This check is still good
        logger.warning("Missing candidateId for profile generation.")
        return False
    if not entities_for_profile_gen or not isinstance(entities_for_profile_gen, dict):
        logger.warning(f"No 'entities' dictionary for candidate {candidate_id}.")
        return False

    applicant_data_for_gemini = {"candidateId": candidate_id, "extractedText": entities_for_profile_gen}
    try:
        logger.info(f"Generating detailed profile for candidate {candidate_id} via jobs.py helper")
        detailed_profile = await gemini_srv.generate_candidate_profile(applicant_data_for_gemini)

        if not detailed_profile or not isinstance(detailed_profile, dict) or "summary" not in detailed_profile:
            logger.warning(f"Failed to generate valid detailed profile for {candidate_id}. Profile: {detailed_profile}")
            return False

        # Use CandidateUpdate model for type safety
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


@router.post("/upload-job")
async def upload_job_and_cvs(
        job_data_json_str: str = Form(..., alias="job_data"),
        files: List[UploadFile] = File(...),
        force_upload_ai_flagged: Optional[str] = Form(None),
        force_upload_irrelevant: Optional[str] = Form(None),
        user_time_zone: str = Form("UTC")
):
    try:
        job_details = json.loads(job_data_json_str)
        logger.info(f"Received new job details: {job_details.get('jobTitle')}, with {len(files)} CVs for /upload-job.")
        if not files:
            raise HTTPException(status_code=400, detail="No CV files provided for new job.")

        is_forcing_problematic_upload_consent = (force_upload_ai_flagged and force_upload_ai_flagged.lower() == "true")
        is_forcing_irrelevant_upload_consent = (force_upload_irrelevant and force_upload_irrelevant.lower() == "true")

        # --- Prepare JobCreate payload but DON'T create job in DB yet ---
        skills = job_details.get("skills", [])
        required_skills = job_details.get("requiredSkills", skills)
        minimum_cgpa_raw = job_details.get("minimumCGPA")
        minimum_cgpa = 0.0
        if minimum_cgpa_raw not in [-1, None, "n/a", "N/A", ""]:
            try:
                minimum_cgpa = float(minimum_cgpa_raw)
            except (ValueError, TypeError):
                logger.warning(f"Invalid minimumCGPA value '{minimum_cgpa_raw}', defaulting to 0.0.")

        job_create_payload = JobCreate(
            jobTitle=job_details.get("jobTitle"),
            jobDescription=job_details.get("jobDescription", ""),
            departments=job_details.get("departments", []),
            minimumCGPA=minimum_cgpa,
            requiredSkills=required_skills,
            prompt=job_details.get("prompt", "")
        )
        job_description_text_for_analysis = job_details.get("jobDescription", "") # For irrelevance check

        # --- STAGE 1: Analyze ALL files first ---
        temp_job_id_for_analysis = f"temp-job-analysis-{uuid.uuid4()}" # Conceptual ID for analysis

        file_analysis_tasks = [
            _process_single_file_for_candidate_creation( # Uses the MODIFIED helper
                job_id_for_analysis=temp_job_id_for_analysis,
                job_description_text_for_relevance=job_description_text_for_analysis, # <<< PASS JD TEXT
                file_obj=file_obj,
                user_time_zone=user_time_zone,
                override_duplicates_from_form=False, # For new job, duplicates are errors by default
                force_upload_problematic_from_form=is_forcing_problematic_upload_consent,
                force_upload_irrelevant_from_form=is_forcing_irrelevant_upload_consent
            ) for file_obj in files
        ]
        processed_analysis_results = await asyncio.gather(*file_analysis_tasks)

        # --- STAGE 2: Categorize results ---
        files_ready_for_creation = []
        error_files = []
        duplicate_errors = []
        flagged_files_for_modal = []

        for res in processed_analysis_results:
            # === FIX: Renamed 'status' to 'file_status' to avoid conflict ===
            file_status = res.get("status")
            if file_status == "success_analysis":
                files_ready_for_creation.append(res)
            elif file_status == "error_analysis":
                error_files.append(res)
            elif file_status == "duplicate_detected_error":
                duplicate_errors.append(res)
            elif file_status in ["ai_content_detected", "irrelevant_content", "ai_and_irrelevant_content"]:
                flagged_files_for_modal.append(res)
            else:
                error_files.append({"fileName": res.get("fileName"), "status": "error_analysis", "message": f"Unknown file status: {file_status}"})
                
        # --- STAGE 3: AI/Irrelevance Modal Check ---
        # If any files were flagged AND the user hasn't already consented via the form, show the modal.
        if flagged_files_for_modal:
            logger.info(f"/upload-job: {len(flagged_files_for_modal)} files require confirmation. Job NOT created yet.")
            
            # Prepare data for the modal UI
            modal_display_data = []
            for payload in flagged_files_for_modal:
                combined_payload = {"filename": payload["fileName"]}
                if payload.get("ai_detection_payload"): combined_payload.update(payload["ai_detection_payload"])
                if payload.get("irrelevance_payload"): combined_payload.update(payload["irrelevance_payload"])
                modal_display_data.append(combined_payload)

            # SOLUTION: Return all the necessary data for the frontend to hold and resubmit.
            # We exclude the raw bytes from the JSON response, as the file will be re-uploaded.
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, # This will now work
                content={
                    "message": "Some resumes require review. Job creation is pending your confirmation.",
                    "error_type": "FLAGGED_CONTENT_NEW_JOB",
                    "flagged_files_for_modal": jsonable_encoder(modal_display_data),
                    "job_creation_payload_json": job_create_payload.model_dump_json(),
                    "user_time_zone": user_time_zone,
                    "successful_analysis_payloads": jsonable_encoder(files_ready_for_creation, custom_encoder={bytes: lambda b: None}),
                    "flagged_analysis_payloads": jsonable_encoder(flagged_files_for_modal, custom_encoder={bytes: lambda b: None}),
                })

        # --- STAGE 4: If no AI modal (or consent was given via form), CREATE JOB and then CANDIDATES ---
        # This path is for when all files are OK, or when the user forced the upload from the start.
        all_files_to_create = files_ready_for_creation # In this path, flagged_files_for_modal is empty.
        if not all_files_to_create:
             return JSONResponse(status_code=400, content={"message": "No valid CVs to process after filtering errors.", "errors": error_files, "duplicates_found": duplicate_errors})
        
        actual_job_id = JobService.create_job(job_create_payload)
        if not actual_job_id:
            raise HTTPException(status_code=500, detail="Failed to create job entry in database.")
        
        successful_candidates = []
        creation_tasks = [
            _create_candidate_task(
                job_id=actual_job_id,
                analysis_payload=payload,
                user_time_zone=user_time_zone
            ) for payload in all_files_to_create
        ]
        
        created_results = await asyncio.gather(*creation_tasks, return_exceptions=True)
        for i, res in enumerate(created_results):
            if isinstance(res, Exception) or (isinstance(res, dict) and "error" in res):
                error_files.append({"fileName": all_files_to_create[i]["fileName"], "message": str(res)})
            else:
                successful_candidates.append(res)
        
        applications_info = JobService.process_applications(actual_job_id, successful_candidates)
        profile_tasks = [_generate_and_save_profile(cand, gemini_service_global_instance) for cand in successful_candidates]
        await asyncio.gather(*profile_tasks)
        
        return JSONResponse(status_code=201, content=jsonable_encoder({
            "jobId": actual_job_id, "jobTitle": job_details.get("jobTitle"),
            "applicationCount": len(applications_info), "applications": applications_info,
            "successfulCandidates": [c['candidateId'] for c in successful_candidates],
            "errors": error_files, "duplicates_found": duplicate_errors
        }))

    except Exception as e:
        logger.error(f"Error in /upload-job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    
def _create_candidate_task(
    job_id: str,
    analysis_payload: Dict[str, Any],
    user_time_zone: str,
    file_content: Optional[bytes] = None, 
    candidate_id_override: Optional[str] = None
):
    """Helper to create a single, isolated candidate creation task."""
    
    # Rehydrate Pydantic models from the payload's dictionary representation
    auth_obj = AuthenticityAnalysisResult(**analysis_payload.get("authenticity_analysis_result_obj", {})) if analysis_payload.get("authenticity_analysis_result_obj") else None
    cross_ref_obj = CrossReferencingResult(**analysis_payload.get("cross_referencing_result_obj", {})) if analysis_payload.get("cross_referencing_result_obj") else None

    # Use passed file_content if available, otherwise get from payload (for /upload-job)
    content_to_use = file_content if file_content is not None else analysis_payload["file_content_bytes"]
    
    return asyncio.to_thread(
        candidate_service_instance.create_candidate_from_data,
        job_id=job_id,
        file_content=content_to_use,
        file_name=analysis_payload["fileName"],
        content_type=analysis_payload["content_type"],
        extracted_data_from_doc_ai=analysis_payload["document_ai_results"],
        authenticity_analysis_result=auth_obj,
        cross_referencing_result=cross_ref_obj,
        final_assessment_data=analysis_payload["final_assessment_data"],
        external_ai_detection_data=analysis_payload["external_ai_detection_data"],
        user_time_zone=user_time_zone,
        candidate_id_override=candidate_id_override
        # IMPORTANT: No candidate_id_override is passed.
    )

@router.post("/create-job-with-confirmed-cvs")
async def create_job_with_confirmed_cvs(
    job_creation_payload_json: str = Form(...),
    successful_analysis_payloads_json: str = Form(...),
    flagged_analysis_payloads_json: str = Form(...),
    user_time_zone: str = Form("UTC"),
    files: List[UploadFile] = File(...)
):
    """
    Creates a job and candidates from pre-analyzed data after user confirmation.
    This endpoint does NOT perform any analysis itself.
    """
    logger.info("Received request to create job from confirmed (pre-analyzed) CVs.")
    try:
        # Step 1: Deserialize all the JSON data sent from the frontend
        job_create_payload = JobCreate.model_validate_json(job_creation_payload_json)
        successful_payloads = json.loads(successful_analysis_payloads_json)
        flagged_payloads = json.loads(flagged_analysis_payloads_json)

        # Create a dictionary to easily find file content by filename
        uploaded_files_content = {file.filename: await file.read() for file in files}

        # Step 2: Create the job in the database
        actual_job_id = JobService.create_job(job_create_payload)
        if not actual_job_id:
            raise HTTPException(status_code=500, detail="Failed to create job entry in database on confirmed submission.")
        logger.info(f"Created actual job {actual_job_id} via confirmed upload endpoint.")

        # Step 3: Combine all payloads and prepare for candidate creation
        all_payloads_for_creation = successful_payloads + flagged_payloads
        error_files = []
        
        # Step A: Sequentially generate all the IDs you need in a single thread.
        sequentially_generated_ids = []
        for _ in all_payloads_for_creation:
            sequentially_generated_ids.append(firebase_client.generate_counter_id("cand"))
        logger.info(f"Sequentially pre-generated IDs for batch creation: {sequentially_generated_ids}")

        # Step B: Create concurrent tasks, passing in the unique pre-generated ID for each.
        creation_tasks = []
        for i, payload in enumerate(all_payloads_for_creation):
            file_name = payload.get("fileName")
            file_content_bytes = uploaded_files_content.get(file_name)
            if not file_content_bytes:
                logger.error(f"File '{file_name}' was in payload but not found in re-uploaded files.")
                error_files.append({"fileName": file_name, "message": "File content was missing on re-submission."})
                continue
            
            creation_tasks.append(
                _create_candidate_task(
                    job_id=actual_job_id,
                    analysis_payload=payload,
                    user_time_zone=user_time_zone,
                    file_content=file_content_bytes,
                    candidate_id_override=sequentially_generated_ids[i] # <-- Pass the unique ID
                )
            )

        # Step 4: Execute creation and process results (same as the original endpoint's success path)
        successful_candidates = []
        created_results = await asyncio.gather(*creation_tasks, return_exceptions=True)
        for i, res in enumerate(created_results):
            if isinstance(res, Exception) or (isinstance(res, dict) and "error" in res):
                error_files.append({"fileName": all_payloads_for_creation[i]["fileName"], "message": str(res)})
            else:
                successful_candidates.append(res)
        
        applications_info = CandidateService.process_applications(actual_job_id, successful_candidates)
        profile_tasks = [
            _generate_and_save_profile(
                candidate_id=cand.get("candidateId"),
                extracted_data_from_doc_ai=cand.get("extractedDataFromDocAI"),
                gemini_srv=gemini_service_global_instance
            ) for cand in successful_candidates
        ]
        await asyncio.gather(*profile_tasks)
        
        return JSONResponse(status_code=201, content=jsonable_encoder({
            "jobId": actual_job_id, "jobTitle": job_create_payload.jobTitle,
            "applicationCount": len(applications_info), "applications": applications_info,
            "successfulCandidates": [c['candidateId'] for c in successful_candidates],
            "errors": error_files,
            "message": "Job created and all CVs processed successfully after confirmation."
        }))

    except Exception as e:
        logger.error(f"Error in /create-job-with-confirmed-cvs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to process confirmed submission: {str(e)}")

# REPLACED upload_more_cv_for_job with the multi-stage version
@router.post("/upload-more-cv")
async def upload_more_cv_for_job(
        job_id: str = Form(...),
        files: List[UploadFile] = File(...),
        override_duplicates: Optional[str] = Form("false"),
        selected_filenames_for_overwrite_json: Optional[str] = Form(None, alias="selected_filenames"),
        force_upload_ai_flagged: Optional[str] = Form(None), 
        force_upload_irrelevant: Optional[str] = Form(None), 
        user_time_zone: str = Form("UTC")
):
    logger.info(
        f"UploadMoreCV: JobID {job_id}, Files: {len(files)}, OverrideDupGen: {override_duplicates}, "
        f"ForceAI: {force_upload_ai_flagged}, ForceIrrelevant: {force_upload_irrelevant}, "
        f"SelectedOverwriteJSON: {selected_filenames_for_overwrite_json}"
    )
    try:
        job = JobService.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        if not files:
            raise HTTPException(status_code=400, detail="No CV files provided.")

        is_overriding_duplicates_general = (override_duplicates and override_duplicates.lower() == "true")
        is_forcing_problematic_upload_consent = (force_upload_ai_flagged and force_upload_ai_flagged.lower() == "true")
        is_forcing_irrelevant_upload_consent = (force_upload_irrelevant and force_upload_irrelevant.lower() == "true")

        selected_filenames_to_override_list = []
        if selected_filenames_for_overwrite_json:
            try:
                selected_filenames_to_override_list = json.loads(selected_filenames_for_overwrite_json)
                if not isinstance(selected_filenames_to_override_list, list): selected_filenames_to_override_list = []
            except json.JSONDecodeError: selected_filenames_to_override_list = []
        
        analysis_tasks = [
            _analyze_single_file_for_upload_pipeline(job_id_for_analysis=job_id, file_obj=file_obj) 
            for file_obj in files
        ]
        initial_analysis_results = await asyncio.gather(*analysis_tasks)

        files_with_errors_at_analysis = [r for r in initial_analysis_results if r["status"] == "error"]
        analyzed_files_data = [r for r in initial_analysis_results if r["status"] == "analyzed"]

        files_requiring_ai_irrelevant_confirmation = []
        files_passed_ai_irrelevant_checks = []

        for file_data in analyzed_files_data:
            needs_confirmation = False
            combined_modal_payload = {"filename": file_data["fileName"]} # Start with filename
            
            # Populate with AI problematic data if present
            if file_data["is_ai_problematic"]:
                if file_data.get("ai_detection_payload_for_modal"):
                    combined_modal_payload.update(file_data["ai_detection_payload_for_modal"])
                if not is_forcing_problematic_upload_consent: needs_confirmation = True
            
            # Populate with Irrelevance data if present (can update same payload)
            if file_data["is_irrelevant"]:
                if file_data.get("irrelevance_payload_for_modal"):
                    combined_modal_payload.update(file_data["irrelevance_payload_for_modal"])
                if not is_forcing_irrelevant_upload_consent: needs_confirmation = True
            
            if needs_confirmation:
                files_requiring_ai_irrelevant_confirmation.append(combined_modal_payload)
            else:
                files_passed_ai_irrelevant_checks.append(file_data)

        if files_requiring_ai_irrelevant_confirmation:
            logger.info(f"UploadMoreCV: {len(files_requiring_ai_irrelevant_confirmation)} files require AI/Irrelevance confirmation.")
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "message": "Some resumes require review due to AI generation, authenticity, or irrelevance flags.",
                    "error_type": "FLAGGED_CONTENT",
                    "flagged_files": jsonable_encoder(files_requiring_ai_irrelevant_confirmation),
                    "jobId": job_id,
                    "processed_ok_count": len(files_passed_ai_irrelevant_checks) 
                })

        files_ready_for_final_processing = []
        unresolved_duplicates_for_modal = []

        for file_data_for_dup_check in files_passed_ai_irrelevant_checks:
            doc_ai_results = file_data_for_dup_check.get("document_ai_results")
            if not doc_ai_results:
                files_with_errors_at_analysis.append({"fileName": file_data_for_dup_check['fileName'], "status": "error", "message": "Internal error: DocAI data missing"})
                continue

            duplicate_info_from_service = CandidateService.check_duplicate_candidate(job_id, doc_ai_results)
            
            is_this_file_explicitly_overridden = False
            if selected_filenames_to_override_list:
                if file_data_for_dup_check["fileName"] in selected_filenames_to_override_list: is_this_file_explicitly_overridden = True
            elif is_overriding_duplicates_general: is_this_file_explicitly_overridden = True
            
            if duplicate_info_from_service.get("is_duplicate") and not is_this_file_explicitly_overridden:
                _existing_candidate_raw_data_from_service = duplicate_info_from_service.get("duplicate_candidate")
                defined_existing_candidate_data_for_modal = {}
                if not _existing_candidate_raw_data_from_service or not isinstance(_existing_candidate_raw_data_from_service, dict):
                    logger.error(f"UploadMoreCV: Inconsistent duplicate_candidate data for {file_data_for_dup_check['fileName']}")
                    defined_existing_candidate_data_for_modal = {"candidateId": "UNKNOWN", "originalFileName": "Unknown", "applicant_name": "Unknown"}
                else:
                    applicant_name_from_existing = _existing_candidate_raw_data_from_service.get("extractedText", {}).get("applicant_name") or \
                                                   _existing_candidate_raw_data_from_service.get("applicant_name", "N/A")
                    defined_existing_candidate_data_for_modal = {
                        "candidateId": _existing_candidate_raw_data_from_service.get("candidateId"),
                        "originalFileName": _existing_candidate_raw_data_from_service.get("originalFileName"),
                        "applicant_name": applicant_name_from_existing,
                        "extractedText": _existing_candidate_raw_data_from_service.get("extractedText"), # For summary
                        "detailed_profile": _existing_candidate_raw_data_from_service.get("detailed_profile"), # For summary
                        "uploadedAt": _existing_candidate_raw_data_from_service.get("uploadedAt") # For modal header
                    }
                
                modal_dup_payload = {
                    "is_duplicate": duplicate_info_from_service.get("is_duplicate"),
                    "duplicate_type": duplicate_info_from_service.get("duplicate_type"),
                    "confidence": duplicate_info_from_service.get("confidence"),
                    "match_percentage": duplicate_info_from_service.get("match_percentage"),
                    "existing_candidate_details": defined_existing_candidate_data_for_modal,
                    "resume_changes_if_modified": duplicate_info_from_service.get("resume_changes"),
                    "new_file_name": file_data_for_dup_check["fileName"],
                    "new_file_analysis": {
                        "authenticityAnalysis": file_data_for_dup_check.get("authenticity_analysis_result"),
                        "crossReferencingAnalysis": file_data_for_dup_check.get("cross_referencing_result"),
                        "externalAIDetectionResult": file_data_for_dup_check.get("external_ai_detection_data"),
                        "final_assessment_data": file_data_for_dup_check.get("final_assessment_data"),
                        "docAIResults": doc_ai_results,
                        "is_ai_problematic": file_data_for_dup_check.get("is_ai_problematic"),
                        "is_irrelevant": file_data_for_dup_check.get("is_irrelevant"),
                        "ai_detection_payload_for_modal": file_data_for_dup_check.get("ai_detection_payload_for_modal"),
                        "irrelevance_payload_for_modal": file_data_for_dup_check.get("irrelevance_payload_for_modal"),
                    }}
                unresolved_duplicates_for_modal.append(modal_dup_payload)
            else:
                file_data_for_dup_check["duplicate_resolution_info"] = duplicate_info_from_service
                files_ready_for_final_processing.append(file_data_for_dup_check)

        if unresolved_duplicates_for_modal:
            logger.info(f"UploadMoreCV: {len(unresolved_duplicates_for_modal)} files require Duplicate confirmation.")
            non_duplicate_count_for_modal = sum(1 for f in files_ready_for_final_processing if not f.get("duplicate_resolution_info", {}).get("is_duplicate"))
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={
                    "message": "Duplicate CVs detected that were not selected for overwrite.",
                    "error_type": "DUPLICATE_FILES_DETECTED",
                    "duplicates": jsonable_encoder(unresolved_duplicates_for_modal),
                    "nonDuplicateCount": non_duplicate_count_for_modal, "jobId": job_id,
                })

        processed_candidate_ids_for_response = []
        successful_candidates_app_data = []

        for file_to_process in files_ready_for_final_processing:
            dup_resolution = file_to_process.get("duplicate_resolution_info", {})
            is_duplicate_flag = dup_resolution.get("is_duplicate", False) # Renamed to avoid confusion
            duplicate_type = dup_resolution.get("duplicate_type")
            
            should_this_file_be_overridden_or_continued = False
            if selected_filenames_to_override_list:
                if file_to_process["fileName"] in selected_filenames_to_override_list: should_this_file_be_overridden_or_continued = True
            elif is_overriding_duplicates_general: should_this_file_be_overridden_or_continued = True

            created_or_updated_candidate_id = None
            candidate_data_for_profile_gen = None

            if is_duplicate_flag and should_this_file_be_overridden_or_continued:
                existing_candidate_id_from_dup = dup_resolution.get("duplicate_candidate", {}).get("candidateId")
                if duplicate_type == "MODIFIED_RESUME" and existing_candidate_id_from_dup:
                    logger.info(f"UploadMoreCV: Overwriting candidate {existing_candidate_id_from_dup} for {file_to_process['fileName']}")
                    new_file_id = str(uuid.uuid4())
                    new_file_ext = file_to_process["fileName"].split('.')[-1] if '.' in file_to_process["fileName"] else 'pdf'
                    new_storage_path = f"resumes/{job_id}/{existing_candidate_id_from_dup}/{new_file_id}.{new_file_ext}"
                    new_resume_url = firebase_client.upload_file(file_to_process["file_content_bytes"], new_storage_path, file_to_process["content_type"])

                    if not new_resume_url:
                        files_with_errors_at_analysis.append({"fileName": file_to_process['fileName'], "status": "error", "message": "Overwrite file upload failed"})
                        continue
                    
                    auth_analysis_obj = AuthenticityAnalysisResult(**file_to_process["authenticity_analysis_result"]) if file_to_process.get("authenticity_analysis_result") else None
                    cross_ref_obj = CrossReferencingResult(**file_to_process["cross_referencing_result"]) if file_to_process.get("cross_referencing_result") else None
                    
                    try:
                        # Use ZoneInfo to parse the timezone string
                        tz = ZoneInfo(user_time_zone)
                        overwrite_at_iso = datetime.now(tz).isoformat()
                    except (ZoneInfoNotFoundError, TypeError):
                        # Fallback to UTC if the user's timezone string is invalid
                        logger.warning(f"Invalid timezone '{user_time_zone}' provided. Falling back to UTC.")
                        overwrite_at_iso = datetime.now(timezone.utc).isoformat()
                        
                    update_data = CandidateUpdate(
                        extractedText=file_to_process["document_ai_results"].get("entities", {}),
                        fullTextFromDocAI=file_to_process["document_ai_results"].get("full_text", ""),
                        resumeUrl=new_resume_url, storagePath=new_storage_path, originalFileName=file_to_process["fileName"],
                        overwriteAt=overwrite_at_iso,
                        authenticityAnalysis=auth_analysis_obj,
                        crossReferencingAnalysis=cross_ref_obj,
                        externalAIDetectionResult=file_to_process.get("external_ai_detection_data"),
                        overallAuthenticityScore=file_to_process.get("final_assessment_data", {}).get("final_overall_authenticity_score"),
                        spamLikelihoodScore=file_to_process.get("final_assessment_data", {}).get("final_spam_likelihood_score"),
                        finalXAISummary=file_to_process.get("final_assessment_data", {}).get("final_xai_summary"),
                        detailed_profile=None # Force regeneration
                    )
                    if CandidateService.update_candidate(existing_candidate_id_from_dup, update_data):
                        created_or_updated_candidate_id = existing_candidate_id_from_dup
                        candidate_data_for_profile_gen = {'candidateId': existing_candidate_id_from_dup, 'extractedDataFromDocAI': file_to_process["document_ai_results"]}
                    else:
                        files_with_errors_at_analysis.append({"fileName": file_to_process['fileName'], "status": "error", "message": "Overwrite DB update failed"})
                        continue
                elif duplicate_type in ["COPIED_RESUME", "EXACT_DUPLICATE"]: # Fall through to create new if user wants to 'Continue to Upload' for these
                    is_duplicate_flag = False 
                else: # Unhandled duplicate type for overwrite
                    is_duplicate_flag = False 
            
            if not is_duplicate_flag: # Create new candidate
                logger.info(f"UploadMoreCV: Creating new candidate for {file_to_process['fileName']}")
                auth_analysis_obj_new = AuthenticityAnalysisResult(**file_to_process["authenticity_analysis_result"]) if file_to_process.get("authenticity_analysis_result") else None
                cross_ref_obj_new = CrossReferencingResult(**file_to_process["cross_referencing_result"]) if file_to_process.get("cross_referencing_result") else None

                creation_res = candidate_service_instance.create_candidate_from_data(
                    job_id=job_id, file_content=file_to_process["file_content_bytes"], file_name=file_to_process["fileName"],
                    content_type=file_to_process["content_type"], extracted_data_from_doc_ai=file_to_process["document_ai_results"],
                    authenticity_analysis_result=auth_analysis_obj_new,
                    cross_referencing_result=cross_ref_obj_new,
                    final_assessment_data=file_to_process["final_assessment_data"],
                    external_ai_detection_data=file_to_process["external_ai_detection_data"], user_time_zone=user_time_zone
                )
                if creation_res and not creation_res.get("error"):
                    created_or_updated_candidate_id = creation_res.get("candidateId")
                    candidate_data_for_profile_gen = creation_res 
                else:
                    err_msg = creation_res.get('error') if creation_res else 'Candidate creation failed'
                    files_with_errors_at_analysis.append({"fileName": file_to_process['fileName'], "status": "error", "message": err_msg})
                    continue
            
            if created_or_updated_candidate_id and candidate_data_for_profile_gen:
                processed_candidate_ids_for_response.append(created_or_updated_candidate_id)
                successful_candidates_app_data.append(candidate_data_for_profile_gen)

        applications_created_info = []
        if successful_candidates_app_data:
            applications_created_info = candidate_service_instance.process_applications(job_id, successful_candidates_app_data)
            profile_gen_tasks = [generate_and_save_profile(cand_info, gemini_service_global_instance) for cand_info in successful_candidates_app_data]
            await asyncio.gather(*profile_gen_tasks)

        final_candidates_data = [candidate_service_instance.get_candidate(cid) for cid in processed_candidate_ids_for_response]
        final_candidates_data = [c for c in final_candidates_data if c]
        new_apps_count = sum(1 for app in applications_created_info if app.get('success'))
        
        updated_job_after_processing = JobService.get_job(job_id)
        total_applications_for_job = updated_job_after_processing.get("applicationCount", 0) if updated_job_after_processing else (job.get("applicationCount",0) + new_apps_count)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content=jsonable_encoder({
                "message": f"CVs processed. {len(processed_candidate_ids_for_response)} candidates created/updated.",
                "jobId": job_id, "newApplicationCount": new_apps_count,
                "candidateIds": processed_candidate_ids_for_response, "candidatesData": final_candidates_data,
                "totalApplicationsForJob": total_applications_for_job, "errors_processing_files": files_with_errors_at_analysis
            }))
    except HTTPException as http_exc:
        logger.error(f"HTTPException in /upload-more-cv for job {job_id}: {http_exc.detail}", exc_info=False)
        raise http_exc
    except Exception as e:
        logger.error(f"Unexpected error in /upload-more-cv for job {job_id}: {e}", exc_info=True)
        return JSONResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "An internal server error occurred.", "detail": str(e), "type": type(e).__name__})


@router.post("/suggest-details", response_model=JobSuggestionResponse)
async def suggest_job_details_for_creation(context: JobSuggestionContext = Body(...)):
    if not context.job_title:
        raise HTTPException(status_code=400, detail="Job Title is required to generate suggestions.")
    try:
        suggestions = await gemini_service_global_instance.generate_job_details_suggestion(job_title=context.job_title,
                                                                                           context=context.model_dump(
                                                                                               exclude={'job_title'}))
        return JobSuggestionResponse(**suggestions)
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error generating job details suggestions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate suggestions: {str(e)}")