from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

class InterviewQuestionBase(BaseModel):
    question: str
    type: str  # "technical", "behavioral", "compulsory"
    timeLimit: int  # in seconds
    order: int
    
class InterviewQuestion(InterviewQuestionBase):
    questionId: str
    sectionTitle: Optional[str] = None

class GenerateInterviewLinkRequest(BaseModel):
    applicationId: str
    candidateId: str
    jobId: str
    email: EmailStr
    scheduledDate: Optional[datetime] = None
    
class InterviewLinkResponse(BaseModel):
    interviewId: str
    linkCode: str
    fullLink: str
    expiryDate: datetime
    applicationId: str
    candidateId: str
    emailStatus: str

class IdentityVerificationRequest(BaseModel):
    interviewId: str
    linkCode: str
    identificationImage: str  # Base64 encoded image
    
class IdentityVerificationResponse(BaseModel):
    verified: bool
    message: str

class InterviewResponseRequest(BaseModel):
    interviewId: str
    linkCode: str
    question: str
    questionId: str
    videoResponse: str  # Base64 encoded video data or empty if directly uploading to storage
    
class InterviewResponseResponse(BaseModel):
    success: bool
    responseId: str
    message: str = "Response recorded successfully"
    transcript: Optional[str] = None
    word_count: Optional[int] = None
    word_timings: Optional[List[Dict[str, Any]]] = None

class InterviewResponseSubmitMetadataRequest(BaseModel): # New name reflects purpose
    interviewId: str
    linkCode: str
    question: str
    questionId: str
    gcsUri: str

class GenerateUploadUrlRequest(BaseModel):
    interviewId: str
    linkCode: str
    questionId: str
    contentType: str = "video/webm"

class SchedulePhysicalInterviewRequest(BaseModel):
    applicationId: str
    candidateId: str
    jobId: str
    email: EmailStr
    candidateName: str
    jobTitle: str
    interviewDate: str # Keep as string from frontend date input
    interviewTime: str # Keep as string from frontend time input
    interviewLocation: str
    contactPerson: str
    additionalInfo: Optional[str] = None # Optional field