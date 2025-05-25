import logging
import json
from typing import Dict, List, Optional, Union

# Assuming GeminiService is in the same directory or accessible via path
from .gemini_service import GeminiService, configure_gemini

logger = logging.getLogger(__name__)

class InferredSkillsExplanationService:
    def __init__(self, gemini_service: Optional[GeminiService] = None):
        if gemini_service:
            self.gemini_service = gemini_service
        else:
            try:
                configure_gemini() 
            except ValueError as e:
                logger.error(f"Failed to configure Gemini for InferredSkillsExplanationService: {e}")
                raise
            self.gemini_service = GeminiService()

    async def generate_explanations(
        self,
        inferred_skills: Dict[str, List[str]], 
        resume_context: str
    ) -> Dict[str, Dict[str, Dict[str, Union[str, List[str]]]]]: # Return type updated
        """
        Generates specific explanations, evidence sentences, and highlighted keywords 
        for why EACH inferred skill was derived from the resume context.
        """
        if not any(s_list for s_list in inferred_skills.values() if s_list) or not resume_context.strip():
            logger.warning("No inferred skills with content or no resume context provided for explanation generation.")
            return {"technical_skills": {}, "soft_skills": {}, "languages": {}}

        truncated_resume_context = resume_context[:4000] # Max context
        if len(resume_context) > 4000:
            logger.info("Resume context truncated for skill explanation generation prompt.")

        skills_to_explain_prompt_parts = []
        has_any_skill_to_explain = False
        for category_key, skills_list in inferred_skills.items():
            if skills_list:
                category_title = category_key.replace("_", " ").title()
                skills_to_explain_prompt_parts.append(
                    f"- {category_title} to Justify: {', '.join(skills_list)}"
                )
                has_any_skill_to_explain = True
        
        if not has_any_skill_to_explain:
             return {"technical_skills": {}, "soft_skills": {}, "languages": {}}
        skills_to_explain_str = "\n".join(skills_to_explain_prompt_parts)

        prompt = f"""
        You are an expert AI Resume Analyzer. Your task is to provide meticulous, evidence-based justifications for inferred skills.

        Resume Context:
        ---
        {truncated_resume_context}
        ---

        Skills that were Inferred and Require Justification:
        {skills_to_explain_str}

        For EACH skill listed above:
        1.  **Formulate Justification (Mandatory)**: Write a 1-2 sentence justification explaining *why* this skill was inferred from the "Resume Context".
            *   CRITICAL: If the evidence contains dates (e.g., project completion, employment period like "Jan 2022 - Mar 2023", "Q1 2023", "2020-2022"), you MUST explicitly include these dates in your justification string. Format dates clearly, e.g., "[Jan 2022 - Mar 2023]".
            *   ABSOLUTELY NO "Could not find justification" OR SIMILAR PHRASES. You MUST provide a reasoned justification. If direct evidence is sparse, state how the skill is *subtly implied* or *suggested* by broader experiences, achievements, or the nature of roles/projects described. For example: "While 'Strategic Planning' isn't explicitly stated, it's strongly implied by the candidate's senior role in 'developing long-term product roadmaps' for Product X from [2021-2023]."
        2.  **Extract Verbatim Evidence (Mandatory)**: Identify and quote the *exact, original sentence(s)* (max 2-5 short, relevant sentences) from the "Resume Context" that provide the strongest support for this skill inference. This must be a verbatim copy. If direct verbatim evidence is very weak but the skill is implied, pick the closest related sentences and state in the explanation how they contribute to the implication. If no sentence is even remotely relevant, you may state: "Evidence is based on overall context."
        3.  **Identify Highlight Keywords (Mandatory)**: From YOUR "Extract Verbatim Evidence" (step 2), list 3-5 key phrases or words that are most crucial for supporting the skill inference. If "evidence_sentence" is "Evidence is based on overall context...", then `highlighted_keywords` should be an empty array.

        Output ONLY a valid JSON object. The top-level keys are "technical_skills", "soft_skills", and "languages".
        The value for each category key is another JSON object where:
            - Keys are the *exact skill names* (e.g., "Python", "Time Management").
            - Values are JSON objects containing three fields:
                - "explanation": (String) Your detailed justification, including dates.
                - "evidence_sentence": (String) The verbatim sentence(s) extracted from the resume OR "Evidence is based on overall context."
                - "highlighted_keywords": (Array of Strings) The key phrases/words from the evidence, or an empty array.

        Example JSON Output (for "Time Management" under "soft_skills"):
        {{
            "soft_skills": {{
                "Time Management": {{
                    "explanation": "Time management skill was inferred from the candidate's statement about 'successfully managing three concurrent projects' and ensuring 'all deliverables were met ahead of schedule' for the 'Client System Overhaul' project [May 2022 - Aug 2022].",
                    "evidence_sentence": "During the Client System Overhaul project from May 2022 to August 2022, I was responsible for successfully managing three concurrent projects, ensuring all deliverables were met ahead of schedule.",
                    "highlighted_keywords": ["May 2022 to August 2022", "successfully managing three concurrent projects", "deliverables were met ahead of schedule"]
                }},
                "Problem Solving": {{
                    "explanation": "Problem solving is subtly implied by the candidate's description of 'identifying and resolving critical bugs' during the 'System Upgrade' initiative [Q3 2021].",
                    "evidence_sentence": "Identified and resolved critical bugs post-deployment for the System Upgrade initiative in Q3 2021.",
                    "highlighted_keywords": ["Identified and resolved", "critical bugs", "System Upgrade initiative", "Q3 2021"]
                }}
            }},
            "technical_skills": {{}},
            "languages": {{}}
        }}

        IMPORTANT:
        - Ensure EVERY skill provided in the input "Skills that were Inferred..." section has a corresponding entry in the output JSON, fully populated.
        - Match skill names EXACTLY.
        - Adhere strictly to the JSON output format.
        """

        default_skill_explanation_obj = {
            "explanation": "The AI inferred this skill based on the overall resume context, but a direct sentence for evidence was not pinpointed.",
            "evidence_sentence": "",
            "highlighted_keywords": []
        }
        
        final_explanations_obj = {
            "technical_skills": {}, "soft_skills": {}, "languages": {}
        }
        for category_key, skills_list in inferred_skills.items():
            if skills_list:
                for skill_name in skills_list:
                    final_explanations_obj[category_key][skill_name] = {
                        "explanation": f"The AI suggests '{skill_name}' is implied by the resume content. A detailed justification is being processed or was not fully generated.",
                        "evidence_sentence": "",
                        "highlighted_keywords": []
                    }
        
        try:
            logger.info(f"Generating detailed justifications for inferred skills: {json.dumps(inferred_skills, indent=2)}")
            # Consider using a slightly lower temperature for more deterministic justifications
            # generation_config_override = GenerationConfig(temperature=0.3) 
            # response_text = await self.gemini_service.generate_text(prompt, generation_config_override=generation_config_override)
            response_text = await self.gemini_service.generate_text(prompt)


            json_str = response_text
            if "```json" in json_str: json_str = json_str.split("```json")[1]
            if "```" in json_str: json_str = json_str.split("```")[0]
            json_str = json_str.strip()
            
            start_idx = json_str.find('{')
            end_idx = json_str.rfind('}') + 1

            if start_idx != -1 and end_idx != -1:
                json_cleaned = json_str[start_idx:end_idx]
                generated_explanations_full = json.loads(json_cleaned)

                for category_key in ["technical_skills", "soft_skills", "languages"]:
                    original_skills_in_category = inferred_skills.get(category_key, [])
                    # Ensure we get an empty dict if category is missing from LLM response
                    llm_explanations_for_category = generated_explanations_full.get(category_key, {}) 

                    for skill_name in original_skills_in_category:
                        skill_explanation_obj = llm_explanations_for_category.get(skill_name)
                        if skill_explanation_obj and \
                           isinstance(skill_explanation_obj, dict) and \
                           all(k in skill_explanation_obj for k in ["explanation", "evidence_sentence", "highlighted_keywords"]) and \
                           skill_explanation_obj["explanation"].strip() and \
                           not skill_explanation_obj["explanation"].lower().startswith("could not find"): # Extra check
                            final_explanations_obj[category_key][skill_name] = skill_explanation_obj
                        else:
                            logger.warning(f"LLM provided incomplete, missing, or non-compliant justification for skill '{skill_name}' in category '{category_key}'. Original response for skill: {skill_explanation_obj}. Retaining pre-set default.")
                            # The default was already set in final_explanations_obj, so if the LLM fails this skill, it keeps the default.
                
                logger.info("Successfully processed detailed justifications for inferred skills.")
                return final_explanations_obj
            else:
                logger.error(f"Failed to extract valid JSON for detailed skill justifications. Raw text: {response_text}")
                return final_explanations_obj # Returns obj with defaults

        except json.JSONDecodeError as e:
            logger.error(f"JSONDecodeError for detailed skill justifications: {e}. Response: {response_text}")
            return final_explanations_obj
        except Exception as e:
            logger.error(f"Error generating detailed inferred skills justifications: {e}", exc_info=True)
            return final_explanations_obj