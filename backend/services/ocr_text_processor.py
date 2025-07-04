import logging
import json
from typing import Dict, Any, Optional
from services.gemini_service import GeminiService

logger = logging.getLogger(__name__)


class OCRTextProcessor:
    """Service for processing OCR text and extracting relevant resume sections using Gemini."""

    def __init__(self, gemini_service_instance: Optional[GeminiService] = None):
        self.gemini_service = gemini_service_instance if gemini_service_instance else GeminiService()

    async def extract_resume_sections(self, raw_ocr_text: str) -> Dict[str, Any]:
        """
        Extract relevant resume sections from raw OCR text using Gemini.
        
        Args:
            raw_ocr_text: Raw text extracted from Document AI OCR
            
        Returns:
            Dictionary containing extracted text sections or empty dict if no relevant content
        """
        if not raw_ocr_text or not raw_ocr_text.strip():
            logger.warning("No OCR text provided for section extraction")
            return {"extractedText": {}}

        system_prompt = """
        You are a master resume parser. Your primary job is to analyze the raw OCR text from a resume and accurately structure it into a JSON object. You must be extremely precise and account for ALL text in the document.

        **Golden Rule:**
        **Every piece of text from the input resume MUST be placed into one of the output JSON fields. No information should be left out.**

        ---
        **Field Definitions and Rules (Follow Strictly):**

        **1. Personal Information (String Fields):**
            *   `applicant_name`, `applicant_mail`, `applicant_contactNum`: Extract standard contact details.
            *   `bio`: A professional summary or objective, usually at the top of the resume.

        **2. Skill Lists (List of Strings):**
            *   `technical_skills`, `soft_skills`, `languages`: These fields are for **keyword lists ONLY**.
            *   Extract terms from sections clearly labeled "Skills". Do not invent skills from paragraph text.
            *   **Clean the list:** Remove stray characters/words. Correct OCR errors (e.g., "roid Studio" MUST become "Android Studio").

        **3. Paragraph-Based Content (Single String Fields):**
            *   These fields are for **long-form text blocks**. Combine all related content for a section into a single string, using `\\n` for line breaks.

            *   **`work_experience_paragraph`**: For professional, industry-related jobs. Includes internships, part-time/full-time roles, or career-oriented freelance work.
            *   **`education_paragraph`**: For academic history. Includes university degrees, college diplomas, high school, and other formal schooling with institution names.
            *   **`projects_paragraph`**: For specific projects, either personal, academic, or professional. Often includes a project title and a description of the work done.
            *   **`certifications_paragraph`**: For official certifications from recognized bodies or online courses (e.g., Coursera, Udemy, AWS Certified).
            *   **`awards_paragraph`**: For competitive honors, scholarships, or formal recognitions (e.g., "Silver Award", "3rd Place", "Dean's List").
            *   **`co_curricular_activities_paragraph`**: For activities related to university or school life. Includes roles in clubs, societies, student-led workshops, volunteer events on campus, and organizing university competitions.

        **Semantic Disambiguation (CRITICAL CHECK):**
        *   Candidates often group all experiences. You MUST correctly differentiate them.
        *   If an "experience" took place at a university (e.g., "Google Developer Group on campus Universiti Malaya"), it belongs in `co_curricular_activities_paragraph`, NOT `work_experience_paragraph`, unless it was a formal, paid internship.
        *   If a line mentions "Top 10 Finalist" or "3rd Place", it belongs in `awards_paragraph`.
        *   If a line mentions "Developing LLM Applications with LangChain", it belongs in `certifications_paragraph`.

        ---
        **Output Format (Strict JSON ONLY):**
        Return a single JSON object. If a section is not found, omit its key.

        ```json
        {
            "extractedText": {
                "applicant_name": "Full Name",
                "technical_skills": ["Java", "Python", "Android Studio"],
                "education_paragraph": "B.S. in Computer Science from University X...\\nCGPA: 3.8",
                "work_experience_paragraph": "Software Engineer Intern at Tech Corp...\\n- Developed features...",
                "projects_paragraph": "Voice Assistant for Grab Drivers...\\n- Used Python and NLP...",
                "co_curricular_activities_paragraph": "Director - Google for Startups Workshop 2025...",
                "awards_paragraph": "Stemetric Challenge Silver Award...",
                "certifications_paragraph": "Developing LLM Applications with LangChain..."
            }
        }
        ```

        **Important Notes:**
        - Only include fields that have actual content from the resume
        - If a section is not present or unclear, omit that field entirely
        - Preserve the original text content as much as possible while organizing it logically
        - If the document is clearly not a resume (e.g., random text, non-resume document), return: {"extractedText": {}}
        - Combine related information into coherent paragraphs rather than fragmenting it

        Respond with ONLY the JSON object, no additional text or explanation.
        """

        user_prompt = f"""
        Raw OCR Text to Analyze:
        ---
        {raw_ocr_text}
        ---
        """

        try:
            logger.info(f"Sending OCR text to Gemini for resume section extraction (text length: {len(raw_ocr_text)})")
            
            response = await self.gemini_service.model.generate_content_async([
                system_prompt,
                user_prompt
            ])

            response_text = response.text.strip()
            logger.debug(f"Gemini response for OCR text processing: {response_text[:500]}...")

            # Clean up response text to extract JSON
            json_str = response_text
            if "```json" in json_str:
                json_str = json_str.split("```json")[1]
            if "```" in json_str:
                json_str = json_str.split("```")[0]
            json_str = json_str.strip()

            # Extract JSON from response
            start_idx = json_str.find('{')
            end_idx = json_str.rfind('}') + 1

            if start_idx != -1 and end_idx != -1:
                json_str_cleaned = json_str[start_idx:end_idx]
                extracted_data = json.loads(json_str_cleaned)
                
                # Validate the response structure
                if "extractedText" in extracted_data:
                    extracted_text = extracted_data["extractedText"]
                    
                    # Log the extraction results
                    if extracted_text:
                        field_count = len(extracted_text)
                        logger.info(f"Successfully extracted {field_count} resume sections from OCR text")
                        logger.debug(f"Extracted fields: {list(extracted_text.keys())}")
                    else:
                        logger.info("No relevant resume content found in OCR text")
                    
                    return extracted_data
                else:
                    logger.warning("Invalid response structure from Gemini - missing extractedText field")
                    return {"extractedText": {}}
            else:
                logger.error("Could not extract valid JSON from Gemini response")
                return {"extractedText": {}}

        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error when processing Gemini response: {e}")
            logger.debug(f"Raw response that caused error: {response_text}")
            return {"extractedText": {}}
        except Exception as e:
            logger.error(f"Error during OCR text processing with Gemini: {e}", exc_info=True)
            return {"extractedText": {}}

    async def process_ocr_document(self, raw_ocr_response: Dict[str, Any], full_text: str = "") -> Dict[str, Any]:
        """
        Process the complete OCR response and extract resume sections.
        
        Args:
            raw_ocr_response: Complete OCR response from Document AI
            full_text: Full text extracted from Document AI (optional, will look in raw_ocr_response if not provided)
            
        Returns:
            Dictionary containing both raw OCR data and extracted resume sections
        """
        try:
            # Extract the full text - check parameter first, then fallback to OCR response
            text_to_process = full_text or raw_ocr_response.get("full_text", "")
            
            if not text_to_process:
                logger.warning("No full text found in OCR response or parameters")
                return {
                    "raw_ocr_response": raw_ocr_response,
                    "extractedText": {}
                }

            # Extract resume sections using Gemini
            extraction_result = await self.extract_resume_sections(text_to_process)
            
            # Combine the results
            processed_result = {
                "raw_ocr_response": raw_ocr_response,
                "extractedText": extraction_result.get("extractedText", {}),
                "full_text": text_to_process
            }

            logger.info("OCR document processing completed successfully")
            return processed_result

        except Exception as e:
            logger.error(f"Error processing OCR document: {e}", exc_info=True)
            return {
                "raw_ocr_response": raw_ocr_response,
                "extractedText": {},
                "full_text": full_text or raw_ocr_response.get("full_text", "")
            }
