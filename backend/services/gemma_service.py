import os
import logging
import asyncio
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from dotenv import load_dotenv
from huggingface_hub import login, whoami

logger = logging.getLogger(__name__)

# --- Gemma Configuration ---
DEFAULT_GEMMA_MODEL_ID = "google/gemma-3-1b-it"
GEMMA_MODEL_ID = os.getenv("GEMMA_MODEL_ID", DEFAULT_GEMMA_MODEL_ID)

# --- Load .env and Hugging Face token ---
load_dotenv()
HF_TOKEN = os.getenv("HUGGINGFACE_TOKEN")
if not HF_TOKEN:
    raise RuntimeError("HUGGINGFACE_TOKEN environment variable not set.")


class GemmaService:
    def __init__(self, model_id: str = GEMMA_MODEL_ID):
        self.model_id = model_id
        self.tokenizer = None
        self.model = None
        self.device = "cpu"  # Force CPU
        self.semaphore = asyncio.Semaphore(1)  # Limit Gemma concurrency

        try:
            # --- Hugging Face Authentication ---
            logger.info("Logging into Hugging Face Hub...")
            login(token=HF_TOKEN)
            user_info = whoami()
            logger.info(f"Successfully logged in as user: {user_info['name']}")

            # Check the login
            if user_info is not None and isinstance(user_info, dict) and "name" in user_info:
                logger.info("Hugging Face login is success!")
                logger.info(user_info["name"])
            else:
                logger.error("Hugging Face login failed! Check your Hugging Face token has permissions!")
            logger.info("Successfully logged into Hugging Face Hub.")

            # Print authentication status for debugging
            try:
                whoami_info = whoami()
                logger.info(f"Hugging Face user information: {whoami_info}")
            except Exception as e:
                logger.error(f"whoami call has problem: {e}")

        except Exception as e:
            logger.error(f"Failed to log in to Hugging Face Hub: {e}", exc_info=True)
            raise RuntimeError(f"Could not log in to Hugging Face Hub: {e}") from e

        try:
            logger.info(f"Loading Gemma tokenizer for {self.model_id}...")
            self.tokenizer = AutoTokenizer.from_pretrained(self.model_id)

            logger.info(f"Loading Gemma model {self.model_id} to {self.device}...")

            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_id,
                torch_dtype=torch.float32,  # Force float32 (no bfloat16 on CPU)
                device_map={"": "cpu"},  # Explicitly map to CPU
            )
            logger.info(f"Gemma model {self.model_id} loaded successfully on {self.device}.")

        except Exception as e:
            logger.error(f"Failed to load Gemma model or tokenizer: {e}", exc_info=True)
            raise RuntimeError(f"Could not initialize GemmaService: {e}") from e

    async def _generate_with_gemma(self, prompt: str, max_new_tokens: int = 8192, temperature: float = 0.7) -> str:
        """Helper function to run generation in a separate thread."""
        if not self.model or not self.tokenizer:
            logger.error("Gemma model or tokenizer not loaded.")
            raise RuntimeError("Gemma model/tokenizer not available.")

        def _generate_sync() -> str:
            inputs = self.tokenizer(prompt, return_tensors="pt", padding=True, truncation=True).to(self.device)
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                do_sample=True  # Necessary for temperature to have an effect
            )
            generated_text = self.tokenizer.decode(outputs[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)
            return generated_text

        return await asyncio.to_thread(_generate_sync)

    async def generate_job_details_suggestion_gemma(
        self,
        job_title: str,
        context: dict[str, str]
    ) -> dict[str, str]:
        """Generates suggestions for Job Description and Requirements using Gemma as raw text."""
        logger.info(f"Gemma: Generating job details suggestion for title: {job_title} with context: {context}")

        core_responsibilities = context.get("core_responsibilities", "Not specified")
        key_skills = context.get("key_skills", "Not specified")
        company_culture = context.get("company_culture", "Not specified")
        experience_level = context.get("experience_level", "Not specified")

        # Modified prompt to request plaintext output without any formatting or headers
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
        1. **Job Description:** Create a professional and engaging description (5-8 paragraphs). Highlight key responsibilities, the team/company environment, and what makes the role attractive.
        2. **Requirements/Qualifications:** Create a list of essential skills, experience, and educational qualifications as bullet points.
        3. **Tone:** Professional, clear, and inviting.
        4. **Bias Check:** Avoid biased language related to age, gender, race, etc. Focus on skills and experience.

        **VERY IMPORTANT:**
        * Provide ONLY the raw text content with no headers, no JSON, no markdown formatting
        * DIRECTLY start with the description paragraphs
        * DO NOT include ANY job title 
        * DO NOT include any code blocks or special characters
        * Then provide the requirements as a bullet-point list with each item on a new line starting with a bullet point (•)
        * DO NOT include ANY headers like "Job Description" or "Requirements" or sentences like "Here is the job description" or "Here are the requirements"
        * Use "Requirements" insted of "Requirements/Qualifications"
        * DO NOT include ANY phrases like "Here’s a detailed breakdown of the key requirements for this role:"
        * DO NOT include ANY markdown formatting, code blocks, or special characters
        * DO NOT include ANY explanation or context around the content
        * Return ONLY the plain text content that should be displayed directly to users
        """

        try:
            async with self.semaphore:
                full_prompt_for_gemma = f"<start_of_turn>user\n{system_prompt}<end_of_turn>\n<start_of_turn>model\n"
                response_text = await self._generate_with_gemma(full_prompt_for_gemma)

            logger.debug(f"Gemma raw response text: {response_text}")
            
            # Clean up the response if needed - remove any markdown code blocks
            if "```" in response_text:
                # Extract content between code blocks if present
                code_parts = response_text.split("```")
                if len(code_parts) > 1:
                    response_text = code_parts[1].strip()
            
            # Split response into description and requirements based on bullet points
            # Look for the first bullet point to separate the content
            parts = response_text.split("• ", 1)
            
            description = parts[0].strip()
            requirements = ""
            
            if len(parts) > 1:
                # Add the bullet point back to the first requirement
                requirements = "• " + parts[1].strip()
            
            # Return as dictionary to maintain API compatibility
            return {
                "description": description,
                "requirements": requirements
            }

        except Exception as e:
            logger.error(f"Gemma: Error generating job details suggestion: {str(e)}", exc_info=True)
            raise RuntimeError(f"Failed to generate job details: {str(e)}")