import logging
from typing import Dict, Any, Optional

from services.gemini_service import GeminiService
from models.authenticity_analysis import AuthenticityAnalysisResult
from models.cross_referencing import CrossReferencingResult

logger = logging.getLogger(__name__)


class ScoringAggregationService:
    def __init__(self, gemini_service: Optional[GeminiService] = None):
        self.gemini_service = gemini_service if gemini_service else GeminiService()

        # Define weights for the final scores. These should be tuned.
        self.weights_authenticity = {
            "content_module": 0.65,  # Score from ResumeAuthenticityService
            "cross_referencing_module": 0.35,  # Score from CrossReferencingService
        }
        self.weights_spam = {
            "content_plausibility_inverse": 0.30,  # (1 - plausibility)
            "achievement_specificity_inverse": 0.25,  # (1 - specificity)
            "ai_stylistic_direct": 0.25,  # Direct AI stylistic score
            "cross_referencing_inverse": 0.20  # (1 - cross_ref_score)
        }

    async def calculate_final_assessment(
            self,
            authenticity_results: Optional[AuthenticityAnalysisResult],
            cross_ref_results: Optional[CrossReferencingResult]
    ) -> Dict[str, Any]:  # Will match AuthenticityAnalysisResult's final fields

        final_assessment_output = {
            "final_overall_authenticity_score": 0.5,
            "final_spam_likelihood_score": 0.5,
            "final_xai_summary": "Analysis faced issues or had insufficient data for a full assessment."
        }

        # --- Get scores from individual modules, with defaults for robustness ---
        auth_content_score = 0.5
        auth_content_summary = "Content authenticity module encountered an error or provided no data."
        if authenticity_results:
            if authenticity_results.content_module_error_message:
                auth_content_summary = f"Content Authenticity Error: {authenticity_results.content_module_error_message}"
            elif authenticity_results.authenticity_assessment_score_by_content_module is not None:
                auth_content_score = authenticity_results.authenticity_assessment_score_by_content_module
                auth_content_summary = authenticity_results.authenticity_summary_explanation_by_content_module or "No specific summary from content module."

        cross_ref_score = 0.5
        cross_ref_summary = "Cross-referencing module encountered an error or provided no data."
        if cross_ref_results:
            if cross_ref_results.cross_ref_module_error_message:
                cross_ref_summary = f"Cross-Referencing Error: {cross_ref_results.cross_ref_module_error_message}"
            elif cross_ref_results.overall_cross_ref_score is not None:
                cross_ref_score = cross_ref_results.overall_cross_ref_score
                cross_ref_summary = cross_ref_results.cross_ref_summary_notes or "No specific summary from cross-referencing."

        # --- Calculate Final Overall Authenticity Score (higher is better) ---
        final_assessment_output["final_overall_authenticity_score"] = (
                auth_content_score * self.weights_authenticity["content_module"] +
                cross_ref_score * self.weights_authenticity["cross_referencing_module"]
        )
        final_assessment_output["final_overall_authenticity_score"] = round(
            max(0.0, min(1.0, final_assessment_output["final_overall_authenticity_score"])), 3
        )

        # --- Calculate Final Spam Likelihood Score (higher is MORE spammy) ---
        plausibility = authenticity_results.overall_content_plausibility_score if authenticity_results and authenticity_results.overall_content_plausibility_score is not None else 0.5
        specificity = authenticity_results.achievement_specificity_score if authenticity_results and authenticity_results.achievement_specificity_score is not None else 0.5
        ai_stylistic = authenticity_results.ai_used_words_stylistic_score if authenticity_results and authenticity_results.ai_used_words_stylistic_score is not None else 0.5

        spam_score = (
                (1 - plausibility) * self.weights_spam["content_plausibility_inverse"] +
                (1 - specificity) * self.weights_spam["achievement_specificity_inverse"] +
                ai_stylistic * self.weights_spam["ai_stylistic_direct"] +
                (1 - cross_ref_score) * self.weights_spam["cross_referencing_inverse"]
        )
        # Normalize if weights don't sum to 1 (though they should)
        total_spam_weight = sum(self.weights_spam.values())
        if total_spam_weight > 0:
            spam_score /= total_spam_weight

        final_assessment_output["final_spam_likelihood_score"] = round(max(0.0, min(1.0, spam_score)), 3)

        # --- Generate Final XAI Summary using Gemini ---
        xai_prompt_inputs = {
            "calculated_overall_auth_score": f"{final_assessment_output['final_overall_authenticity_score']:.2f}",
            "calculated_spam_score": f"{final_assessment_output['final_spam_likelihood_score']:.2f}",
            "auth_content_module_score": f"{auth_content_score:.2f}",
            "auth_content_module_summary": auth_content_summary,
            "cross_ref_module_score": f"{cross_ref_score:.2f}",
            "cross_ref_module_summary": cross_ref_summary,
            "plausibility_details": f"Score: {plausibility:.2f}. Claims flagged: {', '.join(authenticity_results.implausible_claims[:2]) if authenticity_results and authenticity_results.implausible_claims else 'None'}",
            "specificity_details": f"Score: {specificity:.2f}. Generic examples: {', '.join(authenticity_results.generic_achievement_examples[:2]) if authenticity_results and authenticity_results.generic_achievement_examples else 'None'}",
            "ai_style_details": f"AI-like score: {ai_stylistic:.2f}. Indicators: {', '.join(authenticity_results.ai_stylistic_indicators[:2]) if authenticity_results and authenticity_results.ai_stylistic_indicators else 'None'}",
        }

        xai_prompt = f"""
You are an AI assistant generating an overall assessment summary for a resume.
Based on the following analysis components, provide a concise (2-4 sentences) human-readable summary.
This summary should explain the candidate's calculated 'Overall Authenticity Score' of {xai_prompt_inputs['calculated_overall_auth_score']} and 'Spam Likelihood Score' of {xai_prompt_inputs['calculated_spam_score']}.
Focus on the 1-3 most impactful factors from the provided details. Be objective and factual.

Resume Analysis Details:
- Content Authenticity Module Score: {xai_prompt_inputs['auth_content_module_score']}
  - Summary from Content Module: {xai_prompt_inputs['auth_content_module_summary']}
  - Plausibility Details: {xai_prompt_inputs['plausibility_details']}
  - Specificity Details: {xai_prompt_inputs['specificity_details']}
  - AI Stylistic Details: {xai_prompt_inputs['ai_style_details']}
- Cross-Referencing Module Score: {xai_prompt_inputs['cross_ref_module_score']}
  - Summary from Cross-Ref Module: {xai_prompt_inputs['cross_ref_module_summary']}

Provide ONLY the summary text.
"""
        try:
            final_summary_text = await self.gemini_service.generate_text(xai_prompt)
            final_assessment_output["final_xai_summary"] = final_summary_text.strip()
        except Exception as e:
            logger.error(f"Error generating final XAI summary with Gemini: {e}", exc_info=True)
            final_assessment_output["final_xai_summary"] = (
                f"Automated summary generation failed. Key insights: "
                f"Content authenticity score: {auth_content_score:.2f}. "
                f"Cross-referencing score: {cross_ref_score:.2f}. "
                f"Spam likelihood factors include content plausibility ({plausibility:.2f}), specificity ({specificity:.2f}), and AI-like style ({ai_stylistic:.2f})."
            )

        logger.info(f"Final aggregated assessment: {final_assessment_output}")
        return final_assessment_output