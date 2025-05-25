from pydantic import BaseModel, EmailStr, HttpUrl, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

class CandidateID(BaseModel):
    """Model for a candidate's ID."""
    id_number: str
    id_type: str = "IC"  # Default is IC (Identity Card)
    id_image_url: HttpUrl
    verified: bool = False
    
class CandidateBase(BaseModel):
    """Base model for a candidate."""
    email: EmailStr
    job_id: str
    resume_id: str  # Fixed typo from 'strz' to 'str'
    
class Candidate(BaseModel):
    """Base model for candidate data."""
    candidateId: str
    extractedText: Optional[Dict[str, Any]] = None
    resumeUrl: Optional[str] = None

class CandidateCreate(CandidateBase):
    """Model for creating a new candidate."""
    pass

class Application(BaseModel):
    """Model for an application."""
    applicationId: str
    jobId: str
    candidateId: str
    applicationDate: datetime
    status: str = "new"

class CandidateResponse(CandidateBase):
    """Model for candidate data returned from API."""
    uploadedAt: Optional[datetime] = None
    storagePath: Optional[str] = None
    status: Optional[str] = None
    rank_score: Optional[Dict[str, float]] = None  
    reasoning: Optional[Dict[str, str]] = None  
    detailed_profile: Optional[Dict[str, Any]] = None

    class Config:
        schema_extra = {
            "example": {
                "candidateId": "cand-00000001",
                "extractedText": {
                    "applicant_name": "John Doe",
                    "applicant_mail": "john.doe@example.com"
                },
                "resumeUrl": "https://storage.googleapis.com/bucket/resumes/resume1.pdf",
                "uploadedAt": "2023-06-15T10:30:00",
                "storagePath": "resumes/job-00000001/cand-00000001/resume.pdf",
                "status": "new",
                "rank_score": {"relevance": 0.8, "proficiency": 0.9, "additionalSkill": 0.7},
                "reasoning": {
                    "relevance": "Relevant experience in software development",
                    "proficiency": "Strong programming skills in Python and Java",
                    "additionalSkill": "Experience with cloud technologies"
                },
                "detailed_profile": {
                    "summary": "Software developer with 5 years of experience. He/She has <strong>strong Python skills</strong>.",
                    "soft_skills": ["Communication", "Problem-solving", "Teamwork"],
                    "technical_skills": ["Python", "Java", "C++"],
                    "languages": ["English", "Spanish"],
                    "education": ["<strong>Bachelor's degree in Computer Science</strong> [2018-2022]\\nUniversity X\\nGPA: 3.8, Dean's List"],
                    "certifications": ["<strong>AWS Certified Developer</strong> [2021]\\nAmazon Web Services"],
                    "awards": ["<strong>Employee of the Month (June 2022)</strong> [2022]\\nCompany Z"], # Added year to award
                    "work_experience": ["<strong>Software Developer at Company A</strong> [2019-2023]\\nDeveloped web applications..."],
                    "projects": ["<strong>E-commerce Platform</strong> [2020]\\nBuilt using React and Node.js..."],
                    "co_curricular_activities": ["<strong>Volunteer at local animal shelter</strong> [2019-2020]\\nHelped with animal care..."],
                    "inferred_technical_skills": ["Docker", "Agile Methodology"],
                    "inferred_soft_skills": ["Mentoring"],
                    "inferred_languages": [],
                    "inferred_skills_explanations": {
                        "technical_skills_explanation": "Docker was inferred from project descriptions mentioning containerization. Agile Methodology was suggested by participation in sprint-based development cycles.",
                        "soft_skills_explanation": "Mentoring was inferred from experience guiding junior team members on projects.",
                        "languages_explanation": "No additional languages were inferred beyond those explicitly listed."
                    },
                    "relevance_analysis": { # Example of relevance analysis (if present)
                        "technical_skills": [
                            {"item": "Python", "relevance": 9, "relevant": True},
                            {"item": "Java", "relevance": 7, "relevant": False}
                        ]
                    }
                }
            }
        }

class CandidateUpdate(BaseModel):
    """Model for updating an existing candidate."""
    email: Optional[EmailStr] = None
    job_id: Optional[str] = None
    resume_id: Optional[str] = None
    extractedText: Optional[Dict[str, Any]] = None
    resumeUrl: Optional[str] = None
    uploadedAt: Optional[datetime] = None
    overwriteAt: Optional[str] = None  # Add overwriteAt field as string to store formatted timestamp
    storagePath: Optional[str] = None
    status: Optional[str] = None
    rank_score: Optional[Dict[str, float]] = None
    reasoning: Optional[Dict[str, str]] = None
    detailed_profile: Optional[Dict[str, Any]] = None


class ApplicationResponse(Application):
    """Model for application data returned from API with candidate info."""
    candidateInfo: Optional[Dict[str, Any]] = None
    extractedText: Optional[Dict[str, Any]] = None