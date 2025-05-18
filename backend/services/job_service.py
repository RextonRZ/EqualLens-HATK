import logging
import uuid
from typing import List, Dict, Any, Optional
from datetime import datetime
from core.firebase import firebase_client
from models.job import JobCreate, JobResponse, JobUpdate
from models.candidate import CandidateCreate, Application

logger = logging.getLogger(__name__)

class JobService:
    """Service for managing jobs, applications, and candidates."""
    
    @staticmethod
    def create_job(job_data: JobCreate) -> Optional[str]:
        """Create a new job and return the job ID."""
        try:
            # Generate a job ID
            job_id = firebase_client.generate_counter_id("job")
            
            # Get current timestamp as a string
            current_time = datetime.now().isoformat()
            
            # Create job document data with only requiredSkills - no more skills field
            job_doc = {
                'jobId': job_id,
                'jobTitle': job_data.jobTitle,
                'jobDescription': job_data.jobDescription,
                'departments': job_data.departments,
                'minimumCGPA': job_data.minimumCGPA,
                'requiredSkills': job_data.requiredSkills,
                'createdAt': current_time,
                'applicationCount': 0,
                'prompt': ""
            }
            
            # Store job in Firestore
            success = firebase_client.create_document('jobs', job_id, job_doc)
            if not success:
                logger.error(f"Failed to create job {job_id}")
                return None
            
            return job_id
        except Exception as e:
            logger.error(f"Error creating job: {e}")
            return None
    
    @staticmethod
    def get_jobs() -> List[Dict[str, Any]]:
        """Get all jobs."""
        try:
            # Query Firestore for all jobs
            jobs = firebase_client.get_collection('jobs')
            return jobs
        except Exception as e:
            logger.error(f"Error getting jobs: {e}")
            return []
    
    @staticmethod
    def get_job(job_id: str) -> Optional[Dict[str, Any]]:
        """Get a job by ID."""
        try:
            # Query Firestore for a job by ID
            job = firebase_client.get_document('jobs', job_id)
            return job
        except Exception as e:
            logger.error(f"Error getting job {job_id}: {e}")
            return None
    
    @staticmethod
    def update_job(job_id: str, job_data: JobUpdate) -> bool:
        """Update a job."""
        try:
            # Create update data dict
            update_data = {}
            for field, value in job_data.dict(exclude_unset=True).items():
                if value is not None:
                    update_data[field] = value
            
            if not update_data:
                logger.warning("No fields to update")
                return False
            
            # Add debugging to track what we're sending to the database
            logger.info(f"Update data for job {job_id}: {update_data}")
            
            # Update job in Firestore
            success = firebase_client.update_document('jobs', job_id, update_data)
            return success
        except Exception as e:
            logger.error(f"Error updating job {job_id}: {e}")
            return False
    
    @staticmethod
    def add_application(job_id: str, candidate_id: str) -> Optional[str]:
        """Add an application for a job."""
        try:
            # Generate application ID
            application_id = firebase_client.generate_counter_id("app")
            
            # Get current timestamp
            current_time = datetime.now().isoformat()
            
            # Create application document
            application_doc = {
                'applicationId': application_id,
                'jobId': job_id,
                'candidateId': candidate_id,
                'applicationDate': current_time,
                'status': 'new'
            }
            
            # Store application in Firestore
            success = firebase_client.create_document('applications', application_id, application_doc)
            if not success:
                logger.error(f"Failed to create application {application_id}")
                return None
            
            # Increment application count for the job
            job = firebase_client.get_document('jobs', job_id)
            if job:
                current_count = job.get('applicationCount', 0)
                firebase_client.update_document('jobs', job_id, {'applicationCount': current_count + 1})
            
            return application_id
        except Exception as e:
            logger.error(f"Error adding application: {e}")
            return None
    
    @staticmethod
    def get_applications_for_job(job_id: str) -> List[Dict[str, Any]]:
        """Get all applications for a job with candidate information."""
        try:
            # Get applications for job
            applications = firebase_client.get_collection('applications', [('jobId', '==', job_id)])
            
            # Enrich with candidate information
            results = []
            for app in applications:
                candidate_id = app.get('candidateId')
                if candidate_id:
                    candidate = firebase_client.get_document('candidates', candidate_id)
                    if candidate:
                        # Add candidate info to application
                        app_with_candidate = {
                            **app,
                            'extractedText': candidate.get('extractedText'),
                            'rank_score': candidate.get('rank_score'),
                            'reasoning': candidate.get('reasoning'),
                            'detailed_profile': candidate.get('detailed_profile'),
                            'resumeUrl': candidate.get('resumeUrl'),
                            'overwriteAt': candidate.get('overwriteAt'),
                            'uploadedAt': candidate.get('uploadedAt')  
                        }
                        results.append(app_with_candidate)
                    else:
                        results.append(app)
                else:
                    results.append(app)
            
            return results
        except Exception as e:
            logger.error(f"Error getting applications for job {job_id}: {e}")
            return []

    @staticmethod
    def update_application_status(application_id: str, status: str) -> bool:
        """Update the status of an application."""
        try:
            return firebase_client.update_document('applications', application_id, {'status': status})
        except Exception as e:
            logger.error(f"Error updating application {application_id} status: {e}")
            return False

    @staticmethod
    def get_application(application_id: str) -> Optional[Dict[str, Any]]:
        """Get an application by ID."""
        try:
            return firebase_client.get_document('applications', application_id)
        except Exception as e:
            logger.error(f"Error getting application {application_id}: {e}")
            return None

    @staticmethod
    def get_candidate_applications(candidate_id: str) -> List[Dict[str, Any]]:
        """Get all applications for a candidate, sorted by application date (most recent first)."""
        try:
            applications_ref = firebase_client.db.collection('applications')
            query = applications_ref.where('candidateId', '==', candidate_id)
            applications = [doc.to_dict() for doc in query.get()]
            
            # Sort by application date if available (descending order)
            applications_with_date = [app for app in applications if 'applicationDate' in app]
            applications_without_date = [app for app in applications if 'applicationDate' not in app]
            
            sorted_applications = sorted(
                applications_with_date, 
                key=lambda x: x.get('applicationDate', ''), 
                reverse=True
            ) + applications_without_date
            
            return sorted_applications
        except Exception as e:
            logger.error(f"Error getting applications for candidate {candidate_id}: {e}")
            return []