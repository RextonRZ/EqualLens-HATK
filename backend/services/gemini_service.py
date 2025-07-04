import os
import json
from typing import List, Dict, Any, Optional, Union
from fastapi import HTTPException
from functools import lru_cache
import google.generativeai as genai
from google.cloud import firestore
import logging
import asyncio
import numpy as np
import re
from google.generativeai.types import GenerationConfig

# Configure logging
logger = logging.getLogger(__name__)

# Import GemmaService 
from .gemma_service import GemmaService

# Configure Gemini API
def configure_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable not set")
    genai.configure(api_key=api_key)

class GeminiService:
    """Service for computing similarity using Gemini."""

    @staticmethod
    def compute_similarity(text1: Optional[str], text2: Optional[str]) -> float:
        """
        Compute similarity between two pieces of text using Gemini.

        Args:
            text1 (Optional[str]): The first text to compare.
            text2 (Optional[str]): The second text to compare.

        Returns:
            float: A similarity score between 0.0 and 1.0.
        """
        if not text1 or not text2:
            # If either text is empty, return 0 similarity
            return 0.0
            
        # For production, this would call Gemini's semantic similarity capability
        # For now, use a more sophisticated mock implementation
        
        # Normalize texts
        text1 = text1.lower()
        text2 = text2.lower()
        
        # Split into words and create sets
        words1 = set(text1.split())
        words2 = set(text2.split())
        
        # Calculate Jaccard similarity (intersection over union)
        intersection = len(words1.intersection(words2))
        union = len(words1.union(words2))
        
        if union == 0:
            return 0.0
            
        jaccard = intersection / union
        
        # Calculate length similarity factor (penalizes big differences in length)
        len1 = len(text1)
        len2 = len(text2)
        length_ratio = min(len1, len2) / max(len1, len2) if max(len1, len2) > 0 else 0.0
        
        # Combine scores with weights
        combined_score = (jaccard * 0.7) + (length_ratio * 0.3)
        
        return combined_score

    @staticmethod
    def _mock_gemini_similarity(text1: str, text2: str) -> float:
        """
        Mock implementation of Gemini similarity computation for demonstration purposes.

        Args:
            text1 (str): The first text to compare.
            text2 (str): The second text to compare.

        Returns:
            float: A mock similarity score between 0.0 and 1.0.
        """
        # Simple example: compute the ratio of common words to total words
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())
        common_words = words1.intersection(words2)
        total_words = words1.union(words2)

        if not total_words:
            return 0.0

        return len(common_words) / len(total_words)

    @staticmethod
    def analyze_resume_changes(resume_changes: Dict[str, List[str]]) -> Dict[str, str]:
        """
        Analyzes resume changes and provides a detailed description and overall assessment.
        
        Args:
            resume_changes: Dictionary containing enriched_fields, reduced_fields lists,
                           and detailed field changes
        
        Returns:
            Dictionary with detailed_changes and overall_assessment
        """
        # Add logging to see what's being received
        logger.info(f"Analyzing resume changes: {resume_changes}")
        
        if not resume_changes:
            logger.warning("Empty resume_changes passed to analyze_resume_changes")
            return {
                "detailed_changes": "No changes detected.",
                "overall_assessment": "no difference"
            }
            
        enriched_fields = resume_changes.get("enriched_fields", [])
        reduced_fields = resume_changes.get("reduced_fields", [])
        field_changes = resume_changes.get("field_changes", {})
        
        # Add logging for the fields
        logger.info(f"Enriched fields: {enriched_fields}")
        logger.info(f"Reduced fields: {reduced_fields}")
        logger.info(f"Field changes: {field_changes}")
        
        if not enriched_fields and not reduced_fields:
            return {
                "detailed_changes": "No significant changes detected.",
                "overall_assessment": "no difference"
            }
        
        # Format field names to be more user-friendly
        def format_field_name(field_name: str) -> str:
            # Remove "_paragraph" suffix
            field_name = field_name.replace("_paragraph", "")
            # Replace underscores with spaces and capitalize each word
            return field_name.replace("_", " ").replace("-", " ").title()
        
        # Create formatted versions of the field lists
        formatted_enriched = [format_field_name(field) for field in enriched_fields]
        formatted_reduced = [format_field_name(field) for field in reduced_fields]
        
        # Generate specific details about what changed in each field - but more concisely
        specific_changes = []
        
        # Process enriched fields with specifics but limit verbosity
        if field_changes and enriched_fields:
            # First, collect all additions by category
            additions_by_category = {}
            
            for field in enriched_fields:
                if field in field_changes and "added" in field_changes[field]:
                    added_items = field_changes[field]["added"]
                    if added_items:
                        # For skills, languages, etc.
                        if field in ["technical_skills", "soft_skills", "languages"]:
                            # Limit to top 3-5 skills with cleaner formatting
                            skill_list = ", ".join(added_items[:4])
                            if len(added_items) > 4:
                                skill_list += f", and {len(added_items) - 4} more"
                            additions_by_category[field] = f"Added {format_field_name(field)}: {skill_list}"
                        # For longer text fields (projects, certifications, etc.)
                        else:
                            # Just mention count with a highlight of one example
                            if len(added_items) == 1:
                                # Get the first 40 chars of the first item as a preview
                                preview = added_items[0][:40].strip()
                                if len(added_items[0]) > 40:
                                    preview += "..."
                                additions_by_category[field] = f"Added to {format_field_name(field)}: \"{preview}\""
                            else:
                                # For multiple items, just mention the count
                                additions_by_category[field] = f"Added {len(added_items)} new entries to {format_field_name(field)}"
            
            # Convert to a list for final output, prioritizing the most significant changes
            specific_changes = list(additions_by_category.values())
        
        # Process reduced fields with specifics - keep concise as well
        if field_changes and reduced_fields:
            removals_by_category = {}
            
            for field in reduced_fields:
                if field in field_changes and "removed" in field_changes[field]:
                    removed_items = field_changes[field]["removed"]
                    if removed_items:
                        # Similar approach as with additions, but for removals
                        if field in ["technical_skills", "soft_skills", "languages"]:
                            if len(removed_items) <= 3:
                                removals_by_category[field] = f"Removed {format_field_name(field)}: {', '.join(removed_items)}"
                            else:
                                removals_by_category[field] = f"Removed {len(removed_items)} {format_field_name(field)} entries"
                        else:
                            # Just mention that content was removed from this section
                            removals_by_category[field] = f"Removed content from {format_field_name(field)}"
            
            specific_changes.extend(list(removals_by_category.values()))
        
        # Determine assessment based on field counts
        if len(enriched_fields) > len(reduced_fields):
            assessment = "enhanced"
            if len(enriched_fields) >= 3:
                description = f"Significant improvements with new content in {len(enriched_fields)} areas: {', '.join(formatted_enriched)}."
            else:
                description = f"Resume enhanced with new content in {', '.join(formatted_enriched)}."
                
        elif len(reduced_fields) > len(enriched_fields):
            assessment = "degraded"
            if len(reduced_fields) >= 3:
                description = f"Content has been removed from {len(reduced_fields)} areas: {', '.join(formatted_reduced)}."
            else:
                description = f"Resume has reduced content in {', '.join(formatted_reduced)}."
                
        else:  # Equal number of changes
            if len(enriched_fields) == 0:
                assessment = "no difference"
                description = "Minor formatting changes detected, but no significant content differences."
            else:
                assessment = "mixed changes"
                description = f"Equal changes with new content in {', '.join(formatted_enriched)} and removed content from {', '.join(formatted_reduced)}."
        
        # Add specific changes to the description in a more concise way
        if specific_changes:
            # Join with proper sentence structure and limit to 2-3 specific examples
            if len(specific_changes) <= 3:
                specific_details = " " + " ".join(specific_changes)
            else:
                # Pick the most important changes (first 2) and summarize the rest
                specific_details = f" {specific_changes[0]} {specific_changes[1]} and {len(specific_changes) - 2} other changes."
                
            description += specific_details
        
        result = {
            "detailed_changes": description,
            "overall_assessment": assessment
        }
        
        # Log the result
        logger.info(f"Resume analysis result: {result}")
        return result

    def __init__(self):
        configure_gemini()
        self.stable_generation_config = GenerationConfig(
            temperature=0.5
        )
        self.model = genai.GenerativeModel(
            'gemini-2.0-flash',
            generation_config=self.stable_generation_config  # Apply config at model initialization
        )
        self.db = firestore.Client()
        self.semaphore = asyncio.Semaphore(5)
        try:
            # Initialize GemmaService instance
            self.gemma_service = GemmaService()
            logger.info("GemmaService initialized successfully within GeminiService.")
        except Exception as e:
            logger.error(f"Failed to initialize GemmaService within GeminiService: {e}", exc_info=True)
            self.gemma_service = None  # Set to None if initialization fails

    async def generate_text(self, prompt_content: Any, safety_settings: Optional[List[Dict]] = None, generation_config_override: Optional[GenerationConfig] = None) -> str:
        """
        Generic method to generate text using the configured Gemini model.

        Args:
            prompt_content: The content to send to the model (can be a string or a list of parts).
            safety_settings: Optional safety settings for the generation.

        Returns:
            The generated text as a string, or an error message.
        """
        async with self.semaphore: # Ensure rate limiting for all calls through this method
            try:
                # Determine which generation config to use
                current_gen_config = generation_config_override if generation_config_override else self.stable_generation_config

                response = await self.model.generate_content_async(
                    prompt_content,
                    safety_settings=safety_settings,
                    generation_config=current_gen_config # Use the determined config
                )

                # Robustly extract text from response
                text_output = ""
                if hasattr(response, 'text'):
                    text_output = response.text
                elif hasattr(response, 'parts') and response.parts:
                    text_output = "".join(part.text for part in response.parts if hasattr(part, 'text'))
                
                if not text_output and hasattr(response, 'prompt_feedback') and response.prompt_feedback:
                    block_reason = response.prompt_feedback.block_reason
                    if block_reason:
                        logger.warning(f"Gemini content generation blocked. Reason: {block_reason}. Prompt: {str(prompt_content)[:100]}")
                        # Return a specific message or raise an exception based on block_reason
                        return f"Error: Content generation blocked by safety filter ({block_reason})."

                if not text_output:
                    logger.warning(f"Gemini response was empty or had no text content. Prompt: {str(prompt_content)[:100]}")
                    return "Error: Gemini returned an empty response."

                logger.info("Received text response from Gemini.")
                return text_output.strip()

            except Exception as e:
                logger.error(f"Error during Gemini text generation: {e}", exc_info=True)
                # You might want to return a more specific error or raise a custom exception
                return f"Error communicating with Gemini: {str(e)}"
    
    async def score_applicant(self, applicant: Dict[str, Any], job_description: str, criteria: str) -> Dict[str, Any]:
        """
        Score an individual applicant based on their data, job description, and selected criteria.

        Args:
            applicant: Dictionary containing applicant data with extractedText.
            job_description: String describing the job's requirements and responsibilities.
            criteria: String specifying the criteria to evaluate (e.g., "skills, experience").

        Returns:
            Dictionary with rank_score and reasoning for each evaluated criterion.
        """
        extracted_text = applicant.get("extractedText", {})

        # Define the system prompt for Gemini
        system_prompt = f"""
        You are an expert resume analyzer. Evaluate the candidate's resume information based on the job description 
        and the selected criteria: {criteria}. For each criterion, score the candidate from 0 to 10 and provide reasoning.

        Criteria details:
        - Skills:
            1. Relevance: Evaluate how well the candidate's skills match the job description.
            2. Proficiency: Assess the candidate's level of skill proficiency which would benefit the job description.
            3. AdditionalSkill: Identify additional skills the candidate has that are not listed in the job description.
        - Experience:
            1. JobExp: Evaluate the alignment of the candidate's previous job experience with the job description.
            2. ProjectCocurricularExp: Assess the relevance of the candidate's projects and co-curricular activities that relates to the job.
            3. Certification: Evaluate the certifications and training the candidate has complete which would benefit the job description.
        - Education:
            1. StudyLevel: Assess the candidate's level of study and education.
            2. Awards: Evaluate the candidate's awards and achievements which would benefit the job description.
            3. CourseworkResearch: Assess the relevance of the candidate's coursework and research that relates to the job.
        - CulturalFit:
            1. CollaborationStyle: Evaluate how well the candidate demonstrates the ability to work with others, such as leadership roles, teamwork, or group project experience.
            2. GrowthMindset: Assess the candidate's willingness to learn, improve, and adapt through certifications, awards, or self-initiated learning.
            3. CommunityEngagement: Evaluate the candidate's involvement in community, volunteering, or organizational activities that showcase cultural adaptability and inclusive contributions.

        VERY IMPORTANT:
        - Base all evaluations on the job description and the candidate's profile details at all times.
        - Provide a score from 0 to 10 for each criterion, where 0 means "not at all relevant" and 10 means "extremely relevant".
        - Respond ONLY with a valid JSON object in the following format and nothing else (no explanation, no markdown formatting, no text before or after):

        {{
            "rank_score": {{
                "relevance": <integer 0-10>,
                "proficiency": <integer 0-10>,
                "additionalSkill": <integer 0-10>,
                "jobExp": <integer 0-10>,
                "projectCocurricularExp": <integer 0-10>,
                "certification": <integer 0-10>,
                "studyLevel": <integer 0-10>,
                "awards": <integer 0-10>,
                "courseworkResearch": <integer 0-10>,
                "collaborationStyle": <integer 0-10>,
                "growthMindset": <integer 0-10>,
                "communityEngagement": <integer 0-10>
            }},
            "reasoning": {{
                "relevance": "<brief explanation>",
                "proficiency": "<brief explanation>",
                "additionalSkill": "<brief explanation>",
                "jobExp": "<brief explanation>",
                "projectCocurricularExp": "<brief explanation>",
                "certification": "<brief explanation>",
                "studyLevel": "<brief explanation>",
                "awards": "<brief explanation>",
                "courseworkResearch": "<brief explanation>",
                "collaborationStyle": "<brief explanation>",
                "growthMindset": "<brief explanation>",
                "communityEngagement": "<brief explanation>"
            }}
        }}
        """

        try:
            # Format the input for Gemini
            formatted_text = f"Job Description:\n{job_description}\n\nResume Information:\n"
            for key, value in extracted_text.items():
                formatted_text += f"{key}: {value}\n\n"

            # Send the prompt to Gemini
            response = await self.model.generate_content_async(
                [system_prompt, formatted_text]
            )

            # Extract the JSON from the response text
            response_text = response.text
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1

            if start_idx != -1 and end_idx != -1:
                json_str = response_text[start_idx:end_idx]
                scores = json.loads(json_str)

                # Validate and clean up scores
                rank_score = scores.get("rank_score", {})
                reasoning = scores.get("reasoning", {})

                # Ensure all criteria in the selected categories are present
                required_criteria = []
                if "skills" in criteria.lower():
                    required_criteria.extend(["relevance", "proficiency", "additionalSkill"])
                if "experience" in criteria.lower():
                    required_criteria.extend(["jobExp", "projectCocurricularExp", "certification"])
                if "education" in criteria.lower():
                    required_criteria.extend(["studyLevel", "awards", "courseworkResearch"])
                if "cultural fit" in criteria.lower():
                    required_criteria.extend(["collaborationStyle", "growthMindset", "communityEngagement"])

                # Filter rank_score and reasoning to include only relevant criteria
                rank_score = {key: rank_score[key] for key in required_criteria if key in rank_score}
                reasoning = {key: reasoning[key] for key in required_criteria if key in reasoning}

                # Generate combined_reasoning by sending a second prompt to Gemini
                combined_reasoning_prompt = f"""
                Based on the following candidate evaluation points, create a brief, natural-sounding summary
                in just 1-2 short sentences that captures the key strengths or gaps:

                Candidate evaluation:
                {json.dumps(reasoning, indent=2)}

                VERY IMPORTANT:
                - Use natural, conversational language (avoid robotic or overly formal phrasing)
                - Focus only on the 1-2 most distinctive qualities
                - Keep your response under 25 words
                - Respond with ONLY the summary text (no JSON, no formatting, no extra explanation)
                """
                combined_reasoning_response = await self.model.generate_content_async(
                    [combined_reasoning_prompt]
                )
                combined_reasoning = combined_reasoning_response.text.strip()

                # Add combined_reasoning to the reasoning dictionary
                reasoning["combined_reasoning"] = combined_reasoning

                # Prepare the result
                result = {
                    "rank_score": rank_score,
                    "reasoning": reasoning
                }

                return result
            else:
                raise ValueError("Failed to extract JSON from Gemini response")

        except Exception as e:
            logger.error(f"Error scoring applicant: {str(e)}")
            raise HTTPException(status_code=500, detail="An error occurred while scoring the applicant. Please try again later.")
    
    async def rank_applicants(self, prompt: str, applicants: List[Dict[str, Any]], job_document: Dict[str, Any]) -> Dict[str, Any]:
        """
        Rank applicants based on job requirements and user prompt.
        
        Args:
            prompt: User input describing ranking criteria
            applicants: List of applicant data
            job_document: Job document containing job description
            
        Returns:
            Dictionary with ranked applicants
        """
        try:
            # Validate inputs
            if not prompt:
                raise ValueError("Prompt cannot be empty")
            if not applicants:
                return {"applicants": [], "message": "No applicants to rank"}
            if not job_document or "jobDescription" not in job_document:
                raise ValueError("Job document must contain jobDescription")
                
            job_description = job_document.get("jobDescription", "")
            
            # Extract criteria from prompt
            criteria = prompt

            # Define constants outside function for better performance
            CRITERIA_WEIGHTS = {
                "skills": {
                    "relevance": 0.50,
                    "proficiency": 0.35,
                    "additionalSkill": 0.15
                },
                "experience": {
                    "jobExp": 0.50,
                    "projectCocurricularExp": 0.30,
                    "certification": 0.20
                },
                "education": {
                    "studyLevel": 0.40,
                    "awards": 0.30,
                    "courseworkResearch": 0.30
                },
                "culturalFit": {
                    "collaborationStyle": 0.40,
                    "growthMindset": 0.30,
                    "communityEngagement": 0.30
                }
            }

            # Function to score a single applicant with semaphore to limit concurrency
            async def score_single_applicant(applicant):
                async with self.semaphore:  # Limit concurrent API calls
                    try:
                        scores = await self.score_applicant(applicant, job_description, criteria)
                        
                        # Get rank scores
                        rank_scores = scores.get("rank_score", {})
                        if not rank_scores:
                            return {
                                **applicant,
                                "rank_score": {"final_score": 0},
                                "reasoning": {"error": "Failed to get rank scores"}
                            }
                        
                        # Determine which main criteria are present in the prompt
                        prompt_lower = criteria.lower()
                        main_criteria_present = {
                            "skills": "skills" in prompt_lower,
                            "experience": "experience" in prompt_lower,
                            "education": "education" in prompt_lower,
                            "culturalFit": "cultural fit" in prompt_lower or "cultural" in prompt_lower
                        }
                        
                        # If no criteria mentioned explicitly, assume all are equally important
                        if not any(main_criteria_present.values()):
                            main_criteria_present = {k: True for k in main_criteria_present}
                        
                        # Count number of active criteria for weighting
                        active_criteria_count = sum(1 for v in main_criteria_present.values() if v)
                        
                        # Calculate weighted final score
                        final_score = 0.0
                        
                        # Process each main criterion if present
                        for main_criterion, is_present in main_criteria_present.items():
                            if not is_present:
                                continue
                                
                            # Get weights for subcriteria in this category
                            subcriteria_weights = CRITERIA_WEIGHTS[main_criterion]
                            
                            # Calculate weighted sum for this criterion
                            criterion_score = 0.0
                            weight_sum = 0.0
                            
                            for subcriterion, weight in subcriteria_weights.items():
                                if subcriterion in rank_scores:
                                    criterion_score += rank_scores[subcriterion] * weight
                                    weight_sum += weight
                            
                            # Only add to final score if we have valid subcriteria
                            if weight_sum > 0:
                                # Normalize score within this criterion
                                normalized_score = criterion_score / weight_sum
                                
                                # Add to final score with equal weighting for each main criterion
                                final_score += normalized_score / active_criteria_count
                        
                        # Scale to 0-100 and round to 2 decimal places
                        scores["rank_score"]["final_score"] = round(final_score * 10.0, 2)
                        
                        return {**applicant, **scores}
                    except Exception as e:
                        logger.error(f"Error scoring applicant {applicant.get('candidateId', 'unknown')}: {str(e)}")
                        return {
                            **applicant, 
                            "rank_score": {"final_score": 0},
                            "reasoning": {"error": f"Failed to score: {str(e)}"}
                        }
            
            # Use asyncio.gather to process applicants in parallel
            logger.info(f"Starting parallel processing of {len(applicants)} applicants")
            tasks = [score_single_applicant(applicant) for applicant in applicants]
            scored_applicants = await asyncio.gather(*tasks)
            
            # Sort applicants by final score (descending)
            ranked_applicants = sorted(
                scored_applicants, 
                key=lambda x: x.get("rank_score", {}).get("final_score", 0), 
                reverse=True
            )
            
            return {
                "applicants": ranked_applicants
            }
        except Exception as e:
            logger.error(f"Error ranking applicants: {str(e)}")
            raise HTTPException(status_code=500, detail="An error occurred while ranking the applicants. Please try again later.")
    
    async def generate_candidate_profile(self, applicant: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate a summary profile for a candidate based on their resume data.

        Args:
            applicant: Dictionary containing applicant data potentially including extractedText
                    or direct keys like soft_skills, technical_skills etc.

        Returns:
            Dictionary with summary, skills, education, and experience sections
        """
        # Prioritize direct keys if they exist, otherwise fallback to extractedText
        direct_keys = ["soft_skills", "technical_skills", "languages", "education_paragraph",
                    "certifications_paragraph", "awards_paragraph", "work_experience_paragraph",
                    "projects_paragraph", "co_curricular_activities_paragraph", "bio",
                    "extractedText"] # Add other potential direct keys as needed

        resume_data = {}
        for key in direct_keys:
            if key in applicant:
                resume_data[key] = applicant[key]

        # If extractedText exists, merge its contents, potentially overriding
        # individual paragraphs if extractedText is considered more comprehensive
        # or structured differently by the extraction process.
        # Adjust this logic based on how your applicant dict is structured.
        # This example assumes extractedText might contain richer/parsed data.
        extracted_text_data = applicant.get("extractedText", {})
        if isinstance(extracted_text_data, dict):
            resume_data.update(extracted_text_data) # Merge/override keys

        # Remove PII before sending to LLM (ensure these are not present in resume_data sent)
        pii_keys = ["applicant_contactNum", "applicant_mail", "applicant_name", "applicant_id"] # Add any other PII keys
        for key in pii_keys:
            resume_data.pop(key, None)
            # Also remove from the top-level applicant dict if necessary, though we only use resume_data below
            applicant.pop(key, None)


        system_prompt = """
        You are an expert resume analyzer. Review the provided candidate information and generate a structured profile into a clean, professional JSON profile.

        **Input Data:** The input contains various sections extracted or parsed from a resume. This might include lists (like soft_skills, technical_skills, languages) or text paragraphs (like education_paragraph, work_experience_paragraph, projects_paragraph, etc.).

        **Instructions:**

        1.  **Generate a `summary`:** 
            * Provide a concise paragraph (around 3-5 sentences) highlighting the candidate's key strengths, notable experiences/projects, and potentially areas for development or missing information.
            * Synthesize information from *all* relevant input fields (skills, experience, education, projects, etc.).
            * Use `<strong>` tags to emphasize truly significant points (e.g., key skills, major achievements).**Ensure all HTML tags are correctly opened and closed.**
            * **IMPORTANT:** Always use "he/she" pronouns rather than "they/them" when referring to the candidate.
            * **Crucially, OMIT any Personal Identifying Information (PII)** like name, email, phone number, or explicit bio text from the summary.

        2.  **Extract and Structure Categorical Information:** Populate the following fields in the JSON output. If the corresponding information is not available in the input, OMIT the field entirely from the JSON.
            * **`soft_skills`**: If a list of soft skills is provided in the input, use that list directly. Otherwise, extract from relevant text. Output as a list of strings.
            * **`technical_skills`**: If a list of technical skills is provided, use it directly. Otherwise, extract from relevant text. Output as a list of strings.
            * **`languages`**: If a list of languages is provided, use that list directly. Otherwise, extract from relevant text. Output as a list of strings.
            * **`education`**: Process the `education_paragraph`. For each education entry:
                * Format as:
                    - First line: `<strong>Degree/Program</strong>` (bold) on the left, `<strong>Date</strong>` (bold) on the right (use "DNS" if date not specified).
                    - Second line: Institution name (if available).
                    - Third line: Additional details (if available), each as a separate point.
            * **`certifications`**: Process the `certifications_paragraph`. For each certification:
                * Format as:
                    - First line: `<strong>Certification Name</strong>` (bold) on the left, `<strong>Date</strong>` (bold) on the right (use "DNS" if date not specified).
                    - Second line: Issuing organization (if available).
                    - Third line: Additional details (if available), each as a separate point.
            * **`awards`**: Process the `awards_paragraph`. For each award:
                * Format as:
                    - First line: `<strong>Award Name</strong>` (bold) on the left, `<strong>Date</strong>` (bold) on the right (use "DNS" if date not specified).
                    - Second line: Awarding organization (if available).
                    - Third line: Additional details (if available), each as a separate point.
            * **`work_experience`**: Process the `work_experience_paragraph`. For each job/role:
                * Format as:
                    - First line: `<strong>Job Title</strong>` (bold) on the left, `<strong>Duration</strong>` (bold) on the right (use "DNS" if duration not specified).
                    - Second line: Company name (if available).
                    - Third line: Responsibilities/achievements, each as a separate point.
            * **`projects`**: Process the `projects_paragraph`. For each project:
                * Format as:
                    - First line: `<strong>Project Title</strong>` (bold) on the left, `<strong>Date</strong>` (bold) on the right (use "DNS" if date not specified).
                    - Second line: Small title/description (if available).
                    - Third line: Additional details (if available), each as a separate point.
            * **`co_curricular_activities`**: Process the `co_curricular_activities_paragraph`. For each activity:
                * Format as:
                    - First line: `<strong>Activity Name/Role</strong>` (bold) on the left, `<strong>Duration</strong>` (bold) on the right (use "DNS" if duration not specified).
                    - Second line: Organization name (if available).
                    - Third line: Additional details (if available), each as a separate point.

        **VERY IMPORTANT:**
        * **Format Structure:** For all entries (education, work experience, projects, etc.):
            - Use square brackets [ ] to enclose date/duration information, placing it at the end of the title line.
            - Always use "\\n" to create a new line for additional details after the title line.
            - Never omit or summarize any details from the original text - preserve all content.
            - The frontend will render the "\\n" as proper line breaks.
        * **Respond ONLY with a valid JSON object.** No introductory text, no explanations, no markdown formatting around the JSON.
        * **Strictly EXCLUDE PII:** Do not include applicant_contactNum, applicant_mail, applicant_name, specific bio text, or any other directly identifying information in the output JSON.
        * **Omit Empty Fields:** If a category (e.g., `awards`) has no information in the input resume data, do not include the corresponding key in the output JSON.
        * **Preserve Structure in Lists:** Each item in a list should correspond to one distinct entry from the resume.
        *   **CRITICAL CLEANING STEP:** Before creating the string for an entry, examine each line of text. **You MUST remove any leading bullet point characters** like 'O ', '■ ', '• ', or '- ' from the start of every line.
        *   **`soft_skills`**, **`technical_skills`**, **`languages`**:
                *   **Normalize:** From descriptive phrases, extract only the core technology or skill name. (e.g., "Used Java for mobile application development" -> "Java"; "Familiar with GitHub" -> "GitHub"; "Applied knowledge in MongoDB" -> "MongoDB").   
                *   **Split:** If a single line contains multiple distinct skills (e.g., joined by 'and', '/', or ','), split them into separate items in the list (e.g., "Wix Studio and Microsoft Office" -> ["Wix Studio", "Microsoft Office"]). "Used SQL for creating database in Oracle APEX" -> ["SQL", "Oracle APEX"].
         *   **Ensure all HTML tags like `<strong>` are properly closed with `</strong>`.**
                
        **Output JSON Format Example:**
        ```json
        {
            "summary": "A concise summary highlighting strengths like <strong>key skill</strong> and weaknesses, based on experience and education. He/She has demonstrated expertise in...",
            "soft_skills": ["Skill A", "Skill B"],
            "technical_skills": ["Tech 1", "Tech 2"],
            "languages": ["Language 1"],
            "education": ["<strong>Bachelor of Science in Computer Science</strong> [2018-2022]\\nUniversity X\\nGPA: 3.8, Dean's List"],
            "work_experience": ["<strong>Software Engineer</strong> [Jan 2019-Present]\\nCompany Y\\nLed development of X product\\nImproved performance by 30%"],
            "projects": ["<strong>E-commerce Platform</strong> [2020]\\nBuilt using React, Node.js, and MongoDB"],
            "certifications": ["<strong>AWS Certified Solutions Architect</strong> [2021]\\nAmazon Web Services"],
            "awards": ["<strong>Best Coding Project Award</strong> [2021]\\nUniversity Hackathon"],
            "co_curricular_activities": ["<strong>Volunteer Web Developer</strong> [2020-Present]\\nLocal Non-profit\\nMaintaining organization website"]
        }
        ```
        """

        # Format the available resume data for the prompt
        # Only include non-empty fields to avoid cluttering the prompt
        formatted_input = "Candidate Resume Information:\n"
        for key, value in resume_data.items():
            # Skip empty values or potentially sensitive keys missed earlier
            if value and key not in pii_keys:
                # Handle lists vs strings cleanly in the prompt input
                if isinstance(value, list):
                    formatted_input += f"{key}: {', '.join(map(str, value))}\n\n"
                else:
                    formatted_input += f"{key}: {value}\n\n"

        # Handle cases where no useful data was found
        if formatted_input == "Candidate Resume Information:\n":
            logging.warning("No processable resume data found for candidate.")
            # Return an empty structure or default message
            return {"summary": "No resume information available to generate a profile."}

        try:
            # Make the API call
            response = await self.model.generate_content_async(
                [system_prompt, formatted_input]
            )

            # Extract the JSON from the response text
            response_text = response.text
            # Log the raw response for debugging
            logging.debug(f"Raw Gemini response for profile generation: {response_text}")

            # Improved JSON extraction (handle potential markdown code fences)
            json_str = response_text
            if "```json" in json_str:
                json_str = json_str.split("```json")[1]
            if "```" in json_str:
                json_str = json_str.split("```")[0]

            json_str = json_str.strip()

            # Handle potential leading/trailing characters if extraction wasn't perfect
            start_idx = json_str.find('{')
            end_idx = json_str.rfind('}') + 1

            if start_idx != -1 and end_idx != -1:
                json_str_cleaned = json_str[start_idx:end_idx]
                profile_data = json.loads(json_str_cleaned)

                # Post-process skills to handle commas, ampersands, and other separators
                if 'technical_skills' in profile_data:
                    profile_data['technical_skills'] = self.clean_and_split_skills(profile_data['technical_skills'])
                    
                if 'soft_skills' in profile_data:
                    profile_data['soft_skills'] = self.clean_and_split_skills(profile_data['soft_skills'])
                    
                if 'languages' in profile_data:
                    profile_data['languages'] = self.clean_and_split_skills(profile_data['languages'])
                
                # After processing standard skills, infer additional skills from context
                inferred_skills = await self.infer_additional_skills(resume_data, profile_data)
                
                # Add inferred skills to the profile data
                if inferred_skills:
                    profile_data['inferred_technical_skills'] = inferred_skills.get('technical_skills', [])
                    profile_data['inferred_soft_skills'] = inferred_skills.get('soft_skills', [])
                    profile_data['inferred_languages'] = inferred_skills.get('languages', [])

                if inferred_skills and any(inferred_skills.values()): # Check if any skill list is non-empty
                    # The context for explanation should be the same text used for inference.
                    contextual_info_for_explanation = ""
                    for key, value in resume_data.items():
                        # Use a broader set of keys to build a rich context
                        if key in ["work_experience_paragraph", "projects_paragraph", "education_paragraph", 
                                "certifications_paragraph", "co_curricular_activities_paragraph", 
                                "bio", "full_text", "extractedText"]:
                            if isinstance(value, str) and value.strip():
                                # Handle extractedText being a dict
                                if key == "extractedText" and isinstance(value, dict):
                                    contextual_info_for_explanation += value.get("full_text", "") + "\n\n"
                                else:
                                    contextual_info_for_explanation += f"{value}\n\n"
                    
                    if contextual_info_for_explanation.strip():
                        try:
                            from .inferred_skills_explanation_service import InferredSkillsExplanationService 
                            explanation_service = InferredSkillsExplanationService(gemini_service=self) 
                            explanations = await explanation_service.generate_explanations(
                                inferred_skills,
                                contextual_info_for_explanation
                            )
                            if explanations and any(explanations.values()):
                                profile_data['inferred_skills_explanations'] = explanations
                                logger.info("Successfully generated and added inferred skills explanations.")
                            else:
                                logger.info("Explanation service returned no valid explanations.")
                        except ImportError:
                            logger.error("Could not import InferredSkillsExplanationService. Explanations not generated.")
                        except Exception as ex_gen_e:
                            logger.error(f"Error generating inferred skills explanations: {ex_gen_e}", exc_info=True)
                    else:
                        logger.warning("No contextual info found in resume_data; skipping inferred skills explanation generation.")

                # Validate minimum required fields (e.g., summary)
                if 'summary' not in profile_data or not profile_data['summary']:
                    # Add a default summary or raise a more specific error if needed
                    profile_data['summary'] = "Summary could not be generated from the provided information."
                    logging.warning("Generated profile is missing the summary field.")

                # If job info is available in the applicant data, analyze relevance
                if "job_description" in applicant and applicant["job_description"]:
                    # Use original function for overall relevance (modal display)
                    relevance_data = await self.analyze_job_relevance(profile_data, applicant["job_description"])
                    if relevance_data:
                        profile_data["relevance_analysis"] = relevance_data
                    
                    # Use new function for per-item relevance (star display)
                    logger.info("About to call analyze_per_item_relevance")
                    per_item_relevance = await self.analyze_per_item_relevance(profile_data, applicant["job_description"])
                    logger.info(f"analyze_per_item_relevance returned: {per_item_relevance}")
                    if per_item_relevance:
                        profile_data["per_item_relevance"] = per_item_relevance
                        logger.info("Successfully set per_item_relevance in profile_data")
                    else:
                        logger.warning("analyze_per_item_relevance returned empty/falsy result")
                else:
                    # Even without job description, add empty per_item_relevance structure for frontend compatibility
                    profile_data["per_item_relevance"] = {
                        "technical_skills": [],
                        "soft_skills": [],
                        "languages": [],
                        "education": [],
                        "certifications": [],
                        "awards": [],
                        "work_experience": [],
                        "projects": [],
                        "co_curricular_activities": []
                    }

                logging.info(f"Successfully generated candidate profile: {list(profile_data.keys())}")
                return profile_data
            else:
                logging.error(f"Failed to extract valid JSON from Gemini response. Raw text: {response_text}")
                raise ValueError("Failed to extract JSON from Gemini response")

        except json.JSONDecodeError as e:
            logging.error(f"Failed to decode JSON from Gemini response. Error: {e}. Response text: {response_text}")
            raise ValueError(f"Invalid JSON received from Gemini: {e}")
        except Exception as e:
            logging.error(f"An unexpected error occurred during candidate profile generation: {e}", exc_info=True)
            # Return a default error structure or re-raise
            return {"summary": f"Error generating profile: {e}"}
            
        except Exception as e:
            logger.error(f"Error inferring additional skills: {e}", exc_info=True)
            return {"technical_skills": [], "soft_skills": [], "languages": []}

    async def analyze_job_relevance(self, candidate_profile, job_description):
        """
        Analyzes candidate profile items against job description for a holistic initial judgment.
        This version is more robust and considers the entire profile.
        """
        if not candidate_profile or not job_description:
            logger.warning("Missing candidate profile or job description for relevance analysis")
            return {}

        logger.info(f"Starting holistic job relevance analysis with job description length: {len(job_description)}")

        # Prepare a comprehensive summary of the candidate's profile for the AI
        profile_summary = "Candidate Profile:\n"
        # Ensure we check for 'extractedText' if candidate_profile is nested
        profile_to_scan = candidate_profile.get("extractedText", candidate_profile)

        for category, items in profile_to_scan.items():
            if items:
                # Format category name for readability
                formatted_category = category.replace('_', ' ').title()
                profile_summary += f"\n{formatted_category}:\n"
                if isinstance(items, list):
                    for item in items:
                        profile_summary += f"- {str(item).strip()}\n"
                else:
                    profile_summary += f"- {str(items).strip()}\n"
        
        if len(profile_summary) < 100: # Check if there's any meaningful content
             logger.warning("Not enough content in profile to perform relevance analysis.")
             return {}

        # System prompt for a holistic relevance judgment
        system_prompt = f"""
        You are an expert HR analyst. Your task is to provide a holistic judgment on a candidate's relevance for a specific job.
        Based on the **entire candidate profile** and the **job description**, you will determine:
        1. A `relevance_label`: Either "Relevant" or "Irrelevant".
        2. An `overall_relevance_score`: An integer from 0 to 100, representing the percentage of match.
        3. The `irrelevant_reason`in at least 3 sentences if the label is "Irrelevant".
        4. The `job_type` you inferred: Either "technical" or "managerial".

        **CRITICAL INSTRUCTIONS:**
        - A score below 50 means the candidate is "Irrelevant".
        - Base your judgment on the **combination of skills, projects, and work experience**. Do not just match keywords.
        - A candidate with strong, relevant project experience should be considered highly relevant for a technical role, even if their skills list is short.
        - A candidate with only generic skills and no specific, matching projects or work experience is likely a poor fit.
        
        **Job Description:**
        {job_description}

        **Candidate Profile:**
        {profile_summary}

        **Output Format (Strict JSON ONLY):**
        Respond ONLY with a valid JSON object. Do not include any other text or markdown.

        If Relevant:
        {{
          "relevance_label": "Relevant",
          "overall_relevance_score": <integer_from_50_to_100>,
          "job_type": "<technical_or_managerial>"
        }}

        If Irrelevant:
        {{
          "relevance_label": "Irrelevant",
          "overall_relevance_score": <integer_from_0_to_49>,
          "irrelevant_reason": "<clear explanation of the mismatch in at least 3 sentences>",
          "job_type": "<technical_or_managerial>"
        }}
        """

        try:
            logger.info("Sending holistic job relevance analysis request to Gemini.")
            response = await self.model.generate_content_async([system_prompt])
            response_text = response.text.strip()
            
            # Clean and parse JSON
            if response_text.startswith("```json"):
                response_text = response_text.split("```json")[1].strip()
            if response_text.endswith("```"):
                response_text = response_text.split("```")[0].strip()

            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1

            if start_idx != -1 and end_idx != -1:
                json_str = response_text[start_idx:end_idx]
                relevance_data = json.loads(json_str)
                logger.info(f"Holistic relevance analysis result: {relevance_data}")
                return relevance_data
            else:
                logger.error(f"Failed to extract JSON from Gemini response for holistic relevance. Raw: {response_text}")
                return {}

        except Exception as e:
            logger.error(f"Error in holistic analyze_job_relevance: {e}", exc_info=True)
            return {}
        
    async def infer_additional_skills(self, resume_data: Dict[str, Any], profile_data: Dict[str, Any]) -> Dict[str, List[str]]:
        """
        Infers skills that are implied but not explicitly mentioned in the resume.
        """
        existing_technical = set(profile_data.get('technical_skills', []))
        existing_soft = set(profile_data.get('soft_skills', []))
        existing_languages = set(profile_data.get('languages', [])) # Ensure this includes initially parsed languages
        
        contextual_info = ""
        for key, value in resume_data.items():
            if key in ["work_experience_paragraph", "projects_paragraph", "education_paragraph", 
                      "certifications_paragraph", "co_curricular_activities_paragraph", "bio", "full_text", "extractedText"]: # Added full_text and extractedText as possible context sources
                if isinstance(value, str) and value.strip():
                    # If 'extractedText' is a dict, we might want its 'full_text' or similar
                    if key == "extractedText" and isinstance(value, dict):
                        contextual_info += value.get("full_text", "") + "\n\n"
                    else:
                        contextual_info += f"{value}\n\n"
        
        if len(contextual_info.strip()) < 100: # Increased slightly, but main check is if any text exists
            logger.info("Not enough contextual information to reliably infer additional skills.")
            return {"technical_skills": [], "soft_skills": [], "languages": []}
        
        # Prepare the list of already identified skills for the prompt accurately
        already_identified_prompt_part = "Already identified skills (DO NOT INCLUDE THESE OR VARIANTS):\n"
        if existing_technical:
            already_identified_prompt_part += f"- Technical: {', '.join(existing_technical)}\n"
        if existing_soft:
            already_identified_prompt_part += f"- Soft: {', '.join(existing_soft)}\n"
        if existing_languages:
            already_identified_prompt_part += f"- Languages: {', '.join(existing_languages)}\n"
        if not (existing_technical or existing_soft or existing_languages):
            already_identified_prompt_part = "No skills were explicitly listed in the resume.\n"


        inference_prompt = f"""
        You are an expert HR skills analyzer. Based on the following resume information, 
        infer skills that are IMPLIED but NOT EXPLICITLY MENTIONED in the 'Already identified skills' list. 
        Only include skills that are strongly suggested by the work experience, project responsibilities, and other details.

        Resume Information (this is the primary text to analyze):
        ---
        {contextual_info[:6000]} 
        ---

        {already_identified_prompt_part}

        Instructions for Inferring Skills:
        1.  **Technical Skills & Soft Skills (max 5-7 each category):**
            *   Infer skills directly suggested by descriptions of job duties, project responsibilities, tools used, methodologies mentioned, or significant achievements.
            *   Avoid overly generic skills unless the context provides strong, specific examples of their application.
        2.  **Languages (max 3-4 human or programming languages):**
            *   **Primary Language of Resume:** If the resume is predominantly written in a specific language (e.g., English, Spanish, French) AND this language is NOT in the "Already explicitly listed skills - Languages" list, you MUST infer it.
            *   **Contextual Language Clues:** Look for strong indicators such as:
                -   Education undertaken in a country where a specific language is primary (e.g., studying in Germany implies German).
                -   Significant work experience in a country/region where that language is primary.
                -   Projects explicitly targeting or involving collaboration with regions speaking a specific language.
                -   Phrases like "fluent in [Language]" or "native [Language]" found within general text but not in a dedicated skills list.
            *   **Weak Clues (AVOID inferring from these alone):** Do NOT infer a language solely because a project was mentioned in foreign news or because a company has international offices, unless there's direct evidence of the *candidate's* interaction or need for that language.

        Output ONLY a valid JSON object with these fields:

        Only include skills with high confidence based on the resume context.
        If no additional skills can be reasonably inferred for a category, provide an empty array for that category.
        Do not infer overly generic skills unless strongly supported.
        """
        
        try:
            logger.info(f"Inferring additional skills. Context length: {len(contextual_info)}. Already identified: T={len(existing_technical)}, S={len(existing_soft)}, L={len(existing_languages)}")
            inference_response = await self.model.generate_content_async([inference_prompt])
            inference_text = inference_response.text
            
            start_idx = inference_text.find('{')
            end_idx = inference_text.rfind('}') + 1
            
            if start_idx != -1 and end_idx != -1:
                inferred_json_str = inference_text[start_idx:end_idx]
                inferred_data = json.loads(inferred_json_str)
                
                # Ensure all expected keys are present and are lists
                final_inferred_data = {
                    "technical_skills": [], "soft_skills": [], "languages": []
                }
                for skill_type in ['technical_skills', 'soft_skills', 'languages']:
                    if skill_type in inferred_data and isinstance(inferred_data[skill_type], list):
                        # Clean and filter out already existing skills again, just in case LLM included them
                        cleaned_and_new_skills = []
                        # FIX: Create a simplified set of existing skills for comparison (lowercase, no parentheses)
                        existing_for_type_simplified = set()
                        if skill_type == 'technical_skills': 
                            existing_for_type_simplified = {s.lower().split('(')[0].strip() for s in existing_technical}
                        elif skill_type == 'soft_skills': 
                            existing_for_type_simplified = {s.lower().split('(')[0].strip() for s in existing_soft}
                        elif skill_type == 'languages': 
                            existing_for_type_simplified = {s.lower().split('(')[0].strip() for s in existing_languages}
                        
                        for skill in self.clean_and_split_skills(inferred_data[skill_type]):
                            # FIX: Compare against the simplified set
                            if skill.lower().split('(')[0].strip() not in existing_for_type_simplified:
                                cleaned_and_new_skills.append(skill)
                        final_inferred_data[skill_type] = list(dict.fromkeys(cleaned_and_new_skills)) # Deduplicate

                # FIX: More robust check for English presence before adding it heuristically
                is_english_present = any('english' in lang.lower() for lang in final_inferred_data['languages']) or \
                                     any('english' in lang.lower() for lang in existing_languages)
                
                if not is_english_present:
                    # Basic heuristic: if context contains common English words and is of reasonable length.
                    # A more robust solution would use a language detection library here if needed.
                    english_indicators = ["the", "and", "is", "are", "project", "experience", "skill"]
                    if len(contextual_info) > 200 and any(indicator in contextual_info.lower() for indicator in english_indicators):
                        logger.info("Heuristically adding 'English' as an inferred language as it was not explicitly listed or inferred by LLM but context suggests it.")
                        if "English" not in final_inferred_data['languages'] and "english" not in (l.lower() for l in final_inferred_data['languages']):
                             final_inferred_data['languages'].append("English")


                return final_inferred_data
            else:
                logger.warning(f"Could not extract valid JSON from skill inference response: {inference_text}")
                return {"technical_skills": [], "soft_skills": [], "languages": []}
                
        except json.JSONDecodeError as e:
            logger.error(f"Error decoding JSON from skill inference: {e}. Response: {inference_text}")
            return {"technical_skills": [], "soft_skills": [], "languages": []}
        except Exception as e:
            logger.error(f"Error inferring additional skills: {e}", exc_info=True)
            return {"technical_skills": [], "soft_skills": [], "languages": []}

    def clean_and_split_skills(self, skills_input: Union[List[str], str, None]) -> List[str]:
        """
        Cleans, corrects, and splits a string or list of strings into individual skills.
        This is a robust, programmatic way to enforce data quality.
        """
        if not skills_input:
            return []

        # Ensure we are working with a single string
        if isinstance(skills_input, list):
            text_to_process = ', '.join(filter(None, skills_input))
        else:
            text_to_process = str(skills_input)

        # --- Programmatic Corrections and Cleaning ---
        # 1. Correct specific, known OCR errors.
        # Use case-insensitive replacement for robustness.
        text_to_process = re.sub(r'roid Studio', 'Android Studio', text_to_process, flags=re.IGNORECASE)

        # 2. Pre-processing: Standardize delimiters and spacing.
        # Replace bullets, slashes, pipes, and ' and ' with commas.
        text_to_process = re.sub(r'[\n•/|]|\s+and\s+', ',', text_to_process, flags=re.IGNORECASE)
        text_to_process = re.sub(r'\s+', ' ', text_to_process).strip()

        # 3. Split by commas, but NOT commas inside parentheses.
        parts = re.split(r',\s*(?![^()]*\))', text_to_process)

        final_skills = set()
        for part in parts:
            # 4. Clean up each individual part.
            # Remove residual colons, "and", and other noise from the start/end of a part.
            # This also removes unwanted labels like "Language", "Mobile Development", etc.
            part = part.strip()
            # Remove common non-skill prefixes and suffixes
            part = re.sub(r'^(Language|Mobile Development|Backend Development|Frontend Development|Skills)[:\s]*', '', part, flags=re.IGNORECASE).strip()
            part = re.sub(r'^(and|:)\s*|\s*(:)$', '', part, flags=re.IGNORECASE).strip()

            if part:
                final_skills.add(part)

        # 5. Return the cleaned, sorted, unique list of skills.
        cleaned_list = sorted(list(final_skills))
        logger.debug(f"Original skills: {skills_input}, Cleaned skills: {cleaned_list}")
        return cleaned_list

    async def interpret_facial_expressions(
            self,
            mediapipe_analysis: Dict[str, Any],  # Changed input name
            question: str,
            transcript: Optional[str]
    ) -> str:
        """
        Uses Gemini to interpret MediaPipe blendshape summary data.

        Args:
            mediapipe_analysis: Dictionary containing the 'analysis' key with
                                blendshape summary statistics (mean, max, std)
                                or an 'error' key.
            question: The interview question asked.
            transcript: The candidate's transcribed answer (for context).

        Returns:
            A string containing the interpretation.
        """
        if not mediapipe_analysis:
            return "MediaPipe analysis data is missing."
        if "error" in mediapipe_analysis:
            # Pass through the error message from the MediaPipe step
            return f"Could not interpret facial expressions: {mediapipe_analysis['error']}"
        if "analysis" not in mediapipe_analysis:
            return "MediaPipe analysis data is malformed (missing 'analysis' key)."

        analysis_data = mediapipe_analysis["analysis"]

        # --- Format Blendshape Data for Prompt ---
        # Select key indicators and format them clearly
        formatted_data = "Key Facial Blendshape Indicators (Average / Max Value):\n"
        key_indicators = {
            "Smile": (analysis_data.get('mouthSmileLeft_mean', 0) + analysis_data.get('mouthSmileRight_mean', 0)) / 2,
            "Smile (Peak)": max(analysis_data.get('mouthSmileLeft_max', 0),
                                analysis_data.get('mouthSmileRight_max', 0)),
            "Frown": (analysis_data.get('mouthFrownLeft_mean', 0) + analysis_data.get('mouthFrownRight_mean', 0)) / 2,
            "Brow Down": (analysis_data.get('browDownLeft_mean', 0) + analysis_data.get('browDownRight_mean', 0)) / 2,
            "Brow Up (Inner)": analysis_data.get('browInnerUp_mean', 0),
            "Jaw Open": analysis_data.get('jawOpen_mean', 0),
            "Eye Blink": (analysis_data.get('eyeBlinkLeft_mean', 0) + analysis_data.get('eyeBlinkRight_mean', 0)) / 2,
        }
        # Filter out indicators with near-zero average values to keep the prompt cleaner
        significant_indicators = {k: v for k, v in key_indicators.items() if v > 0.05}  # Threshold for significance

        if not significant_indicators:
            formatted_data += "- No significant blendshape activations detected."
        else:
            for name, avg_value in significant_indicators.items():
                # Find the corresponding max value if it exists and is different
                max_val_str = ""
                if "Peak" not in name:  # Peak is already max
                    max_val = key_indicators.get(f"{name} (Peak)", avg_value)  # Get peak if available
                    if max_val > avg_value * 1.1:  # Show max if noticeably higher
                        max_val_str = f" / Peak: {max_val:.2f}"
                formatted_data += f"- {name}: {avg_value:.2f}{max_val_str}\n"

        # --- Updated Prompt for Gemini ---
        # --- Updated Prompt for Gemini ---
        prompt = f"""
           You are interpreting facial expression indicators derived from video analysis for an HR professional reviewing an interview response. Your goal is to provide a brief, easily understandable summary based *only on the detected facial movements.

           **Instructions:**
           1. Review the key facial movement indicators below (scores 0.0-1.0 indicate activation level).
           2. Consider the interview question and the candidate's answer for context *only* (do NOT analyze the text).
           3. Provide a brief interpretation (2-4 sentences) focusing on the candidate's potential demeanor *during this specific response*.
           4. Use clear, professional language suitable for HR. Avoid overly technical terms (like specific muscle/blendshape names). Instead, describe the *observed expression* or *movement* (e.g., 'indicators of smiling', 'raised eyebrows', 'furrowed brow', 'signs of concentration').
           5. Focus on what the combination of movements might suggest in an interview setting (e.g., engagement, focus, emphasis, thinking, ease, potential stress or nervousness).

           **Interview Context:**
           The candidate was asked: "{question}"
           The candidate's transcribed response was: "{transcript if transcript else 'Not available'}"

           **Detected Facial Movement Indicators (Average / Peak Activation):**
           {formatted_data}

           **Interpretation Requirements:**
           - Base your interpretation *solely* on the detected facial movements listed above.
           - Use cautious language (e.g., 'expressions suggest...', 'movements appear consistent with...', 'potential indicators of...').
           - Do NOT state definitive emotions (e.g., 'happy', 'sad', 'anxious'). Focus on observable patterns and potential demeanor.
           - Respond with only the interpretation text and the required disclaimer. No preamble or sign-off.
           """

        try:
            async with self.semaphore:
                response = await self.model.generate_content_async(prompt)
                interpretation = response.text.strip()
                logger.info(f"Gemini facial interpretation (MediaPipe Blendshapes) generated successfully.")
                return interpretation
        except Exception as e:
            logger.error(f"Gemini API error during MediaPipe blendshape interpretation: {str(e)}")
            return "Error interpreting facial blendshape data via AI."

    async def score_answer_substance_and_job_fit(
            self,
            transcript: str,
            question_text: str,
            job_description: str
    ) -> Dict[str, Any]:
        """
        Uses Gemini to evaluate the substance and job fit of a candidate's answer.

        Args:
            transcript: The candidate's transcribed answer.
            question_text: The interview question asked.
            job_description: The description of the job role.

        Returns:
            Dictionary with substance_score, job_fit_score, substance_reasoning,
            job_fit_reasoning, and an optional error field.
            Scores are on a 0-10 scale.
        """
        if not transcript or not transcript.strip():
            return {
                "substance_score": 0, "job_fit_score": 0,
                "substance_reasoning": "No answer provided.",
                "job_fit_reasoning": "No answer provided.",
                "error": "Empty transcript"
            }
        if not job_description:
            return {
                "substance_score": 0, "job_fit_score": 0,
                "substance_reasoning": "Job description missing for context.",
                "job_fit_reasoning": "Job description missing for context.",
                "error": "Missing job description"
            }

        system_prompt = f"""
                You are a **critical**, objective HR Interview evaluator assessing a candidate's response.
                Your goal is to provide strict, fair, unbiased scores based *only on the substance of the answer provided, its direct relevance to the question, and its alignment with the job context.
                Provide concise, point-form justifications (max 1-2 points) AND extract relevant supporting keywords/short phrases (max 3-5 words each) from the Candidate's Answer for each score.

                Evaluate the Candidate's Answer objectively based ONLY on content, logic, and job alignment provided below. Ignore style/grammar/tone/demographics. 
                Acknowledge potential transcription errors; focus on the likely meaning. Provide scores (**integer 0-10**) and concise justifications (1-2 points)

                 **Context:**
                - Job Description: {job_description}
                - Interview Question: {question_text}
                - Candidate's Answer: {transcript}

                **IMPORTANT Instructions for Unbiased Evaluation:**
                *   **Reserve high scores (8+)** for answers that are **exceptionally insightful, detailed, directly relevant, AND clearly aligned** with the job context.
                *   **Do not award high scores simply for mentioning keywords.** Evaluate the *depth* of understanding and the *quality* of the explanation or examples.
                *   **Be critical:** If an answer is vague, generic, partially off-topic, or lacks specific examples, score it lower accordingly (e.g., 3-7 range). A score of 0-2 indicates significant flaws.
                *   Evaluate *solely* based on the answer's content, clarity of thought, and demonstrated understanding relative to the question and job context.
                *   **Note:** The 'Candidate's Answer' is an automated transcription and may contain minor errors or awkward phrasing. Focus on the likely intended meaning and substance of the response.
                *   **DO NOT** consider writing style, grammar perfection, vocabulary sophistication, tone, or any perceived demographic characteristics.
                *   Focus strictly on job-related substance, logical coherence, and relevance. Avoid making assumptions.

                **Criteria:**
                2.  **Substance (0-10):** How much **specific, relevant detail, evidence, concrete examples, or tangible achievements** are provided? Is there depth, or is it vague/generic/assertions without backing?
                *   Score 10 ONLY for answers rich with *specific, verifiable, and relevant* details/examples demonstrating competence. Lower scores for generalizations or unsupported claims.

                3.  **Job Fit (0-10):** How well does the answer's content (**specifically the substance provided**) demonstrate alignment with the skills, responsibilities, or context outlined in the Job Context?
                *   Score 10 ONLY if the substance *clearly and strongly* aligns with key requirements of *this specific job*. Lower scores if the connection is weak, generic, or absent.


                **Output Format (Strict JSON ONLY):**
                Respond ONLY with a valid JSON object in the following format and nothing else (no explanation, no markdown formatting, no text before or after)

                {{
                    "substance_score": <integer 0-10>,
                    "substance_reasoning": "<brief explanation for substance score>",
                    "job_fit_score": <integer 0-10>,
                    "job_fit_reasoning": "<brief explanation for job fit score>"
                }}
                """

        # Note: We are not including the candidate's full resume here to keep the focus
        # on the specific answer's content relative to the question and job.

        try:
            # Use semaphore for rate limiting
            async with self.semaphore:
                response = await self.model.generate_content_async(
                    [system_prompt])  # No need to pass context separately, it's in the prompt

            response_text = response.text
            logger.debug(f"Gemini response text for substance/job fit: {response_text}")

            # Extract JSON
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1

            if start_idx != -1 and end_idx != -1:
                json_str = response_text[start_idx:end_idx]
                scores = json.loads(json_str)

                # Validate required fields
                if not all(k in scores for k in
                           ["substance_score", "job_fit_score", "substance_reasoning", "job_fit_reasoning"]):
                    raise ValueError("Missing required fields in Gemini JSON response")

                raw_substance_score = scores.get("substance_score", 0)
                raw_job_fit_score = scores.get("job_fit_score", 0)
                logger.debug(
                    f"Raw scores from Gemini: substance={raw_substance_score}, job_fit={raw_job_fit_score}")

                scores["substance_score"] = max(0, min(10, int(raw_substance_score)))
                scores["job_fit_score"] = max(0, min(10, int(raw_job_fit_score)))

                logger.info(f"Substance/Job Fit scored successfully: {scores}")
                scores["error"] = None
                return scores
            else:
                logger.error(
                    f"Failed to extract JSON from Gemini substance/job fit response. Raw text: {response_text}")

                raise ValueError("Failed to extract JSON from Gemini response")

        except json.JSONDecodeError as e:
            logger.error(
                f"Failed to decode JSON from Gemini substance/job fit response. Error: {e}. Response text: {response_text}")
            return {"substance_score": 0, "job_fit_score": 0, "substance_reasoning": "Error parsing AI response.",
                    "job_fit_reasoning": "Error parsing AI response.", "error": f"Invalid JSON: {e}"}
        except Exception as e:
            logger.error(f"Error scoring substance/job fit with Gemini: {str(e)}", exc_info=True)
            return {"substance_score": 0, "job_fit_score": 0, "substance_reasoning": "Error during AI analysis.",
                    "job_fit_reasoning": "Error during AI analysis.", "error": f"Gemini API Error: {str(e)}"}

    async def generate_job_details_suggestion(
        self,
        job_title: str,
        context: Dict[str, str]
    ) -> Dict[str, str]:
        logger.info(f"Generating job details suggestion for title: {job_title} with context: {context}")
        try:
            # First attempt with Gemini using the new helper
            logger.info("Attempting job details generation with Gemini...")
            return await self._generate_with_gemini(job_title, context)
        except Exception as e:
            # Log the Gemini failure
            logger.warning(f"Gemini job details generation failed: {str(e)}. Falling back to Gemma.")

            # Check if Gemma fallback is possible
            if not self.gemma_service:
                 logger.error("Gemma service is not available for fallback.")
                 raise HTTPException(
                     status_code=503,
                     detail="AI job details generation failed with primary model, and fallback is unavailable."
                 )

            # Fallback to Gemma
            try:
                logger.info("Attempting job details generation with Gemma...")
                return await self._generate_with_gemma(job_title, context) # This helper should now work
            except Exception as gemma_error:
                # Both models failed
                logger.error(f"Both Gemini and Gemma job details generation failed. Gemma error: {str(gemma_error)}")
                raise HTTPException(
                    status_code=500,
                    detail="AI job details generation failed with both primary and fallback models."
                )

    async def _generate_with_gemini(
            self,
            job_title: str,
            context: Dict[str, str]
    ) -> Dict[str, str]:
        logger.info(f"Gemini: Generating job details suggestion for title: {job_title}")
        core_responsibilities = context.get("core_responsibilities", "Not specified")
        key_skills = context.get("key_skills", "Not specified")
        company_culture = context.get("company_culture", "Not specified")
        experience_level = context.get("experience_level", "Not specified")

        system_prompt = f"""
        You are an expert HR copywriter and job description generator.
        Based on the provided Job Title and additional context, generate a compelling Job Description and a clear list of Requirements/Qualifications.

        **Job Title:** {job_title}

        **Additional Context:**
        - Core Responsibilities Expected: {core_responsibilities}
        - Key Skills Needed: {key_skills}
        - Company Culture/Values: {company_culture}
        - Desired Experience Level: {experience_level}

        **Instructions:**
        1.  **Job Description:** Create a professional and engaging description (4-5 paragraphs). Highlight key responsibilities, the team/company environment (based on culture context), and what makes the role attractive.
        2.  **Requirements/Qualifications:** Create a bulleted list of essential skills, experience, and educational qualifications. Be specific and align with the Job Title and Key Skills context. Use bullet points (•).
        3.  **Tone:** Professional, clear, and inviting.
        4.  **Bias Check:** Avoid biased language related to age, gender, race, etc. Focus on skills and experience. Use inclusive language.

        **VERY IMPORTANT:**
        * Do NOT format the requirements as JSON - use simple bullet points with the • symbol
        * For hard skills and soft skills, use subheadings "Hard Skills:" and "Soft Skills:" followed by bullet points
        * Respond ONLY with a valid JSON object in the following format and nothing else (no explanation, no markdown formatting, no text before or after):

        ```json
        {{
            "description": "<Generated Job Description text>",
            "requirements": "<Generated Requirements/Qualifications text with bullet points>"
        }}
        ```
        """

        try:
            async with self.semaphore:
                response = await self.model.generate_content_async([system_prompt])
            response_text = response.text
            logger.debug(f"Gemini response text for job details suggestion: {response_text}")

            # Extract JSON (keep your robust extraction logic)
            json_str = response_text
            if "```json" in json_str: json_str = json_str.split("```json")[1]
            if "```" in json_str: json_str = json_str.split("```")[0]
            json_str = json_str.strip()
            start_idx = json_str.find('{')
            end_idx = json_str.rfind('}') + 1

            if start_idx != -1 and end_idx != -1:
                json_str_cleaned = json_str[start_idx:end_idx]
                suggestions = json.loads(json_str_cleaned)
                if "description" in suggestions and "requirements" in suggestions:
                    # Optional: Add back the reformatting logic if needed
                    logger.info("Gemini successfully generated job details suggestions.")
                    return suggestions
                else:
                    logger.error("Gemini generated JSON missing required keys.")
                    raise ValueError("Invalid JSON structure received from Gemini.")
            else:
                logger.error(f"Failed to extract valid JSON from Gemini response. Raw text: {response_text}")
                raise ValueError("Failed to extract JSON from Gemini response.")
        except Exception as e:
            logger.error(f"Error during Gemini job details generation: {str(e)}", exc_info=True)
            # Re-raise the exception so the fallback mechanism catches it
            raise e

    async def detect_transcript_bias(self, transcript: str) -> List[Dict[str, Any]]:
        """
        Detects PII and potentially biased terms in a transcript using Gemini.

       

        Args:
            transcript: The interview transcript text.

        Returns:
            A list of dictionaries, each representing a detected biased segment,
            including its text, type, and start/end character indices.
            Returns an empty list if no PII/bias is found or on error.
        """
        if not transcript or not transcript.strip():
            return []

        system_prompt = """
You are an AI assistant tasked with identifying and redacting Personal Identifiable Information (PII) and potentially biased terms from an interview transcript.
Focus on the following categories:
1.  **Names**: Full names, first names, last names of individuals (candidate, interviewer, or others mentioned).
2.  **Age**: Explicit mentions of age (e.g., "25 years old", "in my thirties").
3.  **Gender/Pronouns**: Explicit gendered terms or pronouns if they clearly identify an individual's gender (e.g., "he said", "she mentioned"). Be cautious.
4.  **Specific Locations**: Precise addresses, specific company names (if not the hiring company), or school names that could inadvertently reveal PII. General locations (e.g., "a city in California") are usually fine.
5.  **Contact Information**: Phone numbers, email addresses.
6.  **Other PII**: Social security numbers, ID numbers, etc.
7.  **Potentially Biased Language**: Terms related to ethnicity, religion, nationality, marital status, sexual orientation, or disability, IF they are mentioned in a non-relevant context or in a way that could introduce bias.

For each identified segment, provide:
-   `text`: The exact text segment identified.
-   `type`: The category (e.g., "NAME", "AGE", "GENDER_PRONOUN", "LOCATION_PII", "CONTACT_INFO", "OTHER_PII", "POTENTIAL_BIAS_TERM").
-   `start_char_index`: The starting character index of the segment in the original transcript.
-   `end_char_index`: The ending character index (exclusive) of the segment in the original transcript.

Transcript to analyze:
---
{transcript_content}
---

Respond ONLY with a valid JSON array of the identified segments. If no PII or biased terms are found, return an empty array [].
Example for a single finding:
[
  {{
    "text": "Jane Doe",
    "type": "NAME",
    "start_char_index": 11,
    "end_char_index": 19
  }}
]
"""
        prompt_with_transcript = system_prompt.format(transcript_content=transcript)

        try:
            async with self.semaphore:  # Use existing semaphore
                response = await self.model.generate_content_async(prompt_with_transcript)

            response_text = response.text.strip()
            logger.debug(f"Gemini transcript bias detection raw response: {response_text}")

            # Clean and parse JSON
            if response_text.startswith("```json"):
                response_text = response_text.split("```json")[1].strip()
            if response_text.endswith("```"):
                response_text = response_text.split("```")[0].strip()
            response_text = response_text.strip()

            if not response_text:
                logger.warning("Gemini returned empty response for transcript bias detection.")
                return []

            detected_segments = json.loads(response_text)
            if not isinstance(detected_segments, list):
                logger.warning(f"Gemini did not return a list for transcript bias. Got: {type(detected_segments)}")
                return []

            # Validate segments
            valid_segments = []
            for seg in detected_segments:
                if isinstance(seg, dict) and \
                        all(k in seg for k in ["text", "type", "start_char_index", "end_char_index"]) and \
                        isinstance(seg["start_char_index"], int) and \
                        isinstance(seg["end_char_index"], int):
                    valid_segments.append(seg)
                else:
                    logger.warning(f"Invalid segment format from Gemini: {seg}")

            logger.info(f"Gemini detected {len(valid_segments)} PII/bias segments in transcript.")
            return valid_segments

        except json.JSONDecodeError as e:
            logger.error(
                f"Failed to decode JSON from Gemini (transcript bias). Error: {e}. Response text: {response_text}")
            return []
        except Exception as e:
            logger.error(f"Error in Gemini transcript bias detection: {str(e)}", exc_info=True)
            return []
        
    async def _generate_with_gemma(
        self, 
        job_title: str, 
        context: Dict[str, str]
    ) -> Dict[str, str]:
        """
        Fallback implementation using Gemma to generate comprehensive job details.

        Args:
            job_title (str): The title of the job to generate details for.
            context (Dict[str, str]): Additional context for job details generation.

        Returns:
            Dict[str, str]: A dictionary containing job description, requirements, 
                            qualifications, and responsibilities.
        """
        if not self.gemma_service:
            logger.error("GemmaService is not available. Cannot generate job details suggestion.")
            raise HTTPException(status_code=503, detail="Gemma AI suggestion service is currently unavailable.")

        logger.info(f"Delegating job details suggestion for title: '{job_title}' to GemmaService.")
        try:
            # The GemmaService method is already async
            return await self.gemma_service.generate_job_details_suggestion_gemma(job_title, context)
        except HTTPException: # Re-raise HTTPExceptions from GemmaService
            raise
        except Exception as e:
            logger.error(f"Error occurred while calling GemmaService for job details: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"An unexpected error occurred with the AI suggestion service: {e}")

    async def analyze_per_item_relevance(self, candidate_profile, job_description):
        """
        Analyzes each individual item in all candidate profile fields against the job description.
        Returns relevance scores (1-10) for every item (no top-3 limitation).
        This is used for frontend star label display on individual items.
        Frontend shows stars for items with relevance >= 8.
        """
        if not candidate_profile or not job_description:
            logger.warning("Missing candidate profile or job description for per-item relevance analysis")
            return {}

        logger.info("Starting per-item relevance analysis for star display")
        
        # Debug: Log what data we received
        logger.debug(f"Candidate profile keys: {list(candidate_profile.keys()) if candidate_profile else 'None'}")
        if candidate_profile:
            for key in ["technical_skills", "soft_skills", "languages"]:
                if key in candidate_profile:
                    logger.debug(f"{key}: {candidate_profile[key]}")

        # Check if we have actual data to analyze
        has_data = False
        data_sources = [
            "technical_skills", "soft_skills", "languages", 
            "education", "certifications", "awards",
            "work_experience", "projects", "co_curricular_activities"
        ]

        for source in data_sources:
            if source in candidate_profile and candidate_profile[source]:
                has_data = True
                break

        if not has_data:
            logger.warning("No analyzable data found in candidate profile for per-item analysis")
            return {}

        # Prepare all profile data including inferred skills
        tech_skills = candidate_profile.get("technical_skills", [])
        if tech_skills is None:
            tech_skills = []
        elif isinstance(tech_skills, str):
            tech_skills = [tech_skills]
        # Split technical skills if they contain delimiters
        tech_skills = self.clean_and_split_skills(tech_skills)

        soft_skills = candidate_profile.get("soft_skills", [])
        if soft_skills is None:
            soft_skills = []
        elif isinstance(soft_skills, str):
            soft_skills = [soft_skills]
        # Split soft skills if they contain delimiters
        soft_skills = self.clean_and_split_skills(soft_skills)

        languages = candidate_profile.get("languages", [])
        if languages is None:
            languages = []
        elif isinstance(languages, str):
            languages = [languages]
        # Split languages if they contain delimiters
        languages = self.clean_and_split_skills(languages)

        # Include inferred skills in the analysis
        profile_data = {            
            "technical_skills": tech_skills + 
                               (candidate_profile.get("inferred_technical_skills", []) or []),
            "soft_skills": soft_skills + 
                          (candidate_profile.get("inferred_soft_skills", []) or []),
            "languages": languages + 
                        (candidate_profile.get("inferred_languages", []) or []),
            "education": candidate_profile.get("education", []),
            "certifications": candidate_profile.get("certifications", []),
            "awards": candidate_profile.get("awards", []),
            "work_experience": candidate_profile.get("work_experience", []),
            "projects": candidate_profile.get("projects", []),
            "co_curricular_activities": candidate_profile.get("co_curricular_activities", [])
        }

        # Debug: Log the prepared profile data
        logger.debug(f"Prepared profile data for per-item analysis:")
        for category, items in profile_data.items():
            if items:
                logger.debug(f"  {category}: {len(items)} items - {items[:3]}{'...' if len(items) > 3 else ''}")

        # System prompt for per-item analysis
        system_prompt = f"""
        You are an expert talent evaluator. Analyze each individual item in the candidate's profile 
        against the job description and provide a relevance score for EVERY item.

        For each item in each category:
        1. Evaluate the item's direct relevance to the job description on a scale of 1-10
        2. Include ALL items (do not limit to top items)
        3. Be selective with high scores (8+) - only award them for items with strong, direct relevance

        IMPORTANT RULES:
        - Analyze EVERY item provided, not just the most relevant ones
        - Be consistent in scoring across similar items
        - Focus on direct job relevance, not general value
        - Maintain original item text/descriptions exactly
        - Only 10-20% of items should score 8 or above

        Return a JSON object with the following structure:
        {{
          "technical_skills": [
            {{ "item": "exact skill name", "relevance": score }},
            ...
          ],
          "soft_skills": [ ... ],
          "languages": [ ... ],
          "education": [ ... ],
          "certifications": [ ... ],
          "awards": [ ... ],
          "work_experience": [ ... ],
          "projects": [ ... ],
          "co_curricular_activities": [ ... ]
        }}

        Respond ONLY with valid JSON and no additional text.
        """

        profile_summary = "Candidate Profile:\n"
        for category, items in profile_data.items():
            if items:
                profile_summary += f"\n{category.replace('_', ' ').title()}:\n"
                for item in items:
                    profile_summary += f"- {item}\n"

        try:
            logger.info("Sending per-item relevance analysis request to Gemini")
            response = await self.model.generate_content_async([
                system_prompt, 
                f"Job Description:\n{job_description}\n\n{profile_summary}"
            ])
            response_text = response.text
            logger.debug(f"Raw response from per-item relevance analysis: {response_text[:200]}...")

            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1

            if start_idx != -1 and end_idx != -1:
                json_str = response_text[start_idx:end_idx]
                per_item_relevance = json.loads(json_str)

                # Ensure all expected categories exist
                for category in profile_data.keys():
                    if category not in per_item_relevance:
                        per_item_relevance[category] = []

                # Log summary of per-item analysis
                total_items = 0
                high_relevance_items = 0
                for category, items in per_item_relevance.items():
                    if isinstance(items, list):
                        total_items += len(items)
                        for item in items:
                            if item.get("relevance", 0) >= 8:  # 8+ relevance considered highly relevant
                                high_relevance_items += 1

                logger.info(f"Per-item relevance analysis complete: {high_relevance_items} items with 8+ relevance out of {total_items} total items")
                
                # Debug: Log sample of the final result
                logger.debug(f"Sample per-item relevance result:")
                for category, items in per_item_relevance.items():
                    if items:
                        logger.debug(f"  {category}: {len(items)} items, first few: {items[:2]}")
                    else:
                        logger.debug(f"  {category}: empty")
                
                # Extract and sort the top 10 inferred technical skills by relevance score
                inferred_tech_skills = []
                inferred_skills_list = candidate_profile.get("inferred_technical_skills", [])
                
                if inferred_skills_list and isinstance(inferred_skills_list, list) and "technical_skills" in per_item_relevance:
                    # Create a set of inferred skill names for fast lookup
                    inferred_skill_names = set(inferred_skills_list)
                    
                    # Find all inferred skills with their relevance scores
                    for skill_item in per_item_relevance["technical_skills"]:
                        if skill_item.get("item") in inferred_skill_names:
                            inferred_tech_skills.append(skill_item)
                    
                    # Sort by relevance score in descending order
                    inferred_tech_skills.sort(key=lambda x: x.get("relevance", 0), reverse=True)
                    
                    # Take only the top 10 most relevant
                    top_inferred_tech_skills = inferred_tech_skills[:10]
                    
                    # Add the top 10 most relevant inferred technical skills to the result
                    per_item_relevance["top_inferred_technical_skills"] = top_inferred_tech_skills
                    
                    logger.info(f"Extracted top {len(top_inferred_tech_skills)} most relevant inferred technical skills")
                else:
                    per_item_relevance["top_inferred_technical_skills"] = []
                    logger.info("No inferred technical skills found or no relevance scores available")
                
                return per_item_relevance
            else:
                logger.error("Failed to extract JSON from Gemini response for per-item relevance analysis")
                logger.error(f"Response text: {response_text}")
                return {}

        except Exception as e:
            logger.error(f"Error analyzing per-item relevance: {str(e)}")
            return {}