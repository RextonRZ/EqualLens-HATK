from fastapi import APIRouter, HTTPException, Form, File, UploadFile, Body, status, Request
from fastapi.responses import JSONResponse
from typing import List, Optional, Dict, Any, Tuple
import json
import logging
import asyncio
from fastapi.encoders import jsonable_encoder
import uuid
from datetime import datetime
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

    # Create a new JobUpdate instance with potentially modified data
    # This ensures that if other fields were None, they are handled correctly by Pydantic
    # when JobService.update_job expects a JobUpdate model.
    # If JobService.update_job can take a dict, this step might not be strictly needed,
    # but it's safer.
    final_job_update_model = JobUpdate(**update_data_dict)

    logger.info(f"Updating job {job_id} with data: {final_job_update_model.model_dump(exclude_none=True)}")
    success = JobService.update_job(job_id, final_job_update_model)  # Pass the Pydantic model

    if not success:
        raise HTTPException(status_code=500, detail="Failed to update job")

    updated_job_data = JobService.get_job(job_id)
    if not updated_job_data:  # Should not happen if update was successful
        raise HTTPException(status_code=500, detail="Failed to retrieve updated job after update.")

    return JobResponse(**updated_job_data)


async def _process_single_file_for_candidate_creation(
        job_id_for_creation: str,
        file_obj: UploadFile,
        user_time_zone: str,
        override_duplicates_from_form: bool,
        force_upload_problematic_from_form: bool,
        force_upload_irrelevant_from_form: bool
) -> Dict[str, Any]:
    file_content_bytes = await file_obj.read()
    file_name_val = file_obj.filename
    content_type_val = file_obj.content_type or "application/pdf"

    candidate_result = await candidate_service_instance.create_candidate_orchestrator(
        job_id=job_id_for_creation,
        file_content_bytes=file_content_bytes,
        file_name=file_name_val,
        content_type=content_type_val,
        override_duplicates=override_duplicates_from_form,
        user_time_zone=user_time_zone,
        force_problematic_upload=force_upload_problematic_from_form,
        force_irrelevant_upload=force_upload_irrelevant_from_form
    )

    if candidate_result and candidate_result.get("error"):
        logger.error(f"Error processing file {file_name_val} via orchestrator: {candidate_result['error']}")
        return {"fileName": file_name_val, "status": "error", "message": candidate_result["error"], "candidateId": None}

    if candidate_result and candidate_result.get("is_duplicate"):
        logger.info(f"File {file_name_val} is a duplicate for job {job_id_for_creation} (orchestrator).")
        return {
            "fileName": file_name_val,
            "status": "duplicate_detected",
            "candidateId": None,
            "duplicate_info": candidate_result["duplicate_info"],
            "new_file_analysis_for_duplicate": candidate_result.get("new_file_analysis")
        }

    ai_files = candidate_result.get("aiFiles", []) if candidate_result else []
    irrelevant_files = candidate_result.get("irrelevantFiles", []) if candidate_result else []

    is_ai_gen = any(f.get("is_ai_generated") for f in ai_files)
    is_irrelevant = any(f.get("is_irrelevant") for f in irrelevant_files)

    logger.info(f"[{file_name_val}] is_ai_gen: {is_ai_gen}, is_irrelevant: {is_irrelevant}")

    if is_ai_gen and not is_irrelevant:
        # 1. AI-generated only
        analysis_data = candidate_result.get("analysis_data", {})
        external_pred = analysis_data.get("external_ai_detection_data", {})
        auth_results_dict = analysis_data.get("authenticity_analysis_result")
        final_assessment = analysis_data.get("final_assessment_data", {})

        overall_auth_score = final_assessment.get("final_overall_authenticity_score", 0.5)
        spam_score = final_assessment.get("final_spam_likelihood_score", 0.5)
        is_externally_flagged_ai = external_pred.get("predicted_class_label") == "AI-generated"

        reason_parts = []
        if is_externally_flagged_ai:
            ext_conf = external_pred.get("confidence_scores", {}).get("ai_generated", 0.0)
            reason_parts.append(f"External Model: AI-Generated (Conf: {ext_conf:.2f})")
        if overall_auth_score < FINAL_AUTH_FLAG_THRESHOLD:
            reason_parts.append(f"Internal Auth Score: {overall_auth_score:.2f} (Low)")
        if spam_score > SPAM_FLAG_THRESHOLD:
            reason_parts.append(f"Internal Spam Score: {spam_score:.2f} (High)")

        reason_summary_for_modal = ". ".join(reason_parts) if reason_parts else "System flagged potential issues."
        if final_assessment.get("final_xai_summary"):
            reason_summary_for_modal = final_assessment.get("final_xai_summary")

        payload_is_ai_generated = is_externally_flagged_ai
        payload_confidence = 0.0
        if is_externally_flagged_ai:
            payload_confidence = external_pred.get("confidence_scores", {}).get("ai_generated", 0.0)
        elif (overall_auth_score < FINAL_AUTH_FLAG_THRESHOLD) or (spam_score > SPAM_FLAG_THRESHOLD):
            payload_is_ai_generated = True
            payload_confidence = max(1.0 - overall_auth_score, spam_score)

        formatted_reason_html = ai_detection_formatter_instance.format_analysis_for_frontend(
            filename=file_name_val,
            auth_results=AuthenticityAnalysisResult(**auth_results_dict) if auth_results_dict else None,
            cross_ref_results=CrossReferencingResult(
                **analysis_data.get("cross_referencing_result", {})) if analysis_data.get(
                "cross_referencing_result") else None,
            external_ai_pred_data=external_pred
        ).reason

        return {
            "fileName": file_name_val,
            "status": "ai_content_detected",
            "candidateId": None,
            "ai_detection_payload": {
                "filename": file_name_val,
                "is_ai_generated": payload_is_ai_generated,
                "confidence": payload_confidence,
                "reason": formatted_reason_html,
                "details": {
                    "external_ai_prediction": external_pred,
                    "authenticity_analysis": auth_results_dict,
                    "cross_referencing_analysis": analysis_data.get("cross_referencing_result"),
                    "final_overall_authenticity_score": overall_auth_score,
                    "final_spam_likelihood_score": spam_score,
                    "final_xai_summary": final_assessment.get("final_xai_summary")
                }
            }
        }

    elif is_irrelevant and not is_ai_gen:
        # This case means candidate_result.irrelevantFiles was populated
        # and candidate_result.aiFiles was not (or had no True flags)
        # The irrelevance_payload should come from candidate_result.irrelevantFiles[0]
        # or from candidate_result.analysis_data.relevance_analysis

        analysis_data = candidate_result.get("analysis_data", {})  # Ensure analysis_data is available
        relevance_analysis_from_orchestrator = analysis_data.get("relevance_analysis",
                                                                 {})  # Check if orchestrator provided this

        # Try to get gemini_irrelevant from the first item in irrelevantFiles if it exists
        gemini_irrelevant_from_file_list = {}
        if irrelevant_files and isinstance(irrelevant_files, list) and len(irrelevant_files) > 0:
            gemini_irrelevant_from_file_list = irrelevant_files[0].get("gemini_irrelevant", {})

        # Determine the source for reason and score
        # Prefer gemini_irrelevant if available from file list, then from orchestrator's relevance_analysis
        final_irrelevant_reason = gemini_irrelevant_from_file_list.get("reason") or \
                                  relevance_analysis_from_orchestrator.get("irrelevant_reason") or \
                                  "Content deemed irrelevant to the job."

        final_relevance_score = gemini_irrelevant_from_file_list.get("relevance_score")
        if final_relevance_score is None:  # Fallback to overall_relevance_score if specific not found
            final_relevance_score = relevance_analysis_from_orchestrator.get("overall_relevance_score")

        calculated_irrelevance_score = None
        if final_relevance_score is not None:
            try:
                calculated_irrelevance_score = 100.0 - float(final_relevance_score)
            except (ValueError, TypeError):
                logger.warning(f"Could not calculate irrelevance_score from relevance_score: {final_relevance_score}")

        logger.info(
            f"[{file_name_val}] Irrelevant only. Relevance Score: {final_relevance_score}, Calculated Irrelevance Score: {calculated_irrelevance_score}"
        )

        return {
            "fileName": file_name_val,
            "status": "irrelevant_content",
            "irrelevance_payload": {
                "filename": file_name_val,
                "is_irrelevant": True,
                "irrelevant_reason": final_irrelevant_reason,
                "irrelevance_score": calculated_irrelevance_score,  # Use the calculated one
                "job_type": relevance_analysis_from_orchestrator.get("job_type", "")
                # Get job_type from orchestrator analysis
            }
        }

    elif is_ai_gen and is_irrelevant:
        # 3. Both AI-generated and Irrelevant
        analysis_data = candidate_result.get("analysis_data", {})
        external_pred = analysis_data.get("external_ai_detection_data", {})
        auth_results_dict = analysis_data.get("authenticity_analysis_result")
        final_assessment = analysis_data.get("final_assessment_data", {})

        # Relevance data from orchestrator
        relevance_analysis_from_orchestrator = analysis_data.get("relevance_analysis", {})
        gemini_irrelevant_from_file_list = {}
        if irrelevant_files and isinstance(irrelevant_files, list) and len(irrelevant_files) > 0:
            gemini_irrelevant_from_file_list = irrelevant_files[0].get("gemini_irrelevant", {})

        overall_auth_score = final_assessment.get("final_overall_authenticity_score", 0.5)
        spam_score = final_assessment.get("final_spam_likelihood_score", 0.5)
        is_externally_flagged_ai = external_pred.get("predicted_class_label") == "AI-generated"

        # AI Part (same as ai_content_detected)
        payload_is_ai_generated = is_externally_flagged_ai
        payload_confidence = 0.0
        if is_externally_flagged_ai:
            payload_confidence = external_pred.get("confidence_scores", {}).get("ai_generated", 0.0)
        elif (overall_auth_score < FINAL_AUTH_FLAG_THRESHOLD) or (spam_score > SPAM_FLAG_THRESHOLD):
            payload_is_ai_generated = True
            payload_confidence = max(1.0 - overall_auth_score, spam_score)

        formatted_reason_html = ai_detection_formatter_instance.format_analysis_for_frontend(
            filename=file_name_val,
            auth_results=AuthenticityAnalysisResult(**auth_results_dict) if auth_results_dict else None,
            cross_ref_results=CrossReferencingResult(
                **analysis_data.get("cross_referencing_result", {})) if analysis_data.get(
                "cross_referencing_result") else None,
            external_ai_pred_data=external_pred
        ).reason

        ai_payload_for_combined = {
            "filename": file_name_val,
            "is_ai_generated": payload_is_ai_generated,
            "confidence": payload_confidence,
            "reason": formatted_reason_html,
            "details": {
                "external_ai_prediction": external_pred,
                "authenticity_analysis": auth_results_dict,
                "cross_referencing_analysis": analysis_data.get("cross_referencing_result"),
                "final_overall_authenticity_score": overall_auth_score,
                "final_spam_likelihood_score": spam_score,
                "final_xai_summary": final_assessment.get("final_xai_summary")
            }
        }

        # Irrelevance Part (similar to irrelevant_content)
        final_irrelevant_reason_combined = gemini_irrelevant_from_file_list.get("reason") or \
                                           relevance_analysis_from_orchestrator.get("irrelevant_reason") or \
                                           "Content deemed irrelevant to the job."

        final_relevance_score_combined = gemini_irrelevant_from_file_list.get("relevance_score")
        if final_relevance_score_combined is None:
            final_relevance_score_combined = relevance_analysis_from_orchestrator.get("overall_relevance_score")

        calculated_irrelevance_score_combined = None
        if final_relevance_score_combined is not None:
            try:
                calculated_irrelevance_score_combined = 100.0 - float(final_relevance_score_combined)
            except (ValueError, TypeError):
                logger.warning(
                    f"Could not calculate irrelevance_score from relevance_score: {final_relevance_score_combined}")

        irrelevance_payload_for_combined = {
            "filename": file_name_val,
            "is_irrelevant": True,
            "irrelevant_reason": final_irrelevant_reason_combined,
            "irrelevance_score": calculated_irrelevance_score_combined,
            "job_type": relevance_analysis_from_orchestrator.get("job_type", "")
        }

        return {
            "fileName": file_name_val,
            "status": "ai_and_irrelevant_content",
            "candidateId": None,
            "ai_detection_payload": ai_payload_for_combined,
            "irrelevance_payload": irrelevance_payload_for_combined
        }

    elif candidate_result and candidate_result.get("candidateId"):
        # 4. Safe (success)
        return {
            "fileName": file_name_val,
            "status": "success",
            "candidateId": candidate_result.get("candidateId"),
            "message": "Candidate processed successfully.",
            "candidate_data": candidate_result
        }

    else:
        logger.error(
            f"Unexpected result from candidate orchestrator for {file_name_val} after all checks: {candidate_result}")
        return {
            "fileName": file_name_val,
            "status": "error",
            "message": "Unknown processing error post-orchestration.",
            "candidateId": None
        }


async def generate_and_save_profile(candidate_info: Dict[str, Any], gemini_srv: GeminiService) -> bool:
    # ... (implementation unchanged) ...
    candidate_id = candidate_info.get('candidateId')
    extracted_data_from_doc_ai = candidate_info.get("extractedDataFromDocAI", {})
    entities_for_profile_gen: Optional[Dict[str, Any]] = None

    if isinstance(extracted_data_from_doc_ai, dict):
        entities_for_profile_gen = extracted_data_from_doc_ai.get("entities")
    else:
        logger.error(
            f"generate_and_save_profile: extractedDataFromDocAI for candidate {candidate_id} is not a dictionary.")
        return False

    if not candidate_id:
        logger.warning("Missing candidateId in candidate_info for profile generation.")
        return False
    if not entities_for_profile_gen or not isinstance(entities_for_profile_gen, dict):
        logger.warning(
            f"No 'entities' dictionary found or it's not a dict for candidate {candidate_id} to generate profile. ExtractedData: {extracted_data_from_doc_ai}")
        return False

    applicant_data_for_gemini = {"candidateId": candidate_id, "extractedText": entities_for_profile_gen}
    try:
        logger.info(f"Generating detailed profile for candidate {candidate_id} via jobs.py helper")
        detailed_profile = await gemini_srv.generate_candidate_profile(applicant_data_for_gemini)

        if not detailed_profile or not isinstance(detailed_profile, dict) or "summary" not in detailed_profile:
            logger.warning(
                f"Failed to generate valid detailed profile for candidate {candidate_id}. Profile: {detailed_profile}")
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
        logger.info(f"Received new job details: {job_details.get('jobTitle')}, with {len(files)} CVs.")
        if not files:
            raise HTTPException(status_code=400, detail="No CV files provided for new job.")

        is_forcing_problematic_upload = (force_upload_ai_flagged and force_upload_ai_flagged.lower() == "true")
        is_forcing_irrelevant_upload = (force_upload_irrelevant and force_upload_irrelevant.lower() == "true")

        # --- Prepare Job Data (but don't create yet) ---
        skills = job_details.get("skills", [])
        required_skills = job_details.get("requiredSkills", skills)
        minimum_cgpa_raw = job_details.get("minimumCGPA")
        minimum_cgpa = 0.0
        if minimum_cgpa_raw not in [-1, None, "n/a", "N/A"]:
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

        # Use a temporary job id for file processing (not stored anywhere)
        temp_job_id = f"temp-{uuid.uuid4()}"
        logger.info(f"Using temporary job ID {temp_job_id} for initial file processing")

        # Process all files for analysis and initial checks using temp job ID
        file_processing_tasks = [
            _process_single_file_for_candidate_creation(
                job_id_for_creation=temp_job_id,
                file_obj=file_obj,
                user_time_zone=user_time_zone,
                override_duplicates_from_form=False,
                force_upload_problematic_from_form=is_forcing_problematic_upload,
                force_upload_irrelevant_from_form=is_forcing_irrelevant_upload
            ) for file_obj in files
        ]
        processed_file_results = await asyncio.gather(*file_processing_tasks)

        logger.info(f"processed_file_results: {processed_file_results}")

        # Handle responses
        successful_candidates_full_data = []
        flagged_files_for_modal = []
        duplicate_payloads_for_modal = []
        error_files = []

        for res in processed_file_results:
            if res["status"] == "success":
                successful_candidates_full_data.append(res["candidate_data"])
            elif res["status"] == "ai_content_detected":
                flagged_files_for_modal.append(res["ai_detection_payload"])
            elif res["status"] == "irrelevant_content":
                flagged_files_for_modal.append(res["irrelevance_payload"])
            elif res["status"] == "ai_and_irrelevant_content":
                ai_payload = res.get("ai_detection_payload", {})
                irrelevant_payload_from_res = res.get("irrelevance_payload", {})
                calculated_irrelevance_score = irrelevant_payload_from_res.get("irrelevance_score")
                combined_payload_for_modal = {
                    "filename": res["fileName"],
                    "is_ai_generated": ai_payload.get("is_ai_generated", False),
                    "confidence": ai_payload.get("confidence"),
                    "reason": ai_payload.get("reason"),
                    "details": ai_payload.get("details"),
                    "is_irrelevant": irrelevant_payload_from_res.get("is_irrelevant", False),
                    "irrelevant_reason": irrelevant_payload_from_res.get("irrelevant_reason"),
                    "irrelevance_score": calculated_irrelevance_score,
                    "job_type": irrelevant_payload_from_res.get("job_type")
                }
                flagged_files_for_modal.append(combined_payload_for_modal)
            elif res["status"] == "duplicate_detected":
                duplicate_payloads_for_modal.append(res)
            elif res["status"] == "error":
                error_files.append(res)

        # If any flagged or duplicate files, do NOT create job/candidates/applications, just return error
        if flagged_files_for_modal:
            response_content = {
                "message": "Some resumes require review due to AI or irrelevance flags.",
                "error_type": "FLAGGED_CONTENT",
                "flagged_files": jsonable_encoder(flagged_files_for_modal),
                "processed_ok_count": len(successful_candidates_full_data)
            }
            logger.info(f"Returning to frontend (Flagged content): {response_content}")
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content=response_content
            )

        if duplicate_payloads_for_modal:
            response_content = {
                "message": "Duplicate CVs detected.",
                "error_type": "DUPLICATE_FILES_DETECTED",
                "duplicates": jsonable_encoder(duplicate_payloads_for_modal),
                "nonDuplicateCount": len(successful_candidates_full_data)
            }
            logger.info(f"Returning to frontend (Duplicates): {response_content}")
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content=response_content
            )

        # --- CREATE ACTUAL JOB ONLY WHEN FILES ARE READY TO BE PROCESSED ---
        actual_job_id = JobService.create_job(job_create_payload)
        if not actual_job_id:
            raise HTTPException(status_code=500, detail="Failed to create job entry in database.")

        logger.info(f"Created actual job {actual_job_id} after confirming files are ready for processing")

        # Update all successful candidate data with the actual job ID
        for candidate_data in successful_candidates_full_data:
            if candidate_data.get('candidateId'):
                CandidateService.update_candidate(
                    candidate_data['candidateId'],
                    CandidateUpdate(job_id=actual_job_id)
                )

        applications_created_info = []
        if successful_candidates_full_data:
            applications_created_info = candidate_service_instance.process_applications(
                actual_job_id, successful_candidates_full_data
            )
            profile_tasks = [
                generate_and_save_profile(cand_info, gemini_service_global_instance)
                for cand_info in successful_candidates_full_data
            ]
            await asyncio.gather(*profile_tasks)

        return JSONResponse(
            status_code=status.HTTP_201_CREATED,
            content=jsonable_encoder({
                "message": "Job created and CVs processed successfully.",
                "jobId": actual_job_id,
                "jobTitle": job_details.get("jobTitle"),
                "applicationCount": len(applications_created_info),
                "applications": applications_created_info,
                "candidates": successful_candidates_full_data,
                "candidateIds": [c['candidateId'] for c in successful_candidates_full_data if c.get('candidateId')],
                "errors_processing_files": error_files
            })
        )

    except Exception as e:
        logger.error(f"Error uploading new job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/confirm-job-creation")
async def confirm_job_creation(
        temp_job_id: str = Form(...),
        files: List[UploadFile] = File(...),
        force_upload_ai_flagged: Optional[str] = Form("false"),
        force_upload_irrelevant: Optional[str] = Form("false"),
        user_time_zone: str = Form("UTC")
):
    """Create the actual job after user confirms to proceed with flagged files."""
    try:
        logger.info(f"Confirming job creation for temp job {temp_job_id}")
        temp_job_data = firebase_client.get_document('temp_jobs', temp_job_id)
        if not temp_job_data:
            raise HTTPException(status_code=404, detail="Temporary job data not found")
        job_create_payload = JobCreate(**temp_job_data['job_create_payload'])
        actual_job_id = JobService.create_job(job_create_payload)
        if not actual_job_id:
            raise HTTPException(status_code=500, detail="Failed to create job entry in database.")
        logger.info(f"Created actual job {actual_job_id} from temp job {temp_job_id}")

        is_forcing_problematic_upload = (force_upload_ai_flagged and force_upload_ai_flagged.lower() == "true")
        is_forcing_irrelevant_upload = (force_upload_irrelevant and force_upload_irrelevant.lower() == "true")

        file_processing_tasks = [
            _process_single_file_for_candidate_creation(
                job_id_for_creation=actual_job_id,
                file_obj=file_obj,
                user_time_zone=user_time_zone,
                override_duplicates_from_form=False,
                force_upload_problematic_from_form=is_forcing_problematic_upload,
                force_upload_irrelevant_from_form=is_forcing_irrelevant_upload
            ) for file_obj in files
        ]
        processed_file_results = await asyncio.gather(*file_processing_tasks)

        successful_candidates_full_data = []
        error_files = []

        for res in processed_file_results:
            if res["status"] == "success":
                successful_candidates_full_data.append(res["candidate_data"])
            elif res["status"] == "error":
                error_files.append(res)

        applications_created_info = []
        if successful_candidates_full_data:
            applications_created_info = candidate_service_instance.process_applications(
                actual_job_id, successful_candidates_full_data
            )
            profile_tasks = [
                generate_and_save_profile(cand_info, gemini_service_global_instance)
                for cand_info in successful_candidates_full_data
            ]
            await asyncio.gather(*profile_tasks)

        firebase_client.delete_document('temp_jobs', temp_job_id)

        return JSONResponse(
            status_code=status.HTTP_201_CREATED,
            content=jsonable_encoder({
                "message": "Job created and CVs processed successfully.",
                "jobId": actual_job_id,
                "jobTitle": job_create_payload.jobTitle,
                "applicationCount": len(applications_created_info),
                "applications": applications_created_info,
                "candidates": successful_candidates_full_data,
                "candidateIds": [c['candidateId'] for c in successful_candidates_full_data if c.get('candidateId')],
                "errors_processing_files": error_files
            })
        )

    except Exception as e:
        logger.error(f"Error confirming job creation: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


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
        f"Uploading more CVs for job {job_id}, override_duplicates_form: {override_duplicates}, force_ai: {force_upload_ai_flagged}, force_irrelevant: {force_upload_irrelevant}")
    try:
        job = JobService.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job with ID {job_id} not found")
        if not files:
            raise HTTPException(status_code=400, detail=f"No CV files provided for job {job_id}.")

        is_overriding_duplicates_general = (override_duplicates and override_duplicates.lower() == "true")
        is_forcing_problematic_upload = (force_upload_ai_flagged and force_upload_ai_flagged.lower() == "true")
        is_forcing_irrelevant_upload = (force_upload_irrelevant and force_upload_irrelevant.lower() == "true")

        selected_filenames_to_override_list = []
        if selected_filenames_for_overwrite_json:
            try:
                selected_filenames_to_override_list = json.loads(selected_filenames_for_overwrite_json)
                if not isinstance(selected_filenames_to_override_list, list): selected_filenames_to_override_list = []
            except json.JSONDecodeError:
                logger.warning("Invalid JSON for selected_filenames in upload-more-cv, ignoring.")
                selected_filenames_to_override_list = []

        logger.info(
            f"Processing {len(files)} additional CVs for job {job_id}. General Override Duplicates: {is_overriding_duplicates_general}. Force Problematic Upload: {is_forcing_problematic_upload}. Force Irrelevant Upload: {is_forcing_irrelevant_upload}. Specific files to override: {selected_filenames_to_override_list}")

        # --- STAGE 1: Process all files ---
        file_processing_tasks = []
        for file_obj in files:
            override_this_specific_file_flag = False
            if is_overriding_duplicates_general:
                if selected_filenames_to_override_list:
                    if file_obj.filename in selected_filenames_to_override_list:
                        override_this_specific_file_flag = True
                else:
                    override_this_specific_file_flag = True

            file_processing_tasks.append(
                _process_single_file_for_candidate_creation(
                    job_id_for_creation=job_id,
                    file_obj=file_obj,
                    user_time_zone=user_time_zone,
                    override_duplicates_from_form=override_this_specific_file_flag,
                    force_upload_problematic_from_form=is_forcing_problematic_upload,
                    force_upload_irrelevant_from_form=is_forcing_irrelevant_upload
                )
            )
        processed_file_results = await asyncio.gather(*file_processing_tasks)

        # --- STAGE 2: Handle responses ---
        successful_candidates_full_data = []
        flagged_files_for_modal = []  # MODIFIED: Use a single list
        duplicate_payloads_for_modal = []
        error_files = []

        for res in processed_file_results:
            if res["status"] == "success":
                successful_candidates_full_data.append(res["candidate_data"])
            elif res["status"] == "ai_content_detected":
                flagged_files_for_modal.append(res["ai_detection_payload"])
            elif res["status"] == "irrelevant_content":
                flagged_files_for_modal.append(res["irrelevance_payload"])
            elif res["status"] == "ai_and_irrelevant_content":
                ai_payload = res.get("ai_detection_payload", {})
                irrelevant_payload_from_res = res.get("irrelevance_payload", {})

                calculated_irrelevance_score = irrelevant_payload_from_res.get(
                    "irrelevance_score")  # Assume it's already calculated by _process

                combined_payload_for_modal = {
                    "filename": res["fileName"],
                    "is_ai_generated": ai_payload.get("is_ai_generated", False),
                    "confidence": ai_payload.get("confidence"),
                    "reason": ai_payload.get("reason"),
                    "details": ai_payload.get("details"),

                    "is_irrelevant": irrelevant_payload_from_res.get("is_irrelevant", False),
                    "irrelevant_reason": irrelevant_payload_from_res.get("irrelevant_reason"),
                    "irrelevance_score": calculated_irrelevance_score,
                    "job_type": irrelevant_payload_from_res.get("job_type")
                }
                flagged_files_for_modal.append(combined_payload_for_modal)
            elif res["status"] == "duplicate_detected":
                duplicate_payloads_for_modal.append(res)
            elif res["status"] == "error":
                error_files.append(res)

        # No longer need to combine ai_flagged_payloads_for_modal and irrelevant_payloads_for_modal

        if flagged_files_for_modal and not (is_forcing_problematic_upload or is_forcing_irrelevant_upload):
            # Process any successful files before returning the 422 for flagged ones
            applications_created_info = []
            if successful_candidates_full_data:
                applications_created_info = candidate_service_instance.process_applications(job_id,
                                                                                            successful_candidates_full_data)
                profile_tasks = [generate_and_save_profile(cand_info, gemini_service_global_instance) for cand_info in
                                 successful_candidates_full_data]
                await asyncio.gather(*profile_tasks)

            logger.info(f"Returning to frontend (Flagged content for 'upload-more-cv'): {flagged_files_for_modal}")
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "message": "Some resumes require review due to AI or irrelevance flags.",
                    "error_type": "FLAGGED_CONTENT",
                    "flagged_files": jsonable_encoder(flagged_files_for_modal),
                    "jobId": job_id,
                    "processed_ok_count": len(successful_candidates_full_data),  # Count of files that passed all checks
                }
            )

        if duplicate_payloads_for_modal:
            logger.warning(f"Unresolved duplicate CVs remain for job {job_id}.")
            applications_created_info = []
            if successful_candidates_full_data:
                applications_created_info = candidate_service_instance.process_applications(job_id,
                                                                                            successful_candidates_full_data)
                profile_tasks = [generate_and_save_profile(cand_info, gemini_service_global_instance) for cand_info in
                                 successful_candidates_full_data]
                await asyncio.gather(*profile_tasks)

            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={
                    "message": "Duplicate CVs detected that were not selected for overwrite.",
                    "error_type": "DUPLICATE_FILES_DETECTED",
                    "duplicates": jsonable_encoder(duplicate_payloads_for_modal),
                    "nonDuplicateCount": len(successful_candidates_full_data),
                    "jobId": job_id,
                }
            )

        # --- STAGE 3: Finalize successful candidates ---
        applications_created_info = []
        if successful_candidates_full_data:
            applications_created_info = candidate_service_instance.process_applications(job_id,
                                                                                        successful_candidates_full_data)

        new_apps_count = sum(1 for app_info in applications_created_info if app_info.get('success'))
        logger.info(f"Created {new_apps_count} new applications for job {job_id} from 'upload-more-cv'.")

        if successful_candidates_full_data:
            profile_generation_tasks = [
                generate_and_save_profile(cand_info, gemini_service_global_instance)
                for cand_info in successful_candidates_full_data
            ]
            await asyncio.gather(*profile_generation_tasks)

        all_affected_candidate_ids = [cand_info['candidateId'] for cand_info in successful_candidates_full_data if
                                      cand_info.get('candidateId')]
        final_candidates_data_for_response = [candidate_service_instance.get_candidate(cid) for cid in
                                              all_affected_candidate_ids]
        final_candidates_data_for_response = [c for c in final_candidates_data_for_response if c]

        updated_job_state = JobService.get_job(job_id)
        total_applications_for_job = updated_job_state.get("applicationCount", 0) if updated_job_state else job.get(
            "applicationCount", 0) + new_apps_count

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content=jsonable_encoder({
                "message": f"Additional CVs processed. New Candidates created: {len(successful_candidates_full_data)}.",
                "jobId": job_id,
                "newApplicationCount": new_apps_count,
                "candidateIds": [c['candidateId'] for c in final_candidates_data_for_response if c.get('candidateId')],
                "candidatesData": final_candidates_data_for_response,
                "totalApplicationsForJob": total_applications_for_job,
                "errors_processing_files": error_files
            })
        )
    except HTTPException as http_exc:
        logger.error(f"HTTPException in /upload-more-cv for job {job_id}: {http_exc.detail}", exc_info=True)
        raise http_exc
    except Exception as e:
        logger.error(f"Error uploading more CVs for job {job_id}: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "type": str(type(e).__name__),
                     "message": f"An error occurred while processing additional CVs for job {job_id}"}
        )


@router.post("/suggest-details", response_model=JobSuggestionResponse)
async def suggest_job_details_for_creation(context: JobSuggestionContext = Body(...)):
    if not context.job_title:
        raise HTTPException(status_code=400, detail="Job Title is required to generate suggestions.")
    try:
        suggestions = await gemini_service_global_instance.generate_job_details_suggestion(job_title=context.job_title,
                                                                                           context=context.model_dump(
                                                                                               exclude={
                                                                                                   'job_title'}))
        return JobSuggestionResponse(**suggestions)
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error generating job details suggestions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate suggestions: {str(e)}")