# services/ai_detection_service.py
import html
import logging
from typing import Optional, Dict, Any

from models.authenticity_analysis import AuthenticityAnalysisResult
from models.cross_referencing import CrossReferencingResult
from models.ai_detection import AIDetectionResult

logger = logging.getLogger(__name__)

FINAL_AUTH_FLAG_THRESHOLD = 0.60
SPAM_FLAG_THRESHOLD = 0.70

class AIDetectionService:
    @staticmethod
    def format_analysis_for_frontend(
            filename: str,
            auth_results: Optional[AuthenticityAnalysisResult],
            cross_ref_results: Optional[CrossReferencingResult],
            external_ai_pred_data: Optional[Dict[str, Any]]  # New parameter
    ) -> AIDetectionResult:

        is_ai_generated_by_external_model = False
        external_model_confidence = 0.0
        external_pred_html_parts = [
            "<div class='analysis-section external-ai-prediction-details'><h5>External AI Model Prediction:</h5>"]

        if external_ai_pred_data and not external_ai_pred_data.get("error"):
            pred_label = external_ai_pred_data.get("predicted_class_label", "Unknown")
            conf_scores = external_ai_pred_data.get("confidence_scores", {})

            if pred_label == "AI-generated":
                is_ai_generated_by_external_model = True
                external_model_confidence = conf_scores.get("ai_generated", 0.0)
                external_pred_html_parts.append(
                    f"<p class='warning'><strong>Prediction: AI-Generated</strong> (Confidence: {external_model_confidence:.2f})</p>")
            elif pred_label == "Human-written":
                is_ai_generated_by_external_model = False
                # For "Human-written", confidence is how sure it is human, not a "concern" level.
                # The frontend might show this differently. For AIDetectionResult.confidence, we can use this.
                external_model_confidence = conf_scores.get("human_written", 0.0)
                external_pred_html_parts.append(
                    f"<p class='success'><strong>Prediction: Human-Written</strong> (Confidence: {external_model_confidence:.2f})</p>")
            else:  # Could be "Error" or "Unknown" from our wrapper
                external_pred_html_parts.append(f"<p>Prediction: {html.escape(pred_label)}</p>")

            if conf_scores:
                ai_score_str = f"{conf_scores.get('ai_generated', 'N/A'):.2f}" if isinstance(
                    conf_scores.get('ai_generated'), float) else "N/A"
                human_score_str = f"{conf_scores.get('human_written', 'N/A'):.2f}" if isinstance(
                    conf_scores.get('human_written'), float) else "N/A"
                external_pred_html_parts.append(
                    f"<p><small>AI Score: {ai_score_str}, Human Score: {human_score_str}</small></p>")

            snippet = external_ai_pred_data.get("input_text_snippet")
            if snippet:
                external_pred_html_parts.append(f"<p><small>Analyzed Snippet: {html.escape(snippet)}</small></p>")

        elif external_ai_pred_data and external_ai_pred_data.get("error"):
            external_pred_html_parts.append(
                f"<p class='error'>Error: {html.escape(external_ai_pred_data.get('error'))}</p>")
            # If external model errors, is_ai_generated remains False, confidence 0
        else:
            external_pred_html_parts.append("<p>External AI detection not available or not performed.</p>")
        external_pred_html_parts.append("</div>")

        # Internal analysis flagging
        is_flagged_problematic_internal = False
        internal_flag_reasons = []
        # Use internal_confidence_metric for the strength of internal flags
        internal_confidence_metric = 0.0

        final_overall_auth_score = auth_results.final_overall_authenticity_score if auth_results and auth_results.final_overall_authenticity_score is not None else 0.5
        final_spam_score = auth_results.final_spam_likelihood_score if auth_results and auth_results.final_spam_likelihood_score is not None else 0.5

        if final_overall_auth_score < FINAL_AUTH_FLAG_THRESHOLD:
            is_flagged_problematic_internal = True
            internal_flag_reasons.append(f"Low Overall Authenticity ({final_overall_auth_score:.2f})")
            internal_confidence_metric = max(internal_confidence_metric, 1.0 - final_overall_auth_score)

        if final_spam_score > SPAM_FLAG_THRESHOLD:
            is_flagged_problematic_internal = True
            internal_flag_reasons.append(f"High Spam Likelihood ({final_spam_score:.2f})")
            internal_confidence_metric = max(internal_confidence_metric, final_spam_score)

        # Start building HTML for internal analysis
        internal_html_parts = ["<div class='internal-analysis-summary'>"]  # New wrapper
        internal_html_parts.append(f"<h4>Internal Authenticity & Spam Check for: {html.escape(filename)}</h4>")

        if is_flagged_problematic_internal:
            internal_html_parts.append(
                f"<p class='warning'><strong>Internal Flags:</strong> {', '.join(internal_flag_reasons)}</p>")
        else:
            internal_html_parts.append("<p class='success'>No major internal authenticity or spam flags detected.</p>")

        internal_html_parts.append(
            f"<p><strong>Overall Internal Authenticity Score:</strong> {final_overall_auth_score:.2f}/1.0</p>")
        internal_html_parts.append(
            f"<p><strong>Internal Spam Likelihood Score:</strong> {final_spam_score:.2f}/1.0 (Higher = More Spammy)</p>")

        if auth_results and auth_results.final_xai_summary:
            internal_html_parts.append(
                f"<div class='xai-summary'><strong>Internal Summary:</strong> {html.escape(auth_results.final_xai_summary)}</div>")
        elif auth_results and auth_results.authenticity_summary_explanation_by_content_module:
            internal_html_parts.append(
                f"<div class='xai-summary'><strong>Content Module Summary:</strong> {html.escape(auth_results.authenticity_summary_explanation_by_content_module)}</div>")

        # Content Authenticity Details
        if auth_results:
            internal_html_parts.append(
                "<div class='analysis-section content-auth-details'><h5>Content Analysis Details:</h5>")
            if auth_results.content_module_error_message:
                internal_html_parts.append(
                    f"<p class='error'>Error: {html.escape(auth_results.content_module_error_message)}</p>")
            else:
                score_by_module = auth_results.authenticity_assessment_score_by_content_module
                score_by_module_display = f"{score_by_module:.2f}" if score_by_module is not None else "N/A"
                internal_html_parts.append(
                    f"<p>Content Module Score: {score_by_module_display}</p>")
                if auth_results.authenticity_summary_explanation_by_content_module:
                    internal_html_parts.append(
                        f"<p><i>{html.escape(auth_results.authenticity_summary_explanation_by_content_module)}</i></p>")
                if auth_results.timeline_coherence and not auth_results.timeline_coherence.consistent:
                    internal_html_parts.append(
                        f"<p>Timeline Issues: {html.escape(', '.join(auth_results.timeline_coherence.issues_found))}</p>")
                if auth_results.skill_experience_education_alignment and not auth_results.skill_experience_education_alignment.consistent:
                    internal_html_parts.append(
                        f"<p>Alignment Issues: {html.escape(', '.join(auth_results.skill_experience_education_alignment.issues_found))}</p>")
                spec_score = auth_results.achievement_specificity_score
                ai_style_score = auth_results.ai_used_words_stylistic_score
                plaus_score = auth_results.overall_content_plausibility_score

                spec_score_display = f"{spec_score:.2f}" if spec_score is not None else "N/A"
                ai_style_score_display = f"{ai_style_score:.2f}" if ai_style_score is not None else "N/A"
                plaus_score_display = f"{plaus_score:.2f}" if plaus_score is not None else "N/A"

                internal_html_parts.append(
                    f"<p>Specificity Score: {spec_score_display}. AI Stylistic Score: {ai_style_score_display}. Plausibility: {plaus_score_display}</p>")
            internal_html_parts.append("</div>")

        # Cross-Referencing Details
        if cross_ref_results:
            internal_html_parts.append(
                "<div class='analysis-section cross-ref-details'><h5>Cross-Referencing Details:</h5>")
            # ... (keep existing cross-ref details formatting) ...
            if cross_ref_results.cross_ref_module_error_message:
                internal_html_parts.append(
                    f"<p class='error'>Error: {html.escape(cross_ref_results.cross_ref_module_error_message)}</p>")
            else:
                cr_score = cross_ref_results.overall_cross_ref_score
                cr_score_display = f"{cr_score:.2f}" if cr_score is not None else "N/A"
                internal_html_parts.append(f"<p>Cross-Ref Module Score: {cr_score_display}</p>")
                if cross_ref_results.cross_ref_summary_notes:
                    internal_html_parts.append(
                        f"<p><i>{html.escape(cross_ref_results.cross_ref_summary_notes)}</i></p>")
                for url_val in cross_ref_results.urls_validated[:2]:
                    status = "Live" if url_val.is_live else "Not Live/Error"
                    match_score_display = f"{url_val.name_match_score:.2f}" if url_val.name_match_score is not None else ""
                    match_info = f"Match: {match_score_display}" if match_score_display else ""

                    internal_html_parts.append(
                        f"<p><small>URL: {html.escape(url_val.url[:50])}... Status: {status}. {match_info} Notes: {html.escape(url_val.validation_notes[:70])}...</small></p>")
            internal_html_parts.append("</div>")

        internal_html_parts.append("</div>")

        # Combine all HTML parts
        # The main div 'ai-detection-summary' will now wrap everything
        combined_html_parts = ["<div class='ai-detection-summary'>"]
        combined_html_parts.extend(external_pred_html_parts)
        if auth_results or cross_ref_results:  # Only add separator and internal analysis if they exist
            combined_html_parts.append("<hr style='margin: 15px 0; border-color: #ddd;'/>")  # Visual separator
            combined_html_parts.extend(internal_html_parts)
        combined_html_parts.append("</div>")

        details_payload = {
            "external_ai_prediction": external_ai_pred_data if external_ai_pred_data else None,
            "authenticity_analysis": auth_results.dict(exclude_none=True) if auth_results else None,
            "cross_referencing_analysis": cross_ref_results.dict(exclude_none=True) if cross_ref_results else None,
        }

        # AIDetectionResult.is_ai_generated is True if external model says AI-generated.
        # AIDetectionResult.confidence is the confidence of the external model's prediction.
        # If external model predicted "Human-written", is_ai_generated is False, and confidence is for "Human-written".
        final_confidence_for_result = 0.0
        if external_ai_pred_data and not external_ai_pred_data.get("error"):
            if is_ai_generated_by_external_model:
                final_confidence_for_result = external_ai_pred_data.get("confidence_scores", {}).get("ai_generated",
                                                                                                     0.0)
            else:  # Human-written or Unknown by external model
                final_confidence_for_result = external_ai_pred_data.get("confidence_scores", {}).get("human_written",
                                                                                                     0.0)

        # If internal checks also flag it, we might want to increase a general "concern" metric,
        # but AIDetectionResult.confidence should reflect the primary (external) model's confidence.
        # The `is_flagged_problematic_internal` can be used by frontend if needed from `details_payload`.
        # For now, let's keep it simple: confidence is from the external model's prediction.

        return AIDetectionResult(
            filename=filename,
            is_ai_generated=is_ai_generated_by_external_model,
            confidence=round(float(final_confidence_for_result), 3),  # Ensure it's float
            reason="\n".join(combined_html_parts),
            details=details_payload
        )