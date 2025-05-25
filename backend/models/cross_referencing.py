from pydantic import BaseModel, Field
from typing import List, Optional


class URLValidationDetail(BaseModel):
    url: str
    is_live: bool
    status_code: Optional[int] = None
    extracted_page_title: Optional[str] = None
    extracted_profile_name: Optional[str] = None  # For LinkedIn/GitHub profile names
    name_on_resume_for_comparison: Optional[str] = None  # Candidate's name from resume
    name_match_score: Optional[float] = Field(None, ge=0.0, le=1.0)  # Levenshtein or similar
    project_similarity_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    validation_notes: str
    error_message: Optional[str] = None


class EntityVerificationDetail(BaseModel):
    entity_name: str
    entity_type: str  # 'company' or 'education'
    existence_confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    verification_notes: Optional[str] = None
    supporting_info_url: Optional[str] = None  # e.g., URL found by Gemini
    error_message: Optional[str] = None


class CrossReferencingResult(BaseModel):
    urls_validated: List[URLValidationDetail] = Field(default_factory=list)
    entities_verified: List[EntityVerificationDetail] = Field(default_factory=list)

    # Aggregated score and summary specifically for the cross-referencing module
    overall_cross_ref_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    cross_ref_summary_notes: Optional[str] = None

    # Field to capture any errors during this specific module's analysis
    cross_ref_module_error_message: Optional[str] = None