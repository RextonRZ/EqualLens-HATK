from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict
from datetime import datetime

class RandomSettings(BaseModel):
    enabled: bool
    count: int

class Question(BaseModel):
    questionId: Optional[str]  # Make questionId optional
    text: str
    timeLimit: int
    isCompulsory: bool
    isAIGenerated: Optional[bool] = False
    isAIModified: Optional[bool] = False  # Add explicit support for isAIModified field
    originalText: Optional[str] = None     # Support for original text storage
    originalTimeLimit: Optional[int] = None  # Support for original time limit storage
    originalCompulsory: Optional[bool] = None  # Support for original compulsory flag storage
    
    class Config:
        # Add model configuration to allow for extra attributes
        extra = "allow"
        
        # Custom JSON schema to ensure originalText is preserved for AI-generated questions
        schema_extra = {
            "example": {
                "text": "Example interview question?",
                "timeLimit": 60,
                "isCompulsory": True,
                "isAIGenerated": False,
                "isAIModified": False,
                "originalText": None,
                "originalTimeLimit": None,
                "originalCompulsory": None
            }
        }

class Section(BaseModel):
    sectionId: Optional[str]  # Make sectionId optional
    title: str
    randomSettings: RandomSettings
    questions: List[Question]

class InterviewQuestionSet(BaseModel):
    questionSetId: Optional[str]
    applicationId: str
    candidateId: str
    createdAt: Optional[datetime] = None  # Make createdAt optional and default to None
    sections: List[Section]
    updatedAt: Optional[datetime] = None  # Add optional updatedAt field
    aiGenerationUsed: Optional[bool] = False  # Add field to track if AI generation was used

class ActualQuestion(BaseModel):
    questionId: str
    text: str
    timeLimit: int
    sectionTitle: str

class InterviewQuestionActual(BaseModel):
    actualId: Optional[str]
    applicationId: str
    candidateId: str
    totalQuestionActual: int
    questions: List[ActualQuestion]
    createdAt: Optional[datetime] = None
