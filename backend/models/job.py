from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


class JobBase(BaseModel):
    """Base model for job data."""
    jobTitle: str
    jobDescription: str
    departments: List[str]
    minimumCGPA: Optional[float] = 0  # Changed default to 0 for N/A
    requiredSkills: List[str]  # Use a single field name consistently
    prompt: str = ""


class JobCreate(JobBase):
    """Model for creating a new job."""
    pass


class JobResponse(JobBase):
    """Model for job data returned from API."""
    jobId: str
    createdAt: datetime
    applicationCount: int = 0
    
    class Config:
        schema_extra = {
            "example": {
                "jobId": "job-00000001",
                "jobTitle": "Software Engineer",
                "jobDescription": "We are looking for a software engineer...",
                "departments": ["Engineering", "Technology"],
                "minimumCGPA": 3.0,
                "requiredSkills": ["Python", "JavaScript", "React"],
                "prompt": "Skills, Experience",
                "createdAt": "2023-06-15T10:30:00",
                "applicationCount": 5
            }
        }


class JobUpdate(BaseModel):
    """Model for updating an existing job."""
    jobTitle: Optional[str] = None
    jobDescription: Optional[str] = None
    departments: Optional[List[str]] = None
    minimumCGPA: Optional[float] = None
    requiredSkills: Optional[List[str]] = None
    prompt: Optional[str] = None

class JobSuggestionContext(BaseModel):
    job_title: str = Field(..., description="The job title to base suggestions on.")
    core_responsibilities: Optional[str] = Field(None, description="Brief description of core tasks.")
    key_skills: Optional[str] = Field(None, description="Comma-separated list of essential skills.")
    company_culture: Optional[str] = Field(None, description="Notes on company values or team environment.")
    experience_level: Optional[str] = Field(None, description="e.g., Entry-level, Mid-level, Senior.")

class JobSuggestionResponse(BaseModel):
    description: str = Field(..., description="Suggested job description text.")
    requirements: str = Field(..., description="Suggested requirements/qualifications text.")