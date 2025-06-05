from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form, Depends
from fastapi.responses import JSONResponse
from typing import List, Dict, Any, Optional
import logging
from google.cloud import firestore
from sqlalchemy.orm import Session
import uuid
from datetime import datetime

from models.candidate import CandidateResponse, CandidateUpdate
from services.job_service import JobService
from services.candidate_service import CandidateService
from services.gemini_service import GeminiService
from services.gemini_IVQuestionService import GeminiIVQuestionService
from services.document_service import DocumentService
from core.firebase import firebase_client

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/applicants")
async def get_applicants(jobId: str = Query(..., description="Job ID to get applicants for")):
    logger.info(f"Fetching applicants for jobId: {jobId}")
    try:
        applications = JobService.get_applications_for_job(jobId)
        return applications
    except Exception as e:
        logger.error(f"Error getting applicants: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get applicants: {str(e)}")

@router.get("/candidates")
async def get_candidates(jobId: str = Query(..., description="Job ID to fetch candidates for")):
    """
    Fetch candidates for a specific job ID.
    """
    logger.info(f"Fetching candidates for jobId: {jobId}")
    try:
        # Fetch applications for the job
        applications = JobService.get_applications_for_job(jobId)
        if not applications:
            logger.info(f"No applications found for jobId: {jobId}, returning empty list")
            return []  # Return empty list instead of 404 error

        # Fetch candidate details for each application
        candidates = []
        for app in applications:
            candidate = CandidateService.get_candidate(app["candidateId"])
            if candidate:
                candidates.append(candidate)

        logger.info(f"Fetched {len(candidates)} candidates for jobId: {jobId}")
        return candidates

    except Exception as e:
        logger.error(f"Error fetching candidates for jobId {jobId}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch candidates: {str(e)}")

@router.post("/rank")
async def rank_candidates(request: Dict[Any, Any]):
    logger.info("Ranking candidates with provided parameters")
    try:
        prompt = request.get("prompt")
        applicants = request.get("applicants")
        job_document = request.get("job_document")
        
        if not prompt or not applicants or not job_document:
            raise HTTPException(status_code=400, detail="Prompt, applicants, and job_document are required")
        
        if len(applicants) > 10:
            logger.info(f"Large applicant set detected ({len(applicants)} applicants). Using optimized processing.")
            
        # Create an instance of RankGeminiService
        rank_service = GeminiService()
        
        # Rank the applicants
        ranked_result = await rank_service.rank_applicants(prompt, applicants, job_document)

        # Log the number of ranked candidates
        logger.info(f"Successfully ranked {len(ranked_result['applicants'])} candidates")
        
        return ranked_result
    except Exception as e:
        logger.error(f"Error ranking candidates: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to rank candidates: {str(e)}")
    
@router.post("/ranks")
async def rank_new_candidates(request: Dict[Any, Any]):
    logger.info("Ranking candidates with provided parameters")
    try:
        weights = request.get("weights")
        applicants = request.get("applicants")
        job_document = request.get("job_document")

        if not weights or not applicants:
            raise HTTPException(status_code=400, detail="Rank weight and applicants are required")
        
        # Create an instance of RankGeminiService
        rank_service = GeminiService()
        
        # Rank the applicants
        ranked_result = await rank_service.rank_applicants_with_weights(weights, applicants, job_document)

        # Log the number of ranked candidates
        logger.info(f"Successfully ranked new {len(ranked_result['applicants'])} candidates")
        
        return ranked_result
    except Exception as e:
        logger.error(f"Error ranking candidates: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to rank candidates: {str(e)}")
    
@router.put("/candidate/{candidate_id}")
async def update_candidate(candidate_id: str, candidate_data: Dict[Any, Any]):
    """Update a candidate."""
    try:
        # Extract job_id from candidate data if it exists
        job_id = candidate_data.pop("job_id", None)
        if job_id:
            logger.info(f"Extracted job_id: {job_id} from candidate data")

        # Check if we're adding a new candidate without a detailed profile
        should_generate_profile = False
        if "detailed_profile" not in candidate_data or not candidate_data.get("detailed_profile"):
            logger.info(f"No detailed profile found for candidate {candidate_id}, will generate after update")
            should_generate_profile = True

        # Convert candidate_data to CandidateUpdate model
        candidate_update = CandidateUpdate(**candidate_data)

        # Update the candidate
        success = CandidateService.update_candidate(candidate_id, candidate_update)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update candidate")
        
        # If this is a new candidate without a detailed profile, generate one automatically
        updated_candidate = None
        if should_generate_profile:
            try:
                logger.info(f"Automatically generating detailed profile for candidate {candidate_id}")
                # Get the candidate data first
                candidate = CandidateService.get_candidate(candidate_id)
                if not candidate:
                    logger.error(f"Could not find candidate {candidate_id} for profile generation")
                else:
                    # Create an instance of GeminiService
                    gemini_service = GeminiService()
                    
                    # Generate the detailed profile - this is asynchronous
                    detailed_profile = await gemini_service.generate_candidate_profile(candidate)
                    
                    # Update the candidate with the detailed profile
                    candidate["detailed_profile"] = detailed_profile
                    profile_update = CandidateUpdate(**candidate)
                    CandidateService.update_candidate(candidate_id, profile_update)
                    logger.info(f"Successfully generated and saved detailed profile for candidate {candidate_id}")
            except Exception as e:
                logger.error(f"Error generating detailed profile during update: {e}")
                # Continue with the update even if profile generation fails
        
        # Function get_candidate has some issue earlier, so resort to second plan
        # Get the updated candidate
        if job_id:
            # Get all applicants for the job
            applications = JobService.get_applications_for_job(job_id)
            # Find the specific candidate in the applications
            updated_candidate = next((app for app in applications if app.get("candidateId") == candidate_id), None)
            if not updated_candidate:
                logger.warn(f"Updated candidate {candidate_id} not found in job {job_id}")
                # Try to get the candidate directly instead
                updated_candidate = CandidateService.get_candidate(candidate_id)
        else:
            # If no job_id is provided, get the candidate directly
            updated_candidate = CandidateService.get_candidate(candidate_id)
            
        if not updated_candidate:
            logger.error(f"Updated candidate {candidate_id} not found")
            raise HTTPException(status_code=404, detail=f"Updated candidate {candidate_id} not found")
            
        return updated_candidate
    except Exception as e:
        logger.error(f"Error updating candidate: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update candidate: {str(e)}")
    
@router.get("/detail/{candidate_id}")
async def get_candidate_detail(candidate_id: str, job_id: str = None, force: bool = False):
    """Get detailed profile for a candidate using Gemini."""
    try:
        logger.info(f"Generating detailed profile for candidate: {candidate_id}, job_id: {job_id}, force: {force}")
        
        # Check if candidate exists
        candidate = CandidateService.get_candidate(candidate_id)
        if not candidate:
            raise HTTPException(status_code=404, detail=f"Candidate {candidate_id} not found")
        
        # Get job info for the candidate's application - improved job finding logic
        job_description = None
        job_info = {}
        
        # Try to get job from the query parameter first
        if job_id:
            logger.info(f"Using provided job_id: {job_id} to find job description")
            job = JobService.get_job(job_id)
            if job and "jobDescription" in job:
                job_description = job["jobDescription"]
                job_info["title"] = job.get("title", "")
                job_info["company"] = job.get("company", "")
                logger.info(f"Found job description from provided job_id for candidate {candidate_id}")
        
        # If no job_description yet, try to find from application
        if not job_description and candidate.get("applicationId"):
            application = JobService.get_application(candidate.get("applicationId"))
            if application and application.get("jobId"):
                job = JobService.get_job(application.get("jobId"))
                if job and "jobDescription" in job:
                    job_description = job["jobDescription"]
                    job_info["title"] = job.get("title", "")
                    job_info["company"] = job.get("company", "")
                    logger.info(f"Found job description from application for candidate {candidate_id}")
        
        # If still no job_description, try to find from recent applications
        if not job_description:
            # Get all applications for this candidate
            applications = JobService.get_candidate_applications(candidate_id)
            if applications and len(applications) > 0:
                # Use the most recent application
                recent_app = applications[0]  # Assuming applications are sorted by recency
                if recent_app.get("jobId"):
                    job = JobService.get_job(recent_app["jobId"])
                    if job and "jobDescription" in job:
                        job_description = job["jobDescription"]
                        job_info["title"] = job.get("title", "")
                        job_info["company"] = job.get("company", "")
                        logger.info(f"Found job description from recent applications for candidate {candidate_id}")
        
        # Add job description to candidate data for relevance analysis
        if job_description:
            candidate["job_description"] = job_description
            candidate["job_info"] = job_info
            logger.info(f"Job description added to candidate data for relevance analysis (length: {len(job_description)})")
        else:
            logger.warning(f"No job description found for candidate {candidate_id} - relevance analysis will be skipped")
        
        # Check if candidate already has a detailed profile and force is not True
        if candidate.get("detailed_profile") and not force:
            logger.info(f"Candidate {candidate_id} already has a detailed profile, returning existing data")
            
            # Check if existing profile has relevance analysis
            has_relevance = "relevance_analysis" in candidate["detailed_profile"]
            if not has_relevance and job_description:
                logger.info("Existing profile doesn't have relevance analysis, but we have a job description. Adding relevance analysis...")
                # Create an instance of GeminiService
                gemini_service = GeminiService()
                
                if relevance_data:
                    candidate["detailed_profile"]["relevance_analysis"] = relevance_data
                    # Update the candidate with the enhanced profile
                    profile_update = CandidateUpdate(**candidate)
                    success = CandidateService.update_candidate(candidate_id, profile_update)
                    if success:
                        logger.info(f"Added relevance analysis to existing profile for candidate {candidate_id}")
                    else:
                        logger.warning(f"Failed to save profile with new relevance analysis for candidate {candidate_id}")
            
            return {"candidate_id": candidate_id, "detailed_profile": candidate["detailed_profile"]}
        
        # Create an instance of GeminiService
        gemini_service = GeminiService()
        
        # Generate the detailed profile
        detailed_profile = await gemini_service.generate_candidate_profile(candidate)
        
        # Check if relevance analysis was performed
        if "relevance_analysis" in detailed_profile:
            logger.info(f"Relevance analysis completed with {sum(len(cat) for cat in detailed_profile['relevance_analysis'].values() if isinstance(cat, list))} items analyzed")
            relevant_count = 0
            for category, items in detailed_profile["relevance_analysis"].items():
                if isinstance(items, list):
                    for item in items:
                        if item.get("relevant") == True:
                            relevant_count += 1
            logger.info(f"Found {relevant_count} relevant items across all categories")
        else:
            logger.warning("No relevance analysis was performed - check job description availability")
        
        # Update the candidate record with the generated profile
        try:
            candidate["detailed_profile"] = detailed_profile
            profile_update = CandidateUpdate(**candidate)
            success = CandidateService.update_candidate(candidate_id, profile_update)
            if success:
                logger.info(f"Successfully saved detailed profile for candidate {candidate_id}")
            else:
                logger.warning(f"Failed to save detailed profile for candidate {candidate_id}")
        except Exception as e:
            logger.error(f"Error saving detailed profile: {e}")
            # Continue even if saving fails - we'll still return the generated profile
        
        logger.info(f"Successfully generated detailed profile for candidate {candidate_id}")
        return {"candidate_id": candidate_id, "detailed_profile": detailed_profile}
        
    except Exception as e:
        logger.error(f"Error generating candidate detail: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate candidate detail: {str(e)}")

@router.get("/generate-interview-questions/{candidate_id}")
async def generate_interview_questions(candidate_id: str, job_id: str = Query(..., description="Job ID to generate questions for")):
    """Generate AI interview questions for a candidate based on their resume and job details."""
    try:
        logger.info(f"Generating interview questions for candidate: {candidate_id} for job: {job_id}")
        
        # Check if candidate exists
        candidate = CandidateService.get_candidate(candidate_id)
        if not candidate:
            raise HTTPException(status_code=404, detail=f"Candidate {candidate_id} not found")
        
        # Check if job exists
        job = JobService.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        
        # Create an instance of GeminiIVQuestionService
        iv_question_service = GeminiIVQuestionService()
        
        # Generate the interview questions
        interview_questions = await iv_question_service.generate_interview_questions(candidate_id, job_id)
        
        logger.info(f"Successfully generated interview questions for candidate {candidate_id}")
        return interview_questions
        
    except Exception as e:
        logger.error(f"Error generating interview questions: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate interview questions: {str(e)}")

@router.post("/generate-interview-question")
async def generate_interview_question(request: Dict[str, Any]):
    """Generate a single interview question for a specific candidate, job, and section."""
    try:
        logger.info(f"Generating a single interview question with request: {request}")
        
        # Extract required fields
        candidate_id = request.get("candidateId")
        job_id = request.get("jobId")
        section_title = request.get("sectionTitle")
        
        # Validate request
        if not candidate_id:
            raise HTTPException(status_code=400, detail="candidateId is required")
        if not job_id:
            raise HTTPException(status_code=400, detail="jobId is required")
        if not section_title:
            raise HTTPException(status_code=400, detail="sectionTitle is required")
        
        # Skip candidate validation for "all" or "generic" candidate IDs
        if candidate_id not in ["all", "generic"]:
            # Check if candidate exists
            candidate = CandidateService.get_candidate(candidate_id)
            if not candidate:
                raise HTTPException(status_code=404, detail=f"Candidate {candidate_id} not found")
        
        # Check if job exists
        job = JobService.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        
        # Create an instance of GeminiIVQuestionService
        iv_question_service = GeminiIVQuestionService()
        
        # Generate a single interview question
        result = await iv_question_service.generate_interview_question(
            candidate_id=candidate_id,
            job_id=job_id,
            section_title=section_title
        )
        
        logger.info(f"Successfully generated interview question for candidate {candidate_id}, section {section_title}")
        return result
        
    except Exception as e:
        logger.error(f"Error generating interview question: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate interview question: {str(e)}")
    
@router.get("/candidate/{candidate_id}")
async def get_candidate(candidate_id: str):
    """Get a candidate by ID."""
    try:
        logger.info(f"Fetching candidate {candidate_id}")
        candidate = CandidateService.get_candidate(candidate_id)
        if not candidate:
            raise HTTPException(status_code=404, detail=f"Candidate {candidate_id} not found")
        return candidate
    except Exception as e:
        logger.error(f"Error fetching candidate {candidate_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch candidate: {str(e)}")
    
@router.put("/update-status/{application_id}")
async def update_application_status(application_id: str, status_data: Dict[str, Any]):
    """Update the status of an application and candidate."""
    try:
        status = status_data.get("status")
        if not status:
            raise HTTPException(status_code=400, detail="Status is required")
        
        # Update application status
        success = JobService.update_application_status(application_id, status)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update application status")
        
        # Get the candidate ID from the application
        application = JobService.get_application(application_id)
        if not application:
            raise HTTPException(status_code=404, detail="Application not found")
        
        candidate_id = application.get("candidateId")
        if not candidate_id:
            raise HTTPException(status_code=400, detail="Candidate ID not found in application")
        
        # Update candidate status
        success = CandidateService.update_candidate_status(candidate_id, status)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update candidate status")
        
        return {"message": "Application and candidate status updated successfully"}
    except Exception as e:
        logger.error(f"Error updating application status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update application status: {str(e)}")

@router.get("/match-percentage/{candidate_id}")
async def get_match_percentage(candidate_id: str):
    """Fetch the match percentage and related data for a candidate."""
    try:
        db = firestore.Client()
        doc_ref = db.collection("temp_match_data").document(candidate_id)
        doc = doc_ref.get()

        if not doc.exists:
            # Return default values if no match data found
            return {
                "match_percentage": 0.0,
                "confidence": 0.0,
                "duplicate_type": "UNKNOWN"
            }

        match_data = doc.to_dict()
        return {
            "match_percentage": match_data.get("match_percentage", 0.0),
            "confidence": match_data.get("confidence", 0.0),
            "duplicate_type": match_data.get("duplicate_type", "UNKNOWN")
        }
    except Exception as e:
        logger.error(f"Error fetching match percentage for candidate {candidate_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch match percentage: {str(e)}")

@router.post("/rerank")
async def rerank_candidates(request: Dict[str, Any]):
    """
    Re-rank candidates based on updated criteria or job details.
    """
    logger.info("Re-ranking candidates with provided parameters")
    try:
        candidate_ids = request.get("candidateIds")
        job_id = request.get("jobId")

        if not candidate_ids or not job_id:
            raise HTTPException(status_code=400, detail="candidateIds and jobId are required")

        # Fetch job details
        job = JobService.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

        job_description = job.get("jobDescription")
        if not job_description:
            raise HTTPException(status_code=400, detail="Job description is required for re-ranking")

        # Fetch candidates
        candidates = [CandidateService.get_candidate(candidate_id) for candidate_id in candidate_ids]
        candidates = [candidate for candidate in candidates if candidate]  # Filter out None values

        if not candidates:
            raise HTTPException(status_code=404, detail="No valid candidates found for re-ranking")

        # Create an instance of GeminiService
        gemini_service = GeminiService()

        # Re-rank the candidates
        ranked_result = await gemini_service.rank_applicants(
            prompt="Re-rank candidates based on updated job criteria",
            applicants=candidates,
            job_document={"jobDescription": job_description}
        )

        logger.info(f"Successfully re-ranked {len(ranked_result['applicants'])} candidates")
        return ranked_result

    except Exception as e:
        logger.error(f"Error re-ranking candidates: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to re-rank candidates: {str(e)}")

@router.post("/overwrite")
async def overwrite_candidate(candidate_id: str = Form(...), job_id_form: str = Form(...), new_cv: UploadFile = File(...)):
    """
    Overwrite a specific candidate's data with a new CV.
    """
    logger.info(f"Received request to overwrite candidate {candidate_id} for job {job_id_form} with new CV: {new_cv.filename}")
    try:
        # Validate inputs
        if not candidate_id:
            raise HTTPException(status_code=400, detail="candidate_id is required")
        if not job_id_form:
            raise HTTPException(status_code=400, detail="job_id_form is required")
        if not new_cv:
            raise HTTPException(status_code=400, detail="new_cv is required")

        # Step 1: Process the new CV
        file_content = await new_cv.read()
        content_type = new_cv.content_type
        if not file_content or not content_type:
            raise HTTPException(status_code=400, detail="Invalid file content or content type")

        extracted_data = DocumentService.process_document(file_content, content_type, new_cv.filename)
        if not extracted_data:
            raise HTTPException(status_code=400, detail="Failed to process the new CV")

        # Step 2: Upload the new CV
        file_extension = new_cv.filename.split('.')[-1] if '.' in new_cv.filename else 'pdf'
        file_id = str(uuid.uuid4())
        storage_path = f"resumes/{job_id_form}/{candidate_id}/{file_id}.{file_extension}"
        resume_url = firebase_client.upload_file(file_content, storage_path, content_type)
        if not resume_url:
            raise HTTPException(status_code=500, detail="Failed to upload the new CV")

        overwrite_at_iso = datetime.now().astimezone().isoformat() 

        update_data = {
            "extractedText": extracted_data,
            "resumeUrl": resume_url,
            "overwriteAt": overwrite_at_iso,
            "storagePath": storage_path,
            "detailed_profile": None
        }

        # Update the candidate with the new CV
        if not CandidateService.update_candidate(candidate_id, CandidateUpdate(**update_data)):
            raise HTTPException(status_code=500, detail="Failed to update candidate with new CV")

        logger.info(f"Successfully updated candidate {candidate_id} with new CV")

        # Step 3: Trigger re-evaluation
        candidate_data = CandidateService.get_candidate(candidate_id)
        if not candidate_data or not isinstance(candidate_data, dict):
            raise HTTPException(status_code=500, detail="Failed to fetch updated candidate data")

        job_data = JobService.get_job(job_id_form)
        job_description = job_data.get("jobDescription") if job_data else None
        if job_description:
            candidate_data["job_description"] = job_description

        gemini_service = GeminiService()
        detailed_profile = await gemini_service.generate_candidate_profile(candidate_data)

        # Update the candidate with the new profile
        if not CandidateService.update_candidate(candidate_id, CandidateUpdate(detailed_profile=detailed_profile)):
            raise HTTPException(status_code=500, detail="Failed to update candidate with detailed profile")

        logger.info(f"Re-evaluation complete for candidate {candidate_id}")
        return {"message": f"Candidate {candidate_id} successfully overwritten and re-evaluated"}

    except HTTPException as he:
        logger.error(f"HTTPException: {he.detail}")
        raise he
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to overwrite candidate: {str(e)}")

@router.get("/overwrite-target")
async def get_overwrite_target(job_id: str = Query(..., description="Job ID to fetch overwrite target for")):
    """
    Retrieve the overwrite target for a specific job.
    """
    try:
        logger.info(f"Fetching overwrite target for job_id: {job_id}")
        overwrite_target = CandidateService.get_overwrite_target(job_id)
        if not overwrite_target:
            logger.warning(f"No overwrite target found for job_id: {job_id}")
            raise HTTPException(status_code=404, detail="No overwrite target found for the specified job ID")
        logger.info(f"Overwrite target found: {overwrite_target}")
        return {"candidate_id": overwrite_target}
    except Exception as e:
        logger.error(f"Error retrieving overwrite target for job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve overwrite target")