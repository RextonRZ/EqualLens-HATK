import asyncio
import functools
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import smtplib
from fastapi import APIRouter, HTTPException, Depends, Body, Query, Path, Form
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import uuid
import logging
import os
import tempfile
import base64
import numpy as np
import speech_recognition as sr
import nltk
from nltk.tokenize import word_tokenize
from models.interview import (
    InterviewQuestion, GenerateInterviewLinkRequest, InterviewLinkResponse, 
    IdentityVerificationRequest, IdentityVerificationResponse, SchedulePhysicalInterviewRequest,
    InterviewResponseRequest, InterviewResponseResponse, InterviewResponseSubmitMetadataRequest, GenerateUploadUrlRequest
)
from services.interview_service import (
    get_db, get_storage, validate_interview_link, score_response_xai,
    send_interview_email, generate_link_code, send_rejection_email, transcribe_audio_with_google_cloud, extract_audio_with_ffmpeg, apply_voice_effect,
    score_response, check_content_bias, analyze_video_expressions_mediapipe, send_physical_interview_email, send_job_offer_email, censor_transcript_text, apply_audio_bleeps
)
from services.face_verification import process_verification_image_with_name_check
from firebase_admin import firestore

from services.gemini_service import GeminiService

# Setup logging
logger = logging.getLogger(__name__)

# Initialize router
router = APIRouter()

# Disable parallelism for tokenizers to avoid issues with multiprocessing
os.environ["TOKENIZERS_PARALLELISM"] = "false"

# Constants
LINK_EXPIRY_DAYS = 3  # Number of days the interview link remains valid
INTERVIEW_BASE_URL = "http://localhost:3001/interview"  # Base URL for frontend interview page

# Update the generate_interview_link function to check application status
@router.post("/generate-link", response_model=InterviewLinkResponse)
async def generate_interview_link(
    request: GenerateInterviewLinkRequest,
    db: firestore.Client = Depends(get_db)
):
    """Generate a unique interview link for a candidate and send email notification"""
    try:
        # Verify that application exists
        application_ref = db.collection('applications').document(request.applicationId)
        application_doc = application_ref.get()
        
        if not application_doc.exists:
            raise HTTPException(status_code=404, detail="Application not found")
        
        # Get application data
        application_data = application_doc.to_dict()
        
        # Check application status to prevent duplicate actions
        current_status = application_data.get('status', '').lower()
        
        # If already rejected, don't allow scheduling interview
        if current_status == 'rejected':
            raise HTTPException(status_code=400, detail="This application has already been rejected")
            
        # If interview already completed, don't allow scheduling another
        if current_status == 'interview completed':
            raise HTTPException(status_code=400, detail="This candidate has already completed their interview")
            
        # Check if interview is already scheduled for this application
        if current_status == 'interview scheduled':
            # If there's an existing interview link, return it instead of creating a new one
            if application_data.get('interview', {}).get('interviewLink'):
                existing_link = application_data['interview']['interviewLink']
                interview_id = existing_link.split('/')[-2]  # Extract ID from the link
                link_code = existing_link.split('/')[-1]     # Extract code from the link
                
                # Find the existing interview document
                interview_docs = db.collection('interviewLinks').where('interviewId', '==', interview_id).limit(1).get()
                if len(interview_docs) > 0:
                    interview_data = interview_docs[0].to_dict()
                    return InterviewLinkResponse(
                        interviewId=interview_id,
                        linkCode=link_code,
                        fullLink=existing_link,
                        expiryDate=interview_data.get('expiryDate'),
                        applicationId=request.applicationId,
                        candidateId=request.candidateId,
                        emailStatus='previously_sent'
                    )
                    
        # Get job details for email
        job_id = application_data.get('jobId', request.jobId)
        job_ref = db.collection('jobs').document(job_id)
        job_doc = job_ref.get()
        
        if not job_doc.exists:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job_data = job_doc.to_dict()
        job_title = job_data.get('jobTitle', 'Unknown Position')
        
        # Get candidate details
        candidate_id = application_data.get('candidateId', request.candidateId)
        candidate_ref = db.collection('candidates').document(candidate_id)
        candidate_doc = candidate_ref.get()
        
        if not candidate_doc.exists:
            raise HTTPException(status_code=404, detail="Candidate not found")
        
        candidate_data = candidate_doc.to_dict()
        candidate_name = f"{candidate_data.get('firstName', '')}"
        
        # Try to get name from extracted text if firstName not available
        if not candidate_name.strip() and 'extractedText' in candidate_data:
            candidate_name = candidate_data['extractedText'].get('applicant_name', 'Candidate')
        
        # Generate unique interview ID and link code
        interview_id = str(uuid.uuid4())
        link_code = generate_link_code(request.applicationId, candidate_id)
        
        # Set expiry date - always 3 days from now
        expiry_date = datetime.utcnow() + timedelta(days=LINK_EXPIRY_DAYS)
        
        # Create full interview link
        full_link = f"{INTERVIEW_BASE_URL}/{interview_id}/{link_code}"
        
        # Always set scheduled date to now + 7 days (to match expiry)
        scheduled_date = datetime.utcnow() + timedelta(days=LINK_EXPIRY_DAYS)
        
        # Update application with interview information - matching the database structure
        application_ref.update({
            'status': 'interview scheduled',
            'interview': {
                'scheduledDate': scheduled_date,
                'interviewLink': full_link,
                'icVerificationImage': None,  # Will be updated during verification
                'verificationStatus': False
            }
        })
        
        # Create interview link document for validation
        interview_link_data = {
            'interviewId': interview_id,
            'linkCode': link_code,
            'applicationId': request.applicationId,
            'candidateId': candidate_id,
            'jobId': job_id,
            'email': request.email or candidate_data.get('extractedText', {}).get('applicant_mail', ''),
            'fullLink': full_link,
            'expiryDate': expiry_date,
            'createdAt': datetime.utcnow(),
            'status': 'pending',  # pending, completed, expired
            'scheduledDate': scheduled_date
        }
        
        db.collection('interviewLinks').document(interview_id).set(interview_link_data)
        
        # Create email notification record
        notification_id = str(uuid.uuid4())
        notification_data = {
            'candidateId': candidate_id,
            'applicationId': request.applicationId,
            'type': 'interview_invitation',
            'sentDate': datetime.utcnow(),
            'content': f"Interview invitation for {job_title}",
            'status': 'pending'
        }
        
        db.collection('emailNotifications').document(notification_id).set(notification_data)
        
        # Get the email address - try the request first, then fallback to candidate data
        email_address = request.email
        if not email_address:
            email_address = candidate_data.get('extractedText', {}).get('applicant_mail')
            if not email_address:
                logger.warning(f"No email address found for candidate {candidate_id}")
                # Create a default placeholder to avoid errors
                email_address = "no-email-provided@placeholder.com"
        
        # Send email
        email_sent = send_interview_email(
            email_address,
            candidate_name,
            job_title,
            full_link,
            scheduled_date
        )
        
        # Update notification status
        email_status = 'sent' if email_sent else 'failed'
        db.collection('emailNotifications').document(notification_id).update({
            'status': email_status
        })
        
        # Return response
        return InterviewLinkResponse(
            interviewId=interview_id,
            linkCode=link_code,
            fullLink=full_link,
            expiryDate=expiry_date,
            applicationId=request.applicationId,
            candidateId=candidate_id,
            emailStatus=email_status
        )
    
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Error generating interview link: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate interview link: {str(e)}")
    
@router.post("/reject")
async def reject_candidate(request_data: Dict[Any, Any] = Body(...)):
    """Reject a candidate and send rejection email"""
    try:
        application_id = request_data.get("applicationId")
        candidate_id = request_data.get("candidateId")
        job_id = request_data.get("jobId")
        email = request_data.get("email")
        
        if not application_id or not candidate_id or not job_id:
            raise HTTPException(status_code=400, detail="Missing required fields")
        
        # Check if application already has a status that would prevent rejection
        from core.firebase import firebase_client
        application_data = firebase_client.get_document('applications', application_id)
        
        if not application_data:
            raise HTTPException(status_code=404, detail="Application not found")
            
        current_status = application_data.get('status', '').lower()
        
        # If already rejected, don't allow another rejection
        if current_status == 'rejected':
            raise HTTPException(status_code=400, detail="This application has already been rejected")
            
        # If interview already completed, don't allow rejection
        if current_status == 'interview completed':
            raise HTTPException(status_code=400, detail="This candidate has already completed their interview")
        
        # Get job details for email
        from services.job_service import JobService
        job = JobService.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job_title = job.get('jobTitle', 'the position')
        
        # Get candidate details
        from services.candidate_service import CandidateService
        candidate = CandidateService.get_candidate(candidate_id)
        if not candidate:
            raise HTTPException(status_code=404, detail="Candidate not found")
        
        extracted_text = candidate.get('extractedText', {})
        candidate_name = extracted_text.get('applicant_name', 'Candidate')
        
        # Update application status to 'rejected'
        firebase_client.update_document('applications', application_id, {
            'status': 'rejected',
            'rejectedAt': datetime.now().isoformat()
        })
        
        # Send rejection email
        email_sent = send_rejection_email(
            email,
            candidate_name,
            job_title
        )
        
        # Create email notification record
        notification_id = str(uuid.uuid4())
        notification_data = {
            'candidateId': candidate_id,
            'applicationId': application_id,
            'type': 'rejection',
            'sentDate': datetime.now().isoformat(),
            'content': f"Rejection email for {job_title}",
            'status': 'sent' if email_sent else 'failed'
        }
        
        firebase_client.create_document('emailNotifications', notification_id, notification_data)
        
        return {
            "success": True,
            "message": "Candidate rejected successfully",
            "emailSent": email_sent
        }
    
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error("Error rejecting candidate: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to reject candidate: {str(e)}")

@router.get("/validate/{interview_id}/{link_code}")
async def validate_interview(
    interview_id: str = Path(..., description="The interview ID"),
    link_code: str = Path(..., description="The interview link code"),
    db: firestore.Client = Depends(get_db)
):
    """Validate an interview link and return basic information"""
    try:
        # Validate the link
        interview_data = validate_interview_link(interview_id, link_code, allow_resumption=True)
        
        # Get application details
        application_ref = db.collection('applications').document(interview_data.get('applicationId'))
        application_doc = application_ref.get()
        
        if not application_doc.exists:
            raise HTTPException(status_code=404, detail="Application not found")
        
        application_data = application_doc.to_dict()
        
        # Get job details
        job_id = interview_data.get('jobId')
        job_ref = db.collection('jobs').document(job_id)
        job_doc = job_ref.get()
        
        if not job_doc.exists:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job_data = job_doc.to_dict()
        
        # Get candidate details (minimal info for privacy)
        candidate_id = interview_data.get('candidateId')
        candidate_ref = db.collection('candidates').document(candidate_id)
        candidate_doc = candidate_ref.get()
        
        if not candidate_doc.exists:
            raise HTTPException(status_code=404, detail="Candidate not found")
        
        candidate_data = candidate_doc.to_dict()

        last_question_id = None
        if interview_data['current_status'] == 'in_progress':
            responses_doc = db.collection('interviewResponses').document(interview_data['applicationId']).get()
            if responses_doc.exists:
                responses_data = responses_doc.to_dict()
                questions_answered = responses_data.get('questions', [])
                if questions_answered:
                    last_question_id = questions_answered[-1].get('questionId')

        # Return the relevant information
        return {
            "valid": True,
            "interviewId": interview_id,
            "applicationId": interview_data.get('applicationId'),  # Added for frontend use
            "candidateId": candidate_id,
            "candidateName": f"{candidate_data.get('firstName', '')} {candidate_data.get('lastName', '')}".strip() or candidate_data.get(
                'extractedText', {}).get('applicant_name', 'Candidate'),
            "jobTitle": job_data.get('jobTitle', 'Unknown Position'),
            "verificationRequired": True,  # Assuming verification is always required
            "verificationCompleted": application_data.get('interview', {}).get('verificationStatus', False),
            "expiryDate": interview_data.get('expiryDate'),
            "currentStatus": interview_data['current_status'],  # Let frontend know the status
            "lastCompletedQuestionId": last_question_id  # For resumption
        }

    except HTTPException as he:
        # Log specific HTTP exceptions if needed
        logger.warning(f"Validation failed for {interview_id}/{link_code}: {he.detail}")
        raise he  # Re-raise HTTP exceptions
    except Exception as e:
        logger.error(f"Error validating interview link {interview_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to validate interview link.")

@router.post("/verify-identity")
async def verify_identity(
    request: IdentityVerificationRequest,
    db: firestore.Client = Depends(get_db),
    storage_bucket = Depends(get_storage)
):
    """Process ID verification with selfie and ID card in one image using Google Cloud Vision API"""
    try:
        # Validate the interview link
        interview_data = validate_interview_link(request.interviewId, request.linkCode, allow_resumption=True)
        
        # Get application ID from interview data
        application_id = interview_data.get('applicationId')
        candidate_id = interview_data.get('candidateId')

        candidate_ref = db.collection('candidates').document(candidate_id)
        candidate_doc = candidate_ref.get()
        if not candidate_doc.exists:
            raise HTTPException(status_code=404, detail="Candidate data not found for verification.")
        candidate_data = candidate_doc.to_dict()
        # Prioritize structured name fields if they exist
        db_candidate_name = f"{candidate_data.get('firstName', '')} {candidate_data.get('lastName', '')}".strip()
        if not db_candidate_name:
            db_candidate_name = candidate_data.get('extractedText', {}).get('applicant_name', '').strip()

        if not db_candidate_name:
            logger.warning(f"Could not find candidate name in DB for {candidate_id}")
            # Decide policy: fail verification or proceed without name check?
            # Proceeding without name check for now, but log it.
            db_candidate_name = None

        # Decode base64 image
        import base64
        from io import BytesIO
        
        # Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
        if ',' in request.identificationImage:
            image_data = request.identificationImage.split(',')[1]
        else:
            image_data = request.identificationImage
        
        image_bytes = base64.b64decode(image_data)
        
        # Upload original image to Firebase Storage
        storage_path = f"verification/{application_id}/{request.interviewId}.jpg"
        blob = storage_bucket.blob(storage_path)
        blob.upload_from_string(image_bytes, content_type="image/jpeg")
        blob.make_public()
        
        # Get public URL
        verification_image_url = blob.public_url
        
        # Process verification with Google Cloud Vision API
        verification_result = await process_verification_image_with_name_check(
            image_bytes,  # Pass bytes directly
            db_candidate_name  # Pass name from DB for comparison
        )
        # Log the verification result for debugging
        logger.info(f"Verification result for {application_id}: {verification_result}")

        # Store verification result in Firestore
        face_verified = verification_result.get('face_verified', False)
        name_verified = verification_result.get('name_verified', False)  # Get name verification status
        overall_verified = face_verified and (
            name_verified if db_candidate_name else True)  # Overall = face AND (name OR name not available)
        
        # Update application with verification image and result
        db.collection('applications').document(application_id).update({
            'interview.icVerificationImage': verification_image_url,
            'interview.verificationStatus': overall_verified,  # Store overall status
            'interview.faceVerificationStatus': face_verified,
            'interview.nameVerificationStatus': name_verified,
            'interview.verificationConfidence': verification_result.get('face_confidence', 0.0),
            'interview.extractedIdName': verification_result.get('extracted_name'),
            'interview.nameMatchScore': verification_result.get('name_match_score'),
            'interview.verificationMessage': verification_result.get('message', ''),
            'interview.verificationDebugInfo': verification_result.get('debug_info', {}),
            'interview.verificationTimestamp': firestore.SERVER_TIMESTAMP
        })

        # Only update if verification was successful overall
        if overall_verified:
            db.collection('interviewLinks').document(request.interviewId).update({
                'status': 'in_progress',  # Mark as started
                'verificationStatus': overall_verified,  # Redundant? Kept for compatibility
                'verificationTime': firestore.SERVER_TIMESTAMP
            })
        else:
            # Update verification status but keep interview 'pending' (or move to 'failed_verification'?)
            db.collection('interviewLinks').document(request.interviewId).update({
                'verificationStatus': overall_verified,
                'verificationTime': firestore.SERVER_TIMESTAMP
            })
        
        # Return the FULL result object, not just the verified and message fields
        return verification_result
    
    except HTTPException:
        raise
    except base64.binascii.Error:
        logger.error(f"Invalid base64 data received for interview {request.interviewId}")
        raise HTTPException(status_code=400, detail="Invalid image data format.")
    except Exception as e:
        logger.error(f"Error verifying identity: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to verify identity: {str(e)}")

@router.get("/questions/{interview_id}/{link_code}")
async def get_interview_questions(
    interview_id: str = Path(...),
    link_code: str = Path(...),
    db: firestore.Client = Depends(get_db)
):
    """Get the list of questions for an interview"""
    try:
        # Validate interview link
        interview_data = validate_interview_link(interview_id, link_code, allow_resumption=True)

        if interview_data.get('current_status') != 'in_progress':
            # This case should ideally be caught by validate_interview_link, but double-check
            logger.warning(
                f"Attempt to get questions for interview {interview_id} with status {interview_data.get('current_status')}")
            raise HTTPException(status_code=403, detail="Interview questions cannot be accessed at this stage.")

        # Get application ID from interview data
        application_id = interview_data.get('applicationId')
        
        if not application_id:
            raise HTTPException(status_code=404, detail="Application ID not found")
        
        # Query InterviewQuestionActual collection by applicationId
        actual_questions_query = db.collection('InterviewQuestionActual').where('applicationId', '==', application_id).limit(1).get()

        questions = []
        found_questions = False
        for doc in actual_questions_query:  # Iterate through the stream result
            actual_questions_data = doc.to_dict()
            found_questions = True
            if actual_questions_data and 'questions' in actual_questions_data:
                # Format questions from InterviewQuestionActual
                for idx, q in enumerate(actual_questions_data.get('questions', [])):
                    questions.append({
                        "questionId": q.get('questionId', f"q-{idx + 1}"),
                        "question": q.get('text', 'No question text available'),
                        "sectionTitle": q.get('sectionTitle', ''),
                        "timeLimit": q.get('timeLimit', 60),
                        "order": idx + 1
                    })
            else:
                logger.warning(f"No questions array in actual questions data for application {application_id}")
            break  # Should only be one document due to limit(1)

        if not found_questions:
            logger.warning(f"No actual questions document found for application {application_id}")
            # Decide: return empty list or raise error? Returning empty might be confusing.
            raise HTTPException(status_code=404,
                                detail="Interview questions have not been generated for this application.")
        
        logger.info(f"Returning {len(questions)} questions for application {application_id}")
        return questions
    
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error("Error fetching interview questions: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to fetch interview questions: {str(e)}")


@router.post("/generate-upload-url")
async def generate_upload_url(
        request: GenerateUploadUrlRequest,
        db: firestore.Client = Depends(get_db),
        storage_bucket=Depends(get_storage)
):
    """Generates a signed URL for direct video upload to GCS."""
    interview_id = request.interviewId
    link_code = request.linkCode
    question_id = request.questionId
    content_type = request.contentType
    try:
        # 1. Validate the interview link and status (crucial for security)
        interview_data = validate_interview_link(interview_id, link_code, allow_resumption=True)
        if interview_data.get('current_status') != 'in_progress':
            raise HTTPException(status_code=403, detail="Cannot upload response at this stage.")
        application_id = interview_data.get('applicationId')

        # 2. Generate a unique path/filename in storage
        upload_id = str(uuid.uuid4())  # Unique ID for this specific upload attempt/response
        # Use content_type to potentially adjust the extension if needed, but keep .webm default for now
        file_extension = content_type.split('/')[-1]  # e.g., 'webm', 'mp4'
        # Basic sanitization for extension
        if file_extension not in ['webm', 'mp4', 'mov', 'avi', 'mkv']:
            file_extension = 'webm'  # Default if type is weird
        storage_path = f"interview_responses/{application_id}/{interview_id}/{question_id}_{upload_id}.{file_extension}"  # Use dynamic extension

        # 3. Get the blob reference
        blob = storage_bucket.blob(storage_path)

        # 4. Generate the Signed URL (for PUT requests)
        # Allow PUT method, set expiration (e.g., 15 minutes)
        signed_url = await asyncio.to_thread(
            blob.generate_signed_url,
            version="v4",
            expiration=timedelta(minutes=15),
            method="PUT",
            content_type=content_type  # Crucial for direct browser upload - use the validated content_type
        )

        logger.info(f"Generated signed URL for {storage_path} with Content-Type {content_type}")

        # 5. Return URL and the path (or GCS URI) to the frontend
        return {
            "signedUrl": signed_url,
            "storagePath": storage_path,  # Send back the path backend will use
            "gcsUri": f"gs://{storage_bucket.name}/{storage_path}"  # Send GCS URI for backend processing
        }

    except HTTPException as he:
        raise he  # Re-raise validation errors
    except Exception as e:
        logger.exception(f"Error generating signed URL for interview {interview_id}")
        raise HTTPException(status_code=500, detail="Could not prepare file upload.")


@router.post("/submit-response", response_model=InterviewResponseResponse)
async def submit_interview_response_metadata(
        request: InterviewResponseSubmitMetadataRequest,
        db: firestore.Client = Depends(get_db),
        storage_bucket=Depends(get_storage)
):
    nltk.download('punkt', quiet=True)
    temp_audio_file_path = None
    temp_modified_audio_path = None  # Path for helium audio
    downloaded_video_path = None
    gemini_interpretation_task = None
    scoring_task = None
    bias_check_task = None
    transcript_bias_detection_task = None
    audio_censorship_task = None

    try:
        logger.info(
            f"Validating interview link: {request.interviewId} with code: {request.linkCode[:5]}...")
        interview_data = validate_interview_link(request.interviewId, request.linkCode, allow_resumption=True)
        logger.info(f"Link validation successful. Status: {interview_data.get('current_status')}")

        if interview_data.get('current_status') != 'in_progress':
            logger.warning(
                f"Attempt to submit response for interview {request.interviewId} with status {interview_data.get('current_status')}")
            raise HTTPException(status_code=403,
                                detail="Cannot submit response when interview is not 'in_progress'.")

        application_id = interview_data.get('applicationId')
        job_id = interview_data.get('jobId')
        question_response_id = str(uuid.uuid4())
        question_text = request.question
        video_gcs_uri = request.gcsUri

        job_description = ""
        if job_id:
            logger.info(f"Fetching job description for job ID: {job_id}")
            job_doc_ref = db.collection('jobs').document(job_id)
            job_doc = await asyncio.to_thread(job_doc_ref.get)
            if job_doc.exists:
                job_data = job_doc.to_dict()
                job_description = job_data.get("jobDescription", "")
                if not job_description:
                    logger.warning(f"Job {job_id} has an empty job description.")
                else:
                    logger.info(f"Job description fetched successfully (length: {len(job_description)}).")
            else:
                logger.error(f"Job document {job_id} not found for interview {request.interviewId}")
        else:
            logger.error(f"Missing jobId in interviewLink {request.interviewId}")

        if not video_gcs_uri or not video_gcs_uri.startswith(f"gs://{storage_bucket.name}/"):
            logger.error(f"Invalid GCS URI received: {video_gcs_uri}")
            raise HTTPException(status_code=400, detail="Invalid video storage identifier provided.")
        blob_name = video_gcs_uri.replace(f"gs://{storage_bucket.name}/", "")
        video_blob = storage_bucket.blob(blob_name)
        video_url = video_blob.public_url
        logger.info(f"Processing response metadata for video at GCS URI: {video_gcs_uri}")

        original_extracted_audio_public_url, helium_audio_public_url, censored_audio_url = None, None, None
        transcript, censored_transcript = "Processing...", "Processing..."
        facial_analysis_interpretation = "Processing..."
        word_count = 0
        word_timings = []
        facial_analysis_raw = None
        nlp_bias_check_result = {'flagged': False, 'details': [], 'message': 'Processing...'}
        transcript_bias_segments = []
        scores = {'relevance': 0.0, 'confidence': 0.0, 'clarity': 0.0, 'engagement': 0.0, 'job_fit': 0.0,
                  'substance': 0.0, 'total_score': 0.0, 'error': None, 'explanation': {}}

        with tempfile.NamedTemporaryFile(delete=False, suffix="_orig_audio.wav") as temp_orig_audio_file, \
                tempfile.NamedTemporaryFile(delete=False, suffix="_helium_audio.wav") as temp_helium_file:
            temp_audio_file_path = temp_orig_audio_file.name
            temp_modified_audio_path = temp_helium_file.name  # This will store helium audio

        async def process_audio_and_effects():
            nonlocal transcript, word_count, word_timings, original_extracted_audio_public_url, helium_audio_public_url
            original_extracted_audio_gcs_uri_val = None
            helium_audio_gcs_uri_val = None
            downloaded_video_path_local = None
            try:
                with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_video_download_file:
                    downloaded_video_path_local = temp_video_download_file.name
                logger.info(f"Downloading video from {video_gcs_uri} to {downloaded_video_path_local}")
                await asyncio.to_thread(video_blob.download_to_filename, downloaded_video_path_local)
                logger.info(f"Video downloaded successfully.")

                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, extract_audio_with_ffmpeg, downloaded_video_path_local,
                                           temp_audio_file_path)
                logger.info(f"Original audio extracted to: {temp_audio_file_path}")

                # Upload original extracted audio
                original_audio_storage_path = f"interview_responses/{application_id}/{request.interviewId}/{question_response_id}_original_audio.wav"
                original_audio_blob_upload = storage_bucket.blob(original_audio_storage_path)
                await loop.run_in_executor(None, functools.partial(original_audio_blob_upload.upload_from_filename,
                                                                   temp_audio_file_path, content_type="audio/wav"))
                await loop.run_in_executor(None, original_audio_blob_upload.make_public)
                original_extracted_audio_public_url = original_audio_blob_upload.public_url
                original_extracted_audio_gcs_uri_val = f"gs://{storage_bucket.name}/{original_audio_storage_path}"
                logger.info(
                    f"Original extracted audio uploaded to {original_extracted_audio_public_url} (GCS: {original_extracted_audio_gcs_uri_val})")

                # Apply helium voice effect to the original extracted audio
                await loop.run_in_executor(None, apply_voice_effect, temp_audio_file_path, "helium",
                                           temp_modified_audio_path)
                logger.info(f"Helium effect audio created at: {temp_modified_audio_path}")

                # Upload helium effect audio
                helium_audio_storage_path = f"interview_responses/{application_id}/{request.interviewId}/{question_response_id}_helium_audio.wav"
                helium_audio_blob_upload = storage_bucket.blob(helium_audio_storage_path)
                await loop.run_in_executor(None, functools.partial(helium_audio_blob_upload.upload_from_filename,
                                                                   temp_modified_audio_path, content_type="audio/wav"))
                await loop.run_in_executor(None, helium_audio_blob_upload.make_public)
                helium_audio_public_url = helium_audio_blob_upload.public_url
                helium_audio_gcs_uri_val = f"gs://{storage_bucket.name}/{helium_audio_storage_path}"
                logger.info(
                    f"Helium effect audio uploaded to {helium_audio_public_url} (GCS: {helium_audio_gcs_uri_val})")

                # Transcribe the ORIGINAL extracted audio
                transcription_result = await transcribe_audio_with_google_cloud(original_extracted_audio_gcs_uri_val)
                transcript = transcription_result['transcript']
                word_timings = transcription_result.get('word_timings', [])
                word_count = transcription_result.get('word_count', 0)
                logger.info(f"Transcription complete. Word count: {word_count}")

                return {
                    'transcript': transcript,
                    'helium_audio_public_url': helium_audio_public_url,
                    'helium_audio_gcs_uri': helium_audio_gcs_uri_val,
                    'original_extracted_audio_gcs_uri': original_extracted_audio_gcs_uri_val,
                    'word_timings': word_timings,
                    'word_count': word_count
                }
            except Exception as audio_err:
                logger.exception(f"Error in process_audio_and_effects task: {audio_err}")
                transcript = f"Audio processing failed: {str(audio_err)}"
                return {
                    'transcript': transcript,
                    'helium_audio_public_url': None,
                    'helium_audio_gcs_uri': None,
                    'original_extracted_audio_gcs_uri': None,
                    'word_timings': [], 'word_count': 0, 'error': str(audio_err)
                }
            finally:
                if downloaded_video_path_local and os.path.exists(downloaded_video_path_local):
                    try:
                        os.unlink(downloaded_video_path_local)
                    except Exception as e_clean:
                        logger.error(f"Error deleting temp video {downloaded_video_path_local}: {e_clean}")

        async def process_video_expressions_mediapipe_task():
            nonlocal facial_analysis_raw
            if video_gcs_uri:
                try:
                    facial_analysis_raw = await analyze_video_expressions_mediapipe(video_gcs_uri)
                    logger.info("MediaPipe facial expression analysis task complete.")
                    return facial_analysis_raw
                except Exception as video_err:
                    logger.exception(f"Error in MediaPipe analysis task: {video_err}")
                    facial_analysis_raw = {"error": f"MediaPipe analysis failed: {str(video_err)}"}
                    return facial_analysis_raw
            else:
                facial_analysis_raw = {"error": "Video GCS URI not available."}
                return facial_analysis_raw

        logger.info("Launching audio processing/effects/transcription and video analysis tasks.")
        audio_processing_task = asyncio.create_task(process_audio_and_effects())
        video_task = asyncio.create_task(process_video_expressions_mediapipe_task())

        current_transcript = "Transcription pending..."
        current_helium_audio_public_url = None
        current_helium_audio_gcs_uri = None
        current_original_audio_gcs_uri_for_transcription = None
        current_word_timings = []

        try:
            audio_results = await audio_processing_task
            current_transcript = audio_results['transcript']
            current_helium_audio_public_url = audio_results['helium_audio_public_url']
            current_helium_audio_gcs_uri = audio_results.get('helium_audio_gcs_uri')
            current_original_audio_gcs_uri_for_transcription = audio_results.get(
                'original_extracted_audio_gcs_uri')  # For reference if needed
            current_word_timings = audio_results.get('word_timings', [])

            if current_transcript and not current_transcript.startswith("Audio processing failed"):
                logger.info("Launching scoring, NLP bias check, and transcript bias detection tasks.")
                scoring_task = asyncio.create_task(score_response_xai(
                    transcript=current_transcript,
                    audio_url=current_helium_audio_public_url,  # Score with helium audio
                    question_text=question_text,
                    job_description=job_description,
                    word_timings=current_word_timings
                ))
                bias_check_task = asyncio.create_task(check_content_bias(current_transcript))
                gemini_service_instance = GeminiService()
                transcript_bias_detection_task = asyncio.create_task(
                    gemini_service_instance.detect_transcript_bias(current_transcript)
                )
            else:
                logger.warning("Skipping scoring and bias checks due to missing/failed transcript.")
                scores['error'] = current_transcript
                nlp_bias_check_result['message'] = "Skipped due to audio/transcription failure."
                censored_transcript = "Censorship skipped due to transcription failure."

        except Exception as audio_fail_err:
            logger.error(f"Audio processing/effects/transcription failed: {audio_fail_err}")
            current_transcript = transcript  # Keep error message from task
            scores['error'] = f"Audio Processing Failed: {str(audio_fail_err)}"
            nlp_bias_check_result['message'] = "Skipped due to audio processing failure."
            censored_transcript = "Censorship skipped due to audio processing failure."
            scoring_task, bias_check_task, transcript_bias_detection_task = None, None, None

        try:
            await video_task
        except Exception as video_fail_err:
            logger.error(f"Awaiting MediaPipe analysis task failed: {video_fail_err}", exc_info=True)
            if facial_analysis_raw is None:
                facial_analysis_raw = {"error": f"MediaPipe analysis task failed: {str(video_fail_err)}"}

        if transcript_bias_detection_task:
            try:
                detected_pii_segments = await transcript_bias_detection_task
                transcript_bias_segments = detected_pii_segments

                if detected_pii_segments and current_transcript and not current_transcript.startswith(
                        "Audio processing failed"):
                    censored_transcript = censor_transcript_text(current_transcript, detected_pii_segments)
                    logger.info("Transcript censored based on PII/bias detection.")

                    # If helium audio was successfully created and PII detected, launch audio censorship on helium audio
                    if current_helium_audio_gcs_uri and current_word_timings:
                        logger.info("Launching audio censorship task on helium audio.")
                        audio_censorship_task = asyncio.create_task(apply_audio_bleeps(
                            original_audio_gcs_uri=current_helium_audio_gcs_uri,  # Input is helium audio
                            word_timings=current_word_timings,  # Timings from original audio
                            biased_segments_info=detected_pii_segments,
                            storage_bucket=storage_bucket,
                            application_id=application_id,
                            interview_id=request.interviewId,
                            question_response_id=question_response_id
                        ))
                    else:
                        logger.warning("Skipping audio censorship: helium audio GCS URI or word timings missing.")
                        censored_audio_url = None
                else:
                    censored_transcript = current_transcript
                    logger.info("No PII/bias segments to censor in transcript, or transcript failed.")
                    censored_audio_url = None

            except Exception as tb_err:
                logger.error(f"Error during transcript bias detection/censorship phase: {tb_err}")
                censored_transcript = f"Transcript censorship failed: {str(tb_err)}"
                censored_audio_url = None

        can_interpret_facial = (facial_analysis_raw and "error" not in facial_analysis_raw and
                                current_transcript and not current_transcript.startswith("Audio processing failed") and
                                (not scores.get('error')))

        if can_interpret_facial:
            async def interpret_expressions_async_task():
                nonlocal facial_analysis_interpretation
                try:
                    gemini_service = GeminiService()
                    interpretation = await gemini_service.interpret_facial_expressions(
                        facial_analysis_raw, question_text, current_transcript
                    )
                    facial_analysis_interpretation = interpretation
                    logger.info("Facial interpretation task complete.")
                except Exception as interp_err:
                    logger.exception(f"Error in interpret_expressions_async_task: {interp_err}")
                    facial_analysis_interpretation = "Failed to generate facial interpretation."

            gemini_interpretation_task = asyncio.create_task(interpret_expressions_async_task())
        else:
            if facial_analysis_raw and "error" in facial_analysis_raw:
                facial_analysis_interpretation = f"Interpretation skipped ({facial_analysis_raw['error']})"
            elif scores.get('error'):
                facial_analysis_interpretation = f"Interpretation skipped (Scoring Error: {scores.get('error')})"
            elif current_transcript.startswith("Audio processing failed"):
                facial_analysis_interpretation = f"Interpretation skipped (Audio/Transcript Error: {current_transcript})"
            else:
                facial_analysis_interpretation = "Interpretation skipped (Missing Data)"

        if scoring_task: scores = await scoring_task
        if bias_check_task: nlp_bias_check_result = await bias_check_task
        if audio_censorship_task:
            censored_audio_gcs_uri_result = await audio_censorship_task
            if censored_audio_gcs_uri_result:
                censored_blob_name = censored_audio_gcs_uri_result.replace(f"gs://{storage_bucket.name}/", "")
                censored_audio_blob = storage_bucket.blob(censored_blob_name)
                censored_audio_url = censored_audio_blob.public_url  # This is now bleeped helium audio
                logger.info(f"Public URL for censored (bleeped helium) audio: {censored_audio_url}")
            else:
                censored_audio_url = None
        if gemini_interpretation_task: await gemini_interpretation_task

        interview_doc_ref = db.collection('interviewResponses').document(application_id)
        interview_doc = await asyncio.to_thread(interview_doc_ref.get)

        question_response = {
            'questionId': request.questionId,
            'responseId': question_response_id,
            'submitTime': datetime.utcnow(),
            'originalTranscript': current_transcript,
            'censoredTranscript': censored_transcript,
            'wordCount': word_count,
            'videoResponseUrl': video_url,
            'videoGcsUri': video_gcs_uri,
            'originalAudioUrl': original_extracted_audio_public_url,  # URL of raw extracted audio
            'pitchShiftedAudioUrl': current_helium_audio_public_url,  # URL of helium audio (unbleeped)
            'censoredAudioUrl': censored_audio_url,  # URL of bleeped helium audio
            'wordTimings': word_timings,
            'facial_analysis_raw': facial_analysis_raw,
            'facial_analysis_interpretation': facial_analysis_interpretation,
            'scores': {
                'relevance': float(scores.get('relevance', 0.0)),
                'confidence': float(scores.get('confidence', 0.0)),
                'clarity': float(scores.get('clarity', 0.0)),
                'engagement': float(scores.get('engagement', 0.0)),
                'substance': float(scores.get('substance', 0.0)),
                'job_fit': float(scores.get('job_fit', 0.0)),
                'total_score': float(scores.get('total_score', 0.0)),
                'error': scores.get('error')
            },
            'scoring_explanation': scores.get('explanation', {}),
            'nlpBiasCheck': nlp_bias_check_result,
            'transcriptBiasAnalysis': {
                'detectedSegments': transcript_bias_segments,
                'processedAt': datetime.utcnow()
            },
            'AIFeedback': None
        }

        if not scores.get('error'):
            analysis_update = {
                'analysis.clarity': firestore.Increment(float(scores.get('clarity', 0.0))),
                'analysis.confidence': firestore.Increment(float(scores.get('confidence', 0.0))),
                'analysis.relevance': firestore.Increment(float(scores.get('relevance', 0.0))),
                'analysis.engagement': firestore.Increment(float(scores.get('engagement', 0.0))),
                'analysis.substance': firestore.Increment(float(scores.get('substance', 0.0))),
                'analysis.jobFit': firestore.Increment(float(scores.get('job_fit', 0.0))),
                'analysis.totalScore': firestore.Increment(float(scores.get('total_score', 0.0))),
                'analysis.questionCount': firestore.Increment(1),
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
        else:
            analysis_update = {
                'analysis.questionCount': firestore.Increment(1),
                'updatedAt': firestore.SERVER_TIMESTAMP
            }

        if not interview_doc.exists:
            initial_analysis_scores = {
                'clarity': float(scores.get('clarity', 0.0)) if not scores.get('error') else 0.0,
                'confidence': float(scores.get('confidence', 0.0)) if not scores.get('error') else 0.0,
                'relevance': float(scores.get('relevance', 0.0)) if not scores.get('error') else 0.0,
                'engagement': float(scores.get('engagement', 0.0)) if not scores.get('error') else 0.0,
                'substance': float(scores.get('substance', 0.0)) if not scores.get('error') else 0.0,
                'jobFit': float(scores.get('job_fit', 0.0)) if not scores.get('error') else 0.0,
                'totalScore': float(scores.get('total_score', 0.0)) if not scores.get('error') else 0.0,
                'questionCount': 1
            }
            interview_response_data = {
                'applicationId': application_id,
                'interviewId': request.interviewId,
                'analysis': initial_analysis_scores,
                'questions': [question_response],
                'createdAt': firestore.SERVER_TIMESTAMP,
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
            await asyncio.to_thread(interview_doc_ref.set, interview_response_data)
        else:
            update_data = {
                **analysis_update,
                'questions': firestore.ArrayUnion([question_response]),
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
            await asyncio.to_thread(interview_doc_ref.update, update_data)

        return InterviewResponseResponse(
            success=True,
            responseId=question_response_id,
            message="Response received and is being processed. Results will be available shortly.",
            transcript=None, word_count=None, word_timings=None
        )

    except HTTPException as he:
        logger.error(f"HTTP Exception in submit_interview_response: {he.detail}")
        raise he
    except Exception as e:
        logger.exception("Error processing interview response metadata: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to process response metadata: {str(e)}")
    finally:
        for temp_file in [temp_audio_file_path, temp_modified_audio_path, downloaded_video_path]:
            if temp_file and os.path.exists(temp_file):
                try:
                    os.unlink(temp_file)
                except Exception as e_clean:
                    logger.error(f"Error deleting temp file {temp_file}: {e_clean}")

@router.post("/complete-interview")
async def complete_interview(
    request_body: Dict[str, str] = Body(...),
    db: firestore.Client = Depends(get_db)
):
    """Mark an interview as completed and finalize scores"""
    interview_id = request_body.get("interviewId")
    link_code = request_body.get("linkCode")

    if not interview_id or not link_code:
        raise HTTPException(status_code=400, detail="Missing interviewId or linkCode")

    try:
        # Validate interview link
        interview_data = validate_interview_link(interview_id, link_code, allow_resumption=True)

        if interview_data.get('current_status') != 'in_progress':
            logger.warning(f"Attempt to complete interview {interview_id} with status {interview_data.get('current_status')}")
            raise HTTPException(status_code=403, detail="Interview cannot be completed at this stage.")

        application_id = interview_data.get('applicationId')

        # Fetch the final accumulated scores
        interview_response_ref = db.collection('interviewResponses').document(application_id)
        interview_response_doc = await asyncio.to_thread(interview_response_ref.get)

        if not interview_response_doc.exists:
            # ... (handle missing responses doc) ...
            num_questions = 0
            final_analysis_update = {}  # Keep this empty or initialize with zeros
        else:
            interview_response_data = interview_response_doc.to_dict()
            accumulated_analysis = interview_response_data.get('analysis', {})
            num_questions = accumulated_analysis.get('questionCount', 0)

            if num_questions > 0:
                # Calculate average scores for ALL metrics
                avg_clarity = accumulated_analysis.get('clarity', 0) / num_questions
                avg_confidence = accumulated_analysis.get('confidence', 0) / num_questions
                avg_relevance = accumulated_analysis.get('relevance', 0) / num_questions
                avg_engagement = accumulated_analysis.get('engagement', 0) / num_questions
                avg_substance = accumulated_analysis.get('substance', 0) / num_questions
                avg_jobFit = accumulated_analysis.get('jobFit', 0) / num_questions
                # --- Calculate average total score based on ALL averaged components ---
                W_OVERALL_REL = 0.15
                W_OVERALL_CONF = 0.20
                W_OVERALL_CLAR = 0.20
                W_OVERALL_ENG = 0.15
                W_OVERALL_SUBSTANCE = 0.15
                W_OVERALL_JOB_FIT = 0.15

                avg_total_score = (avg_relevance * W_OVERALL_REL +
                                   avg_confidence * W_OVERALL_CONF +
                                   avg_clarity * W_OVERALL_CLAR +
                                   avg_engagement * W_OVERALL_ENG +
                                   avg_substance * W_OVERALL_SUBSTANCE +  # Add substance
                                   avg_jobFit * W_OVERALL_JOB_FIT)  # Add job fit
                avg_total_score = np.clip(avg_total_score, 0.0, 1.0)  # Clip final average

                # Prepare final update map with ALL averaged scores
                final_analysis_update = {
                    'analysis.clarity': float(avg_clarity),
                    'analysis.confidence': float(avg_confidence),
                    'analysis.relevance': float(avg_relevance),
                    'analysis.engagement': float(avg_engagement),
                    'analysis.substance': float(avg_substance),  # Store averaged substance
                    'analysis.jobFit': float(avg_jobFit),  # Store averaged jobFit
                    'analysis.totalScore': float(avg_total_score),  # Store averaged total score
                    'analysis.questionCount': num_questions
                }
                logger.info(f"Final average scores for {application_id}: {final_analysis_update}")
            else:
                logger.warning(f"No questions found in responses for {application_id}. Setting final scores to 0.")
                # Set final scores to 0 if no questions were answered/recorded
                final_analysis_update = {
                    'analysis.clarity': 0.0, 'analysis.confidence': 0.0,
                    'analysis.relevance': 0.0, 'analysis.engagement': 0.0,
                    'analysis.substance': 0.0, 'analysis.jobFit': 0.0,  # Initialize new scores to 0
                    'analysis.totalScore': 0.0, 'analysis.questionCount': 0
                }

            # Update the analysis scores in Firestore with the calculated averages
            await asyncio.to_thread(interview_response_ref.update, final_analysis_update)

            # Update interview link status
        interview_link_ref = db.collection('interviewLinks').document(interview_id)
        await asyncio.to_thread(interview_link_ref.update, {
            'status': 'completed',
            'completedAt': datetime.utcnow()
        })

        # Update application status
        application_ref = db.collection('applications').document(application_id)
        await asyncio.to_thread(application_ref.update, {
            'status': 'interview completed'
        })

        logger.info(f"Interview {interview_id} for application {application_id} marked as completed.")
        return {"success": True, "message": "Interview marked as completed successfully"}

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Error completing interview {interview_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to complete interview.")

@router.post("/abandon-interview")
async def abandon_interview(
    interviewId: str = Form(...),
    linkCode: str = Form(...),
    db: firestore.Client = Depends(get_db)
):
    """Mark an interview as abandoned (e.g., user closed tab)."""
    logger.info(f"Received abandon request for interview: {interviewId}")  # Log reception

    try:
        interview_data = validate_interview_link(interviewId, linkCode, allow_resumption=True)

        current_status = interview_data.get('current_status', 'unknown')
        logger.info(f"Abandon request: Interview {interviewId} current status is {current_status}")

        # Only mark as abandoned if it was 'in_progress'
        if current_status == 'in_progress':
            application_id = interview_data.get('applicationId')  # Get app ID for logging/update
            db.collection('interviewLinks').document(interviewId).update({
                'status': 'abandoned',
                'abandonedAt': firestore.SERVER_TIMESTAMP
            })
            # Optionally update application status too
            if application_id:
                db.collection('applications').document(application_id).update({'status': 'interview abandoned'})
            logger.info(f"Interview {interviewId} (App: {application_id}) marked as abandoned.")
            # sendBeacon doesn't expect a meaningful response body, but return success for logging/potential future use
            return {"success": True, "message": "Interview marked as abandoned."}
        else:
            logger.warning(
                f"Attempt to abandon interview {interviewId} which is not in_progress (status: {current_status}). No action taken.")
            # Return a success=False or specific message if needed, but sendBeacon won't see it.
            # Returning a 200 OK might be simplest for sendBeacon scenarios.
            return {"success": False, "message": f"Interview cannot be abandoned from status '{current_status}'."}

    except HTTPException as he:
        # If validation fails (e.g., wrong code, expired), log the specific reason
        logger.warning(f"Failed abandon request validation for {interviewId}: {he.detail}")
        # Return an error status that reflects the issue, although sendBeacon ignores it.
        # Re-raising might be cleaner if you want FastAPI's default handling for the HTTP Exception.
        raise he  # Re-raise the validation error (e.g., 403, 404)
    except Exception as e:
        logger.error(f"Error processing abandon request for interview {interviewId}: {str(e)}", exc_info=True)
        # Return a 500 error status code.
        raise HTTPException(status_code=500, detail="Failed to mark interview as abandoned due to server error.")


@router.get("/interview-status/{application_id}")
async def get_interview_status(
    application_id: str,
    db: firestore.Client = Depends(get_db)
):
    """Get the interview status for an application"""
    try:
        # Query for interview links related to this application
        interview_links = db.collection('interviewLinks').where('applicationId', '==', application_id).get()
        
        if not interview_links:
            return {"status": "not_scheduled", "message": "No interview has been scheduled"}
        
        # Get the latest interview
        latest_interview = sorted(
            [link.to_dict() for link in interview_links], 
            key=lambda x: x.get('createdAt'), 
            reverse=True
        )[0]
        
        # Get response count
        responses = db.collection('interviewResponses').where('applicationId', '==', application_id).get()
        response_count = len(responses)
        
        return {
            "applicationId": application_id,
            "interviewId": latest_interview.get('interviewId'),
            "status": latest_interview.get('status'),
            "scheduledDate": latest_interview.get('scheduledDate'),
            "completed": latest_interview.get('status') == 'completed',
            "responseCount": response_count,
            "verificationStatus": latest_interview.get('verificationStatus', False)
        }
    
    except Exception as e:
        logger.error("Error getting interview status: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get interview status: {str(e)}")

@router.get("/responses/{application_id}")
async def get_interview_responses(
    application_id: str,
    db: firestore.Client = Depends(get_db)
):
    """Get interview responses for an application."""
    try:
        # Query for interview responses for this application
        responses_doc = db.collection('interviewResponses').document(application_id).get()
        
        if not responses_doc.exists:
            raise HTTPException(status_code=404, detail="No interview responses found for this application")
        
        return responses_doc.to_dict()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching interview responses: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch interview responses: {str(e)}")
    
@router.put("/update-responses/{application_id}")
async def update_interview_responses(
    application_id: str,
    data: Dict[str, Any],
    db: firestore.Client = Depends(get_db)
):
    """Update interview responses for an application."""
    try:
        # Update the document in Firestore
        db.collection('interviewResponses').document(application_id).set(data)
        
        return {"success": True, "message": "Responses updated successfully"}
    except Exception as e:
        logger.error(f"Error updating interview responses: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update interview responses: {str(e)}")
    
@router.post("/generate-feedback")
async def generate_ai_feedback(
    request: Dict[str, Any],
    db: firestore.Client = Depends(get_db)
):
    """Generate AI feedback for interview responses."""
    try:
        # Extract required fields
        application_id = request.get("applicationId")
        responses = request.get("responses", [])
        job_title = request.get("jobTitle", "Unknown position")
        job_id = request.get("jobId")
        candidate_id = request.get("candidateId")
        
        if not application_id or not responses:
            raise HTTPException(status_code=400, detail="applicationId and responses are required")
        
        # Fetch job details if jobId is provided
        job_data = {}
        if job_id:
            job_doc = db.collection('jobs').document(job_id).get()
            if job_doc.exists:
                job_data = job_doc.to_dict()
                job_title = job_data.get('jobTitle', job_title)
        
        # Fetch candidate resume data if candidateId is provided
        candidate_data = {}
        resume_text = {}
        if candidate_id:
            candidate_doc = db.collection('candidates').document(candidate_id).get()
            if candidate_doc.exists:
                candidate_data = candidate_doc.to_dict()
                resume_text = candidate_data.get('extractedText', {})
        
        # Initialize Gemini API
        from services.gemini_service import GeminiService
        gemini_service = GeminiService()
        
        # Generate feedback for each response
        feedback_results = []
        
        for response in responses:
            question_text = response.get("questionText", "Unknown question")
            transcript = response.get("transcript", "")
            response_id = response.get("responseId")
            
            if not response_id:
                continue
                
            # Skip empty transcripts
            if not transcript.strip():
                feedback_results.append({
                    "responseId": response_id,
                    "feedback": "<p>No transcript available for analysis.</p>"
                })
                continue
            
            # Prepare detailed job context
            job_context = ""
            if job_data:
                required_skills = ", ".join(job_data.get('requiredSkills', []))
                job_description = job_data.get('jobDescription', '')
                departments = ", ".join(job_data.get('departments', []))
                job_context = f"""
                Job Title: {job_title}
                Department(s): {departments}
                Required Skills: {required_skills}
                Key Responsibilities: {job_description}
                """
            
            # Prepare candidate resume context
            resume_context = ""
            if resume_text:
                # Extract key information from resume
                candidate_name = resume_text.get('applicant_name', 'Unknown')
                skills = resume_text.get('skills', [])
                experience = resume_text.get('experience', [])
                education = resume_text.get('education', [])
                
                # Format resume information
                skills_text = "\n- ".join(skills) if isinstance(skills, list) else skills
                
                # Format experience as a list if it's a list, otherwise use as is
                if isinstance(experience, list):
                    exp_text = ""
                    for exp in experience:
                        if isinstance(exp, dict):
                            company = exp.get('company', '')
                            position = exp.get('position', '')
                            duration = exp.get('duration', '')
                            exp_text += f"\n- {position} at {company}, {duration}"
                        else:
                            exp_text += f"\n- {exp}"
                else:
                    exp_text = experience
                
                # Format education as a list if it's a list, otherwise use as is
                if isinstance(education, list):
                    edu_text = ""
                    for edu in education:
                        if isinstance(edu, dict):
                            institution = edu.get('institution', '')
                            degree = edu.get('degree', '')
                            year = edu.get('year', '')
                            edu_text += f"\n- {degree} from {institution}, {year}"
                        else:
                            edu_text += f"\n- {edu}"
                else:
                    edu_text = education
                
                resume_context = f"""
                Candidate Name: {candidate_name}
                
                Skills:
                - {skills_text}
                
                Experience: {exp_text}
                
                Education: {edu_text}
                """
            
            # Generate feedback using Gemini with enhanced prompt
            prompt = f"""
            As an HR interview evaluator for a {job_title} position, analyze the following candidate response:
            
            QUESTION: {question_text}
            
            CANDIDATE'S ANSWER: {transcript}
            
            JOB DETAILS:
            {job_context}
            
            CANDIDATE RESUME INFORMATION:
            {resume_context}
            
            Provide a COMPREHENSIVE evaluation that specifically addresses:
            
            1. STRENGTHS (Does not necessarily need to have, depends on the response, if applicable, present it in bullet points. Bullet points should never more than 4)
               - Highlight specific points where the answer demonstrates qualifications for the role
               - Note any alignment with required skills or job responsibilities
            
            2. AREAS FOR IMPROVEMENT (Does not necessarily need to have, depends on the response, if applicable, present it in bullet points. Bullet points should never more than 4)
               - Identify gaps between the answer and job requirements
               - Suggest how the answer could better align with the position
            
            3. RESUME ALIGNMENT(Does not necessarily need to have, 1-2 short sentences))
               - Assess how well the answer reflects skills and experiences mentioned in the resume
               - Note any discrepancies or missed opportunities to highlight relevant background
            
            4. JOB FIT ASSESSMENT (1-2 short sentences)
               - Evaluate specifically how well the response indicates fit for this particular position. Understanding the question context and the required skills will help you make this decision.
            
            5. OVERALL ASSESSMENT (2-3 sentences maximum)
               - Provide a final evaluation considering both job requirements and resume background
            
            FORMAT GUIDELINES:
            - Use HTML formatting with <p>, <ul>, and <li> tags
            - Highlight KEY POINTS with <strong> tags
            - Keep bullet points brief (under 15 words each)
            - Total feedback should be scannable in under 30 seconds
            - Focus on actionable insights for HR decision-making
            
            NOTE (DO NOT MENTION in the Feedback):
            - Do not need to be too strict in terms of the candidate answer provided as it is transcribed from the audio and might have some errors.'
            """
            
            try:
                response_content = await gemini_service.model.generate_content_async(prompt)
                feedback_html = response_content.text
                
                # Clean up any markdown to ensure it's valid HTML
                if "```html" in feedback_html:
                    feedback_html = feedback_html.split("```html")[1].split("```")[0].strip()
                
                # Make sure HTML is properly formatted
                if not feedback_html.strip().startswith("<"):
                    # Convert simple markdown-style lists to HTML lists if needed
                    feedback_html = feedback_html.replace("**", "<strong>").replace("**", "</strong>")
                    feedback_html = feedback_html.replace("- ", "<li>").replace("\n- ", "</li>\n<li>")
                    
                    # Wrap in proper HTML structure
                    sections = feedback_html.split("\n\n")
                    formatted_sections = []
                    
                    for section in sections:
                        if section.strip():
                            if "<li>" in section:
                                formatted_section = f"<ul>{section}</li></ul>"
                                formatted_sections.append(formatted_section)
                            else:
                                formatted_section = f"<p>{section}</p>"
                                formatted_sections.append(formatted_section)
                    
                    feedback_html = "\n".join(formatted_sections)
                
                feedback_results.append({
                    "responseId": response_id,
                    "feedback": feedback_html
                })
                
            except Exception as feedback_error:
                logger.error(f"Error generating feedback for response {response_id}: {feedback_error}")
                feedback_results.append({
                    "responseId": response_id,
                    "feedback": "<p>Error generating feedback for this response.</p>"
                })
        
        return {"feedback": feedback_results}
    
    except Exception as e:
        logger.error(f"Error generating AI feedback: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate AI feedback: {str(e)}")

@router.post("/send-offer")
async def send_job_offer(
    request: Dict[str, Any]
):
    """Send job offer email to candidate."""
    try:
        # Extract required fields
        application_id = request.get("applicationId")
        candidate_id = request.get("candidateId")
        job_id = request.get("jobId")
        email = request.get("email")
        candidate_name = request.get("candidateName", "Candidate")
        job_title = request.get("jobTitle", "the position")
        
        if not application_id or not candidate_id or not job_id or not email:
            raise HTTPException(status_code=400, detail="Missing required fields")
        
        # Create job offer email
        email_sent = send_job_offer_email(
            email=email,
            candidate_name=candidate_name,
            job_title=job_title
        )
        
        # Update application status
        from core.firebase import firebase_client
        firebase_client.update_document('applications', application_id, {
            'status': 'approved',
            'approvedAt': datetime.now().isoformat()
        })
        
        # Create notification record
        notification_id = str(uuid.uuid4())
        notification_data = {
            'candidateId': candidate_id,
            'applicationId': application_id,
            'type': 'job_offer',
            'sentDate': datetime.now().isoformat(),
            'content': f"Job offer email for {job_title}",
            'status': 'sent' if email_sent else 'failed'
        }
        
        firebase_client.create_document('emailNotifications', notification_id, notification_data)
        
        return {
            "success": True,
            "message": "Job offer email sent successfully",
            "emailSent": email_sent
        }
    
    except Exception as e:
        logger.error(f"Error sending job offer: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send job offer: {str(e)}")

@router.post("/schedule-physical")
async def schedule_physical_interview(
    request: SchedulePhysicalInterviewRequest,
    db: firestore.Client = Depends(get_db)
):
    """Schedule a physical interview and send email notification"""
    try:
        # Basic validation (could add more checks, e.g., application exists)
        if not all([request.applicationId, request.candidateId, request.jobId, request.email,
                    request.interviewDate, request.interviewTime, request.interviewLocation, request.contactPerson]):
            raise HTTPException(status_code=400, detail="Missing required fields for scheduling")

        # Call the service function to send the email
        email_sent = send_physical_interview_email(
            email=request.email,
            candidate_name=request.candidateName,
            job_title=request.jobTitle,
            date_str=request.interviewDate,
            time_str=request.interviewTime,
            location=request.interviewLocation,
            contact_person=request.contactPerson,
            additional_info=request.additionalInfo
        )

        # Update application status (optional, but recommended)
        try:
            application_ref = db.collection('applications').document(request.applicationId)
            application_ref.update({
                'status': 'physical interview scheduled',
                'physicalInterviewDetails': { # Store details for reference
                     'date': request.interviewDate,
                     'time': request.interviewTime,
                     'location': request.interviewLocation,
                     'contactPerson': request.contactPerson,
                     'additionalInfo': request.additionalInfo,
                     'scheduledAt': firestore.SERVER_TIMESTAMP
                }
            })
            logger.info(f"Application {request.applicationId} status updated to 'physical interview scheduled'")
        except Exception as db_error:
            logger.error(f"Failed to update application status for {request.applicationId}: {db_error}")
            # Decide if this should prevent success response - maybe not if email sent

        # Create email notification record
        notification_id = str(uuid.uuid4())
        notification_data = {
            'candidateId': request.candidateId,
            'applicationId': request.applicationId,
            'type': 'physical_interview_invitation',
            'sentDate': datetime.utcnow(),
            'content': f"Physical interview scheduled for {request.jobTitle} on {request.interviewDate}",
            'status': 'sent' if email_sent else 'failed'
        }
        try:
            db.collection('emailNotifications').document(notification_id).set(notification_data)
        except Exception as db_error:
             logger.error(f"Failed to create notification record for physical interview {request.applicationId}: {db_error}")


        if not email_sent:
             # Consider returning 500 if email failed but status updated?
             raise HTTPException(status_code=500, detail="Failed to send physical interview email.")

        return {
            "success": True,
            "message": "Physical interview scheduled and email sent successfully.",
            "emailSent": email_sent
        }

    except HTTPException as he:
        raise he # Re-raise specific HTTP exceptions
    except Exception as e:
        logger.error(f"Error scheduling physical interview: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to schedule physical interview: {str(e)}")


@router.post("/send-rejection")
async def send_rejection_email_endpoint(
    request: Dict[str, Any]
):
    """Send rejection email to candidate."""
    try:
        # Extract required fields
        application_id = request.get("applicationId")
        candidate_id = request.get("candidateId")
        job_id = request.get("jobId")
        email = request.get("email")
        candidate_name = request.get("candidateName", "Candidate")
        job_title = request.get("jobTitle", "the position")
        
        if not application_id or not candidate_id or not job_id or not email:
            raise HTTPException(status_code=400, detail="Missing required fields")
        
        # Send rejection email
        email_sent = send_rejection_email(
            email=email,
            candidate_name=candidate_name,
            job_title=job_title
        )
        
        # Update application status
        from core.firebase import firebase_client
        firebase_client.update_document('applications', application_id, {
            'status': 'rejected',
            'rejectedAt': datetime.now().isoformat()
        })
        
        # Create notification record
        notification_id = str(uuid.uuid4())
        notification_data = {
            'candidateId': candidate_id,
            'applicationId': application_id,
            'type': 'rejection',
            'sentDate': datetime.now().isoformat(),
            'content': f"Rejection email for {job_title}",
            'status': 'sent' if email_sent else 'failed'
        }
        
        firebase_client.create_document('emailNotifications', notification_id, notification_data)
        
        return {
            "success": True,
            "message": "Rejection email sent successfully",
            "emailSent": email_sent
        }
    
    except Exception as e:
        logger.error(f"Error sending rejection: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send rejection: {str(e)}")