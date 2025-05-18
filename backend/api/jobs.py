from fastapi import APIRouter, HTTPException, Form, File, UploadFile, Body, status, Request
from fastapi.responses import JSONResponse
from typing import List, Optional, Dict, Any, Tuple
import json
import logging
from datetime import datetime
import uuid
import asyncio
import httpx
from fastapi.encoders import jsonable_encoder

from models.job import JobCreate, JobResponse, JobUpdate, JobSuggestionContext, JobSuggestionResponse
from models.candidate import CandidateUpdate
from models.ai_detection import AIDetectionResult

from services.job_service import JobService
from services.candidate_service import CandidateService
from services.document_service import DocumentService
from services.gemini_service import GeminiService
from services.ai_detection_service import AIDetectionService, AI_DETECTION_FLAG_THRESHOLD
from core.text_similarity import serialize_firebase_data

router = APIRouter()
logger = logging.getLogger(__name__)
gemini_service = GeminiService()
ai_detection_service_instance = AIDetectionService(gemini_service=gemini_service)

@router.get("/", response_model=List[JobResponse])
async def get_jobs():
    """Get all jobs."""
    try:
        jobs = JobService.get_jobs()
        return jobs
    except Exception as e:
        logger.error(f"Error getting jobs: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get jobs: {str(e)}")

@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    """Get a job by ID."""
    job = JobService.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return job

@router.put("/{job_id}", response_model=JobResponse)
async def update_job(job_id: str, job: JobUpdate):
    """Update a job."""
    existing_job = JobService.get_job(job_id)
    if not existing_job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    job_dict = job.dict(exclude_unset=True)
    if "minimumCGPA" in job_dict and (job_dict["minimumCGPA"] is None or job_dict["minimumCGPA"] == -1):
        job_dict["minimumCGPA"] = 0
    logger.info(f"Updating job {job_id} with data: {job_dict}")
    success = JobService.update_job(job_id, job)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update job")
    updated_job = JobService.get_job(job_id)
    return updated_job

async def _create_candidate_entry(
    job_id_str: str, 
    file_content_val: bytes, 
    file_name_val: str, 
    content_type_val: str,
    pre_processed_doc_data: Optional[Dict[str, Any]] = None,
    user_time_zone: Optional[str] = "UTC"
) -> Optional[Dict[str, Any]]:
    """Helper to call CandidateService.create_candidate with pre-processed data."""
    try:
        candidate_data = CandidateService.create_candidate(
            job_id=job_id_str,
            file_content=file_content_val,
            file_name=file_name_val,
            content_type=content_type_val or "application/pdf",
            pre_processed_doc_data=pre_processed_doc_data,
            user_time_zone=user_time_zone
        )
        return candidate_data
    except Exception as e:
        logger.error(f"Error creating candidate entry for file {file_name_val} in job {job_id_str}: {e}", exc_info=True)
        return None

async def run_ai_validation_for_file(
    file_content_bytes: bytes,
    original_filename: str,
    original_content_type: str,
    ai_detection_srv: AIDetectionService,
    doc_service_class: type[DocumentService],
    skip_actual_ai_detection: bool = False,
    job_description_for_ai: Optional[str] = None, 
    job_skills_for_ai: Optional[List[str]] = None  
) -> Tuple[bytes, str, Optional[Dict[str, Any]], Optional[AIDetectionResult]]:
    """
    Processes a single file's content for AI detection.
    1. Calls DocumentService to get structured data (which includes full text).
    2. Extracts full text from this data.
    3. Calls AI Detection Service.
    Returns: (file_content_bytes, original_filename, processed_doc_data_for_ai, ai_detection_result)
    """
    processed_doc_data_for_ai: Optional[Dict[str, Any]] = None
    ai_detection_result: Optional[AIDetectionResult] = None
    try:
        # Step 1: Process document to get text for AI detection (AND FOR LATER CANDIDATE CREATION)
        processed_doc_data_for_ai = doc_service_class.process_document(
            file_content=file_content_bytes,
            mime_type=original_content_type,
            file_name=original_filename
        )
        text_for_ai_analysis = ""
        if isinstance(processed_doc_data_for_ai, dict):
            text_for_ai_analysis = processed_doc_data_for_ai.get("full_text", "")
        elif isinstance(processed_doc_data_for_ai, str):
            text_for_ai_analysis = processed_doc_data_for_ai
            logger.warning(f"DocumentService returned a string for {original_filename}. Assuming it's the full text.")
        
        if skip_actual_ai_detection:
            logger.info(f"AI detection skipped for file {original_filename} due to user force upload.")
            ai_detection_result = AIDetectionResult(filename=original_filename, is_ai_generated=False, confidence=0.0, reason="AI check bypassed by user force upload.", details={"gemini": {"score": 0.0, "text_assessment": "N/A", "fabrication_concern": "N/A", "reason": "AI check bypassed by user."}})
        elif not text_for_ai_analysis:
            logger.warning(f"No text extracted from {original_filename} for AI detection.")
            ai_detection_result = AIDetectionResult(filename=original_filename, is_ai_generated=False, confidence=0.0, reason="No text extracted for analysis.", details={"gemini": {"score": 0.0, "text_assessment": "N/A", "fabrication_concern": "N/A", "reason": "No text extracted."}})
        else:
            ai_detection_result = await ai_detection_srv.detect_ai_generated_text(text_for_ai_analysis, original_filename, job_description=job_description_for_ai, job_skills=job_skills_for_ai)
        
        return file_content_bytes, original_filename, processed_doc_data_for_ai, ai_detection_result
    except Exception as e:
        logger.error(f"Error during AI validation pre-processing for file {original_filename}: {e}", exc_info=True)
        error_reason = f"Error during document processing/AI detection setup for AI validation: {str(e)}"
        ai_detection_result = AIDetectionResult(filename=original_filename, is_ai_generated=False, confidence=0.0, reason=error_reason, details={"gemini": {"score": 0.0, "text_assessment": "Error", "fabrication_concern": "N/A", "reason": error_reason}})

        if processed_doc_data_for_ai is None: # If DocumentService itself failed catastrophically before returning.
             processed_doc_data_for_ai = {"error": f"Document processing failed for {original_filename}: {str(e)}"}

        return file_content_bytes, original_filename, processed_doc_data_for_ai, ai_detection_result


async def generate_and_save_profile(candidate_info: Dict[str, Any], gemini_service: GeminiService) -> bool:

    candidate_id = candidate_info.get('candidateId')
    extracted_data_dict = candidate_info.get("extractedData", {}) # This will be the full DocumentService output
    entities_for_profile_generation: Optional[Dict[str, Any]] = None
    if isinstance(extracted_data_dict, dict):
        entities_for_profile_generation = extracted_data_dict.get("entities") 
    else:
        logger.error(f"generate_and_save_profile: extractedData for candidate {candidate_id} is not a dictionary. Cannot extract entities.")
    
    if not candidate_id:
        logger.warning("Missing candidateId in candidate_info for profile generation.")
        return False
    if not entities_for_profile_generation or not isinstance(entities_for_profile_generation, dict):
        logger.warning(f"No entities dictionary found or entities is not a dict in extractedData for candidate {candidate_id} to generate profile. ExtractedData: {extracted_data_dict}")
        return False 
    
    applicant_data_for_gemini = {"candidateId": candidate_id, "extractedText": entities_for_profile_generation}
    try:
        logger.info(f"Generating detailed profile for candidate {candidate_id}")
        detailed_profile = await gemini_service.generate_candidate_profile(applicant_data_for_gemini)
        if not detailed_profile or not isinstance(detailed_profile, dict) or "summary" not in detailed_profile:
             logger.warning(f"Failed to generate valid detailed profile for candidate {candidate_id}")
             return False
        update_payload = {"detailed_profile": detailed_profile}
        profile_update = CandidateUpdate(**update_payload)
        success = CandidateService.update_candidate(candidate_id, profile_update)
        if success:
            logger.info(f"Successfully generated and saved detailed profile for candidate {candidate_id}")
            return True
        else:
            logger.warning(f"Failed to save detailed profile for candidate {candidate_id}")
            return False
    except Exception as e:
        logger.error(f"Error generating profile for candidate {candidate_id}: {e}")
        return False

@router.post("/upload-job")
async def upload_job(
    job_data: str = Form(...),
    files: List[UploadFile] = File(...),
    force_upload_ai_flagged: Optional[str] = Form(None),
    user_time_zone: str = Form("UTC")
):
    try:
        job_details = json.loads(job_data)
        logger.info(f"Received job details: {job_details}")
        if not files:
            raise HTTPException(status_code=400, detail="No CV files provided for new job.")

        file_processing_inputs = []
        for file_in in files:
            content_bytes = await file_in.read()
            await file_in.seek(0)
            file_processing_inputs.append({
                "original_file_obj": file_in,
                "content_bytes": content_bytes
            })
        
        skip_ai_check_for_all_files = (force_upload_ai_flagged and force_upload_ai_flagged.lower() == "true")
        current_job_description = job_details.get("jobDescription", "")
        current_job_skills = job_details.get("requiredSkills", job_details.get("skills", []))

        if skip_ai_check_for_all_files:
            logger.info(f"AI content validation will be SKIPPED for all files for new job (force_upload_ai_flagged=true).")
        else:
            logger.info(f"Performing AI content validation for {len(file_processing_inputs)} files for new job...")
        
        ai_validation_tasks = []
        for item in file_processing_inputs:
            ai_validation_tasks.append(
                run_ai_validation_for_file(
                    file_content_bytes=item["content_bytes"],
                    original_filename=item["original_file_obj"].filename,
                    original_content_type=item["original_file_obj"].content_type or "application/pdf",
                    ai_detection_srv=ai_detection_service_instance,
                    doc_service_class=DocumentService,
                    skip_actual_ai_detection=skip_ai_check_for_all_files,
                    job_description_for_ai=current_job_description, 
                    job_skills_for_ai=current_job_skills 
                )
            )
        ai_validation_results_tuples = await asyncio.gather(*ai_validation_tasks)
        
        # This list will store dicts: {content_bytes, filename, content_type, pre_processed_doc_data, ai_result (optional)}
        files_data_for_candidate_creation = [] 
        ai_flagged_results_for_response: List[AIDetectionResult] = []

        for val_tuple in ai_validation_results_tuples:
            # f_processed_doc_data IS THE RESULT OF DocumentService.process_document
            f_content_bytes, f_orig_filename, f_processed_doc_data, f_ai_result = val_tuple 
            
            if not f_ai_result: # Should ideally not happen if run_ai_validation_for_file is robust
                logger.error(f"Critical error: Missing AI detection result for file {f_orig_filename}. Assuming non-AI.")
                f_ai_result = AIDetectionResult(filename=f_orig_filename, is_ai_generated=False, confidence=0.0, reason="Internal error during AI check")

            original_uploadfile_obj = next((item["original_file_obj"] for item in file_processing_inputs if item["original_file_obj"].filename == f_orig_filename), None)

            if not skip_ai_check_for_all_files and f_ai_result.is_ai_generated and f_ai_result.confidence >= AI_DETECTION_FLAG_THRESHOLD:
                logger.warning(f"File '{f_ai_result.filename}' for job '{job_details.get('jobTitle', 'N/A')}' flagged as AI-generated. Confidence: {f_ai_result.confidence:.2f}.")
                ai_flagged_results_for_response.append(f_ai_result)

            # Always add to files_data_for_candidate_creation, AI check is handled next.
            # This ensures pre_processed_doc_data is available if we proceed.
            if original_uploadfile_obj:
                 files_data_for_candidate_creation.append({
                    "content_bytes": f_content_bytes,
                    "filename": f_orig_filename,
                    "content_type": original_uploadfile_obj.content_type or "application/pdf",
                    "pre_processed_doc_data": f_processed_doc_data, # Store the processed data
                })
        
        if not skip_ai_check_for_all_files and ai_flagged_results_for_response:
            logger.info(f"AI content detected. Upload for job '{job_details.get('jobTitle', 'N/A')}' will be presented to user for confirmation.")
            raise HTTPException(status_code=422, detail={"message": "AI-generated content detected in one or more CVs.", "error_type": "AI_CONTENT_DETECTED", "flagged_files": [f_res.dict() for f_res in ai_flagged_results_for_response]})
            
        # --- STAGE 2: Job Creation ---
        skills = job_details.get("skills", [])
        required_skills = job_details.get("requiredSkills", skills) 
        minimum_cgpa = job_details.get("minimumCGPA")
        if minimum_cgpa == -1 or minimum_cgpa is None: minimum_cgpa = 0.0
        else:
            try: minimum_cgpa = float(minimum_cgpa)
            except (ValueError, TypeError): logger.warning(f"Invalid minimumCGPA value '{minimum_cgpa}', defaulting to 0.0."); minimum_cgpa = 0.0

        job_obj = JobCreate(jobTitle=job_details.get("jobTitle"), jobDescription=job_details.get("jobDescription", ""), departments=job_details.get("departments", []), minimumCGPA=minimum_cgpa, requiredSkills=required_skills)
        logger.info(f"Creating job with data: {job_obj.dict()}")
        job_id = JobService.create_job(job_obj)
        if not job_id: raise HTTPException(status_code=500, detail="Failed to create job")
        
        logger.info(f"Processing {len(files_data_for_candidate_creation)} files for candidate creation...")
        candidate_creation_tasks = []
        for file_data in files_data_for_candidate_creation: # This list now contains pre_processed_doc_data
            candidate_creation_tasks.append(
                _create_candidate_entry(
                    job_id_str=job_id,
                    file_content_val=file_data["content_bytes"],
                    file_name_val=file_data["filename"],
                    content_type_val=file_data["content_type"],
                    pre_processed_doc_data=file_data["pre_processed_doc_data"],
                    user_time_zone=user_time_zone
                )
            )
        created_candidate_results = await asyncio.gather(*candidate_creation_tasks)
        
        # Filter out None results or results indicating an error from _create_candidate_entry/create_candidate
        # Ensure that candidate_info for profile generation has 'candidateId' and 'extractedData'
        valid_candidates_info = []
        for res in created_candidate_results:
            if res and isinstance(res, dict) and 'candidateId' in res and 'extractedData' in res and not res.get("is_duplicate") and not res.get("error"):
                valid_candidates_info.append(res)
            elif res and res.get("is_duplicate"):
                logger.info(f"Skipping profile generation for duplicate candidate from file: {res.get('fileName', 'N/A')}")
            elif res and res.get("error"):
                 logger.error(f"Skipping profile generation due to candidate creation error for file: {res.get('fileName', 'N/A')}, error: {res.get('error')}")
            else:
                logger.warning(f"Invalid result from candidate creation, skipping: {res}")

        candidate_ids = [info['candidateId'] for info in valid_candidates_info]
        logger.info(f"Successfully created {len(candidate_ids)} candidates for new job {job_id}.")

        applications = []
        if valid_candidates_info: 
            applications = CandidateService.process_applications(job_id, valid_candidates_info)
        successful_apps_count = sum(1 for app in applications if app.get('success'))
        logger.info(f"Processed {successful_apps_count} applications for new job {job_id}.")
        
        if valid_candidates_info:
            logger.info(f"Generating detailed profiles concurrently for {len(valid_candidates_info)} candidates for new job {job_id}...")
            profile_generation_tasks = [
                generate_and_save_profile(cand_info, gemini_service) # cand_info contains 'extractedData'
                for cand_info in valid_candidates_info 
            ]
            profile_results = await asyncio.gather(*profile_generation_tasks)
            successful_profiles = sum(1 for pr in profile_results if pr is True)
            logger.info(f"Successfully generated and saved {successful_profiles} detailed profiles for new job {job_id}.")
        else:
            logger.warning("No valid candidates created (or all were duplicates/errors), skipping profile generation.")

        final_candidates_data = [CandidateService.get_candidate(cid) for cid in candidate_ids]
        final_candidates_data = [c for c in final_candidates_data if c] # Filter out None if any failed

        return JSONResponse(status_code=200, content={"message": "Job and applications processed successfully.", "jobId": job_id, "applicationCount": successful_apps_count, "applications": applications, "candidates": final_candidates_data, "candidateIds": candidate_ids, "progress": 100.0})
    except HTTPException as http_exc:
        raise http_exc
    except json.JSONDecodeError as json_e:
        logger.error(f"Invalid JSON in job_data for new job: {json_e}")
        raise HTTPException(status_code=400, detail=f"Invalid JSON format in job_data: {str(json_e)}")
    except Exception as e:
        logger.error(f"Error uploading new job: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"error": str(e), "type": str(type(e).__name__), "message": "An error occurred while processing your request for new job"})

@router.post("/upload-more-cv")
async def upload_more_cv(job_id: str = Form(...), 
                        files: List[UploadFile] = File(...), 
                        override_duplicates: bool = Form(False),
                        selected_filenames: Optional[str] = Form(None),
                        user_time_zone: str = Form("UTC"),
                        force_upload_ai_flagged: Optional[str] = Form(None)):
    
    logger.info(f"Uploading more CVs for job {job_id}, override_duplicates: {override_duplicates}")
    try:
        job = JobService.get_job(job_id)
        if not job: raise HTTPException(status_code=404, detail=f"Job with ID {job_id} not found")
        if not files: raise HTTPException(status_code=400, detail=f"No CV files provided for job {job_id}.")

        file_processing_inputs = []
        for file_in in files:
            content_bytes = await file_in.read(); await file_in.seek(0)
            file_processing_inputs.append({"original_file_obj": file_in, "content_bytes": content_bytes})

        skip_ai_check_for_all_files = (force_upload_ai_flagged and force_upload_ai_flagged.lower() == "true")
        current_job_description = job.get("jobDescription", ""); current_job_skills = job.get("requiredSkills", [])
        if skip_ai_check_for_all_files: logger.info(f"AI content validation will be SKIPPED for all additional CVs for job {job_id}.")
        else: logger.info(f"Performing AI content validation for {len(file_processing_inputs)} additional CVs for job {job_id}...")

        ai_validation_tasks = [
            run_ai_validation_for_file(item["content_bytes"], item["original_file_obj"].filename, item["original_file_obj"].content_type or "application/pdf", ai_detection_service_instance, DocumentService, skip_ai_check_for_all_files, current_job_description, current_job_skills)
            for item in file_processing_inputs
        ]
        ai_validation_results_tuples = await asyncio.gather(*ai_validation_tasks)

        files_for_duplicate_check = []; ai_flagged_results_for_response: List[AIDetectionResult] = []
        for val_tuple in ai_validation_results_tuples:
            f_content_bytes, f_orig_filename, f_processed_doc_data, f_ai_result = val_tuple
            if not f_ai_result:
                logger.error(f"Critical error: Missing AI result for {f_orig_filename} (job {job_id}). Assuming non-AI.")
                f_ai_result = AIDetectionResult(filename=f_orig_filename, is_ai_generated=False, confidence=0.0, reason="Internal error during AI check")
            original_uploadfile_obj = next((item["original_file_obj"] for item in file_processing_inputs if item["original_file_obj"].filename == f_orig_filename), None)
            if not skip_ai_check_for_all_files and f_ai_result.is_ai_generated and f_ai_result.confidence >= AI_DETECTION_FLAG_THRESHOLD:
                logger.warning(f"File '{f_ai_result.filename}' (job {job_id}) flagged as AI-generated. Confidence: {f_ai_result.confidence:.2f}.")
                ai_flagged_results_for_response.append(f_ai_result)
            
            if skip_ai_check_for_all_files or not (f_ai_result.is_ai_generated and f_ai_result.confidence >= AI_DETECTION_FLAG_THRESHOLD):
                if original_uploadfile_obj:
                    files_for_duplicate_check.append({"original_file_obj": original_uploadfile_obj, "content_bytes": f_content_bytes, "filename": f_orig_filename, "content_type": original_uploadfile_obj.content_type or "application/pdf", "extracted_data_from_ai_stage": f_processed_doc_data})
            # elif f_ai_result.is_ai_generated and f_ai_result.confidence >= AI_DETECTION_FLAG_THRESHOLD and not skip_ai_check_for_all_files: pass
            else: 
                 if original_uploadfile_obj: files_for_duplicate_check.append({"original_file_obj": original_uploadfile_obj, "content_bytes": f_content_bytes, "filename": f_orig_filename, "content_type": original_uploadfile_obj.content_type or "application/pdf", "extracted_data_from_ai_stage": f_processed_doc_data})

        if not skip_ai_check_for_all_files and ai_flagged_results_for_response:
            logger.info(f"AI content detected for additional CVs for job {job_id}. Presenting to user for confirmation.")
            raise HTTPException(status_code=422, detail={"message": "AI-generated content detected in one or more CVs.", "error_type": "AI_CONTENT_DETECTED", "flagged_files": [f_res.dict() for f_res in ai_flagged_results_for_response]})
        
        if skip_ai_check_for_all_files:
            files_for_duplicate_check = [] 
            for val_tuple in ai_validation_results_tuples:
                f_content_bytes, f_orig_filename, f_processed_doc_data, _ = val_tuple
                original_uploadfile_obj = next((item["original_file_obj"] for item in file_processing_inputs if item["original_file_obj"].filename == f_orig_filename), None)
                if original_uploadfile_obj: files_for_duplicate_check.append({"original_file_obj": original_uploadfile_obj, "content_bytes": f_content_bytes, "filename": f_orig_filename, "content_type": original_uploadfile_obj.content_type or "application/pdf", "extracted_data_from_ai_stage": f_processed_doc_data})

        parsed_selected_files_for_overwrite = []
        if selected_filenames:
            try: parsed_selected_files_for_overwrite = json.loads(selected_filenames); logger.info(f"Received {len(parsed_selected_files_for_overwrite)} selected filenames for overwriting: {parsed_selected_files_for_overwrite}")
            except Exception as e: logger.error(f"Error parsing selected_filenames: {e}")
        
        duplicates_found = []; non_duplicate_files_for_creation = []; updated_candidate_ids = []; updated_candidates_info_for_profile_gen = []
        for item_data in files_for_duplicate_check:
            try:
                file_name = item_data["filename"]; content_type = item_data["content_type"]; extracted_data = item_data["extracted_data_from_ai_stage"]; file_content_bytes_for_storage = item_data["content_bytes"]
                if not extracted_data: logger.error(f"Missing extracted data for file {file_name} after AI stage."); continue
                duplicate_check_result = CandidateService.check_duplicate_candidate(job_id, extracted_data)
                if duplicate_check_result["is_duplicate"]:
                    duplicate_candidate_details = duplicate_check_result.get("duplicate_candidate", {}); existing_candidate_id = duplicate_candidate_details.get("candidateId")
                    if override_duplicates and (not parsed_selected_files_for_overwrite or file_name in parsed_selected_files_for_overwrite):
                        logger.info(f"Overwriting candidate {existing_candidate_id} with file {file_name}")
                        new_file_id = str(uuid.uuid4()); file_extension = file_name.split('.')[-1] if '.' in file_name else 'pdf'; storage_path = f"resumes/{job_id}/{existing_candidate_id}/{new_file_id}.{file_extension}"
                        from core.firebase import firebase_client
                        download_url = firebase_client.upload_file(file_content_bytes_for_storage, storage_path, content_type)
                        if not download_url: logger.error(f"Failed to upload file to storage for overwriting candidate {existing_candidate_id}"); continue
                        now_iso = datetime.now().astimezone().isoformat()
                        update_payload = {'extractedText': extracted_data, 'resumeUrl': download_url, 'storagePath': storage_path, 'overwriteAt': now_iso, 'detailed_profile': None}
                        success = CandidateService.update_candidate(existing_candidate_id, CandidateUpdate(**update_payload))
                        if success: logger.info(f"Successfully updated candidate {existing_candidate_id}"); updated_candidate_ids.append(existing_candidate_id); updated_candidates_info_for_profile_gen.append({"candidateId": existing_candidate_id, "extractedData": extracted_data})
                        else: logger.error(f"Failed to update candidate {existing_candidate_id}")
                    else:
                        serialized_dup_info = serialize_firebase_data(duplicate_check_result)
                        duplicates_found.append({"fileName": file_name, "duplicateInfo": serialized_dup_info})
                else: non_duplicate_files_for_creation.append({"content_bytes": file_content_bytes_for_storage, "extractedData": extracted_data, "fileName": file_name, "contentType": content_type})
            except Exception as e: logger.error(f"Error during duplicate check for file {item_data.get('filename', 'N/A')}: {e}", exc_info=True)

        logger.info(f"Duplicate check completed. Found {len(duplicates_found)} duplicates and {len(non_duplicate_files_for_creation)} non-duplicates.")
        # logger.info(f"Duplicate candidates: {duplicates_found}") # Can be very verbose
        
        if duplicates_found and not override_duplicates:
            logger.info(f"Found {len(duplicates_found)} duplicate files and {len(non_duplicate_files_for_creation)} non-duplicate files. Not overriding.")
            response_content_409 = {"detail": "Duplicate candidates detected", "duplicates": duplicates_found, "nonDuplicateCount": len(non_duplicate_files_for_creation)}
            return JSONResponse(status_code=status.HTTP_409_CONFLICT, content=jsonable_encoder(response_content_409))

        newly_created_candidates_info = []; new_candidate_ids = []
        for file_data_for_creation in non_duplicate_files_for_creation:
            try:
                candidate_result_dict = CandidateService.create_candidate_from_data(
                    job_id=job_id, 
                    file_content=file_data_for_creation["content_bytes"], 
                    file_name=file_data_for_creation["fileName"], 
                    content_type=file_data_for_creation["contentType"], 
                    extracted_data=file_data_for_creation["extractedData"],
                    user_time_zone=user_time_zone 
                )
                if candidate_result_dict and candidate_result_dict.get('candidateId'):
                    newly_created_candidates_info.append(candidate_result_dict); new_candidate_ids.append(candidate_result_dict['candidateId'])
            except Exception as e: logger.error(f"Error creating candidate for {file_data_for_creation['fileName']}: {e}", exc_info=True)
        
        logger.info(f"Successfully created {len(new_candidate_ids)} new candidates for job {job_id}.")
        application_results = []
        if newly_created_candidates_info: application_results = CandidateService.process_applications(job_id, newly_created_candidates_info)
        successful_apps_count = sum(1 for app in application_results if app.get('success'))
        logger.info(f"Processed {successful_apps_count} new applications for job {job_id}.")

        all_candidates_for_profile_gen = newly_created_candidates_info + updated_candidates_info_for_profile_gen
        if all_candidates_for_profile_gen:
            logger.info(f"Generating detailed profiles for {len(all_candidates_for_profile_gen)} candidates (job {job_id})...")
            profile_generation_tasks = [generate_and_save_profile(cand_info, gemini_service) for cand_info in all_candidates_for_profile_gen]
            profile_results = await asyncio.gather(*profile_generation_tasks)
            successful_profiles = sum(1 for pr in profile_results if pr is True)
            logger.info(f"Successfully generated and saved {successful_profiles} detailed profiles for job {job_id}.")
        else: logger.warning(f"No new or updated candidates for profile generation (job {job_id}).")

        all_affected_candidate_ids = new_candidate_ids + updated_candidate_ids
        final_candidates_data_list = [CandidateService.get_candidate(cid) for cid in all_affected_candidate_ids if cid]
        final_candidates_data_list = [c for c in final_candidates_data_list if c]
        current_job_state = JobService.get_job(job_id)
        response_content_200 = {"success": True, "message": f"Successfully processed CVs. New: {len(new_candidate_ids)}, Updated: {len(updated_candidate_ids)}.", "jobId": job_id, "newApplicationCount": successful_apps_count, "updatedCandidateCount": len(updated_candidate_ids), "applications": application_results, "candidates": final_candidates_data_list, "candidateIds": all_affected_candidate_ids, "newCandidateIds": new_candidate_ids, "updatedCandidateIds": updated_candidate_ids, "totalApplications": current_job_state.get("applicationCount", 0) if current_job_state else job.get("applicationCount", 0) + successful_apps_count}
        return JSONResponse(status_code=200, content=jsonable_encoder(response_content_200))
            
    except HTTPException as http_exc: raise http_exc
    except Exception as e:
        logger.error(f"Error uploading additional CVs for job {job_id}: {e}", exc_info=True)
        error_content_500 = {"error": str(e), "type": str(type(e).__name__), "message": f"An error occurred while processing additional CVs for job {job_id}"}
        return JSONResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content=jsonable_encoder(error_content_500))

@router.post("/suggest-details", response_model=JobSuggestionResponse)
async def suggest_job_details(context: JobSuggestionContext = Body(...)):
    # ... (existing implementation)
    if not context.job_title:
        raise HTTPException(status_code=400, detail="Job Title is required to generate suggestions.")
    try:
        suggestions = await gemini_service.generate_job_details_suggestion(job_title=context.job_title, context=context.dict(exclude={'job_title'}))
        return JobSuggestionResponse(**suggestions)
    except HTTPException as http_exc: raise http_exc
    except Exception as e:
        logger.error(f"Error generating job details suggestions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate suggestions: {str(e)}")