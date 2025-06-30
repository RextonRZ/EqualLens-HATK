from fastapi import APIRouter, HTTPException, Form, File, UploadFile, Body, status, Request
from fastapi.responses import JSONResponse
from typing import List, Optional, Dict, Any, Tuple
import json
import logging
import asyncio
import copy
from fastapi.encoders import jsonable_encoder
import uuid
from datetime import datetime, timezone
import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from core.firebase import firebase_client

from models.job import JobCreate, JobResponse, JobUpdate, JobSuggestionContext, JobSuggestionResponse
from models.candidate import CandidateUpdate
from models.ai_detection import AIDetectionResult
from models.authenticity_analysis import AuthenticityAnalysisResult
from models.cross_referencing import CrossReferencingResult

from services.job_service import JobService
from services.candidate_service import CandidateService
from services.gemini_service import GeminiService
from services.ai_detection_service import AIDetectionService, FINAL_AUTH_FLAG_THRESHOLD, SPAM_FLAG_THRESHOLD
from services.file_processing_cache_service import file_cache_service, ProcessedFileResult, RelevanceAnalysisResult

router = APIRouter()
logger = logging.getLogger(__name__)

# Instantiate services
gemini_service_global_instance = GeminiService()
candidate_service_instance = CandidateService(gemini_service_instance=gemini_service_global_instance)
ai_detection_formatter_instance = AIDetectionService()


@router.get("/", response_model=List[JobResponse])
async def get_jobs_list():
    try:
        jobs = JobService.get_jobs()
        return jobs
    except Exception as e:
        logger.error(f"Error getting jobs: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get jobs: {str(e)}")


@router.get("/{job_id}", response_model=JobResponse)
async def get_job_by_id(job_id: str):
    job = JobService.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return JobResponse(**job)


@router.put("/{job_id}", response_model=JobResponse)
async def update_job_details(job_id: str, job_update_data: JobUpdate):
    existing_job = JobService.get_job(job_id)
    if not existing_job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    update_data_dict = job_update_data.model_dump(exclude_unset=True)
    if "minimumCGPA" in update_data_dict:
        if update_data_dict["minimumCGPA"] is None or update_data_dict["minimumCGPA"] == -1:
            update_data_dict["minimumCGPA"] = 0.0
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


async def _process_single_file_for_candidate_creation(
        job_id_for_analysis: str,
        job_description_text_for_relevance: str,
        file_obj: UploadFile,
        user_time_zone: str,
        override_duplicates_from_form: bool,
        force_upload_problematic_from_form: bool,
        force_upload_irrelevant_from_form: bool,
        session_id: Optional[str] = None
) -> Dict[str, Any]:
    file_content_bytes = await file_obj.read()
    file_name_val = file_obj.filename
    content_type_val = file_obj.content_type or "application/pdf"
    file_size = len(file_content_bytes)

    # Generate file hash for caching
    file_hash = file_cache_service.generate_file_hash(file_content_bytes, file_name_val, file_size)

    # Check global cache for job-independent analysis (AI detection, document processing, etc.)
    cached_result = file_cache_service.get_cached_result(file_hash)
    
    # Check job-specific relevance cache
    cached_relevance = file_cache_service.get_cached_relevance_result(job_id_for_analysis, file_hash)
    
    if cached_result:
        logger.info(f"Using cached analysis for file: {file_name_val}")

        # Extract cached job-independent data
        document_ai_results = cached_result.document_ai_results
        authenticity_analysis_dict = cached_result.authenticity_analysis_result
        cross_referencing_analysis_dict = cached_result.cross_referencing_result
        external_ai_detection_data = cached_result.external_ai_detection_data
        final_assessment_data = cached_result.final_assessment_data
        
        # Convert cached dictionaries back to model objects
        authenticity_analysis = AuthenticityAnalysisResult(**authenticity_analysis_dict) if authenticity_analysis_dict else None
        cross_referencing_analysis = CrossReferencingResult(**cross_referencing_analysis_dict) if cross_referencing_analysis_dict else None
        
        # Check if we have cached relevance for this job-file combination
        if cached_relevance:
            logger.info(f"Using cached relevance analysis for job {job_id_for_analysis}, file: {file_name_val}")
            is_irrelevant_flag = cached_relevance.is_irrelevant
            irrelevance_payload_for_modal = cached_relevance.irrelevance_payload
        else:
            logger.info(f"Running fresh relevance analysis for cached file: {file_name_val} (job: {job_id_for_analysis})")
            # Will run relevance analysis below in common section
            is_irrelevant_flag = None  # Will be set in relevance analysis section
            irrelevance_payload_for_modal = None
    else:
        # If not in cache, proceed with full analysis
        logger.info(f"Running full analysis for file: {file_name_val}")
        
        # Reset relevance variables - will be set in relevance analysis section
        is_irrelevant_flag = None
        irrelevance_payload_for_modal = None

        temp_candidate_service = CandidateService(gemini_service_instance=gemini_service_global_instance)
        document_ai_results, authenticity_analysis, cross_referencing_analysis, external_ai_detection_data = \
            await temp_candidate_service._run_full_analysis_pipeline(
                candidate_id_for_logging=f"temp-uploadjob-analyze-{uuid.uuid4()}",
                file_content_bytes=file_content_bytes,
                file_name=file_name_val,
                content_type=content_type_val
            )

        if not document_ai_results or document_ai_results.get("error"):
            error_result = {
                "fileName": file_name_val, "status": "error_analysis",
                "message": "DocAI processing failed",
                "file_content_bytes": file_content_bytes, "content_type": content_type_val,
                "document_ai_results": document_ai_results,
                "file_hash": file_hash,
                "from_cache": False
            }
            return error_result

        final_assessment_data = await temp_candidate_service.scoring_aggregation_service.calculate_final_assessment(
            authenticity_analysis, cross_referencing_analysis
        )

    # Common section: Run relevance analysis if not cached
    # This analysis is job-specific and should be cached per job-file combination
    
    # Determine if we have cached data or need to use fresh analysis results
    from_cache = cached_result is not None

    # Update authenticity analysis with final assessment scores
    if authenticity_analysis:
        authenticity_analysis.final_overall_authenticity_score = final_assessment_data.get("final_overall_authenticity_score")
        authenticity_analysis.final_spam_likelihood_score = final_assessment_data.get("final_spam_likelihood_score")
        authenticity_analysis.final_xai_summary = final_assessment_data.get("final_xai_summary")

    # Run relevance analysis only if not cached for this job-file combination
    if is_irrelevant_flag is None:  # Not cached relevance
        temp_candidate_service = CandidateService(gemini_service_instance=gemini_service_global_instance)
        is_irrelevant_flag = False
        irrelevance_payload_for_modal = None
        try:
            candidate_profile_for_relevance = document_ai_results.get('entities', {})
            if candidate_profile_for_relevance and job_description_text_for_relevance:
                logger.info(f"Running fresh job relevance analysis for {file_name_val} (job: {job_id_for_analysis})")
                relevant_info = await temp_candidate_service.gemini_service.analyze_job_relevance(
                    candidate_profile=candidate_profile_for_relevance,
                    job_description=job_description_text_for_relevance
                )
                logger.info(f"Relevance analysis result for {file_name_val}: {relevant_info}")
                if relevant_info and relevant_info.get("relevance_label") == "Irrelevant":
                    is_irrelevant_flag = True
                    reason = relevant_info.get("irrelevant_reason")
                    if isinstance(reason, list): 
                        reason = ", ".join(str(r) for r in reason)
                    relevance_score_val = relevant_info.get("overall_relevance_score")
                    calculated_irrelevance_score = 100.0 - float(relevance_score_val) if relevance_score_val is not None else None
                    irrelevance_payload_for_modal = {
                        "filename": file_name_val, 
                        "is_irrelevant": True, 
                        "irrelevant_reason": reason,
                        "irrelevance_score": calculated_irrelevance_score, 
                        "job_type": relevant_info.get("job_type", "")
                    }
                
                # Cache the relevance analysis result for this job-file combination
                file_cache_service.cache_relevance_result(
                    job_id=job_id_for_analysis,
                    file_hash=file_hash,
                    file_name=file_name_val,
                    is_irrelevant=is_irrelevant_flag,
                    irrelevance_payload=irrelevance_payload_for_modal,
                    relevance_data=relevant_info
                )
        except Exception as e_irr:
            logger.error(f"Exception during irrelevance check for {file_name_val}: {e_irr}", exc_info=True)
    else:
        # Using cached relevance result
        logger.info(f"Using cached relevance result for {file_name_val} (job: {job_id_for_analysis}): irrelevant={is_irrelevant_flag}")

    # AI detection logic - use cached results if available
    overall_auth_score = final_assessment_data.get("final_overall_authenticity_score", 0.5)
    spam_score = final_assessment_data.get("final_spam_likelihood_score", 0.5)
    is_externally_flagged_ai = external_ai_detection_data.get("predicted_class_label") == "AI-generated" if external_ai_detection_data else False
    is_problematic_internally = (overall_auth_score < FINAL_AUTH_FLAG_THRESHOLD) or (spam_score > SPAM_FLAG_THRESHOLD)
    
    ai_detection_payload_for_modal = None
    if from_cache and cached_result.ai_detection_payload:
        # Use cached AI detection results - make a defensive copy and filter out any irrelevance data
        cached_payload = copy.deepcopy(cached_result.ai_detection_payload)
        
        # Filter to only include AI detection fields, exclude any irrelevance contamination
        ai_detection_payload_for_modal = {
            "filename": cached_payload.get("filename", file_name_val),
            "is_ai_generated": cached_payload.get("is_ai_generated", False),
            "confidence": cached_payload.get("confidence", 0.0),
            "reason": cached_payload.get("reason", ""),
            "details": cached_payload.get("details", {})
        }
        # Explicitly remove any irrelevance fields that might have contaminated the cache
        ai_detection_payload_for_modal.pop("is_irrelevant", None)
        ai_detection_payload_for_modal.pop("irrelevant_reason", None)
        ai_detection_payload_for_modal.pop("irrelevance_score", None)
        ai_detection_payload_for_modal.pop("job_type", None)
        
        logger.info(f"Using cached AI detection for {file_name_val}")
        logger.info(f"Cleaned AI detection payload keys: {list(ai_detection_payload_for_modal.keys())}")
    elif is_externally_flagged_ai:
        # Generate fresh AI detection payload
        payload_is_ai_generated_for_modal = True
        payload_confidence_for_modal = external_ai_detection_data.get("confidence_scores", {}).get("ai_generated", 0.0)

        formatted_reason_html_res = ai_detection_formatter_instance.format_analysis_for_frontend(
            filename=file_name_val, auth_results=authenticity_analysis,
            cross_ref_results=cross_referencing_analysis, external_ai_pred_data=external_ai_detection_data)
        formatted_reason_html = formatted_reason_html_res.reason if formatted_reason_html_res else "Detailed analysis available."

        ai_detection_payload_for_modal = {
            "filename": file_name_val, 
            "is_ai_generated": payload_is_ai_generated_for_modal,
            "confidence": payload_confidence_for_modal, 
            "reason": formatted_reason_html,
            "details": {
                "external_ai_prediction": external_ai_detection_data,
                "authenticity_analysis": authenticity_analysis.model_dump(exclude_none=True),
                "cross_referencing_analysis": cross_referencing_analysis.model_dump(exclude_none=True),
                "final_overall_authenticity_score": overall_auth_score,
                "final_spam_likelihood_score": spam_score,
                "final_xai_summary": final_assessment_data.get("final_xai_summary")
            }
        }

    # Check for duplicates (job-specific, runs after AI/irrelevance detection)
    duplicate_check_result = None
    is_duplicate_flag = False
    if not override_duplicates_from_form and document_ai_results:
        duplicate_check_result = CandidateService.check_duplicate_candidate(job_id_for_analysis, document_ai_results)
        if duplicate_check_result.get("is_duplicate"):
            is_duplicate_flag = True
            logger.info(f"Duplicate detected for {file_name_val}: {duplicate_check_result.get('duplicate_candidate', {}).get('candidateId', 'Unknown')}")

    # Determine final status - prioritize AI/irrelevance over duplicates
    current_status = "success_analysis"
    if is_externally_flagged_ai and not force_upload_problematic_from_form:
        current_status = "ai_content_detected"
    if is_irrelevant_flag and not force_upload_irrelevant_from_form:
        current_status = "irrelevant_content" if current_status != "ai_content_detected" else "ai_and_irrelevant_content"
    
    # If no AI/irrelevance issues but duplicate found, set duplicate status
    if current_status == "success_analysis" and is_duplicate_flag:
        current_status = "duplicate_detected_error"

    # Cache job-independent analysis results only (exclude relevance analysis)
    if not from_cache:
        # For AI detection payload, we only cache if there actually is AI detection
        ai_payload_to_cache = ai_detection_payload_for_modal if (is_externally_flagged_ai or is_problematic_internally) else None
        
        cached_file_result = ProcessedFileResult(
            file_hash=file_hash,
            file_name=file_name_val,
            file_size=file_size,
            processed_at=time.time(),
            status="cached_job_independent",  # Special status to indicate partial cache
            ai_detection_payload=ai_payload_to_cache,  # Cache AI detection for reuse across jobs
            irrelevance_payload=None,  # NEVER cache relevance analysis (job-specific)
            duplicate_info_raw=None,  # NEVER cache duplicate info (job-specific)
            document_ai_results=document_ai_results,
            authenticity_analysis_result=authenticity_analysis.model_dump(exclude_none=True),
            cross_referencing_result=cross_referencing_analysis.model_dump(exclude_none=True),
            external_ai_detection_data=external_ai_detection_data,
            final_assessment_data=final_assessment_data,
            content_type=content_type_val,
            user_time_zone=user_time_zone
        )
        file_cache_service.cache_result(file_hash, cached_file_result)

        if session_id:
            file_cache_service.add_to_session(session_id, file_hash, cached_file_result)

    # Return final result
    result = {
        "fileName": file_name_val, 
        "status": current_status,
        "ai_detection_payload": ai_detection_payload_for_modal,
        "irrelevance_payload": irrelevance_payload_for_modal,
        "duplicate_info_raw": duplicate_check_result,  # Include duplicate info for all files
        "file_content_bytes": file_content_bytes, 
        "content_type": content_type_val,
        "document_ai_results": document_ai_results,
        "authenticity_analysis_result": authenticity_analysis.model_dump(exclude_none=True),
        "cross_referencing_result": cross_referencing_analysis.model_dump(exclude_none=True),
        "external_ai_detection_data": external_ai_detection_data,
        "final_assessment_data": final_assessment_data,
        "user_time_zone": user_time_zone,
        "file_hash": file_hash,
        "from_cache": from_cache
    }

    logger.info(f"Final result for {file_name_val}: status={current_status}, is_irrelevant={is_irrelevant_flag}, is_duplicate={is_duplicate_flag}, cached={from_cache}")
    
    return result


async def generate_and_save_profile(candidate_info: Dict[str, Any], gemini_srv: GeminiService) -> bool:
    candidate_id = candidate_info.get('candidateId')
    if not candidate_id:
        logger.warning("Missing candidateId in candidate_info for profile generation.")
        return False

    entities_for_profile_gen: Optional[Dict[str, Any]] = candidate_info.get("extractedText")
    if not entities_for_profile_gen:
        extracted_data_from_doc_ai = candidate_info.get("extractedDataFromDocAI", {})
        if isinstance(extracted_data_from_doc_ai, dict):
            entities_for_profile_gen = extracted_data_from_doc_ai.get("entities")
        else:
            return False

    if not entities_for_profile_gen or not isinstance(entities_for_profile_gen, dict):
        return False

    applicant_data_for_gemini = {"candidateId": candidate_id, "extractedText": entities_for_profile_gen}
    try:
        detailed_profile = await gemini_srv.generate_candidate_profile(applicant_data_for_gemini)
        if not detailed_profile or not isinstance(detailed_profile, dict) or "summary" not in detailed_profile:
            return False

        profile_update_model = CandidateUpdate(detailed_profile=detailed_profile)
        success = CandidateService.update_candidate(candidate_id, profile_update_model)
        return success
    except Exception as e:
        logger.error(f"Error in generate_and_save_profile for candidate {candidate_id}: {e}", exc_info=True)
        return False


@router.post("/upload-job")
async def upload_job_and_cvs(
        job_data_json_str: str = Form(..., alias="job_data"),
        files: List[UploadFile] = File(...),
        force_upload_ai_flagged: Optional[str] = Form(None),
        force_upload_irrelevant: Optional[str] = Form(None),
        user_time_zone: str = Form("UTC"),
        session_id: Optional[str] = Form(None)  # Add session tracking
):
    try:
        # Create session if not provided
        if not session_id:
            session_id = f"upload-job-{uuid.uuid4()}"
        file_cache_service.create_session(session_id)

        job_details = json.loads(job_data_json_str)
        is_forcing_problematic_upload_consent = (force_upload_ai_flagged and force_upload_ai_flagged.lower() == "true")
        is_forcing_irrelevant_upload_consent = (force_upload_irrelevant and force_upload_irrelevant.lower() == "true")

        job_create_payload = JobCreate(
            jobTitle=job_details.get("jobTitle"),
            jobDescription=job_details.get("jobDescription", ""),
            departments=job_details.get("departments", []),
            minimumCGPA=float(job_details.get("minimumCGPA", 0.0)) if job_details.get("minimumCGPA") not in [-1, None,
                                                                                                             ""] else 0.0,
            requiredSkills=job_details.get("requiredSkills", []),
            prompt=job_details.get("prompt", "")
        )

        file_analysis_tasks = [
            _process_single_file_for_candidate_creation(
                job_id_for_analysis=f"temp-job-analysis-{uuid.uuid4()}",
                job_description_text_for_relevance=job_create_payload.jobDescription,
                file_obj=file_obj, user_time_zone=user_time_zone, override_duplicates_from_form=False,
                force_upload_problematic_from_form=is_forcing_problematic_upload_consent,
                force_upload_irrelevant_from_form=is_forcing_irrelevant_upload_consent,
                session_id=session_id
            ) for file_obj in files
        ]
        processed_analysis_results = await asyncio.gather(*file_analysis_tasks)

        # Rest of the function remains the same...
        files_ready_for_creation, error_files, duplicate_errors, flagged_files_for_modal = [], [], [], []
        for res in processed_analysis_results:
            file_status = res.get("status")
            if file_status == "success_analysis":
                files_ready_for_creation.append(res)
            elif file_status == "error_analysis":
                error_files.append(res)
            elif file_status == "duplicate_detected_error":
                duplicate_errors.append(res)
            elif file_status in ["ai_content_detected", "irrelevant_content", "ai_and_irrelevant_content"]:
                modal_payload = {"filename": res["fileName"]}
                if res.get("ai_detection_payload"): modal_payload.update(res["ai_detection_payload"])
                if res.get("irrelevance_payload"): modal_payload.update(res["irrelevance_payload"])
                flagged_files_for_modal.append(modal_payload)
            else:
                error_files.append({"fileName": res.get("fileName"), "message": f"Unknown status: {file_status}"})

        if flagged_files_for_modal:
            # Only include actually flagged files in flagged_analysis_payloads
            flagged_analysis_results = []
            for res in processed_analysis_results:
                file_status = res.get("status")
                if file_status in ["ai_content_detected", "irrelevant_content", "ai_and_irrelevant_content"]:
                    flagged_analysis_results.append(res)
            
            # Check for duplicates in successful files - these will be shown after AI confirmation
            duplicate_check_results = []
            for res in processed_analysis_results:
                file_status = res.get("status")
                if file_status == "success_analysis" and res.get("duplicate_info_raw") and res["duplicate_info_raw"].get("is_duplicate"):
                    duplicate_info = res["duplicate_info_raw"]
                    duplicate_info['fileName'] = res.get('fileName')
                    duplicate_check_results.append(duplicate_info)
            
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "message": "Some resumes require review.", "error_type": "FLAGGED_CONTENT_NEW_JOB",
                    "flagged_files_for_modal": jsonable_encoder(flagged_files_for_modal),
                    "job_creation_payload_json": job_create_payload.model_dump_json(), "user_time_zone": user_time_zone,
                    "successful_analysis_payloads": jsonable_encoder(files_ready_for_creation,
                                                                     custom_encoder={bytes: lambda b: None}),
                    "flagged_analysis_payloads": jsonable_encoder(flagged_analysis_results,
                                                                  custom_encoder={bytes: lambda b: None}),
                    "pending_duplicate_checks": jsonable_encoder(duplicate_check_results),  # Add duplicate info
                    "session_id": session_id,  # Include session_id in response
                    "cache_stats": file_cache_service.get_cache_stats()
                })

        # Check for duplicates only in files that don't have AI/irrelevance issues
        duplicate_files_needing_confirmation = []
        for res in processed_analysis_results:
            file_status = res.get("status")
            if file_status == "duplicate_detected_error":
                duplicate_info = res["duplicate_info_raw"]
                duplicate_info['fileName'] = res.get('fileName')
                duplicate_files_needing_confirmation.append(duplicate_info)
        
        # If there are duplicate files (and no AI flagged files), show duplicate modal
        if duplicate_files_needing_confirmation and not flagged_files_for_modal:
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={
                    "message": "Duplicate CVs detected.", 
                    "error_type": "DUPLICATE_FILES_DETECTED",
                    "duplicates": jsonable_encoder(duplicate_files_needing_confirmation), 
                    "job_creation_payload_json": job_create_payload.model_dump_json(),
                    "user_time_zone": user_time_zone,
                    "successful_analysis_payloads": jsonable_encoder(files_ready_for_creation,
                                                                     custom_encoder={bytes: lambda b: None}),
                    "session_id": session_id,
                    "cache_stats": file_cache_service.get_cache_stats()
                })

        # Continue with job creation...
        all_files_to_create = files_ready_for_creation
        if not all_files_to_create:
            file_cache_service.clear_session(session_id)
            return JSONResponse(status_code=400, content={"message": "No valid CVs to process.", "errors": error_files,
                                                          "duplicates_found": duplicate_errors})

        actual_job_id = JobService.create_job(job_create_payload)
        if not actual_job_id:
            file_cache_service.clear_session(session_id)
            raise HTTPException(status_code=500, detail="Failed to create job entry.")

        # Clear any existing relevance cache entries that might conflict with new job analysis
        # This ensures fresh relevance analysis for the new job
        logger.info(f"Clearing relevance cache for new job creation: {actual_job_id}")
        file_cache_service.clear_relevance_cache_for_job(actual_job_id)

        # Rest of candidate creation logic remains the same...
        successful_candidates = []
        sequentially_generated_ids = [firebase_client.generate_counter_id("cand") for _ in all_files_to_create]

        creation_tasks = [
            asyncio.to_thread(
                candidate_service_instance.create_candidate_from_data,
                job_id=actual_job_id, file_content=payload["file_content_bytes"], file_name=payload["fileName"],
                content_type=payload["content_type"], extracted_data_from_doc_ai=payload["document_ai_results"],
                authenticity_analysis_result=payload["authenticity_analysis_result"],
                cross_referencing_result=payload["cross_referencing_result"],
                final_assessment_data=payload["final_assessment_data"],
                external_ai_detection_data=payload["external_ai_detection_data"],
                user_time_zone=user_time_zone, candidate_id_override=sequentially_generated_ids[i]
            ) for i, payload in enumerate(all_files_to_create)
        ]
        created_results = await asyncio.gather(*creation_tasks, return_exceptions=True)

        for res in created_results:
            if isinstance(res, dict) and not res.get("error"):
                successful_candidates.append(res)
            else:
                error_files.append({"message": str(res)})

        applications_info = CandidateService.process_applications(actual_job_id, successful_candidates)
        profile_tasks = [generate_and_save_profile(cand, gemini_service_global_instance) for cand in
                         successful_candidates]
        await asyncio.gather(*profile_tasks)

        # Clear session after successful completion
        file_cache_service.clear_session(session_id)

        return JSONResponse(status_code=201, content=jsonable_encoder({
            "jobId": actual_job_id, "jobTitle": job_create_payload.jobTitle,
            "applicationCount": len(applications_info), "applications": applications_info,
            "successfulCandidates": [c['candidateId'] for c in successful_candidates],
            "errors": error_files, "duplicates_found": duplicate_errors,
            "cache_stats": file_cache_service.get_cache_stats()
        }))
    except Exception as e:
        if session_id:
            file_cache_service.clear_session(session_id)
        logger.error(f"Error in /upload-job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create-job-with-confirmed-cvs")
async def create_job_with_confirmed_cvs(
        job_creation_payload_json: str = Form(...),
        successful_analysis_payloads_json: str = Form(...),
        flagged_analysis_payloads_json: str = Form(...),
        user_time_zone: str = Form("UTC"),
        files: List[UploadFile] = File(...),
        override_duplicates: Optional[str] = Form("false")  # Add duplicate override option
):
    try:
        job_create_payload = JobCreate.model_validate_json(job_creation_payload_json)
        successful_payloads = json.loads(successful_analysis_payloads_json)
        flagged_payloads = json.loads(flagged_analysis_payloads_json)
        uploaded_files_content = {file.filename: await file.read() for file in files}
        
        is_overriding_duplicates = (override_duplicates and override_duplicates.lower() == "true")
        
        # First create the job to get a proper job ID for duplicate checking
        actual_job_id = JobService.create_job(job_create_payload)
        if not actual_job_id:
            raise HTTPException(status_code=500, detail="Failed to create job entry.")

        all_payloads_for_creation = successful_payloads + flagged_payloads
        
        # Check for duplicates unless override is enabled
        if not is_overriding_duplicates:
            duplicates_found = []
            for payload in all_payloads_for_creation:
                document_ai_results = payload.get("document_ai_results")
                if document_ai_results:
                    duplicate_check_result = CandidateService.check_duplicate_candidate(actual_job_id, document_ai_results)
                    if duplicate_check_result.get("is_duplicate"):
                        duplicate_info = duplicate_check_result
                        duplicate_info['fileName'] = payload.get('fileName')
                        duplicates_found.append(duplicate_info)
            
            # If duplicates found, return duplicate modal response
            if duplicates_found:
                return JSONResponse(
                    status_code=status.HTTP_409_CONFLICT,
                    content={
                        "message": "Duplicate CVs detected after AI confirmation.", 
                        "error_type": "DUPLICATE_FILES_DETECTED_AFTER_AI_CONFIRMATION",
                        "duplicates": jsonable_encoder(duplicates_found),
                        "jobId": actual_job_id,
                        "job_creation_payload_json": job_creation_payload_json,
                        "successful_analysis_payloads_json": successful_analysis_payloads_json,
                        "flagged_analysis_payloads_json": flagged_analysis_payloads_json,
                        "user_time_zone": user_time_zone
                    })

        error_files = []
        sequentially_generated_ids = [firebase_client.generate_counter_id("cand") for _ in all_payloads_for_creation]

        creation_tasks = []
        for i, payload in enumerate(all_payloads_for_creation):
            file_name = payload.get("fileName")
            file_content_bytes = uploaded_files_content.get(file_name)
            if not file_content_bytes:
                error_files.append({"fileName": file_name, "message": "File content missing."})
                continue

            task = asyncio.to_thread(
                candidate_service_instance.create_candidate_from_data,
                job_id=actual_job_id, file_content=file_content_bytes, file_name=payload["fileName"],
                content_type=payload["content_type"], extracted_data_from_doc_ai=payload["document_ai_results"],
                authenticity_analysis_result=payload["authenticity_analysis_result"],
                cross_referencing_result=payload["cross_referencing_result"],
                final_assessment_data=payload["final_assessment_data"],
                external_ai_detection_data=payload["external_ai_detection_data"],
                user_time_zone=user_time_zone, candidate_id_override=sequentially_generated_ids[i]
            )
            creation_tasks.append(task)

        successful_candidates = []
        created_results = await asyncio.gather(*creation_tasks, return_exceptions=True)
        for i, res in enumerate(created_results):
            if isinstance(res, Exception) or (isinstance(res, dict) and res.get("error")):
                error_files.append({"fileName": all_payloads_for_creation[i]["fileName"], "message": str(res)})
            else:
                successful_candidates.append(res)

        applications_info = CandidateService.process_applications(actual_job_id, successful_candidates)
        profile_tasks = [generate_and_save_profile(cand, gemini_service_global_instance) for cand in
                         successful_candidates]
        await asyncio.gather(*profile_tasks)

        return JSONResponse(status_code=201, content=jsonable_encoder({
            "jobId": actual_job_id, "jobTitle": job_create_payload.jobTitle,
            "applicationCount": len(applications_info), "applications": applications_info,
            "successfulCandidates": [c['candidateId'] for c in successful_candidates],
            "errors": error_files, "message": "Job created successfully."
        }))
    except Exception as e:
        logger.error(f"Error in /create-job-with-confirmed-cvs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to process confirmed submission: {str(e)}")


@router.post("/upload-more-cv")
async def upload_more_cv_for_job(
        job_id: str = Form(...),
        files: List[UploadFile] = File(...),
        override_duplicates: Optional[str] = Form("false"),
        selected_filenames_for_overwrite_json: Optional[str] = Form(None, alias="selected_filenames"),
        force_upload_ai_flagged: Optional[str] = Form(None),
        force_upload_irrelevant: Optional[str] = Form(None),
        user_time_zone: str = Form("UTC"),
        session_id: Optional[str] = Form(None)  # Add session tracking
):
    logger.info(
        f"UploadMoreCV: JobID {job_id}, Files: {len(files)}, OverrideDupGen: {override_duplicates}, "
        f"ForceAI: {force_upload_ai_flagged}, ForceIrrelevant: {force_upload_irrelevant}, SessionID: {session_id}"
    )
    try:
        # Create session if not provided
        if not session_id:
            session_id = f"upload-more-{job_id}-{uuid.uuid4()}"
        file_cache_service.create_session(session_id)

        job = JobService.get_job(job_id)
        if not job:
            file_cache_service.clear_session(session_id)
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        if not files:
            file_cache_service.clear_session(session_id)
            raise HTTPException(status_code=400, detail="No CV files provided.")

        is_overriding_duplicates_general = (override_duplicates and override_duplicates.lower() == "true")
        is_forcing_problematic_upload_consent = (force_upload_ai_flagged and force_upload_ai_flagged.lower() == "true")
        is_forcing_irrelevant_upload_consent = (force_upload_irrelevant and force_upload_irrelevant.lower() == "true")

        selected_filenames_to_override_list = []
        if selected_filenames_for_overwrite_json:
            try:
                selected_filenames_to_override_list = json.loads(selected_filenames_for_overwrite_json)
            except json.JSONDecodeError:
                selected_filenames_to_override_list = []

        analysis_tasks = [
            _process_single_file_for_candidate_creation(
                job_id_for_analysis=job_id,
                job_description_text_for_relevance=job.get("jobDescription", ""),
                file_obj=file_obj,
                user_time_zone=user_time_zone,
                override_duplicates_from_form=is_overriding_duplicates_general,
                force_upload_problematic_from_form=is_forcing_problematic_upload_consent,
                force_upload_irrelevant_from_form=is_forcing_irrelevant_upload_consent,
                session_id=session_id
            ) for file_obj in files
        ]
        analysis_results = await asyncio.gather(*analysis_tasks)

        # Rest of the function logic - prioritize AI/irrelevance detection over duplicates
        files_to_create, files_to_overwrite, unresolved_duplicates, flagged_files, error_files = [], [], [], [], []

        for res in analysis_results:
            file_status = res.get("status")
            if file_status == "error_analysis":
                error_files.append(res)
            elif file_status == "duplicate_detected_error":
                if res["fileName"] in selected_filenames_to_override_list or is_overriding_duplicates_general:
                    files_to_overwrite.append(res)
                else:
                    duplicate_info = res["duplicate_info_raw"]
                    duplicate_info['fileName'] = res.get('fileName')
                    unresolved_duplicates.append(duplicate_info)
            elif file_status in ["ai_content_detected", "irrelevant_content", "ai_and_irrelevant_content"]:
                modal_payload = {"filename": res["fileName"]}
                if res.get("ai_detection_payload"): modal_payload.update(res["ai_detection_payload"])
                if res.get("irrelevance_payload"): modal_payload.update(res["irrelevance_payload"])
                flagged_files.append(modal_payload)
            elif file_status == "success_analysis":
                # Check for duplicates in success files too (they may have duplicates but not be flagged if override_duplicates is false)
                if res.get("duplicate_info_raw") and res["duplicate_info_raw"].get("is_duplicate"):
                    if res["fileName"] in selected_filenames_to_override_list or is_overriding_duplicates_general:
                        files_to_overwrite.append(res)
                    else:
                        duplicate_info = res["duplicate_info_raw"]
                        duplicate_info['fileName'] = res.get('fileName')
                        unresolved_duplicates.append(duplicate_info)
                else:
                    files_to_create.append(res)

        # Show AI/irrelevance flagged files first (higher priority)
        if flagged_files:
            # Check for duplicates in files that would be processed after AI confirmation
            pending_duplicates = []
            for res in analysis_results:
                file_status = res.get("status")
                if file_status == "success_analysis" and res.get("duplicate_info_raw") and res["duplicate_info_raw"].get("is_duplicate"):
                    if res["fileName"] not in selected_filenames_to_override_list and not is_overriding_duplicates_general:
                        duplicate_info = res["duplicate_info_raw"]
                        duplicate_info['fileName'] = res.get('fileName')
                        pending_duplicates.append(duplicate_info)
            
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "message": "Some resumes require review.",
                    "error_type": "FLAGGED_CONTENT",
                    "flagged_files": jsonable_encoder(flagged_files, custom_encoder={bytes: lambda b: None}),
                    "pending_duplicate_checks": jsonable_encoder(pending_duplicates),  # Include duplicates that will be checked after AI confirmation
                    "jobId": job_id,
                    "session_id": session_id,
                    "cache_stats": file_cache_service.get_cache_stats()
                }
            )

        # Show duplicate modal only if no AI/irrelevance issues
        if unresolved_duplicates:
            return JSONResponse(status_code=status.HTTP_409_CONFLICT,
                                content={"message": "Duplicate CVs detected.", "error_type": "DUPLICATE_FILES_DETECTED",
                                         "duplicates": jsonable_encoder(unresolved_duplicates), "jobId": job_id,
                                         "session_id": session_id, "cache_stats": file_cache_service.get_cache_stats()})

        # Continue with candidate creation/overwrite logic...
        successful_candidates_app_data = []
        processed_candidate_ids_for_response = []

        if files_to_create:
            new_candidate_ids = [firebase_client.generate_counter_id("cand") for _ in files_to_create]
            creation_tasks = []
            for i, payload in enumerate(files_to_create):
                task = asyncio.to_thread(
                    candidate_service_instance.create_candidate_from_data,
                    job_id=job_id, file_content=payload["file_content_bytes"], file_name=payload["fileName"],
                    content_type=payload["content_type"], extracted_data_from_doc_ai=payload["document_ai_results"],
                    authenticity_analysis_result=payload["authenticity_analysis_result"],
                    cross_referencing_result=payload["cross_referencing_result"],
                    final_assessment_data=payload["final_assessment_data"],
                    external_ai_detection_data=payload["external_ai_detection_data"],
                    user_time_zone=user_time_zone, candidate_id_override=new_candidate_ids[i]
                )
                creation_tasks.append(task)

            created_results = await asyncio.gather(*creation_tasks)
            for res in created_results:
                if res and not res.get("error"):
                    successful_candidates_app_data.append(res)
                    processed_candidate_ids_for_response.append(res["candidateId"])
                else:
                    error_files.append(res)

        for payload in files_to_overwrite:
            dup_info = payload.get("duplicate_info_raw", {})
            existing_candidate_id = dup_info.get("duplicate_candidate", {}).get("candidateId")
            if not existing_candidate_id:
                error_files.append(
                    {"fileName": payload["fileName"], "message": "Could not find existing candidate ID to overwrite."})
                continue

            new_file_id = str(uuid.uuid4())
            new_file_ext = payload["fileName"].split('.')[-1] if '.' in payload["fileName"] else 'pdf'
            new_storage_path = f"resumes/{job_id}/{existing_candidate_id}/{new_file_id}.{new_file_ext}"
            new_resume_url = firebase_client.upload_file(payload["file_content_bytes"], new_storage_path,
                                                         payload["content_type"])

            if not new_resume_url:
                error_files.append({"fileName": payload['fileName'], "message": "Overwrite file upload failed"})
                continue

            try:
                tz = ZoneInfo(user_time_zone)
                overwrite_at_iso = datetime.now(tz).isoformat()
            except (ZoneInfoNotFoundError, TypeError):
                overwrite_at_iso = datetime.now(timezone.utc).isoformat()

            update_data = CandidateUpdate(
                extractedText=payload["document_ai_results"].get("entities", {}),
                fullTextFromDocAI=payload["document_ai_results"].get("full_text", ""),
                resumeUrl=new_resume_url, storagePath=new_storage_path, originalFileName=payload["fileName"],
                overwriteAt=overwrite_at_iso,
                authenticityAnalysis=AuthenticityAnalysisResult(**payload["authenticity_analysis_result"]),
                crossReferencingAnalysis=CrossReferencingResult(**payload["cross_referencing_result"]),
                externalAIDetectionResult=payload.get("external_ai_detection_data"),
                overallAuthenticityScore=payload.get("final_assessment_data", {}).get(
                    "final_overall_authenticity_score"),
                spamLikelihoodScore=payload.get("final_assessment_data", {}).get("final_spam_likelihood_score"),
                finalXAISummary=payload.get("final_assessment_data", {}).get("final_xai_summary"),
                detailed_profile=None
            )
            if CandidateService.update_candidate(existing_candidate_id, update_data):
                candidate_data = CandidateService.get_candidate(existing_candidate_id)
                if candidate_data:
                    successful_candidates_app_data.append(candidate_data)
                    processed_candidate_ids_for_response.append(existing_candidate_id)
            else:
                error_files.append({"fileName": payload['fileName'], "message": "Overwrite DB update failed"})

        if successful_candidates_app_data:
            applications_created_info = candidate_service_instance.process_applications(job_id,
                                                                                        successful_candidates_app_data)
            profile_gen_tasks = [generate_and_save_profile(cand_info, gemini_service_global_instance) for cand_info in
                                 successful_candidates_app_data]
            await asyncio.gather(*profile_gen_tasks)

        updated_job = JobService.get_job(job_id)

        file_cache_service.clear_session(session_id)

        updated_job = JobService.get_job(job_id)
        return JSONResponse(status_code=200, content=jsonable_encoder({
            "message": "CVs processed successfully.",
            "jobId": job_id,
            "newApplicationCount": len(files_to_create),
            "updatedApplicationCount": len(files_to_overwrite),
            "totalApplicationsForJob": updated_job.get("applicationCount", 0),
            "errors_processing_files": error_files,
            "candidateIds": processed_candidate_ids_for_response,
            "cache_stats": file_cache_service.get_cache_stats()
        }))


    except Exception as e:

        if session_id:
            file_cache_service.clear_session(session_id)
        logger.error(f"Unexpected error in /upload-more-cv for job {job_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

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

@router.get("/cache-stats")
async def get_cache_stats():
    """Get file processing cache statistics."""
    return file_cache_service.get_cache_stats()

@router.post("/clear-cache")
async def clear_cache():
    """Clear all file processing cache."""
    file_cache_service.clear_all_cache()
    return {"message": "Cache cleared successfully"}

@router.post("/create-job-with-all-confirmations")
async def create_job_with_all_confirmations(
        job_creation_payload_json: str = Form(...),
        successful_analysis_payloads_json: str = Form(...),
        flagged_analysis_payloads_json: str = Form(...),
        user_time_zone: str = Form("UTC"),
        files: List[UploadFile] = File(...),
        selected_filenames_for_overwrite_json: Optional[str] = Form(None, alias="selected_filenames")
):
    """Create job after both AI and duplicate confirmations"""
    try:
        job_create_payload = JobCreate.model_validate_json(job_creation_payload_json)
        successful_payloads = json.loads(successful_analysis_payloads_json)
        flagged_payloads = json.loads(flagged_analysis_payloads_json)
        uploaded_files_content = {file.filename: await file.read() for file in files}
        
        selected_filenames_to_override_list = []
        if selected_filenames_for_overwrite_json:
            try:
                selected_filenames_to_override_list = json.loads(selected_filenames_for_overwrite_json)
            except json.JSONDecodeError:
                selected_filenames_to_override_list = []

        actual_job_id = JobService.create_job(job_create_payload)
        if not actual_job_id:
            raise HTTPException(status_code=500, detail="Failed to create job entry.")

        # Clear any existing relevance cache entries that might conflict with new job analysis
        # This ensures fresh relevance analysis for the new job
        logger.info(f"Clearing relevance cache for new job creation: {actual_job_id}")
        file_cache_service.clear_relevance_cache_for_job(actual_job_id)

        all_payloads_for_creation = successful_payloads + flagged_payloads
        error_files = []
        sequentially_generated_ids = [firebase_client.generate_counter_id("cand") for _ in all_payloads_for_creation]

        creation_tasks = []
        for i, payload in enumerate(all_payloads_for_creation):
            file_name = payload.get("fileName")
            file_content_bytes = uploaded_files_content.get(file_name)
            if not file_content_bytes:
                error_files.append({"fileName": file_name, "message": "File content missing."})
                continue

            # Skip files that were marked as duplicates but not selected for overwrite
            document_ai_results = payload.get("document_ai_results")
            if document_ai_results:
                duplicate_check_result = CandidateService.check_duplicate_candidate(actual_job_id, document_ai_results)
                if duplicate_check_result.get("is_duplicate") and file_name not in selected_filenames_to_override_list:
                    logger.info(f"Skipping duplicate file not selected for overwrite: {file_name}")
                    continue

            task = asyncio.to_thread(
                candidate_service_instance.create_candidate_from_data,
                job_id=actual_job_id, file_content=file_content_bytes, file_name=payload["fileName"],
                content_type=payload["content_type"], extracted_data_from_doc_ai=payload["document_ai_results"],
                authenticity_analysis_result=payload["authenticity_analysis_result"],
                cross_referencing_result=payload["cross_referencing_result"],
                final_assessment_data=payload["final_assessment_data"],
                external_ai_detection_data=payload["external_ai_detection_data"],
                user_time_zone=user_time_zone, candidate_id_override=sequentially_generated_ids[i]
            )
            creation_tasks.append(task)

        successful_candidates = []
        created_results = await asyncio.gather(*creation_tasks, return_exceptions=True)
        for i, res in enumerate(created_results):
            if isinstance(res, Exception) or (isinstance(res, dict) and res.get("error")):
                error_files.append({"fileName": all_payloads_for_creation[i]["fileName"], "message": str(res)})
            else:
                successful_candidates.append(res)

        applications_info = CandidateService.process_applications(actual_job_id, successful_candidates)
        profile_tasks = [generate_and_save_profile(cand, gemini_service_global_instance) for cand in
                         successful_candidates]
        await asyncio.gather(*profile_tasks)

        return JSONResponse(status_code=201, content=jsonable_encoder({
            "jobId": actual_job_id, "jobTitle": job_create_payload.jobTitle,
            "applicationCount": len(applications_info), "applications": applications_info,
            "successfulCandidates": [c['candidateId'] for c in successful_candidates],
            "errors": error_files, "message": "Job created successfully after all confirmations."
        }))
    except Exception as e:
        logger.error(f"Error in /create-job-with-all-confirmations: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to process confirmed submission: {str(e)}")