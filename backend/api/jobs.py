from fastapi import APIRouter, HTTPException, Form, File, UploadFile, Body, status, Request
from fastapi.responses import JSONResponse
from typing import List, Optional, Dict, Any, Tuple
import json
import logging
import asyncio
from fastapi.encoders import jsonable_encoder

from models.job import JobCreate, JobResponse, JobUpdate, JobSuggestionContext, JobSuggestionResponse
from models.candidate import CandidateUpdate
from models.ai_detection import AIDetectionResult  # For type hinting if needed, though not directly returned as Pydantic model by these endpoints
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
        # This flag comes from the form (e.g., "true" if user chose to override in Duplicate Modal)
        override_duplicates_from_form: bool,
        # This flag comes from the form (e.g., "true" if user chose "Continue Anyway" in AI Modal)
        force_upload_problematic_from_form: bool
) -> Dict[str, Any]:
    file_content_bytes = await file_obj.read()
    file_name_val = file_obj.filename
    content_type_val = file_obj.content_type or "application/pdf"

    # Pass the flags to the orchestrator
    candidate_result = await candidate_service_instance.create_candidate_orchestrator(
        job_id=job_id_for_creation,
        file_content_bytes=file_content_bytes,
        file_name=file_name_val,
        content_type=content_type_val,
        override_duplicates=override_duplicates_from_form,  # Passed to orchestrator
        user_time_zone=user_time_zone,
        force_problematic_upload=force_upload_problematic_from_form  # Passed to orchestrator
    )

    if candidate_result and candidate_result.get("error"):
        logger.error(f"Error processing file {file_name_val} via orchestrator: {candidate_result['error']}")
        return {"fileName": file_name_val, "status": "error", "message": candidate_result["error"], "candidateId": None}

    if candidate_result and candidate_result.get("is_duplicate"):
        # Orchestrator returns this if override_duplicates_from_form was False and duplicate found
        logger.info(f"File {file_name_val} is a duplicate for job {job_id_for_creation} (orchestrator).")
        return {
            "fileName": file_name_val,
            "status": "duplicate_detected",
            "candidateId": None,
            "duplicate_info": candidate_result["duplicate_info"],
            "new_file_analysis_for_duplicate": candidate_result.get("new_file_analysis")
        }

    if candidate_result and candidate_result.get("is_problematic_pending_confirmation"):
        # Orchestrator returns this if problematic and force_upload_problematic_from_form was False
        logger.info(f"File {file_name_val} is problematic, pending confirmation for job {job_id_for_creation}.")

        analysis_data = candidate_result.get("analysis_data", {})
        external_pred = analysis_data.get("external_ai_detection_data", {})
        auth_results_dict = analysis_data.get("authenticity_analysis_result")
        # cross_ref_results_dict = analysis_data.get("cross_referencing_result") # Not directly used for payload here
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

        # Format the HTML reason string using AIDetectionService (or a simplified version)
        # This requires passing the individual analysis components
        formatted_reason_html = ai_detection_formatter_instance.format_analysis_for_frontend(
            filename=file_name_val,
            auth_results=AuthenticityAnalysisResult(**auth_results_dict) if auth_results_dict else None,
            cross_ref_results=CrossReferencingResult(
                **analysis_data.get("cross_referencing_result", {})) if analysis_data.get(
                "cross_referencing_result") else None,
            external_ai_pred_data=external_pred
        ).reason  # Get the HTML string

        return {
            "fileName": file_name_val,
            "status": "ai_content_detected",
            "candidateId": None,  # No candidate created yet
            "ai_detection_payload": {
                "filename": file_name_val,
                "is_ai_generated": payload_is_ai_generated,
                "confidence": payload_confidence,
                "reason": formatted_reason_html,  # Send the formatted HTML reason
                "details": {  # Keep structured details for potential future use or if frontend parses this too
                    "external_ai_prediction": external_pred,
                    "authenticity_analysis": auth_results_dict,
                    "cross_referencing_analysis": analysis_data.get("cross_referencing_result"),
                    "final_overall_authenticity_score": overall_auth_score,
                    "final_spam_likelihood_score": spam_score,
                    "final_xai_summary": final_assessment.get("final_xai_summary")
                }
            }
        }

    if candidate_result and candidate_result.get("candidateId"):
        # This means success from orchestrator: candidate created (new, or duplicate override was true, or problematic forced)
        return {
            "fileName": file_name_val,
            "status": "success",
            "candidateId": candidate_result.get("candidateId"),
            "message": "Candidate processed successfully.",
            "candidate_data": candidate_result
        }

    logger.error(
        f"Unexpected result from candidate orchestrator for {file_name_val} after all checks: {candidate_result}")
    return {"fileName": file_name_val, "status": "error", "message": "Unknown processing error post-orchestration.",
            "candidateId": None}

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
async def upload_job_and_cvs(  # Renamed for clarity
        job_data_json_str: str = Form(..., alias="job_data"),
        files: List[UploadFile] = File(...),
        force_upload_ai_flagged: Optional[str] = Form(None),
        user_time_zone: str = Form("UTC")
):
    try:
        job_details = json.loads(job_data_json_str)
        logger.info(f"Received new job details: {job_details.get('jobTitle')}, with {len(files)} CVs.")
        if not files:
            raise HTTPException(status_code=400, detail="No CV files provided for new job.")

        is_forcing_problematic_upload = (force_upload_ai_flagged and force_upload_ai_flagged.lower() == "true")

        # --- Create Job Entry First ---
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
        actual_job_id = JobService.create_job(job_create_payload)
        if not actual_job_id:
            raise HTTPException(status_code=500, detail="Failed to create job entry in database.")
        logger.info(f"Job entry created with ID: {actual_job_id} for '{job_details.get('jobTitle')}'")

        # --- STAGE 1: Process all files for analysis and initial checks ---
        file_processing_tasks = [
            _process_single_file_for_candidate_creation(
                job_id_for_creation=actual_job_id,
                file_obj=file_obj,
                user_time_zone=user_time_zone,
                override_duplicates_from_form=False,
                force_upload_problematic_from_form=is_forcing_problematic_upload
            ) for file_obj in files
        ]
        processed_file_results = await asyncio.gather(*file_processing_tasks)

        # --- STAGE 2: Handle responses ---
        successful_candidates_full_data = []
        ai_flagged_payloads_for_modal = []
        duplicate_payloads_for_modal = []
        error_files = []

        for res in processed_file_results:
            if res["status"] == "success":
                successful_candidates_full_data.append(res["candidate_data"])
            elif res["status"] == "ai_content_detected":
                ai_flagged_payloads_for_modal.append(res["ai_detection_payload"])
            elif res["status"] == "duplicate_detected":
                duplicate_payloads_for_modal.append(res)
            elif res["status"] == "error":
                error_files.append(res)

        if ai_flagged_payloads_for_modal and not is_forcing_problematic_upload:
            logger.warning(
                f"AI content detected in {len(ai_flagged_payloads_for_modal)} files for new job '{actual_job_id}'.")
            # If some files were successful before AI flag, they are in successful_candidates_full_data
            # We should still process them and create applications.
            # The AI flagged ones are held back.

            # Process successful non-AI-flagged files
            applications_created_info = []
            if successful_candidates_full_data:  # Files that were not AI flagged and not duplicates
                applications_created_info = candidate_service_instance.process_applications(actual_job_id,
                                                                                            successful_candidates_full_data)
                profile_tasks = [generate_and_save_profile(cand_info, gemini_service_global_instance) for cand_info in
                                 successful_candidates_full_data]
                await asyncio.gather(*profile_tasks)

            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "message": "Potential AI-generated or problematic content detected in some CVs.",
                    "error_type": "AI_CONTENT_DETECTED",
                    "flagged_files": jsonable_encoder(ai_flagged_payloads_for_modal),
                    "jobId": actual_job_id,
                    "processed_ok_count": len(successful_candidates_full_data),
                    "note": "Job created. Some CVs processed, others require review. Re-submit problematic CVs with force flag or manage individually."
                }
            )

        if duplicate_payloads_for_modal:  # This means override_duplicates_flag was false
            logger.warning(f"Duplicate CVs detected for new job '{actual_job_id}'.")
            # Process successful non-duplicate, non-AI-flagged files
            applications_created_info = []
            if successful_candidates_full_data:  # Files that were not AI flagged and not duplicates
                applications_created_info = candidate_service_instance.process_applications(actual_job_id,
                                                                                            successful_candidates_full_data)
                profile_tasks = [generate_and_save_profile(cand_info, gemini_service_global_instance) for cand_info in
                                 successful_candidates_full_data]
                await asyncio.gather(*profile_tasks)

            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={
                    "message": "Duplicate CVs detected.",
                    "error_type": "DUPLICATE_FILES_DETECTED",
                    "duplicates": jsonable_encoder(duplicate_payloads_for_modal),
                    "nonDuplicateCount": len(successful_candidates_full_data),
                    # Files that were not duplicates and not AI flagged
                    "jobId": actual_job_id,
                    "note": "Job created. Handle duplicates or re-upload with override."
                }
            )

        # --- STAGE 3: Finalize successful candidates (all files passed or were forced) ---
        applications_created_info = []
        if successful_candidates_full_data:
            applications_created_info = candidate_service_instance.process_applications(actual_job_id,
                                                                                        successful_candidates_full_data)

        successful_apps_count = sum(1 for app_info in applications_created_info if app_info.get('success'))
        logger.info(f"Created {successful_apps_count} applications for job {actual_job_id}.")

        if successful_candidates_full_data:
            profile_generation_tasks = [
                generate_and_save_profile(cand_info, gemini_service_global_instance)
                for cand_info in successful_candidates_full_data
            ]
            await asyncio.gather(*profile_generation_tasks)

        final_candidates_data = [
            candidate_service_instance.get_candidate(cand_info['candidateId'])
            for cand_info in successful_candidates_full_data if cand_info.get('candidateId')
        ]
        final_candidates_data = [c for c in final_candidates_data if c]

        return JSONResponse(
            status_code=status.HTTP_201_CREATED,
            content=jsonable_encoder({
                "message": "Job created and CVs processed successfully.",
                "jobId": actual_job_id,
                "jobTitle": job_details.get("jobTitle"),
                "applicationCount": successful_apps_count,
                "applications": applications_created_info,
                "candidates": final_candidates_data,
                "candidateIds": [c['candidateId'] for c in final_candidates_data if c.get('candidateId')],
                # For UploadCV.js
                "errors_processing_files": error_files
            })
        )
    # ... (exception handling unchanged) ...
    except HTTPException as http_exc:
        logger.error(f"HTTPException in /upload-job: {http_exc.detail}", exc_info=True)
        raise http_exc
    except json.JSONDecodeError as json_e:
        logger.error(f"Invalid JSON in job_data for new job: {json_e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Invalid JSON format in job_data: {str(json_e)}")
    except Exception as e:
        logger.error(f"Error uploading new job: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "type": str(type(e).__name__),
                     "message": "An error occurred while processing your request for new job"}
        )


@router.post("/upload-more-cv")
async def upload_more_cv_for_job(  # Renamed for clarity
        job_id: str = Form(...),
        files: List[UploadFile] = File(...),
        override_duplicates: Optional[str] = Form("false"),
        selected_filenames_for_overwrite_json: Optional[str] = Form(None, alias="selected_filenames"),
        force_upload_ai_flagged: Optional[str] = Form(None),
        user_time_zone: str = Form("UTC")
):
    logger.info(
        f"Uploading more CVs for job {job_id}, override_duplicates_form: {override_duplicates}, force_ai: {force_upload_ai_flagged}")
    try:
        job = JobService.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job with ID {job_id} not found")
        if not files:
            raise HTTPException(status_code=400, detail=f"No CV files provided for job {job_id}.")

        is_overriding_duplicates_general = (override_duplicates and override_duplicates.lower() == "true")
        is_forcing_problematic_upload = (force_upload_ai_flagged and force_upload_ai_flagged.lower() == "true")

        selected_filenames_to_override_list = []
        if selected_filenames_for_overwrite_json:
            try:
                selected_filenames_to_override_list = json.loads(selected_filenames_for_overwrite_json)
                if not isinstance(selected_filenames_to_override_list, list): selected_filenames_to_override_list = []
            except json.JSONDecodeError:
                logger.warning("Invalid JSON for selected_filenames in upload-more-cv, ignoring.")
                selected_filenames_to_override_list = []

        logger.info(
            f"Processing {len(files)} additional CVs for job {job_id}. General Override Duplicates: {is_overriding_duplicates_general}. Force AI Upload: {is_forcing_problematic_upload}. Specific files to override if general override is true: {selected_filenames_to_override_list}")

        # --- STAGE 1: Process all files ---
        file_processing_tasks = []
        for file_obj in files:
            # If general override is true, this specific file is overridden if it's in the selected list OR if no list is provided (override all)
            # If general override is false, this specific file is not overridden.
            override_this_specific_file_flag = False
            if is_overriding_duplicates_general:
                if selected_filenames_to_override_list:  # If a list is provided, only override those
                    if file_obj.filename in selected_filenames_to_override_list:
                        override_this_specific_file_flag = True
                else:  # No specific list, so general override applies to all files in this batch
                    override_this_specific_file_flag = True

            file_processing_tasks.append(
                _process_single_file_for_candidate_creation(
                    job_id_for_creation=job_id,
                    file_obj=file_obj,
                    user_time_zone=user_time_zone,
                    override_duplicates_from_form=override_this_specific_file_flag,
                    force_upload_problematic_from_form=is_forcing_problematic_upload
                )
            )
        processed_file_results = await asyncio.gather(*file_processing_tasks)

        # --- STAGE 2: Handle responses ---
        successful_candidates_full_data = []  # All candidates created (new, or new despite similarity due to override)
        ai_flagged_payloads_for_modal = []
        duplicate_payloads_for_modal = []  # Duplicates that were NOT overridden
        error_files = []

        for res in processed_file_results:
            if res["status"] == "success":
                successful_candidates_full_data.append(res["candidate_data"])
            elif res["status"] == "ai_content_detected":
                ai_flagged_payloads_for_modal.append(res["ai_detection_payload"])
            elif res[
                "status"] == "duplicate_detected":  # This means it was a duplicate AND override_this_specific_file_flag was False for it
                duplicate_payloads_for_modal.append(res)
            elif res["status"] == "error":
                error_files.append(res)

        if ai_flagged_payloads_for_modal and not is_forcing_problematic_upload:
            logger.warning(
                f"AI content detected in {len(ai_flagged_payloads_for_modal)} additional files for job {job_id}.")
            # Process any successful files before returning 422
            applications_created_info = []
            if successful_candidates_full_data:
                applications_created_info = candidate_service_instance.process_applications(job_id,
                                                                                            successful_candidates_full_data)
                profile_tasks = [generate_and_save_profile(cand_info, gemini_service_global_instance) for cand_info in
                                 successful_candidates_full_data]
                await asyncio.gather(*profile_tasks)

            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "message": "Potential AI-generated or problematic content detected in some additional CVs.",
                    "error_type": "AI_CONTENT_DETECTED",
                    "flagged_files": jsonable_encoder(ai_flagged_payloads_for_modal),
                    "jobId": job_id,
                    "processed_ok_count": len(successful_candidates_full_data),
                }
            )

        if duplicate_payloads_for_modal:  # These are duplicates that were NOT overridden
            logger.warning(f"Unresolved duplicate CVs remain for job {job_id}.")
            # Process any successful non-duplicate files before returning 409
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
                    # Files that were successful and not duplicates
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
                # For UploadMoreCVModal.js
                "candidatesData": final_candidates_data_for_response,
                "totalApplicationsForJob": total_applications_for_job,
                "errors_processing_files": error_files
            })
        )
    # ... (exception handling unchanged) ...
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
async def suggest_job_details_for_creation(context: JobSuggestionContext = Body(...)):  # Renamed for clarity
    # ... (implementation unchanged) ...
    if not context.job_title:
        raise HTTPException(status_code=400, detail="Job Title is required to generate suggestions.")
    try:
        suggestions = await gemini_service_global_instance.generate_job_details_suggestion(job_title=context.job_title,
                                                                                           context=context.model_dump(
                                                                                               exclude={
                                                                                                   'job_title'}))  # Use model_dump
        return JobSuggestionResponse(**suggestions)
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error generating job details suggestions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate suggestions: {str(e)}")