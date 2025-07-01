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
        You are an expert resume parser. Analyze the following raw text extracted from a resume document using OCR.
        Your task is to identify and extract relevant resume sections from this text.

        **Instructions:**
        1. Carefully read through the raw OCR text
        2. Identify sections that contain resume-relevant information such as:
           - Personal information (name, contact details)
           - Professional summary or objective
           - Work experience
           - Education
           - Skills (technical and soft skills)
           - Projects
           - Certifications
           - Awards and achievements
           - Languages
           - Volunteer work or activities

        3. Extract and organize this information into structured paragraphs
        4. If the text appears to be a resume or CV, populate the relevant fields
        5. If the text does not appear to be resume-related or contains no useful resume information, return empty extractedText

        **Output Format:**
        Return a JSON object with an "extractedText" field containing the structured resume information:

        ```json
        {
            "extractedText": {
                "applicant_name": "Full Name (if clearly identifiable)",
                "applicant_mail": "email@example.com (if found)",
                "applicant_contactNum": "phone number (if found)",
                "bio": "Professional summary or objective paragraph",
                "work_experience_paragraph": "Detailed work experience section with all jobs and responsibilities",
                "education_paragraph": "Education background with institutions, degrees, and dates",
                "technical_skills": "List of technical skills mentioned",
                "soft_skills": "List of soft skills or personal qualities mentioned",
                "skills": "General skills if technical/soft skills are not clearly separated",
                "projects_paragraph": "Project descriptions and details",
                "certifications_paragraph": "Professional certifications and licenses",
                "awards_paragraph": "Awards, honors, and achievements",
                "languages": "Languages spoken or known",
                "co_curricular_activities_paragraph": "Volunteer work, extracurricular activities, and other relevant activities"
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
