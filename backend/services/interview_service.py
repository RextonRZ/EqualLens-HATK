from typing import Dict, Any, Optional, List
import re

import pytz
from fastapi import HTTPException
from datetime import datetime
from firebase_admin import firestore, storage
import secrets
import string
import hashlib
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import smtplib
import time
import logging
import tempfile
from google.cloud import speech
from google.cloud import videointelligence_v1 as videointelligence
from services.gemini_service import GeminiService
import asyncio
import subprocess
from concurrent.futures import ThreadPoolExecutor
import io
import platform
import numpy as np
from google.cloud import language_v1
import librosa
import torch
from transformers import AutoTokenizer, AutoModel
from sklearn.metrics.pairwise import cosine_similarity
import requests
from pydub import AudioSegment
from pydub.generators import Sine

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python_tasks
from mediapipe.tasks.python import vision as mp_vision

logger = logging.getLogger(__name__)
LINK_EXPIRY_DAYS = 7
FACE_LANDMARKER_MODEL_PATH = os.getenv("FACE_LANDMARKER_MODEL_PATH", "models/face_landmarker.task")
if not os.path.exists(FACE_LANDMARKER_MODEL_PATH):
    logger.error(f"MediaPipe Face Landmarker model not found at: {FACE_LANDMARKER_MODEL_PATH}")

# --- MediaPipe Configuration ---
BaseOptions = mp_python_tasks.BaseOptions
FaceLandmarker = mp_vision.FaceLandmarker
FaceLandmarkerOptions = mp_vision.FaceLandmarkerOptions
VisionRunningMode = mp_vision.RunningMode


def create_face_landmarker_options():
    # Check again inside function in case path wasn't valid at startup but is now
    if not os.path.exists(FACE_LANDMARKER_MODEL_PATH):
        raise FileNotFoundError(f"MediaPipe model not found: {FACE_LANDMARKER_MODEL_PATH}")
    return FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=FACE_LANDMARKER_MODEL_PATH),
        running_mode=VisionRunningMode.VIDEO,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=False,  # Usually not needed for expression
        num_faces=1  # Optimize for single candidate interview
    )

# Initialize clients globally
try:
    nlp_client = language_v1.LanguageServiceClient()
    speech_client = speech.SpeechClient()
    video_client = videointelligence.VideoIntelligenceServiceClient()
    embedding_tokenizer = AutoTokenizer.from_pretrained("sentence-transformers/all-MiniLM-L6-v2")
    embedding_model = AutoModel.from_pretrained("sentence-transformers/all-MiniLM-L6-v2")
    gemini_service = GeminiService()
except Exception as e:
    logger.error(f"Failed to initialize Google Cloud clients, embedding model or gemini service: {e}")
    raise

def get_db():
    """Return the Firestore database client"""
    try:
        return firestore.client()
    except Exception as e:
        logger.error(f"Error getting Firestore client: {e}")
        raise HTTPException(status_code=500, detail="Failed to connect to database")

def get_storage():
    """Return the Firebase Storage bucket"""
    try:
        from firebase_admin import storage
        import os
        
        # Try to get bucket name from environment variable
        bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET")
        
        # If no bucket name in environment, construct default name
        if not bucket_name:
            from firebase_admin import storage
            from firebase_admin import _apps
            project_id = list(_apps.values())[0].project_id
            bucket_name = f"{project_id}.firebasestorage.com"
        
        return storage.bucket(bucket_name)
    except Exception as e:
        logger.error(f"Error getting Storage bucket: {e}")
        raise HTTPException(status_code=500, detail="Failed to connect to storage")
    
    return storage.bucket(bucket_name)

def generate_link_code(application_id: str, candidate_id: str) -> str:
    """Generate a secure random link code"""
    # Create a random string (16 characters)
    random_part = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(16))
    
    # Add a hash of the application and candidate IDs for extra security
    hash_base = f"{application_id}:{candidate_id}:{time.time()}"
    hash_part = hashlib.sha256(hash_base.encode()).hexdigest()[:8]
    
    # Combine for the final code
    return f"{random_part}{hash_part}"

def send_interview_email(email: str, candidate_name: str, job_title: str, 
                         interview_link: str, scheduled_date: datetime) -> bool:    
    """Send interview invitation email to candidate"""
    try:
        # Get email credentials from environment variables
        smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
        smtp_username = os.getenv("SMTP_USERNAME", "")
        smtp_password = os.getenv("SMTP_PASSWORD", "")
        logo_url = os.getenv("EMAIL_LOGO_URL")  # Get the logo URL
        header_bg_color = "#F9645FFF"
        
        if not smtp_username or not smtp_password:
            logger.warning("SMTP credentials not set. Email would have been sent to: %s", email)
            return False
        
        # Create message
        msg = MIMEMultipart()
        msg['From'] = smtp_username
        msg['To'] = email
        msg['Subject'] = f"Interview Invitation for {job_title} Position"
        
        # Format date for display
        formatted_date = scheduled_date.strftime("%A, %B %d, %Y at %I:%M %p") if scheduled_date else "your convenience"

        if logo_url:
            logo_html = f'<img src="{logo_url}" alt="EqualLens Logo" style="width: 150px; height: auto; display: block; margin: 0 auto; border: 0;">'
        else:
            logo_html = f'<h1 style="color: #FFFFFF; margin: 0; padding: 0;">EqualLens</h1>'

        # Email body
        body = f"""
                <html>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4;">
                    <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border: 1px solid #ddd; border-radius: 10px; overflow: hidden;">
                        <div style="text-align: center; padding: 20px 15px; background-color: {header_bg_color}; border-bottom: 1px solid #eee;">
                            {logo_html}
                        </div>
                        <div style="padding: 25px;">
                            <p>Dear {candidate_name},</p>
                            <p>Congratulations! You have been selected for an interview for the <strong>{job_title}</strong> position.</p>
                            <p>Your interview is active until <strong>{formatted_date}</strong>. Please attempt the interview before the stated date.</p>
                            <p>Please click the button below to access your interview portal:</p>
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="{interview_link}" style="background-color: {header_bg_color}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Start Your Interview</a>
                            </div>
                            <p><strong>Important Instructions:</strong></p>
                            <ul>
                                <li>Please have your identification (ID card, passport, or driver's license) ready for verification.</li>
                                <li>Ensure you have a working camera and microphone.</li>
                                <li>Find a quiet place with good lighting for your interview.</li>
                                <li>Each question will have a time limit, so please be prepared to answer promptly.</li>
                            </ul>
                            <p>This interview link will expire in {os.getenv('LINK_EXPIRY_DAYS', 3)} days.</p> 
                            <p>If you encounter any technical issues, please contact support@equallens.com.</p>
                            <p>Best of luck!</p>
                            <p>The EqualLens Team</p>
                        </div>
                    </div>
                </body>
                </html>
                """
        
        msg.attach(MIMEText(body, 'html'))
        
        # Connect to server and send email
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(smtp_username, smtp_password)
        server.send_message(msg)
        server.quit()
        
        logger.info("Interview email sent successfully to %s", email)
        return True
    except Exception as e:
        logger.error("Failed to send interview email: %s", str(e))
        return False

def send_physical_interview_email(
    email: str,
    candidate_name: str,
    job_title: str,
    date_str: str,
    time_str: str,
    location: str,
    contact_person: str,
    additional_info: Optional[str] = None
) -> bool:
    """Send physical interview invitation email to candidate"""
    try:
        # Get email credentials and LOGO URL from environment variables
        smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
        smtp_username = os.getenv("SMTP_USERNAME", "")
        smtp_password = os.getenv("SMTP_PASSWORD", "")
        logo_url = os.getenv("EMAIL_LOGO_URL") # Get the logo URL

        if not smtp_username or not smtp_password:
            logger.warning("SMTP credentials not set. Email would have been sent to: %s", email)
            return False

        # Create message
        msg = MIMEMultipart()
        msg['From'] = smtp_username
        msg['To'] = email
        msg['Subject'] = f"Invitation: Physical Interview for {job_title} Position"

        # --- Format date and time (keep existing logic) ---
        try:
            date_obj = datetime.strptime(date_str, '%Y-%m-%d')
            formatted_date = date_obj.strftime("%A, %B %d, %Y")
        except ValueError:
            formatted_date = date_str
        try:
            time_obj = datetime.strptime(time_str, '%H:%M')
            formatted_time = time_obj.strftime("%I:%M %p")
        except ValueError:
            formatted_time = time_str

        # --- Create Logo HTML (conditionally) ---
        # Use a background color suitable for the white logo
        header_bg_color = "#F9645FFF" # Example: Blue background
        if logo_url:
            logo_html = f'<img src="{logo_url}" alt="EqualLens Logo" style="width: 150px; height: auto; display: block; margin: 0 auto; border: 0;">'
        else:
            # Fallback to text if logo URL is not set
            logo_html = f'<h1 style="color: #FFFFFF; margin: 0; padding: 0;">EqualLens</h1>' # White text on colored background

        # --- Email body ---
        body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border: 1px solid #ddd; border-radius: 10px; overflow: hidden;">
                <div style="text-align: center; padding: 10px 5px; background-color: {header_bg_color}; border-bottom: 1px solid #eee;">
                    {logo_html}
                </div>
                <div style="padding: 15px;"> 
                    <p>Dear {candidate_name},</p>
                    <p>Following your recent application and initial interview stages for the <strong>{job_title}</strong> position, we would like to invite you for a physical interview.</p>
                    <p>This is an opportunity for us to discuss your qualifications further and for you to learn more about our team and the role.</p>

                    <h3 style="color: #333; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Interview Details:</h3>
                    <p><strong>Date:</strong> {formatted_date}</p>
                    <p><strong>Time:</strong> {formatted_time}</p>
                    <p><strong>Location:</strong> {location}</p>
                    <p><strong>Contact Person upon Arrival:</strong> {contact_person}</p>

                    {additional_info and f'''
                    <h3 style="color: #333; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Additional Information:</h3>
                    <div style="white-space: pre-wrap; background-color: #f9f9f9; padding: 10px; border-radius: 4px; border: 1px solid #eee;">{additional_info}</div>
                    '''}

                    <p style="margin-top: 25px;">Please reply to this email to confirm your availability for this scheduled time. If you are unable to make this time, please let us know as soon as possible so we can attempt to reschedule.</p>
                    <p>We look forward to meeting you!</p>
                    <p>Sincerely,</p>
                    <p>The EqualLens Recruiting Team</p>
                </div>
            </div>
        </body>
        </html>
        """

        msg.attach(MIMEText(body, 'html'))

        # Connect to server and send email (keep existing logic)
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(smtp_username, smtp_password)
        server.send_message(msg)
        server.quit()

        logger.info("Physical interview invitation email sent successfully to %s", email)
        return True
    except Exception as e:
        logger.error(f"Failed to send physical interview email: {str(e)}", exc_info=True)
        return False

def send_rejection_email(email: str, candidate_name: str, job_title: str) -> bool:
    """Send rejection email to candidate"""
    try:
        # Get email credentials from environment variables
        smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
        smtp_username = os.getenv("SMTP_USERNAME", "")
        smtp_password = os.getenv("SMTP_PASSWORD", "")
        logo_url = os.getenv("EMAIL_LOGO_URL")  # Get the logo URL

        if not smtp_username or not smtp_password:
            logger.warning("SMTP credentials not set. Email would have been sent to: %s", email)
            return False

        # Create message
        msg = MIMEMultipart()
        msg['From'] = smtp_username
        msg['To'] = email
        msg['Subject'] = f"Update Regarding Your Application for {job_title} Position"

        header_bg_color = "#F9645FFF"  # Example: Blue background
        if logo_url:
            logo_html = f'<img src="{logo_url}" alt="EqualLens Logo" style="width: 150px; height: auto; display: block; margin: 0 auto; border: 0;">'
        else:
            # Fallback to text if logo URL is not set
            logo_html = f'<h1 style="color: #FFFFFF; margin: 0; padding: 0;">EqualLens</h1>'  # White text on colored background

        # Email body
        body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <div style="text-align: center; padding: 10px 5px; background-color: {header_bg_color}; border-bottom: 1px solid #eee;">
                    {logo_html}
                </div>
                <div style="padding: 15px;"> 
                <p>Dear {candidate_name},</p>
                <p>Thank you for your interest in the <strong>{job_title}</strong> position and for taking the time to apply.</p>
                <p>After careful consideration of your application, we regret to inform you that we have decided to move forward with other candidates whose qualifications more closely align with our current needs.</p>
                <p>We appreciate your interest in our organization and encourage you to apply for future positions that match your skills and experience.</p>
                <p>We wish you the best of luck in your job search and professional endeavors.</p>
                <p>Sincerely,</p>
                <p>The EqualLens Recruiting Team</p>
            </div>
        </body>
        </html>
        """
        
        msg.attach(MIMEText(body, 'html'))
        
        # Connect to server and send email
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(smtp_username, smtp_password)
        server.send_message(msg)
        server.quit()
        
        logger.info("Rejection email sent successfully to %s", email)
        return True
    except Exception as e:
        logger.error("Failed to send rejection email: %s", str(e))
        return False


# Add this function to interview_service.py
def send_job_offer_email(email: str, candidate_name: str, job_title: str) -> bool:
    """Send job offer email to candidate"""
    try:
        # Get email credentials from environment variables
        smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
        smtp_username = os.getenv("SMTP_USERNAME", "")
        smtp_password = os.getenv("SMTP_PASSWORD", "")
        logo_url = os.getenv("EMAIL_LOGO_URL")  # Get the logo URL

        if not smtp_username or not smtp_password:
            logger.warning("SMTP credentials not set. Email would have been sent to: %s", email)
            return False

        # Create message
        msg = MIMEMultipart()
        msg['From'] = smtp_username
        msg['To'] = email
        msg['Subject'] = f"Job Offer - {job_title} Position"

        header_bg_color = "#F9645FFF"  # Example: Blue background
        if logo_url:
            logo_html = f'<img src="{logo_url}" alt="EqualLens Logo" style="width: 150px; height: auto; display: block; margin: 0 auto; border: 0;">'
        else:
            # Fallback to text if logo URL is not set
            logo_html = f'<h1 style="color: #FFFFFF; margin: 0; padding: 0;">EqualLens</h1>'  # White text on colored background

        # Email body
        body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <div style="text-align: center; padding: 10px 5px; background-color: {header_bg_color}; border-bottom: 1px solid #eee;">
                    {logo_html}
                </div>
                <div style="padding: 15px;"> 
                <div style="text-align: center; margin-bottom: 20px;">
                    <h1 style="color: #4caf50;">Congratulations!</h1>
                </div>
                <p>Dear {candidate_name},</p>
                <p>We are delighted to offer you the position of <strong>{job_title}</strong> at EqualLens.</p>
                <p>After careful consideration of your qualifications, experience, and performance in the interview process, we believe you are an excellent fit for our team and company culture.</p>
                <p>Our HR department will contact you within the next 2-3 business days to discuss the details of your employment, including:</p>
                <ul>
                    <li>Start date</li>
                    <li>Compensation package</li>
                    <li>Benefits information</li>
                    <li>Onboarding process</li>
                </ul>
                <p>Please feel free to email us if you have any questions before then.</p>
                <p>We are excited about the possibility of you joining our team and contributing to our success.</p>
                <p>Sincerely,</p>
                <p>The EqualLens Recruiting Team</p>
            </div>
        </body>
        </html>
        """

        msg.attach(MIMEText(body, 'html'))

        # Connect to server and send email
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(smtp_username, smtp_password)
        server.send_message(msg)
        server.quit()

        logger.info("Job offer email sent successfully to %s", email)
        return True
    except Exception as e:
        logger.error("Failed to send job offer email: %s", str(e))
        return False


def validate_interview_link(interview_id: str, link_code: str, allow_resumption: bool = False):
    """
    Validate if the interview link is valid, not expired, and in the correct status.
    Optionally allows resumption if status is 'in_progress'.
    """
    db = get_db()

    interview_ref = db.collection('interviewLinks').document(interview_id)
    interview_doc = interview_ref.get()

    if not interview_doc.exists:
        raise HTTPException(status_code=404, detail="Interview link not found or invalid.")  # More generic message

    interview_data = interview_doc.to_dict()
    current_status = interview_data.get('status', 'pending')

    # Check if link code matches
    if interview_data.get('linkCode') != link_code:
        # Log this attempt for security auditing?
        logger.warning(f"Invalid link code attempt for interview {interview_id}")
        raise HTTPException(status_code=403, detail="Interview link not found or invalid.")

    # Check if link has expired
    expiry_date_ts = interview_data.get('expiryDate')
    if expiry_date_ts:
        # Ensure expiry_date is offset-naive UTC for comparison
        if expiry_date_ts.tzinfo:
            expiry_date = expiry_date_ts.astimezone(pytz.utc).replace(tzinfo=None)
        else:
            # Assume stored as UTC if no timezone info
            expiry_date = expiry_date_ts

        if datetime.utcnow() > expiry_date:
            # Optionally update status to expired if it's pending or in_progress
            if current_status in ['pending', 'in_progress']:
                interview_ref.update({'status': 'expired'})
            raise HTTPException(status_code=403, detail="Interview link has expired.")
    else:
        logger.warning(f"Interview {interview_id} missing expiryDate.")
        # Decide policy: fail or allow? Failing is safer.
        raise HTTPException(status_code=500, detail="Interview configuration error (missing expiry).")

    # Check status based on whether resumption is allowed
    if allow_resumption:
        # Allow entry if pending or in_progress
        if current_status not in ['pending', 'in_progress']:
            if current_status == 'completed':
                raise HTTPException(status_code=400, detail="This interview has already been completed.")
            elif current_status == 'abandoned':
                raise HTTPException(status_code=400, detail="This interview was previously abandoned.")
            elif current_status == 'expired':  # Already handled above, but belts and suspenders
                raise HTTPException(status_code=403, detail="Interview link has expired.")
            else:  # Other unexpected statuses
                raise HTTPException(status_code=400, detail=f"Interview cannot be accessed (status: {current_status}).")
    else:
        # Strict: Only allow entry if status is 'pending'
        if current_status != 'pending':
            if current_status == 'in_progress':
                raise HTTPException(status_code=400, detail="This interview is already in progress.")
            elif current_status == 'completed':
                raise HTTPException(status_code=400, detail="This interview has already been completed.")
            elif current_status == 'abandoned':
                raise HTTPException(status_code=400, detail="This interview was previously abandoned.")
            elif current_status == 'expired':
                raise HTTPException(status_code=403, detail="Interview link has expired.")
            else:
                raise HTTPException(status_code=400, detail=f"Interview cannot be accessed (status: {current_status}).")

    # Return data along with the status to inform the frontend
    interview_data['current_status'] = current_status
    return interview_data

def extract_audio_with_ffmpeg(input_video_path, output_audio_path=None):
    """
    Extract audio from video using FFmpeg with improved quality settings
    
    Args:
        input_video_path (str): Path to input video file
        output_audio_path (str, optional): Path for output audio file
    
    Returns:
        str: Path to extracted audio file
    """
    ffmpeg_path = None

    # Determine ffmpeg path based on platform
    if platform.system() == "Darwin":  # macOS
        potential_paths = [
            '/opt/homebrew/bin/ffmpeg',
            '/usr/local/bin/ffmpeg'
        ]
        
        for path in potential_paths:
            if os.path.exists(path):
                ffmpeg_path = path
                break
                
        if not ffmpeg_path:
            raise RuntimeError("FFmpeg not found. Please install it with 'brew install ffmpeg'")
    else:
        # For Windows and others, try multiple paths
        potential_windows_paths = [
            r'C:\Users\ooiru\Downloads\ffmpeg-2025-03-31-git-35c091f4b7-full_build\ffmpeg-2025-03-31-git-35c091f4b7-full_build\bin\ffmpeg.exe',
            r'C:\Users\hongy\Downloads\ffmpeg-n6.1-latest-win64-gpl-6.1\bin\ffmpeg.exe'
        ]
        
        for path in potential_windows_paths:
            if os.path.exists(path):
                ffmpeg_path = path
                break
                
        if not ffmpeg_path:
            ffmpeg_path = 'ffmpeg'  # Fallback to PATH
    
    if not input_video_path or not os.path.exists(input_video_path):
        raise ValueError(f"Invalid input video path: {input_video_path}")
    
    # If no output path specified, generate one
    if output_audio_path is None:
        temp_audio_file = tempfile.NamedTemporaryFile(delete=False, suffix="_audio.wav")
        output_audio_path = temp_audio_file.name
        temp_audio_file.close()
    
    try:
        command = [
            ffmpeg_path, 
            '-i', input_video_path,   # Input video file
            '-vn',                    # Ignore video stream
            '-acodec', 'pcm_s16le',   # PCM 16-bit format
            '-ar', '16000',           # Higher sample rate (16kHz) for better quality
            '-ac', '1',               # Mono channel
            '-af', 'highpass=f=80,lowpass=f=7500,dynaudnorm=f=150:g=15',
            '-y',                     # Overwrite output file
            output_audio_path         # Output audio file
        ]
        
        # Run FFmpeg command
        result = subprocess.run(
            command, 
            stdout=subprocess.PIPE,  
            stderr=subprocess.PIPE,
            check=True,
            text=True
        )
        logger.info(f"FFmpeg stdout: {result.stdout}")
        logger.info(f"FFmpeg stderr: {result.stderr}")
        
        # Verify output file was created
        if not os.path.exists(output_audio_path):
            raise RuntimeError("Audio extraction failed: No output file created")
        
        logging.info(f"Audio extracted successfully with improved quality: {output_audio_path}")
        return output_audio_path
    
    except subprocess.CalledProcessError as e:
        logging.error(f"FFmpeg error: {e.stderr.decode() if e.stderr else str(e)}")
        
        # Fallback to simpler settings if enhanced version fails
        try:
            logging.warning("Trying fallback audio extraction with basic settings")
            fallback_command = [
                ffmpeg_path, 
                '-i', input_video_path,
                '-vn',
                '-acodec', 'pcm_s16le',
                '-ar', '16000',  # Still use 16kHz but without filters
                '-ac', '1',
                '-y',
                output_audio_path
            ]
            
            subprocess.run(fallback_command, check=True)
            
            if os.path.exists(output_audio_path):
                logging.info(f"Fallback audio extraction succeeded: {output_audio_path}")
                return output_audio_path
        except Exception as fallback_error:
            logging.error(f"Fallback audio extraction also failed: {str(fallback_error)}")
        raise
    except Exception as e:
        logging.error(f"Unexpected error in audio extraction: {str(e)}")
        raise

async def transcribe_audio_with_google_cloud(gcs_uri):
    """
    Improved transcription function using Google Cloud Speech-to-Text API
    Args:
        gcs_uri (str): GCS URI of the audio file
    Returns:
        dict: Enhanced transcription results with transcript and confidence
    """
    try:
        # Instantiate a client
        client = speech.SpeechClient()

        # Configure audio input using the GCS URI
        audio = speech.RecognitionAudio(uri=gcs_uri)
        
        interview_phrases = [
            "interview", "job", "experience", "skills", "role", "position",
            "team", "project", "management", "development", "challenges",
            "achievements", "responsibilities", "education", "degree",
            "certificate", "training", "leadership", "communication",
            "problem-solving", "technical", "professional", "background", 
            "opportunity", "career", "goals", "objectives", "salary",
            "work", "employment", "remote", "hybrid", "flexible"
        ]
        
        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
            sample_rate_hertz=16000,
            language_code='en-US',
            enable_automatic_punctuation=True,
            model='latest_long',
            profanity_filter=False,
            speech_contexts=[
                speech.SpeechContext(
                    phrases=interview_phrases,
                    boost=15.0  # Boost recognition of these phrases
                )
            ],
            enable_word_time_offsets=True,
            enable_word_confidence=True,
            max_alternatives=2
        )

        # Use long_running_recognize for all audio files
        operation = client.long_running_recognize(config=config, audio=audio)
        response = await asyncio.to_thread(operation.result, timeout=300)

        if not response.results:
            return {
                'transcript': "",
                'confidence': 0.0,
                'raw_results': None,
                'word_count': 0,
                'word_timings': []  # Return empty array for word timings
            }
        
        # IMPROVED: Better processing of results
        transcripts = []
        confidence_scores = []
        word_count = 0
        word_timings = []  # List to store word timing information
        word_index = 0  # Global index to track position in full transcript

        for result in response.results:
            if result.alternatives:  # Check if alternatives exist
                best_alternative = result.alternatives[0]
                transcripts.append(best_alternative.transcript)
                # Confidence is per-word in latest models, calc avg if available
                if best_alternative.words:
                    confidence_scores.extend([w.confidence for w in best_alternative.words])
                else:
                    confidence_scores.append(best_alternative.confidence if hasattr(best_alternative,
                                                                                    'confidence') else 0.8)  # Fallback confidence

                # Process word-level information
                for word_info in best_alternative.words:
                    start_time = word_info.start_time.total_seconds()
                    end_time = word_info.end_time.total_seconds()

                    word_timings.append({
                        'word': word_info.word,
                        'startTime': start_time,
                        'endTime': end_time,
                        'confidence': word_info.confidence,
                        'index': word_index
                    })
                    word_index += 1
                word_count += len(best_alternative.words)  # More accurate count
        
        # IMPROVED: Post-process transcript for better readability
        full_transcript = ' '.join(transcripts)
        
        # Normalize the transcript
        processed_transcript = post_process_transcript(full_transcript)

        avg_confidence = np.mean(confidence_scores) if confidence_scores else 0.0
        logger.info(f"Transcription successful for {gcs_uri}, Confidence: {avg_confidence:.2f}, Words: {word_count}")

        return {
            'transcript': processed_transcript,
            'confidence': avg_confidence,
            'word_count': word_count,
            'word_timings': word_timings,  # Include word timings in the response
            'raw_results': response.results
        }
    
    except Exception as e:
        logging.error(f"Google Cloud Speech-to-Text error: {str(e) if e is not None else 'Unknown error'}")
        return {
            'transcript': f"Transcription error: {str(e)}",
            'confidence': 0.0,
            'word_count': 0,
            'word_timings': [],
            'raw_results': None
        }


import asyncio
from collections import Counter
import logging
from typing import Dict, Any
from google.protobuf.duration_pb2 import Duration # Import Duration

logger = logging.getLogger(__name__)

async def analyze_video_expressions_mediapipe(gcs_uri: str, frames_per_second_to_process: int = 2) -> Dict[str, Any]:
    """
    Analyzes video from GCS using MediaPipe FaceLandmarker for blendshapes.

    Args:
        gcs_uri: GCS URI of the video file (e.g., gs://bucket/path/to/video.webm).
        frames_per_second_to_process: How many frames per second to analyze.

    Returns:
        A dictionary containing aggregated blendshape statistics or an error message.
    """
    logger.info(f"Starting MediaPipe facial expression analysis for video: {gcs_uri}")
    temp_video_path = None
    landmarker = None # Initialize landmarker variable

    try:
        if not gcs_uri.startswith("gs://"):
            raise ValueError("Invalid GCS URI format.")

        bucket_name = gcs_uri.split('/')[2]
        blob_name = '/'.join(gcs_uri.split('/')[3:])

        # Get bucket reference using firebase_admin.storage
        bucket = storage.bucket(bucket_name)
        if not bucket:
            raise ValueError(
                f"Could not get bucket reference for '{bucket_name}'. Check Firebase Admin initialization and bucket name.")
        blob = bucket.blob(blob_name)
        if not await asyncio.to_thread(blob.exists):
            raise FileNotFoundError(f"Blob not found at GCS URI: {gcs_uri}")

        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_video_file:
            temp_video_path = temp_video_file.name
        logger.info(f"Downloading {gcs_uri} to {temp_video_path}")
        await asyncio.to_thread(blob.download_to_filename, temp_video_path)
        logger.info(f"Video downloaded successfully.")

        # 2. Process video frame by frame using OpenCV and MediaPipe
        # This whole block is CPU/potentially GPU intensive and blocking, run in executor
        def process_video():
            nonlocal landmarker, frames_per_second_to_process
            try:
                # Initialize MediaPipe FaceLandmarker within the thread
                options = create_face_landmarker_options()
                landmarker = FaceLandmarker.create_from_options(options)
                logger.info("MediaPipe FaceLandmarker initialized.")

                cap = cv2.VideoCapture(temp_video_path)
                if not cap.isOpened():
                    logger.error(f"Error opening video file: {temp_video_path}")
                    return {"error": "Could not open video file for processing."}

                fps = cap.get(cv2.CAP_PROP_FPS)
                frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                logger.info(f"Video properties: FPS={fps:.2f}, FrameCount={frame_count}")

                if frames_per_second_to_process <= 0:
                    logger.warning("frames_per_second_to_process must be positive, defaulting to 1.")
                    frames_per_second_to_process = 1
                frame_interval_ms = 1000 / frames_per_second_to_process
                logger.info(
                    f"Targeting analysis interval: {frame_interval_ms:.2f} ms ({frames_per_second_to_process} FPS)")

                frame_timestamp_ms = 0
                processed_frame_count = 0
                all_blendshapes_data = [] # Store list of dictionaries

                while cap.isOpened():
                    success, frame = cap.read()
                    if not success:
                        break

                    current_frame_time_ms = int(cap.get(cv2.CAP_PROP_POS_MSEC))

                    # Process frame at the desired interval
                    if current_frame_time_ms >= frame_timestamp_ms:
                        processed_frame_count += 1
                        # Convert BGR (OpenCV default) to RGB (MediaPipe standard)
                        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

                        # Detect landmarks and blendshapes for the current frame timestamp
                        detection_result = landmarker.detect_for_video(mp_image, current_frame_time_ms)

                        # Extract blendshapes if detected
                        if detection_result and detection_result.face_blendshapes:
                            # Append the list of blendshape Category objects for the first detected face
                            # (assuming num_faces=1 in options)
                            all_blendshapes_data.append(detection_result.face_blendshapes[0])

                        # Update the timestamp for the next frame to process
                        frame_timestamp_ms += frame_interval_ms + 1

                cap.release()
                logger.info(f"Finished processing video. Analyzed approx {processed_frame_count} frames.")

                if not all_blendshapes_data:
                    logger.warning(f"No blendshapes detected in video {gcs_uri}")
                    return {"error": "No facial blendshapes detected."}

                # 3. Aggregate and Summarize Blendshape Data
                aggregated_scores = {}
                for frame_blendshapes in all_blendshapes_data:
                    for blendshape_category in frame_blendshapes:
                        name = blendshape_category.category_name
                        score = blendshape_category.score
                        if name not in aggregated_scores:
                            aggregated_scores[name] = []
                        aggregated_scores[name].append(score)

                summary = {}
                # Define key blendshapes relevant to interview analysis (customize this list)
                key_blendshapes = [
                    'mouthSmileLeft', 'mouthSmileRight',
                    'mouthFrownLeft', 'mouthFrownRight',
                    'browDownLeft', 'browDownRight',
                    'browInnerUp', #'browOuterUpLeft', 'browOuterUpRight', # Often subtle
                    'eyeBlinkLeft', 'eyeBlinkRight', #'eyeSquintLeft', 'eyeSquintRight',
                    'jawOpen', #'mouthPucker', 'mouthShrugUpper'
                    # Add others as needed based on experimentation
                ]

                for name in key_blendshapes:
                    scores = aggregated_scores.get(name, []) # Get scores or empty list if not detected
                    if scores:
                        summary[f"{name}_mean"] = float(np.mean(scores)) # Ensure float for JSON
                        summary[f"{name}_max"] = float(np.max(scores))
                        summary[f"{name}_std"] = float(np.std(scores))
                        # Optional: Add score presence ratio?
                        # summary[f"{name}_presence"] = len(scores) / processed_frame_count
                    else:
                         # Provide default zero values if a key blendshape wasn't found at all
                         summary[f"{name}_mean"] = 0.0
                         summary[f"{name}_max"] = 0.0
                         summary[f"{name}_std"] = 0.0

                logger.info(f"MediaPipe analysis summary generated for {gcs_uri}")
                return {"analysis": summary} # Return the summary dictionary

            finally:
                 # Ensure landmarker is closed even if errors occur during processing
                 if landmarker:
                     landmarker.close()
                     logger.info("MediaPipe FaceLandmarker closed.")

        # Run the blocking video processing in a separate thread
        loop = asyncio.get_running_loop()
        analysis_result = await loop.run_in_executor(None, process_video)
        return analysis_result

    except FileNotFoundError as fnf_err:
        logger.error(f"MediaPipe model file error: {fnf_err}")
        return {"error": f"Configuration error: {fnf_err}"}
    except Exception as e:
        logger.exception(f"Error during MediaPipe analysis pipeline for {gcs_uri}: {e}")
        return {"error": f"Failed to analyze video expressions using MediaPipe: {str(e)}"}
    finally:
        # 4. Cleanup the temporary video file
        if temp_video_path and os.path.exists(temp_video_path):
            try:
                os.unlink(temp_video_path)
                logger.info(f"Deleted temporary video file: {temp_video_path}")
            except Exception as e_clean:
                logger.error(f"Error deleting temporary video file {temp_video_path}: {e_clean}")

def post_process_transcript(transcript):
    """
    Post-process transcript to improve readability and correctness
    
    Args:
        transcript: Raw transcript text
        
    Returns:
        str: Improved transcript
    """
    # Remove extra spaces
    cleaned = ' '.join(transcript.split())
    
    # Remove repeated words (common in speech-to-text output)
    words = cleaned.split()
    deduped_words = []
    for i, word in enumerate(words):
        if i == 0 or word.lower() != words[i-1].lower():
            deduped_words.append(word)
    
    cleaned = ' '.join(deduped_words)
    
    # Fix capitalization
    if cleaned and len(cleaned) > 0:
        # Capitalize first letter
        cleaned = cleaned[0].upper() + cleaned[1:]
        
        # Capitalize after periods, question marks, and exclamation points
        for i in range(1, len(cleaned)-1):
            if cleaned[i-1] in ['.', '!', '?'] and cleaned[i] == ' ':
                cleaned = cleaned[:i+1] + cleaned[i+1].upper() + cleaned[i+2:]
    
    # Ensure transcript ends with punctuation
    if cleaned and not cleaned[-1] in ['.', '!', '?']:
        cleaned += '.'
    
    return cleaned

def parallel_audio_extraction(video_paths):
    """
    Extract audio from multiple videos in parallel
    
    Args:
        video_paths (list): List of video file paths
    
    Returns:
        list: Paths to extracted audio files
    """
    with ThreadPoolExecutor() as executor:
        # Use max_workers to control CPU usage
        return list(executor.map(extract_audio_with_ffmpeg, video_paths))

def apply_voice_effect(input_audio_path, effect_type="helium", output_audio_path=None):
    """
    Apply voice changing effect to audio file using FFmpeg
    
    Args:
        input_audio_path (str): Path to input audio file
        effect_type (str): Type of effect to apply ('helium' for pitch shift)
        output_audio_path (str, optional): Path for output modified audio file
    
    Returns:
        str: Path to modified audio file
    """

     # Determine ffmpeg path based on platform
    if platform.system() == "Darwin":  # macOS
        # Try homebrew path first, fallback to others
        potential_paths = [
            '/opt/homebrew/Cellar/ffmpeg@6/6.1.2_8/bin/ffmpeg',  
            '/opt/homebrew/bin/ffmpeg',                          # Common Homebrew location
            '/usr/local/bin/ffmpeg'                              # Alternative location
        ]
        
        ffmpeg_path = None
        for path in potential_paths:
            if os.path.exists(path):
                ffmpeg_path = path
                break
                
        if not ffmpeg_path:
            raise RuntimeError("FFmpeg not found. Please install it with 'brew install ffmpeg'")
    else:
        # For Windows and others, try multiple paths
        potential_windows_paths = [
            r'C:\Users\ooiru\Downloads\ffmpeg-2025-03-31-git-35c091f4b7-full_build\ffmpeg-2025-03-31-git-35c091f4b7-full_build\bin\ffmpeg.exe',
            r'C:\Users\hongy\Downloads\ffmpeg-n6.1-latest-win64-gpl-6.1\bin\ffmpeg.exe'
        ]
        
        ffmpeg_path = None
        for path in potential_windows_paths:
            if os.path.exists(path):
                ffmpeg_path = path
                break
                
        if not ffmpeg_path:
            ffmpeg_path = 'ffmpeg'  # Fallback to PATH
    
    if not input_audio_path or not os.path.exists(input_audio_path):
        raise ValueError(f"Invalid or non-existent input audio path: {input_audio_path}")

    # If no output path specified, generate one in the system's temp directory
    if output_audio_path is None:
        # Create a temporary file that persists after closing, get its name
        fd, temp_output_path = tempfile.mkstemp(suffix="_modified.wav")
        os.close(fd) # Close the file handle immediately
        output_audio_path = temp_output_path
        logging.info(f"Output path not specified, using temporary file: {output_audio_path}")
    else:
        # Ensure the directory for the output path exists
        output_dir = os.path.dirname(output_audio_path)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)
            logging.info(f"Created output directory: {output_dir}")

    # Define base filter chain for clarity: Loudness normalization, band-pass filter
    # Adjust frequencies as needed: highpass removes rumble, lowpass removes hiss/high noise
    # Using EBU R128 standard for loudness normalization
    clarity_filters = "loudnorm=I=-16:LRA=11:TP=-1.5,highpass=f=100,lowpass=f=7000"

    # Define FFmpeg command based on effect type
    command = [
        ffmpeg_path,
        '-i', input_audio_path,
    ]

    effect_type_lower = effect_type.lower()

    if effect_type_lower == "disguise_up":
        # Moderate pitch up (e.g., 15-25% higher pitch = 1.15 to 1.25 factor)
        pitch_factor = 1.20
        # Apply pitch shift first, then clarity filters
        command.extend(['-af', f'rubberband=pitch={pitch_factor},{clarity_filters}'])
        logging.info(f"Applying 'disguise_up' effect with pitch factor {pitch_factor}")
    elif effect_type_lower == "disguise_down":
        # Moderate pitch down (e.g., 15-25% lower pitch = 0.85 to 0.75 factor)
        pitch_factor = 0.80
        # Apply pitch shift first, then clarity filters
        command.extend(['-af', f'rubberband=pitch={pitch_factor},{clarity_filters}'])
        logging.info(f"Applying 'disguise_down' effect with pitch factor {pitch_factor}")
    elif effect_type_lower == "helium":
        # Original Helium effect (higher pitch shift)
        pitch_factor = 1.5 # Example value for helium, adjust if needed
        command.extend(['-af', f'rubberband=pitch={pitch_factor},{clarity_filters}'])
        logging.info(f"Applying 'helium' effect with pitch factor {pitch_factor}")
    else:
        command.extend(['-af', clarity_filters])
        logging.info(f"Effect type '{effect_type}' not recognized or 'none'. Applying only clarity filters.")

    # Common output settings for consistency and clarity
    command.extend([
        '-ar', '16000',  # Standard sample rate for speech processing
        '-ac', '1',      # Convert to mono for focus
        '-y',            # Overwrite output file without asking
        output_audio_path
    ])

    try:
        logging.info(f"Running FFmpeg command: {' '.join(command)}")
        # Run FFmpeg command
        result = subprocess.run(
            command,
            capture_output=True, # Capture stdout and stderr
            text=True,           # Decode stdout/stderr as text
            check=True           # Raise CalledProcessError on non-zero exit code
        )

        # FFmpeg often outputs info to stderr, so check returncode explicitly
        # The check=True above already handles non-zero return codes by raising an error.
        logging.info(f"FFmpeg stdout:\n{result.stdout}")
        if result.stderr: # Log stderr as well, as FFmpeg often puts useful info here
             logging.info(f"FFmpeg stderr:\n{result.stderr}")

        # Verify output file was created and is not empty
        if not os.path.exists(output_audio_path) or os.path.getsize(output_audio_path) == 0:
            # This check might be redundant if check=True caught an error, but good for robustness
            raise RuntimeError(f"Voice effect application failed: Output file not created or empty at {output_audio_path}")

        logging.info(f"Voice effect '{effect_type}' applied successfully: {output_audio_path}")
        return output_audio_path

    except subprocess.CalledProcessError as e:
        # Log the error details from FFmpeg's stderr
        logging.error(f"FFmpeg command failed with return code {e.returncode}")
        logging.error(f"FFmpeg stderr:\n{e.stderr}")
        logging.error(f"FFmpeg stdout:\n{e.stdout}") # Also log stdout for context
        # Clean up temporary output file if it exists and was generated by this function
        if output_audio_path == temp_output_path and os.path.exists(temp_output_path):
             try:
                 os.remove(temp_output_path)
                 logging.info(f"Cleaned up temporary file: {temp_output_path}")
             except OSError as rm_err:
                 logging.error(f"Error removing temporary file {temp_output_path}: {rm_err}")
        raise RuntimeError(f"FFmpeg execution failed: {e.stderr}") from e
    except Exception as e:
        logging.error(f"An unexpected error occurred during voice effect application: {str(e)}")
        # Clean up temporary output file if it exists and was generated by this function
        if output_audio_path == temp_output_path and os.path.exists(temp_output_path):
             try:
                 os.remove(temp_output_path)
                 logging.info(f"Cleaned up temporary file: {temp_output_path}")
             except OSError as rm_err:
                 logging.error(f"Error removing temporary file {temp_output_path}: {rm_err}")
        raise # Re-raise the original exception

# Defaults for analyzing transcripted audio using Librosa
DEFAULT_SR = 16000 # Target sample rate
FFT_HOP_LENGTH = 512 # Hop length for FFT calculations to detect clear or noisy

# Silence Detection Threshold 
# Threshold below which RMS energy is considered silence/background noise
SILENCE_THRESHOLD_RMS_RATIO = 0.05 # Ratio relative to max RMS

# Pitch (F0) Estimation Parameters
F0_MIN = 75  # Minimum expected fundamental frequency (Hz) - adjust for voice range
F0_MAX = 500 # Maximum expected fundamental frequency (Hz) - adjust for voice range

def format_explanation(feature_name, value, score, positive_impact, reason):
    """Helper to format explanation strings."""
    impact_str = "Positively" if positive_impact else "Negatively"
    value_str = f"{value:.2f}" if isinstance(value, float) else str(value)
    return f"{impact_str}: {feature_name} ({value_str}) contributed to score ({score:.2f}). Reason: {reason}."

# Used when the minimum and maximum are known
def normalize_min_max(value, min_expected, max_expected):
    """
    Normalizes a value to the [0, 1] range using min-max scaling.
    Clamps the result to ensure it stays within [0, 1].

    Args:
        value (float): The value to normalize.
        min_expected (float): The minimum expected value for the range.
        max_expected (float): The maximum expected value for the range.

    Returns:
        float: The normalized value (between 0.0 and 1.0).
    """
    if max_expected == min_expected:
        # Avoid division by zero. Return 0.5 if range is zero.
        return 0.5
    # Calculate normalized value
    normalized = (value - min_expected) / (max_expected - min_expected)
    # Clamp the result strictly between 0.0 and 1.0
    return np.clip(normalized, 0.0, 1.0)

# Used when optimal point is known
def normalize_optimal_point(value, optimal, max_deviation_allowed):
    """
    Normalizes a value to [0, 1] based on its distance from an optimal point.
    The score is 1.0 at the optimal point and decreases linearly to 0.0
    when the value is `max_deviation_allowed` away from the optimal point.

    Args:
        value (float): The value to normalize.
        optimal (float): The ideal or optimal value for this feature.
        max_deviation_allowed (float): The maximum absolute difference from the
                                       optimal value that is considered acceptable
                                       (results in a score > 0). Beyond this, score is 0.

    Returns:
        float: The normalized score (between 0.0 and 1.0).
    """
    if max_deviation_allowed <= 0:
        # If no deviation is allowed, score is 1 only if exactly optimal, else 0.
        return 1.0 if value == optimal else 0.0

    # Calculate the absolute difference from the optimal point
    deviation = abs(value - optimal)
    # Calculate how much the deviation contributes negatively, scaled by max allowed deviation
    normalized_deviation_effect = deviation / max_deviation_allowed
    # Score starts at 1.0 and decreases based on deviation. Clamp to ensure [0, 1].
    score = 1.0 - normalized_deviation_effect
    return np.clip(score, 0.0, 1.0)

# --- Weights for Combining Transcript/Audio into Final Metric Scores ---
# These weights determine the overall importance of the transcript vs. audio
# analysis for each final metric score. Sum should be 1.0 for each metric.
# *** TUNE THESE BASED ON YOUR SCORING PHILOSOPHY ***
W_FINAL_REL_T = 0.80    # Relevance: Transcript weight
W_FINAL_REL_A = 0.20    # Relevance: Audio weight

W_FINAL_CONF_T = 0.40   # Confidence: Transcript weight
W_FINAL_CONF_A = 0.60   # Confidence: Audio weight (vocal cues often key)

W_FINAL_CLAR_T = 0.50   # Clarity: Transcript weight
W_FINAL_CLAR_A = 0.50   # Clarity: Audio weight (both important)

W_FINAL_ENG_T = 0.30    # Engagement: Transcript weight
W_FINAL_ENG_A = 0.70    # Engagement: Audio weight (vocal dynamics crucial)

# --- Weights for Overall Score ---
W_OVERALL_REL = 0.15      # Relevance (Transcript vs Question)
W_OVERALL_CONF = 0.20     # Confidence (Audio + Linguistic)
W_OVERALL_CLAR = 0.20     # Clarity (Audio + Linguistic)
W_OVERALL_ENG = 0.15      # Engagement (Audio + Linguistic)
W_OVERALL_SUBSTANCE = 0.15 # NEW: Substance (Gemini)
W_OVERALL_JOB_FIT = 0.15   # NEW: Job Fit (Gemini)

def analyze_relevance_xai(transcript_analysis, question_embedding, transcript_embedding):
    """Analyzes relevance with XAI explanations."""
    explanation = []
    # 1. Semantic Similarity
    similarity = cosine_similarity(transcript_embedding, question_embedding)[0][0]
    semantic_score = normalize_min_max(similarity, SEMANTIC_SIMILARITY_MIN, SEMANTIC_SIMILARITY_MAX)
    explanation.append(format_explanation("Semantic Similarity", similarity, semantic_score, True, "Directly measures content match to question."))

    # 2. Topic Focus
    topic_focus_score = transcript_analysis.get('topic_focus_score', 0.8) # Assumed 0-1
    explanation.append(format_explanation("Topic Focus Score", topic_focus_score, topic_focus_score, True, "Indicates how focused the answer seems."))

    # Combine scores
    transcript_relevance = 0.9 * semantic_score + 0.1 * topic_focus_score
    audio_relevance = 0.1 * semantic_score # Minimal audio impact

    final_score = np.clip(transcript_relevance * W_FINAL_REL_T + audio_relevance * W_FINAL_REL_A, 0.0, 1.0)

    return {'score': final_score, 'explanation': explanation}


def analyze_confidence_xai(transcript_analysis, audio_features):
    """Analyzes confidence with XAI explanations."""
    explanation = []
    # --- Transcript Confidence ---
    hedging_ratio = transcript_analysis.get('hedging_ratio', 0.05)
    hedge_score = 1.0 - normalize_min_max(hedging_ratio, 0.0, HEDGING_RATIO_MAX)
    explanation.append(format_explanation("Hedging Ratio (Inverse)", hedging_ratio, hedge_score, hedge_score > 0.5, "Lower ratio suggests more confidence."))

    assert_score = transcript_analysis.get('assertiveness_score', 0.6)
    explanation.append(format_explanation("Assertiveness Score", assert_score, assert_score, True, "Linguistic measure of assertiveness (placeholder)."))

    magnitude = transcript_analysis.get('sentiment_magnitude', 1.0)
    magnitude_score = normalize_min_max(magnitude, 0.0, SENTIMENT_MAGNITUDE_CONF_MAX)
    explanation.append(format_explanation("Sentiment Magnitude", magnitude, magnitude_score, magnitude_score > 0.5, "Moderate magnitude can indicate conviction."))

    transcript_confidence = (W_CONF_T_HEDGE * hedge_score + W_CONF_T_ASSERT * assert_score + W_CONF_T_MAG * magnitude_score)

    # --- Audio Confidence ---
    rate = audio_features.get('speech_rate_wpm', 150)
    rate_score = normalize_optimal_point(rate, SPEECH_RATE_WPM_OPTIMAL, SPEECH_RATE_WPM_DEV)
    explanation.append(format_explanation("Speech Rate", rate, rate_score, rate_score > 0.6, f"Score peaks around optimal {SPEECH_RATE_WPM_OPTIMAL} WPM."))

    vol_rel_std = audio_features.get('volume_relative_std_dev', 0.1)
    volume_score = 1.0 - normalize_min_max(vol_rel_std, 0.0, VOLUME_REL_STD_DEV_MAX)
    explanation.append(format_explanation("Volume Consistency (Inverse Rel Std Dev)", vol_rel_std, volume_score, volume_score > 0.5, "Lower variation suggests steady confidence."))

    pause = audio_features.get('pause_ratio', 0.2)
    pause_score = normalize_optimal_point(pause, PAUSE_RATIO_CONF_OPTIMAL, PAUSE_RATIO_CONF_DEV)
    explanation.append(format_explanation("Pause Ratio", pause, pause_score, pause_score > 0.6, f"Score peaks around optimal {PAUSE_RATIO_CONF_OPTIMAL*100}% pause time."))

    pitch_std = audio_features.get('pitch_std_dev_hz', 30)
    pitch_steadiness_score = 1.0 - normalize_min_max(pitch_std, PITCH_STD_DEV_HZ_MIN, PITCH_STD_DEV_HZ_MAX)
    explanation.append(format_explanation("Pitch Steadiness (Inverse Std Dev)", pitch_std, pitch_steadiness_score, pitch_steadiness_score > 0.5, "Lower pitch variation suggests control."))

    jitter_abs = audio_features.get('word_timing_relative_jitter', 0.1)  # Get the value (assuming it's absolute)
    # Use normalize_optimal_point with optimal=0 and max_deviation=JITTER_ABS_MAX_DEV
    # We want inverse relationship (higher jitter = lower score), so subtract from 1.0
    jitter_score = 1.0 - normalize_optimal_point(jitter_abs, 0.0, JITTER_ABS_MAX_DEV)
    explanation.append(
        format_explanation("Timing Smoothness (Inverse Abs Jitter)", jitter_abs, jitter_score, jitter_score > 0.5,
                           f"Score decreases as absolute jitter increases (max dev: {JITTER_ABS_MAX_DEV}s)."))

    audio_confidence = (W_CONF_A_RATE * rate_score + W_CONF_A_VOL * volume_score + W_CONF_A_PAUSE * pause_score + W_CONF_A_PITCH * pitch_steadiness_score + W_CONF_A_JITTER * jitter_score)

    final_score = np.clip(transcript_confidence * W_FINAL_CONF_T + audio_confidence * W_FINAL_CONF_A, 0.0, 1.0)

    return {'score': final_score, 'explanation': explanation}

def analyze_clarity_xai(transcript_analysis, audio_features):
    """Analyzes clarity with XAI explanations."""
    explanation = []
    # --- Transcript Clarity ---
    ttr = transcript_analysis.get('lexical_diversity_ttr', 0.5)
    diversity_score = normalize_min_max(ttr, LEXICAL_DIVERSITY_MIN, LEXICAL_DIVERSITY_MAX)
    explanation.append(format_explanation("Lexical Diversity (TTR)", ttr, diversity_score, diversity_score > 0.5, "Higher TTR suggests richer vocabulary usage."))

    avg_len = transcript_analysis.get('avg_sentence_length', 15)
    sentence_len_score = normalize_optimal_point(avg_len, AVG_SENTENCE_LEN_OPTIMAL, AVG_SENTENCE_LEN_DEV)
    explanation.append(format_explanation("Avg Sentence Length", avg_len, sentence_len_score, sentence_len_score > 0.6, f"Score peaks around optimal {AVG_SENTENCE_LEN_OPTIMAL} words/sentence."))

    filler_ratio = transcript_analysis.get('filler_ratio', 0.05)
    filler_score = 1.0 - normalize_min_max(filler_ratio, 0.0, FILLER_RATIO_MAX)
    explanation.append(format_explanation("Filler Word Ratio (Inverse)", filler_ratio, filler_score, filler_score > 0.5, "Lower ratio suggests clearer, less hesitant speech."))

    word_conf = audio_features.get('avg_word_confidence', 0.75)
    word_conf_score = normalize_min_max(word_conf, WORD_CONFIDENCE_MIN, 1.0)
    explanation.append(format_explanation("Avg Word Confidence (STT)", word_conf, word_conf_score, word_conf_score > 0.7, "Higher confidence from speech recognition suggests clearer articulation."))

    transcript_clarity = (W_CLAR_T_DIVERSITY * diversity_score + W_CLAR_T_SENTLEN * sentence_len_score + W_CLAR_T_FILLER * filler_score + W_CLAR_T_WORDCONF * word_conf_score)

    # --- Audio Clarity ---
    snr = audio_features.get('snr_db', 15)
    snr_score = normalize_min_max(snr, SNR_DB_MIN, SNR_DB_MAX)
    explanation.append(format_explanation("Signal-to-Noise Ratio (SNR)", snr, snr_score, snr_score > 0.5, "Higher SNR indicates less background noise, clearer audio."))

    rate = audio_features.get('speech_rate_wpm', 150)
    rate_score = normalize_optimal_point(rate, SPEECH_RATE_WPM_CLARITY_OPTIMAL, SPEECH_RATE_WPM_CLARITY_DEV)
    explanation.append(format_explanation("Speech Rate (Clarity Focus)", rate, rate_score, rate_score > 0.6, f"Score peaks around optimal {SPEECH_RATE_WPM_CLARITY_OPTIMAL} WPM for clarity."))

    # Use the same assumption about jitter as in confidence
    jitter_abs = audio_features.get('word_timing_relative_jitter', 0.1)
    # Score decreases as absolute jitter increases
    jitter_clarity_score = 1.0 - normalize_optimal_point(jitter_abs, 0.0, JITTER_ABS_MAX_DEV)
    # Articulation now uses this modified jitter score
    articulation_score = (word_conf_score + jitter_clarity_score) / 2.0
    explanation.append(
        format_explanation("Articulation (Word Conf + Timing Smoothness)", articulation_score, articulation_score,
                           articulation_score > 0.6,
                           "Combines STT confidence and smooth timing (based on absolute jitter)."))

    audio_clarity = (W_CLAR_A_SNR * snr_score + W_CLAR_A_RATE * rate_score + W_CLAR_A_ARTIC * articulation_score)

    final_score = np.clip(transcript_clarity * W_FINAL_CLAR_T + audio_clarity * W_FINAL_CLAR_A, 0.0, 1.0)

    return {'score': final_score, 'explanation': explanation}

def analyze_engagement_xai(transcript_analysis, audio_features):
    """Analyzes engagement with XAI explanations."""
    explanation = []
    # --- Transcript Engagement ---
    magnitude = transcript_analysis.get('sentiment_magnitude', 1.0)
    magnitude_score = normalize_min_max(magnitude, 0.0, SENTIMENT_MAGNITUDE_ENG_MAX)
    explanation.append(format_explanation("Sentiment Magnitude", magnitude, magnitude_score, magnitude_score > 0.5, "Higher magnitude suggests stronger emotional expression."))

    express_score = transcript_analysis.get('expressiveness_score', 0.5)
    explanation.append(format_explanation("Expressiveness Score", express_score, express_score, True, "Linguistic measure of expressiveness (placeholder)."))

    transcript_engagement = (W_ENG_T_MAG * magnitude_score + W_ENG_T_EXPRESS * express_score)

    # --- Audio Engagement ---
    pitch_std = audio_features.get('pitch_std_dev_hz', 30)
    pitch_variation_score = normalize_min_max(pitch_std, PITCH_STD_DEV_HZ_ENG_MIN, PITCH_STD_DEV_HZ_ENG_MAX)
    explanation.append(format_explanation("Pitch Variation (Std Dev)", pitch_std, pitch_variation_score, pitch_variation_score > 0.5, "More variation suggests more vocal modulation and engagement."))

    vol_rel_std = audio_features.get('volume_relative_std_dev', 0.1)
    volume_variation_score = normalize_min_max(vol_rel_std, VOLUME_REL_STD_DEV_ENG_MIN, VOLUME_REL_STD_DEV_ENG_MAX)
    explanation.append(format_explanation("Volume Variation (Rel Std Dev)", vol_rel_std, volume_variation_score, volume_variation_score > 0.5, "More variation suggests dynamic speech and engagement."))

    audio_engagement = (W_ENG_A_PITCH * pitch_variation_score + W_ENG_A_VOL * volume_variation_score)

    final_score = np.clip(transcript_engagement * W_FINAL_ENG_T + audio_engagement * W_FINAL_ENG_A, 0.0, 1.0)

    return {'score': final_score, 'explanation': explanation}


async def score_response_xai(
    transcript: str,
    audio_url: str,
    question_text: str,
    job_description: str, # <<< ADD job_description as parameter
    word_timings: Optional[list] = None # Keep optional
    ) -> Dict[str, Any]: # <<< Ensure return type includes new fields if needed
    """
    Orchestrates scoring with XAI explanations, including Gemini-based substance and job fit.

    Args:
        transcript (str): The candidate's transcribed answer.
        audio_url (str): URL to the audio file.
        question_text (str): The interview question asked.
        job_description (str): The full job description text. << NEW
        word_timings (list, optional): Word timing info from transcription.

    Returns:
        dict: Dictionary containing scores for relevance, confidence, clarity,
              engagement, substance, job_fit, total_score, error status,
              and detailed explanations for each metric.
    """
    final_scores = {
        'relevance': 0.0, 'confidence': 0.0, 'clarity': 0.0, 'engagement': 0.0,
        'substance': 0.0, 'job_fit': 0.0, # <<< ADD new score fields
        'total_score': 0.0, 'error': None,
        'explanation': {} # Add top-level explanation dict
    }
    try:
        if not transcript or not transcript.strip():
             logger.warning("Cannot score empty transcript.")
             final_scores['error'] = "Empty transcript"
             # Add explanations for new scores
             final_scores['explanation']['substance'] = ["No answer provided."]
             final_scores['explanation']['job_fit'] = ["No answer provided."]
             return final_scores

        if not job_description or not job_description.strip():
             logger.warning("Job description is missing, cannot calculate Job Fit score accurately.")
             # Allow scoring other aspects, but flag the issue
             final_scores['error'] = "Missing job description for Job Fit analysis"
             final_scores['explanation']['job_fit'] = ["Job description missing for context."]
             # Optionally set job_fit score to 0 or handle differently
             final_scores['job_fit'] = 0.0

        if not gemini_service:
            logger.error("GeminiService not initialized. Cannot score substance/job fit.")
            final_scores['error'] = (final_scores['error'] + "; " if final_scores['error'] else "") + "AI Content Analysis unavailable"
            final_scores['explanation']['substance'] = ["AI Content Analysis unavailable."]
            final_scores['explanation']['job_fit'] = ["AI Content Analysis unavailable."]
             # Allow scoring other aspects

        # --- Define inner async functions ---
        async def get_audio_feats():
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, extract_audio_features, audio_url, word_timings)

        async def get_linguistic_feats():
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, analyze_transcript_linguistically, transcript)

        async def get_embeddings():
            loop = asyncio.get_running_loop()
            def generate_both_embeddings():
                t_emb = get_embedding(transcript)
                q_emb = get_embedding(question_text)
                return t_emb, q_emb
            return await loop.run_in_executor(None, generate_both_embeddings)

        async def get_gemini_content_scores():
            if gemini_service and job_description: # Only call if service and JD are available
                return await gemini_service.score_answer_substance_and_job_fit(
                    transcript, question_text, job_description
                )
            else:
                # Return default structure if Gemini can't be called
                return {
                    "substance_score": 0, "job_fit_score": 0,
                    "substance_reasoning": final_scores['explanation'].get('substance', ["Analysis skipped."])[0],
                    "job_fit_reasoning": final_scores['explanation'].get('job_fit', ["Analysis skipped."])[0],
                    "error": final_scores['error'] # Propagate existing error if any
                }

        # --- Run data gathering concurrently ---
        audio_features_task = asyncio.create_task(get_audio_feats())
        linguistic_features_task = asyncio.create_task(get_linguistic_feats())
        embeddings_task = asyncio.create_task(get_embeddings())
        gemini_scores_task = asyncio.create_task(get_gemini_content_scores()) # <<< ADD Gemini task

        # Await results
        audio_features = await audio_features_task
        transcript_analysis = await linguistic_features_task
        transcript_embedding, question_embedding = await embeddings_task
        gemini_scores = await gemini_scores_task # <<< Await Gemini results

        # --- Error checking ---
        if audio_features['duration_seconds'] < 0.1:
            logger.warning("Audio feature extraction failed, returning zero scores for audio-dependent metrics.")
            final_scores['error'] = (final_scores['error'] + "; " if final_scores['error'] else "") + "Audio processing failed"
            final_scores['explanation']['confidence'] = ["Audio processing failed."]
            final_scores['explanation']['clarity'] = ["Audio processing failed."] # Or adjust based on which parts failed
            final_scores['explanation']['engagement'] = ["Audio processing failed."]
            # Reset potentially calculated scores that depend heavily on audio
            final_scores['confidence'] = 0.0
            final_scores['clarity'] = 0.0 # Or recalculate clarity without audio parts
            final_scores['engagement'] = 0.0

        if np.all(transcript_embedding == 0) or np.all(question_embedding == 0):
            logger.warning("Embeddings failed, relevance will be zero.")
            final_scores['error'] = (final_scores['error'] + "; " if final_scores['error'] else "") + "Relevance analysis failed"
            if 'relevance' not in final_scores['explanation']: final_scores['explanation']['relevance'] = []
            final_scores['explanation']['relevance'].append("Failed to generate text embeddings.")
            final_scores['relevance'] = 0.0

        # Handle potential errors from Gemini scoring
        if gemini_scores.get("error"):
             logger.warning(f"Gemini scoring encountered an error: {gemini_scores['error']}")
             final_scores['error'] = (final_scores['error'] + "; " if final_scores['error'] else "") + f"AI Content Analysis Error: {gemini_scores['error']}"
             # Keep scores at 0, explanations are already set from gemini_scores dict

        # --- Call XAI analysis functions (run in executor) ---
        loop = asyncio.get_running_loop()
        relevance_res_task = loop.run_in_executor(None, analyze_relevance_xai, transcript_analysis, question_embedding, transcript_embedding)
        confidence_res_task = loop.run_in_executor(None, analyze_confidence_xai, transcript_analysis, audio_features)
        clarity_res_task = loop.run_in_executor(None, analyze_clarity_xai, transcript_analysis, audio_features)
        engagement_res_task = loop.run_in_executor(None, analyze_engagement_xai, transcript_analysis, audio_features)

        # Await analysis results
        relevance_res = await relevance_res_task
        confidence_res = await confidence_res_task
        clarity_res = await clarity_res_task
        engagement_res = await engagement_res_task

        # --- Assign final scores and explanations ---
        # Existing scores
        final_scores['relevance'] = relevance_res['score']
        final_scores['confidence'] = confidence_res['score']
        final_scores['clarity'] = clarity_res['score']
        final_scores['engagement'] = engagement_res['score']

        # <<< ADD Gemini scores (convert 0-10 to 0-1) >>>
        final_scores['substance'] = gemini_scores.get('substance_score', 0) / 10.0
        final_scores['job_fit'] = gemini_scores.get('job_fit_score', 0) / 10.0

        # Combine explanations
        final_scores['explanation'] = {
            'relevance': relevance_res['explanation'],
            'confidence': confidence_res['explanation'],
            'clarity': clarity_res['explanation'],
            'engagement': engagement_res['explanation'],
            'substance': [gemini_scores.get('substance_reasoning', "N/A")],
            'job_fit': [gemini_scores.get('job_fit_reasoning', "N/A")]
        }

        final_scores['total_score'] = (final_scores['relevance'] * W_OVERALL_REL +
                                       final_scores['confidence'] * W_OVERALL_CONF +
                                       final_scores['clarity'] * W_OVERALL_CLAR +
                                       final_scores['engagement'] * W_OVERALL_ENG +
                                       final_scores['substance'] * W_OVERALL_SUBSTANCE + # Add substance
                                       final_scores['job_fit'] * W_OVERALL_JOB_FIT)      # Add job fit

        # Final Clipping (including new scores)
        for key in ['relevance', 'confidence', 'clarity', 'engagement', 'substance', 'job_fit', 'total_score']:
            final_scores[key] = np.clip(final_scores.get(key, 0.0), 0.0, 1.0) # Use .get for safety

        return final_scores

    except Exception as e:
        logger.exception(f"Critical error during XAI scoring: {e}")
        final_scores['error'] = f"Critical Scoring Error: {str(e)}"
        # Reset all scores and provide error explanation
        for key in ['relevance', 'confidence', 'clarity', 'engagement', 'substance', 'job_fit', 'total_score']:
             final_scores[key] = 0.0
        final_scores['explanation'] = {k: [f"Scoring failed due to critical error: {str(e)}"] for k in final_scores['explanation']}
        return final_scores


async def apply_audio_bleeps(
        original_audio_gcs_uri: str,
        word_timings: List[Dict[str, Any]],
        biased_segments_info: List[Dict[str, Any]],  # Segments from Gemini (text, start_char, end_char)
        storage_bucket,  # Firebase storage bucket instance
        application_id: str,
        interview_id: str,
        question_response_id: str,
        bleep_frequency: int = 1000,  # Hz for bleep
        volume_reduction_db: float = -10.0  # How much quieter the bleep is than original
) -> Optional[str]:
    """
    Applies bleeps to an audio file based on character indices of biased text segments
    and word timings from transcription.

    Args:
        original_audio_gcs_uri: GCS URI of the original audio file.
        word_timings: List of word timing dicts from transcription.
        biased_segments_info: List of biased segments from Gemini (with char indices).
        storage_bucket: Firebase Storage bucket client.
        application_id, interview_id, question_response_id: For naming the output file.
        bleep_frequency: Frequency of the bleep sound.
        volume_reduction_db: Decibel reduction for the bleep sound relative to original.

    Returns:
        GCS URI of the censored audio file, or None on failure.
    """
    if not original_audio_gcs_uri or not word_timings or not biased_segments_info:
        logger.warning("Missing data for audio bleeping.")
        return None

    temp_original_audio_path = None
    temp_censored_audio_path = None

    try:
        # 1. Download original audio
        blob_name = original_audio_gcs_uri.replace(f"gs://{storage_bucket.name}/", "")
        original_blob = storage_bucket.blob(blob_name)

        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp_orig:  # Assume WAV for pydub
            temp_original_audio_path = tmp_orig.name
        await asyncio.to_thread(original_blob.download_to_filename, temp_original_audio_path)
        logger.info(f"Audio for bleeping downloaded to {temp_original_audio_path}")

        # 2. Load audio with pydub
        audio = AudioSegment.from_file(temp_original_audio_path)

        # 3. Determine bleep segments based on character indices and word timings
        # This is the most complex part: mapping char indices to word indices, then to time.
        # Simplified approach: find words that fall within the char range.
        # A more robust way would be to map each character to its word and time.

        bleep_time_ranges_ms = []  # List of (start_ms, end_ms)

        # Create a cumulative character count for words to map char indices
        word_char_map = []
        current_char_offset = 0
        for i, word_info in enumerate(word_timings):
            word_text = word_info['word']
            # Add 1 for space after word, unless it's the last word or followed by punctuation
            space_after = 1 if i < len(word_timings) - 1 and not re.match(r'[.,?!]', word_timings[i + 1]['word']) else 0
            word_char_map.append({
                'word': word_text,
                'word_index': i,
                'start_char': current_char_offset,
                'end_char': current_char_offset + len(word_text),
                'start_time_ms': int(word_info['startTime'] * 1000),
                'end_time_ms': int(word_info['endTime'] * 1000)
            })
            current_char_offset += len(word_text) + space_after

        for bias_seg in biased_segments_info:
            bias_start_char = bias_seg['start_char_index']
            bias_end_char = bias_seg['end_char_index']

            segment_start_ms = None
            segment_end_ms = None

            for mapped_word in word_char_map:
                # Check if the biased segment overlaps with this word's character range
                # Overlap condition: max(start1, start2) < min(end1, end2)
                overlap_start_char = max(bias_start_char, mapped_word['start_char'])
                overlap_end_char = min(bias_end_char, mapped_word['end_char'])

                if overlap_start_char < overlap_end_char:  # If there's an overlap
                    if segment_start_ms is None:
                        segment_start_ms = mapped_word['start_time_ms']
                    # Always update end_ms to capture the last overlapping word in the segment
                    segment_end_ms = mapped_word['end_time_ms']

            if segment_start_ms is not None and segment_end_ms is not None and segment_end_ms > segment_start_ms:
                bleep_time_ranges_ms.append((segment_start_ms, segment_end_ms))

        # Sort and merge overlapping/adjacent bleep ranges
        if not bleep_time_ranges_ms:
            logger.info("No bleep time ranges identified. Returning original audio logic (or skip upload).")
            # If you want to always return a "censored" URL even if no bleeps, copy original and upload.
            # For now, let's assume if no bleeps, no censored audio is needed distinct from original.
            return None  # Or original_audio_gcs_uri if no actual bleeping happened.

        bleep_time_ranges_ms.sort()
        merged_ranges = []
        if bleep_time_ranges_ms:
            current_start, current_end = bleep_time_ranges_ms[0]
            for next_start, next_end in bleep_time_ranges_ms[1:]:
                if next_start <= current_end:  # Overlap or adjacent
                    current_end = max(current_end, next_end)
                else:
                    merged_ranges.append((current_start, current_end))
                    current_start, current_end = next_start, next_end
            merged_ranges.append((current_start, current_end))

        logger.info(f"Identified {len(merged_ranges)} time ranges to bleep: {merged_ranges}")

        # 4. Create bleeped audio
        final_audio = AudioSegment.empty()
        last_bleep_end_ms = 0
        bleep_sound_cache = {}  # Cache bleeps of certain durations

        for start_ms, end_ms in merged_ranges:
            duration_ms = end_ms - start_ms
            if duration_ms <= 0: continue

            # Add original audio segment before the bleep
            if start_ms > last_bleep_end_ms:
                final_audio += audio[last_bleep_end_ms:start_ms]

            # Generate or get cached bleep sound
            if duration_ms not in bleep_sound_cache:
                # Make bleep slightly quieter than original audio to be less jarring
                avg_volume_segment = audio[start_ms:end_ms].dBFS
                bleep_volume = avg_volume_segment + volume_reduction_db

                sine_wave = Sine(bleep_frequency)
                bleep_segment = sine_wave.to_audio_segment(
                    duration=duration_ms,
                    volume=bleep_volume
                ).fade_in(10).fade_out(10)  # Add short fades
                bleep_sound_cache[duration_ms] = bleep_segment

            final_audio += bleep_sound_cache[duration_ms]
            last_bleep_end_ms = end_ms

        # Add remaining original audio after the last bleep
        if last_bleep_end_ms < len(audio):
            final_audio += audio[last_bleep_end_ms:]

        if len(final_audio) == 0 and len(audio) > 0:  # If all audio was bleeped
            final_audio = Sine(bleep_frequency).to_audio_segment(duration=len(audio),
                                                                 volume=audio.dBFS + volume_reduction_db)

        # 5. Export and upload censored audio
        with tempfile.NamedTemporaryFile(delete=False, suffix="_censored.wav") as tmp_cens:
            temp_censored_audio_path = tmp_cens.name

        await asyncio.to_thread(final_audio.export, temp_censored_audio_path, format="wav")

        censored_audio_storage_path = f"interview_responses/{application_id}/{interview_id}/{question_response_id}_censored_audio.wav"
        censored_blob = storage_bucket.blob(censored_audio_storage_path)

        await asyncio.to_thread(censored_blob.upload_from_filename, temp_censored_audio_path, content_type="audio/wav")
        await asyncio.to_thread(censored_blob.make_public)

        censored_audio_url = censored_blob.public_url
        censored_audio_gcs_uri = f"gs://{storage_bucket.name}/{censored_audio_storage_path}"
        logger.info(f"Censored audio uploaded to GCS: {censored_audio_gcs_uri}")

        return censored_audio_gcs_uri  # Return GCS URI for consistency

    except Exception as e:
        logger.error(f"Error applying audio bleeps: {e}", exc_info=True)
        return None
    finally:
        if temp_original_audio_path and os.path.exists(temp_original_audio_path):
            os.unlink(temp_original_audio_path)
        if temp_censored_audio_path and os.path.exists(temp_censored_audio_path):
            os.unlink(temp_censored_audio_path)


def censor_transcript_text(transcript: str, biased_segments: List[Dict[str, Any]], censor_char: str = "#") -> str:
    """
    Censors identified biased segments in a transcript.

    Args:
        transcript: The original transcript.
        biased_segments: List of dicts from Gemini, each with "start_char_index" and "end_char_index".
        censor_char: Character to use for censoring.

    Returns:
        The censored transcript.
    """
    if not biased_segments:
        return transcript

    # Sort segments by start_char_index to process them in order
    # Process in reverse order of start_char_index to avoid index shifting issues
    sorted_segments = sorted(biased_segments, key=lambda x: x['start_char_index'], reverse=True)

    censored_transcript_list = list(transcript)  # Work with a list of characters for easier replacement

    for segment in sorted_segments:
        start = segment['start_char_index']
        end = segment['end_char_index']
        original_text = segment.get('text', transcript[start:end])  # Get original text for length

        if 0 <= start < end <= len(transcript):
            # Replace each character in the segment with the censor_char
            # Or use a fixed placeholder like "[CENSORED]"
            # For character-by-character, ensure placeholder length matches original or is reasonable
            placeholder = censor_char * len(original_text)
            # placeholder = "[CENSORED]" # Alternative

            for i in range(start, end):
                censored_transcript_list[i] = placeholder[i - start] if i - start < len(placeholder) else censor_char

    return "".join(censored_transcript_list)

async def check_content_bias(transcript: str) -> Dict[str, Any]:
    """
    Checks transcript for potentially sensitive or problematic content using Google NLP API.

    Args:
        transcript (str): The text to analyze.

    Returns:
        dict: Containing a 'flagged' boolean and a 'details' list of flagged categories.
              Returns {'flagged': False, 'details': []} if no issues or on error.
    """
    if not transcript or not transcript.strip():
        return {'flagged': False, 'details': [], 'message': 'Empty transcript.'}

    # Simplified keywords for initial check (can be expanded)
    sensitive_keywords = [
        r'\b(race|racist|racial|ethnicity|ethnic)\b',
        r'\b(gender|sexist|sexism|male|female|lgbtq|transgender)\b',
        r'\b(religion|religious|creed|muslim|christian|jewish|hindu|buddhist)\b',
        r'\b(disability|disabled|handicap)\b',
        r'\b(age|ageist|old|young)\b',
        r'\b(politics|political|government|election|democrat|republican)\b',
        r'\b(profanity|swear|curse|damn|hell|shit|fuck)\b', # Basic profanity
        # Add more keywords/patterns as needed
    ]
    flagged_details = []
    flagged = False

    for pattern in sensitive_keywords:
        if re.search(pattern, transcript, re.IGNORECASE):
            category = pattern.split('|')[0].split('(')[-1] # Basic category name
            flagged_details.append(f"Potential mention related to: {category}")
            flagged = True

    # Optional: Use Google Cloud Natural Language API for more robust classification
    # This adds cost and latency but is more accurate than keywords.
    use_nlp_api = False # Set to True to enable API call
    if use_nlp_api:
        try:
            doc = language_v1.Document(content=transcript, type_=language_v1.Document.Type.PLAIN_TEXT)
            # Moderate Text (v2beta adds more categories like Hate Speech, Harassment)
            # Note: This requires enabling the API and potentially different client setup.
            # classification_response = nlp_client.moderate_text(document=doc) # Hypothetical call
            # Alternatively, use classify_text for broader categories:
            classification_response = await asyncio.to_thread(
                 nlp_client.classify_text,
                 document=doc
            )

            sensitive_categories = { # Map API categories to flags
                 "/Sensitive Subjects/Religion & Belief", "/Sensitive Subjects/Politics",
                 "/Adult", "/Health/Sexual & Reproductive Health",
                 # Add more categories based on API documentation and needs
            }
            profanity_categories = {"/Adult"} # Example

            for category in classification_response.categories:
                 if category.name in sensitive_categories or category.name in profanity_categories:
                     flagged_details.append(f"Content classified as: {category.name} (Confidence: {category.confidence:.2f})")
                     flagged = True
                 # Add specific checks for toxicity, hate speech etc. if using moderate_text

        except Exception as e:
            logger.error(f"Error during NLP content classification: {e}")
            flagged_details.append("NLP API content check failed.")
            # Decide if failure should trigger a flag: flagged = True

    if flagged:
         logger.warning(f"Content flagged in transcript: {flagged_details}")

    return {'flagged': flagged, 'details': flagged_details}

# Keep the placeholder functions for now, replace with XAI versions in submit_response
def score_response(transcript, audio_url, question_text, word_timings=None):
     # This is now a simple wrapper/placeholder, main logic is in score_response_xai
     logger.warning("Using placeholder score_response. Call score_response_xai for detailed scoring.")
     # For compatibility, return a simplified structure. Ideally, update callers.
     xai_result = asyncio.run(score_response_xai(transcript, audio_url, question_text, word_timings)) # Run async function synchronously (not ideal)
     return {
        'relevance': xai_result.get('relevance', 0.0),
        'confidence': xai_result.get('confidence', 0.0),
        'clarity': xai_result.get('clarity', 0.0),
        'engagement': xai_result.get('engagement', 0.0),
        'total_score': xai_result.get('total_score', 0.0),
        'error': xai_result.get('error')
     }

def extract_audio_features(audio_url, word_timings=None):
    """
    Extracts a comprehensive set of audio features from an audio URL using Librosa
    and leverages word timings from Google Speech-to-Text if available.

    Args:
        audio_url (str): URL to the audio file (e.g., WAV format).
        word_timings (list, optional): List of word timing dicts from Google Speech API.
                                       Each dict should have 'startTime', 'endTime', 'confidence'.

    Returns:
        dict: A dictionary containing various calculated audio features.
              Returns default/neutral values if processing fails.
    """
    temp_file = None
    try:
        # Download audio file to temporary location
        temp_file_handle, temp_path = tempfile.mkstemp(suffix=".wav")
        os.close(temp_file_handle) # Close handle, we just need the path

        response = requests.get(audio_url, timeout=30) # Added timeout
        response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
        with open(temp_path, 'wb') as f:
            f.write(response.content)

        # Load audio with librosa at a consistent sample rate
        y, sr = librosa.load(temp_path, sr=DEFAULT_SR)
        duration_seconds = librosa.get_duration(y=y, sr=sr)

        if duration_seconds < 0.1: # Handle very short/empty audio
             logger.warning(f"Audio duration too short ({duration_seconds:.2f}s) for feature extraction.")
             return get_default_audio_features()

        # --- Calculate Features ---

        # 1. Basic Duration
        features = {'duration_seconds': duration_seconds}

        # 2. Volume / Energy Features
        rms_energy = librosa.feature.rms(y=y, hop_length=FFT_HOP_LENGTH)[0]
        features['volume_mean'] = np.mean(rms_energy)
        features['volume_std_dev'] = np.std(rms_energy)
        # Normalize std dev relative to mean for consistency across different overall volumes
        features['volume_relative_std_dev'] = features['volume_std_dev'] / features['volume_mean'] if features['volume_mean'] > 1e-6 else 0

        # 3. Signal-to-Noise Ratio (SNR) - Simple Estimate
        # Assumes initial part or lowest energy part might be noise
        noise_estimate_len = min(len(rms_energy) // 10, sr // 10) # Use first 10% or 100ms
        noise_rms = np.mean(rms_energy[:noise_estimate_len])
        signal_power = features['volume_mean']**2
        noise_power = noise_rms**2
        # Calculate SNR in dB, handle potential zero noise power
        features['snr_db'] = 10 * np.log10(signal_power / noise_power) if noise_power > 1e-10 else 50.0 # Assign high SNR if no noise detected

        # 4. Pause Analysis (Based on RMS energy)
        silence_threshold = np.max(rms_energy) * SILENCE_THRESHOLD_RMS_RATIO
        silent_frames = np.sum(rms_energy < silence_threshold)
        total_frames = len(rms_energy)
        features['pause_ratio'] = silent_frames / total_frames if total_frames > 0 else 0.0

        # 5. Pitch (Fundamental Frequency - F0) Analysis
        # Using pyin for robust pitch tracking
        f0, voiced_flag, voiced_probs = librosa.pyin(y, fmin=F0_MIN, fmax=F0_MAX, sr=sr, frame_length=FFT_HOP_LENGTH*4, hop_length=FFT_HOP_LENGTH)
        # Get pitch only for voiced segments
        voiced_f0 = f0[voiced_flag]
        if len(voiced_f0) > 1:
            features['pitch_mean_hz'] = np.nanmean(voiced_f0) # Use nanmean to ignore potential NaNs from pyin
            features['pitch_std_dev_hz'] = np.nanstd(voiced_f0)
        else:
            features['pitch_mean_hz'] = 0.0
            features['pitch_std_dev_hz'] = 0.0

        # 6. Features from Word Timings (if available)
        if word_timings and len(word_timings) > 0:
            confidences = [wt.get('confidence', 0.0) for wt in word_timings] # Default confidence 0 if missing
            features['avg_word_confidence'] = np.mean(confidences)

            # Calculate Speech Rate (Words Per Minute)
            num_words = len(word_timings)
            # Use actual spoken duration if possible, fallback to full duration
            first_word_start = word_timings[0].get('startTime', 0)
            last_word_end = word_timings[-1].get('endTime', duration_seconds)
            spoken_duration = max(0.1, last_word_end - first_word_start) # Ensure non-zero duration
            features['speech_rate_wpm'] = (num_words / spoken_duration) * 60 if spoken_duration > 0 else 0

            # Calculate Word Timing Jitter (Std Dev of inter-word gaps relative to avg gap)
            gaps = []
            if num_words > 1:
                for i in range(num_words - 1):
                    gap = word_timings[i+1].get('startTime', 0) - word_timings[i].get('endTime', 0)
                    gaps.append(max(0, gap)) # Gaps cannot be negative
                if gaps:
                     avg_gap = np.mean(gaps)
                     features['word_timing_jitter_std_dev'] = np.std(gaps)
                     features['word_timing_relative_jitter'] = features['word_timing_jitter_std_dev'] / avg_gap if avg_gap > 1e-6 else 0
                else:
                     features['word_timing_jitter_std_dev'] = 0.0
                     features['word_timing_relative_jitter'] = 0.0
            else:
                features['word_timing_jitter_std_dev'] = 0.0
                features['word_timing_relative_jitter'] = 0.0
        else:
            # Fallback if no word timings provided
            features['avg_word_confidence'] = 0.75 # Assign a neutral default
            features['speech_rate_wpm'] = 150 # Assign a typical default WPM
            features['word_timing_jitter_std_dev'] = 0.05 # Assign low default jitter
            features['word_timing_relative_jitter'] = 0.1

        return features

    except requests.exceptions.RequestException as e:
        logger.error(f"Error downloading audio from URL {audio_url}: {e}")
        return get_default_audio_features()
    except Exception as e:
        logger.error(f"Error processing audio file from {audio_url}: {e}")
        return get_default_audio_features()
    finally:
        # Clean up temporary file
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except Exception as e_clean:
                logger.error(f"Error deleting temporary audio file {temp_path}: {e_clean}")

def get_default_audio_features():
    """Returns a dictionary with default/neutral audio feature values."""
    return {
        'duration_seconds': 0.0,
        'volume_mean': 0.01, 'volume_std_dev': 0.0, 'volume_relative_std_dev': 0.0,
        'snr_db': 15.0, # Neutral SNR
        'pause_ratio': 0.2, # Typical pause ratio
        'pitch_mean_hz': 150.0, 'pitch_std_dev_hz': 0.0,
        'avg_word_confidence': 0.75, # Neutral confidence
        'speech_rate_wpm': 150.0, # Average WPM
        'word_timing_jitter_std_dev': 0.05, 'word_timing_relative_jitter': 0.1,
    }

def analyze_transcript_linguistically(transcript: str) -> dict:
    """
    Analyzes the transcript text using Google Cloud Natural Language API
    to extract linguistic features relevant for scoring, including calculated
    assertiveness and expressiveness.

    Args:
        transcript (str): The transcription text.

    Returns:
        dict: A dictionary containing various calculated linguistic features.
              Returns default/neutral values if processing fails.
    """
    if not transcript or not transcript.strip():
        logger.warning("Transcript is empty, returning default linguistic features.")
        features = get_default_linguistic_features()
        features['analysis_error'] = "Empty transcript"
        return features

    features = {}

    # Hedging/Uncertainty indicators
    HEDGING_WORDS = {
        'maybe', 'perhaps', 'possibly', 'i guess', 'i suppose', 'i think',  # Added 'i think'
        'might', 'could', 'may', 'seem', 'appears',  # Added 'may', 'seem', 'appears'
        'sort of', 'kind of', 'a bit', 'slightly', 'somewhat', 'around', 'about'  # Added more qualifiers
    }
    # Filler words (often indicate hesitation, impact clarity more than assertiveness)
    FILLER_WORDS = {
        'um', 'uh', 'er', 'ah', 'hmm', 'like', 'you know',
        'well', 'so', 'actually', 'basically', 'literally', 'okay'  # Added common fillers
    }
    # Stronger Assertiveness indicators (use lemmas for matching)
    ASSERTIVE_MODALS = {'will', 'must', 'shall'}  # Strong intention/obligation
    DEFINITIVE_WORDS = {'definitely', 'certainly', 'absolutely', 'always', 'never', 'clearly'}  # Added more
    FIRST_PERSON_PRONOUNS = {'i', 'we', 'my', 'our', 'mine', 'ours'}

    # Expressiveness indicators
    INTENSIFIERS = {'very', 'really', 'extremely', 'incredibly', 'so', 'quite', 'highly', 'deeply', 'fully'}

    try:
        doc = language_v1.Document(content=transcript, type_=language_v1.Document.Type.PLAIN_TEXT)
        encoding_type = language_v1.EncodingType.UTF8

        # --- API Calls ---
        # Run API calls concurrently if the client library supports async or use asyncio.gather with to_thread
        # For simplicity here, keeping them sequential as in original code
        sentiment_response = nlp_client.analyze_sentiment(document=doc, encoding_type=encoding_type)
        syntax_response = nlp_client.analyze_syntax(document=doc, encoding_type=encoding_type)
        # Optional: Classification for topic coherence
        # classification_response = nlp_client.classify_text(document=doc)

        # --- Basic Feature Extraction ---
        features['sentiment_score'] = sentiment_response.document_sentiment.score
        features['sentiment_magnitude'] = sentiment_response.document_sentiment.magnitude

        tokens = syntax_response.tokens
        sentences = syntax_response.sentences
        num_tokens = len(tokens)
        num_sentences = len(sentences)

        if num_tokens == 0 or num_sentences == 0:
            logger.warning("No tokens or sentences found in transcript.")
            features = get_default_linguistic_features() # Use defaults
            features['sentiment_score'] = sentiment_response.document_sentiment.score # Keep sentiment if available
            features['sentiment_magnitude'] = sentiment_response.document_sentiment.magnitude
            features['analysis_error'] = "No tokens/sentences found"
            return features

        # Filter out punctuation tokens for ratio calculations
        content_tokens = [t for t in tokens if t.part_of_speech.tag != language_v1.PartOfSpeech.Tag.PUNCT]
        num_content_tokens = len(content_tokens)
        if num_content_tokens == 0:
             logger.warning("No content (non-punctuation) tokens found.")
             # Handle similarly to no tokens/sentences
             features = get_default_linguistic_features()
             features['sentiment_score'] = sentiment_response.document_sentiment.score
             features['sentiment_magnitude'] = sentiment_response.document_sentiment.magnitude
             features['analysis_error'] = "No content tokens found"
             return features

        # --- Calculate Existing Features ---
        sentence_lengths = [len(s.text.content.split()) for s in sentences]
        features['avg_sentence_length'] = np.mean(sentence_lengths) if sentence_lengths else 0
        features['std_dev_sentence_length'] = np.std(sentence_lengths) if len(sentence_lengths) > 1 else 0

        word_types = set(t.lemma.lower() for t in content_tokens) # Use lemmas for TTR
        features['lexical_diversity_ttr'] = len(word_types) / num_content_tokens

        # --- Calculate Ratios and Counts for New Scores ---
        hedge_count = 0
        filler_count = 0
        assertive_modal_count = 0
        definitive_word_count = 0
        intensifier_count = 0
        adj_adv_count = 0
        first_person_count = 0

        token_lemmas_lower = [t.lemma.lower() for t in content_tokens]
        token_texts_lower = [t.text.content.lower() for t in content_tokens] # Keep original text for multi-word phrases if needed

        for i, token in enumerate(content_tokens):
            lemma = token_lemmas_lower[i]
            # Get the primary POS tag
            pos_tag = token.part_of_speech.tag
            # We won't use pos_mood directly for modals now

            # Check against keyword lists (using lemmas primarily)
            if lemma in HEDGING_WORDS:
                hedge_count += 1
            if lemma in FILLER_WORDS:
                filler_count += 1
            if lemma in DEFINITIVE_WORDS:
                definitive_word_count += 1
            if lemma in INTENSIFIERS:
                intensifier_count += 1
            if lemma in FIRST_PERSON_PRONOUNS:
                first_person_count += 1

            # Check if it's a verb AND its lemma is in our assertive modal list
            if pos_tag == language_v1.PartOfSpeech.Tag.VERB and lemma in ASSERTIVE_MODALS:
                assertive_modal_count += 1

            # Check for Adjectives and Adverbs
            if pos_tag in [language_v1.PartOfSpeech.Tag.ADJ, language_v1.PartOfSpeech.Tag.ADV]:
                adj_adv_count += 1

        # Calculate Ratios
        features['hedging_ratio'] = hedge_count / num_content_tokens
        features['filler_ratio'] = filler_count / num_content_tokens
        assertive_modal_ratio = assertive_modal_count / num_content_tokens
        definitive_word_ratio = definitive_word_count / num_content_tokens
        intensifier_ratio = intensifier_count / num_content_tokens
        adj_adv_ratio = adj_adv_count / num_content_tokens
        first_person_ratio = first_person_count / num_content_tokens # May not be directly used, but available

        # --- Calculate Assertiveness Score ---
        # Start with a base, reduce for hedging, increase for assertive indicators
        # Weights here are heuristic and need tuning
        assertiveness_score = 0.5 \
                              - (features['hedging_ratio'] * 2.0) \
                              + (assertive_modal_ratio * 1.5) \
                              + (definitive_word_ratio * 1.0) \
                              + (np.clip(features['sentiment_score'], 0, 1) * 0.1) # Small boost for positivity

        features['assertiveness_score'] = np.clip(assertiveness_score, 0.0, 1.0)

        # --- Calculate Expressiveness Score ---
        # Combine magnitude, intensifiers, adj/adv ratio, and sentence length variation
        # Normalize std_dev_sentence_length (e.g., assume typical range 2-10)
        norm_sent_len_std = np.clip((features['std_dev_sentence_length'] - 2) / (10 - 2), 0.0, 1.0)
        # Normalize magnitude (e.g., assume typical max around 5-10 for expressiveness)
        norm_magnitude = np.clip(features['sentiment_magnitude'] / 7.0, 0.0, 1.0)

        # Weights are heuristic and need tuning
        expressiveness_score = (norm_magnitude * 0.4) \
                               + (intensifier_ratio * 2.0) \
                               + (adj_adv_ratio * 0.5) \
                               + (norm_sent_len_std * 0.1)

        features['expressiveness_score'] = np.clip(expressiveness_score, 0.0, 1.0)

        # --- Placeholder for Topic Focus ---
        # Replace with actual calculation if classification is used
        features['topic_focus_score'] = 0.8 # Default neutral

        features['analysis_error'] = None # No error found

        return features

    except Exception as e:
        logger.exception(f"Error analyzing transcript linguistically: {e}") # Use exception for stack trace
        features = get_default_linguistic_features() # Return defaults on error
        features['analysis_error'] = f"NLP API Error: {str(e)}"
        return features

def get_default_linguistic_features():
    """Returns a dictionary with default/neutral linguistic feature values."""
    return {
        'sentiment_score': 0.0, 'sentiment_magnitude': 0.5,
        'avg_sentence_length': 15.0, 'std_dev_sentence_length': 5.0,
        'lexical_diversity_ttr': 0.5,
        'hedging_ratio': 0.05, 'filler_ratio': 0.05,
        'assertiveness_score': 0.5, # Default changed to neutral 0.5
        'expressiveness_score': 0.5, # Default remains neutral 0.5
        'topic_focus_score': 0.8,
        'analysis_error': None # Add field to indicate errors
    }

def get_embedding(text):
    """
    Generates sentence embedding for the given text using a pre-loaded transformer model.

    Args:
        text (str): Input text.

    Returns:
        numpy.ndarray: A 1D numpy array representing the sentence embedding.
                       Returns a zero vector on failure.
    """
    if not text or not text.strip():
        # Return a zero vector of the expected dimension if text is empty
        # Get the model's hidden size
        try:
             hidden_size = embedding_model.config.hidden_size
        except Exception:
             hidden_size = 384 # Fallback dimension for all-MiniLM-L6-v2
        return np.zeros((1, hidden_size))

    try:
        # Tokenize and encode the text
        inputs = embedding_tokenizer(text, return_tensors="pt", truncation=True, padding=True, max_length=512)
        # Generate embedding (disable gradient calculation for inference)
        with torch.no_grad():
            outputs = embedding_model(**inputs)
        # Use mean pooling of the last hidden state
        embedding = outputs.last_hidden_state.mean(dim=1).numpy()
        return embedding
    except Exception as e:
        logger.error(f"Error generating embedding for text: '{text[:50]}...': {e}")
        # Return a zero vector on error
        try:
             hidden_size = embedding_model.config.hidden_size
        except Exception:
             hidden_size = 384 # Fallback
        return np.zeros((1, hidden_size))

# Define expected ranges and optimal points for normalization.
# Require tuning based on Data
# Relevance
SEMANTIC_SIMILARITY_MIN = -1.0 # Cosine similarity range
SEMANTIC_SIMILARITY_MAX = 1.0

# Confidence
HEDGING_RATIO_MAX = 0.20      # Max acceptable ratio of hedging words (e.g., 20%)
SENTIMENT_MAGNITUDE_CONF_MAX = 4.5 # Expected max magnitude indicating conviction
SPEECH_RATE_WPM_OPTIMAL = 155 # Optimal speech rate for confidence
SPEECH_RATE_WPM_DEV = 45      # Max deviation allowed from optimal WPM
VOLUME_REL_STD_DEV_MAX = 1.2  # Max acceptable relative volume variation for confidence
PAUSE_RATIO_CONF_OPTIMAL = 0.15 # Optimal pause ratio for confidence
PAUSE_RATIO_CONF_DEV = 0.2    # Max deviation allowed
PITCH_STD_DEV_HZ_MIN = 10     # Min expected pitch variation
PITCH_STD_DEV_HZ_MAX = 60     # Max expected pitch variation (less variation = confidence)
JITTER_ABS_MAX_DEV = 0.25

# Clarity
LEXICAL_DIVERSITY_MIN = 0.3   # Min expected TTR
LEXICAL_DIVERSITY_MAX = 0.8   # Max expected TTR
AVG_SENTENCE_LEN_OPTIMAL = 16 # Optimal sentence length for clarity
AVG_SENTENCE_LEN_DEV = 10     # Max deviation allowed
FILLER_RATIO_MAX = 0.15       # Max acceptable ratio of filler words (e.g., 15%)
WORD_CONFIDENCE_MIN = 0.3     # Min acceptable average word confidence from Speech API
SNR_DB_MIN = 0                # Min acceptable SNR (dB)
SNR_DB_MAX = 10               # Max expected SNR (dB)
SPEECH_RATE_WPM_CLARITY_OPTIMAL = 160 # Optimal speech rate for clarity
SPEECH_RATE_WPM_CLARITY_DEV = 50      # Max deviation allowed

# Engagement
SENTIMENT_MAGNITUDE_ENG_MAX = 6.0 # Max expected magnitude for engagement
PITCH_STD_DEV_HZ_ENG_MIN = 20  # Min pitch variation for engagement
PITCH_STD_DEV_HZ_ENG_MAX = 70  # Max pitch variation for engagement
VOLUME_REL_STD_DEV_ENG_MIN = 0.1 # Min relative volume variation for engagement
VOLUME_REL_STD_DEV_ENG_MAX = 1.2 # Max relative volume variation for engagement

# --- Feature Weights within each Metric Component ---
# Weights determine how much each normalized feature contributes to the
# transcript or audio score *for that specific metric*. Sum should ideally be 1.0 per component.

# Confidence Weights
W_CONF_T_HEDGE = 0.5      # Weight of hedging score in transcript confidence
W_CONF_T_ASSERT = 0.3     # Weight of assertiveness score
W_CONF_T_MAG = 0.2        # Weight of magnitude score
W_CONF_A_RATE = 0.25      # Weight of speech rate score in audio confidence
W_CONF_A_VOL = 0.25       # Weight of volume consistency score
W_CONF_A_PAUSE = 0.20     # Weight of pause score
W_CONF_A_PITCH = 0.15     # Weight of pitch steadiness score
W_CONF_A_JITTER = 0.15    # Weight of timing jitter score

# Clarity Weights
W_CLAR_T_DIVERSITY = 0.25 # Weight of lexical diversity in transcript clarity
W_CLAR_T_SENTLEN = 0.25   # Weight of sentence length score
W_CLAR_T_FILLER = 0.25    # Weight of filler word score
W_CLAR_T_WORDCONF = 0.25  # Weight of word confidence score (from audio features)
W_CLAR_A_SNR = 0.3        # Weight of SNR score in audio clarity
W_CLAR_A_RATE = 0.35       # Weight of speech rate score
W_CLAR_A_ARTIC = 0.35      # Weight of articulation score (word conf + jitter)

# Engagement Weights
W_ENG_T_MAG = 0.7         # Weight of magnitude score in transcript engagement
W_ENG_T_EXPRESS = 0.3     # Weight of expressiveness score
W_ENG_A_PITCH = 0.5       # Weight of pitch variation score in audio engagement
W_ENG_A_VOL = 0.5         # Weight of volume variation score