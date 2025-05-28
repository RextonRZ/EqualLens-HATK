import datetime
import logging
import json
import re
from typing import Dict, Any, Optional

from services.gemini_service import GeminiService
from models.authenticity_analysis import AuthenticityAnalysisResult, CoherenceCheck

logger = logging.getLogger(__name__)


class ResumeAuthenticityService:
    def __init__(self, gemini_service: Optional[GeminiService] = None):
        self.gemini_service = gemini_service if gemini_service else GeminiService()

    def _construct_gemini_prompt(
            self,
            extracted_sections: Dict[str, Any],  # Allow Any for lists of skills
            candidate_name: Optional[str] = None
    ) -> str:
        def format_section(section_name: str, content: Optional[Any]) -> str:
            header = section_name.replace("_", " ").title()
            if content is None:
                return f"**{header}:**\nNot provided\n---\n"
            if isinstance(content, list):
                if not content:
                    return f"**{header}:**\nNot provided\n---\n"
                # Ensure all items in list are strings for join
                return f"**{header}:**\n- {', '.join(map(str, content))}\n---\n"  # Join list items
            if isinstance(content, str) and content.strip():
                return f"**{header}:**\n{content.strip()}\n---\n"
            return f"**{header}:**\nNot provided or empty\n---\n"

        # Prepare sections for the prompt
        # Try to get specific DocumentAI fields first, then fall back to generic ones
        education_text = format_section("Education", extracted_sections.get("education_paragraph",
                                                                            extracted_sections.get("education")))
        experience_text = format_section("Experience", extracted_sections.get("work_experience_paragraph",
                                                                              extracted_sections.get("experience")))

        now = datetime.datetime.now()
        current_datetime_str = now.strftime("%Y-%m-%d %H:%M:%S")

        # Consolidate skills for the prompt
        skills_list = []
        if isinstance(extracted_sections.get("technical_skills"), list):
            skills_list.extend(extracted_sections.get("technical_skills"))
        elif isinstance(extracted_sections.get("technical_skills"), str):
            skills_list.append(extracted_sections.get("technical_skills"))

        if isinstance(extracted_sections.get("soft_skills"), list):
            skills_list.extend(extracted_sections.get("soft_skills"))
        elif isinstance(extracted_sections.get("soft_skills"), str):
            skills_list.append(extracted_sections.get("soft_skills"))

        # Fallback if specific skill fields are not present but a general 'skills' field is
        if not skills_list and extracted_sections.get("skills"):
            if isinstance(extracted_sections.get("skills"), list):
                skills_list.extend(extracted_sections.get("skills"))
            else:
                skills_list.append(str(extracted_sections.get("skills")))

        skills_text = format_section("Skills", skills_list if skills_list else None)
        projects_text = format_section("Projects",
                                       extracted_sections.get("projects_paragraph", extracted_sections.get("projects")))

        prompt = f"""
You are an expert resume content scrutinizer. Analyze the following extracted resume content for internal consistency, plausibility, specificity, and potential AI-authorship indicators.

**Current Date and Time:** {current_datetime_str}

**Candidate Name (if available):** {candidate_name if candidate_name else "Not provided"}

**Resume Content Sections:**
{education_text}
{experience_text}
{skills_text}
{projects_text}

**Analysis Tasks & Output Format (Strict JSON ONLY):**

Please provide your analysis in the following JSON structure. For scores, use a float between 0.0 (worst) and 1.0 (best), unless specified otherwise.
If a section (e.g., Education, Experience) is "Not provided" or empty in the input, its corresponding checks (e.g., timeline_coherence if Experience is missing) should reflect this, possibly by setting 'consistent' to true and 'issues_found' to an empty list or a note like 'No data to assess'.
For scores where data might be insufficient (e.g. achievement_specificity_score if no achievements listed), default to 0.5.

{{
  "timeline_coherence": {{
    "consistent": true/false,
    "issues_found": ["Description of issue 1 (e.g., 'Unexplained gap of 2 years between 2018-2020')", "Highly improbable overlap: Full-time CEO at Company X [2019-2021] and full-time PhD in another country [2019-2022]."]
    // Note on timeline_coherence: Assess the chronological consistency of education and work experience.
    // Flag significant unexplained gaps (e.g., >1 year) or highly improbable overlaps (e.g., two demanding full-time roles simultaneously for an extended period in different cities, or a full-time job clashing with intensive full-time study).
    // Short overlaps between jobs (e.g., 1-2 months), part-time work during studies, concurrent freelance projects, or parallel volunteer activities are often normal and should NOT be flagged unless the context makes them highly suspect.
    // Focus on clear, substantial inconsistencies.
  }},
  "skill_experience_education_alignment": {{
    "aligned": true/false,
    "issues_found": ["Description of issue 1 (e.g., 'Claimed 'Expert in AI' with only a high school diploma and retail experience')", "..."]
  }},
  "achievement_specificity_score": 0.0_to_1.0,
  "generic_achievement_examples": ["'Responsible for improving team efficiency' (lacks metrics)", "'Managed key client accounts' (lacks scale or impact)"],
  "ai_used_words_stylistic_score": 0.0_to_1.0,
  "ai_stylistic_indicators": ["Repetitive sentence structure in project descriptions.", "Overuse of generic positive adjectives like 'impactful', 'dynamic' without concrete examples.", "Unnaturally formal tone for describing personal projects."],
  "overall_content_plausibility_score": 0.0_to_1.0,
  "implausible_claims": ["'Led a team of 50 at age 19 for a Fortune 500 project' (if other context doesn't support)", "..."],
  "authenticity_assessment_score_by_content_module": 0.0_to_1.0,
  "authenticity_summary_explanation_by_content_module": "Brief (1-2 sentences) summary of the key reasons for the authenticity_assessment_score_by_content_module."
}}
"""
        return prompt.strip()

    async def analyze_resume_content(
            self,
            extracted_data_from_document_ai: Dict[str, Any],
            candidate_name: Optional[str] = None
    ) -> AuthenticityAnalysisResult:
        prompt_sections = {
            "education_paragraph": extracted_data_from_document_ai.get("education_paragraph"),
            "work_experience_paragraph": extracted_data_from_document_ai.get("work_experience_paragraph"),
            "technical_skills": extracted_data_from_document_ai.get("technical_skills"),
            "soft_skills": extracted_data_from_document_ai.get("soft_skills"),
            "skills": extracted_data_from_document_ai.get("skills"),  # General skills if others not present
            "projects_paragraph": extracted_data_from_document_ai.get("projects_paragraph")
        }

        prompt = self._construct_gemini_prompt(prompt_sections, candidate_name)
        logger.debug(f"ResumeAuthenticityService: Sending prompt to Gemini (first 500 chars):\n{prompt[:500]}...")

        try:
            response_str = await self.gemini_service.generate_text(prompt_content=prompt)
            logger.debug(
                f"ResumeAuthenticityService: Received response from Gemini (first 500 chars):\n{response_str[:500]}...")

            cleaned_response_str = response_str.strip()
            if cleaned_response_str.startswith("```json"):
                cleaned_response_str = cleaned_response_str[7:]
            elif cleaned_response_str.startswith("```"):
                cleaned_response_str = cleaned_response_str[3:]
            if cleaned_response_str.endswith("```"):
                cleaned_response_str = cleaned_response_str[:-3]
            cleaned_response_str = cleaned_response_str.strip()

            try:
                response_json = json.loads(cleaned_response_str)
            except json.JSONDecodeError as e_json_outer:
                match = re.search(r'\{[\s\S]*\}', cleaned_response_str)  # More robust regex for JSON block
                if match:
                    json_str_candidate = match.group(0)
                    try:
                        response_json = json.loads(json_str_candidate)
                        logger.info("Successfully parsed JSON using regex fallback for authenticity service.")
                    except json.JSONDecodeError as e_json_inner:
                        logger.error(
                            f"Failed to parse Gemini JSON (authenticity) even with regex: {e_json_inner}. Response: {cleaned_response_str}")
                        return AuthenticityAnalysisResult(
                            content_module_error_message=f"Invalid JSON: {str(e_json_inner)}. Raw: {cleaned_response_str[:200]}...")
                else:
                    logger.error(
                        f"No JSON object found in Gemini response (authenticity): {e_json_outer}. Response: {cleaned_response_str}")
                    return AuthenticityAnalysisResult(
                        content_module_error_message=f"No JSON object found: {str(e_json_outer)}. Raw: {cleaned_response_str[:200]}...")

            # Default CoherenceCheck if keys are missing or data is not a dict
            def get_coherence_check(data: Optional[Dict]) -> CoherenceCheck:
                if data and isinstance(data, dict):
                    return CoherenceCheck(
                        consistent=data.get("consistent", True),
                        issues_found=data.get("issues_found", [])
                    )
                return CoherenceCheck(consistent=True, issues_found=["Data for check not available or malformed."])

            analysis_data = {
                "timeline_coherence": get_coherence_check(response_json.get("timeline_coherence")),
                "skill_experience_education_alignment": get_coherence_check(
                    response_json.get("skill_experience_education_alignment")),
                "achievement_specificity_score": response_json.get("achievement_specificity_score", 0.5),
                "generic_achievement_examples": response_json.get("generic_achievement_examples", []),
                "ai_used_words_stylistic_score": response_json.get("ai_used_words_stylistic_score", 0.5),
                "ai_stylistic_indicators": response_json.get("ai_stylistic_indicators", []),
                "overall_content_plausibility_score": response_json.get("overall_content_plausibility_score", 0.5),
                "implausible_claims": response_json.get("implausible_claims", []),
                "authenticity_assessment_score_by_content_module": response_json.get(
                    "authenticity_assessment_score_by_content_module", 0.5),
                "authenticity_summary_explanation_by_content_module": response_json.get(
                    "authenticity_summary_explanation_by_content_module",
                    "AI analysis did not provide a specific summary for content module.")
            }

            if "aligned" in response_json.get("skill_experience_education_alignment", {}):
                alignment_data = response_json.get("skill_experience_education_alignment")
                analysis_data["skill_experience_education_alignment"] = CoherenceCheck(
                    consistent=alignment_data.get("aligned", True),
                    issues_found=alignment_data.get("issues_found", [])
                )

            return AuthenticityAnalysisResult(**analysis_data)

        except Exception as e:
            logger.error(f"Error during resume authenticity analysis: {e}", exc_info=True)
            return AuthenticityAnalysisResult(
                content_module_error_message=f"Unexpected error in content analysis module: {str(e)}"
            )