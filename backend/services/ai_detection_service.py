import re
import html
import logging
from typing import Optional, Dict, Any, List
from models.ai_detection import AIDetectionResult
from services.gemini_service import GeminiService
from google.generativeai.types import GenerationConfig
from datetime import datetime

logger = logging.getLogger(__name__)

# Thresholds
AI_DETECTION_FLAG_THRESHOLD = 0.65
FABRICATION_HIGH_IMPACT_SCORE = 0.90
FABRICATION_MEDIUM_IMPACT_SCORE = 0.70

class AIDetectionService:
    def __init__(self, gemini_service: Optional[GeminiService] = None):
        self.gemini_service = gemini_service if gemini_service else GeminiService()
        self.ai_detection_generation_config = GenerationConfig(
            temperature=0.3
        )

    async def detect_ai_generated_text(self, text: str, filename: str, job_description: Optional[str] = None, job_skills: Optional[List[str]] = None ) -> AIDetectionResult:
        if not text or not text.strip():
            return AIDetectionResult(
                filename=filename, is_ai_generated=False, confidence=0.0,
                reason="<div class='ai-detection-summary'><div class='ai-assessment-top'><span class='assessment-label error-label'>Unable to Assess</span></div><div class='assessment-error'>No text content provided for analysis.</div></div>",
                details={"gemini": {"score": 0.0, "text_assessment": "N/A", "fabrication_concern": "N/A", "style_reason_points": [], "fabrication_reason_points": []}}
            )

        max_chars_for_analysis = 8000
        analysis_text_for_prompt = text[:max_chars_for_analysis]
        analysis_text_for_prompt = re.sub(r'[^a-zA-Z0-9\s\.,;:!?"\'()\[\]<>%@#$&\*\-\+=/\n\r\t]{6,}', '', analysis_text_for_prompt)
        analysis_text_for_prompt = ' '.join(analysis_text_for_prompt.split())

        # --- Initialize variables for storing parsed Gemini output ---
        gemini_effective_score = 0.5
        parsed_ai_written_style_val = None # YES/NO for AI style
        parsed_confidence_style_val = 0.0  # Confidence for AI style assessment
        parsed_fabrication_concern_val = "N/A" # LOW/MEDIUM/HIGH for fabrication
        style_reason_points_list = []
        fabrication_reason_points_list = []
        gemini_parsed_successfully = False

        # Initialize detection_details with defaults that will be updated
        detection_details = {
            "gemini": {
                "score": gemini_effective_score, # Will be updated
                "text_assessment": "N/A", # Will be 'AI Style' or 'Human Style'
                "text_assessment_confidence": parsed_confidence_style_val, # Will be updated
                "fabrication_concern": parsed_fabrication_concern_val, # Will be updated
                "style_reason_points": style_reason_points_list, # Will be updated
                "fabrication_reason_points": fabrication_reason_points_list, # Will be updated
                # Legacy fields for backward compatibility or internal logging if needed, but not primary for new display
                "ai_generation_reason": "Analysis not performed or failed.",
                "fabrication_reason": "Analysis not performed or failed."
            }
        }

        if self.gemini_service:
            logger.info(f"Consulting Gemini for '{filename}' with temp={self.ai_detection_generation_config.temperature}.")
            try:
                job_context_str = ""
                if job_description:
                    job_context_str += f"\n\n**Job Description Context:**\n\"\"\"\n{job_description[:1000]}\n\"\"\"\n"
                if job_skills:
                    job_context_str += f"**Key Required Skills for the Job:** {', '.join(job_skills)}\n"

                # Add current date information to provide context for date assessment
                current_date = datetime.now()
                current_date_str = current_date.strftime("%Y-%m-%d")
                current_year = current_date.year

                prompt = (
                    f"You are an expert resume content analyzer. Your task is to assess the provided resume text against the job context (if available) "
                    f"to determine: 1) if the writing style is AI-generated, and 2) if the content (experiences, skills) seems significantly fabricated or deceptively tailored by an AI "
                    f"to match job requirements, even if the writing style seems human. Provide concise, evidence-based reasoning.\n\n"
                    f"**Today's Date:** {current_date_str} (Current year: {current_year})\n\n"
                    f"**Resume Text for Analysis (first {max_chars_for_analysis} characters):**\n\"\"\"\n{analysis_text_for_prompt}\n\"\"\"\n"
                    f"{job_context_str if job_context_str else ''}"
                    f"\n**Instructions for your response (CRITICAL: You MUST strictly follow this format, including all field names, colons, newlines, YES/NO values, score format, and bullet point structures. Any deviation will make your response unparsable. Ensure each field and its value are on the correct lines as specified.):**\n\n" # Added CRITICAL instruction
                    f"1.  **AI_WRITING_STYLE_ASSESSMENT:** (This entire section, including its 4 fields, MUST be on separate lines as shown)\n"
                    f"    AI_WRITTEN_STYLE: YES/NO\n"
                    f"    CONFIDENCE_STYLE: <A precise score between 0.0 and 1.0 for your AI_WRITTEN_STYLE decision. Be nuanced.>\n"
                    # Modified STYLE_REASON_POINTS instructions
                    f"    STYLE_REASON_POINTS: <If AI_WRITTEN_STYLE is YES, you MUST provide 1-3 distinct bullet points below this line, detailing specific reasons, even if indicators are subtle. Each bullet point MUST start with a hyphen and a space (e.g., '- '). Each bullet point MUST strictly follow the format: '- \"Quoted key phrase/pattern from resume (max 15 words)\" - Very short explanation (max 15 words).'. Example:\n"
                    f"        - \"'Leveraged cutting-edge paradigms' - Overly formal, lacks specificity.\"\n"
                    f"        - \"Repetitive sentence structure in 'Experience' section - Common AI pattern.\"\n"
                    f"        <If AI_WRITTEN_STYLE is NO, you MUST provide 1-3 distinct bullet points below this line, detailing specific reasons, even if indicators are subtle. Each bullet point MUST start with a hyphen and a space (e.g., '- '). Each bullet point MUST strictly follow the format: '- \"Quoted key phrase/pattern from resume (max 15 words)\" - Very short explanation (max 15 words)."
                    f"        IMPORTANT: Adherence to the bullet point format (when AI_WRITTEN_STYLE is YES) or (when AI_WRITTEN_STYLE is NO) is critical. Do NOT include any other section titles, markdown (like **), or extraneous formatting within the value for STYLE_REASON_POINTS.>\n\n"
                    f"2.  **CONTENT_FABRICATION_ASSESSMENT:** (This entire section, including its 2 fields, MUST be on separate lines as shown, and MUST follow section 1)\n"
                    f"    FABRICATION_CONCERN: LOW/MEDIUM/HIGH <Assess if experiences/skills seem AI-created or deceptively tailored to the job, NOT just poor fit. Remember to consider date context - future events within 1-2 years may be legitimate plans/enrollments.>\n"
                    # Modified FABRICATION_REASON_POINTS instructions
                    f"    FABRICATION_REASON_POINTS: <If FABRICATION_CONCERN is MEDIUM or HIGH, you MUST provide 1-3 distinct bullet points below this line, detailing specific reasons for the concern. Each bullet point MUST start with a hyphen and a space (e.g., '- '). Each bullet point MUST strictly follow the format: '- \"Quoted key phrase/section from resume (max 15 words)\" - Very short explanation (max 15 words).'. Example:\n"
                    f"        - \"'Skills section' - Mirrors job keywords exactly, lacks unique depth.\"\n"
                    f"        - \"'Managed $XM budget' - Achievement stated without supporting context.\"\n"
                    f"        If FABRICATION_CONCERN is LOW, you MUST provide a single, concise statement on one line below this FABRICATION_REASON_POINTS line, explaining why the concern is low (e.g., 'Content appears generally authentic and well-supported. No obvious fabrication indicators.').\n"
                    f"        IMPORTANT: Adherence to the bullet point format (for MEDIUM/HIGH concern) or the single line statement format (for LOW concern) is critical. Do NOT include any other section titles, markdown (like **), or extraneous formatting within the value for FABRICATION_REASON_POINTS.>\n"
                )

                gemini_response_str = await self.gemini_service.generate_text(
                    prompt,
                    generation_config_override=self.ai_detection_generation_config
                )
                
                logger.info(f"Gemini response for '{filename}': {gemini_response_str[:500]}...")

                # --- Parsing Gemini's Response ---
                parsing_style_reason = False
                collecting_style_bullets = False
                parsing_fabrication_reason = False
                collecting_fabrication_bullets = False

                ai_written_style_pattern = re.compile(r"^\s*AI_WRITTEN_STYLE\s*:\s*(YES|NO)\s*$", re.IGNORECASE)
                confidence_style_pattern = re.compile(r"^\s*CONFIDENCE_STYLE\s*:\s*([0-9.]+)\s*$", re.IGNORECASE)
                style_reason_points_start_pattern = re.compile(r"^\s*STYLE_REASON_POINTS\s*:", re.IGNORECASE)
                fabrication_concern_pattern = re.compile(r"^\s*FABRICATION_CONCERN\s*:\s*(LOW|MEDIUM|HIGH)\s*$", re.IGNORECASE)
                fabrication_reason_points_start_pattern = re.compile(r"^\s*FABRICATION_REASON_POINTS\s*:", re.IGNORECASE)
                key_field_pattern = re.compile(r"^\s*(AI_WRITTEN_STYLE:|CONFIDENCE_STYLE:|STYLE_REASON_POINTS:|FABRICATION_CONCERN:|FABRICATION_REASON_POINTS:)", re.IGNORECASE)

                temp_style_points = []
                temp_fab_points = []

                for line in gemini_response_str.split('\n'):
                    line_stripped = line.strip()
                    if not line_stripped:
                        continue

                    # Check if the current line signals the end of collecting points for the *previous* section
                    is_new_key_field_for_style_stop = key_field_pattern.match(line_stripped) and not style_reason_points_start_pattern.match(line_stripped)
                    if (parsing_style_reason or collecting_style_bullets) and is_new_key_field_for_style_stop:
                        parsing_style_reason = False
                        collecting_style_bullets = False

                    is_new_key_field_for_fab_stop = key_field_pattern.match(line_stripped) and not fabrication_reason_points_start_pattern.match(line_stripped)
                    if (parsing_fabrication_reason or collecting_fabrication_bullets) and is_new_key_field_for_fab_stop:
                        parsing_fabrication_reason = False
                        collecting_fabrication_bullets = False
                    
                    # Process current line
                    match_style = ai_written_style_pattern.match(line_stripped)
                    if match_style:
                        parsed_ai_written_style_val = (match_style.group(1).upper() == "YES")
                        parsing_style_reason = False; collecting_style_bullets = False
                        parsing_fabrication_reason = False; collecting_fabrication_bullets = False
                        continue

                    match_conf_style = confidence_style_pattern.match(line_stripped)
                    if match_conf_style:
                        try:
                            parsed_confidence_style_val = float(match_conf_style.group(1))
                        except ValueError:
                            logger.warning(f"Could not parse STYLE CONFIDENCE: {line_stripped} for {filename}")
                        parsing_style_reason = False; collecting_style_bullets = False
                        parsing_fabrication_reason = False; collecting_fabrication_bullets = False
                        continue
                    
                    match_fab_concern = fabrication_concern_pattern.match(line_stripped)
                    if match_fab_concern:
                        parsed_fabrication_concern_val = match_fab_concern.group(1).upper()
                        parsing_style_reason = False; collecting_style_bullets = False
                        parsing_fabrication_reason = False; collecting_fabrication_bullets = False
                        continue

                    if style_reason_points_start_pattern.match(line_stripped):
                        parsing_style_reason = True # Now waiting for the actual reason line(s)
                        collecting_style_bullets = (parsed_ai_written_style_val is True) # Expect bullets if AI style is YES
                        temp_style_points = [] # Reset for this section
                        # Text on the same line as STYLE_REASON_POINTS: is part of the prompt's placeholder, ignore.
                        continue 
                    
                    if fabrication_reason_points_start_pattern.match(line_stripped):
                        parsing_fabrication_reason = True # Now waiting for the actual reason line(s)
                        collecting_fabrication_bullets = (parsed_fabrication_concern_val in ["MEDIUM", "HIGH"])
                        temp_fab_points = [] # Reset for this section
                        # Text on the same line as FABRICATION_REASON_POINTS: is part of the prompt's placeholder, ignore.
                        continue

                    # Collect points based on current state
                    if parsing_style_reason:
                        if collecting_style_bullets:
                            if line_stripped.startswith("- "): # Strict check for bullet
                                temp_style_points.append(line_stripped)
                            # else: if not a bullet, and we expect bullets, it might be an error or end of bullets.
                            # The earlier check for is_new_key_field_for_style_stop should handle transitions.
                        else: # Expecting a single line statement for human style
                            if line_stripped: # First non-empty line is the statement
                                temp_style_points.append(line_stripped)
                                parsing_style_reason = False # Collected the single statement
                    elif parsing_fabrication_reason:
                        if collecting_fabrication_bullets:
                            if line_stripped.startswith("- "): # Strict check for bullet
                                temp_fab_points.append(line_stripped)
                        else: # Expecting a single line statement for low concern
                            if line_stripped: # First non-empty line is the statement
                                temp_fab_points.append(line_stripped)
                                parsing_fabrication_reason = False # Collected the single statement
                
                # Process collected points more definitively
                if parsed_ai_written_style_val is True: # Expected bullets
                    style_reason_points_list = [p.lstrip("-").strip() for p in temp_style_points if p.lstrip("-").strip()]
                elif parsed_ai_written_style_val is False and temp_style_points: # Expected single statement
                    style_reason_points_list = [temp_style_points[0].strip()]
                else:
                    style_reason_points_list = []

                if parsed_fabrication_concern_val in ["MEDIUM", "HIGH"]: # Expected bullets
                    fabrication_reason_points_list = [p.lstrip("-").strip() for p in temp_fab_points if p.lstrip("-").strip()]
                elif parsed_fabrication_concern_val == "LOW" and temp_fab_points: # Expected single statement
                    fabrication_reason_points_list = [temp_fab_points[0].strip()]
                else:
                    fabrication_reason_points_list = []
                
                # Process collected points
                if temp_style_points:
                    if temp_style_points[0].startswith("-"): # All are bullet points
                        style_reason_points_list = [p.lstrip("-").strip() for p in temp_style_points if p.lstrip("-").strip()]
                    else: # It's a general statement, possibly followed by bullets (though prompt asks for only bullets or one statement)
                        style_reason_points_list = [" ".join(p.lstrip("-").strip() for p in temp_style_points if p.lstrip("-").strip())] # Join all as one statement
                
                if temp_fab_points:
                    if temp_fab_points[0].startswith("-"):
                        fabrication_reason_points_list = [p.lstrip("-").strip() for p in temp_fab_points if p.lstrip("-").strip()]
                    else:
                        fabrication_reason_points_list = [" ".join(p.lstrip("-").strip() for p in temp_fab_points if p.lstrip("-").strip())]


                if parsed_ai_written_style_val is not None: # Check if primary parsing succeeded
                    gemini_parsed_successfully = True
                    detection_details["gemini"]["text_assessment"] = "AI Style" if parsed_ai_written_style_val else "Human Style"
                    detection_details["gemini"]["text_assessment_confidence"] = parsed_confidence_style_val
                    detection_details["gemini"]["fabrication_concern"] = parsed_fabrication_concern_val
                    
                    if not style_reason_points_list:
                        style_reason_points_list = ["No specific style points provided by AI."] if parsed_ai_written_style_val else ["Writing style appears human."]
                    detection_details["gemini"]["style_reason_points"] = style_reason_points_list

                    if not fabrication_reason_points_list:
                        fabrication_reason_points_list = ["No specific fabrication points provided by AI."] if parsed_fabrication_concern_val in ["MEDIUM", "HIGH"] else ["Content appears authentic."]
                    detection_details["gemini"]["fabrication_reason_points"] = fabrication_reason_points_list
                    
                    if parsed_ai_written_style_val:
                        gemini_text_score = parsed_confidence_style_val  # Confidence it's AI-written
                    else:
                        gemini_text_score = 1.0 - parsed_confidence_style_val  # Confidence it's *not* AI-written
                    gemini_text_score = min(max(gemini_text_score, 0.0), 1.0)
                    gemini_effective_score = gemini_text_score

                    if parsed_fabrication_concern_val == "HIGH":
                        gemini_effective_score = max(gemini_effective_score, FABRICATION_HIGH_IMPACT_SCORE)
                    elif parsed_fabrication_concern_val == "MEDIUM":
                        gemini_effective_score = max(gemini_effective_score, FABRICATION_MEDIUM_IMPACT_SCORE)
                    
                    logger.info(f"Gemini for '{filename}': Style AI={parsed_ai_written_style_val}, StyleConf={parsed_confidence_style_val:.2f}, FabConcern={parsed_fabrication_concern_val}. EffectiveScore={gemini_effective_score:.2f}")
                else:
                    gemini_parsed_successfully = False
                    logger.warning(f"Could not fully parse Gemini for {filename}: AI_WRITTEN_STYLE missing. Resp: '{gemini_response_str[:250]}'")
                    detection_details["gemini"]["style_reason_points"] = [f"Response parsing error: AI_WRITTEN_STYLE missing. Raw: {gemini_response_str[:100]}..."]


            except Exception as e:
                gemini_parsed_successfully = False
                logger.error(f"Error during AI AI detection for {filename}: {e}", exc_info=True)
                detection_details["gemini"]["style_reason_points"] = [f"API Error: {str(e)[:100]}..."]
        
        else: # No Gemini service
            gemini_parsed_successfully = False
            logger.info(f"Gemini service not available for {filename}.")
            detection_details["gemini"]["style_reason_points"] = ["AI service not configured."]

        detection_details["gemini"]["score"] = gemini_effective_score
        
        # --- Determine Final Score and Explanation ---
        final_ai_score = gemini_effective_score
        final_is_ai_generated = final_ai_score >= AI_DETECTION_FLAG_THRESHOLD
        
        # Determine the assessment label and class based on the combination of factors
        assessment_label = "" # Initialize
        assessment_class = "" # Initialize
        
        # Determine the assessment label and class based on the combination of factors
        if final_is_ai_generated:
            # Use directly parsed values here as they are available at this point
            # parsed_ai_written_style_val is True/False or None if not parsed
            # parsed_fabrication_concern_val is "LOW", "MEDIUM", "HIGH", or "N/A" if not parsed
            # detection_details['gemini']['text_assessment_confidence'] holds parsed_confidence_style_val if parsing was successful
            if parsed_ai_written_style_val is False and \
               detection_details['gemini']['text_assessment_confidence'] < 0.35 and \
               parsed_fabrication_concern_val == "LOW":
                assessment_label = 'Suspect AI-generated'
                assessment_class = 'suspect-ai-generated-tag'
            else:
                assessment_label = 'AI-generated'
                assessment_class = 'ai-generated-tag'
        else:
            assessment_label = 'Likely Human-written'
            assessment_class = 'human-tag'
            
        final_score_percent = int(final_ai_score * 100)

       # Build the final explanation HTML - Top summary part
        final_explanation_parts = [
            f"<div class='ai-detection-summary'>",
            f"  <div class='assessment-labels-container'>",
            f"    <span class='assessment-tag fabrication-tag'>Fabrication Concern: ",
            f"      <span class='fabrication-level-tag fab-{str(detection_details['gemini']['fabrication_concern']).lower()}'>{html.escape(str(detection_details['gemini']['fabrication_concern']))}</span>",
            f"    </span>",
            f"    <span class='assessment-tag {assessment_class}'>{assessment_label}</span>",
            f"  </div>",
            f"</div>"
        ]

        # --- Conditionally add Detailed Breakdown ---
        if gemini_parsed_successfully:
            # Values from detection_details
            style_assessment_text = detection_details['gemini']['text_assessment'] # "AI Style" or "Human Style"
            # Determine if Gemini thought the style was AI
            parsed_ai_written_style_bool = (style_assessment_text == "AI Style") 
            low_confidence_human = not parsed_ai_written_style_bool and detection_details['gemini']['text_assessment_confidence'] < 0.35

            style_points = detection_details["gemini"].get("style_reason_points", [])
            style_confidence_percent = int(detection_details['gemini']['text_assessment_confidence'] * 100)

            # This definition of fab_concern_level is used later and is fine here.
            fab_concern_level = detection_details['gemini']['fabrication_concern'] 
            fab_points = detection_details["gemini"].get("fabrication_reason_points", [])

            # Modified criteria to show AI Style details even with low confidence human assessment
            should_show_ai_style_details = (
                (parsed_ai_written_style_bool or low_confidence_human) and
                style_points and
                not (len(style_points) == 1 and ("no specific style points" in style_points[0].lower() or "appears human" in style_points[0].lower()))
            )

            # Criteria for showing Fabrication details:
            should_show_fabrication_details = (
                fab_concern_level in ["MEDIUM", "HIGH"] and
                fab_points and
                not (len(fab_points) == 1 and ("no specific fabrication points" in fab_points[0].lower() or "appears authentic" in fab_points[0].lower()))
            )
            
            # Criteria for showing Fabrication details:
            # 1. Fabrication concern is MEDIUM or HIGH.
            # 2. There are fabrication points provided.
            # 3. The fabrication points are not just a generic "no specific points" or "appears authentic" message.
            should_show_fabrication_details = (
                fab_concern_level in ["MEDIUM", "HIGH"] and
                fab_points and
                not (len(fab_points) == 1 and ("no specific fabrication points" in fab_points[0].lower() or "appears authentic" in fab_points[0].lower()))
            )

            if should_show_ai_style_details or should_show_fabrication_details:
                final_explanation_parts.append("<div class='ai-detailed-breakdown'>")
                
                # Content Fabrication Indicators section
                if should_show_fabrication_details:
                    final_explanation_parts.append("  <div class='indicator-container content-fabrication-indicator'>")
                    final_explanation_parts.append(f"    <div class='indicator-heading'>Content Fabrication <span class='indicator-confidence'>({html.escape(str(fab_concern_level))} Concern)</span></div>")
                    final_explanation_parts.append("    <ul class='indicator-list'>")
                    for point in fab_points: # Assumes fab_points is not empty and not generic due to should_show_fabrication_details
                        match = re.match(r"^\s*[\"'](.+?)[\"']\s*-\s*(.+)$", point)
                        if match:
                            # Remove quotes by NOT adding them in the HTML output  
                            # Use div elements with clear margins/padding for guaranteed separation
                            final_explanation_parts.append(f"      <li><div class='indicator-item'><div class='example'><strong>{html.escape(match.group(1))}</strong></div><div class='explanation'>{html.escape(match.group(2))}</div></div></li>")
                        else:
                            final_explanation_parts.append(f"      <li><div>{html.escape(point)}</div></li>")
                    final_explanation_parts.append("    </ul>")
                    final_explanation_parts.append("  </div>")
                    
                final_explanation_parts.append("</div>") # End of ai-detailed-breakdown

                # AI Writing Style Indicators section
                if should_show_ai_style_details:
                    final_explanation_parts.append("  <div class='indicator-container ai-style-indicator'>")
                    final_explanation_parts.append(f"    <div class='indicator-heading'>AI Writing Style <span class='indicator-confidence'>({style_assessment_text} with {style_confidence_percent}% confidence)</span></div>")
                    final_explanation_parts.append("    <ul class='indicator-list'>")
                    for point in style_points: # Assumes style_points is not empty and not generic due to should_show_ai_style_details
                        match = re.match(r"^\s*[\"'](.+?)[\"']\s*-\s*(.+)$", point)
                        if match:
                            # Remove quotes by NOT adding them in the HTML output
                            quote = html.escape(match.group(1))
                            explanation = html.escape(match.group(2))
                            # Use div elements with clear margins/padding for guaranteed separation
                            final_explanation_parts.append(f"      <li><div class='indicator-item'><div class='example'><strong>{quote}</strong></div><div class='explanation'>{explanation}</div></div></li>")
                        else:
                            final_explanation_parts.append(f"      <li><div>{html.escape(point)}</div></li>")
                    final_explanation_parts.append("    </ul>")
                    final_explanation_parts.append("  </div>")
            
            # MODIFIED BLOCK HERE
            elif final_is_ai_generated: # It's flagged as AI based on score, but no specific points from Gemini met display criteria
                final_explanation_parts.append("<div class='ai-detailed-breakdown no-specific-points-for-ai-flag'>")
                final_explanation_parts.append("  <p><i>Flagged as AI-generated based on overall assessment score. The AI model did not provide specific style or fabrication bullet points that met the criteria for a detailed breakdown.</i></p>")
                final_explanation_parts.append("</div>")
            else: # Not flagged as AI, and no specific points to show
                final_explanation_parts.append("<div class='ai-detailed-breakdown no-significant-indicators'>")
                final_explanation_parts.append("  <p><i>No significant AI style or fabrication indicators were flagged for detailed breakdown based on current criteria. Review summary for overall assessment.</i></p>")
                final_explanation_parts.append("</div>")

        elif not self.gemini_service:
            final_explanation_parts = [ # Overwrite for this specific case
                "<div class='ai-detection-summary'>",
                "  <div class='assessment-labels-container'>",
                "    <span class='assessment-tag error-tag'>Unable to Assess</span>",
                "  </div>",
                "</div>", # Close summary
                "<div class='ai-detailed-breakdown error-breakdown'><p class='assessment-error'>AI detection service not configured.</p></div>" # Separate div for error message
            ]
        else: # Gemini service configured, but error occurred (parsing or API call)
            error_reason_from_details = "Unknown error during AI analysis." # Default
            # Try to get a more specific error from the details if parsing started but failed
            if "style_reason_points" in detection_details["gemini"] and detection_details["gemini"]["style_reason_points"]:
                 if any("error" in p.lower() or "failed" in p.lower() for p in detection_details["gemini"]["style_reason_points"]):
                    error_reason_from_details = html.escape(detection_details["gemini"]["style_reason_points"][0])
            elif "ai_generation_reason" in detection_details["gemini"] and ("error" in detection_details["gemini"]["ai_generation_reason"].lower() or "failed" in detection_details["gemini"]["ai_generation_reason"].lower()):
                 error_reason_from_details = html.escape(detection_details["gemini"]["ai_generation_reason"])


            final_explanation_parts = [ # Overwrite
                "<div class='ai-detection-summary'>",
                "  <div class='assessment-labels-container'>",
                "    <span class='assessment-tag error-tag'>Undetermined</span>",
                f"    <span class='assessment-tag ai-score-tag'>{final_score_percent}% AI Score</span>", # Show score if calculable
                "  </div>",
                "</div>", # Close summary
                f"<div class='ai-detailed-breakdown error-breakdown'><p class='assessment-error'>AI analysis could not be completed. Reason: {error_reason_from_details}</p></div>"
            ]
        
        final_explanation = "\n".join(final_explanation_parts)
        
        detection_details["final_score"] = final_ai_score
        detection_details["final_decision_threshold"] = AI_DETECTION_FLAG_THRESHOLD
        
        return AIDetectionResult(
            filename=filename,
            is_ai_generated=final_is_ai_generated,
            confidence=final_ai_score, 
            reason=final_explanation,
            details=detection_details
        )