from typing import Dict, Any, List, Optional
from pydantic import BaseModel

class BiasDetectionRequest(BaseModel):
    jobTitle: str
    jobDescription: Optional[str] = ""
    requirements: Optional[str] = ""
    minimumCGPA: Optional[float] = 0
    departments: Optional[List[str]] = []
    requiredSkills: Optional[List[str]] = []

class BiasDetectionResponse(BaseModel):
    hasBias: bool
    biasedFields: Dict[str, str] = {}
    biasedTerms: Dict[str, List[str]] = {}