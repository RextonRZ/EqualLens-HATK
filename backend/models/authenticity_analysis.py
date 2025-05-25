from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any


class CoherenceCheck(BaseModel):
    consistent: bool
    issues_found: List[str] = Field(default_factory=list)


class AuthenticityAnalysisResult(BaseModel):
    # Results from the ResumeAuthenticityService (content-focused module)
    timeline_coherence: Optional[CoherenceCheck] = None
    skill_experience_education_alignment: Optional[CoherenceCheck] = None
    achievement_specificity_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    generic_achievement_examples: List[str] = Field(default_factory=list)
    ai_used_words_stylistic_score: Optional[float] = Field(None, ge=0.0, le=1.0)  # Higher = more AI-like
    ai_stylistic_indicators: List[str] = Field(default_factory=list)
    overall_content_plausibility_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    implausible_claims: List[str] = Field(default_factory=list)

    # Score and summary specifically from the content analysis module
    authenticity_assessment_score_by_content_module: Optional[float] = Field(None, ge=0.0, le=1.0)
    authenticity_summary_explanation_by_content_module: Optional[str] = None

    # Field to capture any errors during this specific module's analysis
    content_module_error_message: Optional[str] = None

    # These fields will be populated by the ScoringAggregationService
    final_overall_authenticity_score: Optional[float] = Field(None, ge=0.0, le=1.0)  # Aggregated from all checks
    final_spam_likelihood_score: Optional[float] = Field(None, ge=0.0, le=1.0)  # Higher = more likely spam
    final_xai_summary: Optional[str] = None  # Overall explanation