from typing import Dict, Any, List, Optional
import json
import os
import logging
import google.generativeai as genai
from services.gemini_service import GeminiService
from models.bias_detection_request import BiasDetectionResponse, BiasDetectionRequest

logger = logging.getLogger(__name__)

# Configure Gemini API
def configure_gemini():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable not set")
    genai.configure(api_key=api_key)

class BiasDetectionRequestService:
    def __init__(self):
        configure_gemini()
        self.model = genai.GenerativeModel('gemini-2.0-flash')

    async def analyze_job_posting(self, request: BiasDetectionRequest) -> Dict[str, Any]:
        """
        Analyze a job posting for potential biases in language, requirements, or expectations.

        Args:
            request: BiasDetectionRequest object containing job posting details

        Returns:
            Dictionary with bias analysis results
        """
        try:
            # Format the job posting details for the prompt
            job_posting_details = {
                "Job Title": request.jobTitle,
                "Job Description": request.jobDescription or "",
                "Requirements": request.requirements or "",  # Include requirements separately
                "Minimum CGPA Required": str(request.minimumCGPA) if request.minimumCGPA is not None else "N/A",
                "Departments": ', '.join(request.departments or []),
                "Required Skills": ', '.join(request.requiredSkills or [])
            }

            # Create formatted text string for the prompt
            job_posting_text = "\n\n".join(
                f"{field_name}:\n{value}"
                for field_name, value in job_posting_details.items() if value and value != "N/A"
            )

            # Define the system prompt for Gemini
            # Update the system_prompt with this improved version:

            system_prompt = """
            You are an AI assistant specialized in detecting bias in job postings. Analyze ONLY for clearly discriminatory language, while understanding appropriate job requirements.

            PROPER CONTEXT AWARENESS:
            - Consider the JOB TITLE when evaluating requirements - "Graduate Software Engineer" naturally requires relevant degrees
            - Understand that terms like "fresh graduate," "entry-level," or "junior" indicate experience level, not age bias
            - Recognize that technical fields require relevant technical qualifications
            - Acknowledge that roles may have legitimate educational or credential requirements 

            ANALYZING PREFERENCES CAREFULLY:
            - SKILL-BASED preferences (e.g., "prefer Python experience") are generally fair and NOT biased
            - EDUCATION-BASED preferences (e.g., "prefer Computer Science degree") are often fair for technical roles
            - EXPERIENCE-BASED preferences (e.g., "prefer 2+ years experience") are generally fair
            - PERSONAL CHARACTERISTIC preferences (e.g., "prefer young candidates") ARE biased and should be flagged

            WORDS REQUIRING CONTEXT:
            - "Prefer" or "preferable" is acceptable when referring to skills, education, or experience
            - "Fresh graduate" is appropriate for entry-level roles or internships
            - "Required" is acceptable for genuine job qualifications

            RED FLAGS - ALWAYS BIASED:
            - Terms with "only" that create barriers (e.g., "male candidates only", "graduates from X university only")
            - Explicit gender specifications (e.g., "male engineer," "female secretary")
            - Direct age limitations not related to experience level (e.g., "under 35 years old")
            - Explicit race/ethnicity preferences (e.g., "Prefer Asian candidates")
            - Clear disability discrimination (e.g., "must not have any disabilities")
            - Religious requirements when not essential to the role

            DO NOT FLAG as biased:
            - Experience level terms (e.g., "junior," "senior," "fresh graduate") 
            - Education requirements relevant to the position's technical needs
            - Standard business terminology (e.g., "drive for success," "competitive")
            - Skills directly related to job performance
            - Physical requirements genuinely needed for the role
            - Terms like "energetic," "dynamic," "strong" used in standard professional context
            - Degree requirements for technical roles where the knowledge is necessary

            Provide your assessment in this JSON format ONLY with no other text:
            {
                "hasBias": true/false, // Overall bias presence
                "biasedFields": {
                    // IMPORTANT: ONLY include fields below that contain actual bias.
                    // If a field has no bias, OMIT it completely from this dictionary.
                    // Use the exact field names: "jobTitle", "jobDescription", "requirements", "minimumCGPA", "requiredSkills", "departments"
                    "jobTitle": "brief explanation if biased only",
                    "jobDescription": "brief explanation if biased only",
                    "requirements": "brief explanation if biased only", // Separate explanation for requirements
                    "minimumCGPA": "brief explanation if biased only",
                    "requiredSkills": "brief explanation if biased only",
                    "departments": "brief explanation if biased only"
                },
                "biasedTerms": {
                    // ONLY include arrays for fields with actual biased terms.
                    // If a field has no bias, OMIT it completely from this dictionary.
                    // Use the exact field names: "jobTitle", "jobDescription", "requirements", "requiredSkills", "departments"
                    "jobTitle": ["biased term 1", "biased term 2"],
                    "jobDescription": ["biased term 1", "biased term 2"],
                    "requirements": ["biased term 1", "biased term 2"], // Separate terms for requirements
                    "requiredSkills": ["biased term 1", "biased term 2"],
                    "departments": ["biased term 1", "biased term 2"]
                }
            }

            Important Notes:
            - If in doubt, DO NOT flag the term
            - Only flag something as biased if it would clearly exclude qualified candidates
            - Consider the FULL CONTEXT of the job posting, not isolated phrases
            - If a qualification is directly relevant to the job function, it is NOT biased
            """

            logger.info(f"Analyzing job posting for bias: {request.jobTitle}")
            
            # Send to Gemini for analysis
            response = await self.model.generate_content_async([system_prompt, job_posting_text])
            
            # Extract the JSON response
            analysis_text = response.text
            logger.debug(f"Raw bias analysis response: {analysis_text}")

            # Clean and parse the JSON response
            analysis = {}
            try:
                # Try direct parsing first
                analysis = json.loads(analysis_text)
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse JSON directly. Raw response: {analysis_text}")
                # Try extracting from markdown code block
                if "```json" in analysis_text:
                    try:
                        json_text = analysis_text.split("```json")[1].split("```")[0].strip()
                        analysis = json.loads(json_text)
                        logger.info("Successfully parsed JSON from markdown block.")
                    except (IndexError, json.JSONDecodeError) as md_err:
                        logger.error(f"Failed to parse JSON from markdown block: {md_err}")
                        # Fallback: try finding JSON boundaries
                        start_idx = analysis_text.find('{')
                        end_idx = analysis_text.rfind('}') + 1
                        if start_idx != -1 and end_idx > start_idx:
                            try:
                                json_str = analysis_text[start_idx:end_idx]
                                analysis = json.loads(json_str)
                                logger.info("Successfully parsed JSON using boundary finding.")
                            except json.JSONDecodeError as bound_err:
                                logger.error(f"Failed to parse JSON using boundaries: {bound_err}")
                                raise ValueError("Unable to extract valid JSON from AI response.")
                        else:
                            raise ValueError("Unable to extract valid JSON from AI response (no valid boundaries).")
                else:
                    raise ValueError(
                        "Unable to extract valid JSON from AI response (no markdown block or valid structure.")

            # Ensure top-level keys exist, default to safe values
            analysis.setdefault('hasBias', False)
            analysis.setdefault('biasedFields', {})
            analysis.setdefault('biasedTerms', {})

            # Clean biasedFields
            valid_fields = ["jobTitle", "jobDescription", "requirements", "minimumCGPA", "requiredSkills",
                            "departments"]
            cleaned_fields = {}
            for field, explanation in analysis['biasedFields'].items():
                if field in valid_fields and explanation and isinstance(explanation,
                                                                        str) and explanation.strip():
                    # Basic check to filter out "no bias" messages (adjust keywords as needed)
                    explanation_lower = explanation.lower()
                    if not any(phrase in explanation_lower for phrase in
                               ["no bias", "does not have bias", "is acceptable", "seems appropriate"]):
                        cleaned_fields[field] = explanation.strip()
            analysis['biasedFields'] = cleaned_fields

            # Clean biasedTerms
            cleaned_terms = {}
            for field, terms_list in analysis['biasedTerms'].items():
                if field in valid_fields and isinstance(terms_list, list):
                    # Filter out empty strings and keep unique terms
                    unique_non_empty_terms = list(
                        set(term.strip() for term in terms_list if isinstance(term, str) and term.strip()))
                    if unique_non_empty_terms:
                        cleaned_terms[field] = unique_non_empty_terms
            analysis['biasedTerms'] = cleaned_terms

            # Recalculate hasBias based on cleaned fields/terms
            analysis['hasBias'] = bool(analysis['biasedFields'] or analysis['biasedTerms'])

            logger.info(
                f"Bias analysis result: hasBias={analysis['hasBias']}, biasedFields={list(analysis['biasedFields'].keys())}, biasedTerms={list(analysis['biasedTerms'].keys())}")

            # Return the full normalized structure expected by the model
            return BiasDetectionResponse(
                hasBias=analysis['hasBias'],
                biasedFields=analysis['biasedFields'],
                biasedTerms=analysis['biasedTerms']
            ).dict()  # Return as dict for FastAPI

        except Exception as e:
            logger.error(f"Error in bias detection analysis: {str(e)}", exc_info=True)
            # Return a generic error response structure
            return BiasDetectionResponse(
                hasBias=False,  # Default to false on error? Or maybe True to be safe? Let's say false.
                biasedFields={"error": f"Analysis failed: {str(e)}"},
                biasedTerms={}
            ).dict()